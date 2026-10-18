import { GITHUB_OAUTH, STORAGE_KEYS } from '../../shared/constants';
import { msg } from '../../shared/i18n';
import type { GithubAccount, GithubDeviceFlow, GithubUsage, ModelUsage } from '../../shared/types';
import { clampPercent, getUsageTone } from '../../shared/utils';

const API = 'https://api.github.com';
const DEVICE_CODE_URL = 'https://github.com/login/device/code';
const ACCESS_TOKEN_URL = 'https://github.com/login/oauth/access_token';
const DEVICE_GRANT = 'urn:ietf:params:oauth:grant-type:device_code';

/**
 * Actions minutes included each month, by plan name. GitHub's billing API
 * reports what was used but not the allowance, so it is looked up here.
 */
export const ACTIONS_INCLUDED_MINUTES: Record<string, number> = {
  free: 2_000,
  pro: 3_000,
  team: 3_000,
  enterprise: 50_000,
};

/** Rate at which each standard hosted runner draws down the included minutes. */
const MINUTE_MULTIPLIERS: Record<string, number> = {
  actions_linux: 1,
  actions_windows: 2,
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
}

export interface AccountBilling {
  account: GithubAccount;
  items: BillingItem[];
  budgets: GithubBudget[];
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

export const parseBudgets = (payload: unknown): GithubBudget[] => {
  if (!isObject(payload) || !Array.isArray(payload.budgets)) return [];
  return payload.budgets.filter(isObject).flatMap((budget) => {
    const sku = readString(budget.budget_product_sku);
    return sku ? [{ sku, amount: readNumber(budget.budget_amount) }] : [];
  });
};

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
const inBudget = (item: BillingItem, sku: string): boolean => {
  if (sku === 'ai_credits') return item.product.toLowerCase() === 'copilot';
  return item.product.toLowerCase().replace(/\s+/g, '_') === sku;
};

const roundCents = (value: number): number => Math.round(value * 100) / 100;

/** Allowance and budget meters for one account's current month. */
export const buildAccountRows = (
  { account, items, budgets }: AccountBilling,
  now: number,
): ModelUsage[] => {
  const { start, end } = billingMonth(now);
  const window = { resetsAt: new Date(end).toISOString(), windowMs: end - start };
  const rows: ModelUsage[] = [];

  const included = account.plan ? ACTIONS_INCLUDED_MINUTES[account.plan] : undefined;
  if (included) {
    const used = Math.round(
      items.reduce(
        (sum, item) => sum + item.grossQuantity * (MINUTE_MULTIPLIERS[item.sku] ?? 0),
        0,
      ),
    );
    rows.push({
      id: `${account.login}:actions-minutes`,
      label: msg('githubActionsMinutes', account.login),
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
      items
        .filter((item) => inBudget(item, budget.sku))
        .reduce((sum, item) => sum + item.netAmount, 0),
    );
    rows.push({
      id: `${account.login}:budget:${budget.sku}`,
      label: msg('githubBudget', [account.login, BUDGET_PRODUCTS[budget.sku] ?? budget.sku]),
      limit: {
        ...window,
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
): GithubUsage => {
  // Organizations first: that is where shared CI usually bills.
  const ordered = [...billing].sort(
    (a, b) => Number(a.account.kind === 'user') - Number(b.account.kind === 'user'),
  );
  const windows = ordered.flatMap((entry) => buildAccountRows(entry, now));
  const highest = Math.max(0, ...windows.map((row) => row.limit.percentage));

  return {
    viewer,
    accounts: ordered.map((entry) => entry.account),
    windows,
    models: [],
    status: getUsageTone(highest),
    lastUpdated: now,
  };
};

/* -------------------- HTTP -------------------- */

type ApiResult = { ok: true; data: unknown } | { ok: false; status: number };

const githubGet = async (path: string, token: string): Promise<ApiResult> => {
  const response = await fetch(`${API}${path}`, {
    cache: 'no-store',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  if (!response.ok) return { ok: false, status: response.status };
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

const planName = (data: unknown): string | null =>
  isObject(data) && isObject(data.plan)
    ? (readString(data.plan.name)?.toLowerCase() ?? null)
    : null;

/** Billing for one account, or `null` when the token cannot read it. */
const fetchAccountBilling = async (
  account: GithubAccount,
  token: string,
  now: number,
): Promise<AccountBilling | null> => {
  const { year, month } = billingMonth(now);
  const base =
    account.kind === 'user'
      ? `/users/${account.login}/settings/billing`
      : `/organizations/${account.login}/settings/billing`;

  const summary = await githubGet(`${base}/usage/summary?year=${year}&month=${month}`, token);
  if (!summary.ok) return null;

  // Budgets are only exposed for organizations.
  const budgets =
    account.kind === 'organization' ? await githubGet(`${base}/budgets`, token) : null;

  return {
    account,
    items: parseBillingItems(summary.data),
    budgets: budgets?.ok ? parseBudgets(budgets.data) : [],
  };
};

export class GithubService {
  static async isSignedIn(): Promise<boolean> {
    return (await readToken()) !== null;
  }

  /** Usage for the signed-in user and every org whose billing they can read. */
  static async fetchUsage(now = Date.now()): Promise<GithubUsage | null> {
    const token = await readToken();
    if (!token) return null;

    const user = await githubGet('/user', token);
    if (!user.ok) {
      // A revoked or expired token: drop it so the popup offers sign-in again.
      if (user.status === 401) await this.signOut();
      return null;
    }

    const login = isObject(user.data) ? readString(user.data.login) : null;
    if (!login) return null;

    const orgs = await githubGet('/user/orgs?per_page=100', token);
    const orgLogins =
      orgs.ok && Array.isArray(orgs.data)
        ? orgs.data.flatMap((org) =>
            isObject(org) && readString(org.login) ? [String(org.login)] : [],
          )
        : [];

    const orgAccounts = await Promise.all(
      orgLogins.map(async (org): Promise<GithubAccount> => {
        const details = await githubGet(`/orgs/${org}`, token);
        return {
          login: org,
          kind: 'organization',
          plan: details.ok ? planName(details.data) : null,
        };
      }),
    );

    const accounts: GithubAccount[] = [
      { login, kind: 'user', plan: planName(user.data) },
      ...orgAccounts,
    ];

    const billing = await Promise.all(
      accounts.map((account) => fetchAccountBilling(account, token, now).catch(() => null)),
    );

    return buildGithubUsage(
      login,
      billing.filter((entry): entry is AccountBilling => entry !== null),
      now,
    );
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

  static async signOut(): Promise<void> {
    await chrome.storage.local.remove([STORAGE_KEYS.githubToken, STORAGE_KEYS.githubDeviceFlow]);
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
