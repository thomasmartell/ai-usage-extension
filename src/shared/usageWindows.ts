import { WINDOW_MS } from './constants';
import { msg } from './i18n';
import { paceFromLimit } from './pace';
import type { ClaudeUsage, CodexUsage, ModelUsage, UsageLimit } from './types';

export type ProviderUsage = ClaudeUsage | CodexUsage;

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
 * Return the provider-level limits shown in the popup, overlay, and badge.
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
const splitLabel = (label: string): { base: string; tag: string | null } => {
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
 * Order rows by which limit bites first: anything projected to run out
 * before its reset leads (soonest projected runout first), then everything
 * else by how full it is. The first row is the card's binding limit.
 */
export const sortByRisk = (rows: ModelUsage[], now: number): ModelUsage[] => {
  const runoutAt = (row: ModelUsage): number => {
    const pace = paceFromLimit(row.limit, now);
    if (!pace || pace.projectedEarlyMs === null || !row.limit.resetsAt) {
      return Number.POSITIVE_INFINITY;
    }
    return new Date(row.limit.resetsAt).getTime() - pace.projectedEarlyMs;
  };

  return [...rows].sort((a, b) => {
    const aRunout = runoutAt(a);
    const bRunout = runoutAt(b);
    // Strict comparison, not subtraction: both sides are Infinity for
    // limits that outlast their window, and Infinity - Infinity is NaN.
    if (aRunout !== bRunout) return aRunout < bRunout ? -1 : 1;
    return b.limit.percentage - a.limit.percentage;
  });
};

export const highestUsageWindow = (usage: ProviderUsage): ModelUsage | null => {
  const windows = getUsageWindows(usage);
  if (windows.length === 0) return null;

  return windows.reduce((highest, current) =>
    current.limit.percentage > highest.limit.percentage ? current : highest,
  );
};
