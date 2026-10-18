import { SLOW_REFRESH_MINUTES, STORAGE_KEYS, WINDOW_MS } from '../../shared/constants';
import { msg } from '../../shared/i18n';
import { accountFingerprint } from '../../shared/diagnostics';
import {
  ClaudeUsage,
  CodexUsage,
  ModelUsage,
  UsageLimit,
  UsageReset,
  UsageState,
} from '../../shared/types';
import { clampPercent, getUsageTone } from '../../shared/utils';
import { carryBudgets, GithubService } from './GithubService';
import { carryCredits, NetlifyService } from './NetlifyService';

const ENDPOINTS = {
  claudeOrgs: 'https://claude.ai/api/organizations',
  /** `cedar_ember=1` asks for the reset-grant block claude.ai's own usage page shows. */
  claudeUsage: (orgId: string) =>
    `https://claude.ai/api/organizations/${orgId}/usage?cedar_ember=1`,
  codexSession: 'https://chatgpt.com/api/auth/session',
  codexUsage: 'https://chatgpt.com/backend-api/wham/usage',
  codexResetCredits: 'https://chatgpt.com/backend-api/wham/rate-limit-reset-credits',
} as const;

const JSON_HEADERS = { Accept: 'application/json' } as const;

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const readString = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  return value.length > 0 ? value : null;
};

const readNumber = (value: unknown): number | null => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return value;
};

const firstString = (...candidates: unknown[]): string | null => {
  for (const c of candidates) {
    const s = readString(c);
    if (s) return s;
  }
  return null;
};

const buildLimit = (
  percent: number | null,
  resetsAt: string | null,
  windowMs?: number,
): UsageLimit => ({
  percentage: clampPercent(percent ?? 0),
  resetsAt,
  ...(windowMs === undefined ? {} : { windowMs }),
});

const finalize = <T extends { session: UsageLimit; weekly: UsageLimit }>(payload: T) => ({
  ...payload,
  status: getUsageTone(Math.max(payload.session.percentage, payload.weekly.percentage)),
  lastUpdated: Date.now(),
});

const humanizeSlug = (slug: string): string =>
  slug
    .split(/[_-]+/)
    .filter(Boolean)
    .map((word) =>
      word.toLowerCase() === 'gpt' ? 'GPT' : word[0].toUpperCase() + word.slice(1).toLowerCase(),
    )
    .join(' ');

/* -------------------- Claude -------------------- */

const claudeWindowFrom = (window: unknown, windowMs: number): UsageLimit => {
  if (!isObject(window)) return buildLimit(0, null, windowMs);
  return buildLimit(readNumber(window.utilization), readString(window.resets_at), windowMs);
};

const claudeModelBreakdown = (raw: Json): ModelUsage[] => {
  if (!Array.isArray(raw.limits)) return [];

  return raw.limits.reduce<ModelUsage[]>((models, entry, index) => {
    if (!isObject(entry)) return models;

    const scope = isObject(entry.scope) ? entry.scope : null;
    const model = scope && isObject(scope.model) ? scope.model : null;
    const displayName = model ? readString(model.display_name) : null;
    if (!displayName) return models;

    const isSession = entry.group === 'session';
    const tag = isSession ? '5h' : '7d';
    models.push({
      id: `${readString(entry.kind) ?? 'scoped'}-${index}`,
      label: `${displayName} · ${tag}`,
      limit: buildLimit(
        readNumber(entry.percent),
        readString(entry.resets_at),
        isSession ? WINDOW_MS.fiveHours : WINDOW_MS.sevenDays,
      ),
    });
    return models;
  }, []);
};

/**
 * Reset grants arrive under `cedar_ember.grants` when the usage endpoint is
 * asked for them. A grant is worth showing only while it still has resets
 * left and the service says it can be used now; each remaining reset in it
 * becomes its own entry.
 */
const claudeResets = (raw: Json): UsageReset[] => {
  const block = isObject(raw.cedar_ember) ? raw.cedar_ember : null;
  if (!block || !Array.isArray(block.grants)) return [];

  return block.grants.reduce<UsageReset[]>((resets, grant) => {
    if (!isObject(grant)) return resets;
    const id = readString(grant.id);
    const left = readNumber(grant.resets_left) ?? 0;
    if (!id || left <= 0 || grant.usable_now !== true) return resets;

    const type = readString(grant.type);
    const label = type === 'full' ? msg('fullReset') : humanizeSlug(type ?? 'reset');
    const expiresAt = readString(grant.ends_at);
    // One row per remaining reset, so a multi-reset grant isn't undercounted.
    const count = Math.floor(left);
    for (let n = 1; n <= count; n += 1) {
      resets.push({ id: count === 1 ? id : `${id}:${n}`, label, expiresAt });
    }
    return resets;
  }, []);
};

export const buildClaudeUsage = (raw: Json | null): ClaudeUsage | null => {
  if (!raw) return null;

  return {
    plan: 'unknown',
    ...finalize({
      session: claudeWindowFrom(raw.five_hour, WINDOW_MS.fiveHours),
      weekly: claudeWindowFrom(raw.seven_day, WINDOW_MS.sevenDays),
    }),
    models: claudeModelBreakdown(raw),
    resets: claudeResets(raw),
    raw,
  };
};

const resolveOrgFromList = (orgs: unknown): string | null => {
  if (!Array.isArray(orgs) || orgs.length === 0) return null;

  for (const entry of orgs) {
    if (!isObject(entry)) continue;
    const caps = Array.isArray(entry.capabilities) ? entry.capabilities : [];
    if (caps.includes('api')) continue;
    const id = readString(entry.uuid);
    if (id) return id;
  }

  const first = isObject(orgs[0]) ? readString(orgs[0].uuid) : null;
  return first;
};

/* -------------------- Codex -------------------- */

type CodexSessionInfo = { accessToken: string; accountId: string | null };
type CodexWindowPosition = 'primary' | 'secondary';

interface ParsedCodexWindow {
  position: CodexWindowPosition;
  durationSeconds: number | null;
  sortSeconds: number;
  shortLabel: string;
  label: string;
  limit: UsageLimit;
}

const CODEX_WINDOW_PERIODS = [
  { seconds: 5 * 60 * 60, labelKey: 'sessionLimit', shortLabel: '5h' },
  { seconds: 24 * 60 * 60, labelKey: 'dailyLimit', shortLabel: '1d' },
  { seconds: 7 * 24 * 60 * 60, labelKey: 'weeklyLimit', shortLabel: '7d' },
  { seconds: 30 * 24 * 60 * 60, labelKey: 'monthlyLimit', shortLabel: '30d' },
  { seconds: 365 * 24 * 60 * 60, labelKey: 'annualLimit', shortLabel: '1y' },
] as const;

const isApproximateWindow = (actual: number, expected: number): boolean =>
  actual >= expected * 0.95 && actual <= expected * 1.05;

const codexWindowCopy = (
  durationSeconds: number | null,
  position: CodexWindowPosition,
): { label: string; shortLabel: string; sortSeconds: number } => {
  const period =
    durationSeconds === null
      ? null
      : CODEX_WINDOW_PERIODS.find(({ seconds }) => isApproximateWindow(durationSeconds, seconds));

  if (period) {
    return {
      label: msg(period.labelKey),
      shortLabel: period.shortLabel,
      sortSeconds: period.seconds,
    };
  }

  const labelKey = position === 'primary' ? 'usageLimit' : 'secondaryUsageLimit';
  return {
    label: msg(labelKey),
    shortLabel: msg(labelKey),
    sortSeconds: Number.POSITIVE_INFINITY,
  };
};

const codexResetTimestamp = (window: Json): string | null => {
  const epochSeconds = readNumber(window.reset_at);
  if (epochSeconds !== null) {
    return new Date(epochSeconds * 1000).toISOString();
  }

  const afterSeconds = readNumber(window.reset_after_seconds);
  if (afterSeconds !== null) {
    return new Date(Date.now() + afterSeconds * 1000).toISOString();
  }

  return null;
};

const codexWindowFrom = (window: Json, durationSeconds: number | null): UsageLimit => {
  return buildLimit(
    readNumber(window.used_percent),
    codexResetTimestamp(window),
    durationSeconds === null ? undefined : durationSeconds * 1000,
  );
};

const parseCodexWindows = (entry: Json): ParsedCodexWindow[] => {
  const windows: ParsedCodexWindow[] = [];

  (['primary', 'secondary'] as const).forEach((position) => {
    const rawWindow = entry[`${position}_window`];
    if (!isObject(rawWindow)) return;

    const rawDuration = readNumber(rawWindow.limit_window_seconds);
    const durationSeconds = rawDuration !== null && rawDuration > 0 ? rawDuration : null;
    const copy = codexWindowCopy(durationSeconds, position);
    windows.push({
      position,
      durationSeconds,
      ...copy,
      limit: codexWindowFrom(rawWindow, durationSeconds),
    });
  });

  return windows.sort((left, right) => {
    if (left.sortSeconds !== right.sortSeconds) return left.sortSeconds - right.sortSeconds;
    return left.position === 'primary' ? -1 : 1;
  });
};

const codexPrimaryWindows = (rate: Json | null): ModelUsage[] => {
  if (!rate) return [];
  return parseCodexWindows(rate).map((window) => ({
    id: `codex:${window.position}:${window.durationSeconds ?? 'unknown'}`,
    label: window.label,
    limit: window.limit,
  }));
};

const codexRateLimitWindows = (id: string, label: string, entry: Json): ModelUsage[] => {
  const rate = isObject(entry.rate_limit) ? entry.rate_limit : entry;
  return parseCodexWindows(rate).map((window) => ({
    id: `${id}:${window.position}:${window.durationSeconds ?? 'unknown'}`,
    label: `${label} · ${window.shortLabel}`,
    limit: window.limit,
  }));
};

const codexModelBreakdown = (raw: Json): ModelUsage[] => {
  const models: ModelUsage[] = [];
  const additional = raw.additional_rate_limits;

  if (Array.isArray(additional)) {
    additional.forEach((entry, index) => {
      if (!isObject(entry)) return;
      const limitName = firstString(
        entry.limit_name,
        entry.model,
        entry.name,
        entry.label,
        entry.metered_feature,
      );
      if (!limitName) return;

      const limitId = firstString(entry.metered_feature, entry.limit_name) ?? String(index);
      models.push(
        ...codexRateLimitWindows(`additional.${limitId}`, humanizeSlug(limitName), entry),
      );
    });
  } else if (isObject(additional)) {
    for (const [name, entry] of Object.entries(additional)) {
      if (!isObject(entry)) continue;
      models.push(...codexRateLimitWindows(`additional.${name}`, humanizeSlug(name), entry));
    }
  }

  if (isObject(raw.code_review_rate_limit)) {
    models.push(...codexRateLimitWindows('code_review', 'Code review', raw.code_review_rate_limit));
  }

  return models;
};

/** Parse the reset-credits endpoint: only credits still marked available count. */
export const buildCodexResets = (raw: Json | null): UsageReset[] => {
  if (!raw || !Array.isArray(raw.credits)) return [];

  return raw.credits.reduce<UsageReset[]>((resets, credit) => {
    if (!isObject(credit)) return resets;
    const id = readString(credit.id);
    if (!id || credit.status !== 'available') return resets;

    resets.push({
      id,
      label: readString(credit.title) ?? msg('fullReset'),
      expiresAt: readString(credit.expires_at),
    });
    return resets;
  }, []);
};

const codexAvailableResets = (raw: Json): number | null => {
  const resetCredits = raw.rate_limit_reset_credits;
  if (!isObject(resetCredits)) return null;
  return readNumber(resetCredits.available_count);
};

export const buildCodexUsage = (raw: Json | null): CodexUsage | null => {
  if (!raw) return null;
  const rate = isObject(raw.rate_limit) ? raw.rate_limit : null;
  const windows = codexPrimaryWindows(rate);

  return {
    windows,
    models: codexModelBreakdown(raw),
    availableResets: codexAvailableResets(raw),
    status: getUsageTone(Math.max(0, ...windows.map((window) => window.limit.percentage))),
    lastUpdated: Date.now(),
    raw,
  };
};

const accountIdFromAccessToken = (token: string | null): string | null => {
  if (!token) return null;
  try {
    const payload = token.split('.')[1];
    if (!payload) return null;
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
    const bytes = Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
    const claims: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (!isObject(claims)) return null;
    const auth = claims['https://api.openai.com/auth'];
    if (!isObject(auth)) return null;
    // This is routing metadata from the token already used for this request,
    // not local token validation. Never use the user/subject ID as an account ID.
    return firstString(auth.chatgpt_account_id, auth.account_id);
  } catch {
    return null;
  }
};

const accountIdFromSession = (session: Json): string | null => {
  const direct = firstString(
    session.account_id,
    session.accountId,
    session.active_account_id,
    session.activeAccountId,
  );
  if (direct) return direct;

  // Some web session versions nest the selected account under account.id.
  // Prefer it to user defaults or the first membership, which can be another account.
  if (isObject(session.account)) {
    const selectedAccount = firstString(session.account.id, session.account.account_id);
    if (selectedAccount) return selectedAccount;
  }

  const tokenAccount = accountIdFromAccessToken(readString(session.accessToken));
  if (tokenAccount) return tokenAccount;

  if (isObject(session.user)) {
    const fromUser = firstString(
      session.user.account_id,
      session.user.accountId,
      session.user.default_account_id,
    );
    if (fromUser) return fromUser;
  }

  if (Array.isArray(session.accounts)) {
    for (const entry of session.accounts) {
      if (!isObject(entry)) continue;
      const id = firstString(entry.account_id, entry.id, entry.uuid);
      if (id) return id;
    }
  }

  return null;
};

/* -------------------- HTTP -------------------- */

const fetchJson = async (
  url: string,
  init: RequestInit = {},
): Promise<{ ok: true; data: Json } | { ok: false; status: number }> => {
  const response = await fetch(url, {
    credentials: 'include',
    ...init,
    headers: { ...JSON_HEADERS, ...(init.headers ?? {}) },
  });

  if (!response.ok) {
    return { ok: false, status: response.status };
  }

  const payload = (await response.json()) as unknown;
  return { ok: true, data: (isObject(payload) ? payload : { value: payload }) as Json };
};

const fetchJsonRaw = async (url: string, init?: RequestInit): Promise<unknown> => {
  const response = await fetch(url, {
    credentials: 'include',
    headers: JSON_HEADERS,
    ...init,
  });
  if (!response.ok) return null;
  return response.json();
};

/* -------------------- History -------------------- */

/** Rolling per-limit usage samples: `{ [limitKey]: [[epochMs, percent], …] }`. */
type UsageHistory = Record<string, Array<[number, number]>>;

const HISTORY_MAX_AGE_MS = WINDOW_MS.sevenDays;
/** 7 days of 5-minute samples is ~2016; the cap is a safety margin above it. */
const HISTORY_MAX_SAMPLES = 2500;

/** Claude model rows key by label (their ids carry an array index); Codex rows
 *  key by id (their ids carry the stable position + window duration). */
const historySamples = (state: UsageState): Array<[string, number]> => {
  const samples: Array<[string, number]> = [];
  if (state.claude) {
    samples.push(['claude:session', state.claude.session.percentage]);
    samples.push(['claude:weekly', state.claude.weekly.percentage]);
    for (const model of state.claude.models) {
      samples.push([`claude:model:${model.label}`, model.limit.percentage]);
    }
  }
  if (state.codex) {
    for (const window of state.codex.windows ?? []) {
      samples.push([`codex:${window.id}`, window.limit.percentage]);
    }
    for (const model of state.codex.models) {
      samples.push([`codex:${model.id}`, model.limit.percentage]);
    }
  }
  for (const window of state.github?.windows ?? []) {
    samples.push([`github:${window.id}`, window.limit.percentage]);
  }
  for (const window of state.netlify?.windows ?? []) {
    samples.push([`netlify:${window.id}`, window.limit.percentage]);
  }
  return samples;
};

/* -------------------- Service -------------------- */

let stateQueue: Promise<unknown> = Promise.resolve();

export class UsageService {
  static async getUsageState(): Promise<UsageState> {
    const stored = await chrome.storage.local.get(STORAGE_KEYS.usageState);
    return (stored[STORAGE_KEYS.usageState] ?? {}) as UsageState;
  }

  static async saveUsageState(state: UsageState): Promise<void> {
    await chrome.storage.local.set({ [STORAGE_KEYS.usageState]: state });
  }

  /**
   * Fetch every provider and store the result. Unless `force` is set (a
   * refresh the user asked for, or a new token), GitHub and Netlify are only
   * fetched once their snapshot is `SLOW_REFRESH_MINUTES` old.
   */
  static async refreshAllUsage({ force = false } = {}): Promise<UsageState> {
    const [githubToken, netlifyToken, stored] = await Promise.all([
      GithubService.currentToken(),
      NetlifyService.currentToken(),
      this.getUsageState(),
    ]);
    // Half a minute of slack, so a 30-minute cadence is not pushed to 35 by
    // the 5-minute alarm firing a moment early.
    const due = (snapshot: { lastUpdated: number } | undefined, minutes: number) =>
      force || !snapshot || Date.now() - snapshot.lastUpdated >= minutes * 60_000 - 30_000;
    const [claude, codex, [github, apiLimit], netlify] = await Promise.all([
      this.fetchClaudeUsage().catch(() => null),
      this.fetchCodexUsage().catch(() => null),
      // The hourly API allowance is read every time (that read is free), and
      // after the billing calls so it counts them.
      (due(stored.github, SLOW_REFRESH_MINUTES.github)
        ? GithubService.fetchUsage(Date.now(), githubToken).catch(() => null)
        : Promise.resolve(null)
      ).then(
        async (usage) =>
          [usage, githubToken ? await GithubService.fetchRateLimit(githubToken) : null] as const,
      ),
      due(stored.netlify, SLOW_REFRESH_MINUTES.netlify)
        ? NetlifyService.fetchUsage(Date.now(), netlifyToken).catch(() => null)
        : null,
    ]);

    return this.updateUsageState(async (next) => {
      const previousGithub = next.github;
      const previousNetlify = next.netlify;
      if (claude) next.claude = claude;
      if (codex) next.codex = codex;
      // Read the tokens again rather than trusting the fetch: a sign-out, or a
      // different token saved, while this refresh was in flight must not have
      // the old token's snapshot stored.
      const [githubNow, netlifyNow] = await Promise.all([
        GithubService.currentToken(),
        NetlifyService.currentToken(),
      ]);
      if (!githubNow) delete next.github;
      else if (githubNow === githubToken) {
        if (github) next.github = carryBudgets(github, previousGithub);
        if (next.github && apiLimit) next.github.apiLimit = apiLimit;
      }
      if (!netlifyNow) delete next.netlify;
      else if (netlify && netlifyNow === netlifyToken)
        next.netlify = carryCredits(netlify, previousNetlify);

      try {
        await this.recordHistory(next);
      } catch (error) {
        console.debug('Failed to record usage history', error);
      }
    });
  }

  /**
   * Read, change and save the stored snapshot as one step. Refreshes and
   * sign-outs both rewrite it; queued here, neither can save over the other
   * with a copy read before the other's write.
   */
  static updateUsageState(
    change: (state: UsageState) => Promise<void> | void,
  ): Promise<UsageState> {
    const run = stateQueue
      .catch(() => undefined)
      .then(async () => {
        const state = await this.getUsageState();
        await change(state);
        await this.saveUsageState(state);
        return state;
      });
    stateQueue = run;
    return run;
  }

  /** Append the snapshot to the rolling history and prune anything stale. */
  static async recordHistory(state: UsageState): Promise<void> {
    const now = Date.now();
    const cutoff = now - HISTORY_MAX_AGE_MS;
    const stored = await chrome.storage.local.get(STORAGE_KEYS.usageHistory);
    const history = (stored[STORAGE_KEYS.usageHistory] ?? {}) as UsageHistory;

    for (const [key, percent] of historySamples(state)) {
      const kept = (history[key] ?? []).filter(([t]) => t >= cutoff);
      kept.push([now, percent]);
      history[key] = kept.slice(-HISTORY_MAX_SAMPLES);
    }

    for (const key of Object.keys(history)) {
      const kept = history[key].filter(([t]) => t >= cutoff);
      if (kept.length === 0) {
        delete history[key];
      } else {
        history[key] = kept;
      }
    }

    await chrome.storage.local.set({ [STORAGE_KEYS.usageHistory]: history });
  }

  static async fetchClaudeUsage(): Promise<ClaudeUsage | null> {
    const orgId = await this.resolveClaudeOrgId();
    if (!orgId) return null;

    const result = await fetchJson(ENDPOINTS.claudeUsage(orgId));
    if (!result.ok) {
      if (result.status === 401 || result.status === 403) {
        await chrome.storage.local.remove(STORAGE_KEYS.claudeOrgId);
      }
      return null;
    }

    return buildClaudeUsage(result.data);
  }

  static async fetchCodexUsage(): Promise<CodexUsage | null> {
    const session = await this.fetchCodexSession();
    if (!session) return null;

    const headers: Record<string, string> = {
      Authorization: `Bearer ${session.accessToken}`,
      // Match the current ChatGPT usage client's explicit application context.
      'OAI-App-Brand': 'chatgpt',
    };
    if (session.accountId) {
      headers['ChatGPT-Account-Id'] = session.accountId;
    }

    const result = await fetchJson(ENDPOINTS.codexUsage, { headers, cache: 'no-store' });
    if (!result.ok) return null;

    const usage = buildCodexUsage(result.data);
    if (!usage) return null;

    usage.diagnostics = {
      requestAccountFingerprint: await accountFingerprint(session.accountId),
      responseAccountFingerprint: await accountFingerprint(readString(result.data.account_id)),
    };

    // The expiry dates live on a separate endpoint; a failure there must not
    // cost us the usage snapshot itself. Leaving `resets` unset on failure
    // marks the details as unknown, so the card falls back to the count.
    const credits = await fetchJson(ENDPOINTS.codexResetCredits, {
      headers,
      cache: 'no-store',
    }).catch(() => null);
    if (credits?.ok) usage.resets = buildCodexResets(credits.data);
    return usage;
  }

  private static async fetchCodexSession(): Promise<CodexSessionInfo | null> {
    const payload = await fetchJsonRaw(ENDPOINTS.codexSession, { cache: 'no-store' });
    if (!isObject(payload)) return null;

    const accessToken = readString(payload.accessToken);
    if (!accessToken) return null;

    return { accessToken, accountId: accountIdFromSession(payload) };
  }

  private static async resolveClaudeOrgId(): Promise<string | null> {
    const cached = await chrome.storage.local.get(STORAGE_KEYS.claudeOrgId);
    const stored = readString(cached[STORAGE_KEYS.claudeOrgId]);
    if (stored) return stored;

    const fromCookie = await this.claudeOrgFromCookie();
    if (fromCookie) {
      await chrome.storage.local.set({ [STORAGE_KEYS.claudeOrgId]: fromCookie });
      return fromCookie;
    }

    const orgs = await fetchJsonRaw(ENDPOINTS.claudeOrgs);
    const fromApi = resolveOrgFromList(orgs);
    if (fromApi) {
      await chrome.storage.local.set({ [STORAGE_KEYS.claudeOrgId]: fromApi });
    }
    return fromApi;
  }

  private static async claudeOrgFromCookie(): Promise<string | null> {
    try {
      const cookie = await chrome.cookies.get({
        url: 'https://claude.ai',
        name: 'lastActiveOrg',
      });
      const value = cookie?.value;
      return value ? decodeURIComponent(value) : null;
    } catch {
      return null;
    }
  }
}
