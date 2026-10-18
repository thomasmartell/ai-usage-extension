import { GITHUB_OAUTH, STORAGE_KEYS } from '../../shared/constants';
import { msg } from '../../shared/i18n';
import type {
  GithubAccount,
  GithubDeviceFlow,
  GithubUsage,
  ModelUsage,
  UsageLimit,
} from '../../shared/types';
import { clampPercent, getUsageTone } from '../../shared/utils';
import { mapLimited } from '../mapLimited';

const API = 'https://api.github.com';
const DEVICE_CODE_URL = 'https://github.com/login/device/code';
const ACCESS_TOKEN_URL = 'https://github.com/login/oauth/access_token';
const DEVICE_GRANT = 'urn:ietf:params:oauth:grant-type:device_code';

/**
 * Actions minutes included each month, by plan name. GitHub's billing API
 * reports what was used but not the allowance, so it is looked up here.
 * The REST API names Enterprise Cloud `business_plus`, or `business` on
 * older organizations.
 */
export const ACTIONS_INCLUDED_MINUTES: Record<string, number> = {
  free: 2_000,
  pro: 3_000,
  team: 3_000,
  enterprise: 50_000,
  business: 50_000,
  business_plus: 50_000,
};

/**
 * Rate at which each standard hosted runner draws down the included minutes.
 * Larger runners are billed outright and are left out.
 */
const MINUTE_MULTIPLIERS: Record<string, number> = {
  actions_linux: 1,
  actions_linux_slim: 1,
  actions_linux_arm: 1,
  actions_windows: 2,
  actions_windows_arm: 2,
  actions_macos: 10,
};

/** Display names for budget product SKUs. */
const BUDGET_PRODUCTS: Record<string, string> = {
  actions: 'Actions',
  ai_credits: 'AI credits',
  codespaces: 'Codespaces',
  packages: 'Packages',
  git_lfs: 'Git LFS',
};

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const readNumber = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : 0;

const readString = (value: unknown): string | null =>
  typeof value === 'string' && value.length > 0 ? value : null;

/** One row of a billing usage summary, reduced to what the rows need. */
export interface BillingItem {
  product: string;
  sku: string;
  grossQuantity: number;
  netAmount: number;
}

export interface GithubBudget {
  sku: string;
  amount: number;
  /** A `SkuPricing` budget names one SKU (e.g. `actions_linux`), not a product. */
  skuPricing?: boolean;
  /** Every SKU of a budget that covers several; `sku` then joins them with `+`. */
  skus?: string[];
  id?: string;
  /**
   * GitHub's own spend against the budget. It counts only usage since the
   * budget was created, which the month's usage summary cannot tell apart.
   */
  consumed?: number;
}

export interface AccountBilling {
  account: GithubAccount;
  items: BillingItem[];
  budgets: GithubBudget[];
  /** The budget listing failed, so `budgets` is empty rather than known. */
  budgetsFailed?: boolean;
  /** The public-repository lookup failed, so `publicMinutes` is not known. */
  minutesFailed?: boolean;
  /**
   * Actions minutes (already weighted) run in public repositories. Standard
   * runners are free there, so these never draw on the included minutes.
   */
  publicMinutes?: number;
}

export const parseBillingItems = (payload: unknown): BillingItem[] => {
  if (!isObject(payload) || !Array.isArray(payload.usageItems)) return [];
  return payload.usageItems.filter(isObject).map((item) => ({
    product: readString(item.product) ?? '',
    sku: readString(item.sku) ?? '',
    grossQuantity: readNumber(item.grossQuantity),
    netAmount: readNumber(item.netAmount),
  }));
};

/**
 * Organization-wide budgets from a budget listing. Budgets scoped to a
 * repository, cost center, user or enterprise are skipped: the org usage
 * summary cannot say what they have spent.
 */
export const parseBudgets = (payload: unknown, org: string): GithubBudget[] => {
  if (!isObject(payload) || !Array.isArray(payload.budgets)) return [];
  return payload.budgets.filter(isObject).flatMap((budget) => {
    const scope = readString(budget.budget_scope);
    const entity = readString(budget.budget_entity_name);
    if (scope && scope !== 'organization') return [];
    if (entity && entity.toLowerCase() !== org.toLowerCase()) return [];

    // The listing returns `budget_product_sku`; GitHub's documented schema
    // also shows a `budget_product_skus` array, so accept either.
    const skus = Array.isArray(budget.budget_product_skus)
      ? budget.budget_product_skus.map(readString)
      : [readString(budget.budget_product_sku)];
    const amount = readNumber(budget.budget_amount);
    const skuPricing = readString(budget.budget_type) === 'SkuPricing';
    const id = readString(budget.id);
    const named = skus.filter((sku): sku is string => Boolean(sku));
    if (named.length === 0) return [];
    // One meter per budget: GitHub caps the SKUs together, not each alone.
    return [
      {
        sku: named.join('+'),
        amount,
        ...(named.length > 1 ? { skus: named } : {}),
        ...(skuPricing ? { skuPricing } : {}),
        ...(id ? { id } : {}),
      },
    ];
  });
};

/**
 * Included-minute drawdown of a usage summary's standard hosted runner
 * minutes. GitHub reports self-hosted runner minutes under the same SKUs and
 * only marks them as discounted, alongside the allowance itself, so they
 * cannot be told apart and an account using self-hosted runners reads high.
 */
export const actionsMinutes = (items: BillingItem[]): number =>
  items.reduce((sum, item) => sum + item.grossQuantity * (MINUTE_MULTIPLIERS[item.sku] ?? 0), 0);

/** The UTC calendar month GitHub bills in, as its start and end instants. */
export const billingMonth = (
  now: number,
): { year: number; month: number; start: number; end: number } => {
  const date = new Date(now);
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + 1;
  return { year, month, start: Date.UTC(year, month - 1, 1), end: Date.UTC(year, month, 1) };
};

/** Whether a usage item counts against a budget's product SKU. */
const inBudget = (item: BillingItem, { sku, skus, skuPricing }: GithubBudget): boolean => {
  if (skus) return skus.some((one) => inBudget(item, { sku: one, amount: 0, skuPricing }));
  if (skuPricing) return item.sku === sku;
  // The AI credits budget covers the usage-billed `*_ai_credit(s)` SKUs
  // (Copilot, coding agent, code quality, Spark), not Copilot seat licences.
  if (sku === 'ai_credits') return /_ai_(credit|unit)s?$/.test(item.sku);
  return item.product.toLowerCase().replace(/\s+/g, '_') === sku;
};

const roundCents = (value: number): number => Math.round(value * 100) / 100;

/** Allowance and budget meters for one account's current month. */
export const buildAccountRows = (
  { account, items, budgets, publicMinutes = 0 }: AccountBilling,
  now: number,
): ModelUsage[] => {
  const { start, end } = billingMonth(now);
  const window = { resetsAt: new Date(end).toISOString(), windowMs: end - start };
  const rows: ModelUsage[] = [];

  const included = account.plan ? ACTIONS_INCLUDED_MINUTES[account.plan] : undefined;
  if (included) {
    const used = Math.max(0, Math.round(actionsMinutes(items) - publicMinutes));
    rows.push({
      id: `${account.login}:actions-minutes`,
      label: msg('githubActionsMinutes'),
      group: account.login,
      limit: {
        ...window,
        percentage: clampPercent((used / included) * 100),
        used,
        limit: included,
        unit: 'minutes',
      },
    });
  }

  for (const budget of budgets) {
    if (budget.amount <= 0) continue;
    const spent = roundCents(
      budget.consumed ??
        items
          .filter((item) => inBudget(item, budget))
          .reduce((sum, item) => sum + item.netAmount, 0),
    );
    rows.push({
      id: `${account.login}:budget:${budget.sku}`,
      label: msg(
        'githubBudget',
        (budget.skus ?? [budget.sku]).map((sku) => BUDGET_PRODUCTS[sku] ?? sku).join(' + '),
      ),
      group: account.login,
      // No window length: a budget is a spending cap, so pace against the
      // month says nothing useful.
      limit: {
        resetsAt: window.resetsAt,
        percentage: clampPercent((spent / budget.amount) * 100),
        used: spent,
        limit: budget.amount,
        unit: 'usd',
      },
    });
  }

  return rows;
};

export const buildGithubUsage = (
  viewer: string,
  billing: AccountBilling[],
  now: number,
  unreadable: GithubUsage['unreadable'] = [],
): GithubUsage => {
  // Organizations first: that is where shared CI usually bills.
  const ordered = [...billing].sort(
    (a, b) => Number(a.account.kind === 'user') - Number(b.account.kind === 'user'),
  );
  const windows = ordered.flatMap((entry) => buildAccountRows(entry, now));
  const highest = Math.max(0, ...windows.map((row) => row.limit.percentage));

  const budgetsMissing = ordered
    .filter((entry) => entry.budgetsFailed)
    .map((entry) => entry.account.login);
  const minutesMissing = ordered
    .filter((entry) => entry.minutesFailed)
    .map((entry) => entry.account.login);

  return {
    viewer,
    accounts: ordered.map((entry) => entry.account),
    windows,
    models: [],
    unreadable,
    ...(budgetsMissing.length > 0 ? { budgetsMissing } : {}),
    ...(minutesMissing.length > 0 ? { minutesMissing } : {}),
    status: getUsageTone(highest),
    lastUpdated: now,
  };
};

/* -------------------- HTTP -------------------- */

type ApiResult =
  | { ok: true; data: unknown }
  | { ok: false; status: number; acceptedScopes?: string };

type Unreadable = NonNullable<GithubUsage['unreadable']>[number];

const githubGet = async (path: string, token: string): Promise<ApiResult> => {
  const response = await fetch(`${API}${path}`, {
    cache: 'no-store',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  if (!response.ok) {
    const acceptedScopes = response.headers.get('X-Accepted-OAuth-Scopes') ?? undefined;
    // GitHub answers rate limits with 403 as well as 429; report them as 429
    // so they read as passing rather than as a lack of access.
    const rateLimited =
      response.status === 403 &&
      (response.headers.get('X-RateLimit-Remaining') === '0' ||
        response.headers.has('Retry-After') ||
        /rate limit/i.test(await response.text().catch(() => '')));
    const status = rateLimited ? 429 : response.status;
    return { ok: false, status, ...(acceptedScopes ? { acceptedScopes } : {}) };
  }
  return { ok: true, data: (await response.json()) as unknown };
};

const postForm = async (url: string, fields: Record<string, string>): Promise<Json> => {
  const response = await fetch(url, {
    method: 'POST',
    cache: 'no-store',
    headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields).toString(),
  });
  const payload = (await response.json().catch(() => null)) as unknown;
  if (!response.ok && !isObject(payload)) throw new Error(`GitHub returned ${response.status}`);
  return isObject(payload) ? payload : {};
};

const readToken = async (): Promise<string | null> => {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.githubToken);
  return readString(stored[STORAGE_KEYS.githubToken]);
};

const readSavedOrgs = async (): Promise<string[]> => {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.githubOrgs);
  const orgs = stored[STORAGE_KEYS.githubOrgs];
  return Array.isArray(orgs) ? orgs.filter((org): org is string => typeof org === 'string') : [];
};

const planName = (data: unknown): string | null =>
  isObject(data) && isObject(data.plan)
    ? (readString(data.plan.name)?.toLowerCase() ?? null)
    : null;

/** Billing for one account, or why the token cannot read it. */
const fetchAccountBilling = async (
  account: GithubAccount,
  token: string,
  now: number,
): Promise<AccountBilling | Unreadable> => {
  const { year, month } = billingMonth(now);
  const base =
    account.kind === 'user'
      ? `/users/${account.login}/settings/billing`
      : `/organizations/${account.login}/settings/billing`;

  const summary = await githubGet(`${base}/usage/summary?year=${year}&month=${month}`, token);
  if (!summary.ok) {
    const { status, acceptedScopes } = summary;
    return { login: account.login, status, ...(acceptedScopes ? { acceptedScopes } : {}) };
  }
  // A 200 without `usageItems` is not a month of zero usage: report it like a
  // failed request (status 0), so the account's last rows are kept.
  if (!isObject(summary.data) || !Array.isArray(summary.data.usageItems)) {
    return { login: account.login, status: 0 };
  }

  // Budgets are only exposed for organizations.
  const [budgets, publicMinutes] = await Promise.all([
    account.kind === 'organization' ? fetchBudgets(base, token) : null,
    fetchPublicMinutes(account, base, token, year, month),
  ]);

  const parsed = budgets
    ? await withConsumption(parseBudgets(budgets, account.login), base, token)
    : null;

  return {
    account,
    items: parseBillingItems(summary.data),
    budgets: parsed ?? [],
    ...(account.kind === 'organization' && !parsed ? { budgetsFailed: true } : {}),
    ...(publicMinutes === null ? { minutesFailed: true } : {}),
    publicMinutes: publicMinutes ?? 0,
  };
};

/**
 * Keep accounts this refresh could not read from the last snapshot: orgs an
 * incomplete membership list missed, and accounts whose usage summary failed
 * transiently (a rate limit or server error). Only rows of the current
 * billing month are kept; last month's figures are not current.
 */
const carryOrgs = (next: GithubUsage, previous?: GithubUsage): GithubUsage => {
  if (!previous || (!next.orgsIncomplete && !next.accountsMissing?.length)) return next;
  const known = new Set(next.accounts.map((account) => account.login));
  // Orgs this refresh did list (read or not): only those absent from it were missed.
  const checked = new Set(next.orgsChecked);
  const missing = new Set(next.accountsMissing);
  const current = (row: ModelUsage) =>
    row.limit.resetsAt !== null && Date.parse(row.limit.resetsAt) > next.lastUpdated;

  const carried = previous.accounts
    .filter(
      (account) =>
        !known.has(account.login) &&
        (missing.has(account.login) ||
          (next.orgsIncomplete && account.kind === 'organization' && !checked.has(account.login))),
    )
    .map((account) => ({
      account,
      rows: previous.windows.filter((row) => row.group === account.login && current(row)),
    }))
    .filter(({ rows }) => rows.length > 0);
  if (carried.length === 0) return next;

  // Organizations lead, as in `buildGithubUsage`; each account's rows stay together.
  const accounts = [...next.accounts, ...carried.map(({ account }) => account)].sort(
    (a, b) => Number(a.kind === 'user') - Number(b.kind === 'user'),
  );
  const rowsFor = (login: string) =>
    carried.find(({ account }) => account.login === login)?.rows ??
    next.windows.filter((row) => row.group === login);
  return { ...next, accounts, windows: accounts.flatMap((account) => rowsFor(account.login)) };
};

/**
 * Keep the last known budget rows for accounts whose budget listing failed
 * this time, so a passing rate limit does not make budgets vanish.
 */
export const carryBudgets = (next: GithubUsage, previous?: GithubUsage): GithubUsage => {
  next = carryOrgs(next, previous);
  if (!next.budgetsMissing?.length && !next.minutesMissing?.length) return next;
  // Only rows of the same billing month: an old month's figures are not current.
  const current = (row: ModelUsage) =>
    row.limit.resetsAt !== null && Date.parse(row.limit.resetsAt) > next.lastUpdated;
  let windows = [...next.windows];

  // A failed public-repository lookup would overstate the minutes used, so
  // the last accurate minutes row of this month stands in; with none, the
  // row is left out rather than shown inflated.
  for (const login of next.minutesMissing ?? []) {
    const id = `${login}:actions-minutes`;
    const kept = previous?.windows.find((row) => row.id === id && current(row));
    if (!kept) {
      windows = windows.filter((row) => row.id !== id);
    } else if (windows.some((row) => row.id === id)) {
      windows = windows.map((row) => (row.id === id ? kept : row));
    } else {
      // The plan lookup failed, so no row was built: put the last one back
      // at the head of its account's rows.
      const first = windows.findIndex((row) => row.group === login);
      windows.splice(first < 0 ? windows.length : first, 0, kept);
    }
  }

  for (const login of next.budgetsMissing ?? []) {
    if (!previous) break;
    const kept = previous.windows.filter(
      (row) => row.id.startsWith(`${login}:budget:`) && current(row),
    );
    if (kept.length === 0) continue;
    const after = windows.map((row) => row.group).lastIndexOf(login);
    windows.splice(after < 0 ? windows.length : after + 1, 0, ...kept);
  }
  return { ...next, windows };
};

/**
 * Each live budget's own consumed amount, from its detail endpoint (the
 * listing leaves it out). A budget created mid-month only counts usage since
 * then, so the month's summary would overstate it. Null if any lookup fails, so
 * the last rows are kept rather than shown wrong.
 */
const withConsumption = async (
  budgets: GithubBudget[],
  base: string,
  token: string,
): Promise<GithubBudget[] | null> => {
  const results = await mapLimited(budgets, async (budget) => {
    if (budget.amount <= 0 || !budget.id) return budget;
    const detail = await githubGet(`${base}/budgets/${budget.id}`, token);
    if (!detail.ok || !isObject(detail.data) || typeof detail.data.consumed_amount !== 'number') {
      return null;
    }
    return { ...budget, consumed: detail.data.consumed_amount };
  });
  return results.includes(null) ? null : (results as GithubBudget[]);
};

/** Every page of an org's budget listing (10 per page by default), merged. */
const BUDGET_PAGE_LIMIT = 10;
const fetchBudgets = async (base: string, token: string): Promise<Json | null> => {
  const budgets: unknown[] = [];
  for (let page = 1; page <= BUDGET_PAGE_LIMIT; page += 1) {
    const result = await githubGet(`${base}/budgets?per_page=100&page=${page}`, token);
    // A partial listing would silently drop budgets: treat it as a failure.
    if (!result.ok || !isObject(result.data) || !Array.isArray(result.data.budgets)) return null;
    budgets.push(...result.data.budgets);
    if (result.data.has_next_page !== true) return { budgets };
  }
  // Still more pages at the cap: incomplete, like any other failed page.
  return null;
};

const REPO_PAGE_LIMIT = 10;

/** A failure worth riding out (network, rate limit, server error), not a lack of access. */
const isTransient = (status: number): boolean => status === 0 || status === 429 || status >= 500;

/**
 * Minutes this month's summary counts for public repositories, where
 * standard runners are free. The detailed report names each repository; any
 * public one with usage is summarised on its own so the same SKU weighting
 * applies. Most months that is no repository, costing two requests. Null
 * when any lookup fails: zero would overstate the minutes used.
 */
const fetchPublicMinutes = async (
  account: GithubAccount,
  base: string,
  token: string,
  year: number,
  month: number,
): Promise<number | null> => {
  const detailed = await githubGet(`${base}/usage?year=${year}&month=${month}`, token);
  if (!detailed.ok || !isObject(detailed.data) || !Array.isArray(detailed.data.usageItems)) {
    return null;
  }

  // The live report names repositories bare (`almanac`); GitHub's documented
  // example uses `owner/name`. Compare on the bare name either way.
  const reposWithMinutes = new Set(
    detailed.data.usageItems
      .filter(isObject)
      .filter((item) => readString(item.unitType)?.toLowerCase() === 'minutes')
      .flatMap((item) => readString(item.repositoryName)?.split('/').pop() ?? []),
  );
  if (reposWithMinutes.size === 0) return 0;

  const reposPath =
    account.kind === 'organization'
      ? `/orgs/${account.login}/repos?type=public&per_page=100`
      : `/users/${account.login}/repos?per_page=100`;
  const listed: unknown[] = [];
  for (let page = 1; ; page += 1) {
    const repos = await githubGet(`${reposPath}&page=${page}`, token);
    if (!repos.ok || !Array.isArray(repos.data)) return null;
    listed.push(...repos.data);
    if (repos.data.length < 100) break;
    // Still full at the page cap: the list is cut short, so the public
    // minutes are unknown rather than whatever the prefix happens to hold.
    if (page === REPO_PAGE_LIMIT) return null;
  }

  const publicRepos = listed
    .filter(isObject)
    .filter((repo) => repo.private !== true)
    .flatMap((repo) => readString(repo.name) ?? [])
    .filter((name) => reposWithMinutes.has(name));

  const perRepo = await mapLimited(publicRepos, async (name) => {
    const summary = await githubGet(
      `${base}/usage/summary?year=${year}&month=${month}&repository=${account.login}/${name}`,
      token,
    );
    return summary.ok && isObject(summary.data) && Array.isArray(summary.data.usageItems)
      ? actionsMinutes(parseBillingItems(summary.data))
      : null;
  });
  if (perRepo.includes(null)) return null;
  return perRepo.reduce<number>((sum, minutes) => sum + (minutes ?? 0), 0);
};

export class GithubService {
  /**
   * The user's hourly REST allowance. `/rate_limit` itself is free, so this
   * can run on every refresh without using up what it measures.
   */
  static async fetchRateLimit(token: string): Promise<UsageLimit | null> {
    const result = await githubGet('/rate_limit', token).catch(() => null);
    if (!result?.ok || !isObject(result.data) || !isObject(result.data.resources)) return null;
    const core = result.data.resources.core;
    if (!isObject(core)) return null;
    const limit = readNumber(core.limit);
    const used = readNumber(core.used);
    const reset = readNumber(core.reset);
    if (limit <= 0 || reset <= 0) return null;
    return {
      percentage: clampPercent((used / limit) * 100),
      resetsAt: new Date(reset * 1000).toISOString(),
      windowMs: 60 * 60 * 1000,
      used,
      limit,
    };
  }

  static async isSignedIn(): Promise<boolean> {
    return (await readToken()) !== null;
  }

  /** The stored token, so a refresh can tell whether it changed meanwhile. */
  static currentToken(): Promise<string | null> {
    return readToken();
  }

  /** Usage for the signed-in user and every org whose billing they can read. */
  static async fetchUsage(
    now = Date.now(),
    knownToken: string | null = null,
  ): Promise<GithubUsage | null> {
    const token = knownToken ?? (await readToken());
    if (!token) return null;

    const user = await githubGet('/user', token);
    if (!user.ok) {
      // A revoked or expired token: drop it so the popup offers sign-in again,
      // unless a different token was saved while this request was waiting.
      if (user.status === 401 && (await readToken()) === token) await this.signOut();
      return null;
    }

    const login = isObject(user.data) ? readString(user.data.login) : null;
    if (!login) return null;

    const unreadable: Unreadable[] = [];
    const listedOrgs: string[] = [];
    let orgsIncomplete = false;
    for (let page = 1; page <= REPO_PAGE_LIMIT; page += 1) {
      const orgs = await githubGet(`/user/orgs?per_page=100&page=${page}`, token);
      if (!orgs.ok || !Array.isArray(orgs.data)) {
        // An incomplete list: orgs it missed keep their last rows (`carryBudgets`).
        unreadable.push({ login: 'organizations', status: orgs.ok ? 200 : orgs.status });
        orgsIncomplete = true;
        break;
      }
      listedOrgs.push(
        ...orgs.data.flatMap((org) =>
          isObject(org) && readString(org.login) ? [String(org.login)] : [],
        ),
      );
      if (orgs.data.length < 100) break;
      // Still full at the page cap: later orgs keep their last rows.
      if (page === REPO_PAGE_LIMIT) orgsIncomplete = true;
    }
    // Fine-grained tokens always get an empty org list, so the orgs saved
    // alongside a pasted token are checked too.
    const orgLogins = [...new Set([...listedOrgs, ...(await readSavedOrgs())])];

    // Orgs whose details failed: no plan means no allowance row, so the last
    // one stands in (`carryBudgets`) rather than the meter vanishing.
    const plansMissing: string[] = [];
    const orgAccounts = await mapLimited(orgLogins, async (org): Promise<GithubAccount> => {
      const details = await githubGet(`/orgs/${org}`, token);
      if (!details.ok) plansMissing.push(org);
      return {
        login: org,
        kind: 'organization',
        plan: details.ok ? planName(details.data) : null,
      };
    });

    const accounts: GithubAccount[] = [
      { login, kind: 'user', plan: planName(user.data) },
      ...orgAccounts,
    ];

    const results = await mapLimited(accounts, (account) =>
      fetchAccountBilling(account, token, now).catch(
        (): Unreadable => ({ login: account.login, status: 0 }),
      ),
    );

    const billing: AccountBilling[] = [];
    // A rate limit or server error is passing: those accounts keep their last rows.
    const accountsMissing = results.flatMap((result) =>
      'account' in result || !isTransient(result.status) ? [] : [result.login],
    );
    for (const result of results) {
      if ('account' in result) {
        billing.push(result);
      } else if (result.login !== login) {
        // An org-owned fine-grained token cannot read the personal report,
        // which is expected, so only unreadable orgs are reported.
        unreadable.push(result);
      }
    }

    const usage = buildGithubUsage(login, billing, now, unreadable);
    // Only orgs whose billing was read: one denied outright has no row to keep.
    const read = new Set(billing.map((entry) => entry.account.login));
    const minutesMissing = [
      ...new Set([...(usage.minutesMissing ?? []), ...plansMissing.filter((org) => read.has(org))]),
    ];
    return {
      ...usage,
      ...(minutesMissing.length > 0 ? { minutesMissing } : {}),
      ...(orgsIncomplete ? { orgsIncomplete, orgsChecked: orgLogins } : {}),
      ...(accountsMissing.length > 0 ? { accountsMissing } : {}),
    };
  }

  /**
   * Start GitHub's device flow: store the code for the popup to show, then
   * poll in the background until the user approves it on github.com.
   * `onSignedIn` runs once a token has been stored.
   */
  static async startSignIn(onSignedIn: () => void): Promise<GithubDeviceFlow> {
    const data = await postForm(DEVICE_CODE_URL, {
      client_id: GITHUB_OAUTH.clientId,
      scope: GITHUB_OAUTH.scopes,
    });

    const deviceCode = readString(data.device_code);
    const userCode = readString(data.user_code);
    const verificationUri = readString(data.verification_uri);
    if (!deviceCode || !userCode || !verificationUri) {
      throw new Error(
        readString(data.error_description) ?? readString(data.error) ?? 'device_code_failed',
      );
    }

    const flow: GithubDeviceFlow = {
      userCode,
      verificationUri,
      expiresAt: Date.now() + readNumber(data.expires_in) * 1000,
    };
    await chrome.storage.local.set({ [STORAGE_KEYS.githubDeviceFlow]: flow });

    void this.pollForToken(deviceCode, flow, Math.max(readNumber(data.interval), 5)).then(
      (signedIn) => {
        if (signedIn) onSignedIn();
      },
    );
    return flow;
  }

  /**
   * Store a pasted token (typically fine-grained, with read-only org
   * Administration access) after checking GitHub accepts it. `orgs` are the
   * organization logins to read, since fine-grained tokens cannot list them.
   */
  static async saveToken(token: string, orgs: string[]): Promise<void> {
    const trimmed = token.trim();
    const user = trimmed ? await githubGet('/user', trimmed) : null;
    if (!user?.ok) throw new Error('token_rejected');

    await chrome.storage.local.remove(STORAGE_KEYS.githubDeviceFlow);
    await chrome.storage.local.set({
      [STORAGE_KEYS.githubToken]: trimmed,
      [STORAGE_KEYS.githubOrgs]: orgs.map((org) => org.trim()).filter(Boolean),
    });
  }

  static async signOut(): Promise<void> {
    await chrome.storage.local.remove([
      STORAGE_KEYS.githubToken,
      STORAGE_KEYS.githubOrgs,
      STORAGE_KEYS.githubDeviceFlow,
    ]);
  }

  /** Resolves `true` once a token is stored, `false` if the flow ended without one. */
  private static async pollForToken(
    deviceCode: string,
    flow: GithubDeviceFlow,
    intervalSeconds: number,
  ): Promise<boolean> {
    let interval = intervalSeconds;

    const fail = async (error: string): Promise<boolean> => {
      if (await this.isCurrentFlow(flow)) {
        await chrome.storage.local.set({ [STORAGE_KEYS.githubDeviceFlow]: { ...flow, error } });
      }
      return false;
    };

    while (Date.now() < flow.expiresAt) {
      await new Promise((resolve) => setTimeout(resolve, interval * 1000));
      // Reading storage each round also keeps the service worker awake.
      if (!(await this.isCurrentFlow(flow))) return false;

      let data: Json;
      try {
        data = await postForm(ACCESS_TOKEN_URL, {
          client_id: GITHUB_OAUTH.clientId,
          device_code: deviceCode,
          grant_type: DEVICE_GRANT,
        });
      } catch {
        continue;
      }

      const token = readString(data.access_token);
      if (token) {
        // Cancelled or restarted while the request was in flight: discard it.
        if (!(await this.isCurrentFlow(flow))) return false;
        await chrome.storage.local.set({ [STORAGE_KEYS.githubToken]: token });
        await chrome.storage.local.remove(STORAGE_KEYS.githubDeviceFlow);
        return true;
      }

      const error = readString(data.error);
      if (error === 'authorization_pending') continue;
      if (error === 'slow_down') {
        interval = readNumber(data.interval) || interval + 5;
        continue;
      }
      return fail(error ?? 'sign_in_failed');
    }

    return fail('expired_token');
  }

  /** Whether `flow` is still the stored one (not cancelled or restarted). */
  private static async isCurrentFlow(flow: GithubDeviceFlow): Promise<boolean> {
    const stored = await chrome.storage.local.get(STORAGE_KEYS.githubDeviceFlow);
    const current = stored[STORAGE_KEYS.githubDeviceFlow] as GithubDeviceFlow | undefined;
    return current?.userCode === flow.userCode && !current.error;
  }
}
