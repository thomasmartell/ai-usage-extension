import { STORAGE_KEYS } from '../../shared/constants';
import { msg } from '../../shared/i18n';
import type { ModelUsage, NetlifyUsage } from '../../shared/types';
import { clampPercent, getUsageTone } from '../../shared/utils';

const API = 'https://api.netlify.com/api/v1';
const BYTES_PER_GB = 1_000_000_000;

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const readNumber = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

const readString = (value: unknown): string | null =>
  typeof value === 'string' && value.length > 0 ? value : null;

/** A number, or a numeric string: Netlify's API model types minute allowances as strings. */
const readAmount = (value: unknown): number | null =>
  readNumber(typeof value === 'string' && value.trim() !== '' ? Number(value) : value);

const readDate = (value: unknown): number | null => {
  const text = readString(value);
  const time = text ? Date.parse(text) : NaN;
  return Number.isFinite(time) ? time : null;
};

/** One Netlify team, reduced to what its meters need. */
export interface NetlifyAccount {
  id: string;
  slug: string;
  name: string;
  plan: string | null;
  /** `capabilities` from the account listing (bandwidth and minute quotas). */
  capabilities: Json;
}

export const parseAccounts = (payload: unknown): NetlifyAccount[] =>
  (Array.isArray(payload) ? payload : []).filter(isObject).flatMap((account) => {
    const id = readString(account.id);
    const slug = readString(account.slug) ?? id;
    if (!id || !slug) return [];
    return [
      {
        id,
        slug,
        name: readString(account.name) ?? slug,
        plan: readString(account.type_name),
        capabilities: isObject(account.capabilities) ? account.capabilities : {},
      },
    ];
  });

/** A capability quota as `{ used, included }`, when the account reports one. */
const quota = (capabilities: Json, key: string): { used: number; included: number } | null => {
  const entry = capabilities[key];
  if (!isObject(entry)) return null;
  const used = readNumber(entry.used);
  const included = readNumber(entry.included);
  return used !== null && included !== null && included > 0 ? { used, included } : null;
};

/** A `{ used, total }` credit pool from the team's credit balance. */
const creditPool = (credits: unknown, key: string): { used: number; total: number } | null => {
  const pool = isObject(credits) && isObject(credits[key]) ? credits[key] : null;
  const used = pool ? readAmount(pool.used) : null;
  const total = pool ? readAmount(pool.total) : null;
  return used !== null && total ? { used, total } : null;
};

/**
 * Meters for one team. Credit-based plans (current Pro and Free) spend one
 * pool of credits on deploys, requests and bandwidth: the monthly plan
 * allowance renews each cycle, purchased add-on credits do not expire.
 * Legacy plans report build minutes (from the team's build status, falling
 * back to the account's `build_minutes` capability) and bandwidth instead.
 */
export const buildAccountRows = (
  account: NetlifyAccount,
  buildStatus: unknown,
  grouped: boolean,
  credits: unknown = null,
): ModelUsage[] => {
  const rows: ModelUsage[] = [];
  const group = grouped ? { group: account.name } : {};

  const minutes = isObject(buildStatus) && isObject(buildStatus.minutes) ? buildStatus.minutes : {};
  const periodStart = readDate(minutes.period_start_date);
  const periodEnd = readDate(minutes.period_end_date);
  const window =
    periodStart !== null && periodEnd !== null && periodEnd > periodStart
      ? { resetsAt: new Date(periodEnd).toISOString(), windowMs: periodEnd - periodStart }
      : { resetsAt: null };

  const plan = creditPool(credits, 'plan_credits');
  if (plan) {
    rows.push({
      id: `${account.slug}:plan-credits`,
      label: msg('netlifyPlanCredits'),
      ...group,
      limit: {
        ...window,
        percentage: clampPercent((plan.used / plan.total) * 100),
        used: Math.round(plan.used),
        limit: plan.total,
        unit: 'credits',
      },
    });
  }

  const addons = creditPool(credits, 'credit_addons');
  if (addons) {
    rows.push({
      id: `${account.slug}:addon-credits`,
      label: msg('netlifyAddonCredits'),
      ...group,
      limit: {
        resetsAt: null,
        percentage: clampPercent((addons.used / addons.total) * 100),
        used: Math.round(addons.used),
        limit: addons.total,
        unit: 'credits',
      },
    });
  }

  const fallback = quota(account.capabilities, 'build_minutes');
  const used = readAmount(minutes.current) ?? fallback?.used ?? null;
  const included =
    readAmount(minutes.included_minutes_with_packs) ||
    readAmount(minutes.included_minutes) ||
    fallback?.included ||
    null;

  if (used !== null && included) {
    rows.push({
      id: `${account.slug}:build-minutes`,
      label: msg('netlifyBuildMinutes'),
      ...group,
      limit: {
        ...window,
        percentage: clampPercent((used / included) * 100),
        used: Math.round(used),
        limit: included,
        unit: 'minutes',
      },
    });
  }

  const bandwidth = quota(account.capabilities, 'bandwidth');
  if (bandwidth) {
    rows.push({
      id: `${account.slug}:bandwidth`,
      label: msg('netlifyBandwidth'),
      ...group,
      limit: {
        ...window,
        percentage: clampPercent((bandwidth.used / bandwidth.included) * 100),
        used: Math.round((bandwidth.used / BYTES_PER_GB) * 10) / 10,
        limit: Math.round(bandwidth.included / BYTES_PER_GB),
        unit: 'gb',
      },
    });
  }

  return rows;
};

/* -------------------- HTTP -------------------- */

type ApiResult = { ok: true; data: unknown } | { ok: false; status: number };

const netlifyGet = async (path: string, token: string): Promise<ApiResult> => {
  const response = await fetch(`${API}${path}`, {
    cache: 'no-store',
    headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
  });
  if (!response.ok) return { ok: false, status: response.status };
  return { ok: true, data: (await response.json()) as unknown };
};

const readToken = async (): Promise<string | null> => {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.netlifyToken);
  return readString(stored[STORAGE_KEYS.netlifyToken]);
};

const ignoreFailure = (request: Promise<ApiResult>): Promise<ApiResult | null> =>
  request.catch(() => null);

export class NetlifyService {
  static async isSignedIn(): Promise<boolean> {
    return (await readToken()) !== null;
  }

  /** The stored token, so a refresh can tell whether it changed meanwhile. */
  static currentToken(): Promise<string | null> {
    return readToken();
  }

  /** Credits, build minutes and bandwidth for every team the token can see. */
  static async fetchUsage(
    now = Date.now(),
    knownToken: string | null = null,
  ): Promise<NetlifyUsage | null> {
    const token = knownToken ?? (await readToken());
    if (!token) return null;

    const listing = await netlifyGet('/accounts', token);
    if (!listing.ok) {
      // A revoked or expired token: drop it so the popup asks for a new one.
      if (listing.status === 401) await this.signOut();
      return null;
    }

    const accounts = parseAccounts(listing.data);
    const details = await Promise.all(
      accounts.map((account) =>
        Promise.all([
          ignoreFailure(netlifyGet(`/${account.slug}/builds/status`, token)),
          ignoreFailure(netlifyGet(`/${account.slug}/billing/credits`, token)),
        ]),
      ),
    );

    const windows = accounts.flatMap((account, index) => {
      const [status, credits] = details[index];
      // Always under a team heading, which also carries the cycle's reset date.
      return buildAccountRows(
        account,
        status?.ok ? status.data : null,
        true,
        credits?.ok ? credits.data : null,
      );
    });
    const highest = Math.max(0, ...windows.map((row) => row.limit.percentage));

    return {
      teams: accounts.map(({ slug, name, plan }) => ({ slug, name, plan })),
      windows,
      models: [],
      status: getUsageTone(highest),
      lastUpdated: now,
    };
  }

  /** Store a pasted personal access token after checking Netlify accepts it. */
  static async saveToken(token: string): Promise<void> {
    const trimmed = token.trim();
    const user = trimmed ? await netlifyGet('/user', trimmed) : null;
    if (!user?.ok) throw new Error('token_rejected');
    await chrome.storage.local.set({ [STORAGE_KEYS.netlifyToken]: trimmed });
  }

  static async signOut(): Promise<void> {
    await chrome.storage.local.remove(STORAGE_KEYS.netlifyToken);
  }
}
