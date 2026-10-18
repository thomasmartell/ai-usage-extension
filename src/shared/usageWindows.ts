import { WINDOW_MS } from './constants';
import { msg } from './i18n';
import type {
  ClaudeUsage,
  CodexUsage,
  GithubUsage,
  ModelUsage,
  NetlifyUsage,
  UsageLimit,
} from './types';

export type ProviderUsage = ClaudeUsage | CodexUsage | GithubUsage | NetlifyUsage;

/**
 * Claude's two provider windows are fixed at 5h and 7d, so snapshots written
 * before the window length was stored can still be paced.
 */
const withWindow = (limit: UsageLimit, windowMs: number): UsageLimit =>
  limit.windowMs === undefined ? { ...limit, windowMs } : limit;

/** Window lengths recoverable from the `· 5h` / `· 7d` style label tags. */
const TAG_WINDOW_MS: Record<string, number> = {
  '5h': WINDOW_MS.fiveHours,
  '1d': 24 * 60 * 60 * 1000,
  '7d': WINDOW_MS.sevenDays,
  '30d': 30 * 24 * 60 * 60 * 1000,
  '1y': 365 * 24 * 60 * 60 * 1000,
};

/**
 * Backfill `windowMs` on rows stored without one — snapshots written by an
 * older background worker would otherwise render with no pace at all. The
 * length is recovered from the id's trailing duration segment (Codex ids end
 * in the window's seconds) or, failing that, the label's short tag.
 */
export const withInferredWindow = (model: ModelUsage): ModelUsage => {
  if (model.limit.windowMs !== undefined) return model;

  const idSeconds = Number(model.id.split(':').pop());
  if (Number.isFinite(idSeconds) && idSeconds > 0) {
    return { ...model, limit: { ...model.limit, windowMs: idSeconds * 1000 } };
  }

  const tag = model.label.split('·').pop()?.trim() ?? '';
  const windowMs = TAG_WINDOW_MS[tag];
  return windowMs === undefined ? model : { ...model, limit: { ...model.limit, windowMs } };
};

/**
 * Return the provider-level limits shown in the popup and badge.
 *
 * Codex windows are dynamic because the backend can return one or more periods
 * in either the primary or secondary slot. The legacy fallback keeps snapshots
 * written by earlier extension versions readable until the next refresh.
 */
export const getUsageWindows = (usage: ProviderUsage): ModelUsage[] => {
  if ('plan' in usage) {
    return [
      {
        id: 'session',
        label: msg('sessionLimit'),
        limit: withWindow(usage.session, WINDOW_MS.fiveHours),
      },
      {
        id: 'weekly',
        label: msg('weeklyLimit'),
        limit: withWindow(usage.weekly, WINDOW_MS.sevenDays),
      },
    ];
  }

  if ('accounts' in usage || 'teams' in usage) {
    return usage.windows;
  }

  if (Array.isArray(usage.windows)) {
    return usage.windows.map(withInferredWindow);
  }

  const legacy: ModelUsage[] = [];
  if (usage.session) {
    legacy.push({
      id: 'legacy-session',
      label: msg('sessionLimit'),
      limit: withWindow(usage.session, WINDOW_MS.fiveHours),
    });
  }
  if (usage.weekly) {
    legacy.push({
      id: 'legacy-weekly',
      label: msg('weeklyLimit'),
      limit: withWindow(usage.weekly, WINDOW_MS.sevenDays),
    });
  }
  return legacy;
};

/** Split "GPT 5.3 Codex Spark · 5h" into its base label and window tag. */
export const splitLabel = (label: string): { base: string; tag: string | null } => {
  const at = label.lastIndexOf(' · ');
  if (at === -1) return { base: label, tag: null };
  return { base: label.slice(0, at), tag: label.slice(at + 3) };
};

/**
 * Fold sibling windows of an untouched limit (every window under 1% used)
 * into one row — "Spark · 5h / 7d" — so quiet meters don't eat panel height.
 * The soonest-resetting window drives the row's meter and pace; the sibling
 * keeps its reset visible via `secondaryResetsAt`. Rows split back out on
 * their own as soon as any window carries real usage.
 */
export const groupQuietModels = (models: ModelUsage[]): ModelUsage[] => {
  const byBase = new Map<string, ModelUsage[]>();
  for (const model of models) {
    const { base } = splitLabel(model.label);
    const group = byBase.get(base);
    if (group) {
      group.push(model);
    } else {
      byBase.set(base, [model]);
    }
  }

  const grouped: ModelUsage[] = [];
  for (const [base, group] of byBase) {
    const quiet = group.length > 1 && group.every((m) => m.limit.percentage < 1);
    if (!quiet) {
      grouped.push(...group);
      continue;
    }

    const ordered = [...group].sort(
      (a, b) => (a.limit.windowMs ?? Infinity) - (b.limit.windowMs ?? Infinity),
    );
    const [primary, ...rest] = ordered;
    const tags = ordered.map((m) => splitLabel(m.label).tag).filter(Boolean);
    grouped.push({
      id: primary.id,
      label: tags.length === ordered.length ? `${base} · ${tags.join(' / ')}` : base,
      limit: primary.limit,
      secondaryResetsAt: rest[0]?.limit.resetsAt ?? null,
    });
  }
  return grouped;
};

/**
 * Order rows shortest window first (5h before 7d), unknown lengths last.
 * The sort is stable, so rows with equal windows keep their given order.
 */
export const sortByWindow = (rows: ModelUsage[]): ModelUsage[] =>
  [...rows].sort((a, b) => (a.limit.windowMs ?? Infinity) - (b.limit.windowMs ?? Infinity));

export const highestUsageWindow = (usage: ProviderUsage): ModelUsage | null => {
  const windows = getUsageWindows(usage);
  if (windows.length === 0) return null;

  return windows.reduce((highest, current) =>
    current.limit.percentage > highest.limit.percentage ? current : highest,
  );
};

/**
 * The fullest limit a provider reports, model rows included (a model can
 * run hotter than the provider's own windows).
 */
export const peakUsage = (usage: ProviderUsage): ModelUsage | null => {
  const rows = [...getUsageWindows(usage), ...usage.models];
  if (rows.length === 0) return null;

  return rows.reduce((peak, row) => (row.limit.percentage > peak.limit.percentage ? row : peak));
};

/**
 * The row a provider leads with, on its card and in the toolbar icon: its
 * weekly limit when it has one, otherwise its fullest row that resets
 * (GitHub's are monthly; Netlify's add-on credits never reset, so the
 * cycle's plan credits lead instead), otherwise its fullest row.
 */
export const leadUsage = (usage: ProviderUsage): { row: ModelUsage; weekly: boolean } | null => {
  const windows = getUsageWindows(usage);
  const weekly = windows.find((window) => window.limit.windowMs === WINDOW_MS.sevenDays);
  if (weekly) return { row: weekly, weekly: true };

  const resetting = windows.filter((row) => row.limit.resetsAt);
  const row =
    resetting.length > 0
      ? resetting.reduce((a, b) => (b.limit.percentage > a.limit.percentage ? b : a))
      : peakUsage(usage);
  return row ? { row, weekly: false } : null;
};
