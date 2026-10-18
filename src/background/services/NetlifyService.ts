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

/**
 * Build-minute and bandwidth meters for one team. Minutes come from the
 * team's build status (what the dashboard's builds page reads), falling back
 * to the account's `build_minutes` capability; bandwidth from capabilities.
 */
export const buildAccountRows = (
  account: NetlifyAccount,
  buildStatus: unknown,
  grouped: boolean,
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

  const fallback = quota(account.capabilities, 'build_minutes');
  const used = readNumber(minutes.current) ?? fallback?.used ?? null;
  const included =
    readNumber(minutes.included_minutes_with_packs) ||
    readNumber(minutes.included_minutes) ||
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

export class NetlifyService {
  static async isSignedIn(): Promise<boolean> {
    return (await readToken()) !== null;
  }

  /** Build minutes and bandwidth for every team the token can see. */
  static async fetchUsage(now = Date.now()): Promise<NetlifyUsage | null> {
    const token = await readToken();
    if (!token) return null;

    const listing = await netlifyGet('/accounts', token);
    if (!listing.ok) {
      // A revoked or expired token: drop it so the popup asks for a new one.
      if (listing.status === 401) await this.signOut();
      return null;
    }

    const accounts = parseAccounts(listing.data);
    const statuses = await Promise.all(
      accounts.map((account) =>
        netlifyGet(`/${account.slug}/builds/status`, token).catch(() => null),
      ),
    );

    const windows = accounts.flatMap((account, index) => {
      const status = statuses[index];
      // Always under a team heading, which also carries the cycle's reset date.
      return buildAccountRows(account, status?.ok ? status.data : null, true);
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
