import type { CodexUsage } from './types';

export const DIAGNOSTIC_BUILD = '2026-09-29.4';

export const accountFingerprint = async (accountId: string | null): Promise<string | null> => {
  if (!accountId) return null;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(accountId));
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 12);
};

const object = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const number = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

// Strict allowlist: never render raw responses, account IDs, tokens or session data.
export const codexDiagnostics = (usage?: CodexUsage) => {
  const raw = object(usage?.raw);
  const rate = object(raw.rate_limit);
  return {
    build: DIAGNOSTIC_BUILD,
    snapshotAt: number(usage?.lastUpdated),
    accounts: usage?.diagnostics ?? null,
    primary: windowSummary(rate.primary_window),
    secondary: windowSummary(rate.secondary_window),
    rendered: (usage?.windows ?? []).map(({ limit }) => ({
      percent: limit.percentage,
      windowSeconds: limit.windowMs === undefined ? null : limit.windowMs / 1000,
    })),
    resets: number(usage?.availableResets),
  };
};

const windowSummary = (value: unknown) => {
  if (value === null || value === undefined) return null;
  const window = object(value);
  return {
    rawPercent: number(window.used_percent),
    windowSeconds: number(window.limit_window_seconds),
    resetAt: number(window.reset_at),
  };
};
