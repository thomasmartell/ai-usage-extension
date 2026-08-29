import type { UsageLimit } from './types';
import { clampPercent } from './utils';

/**
 * Pace compares how much of a limit has been spent against how much of its
 * window has elapsed, so a meter can say "banking time" or "burning fast"
 * instead of only "35% used".
 */

export type PaceTone = 'ahead' | 'neutral' | 'warning' | 'critical';

/** Percentage-point boundaries between the pace tones. */
export const PACE_THRESHOLDS = {
  /** |delta| under this reads as on pace. */
  neutral: 5,
  /** Above this the overspend is severe. */
  warning: 15,
  /** Above this we project when the limit runs out. */
  projection: 10,
  /** Share of the window that must have elapsed before a projection means anything. */
  minElapsedForProjection: 10,
} as const;

export interface PaceInput {
  /** Share of the limit already consumed, 0–100. */
  usedPct: number;
  /** Length of the usage window in ms, when the provider reports one. */
  windowMs?: number | null;
  /** Milliseconds left before the window resets. */
  msToReset?: number | null;
}

export interface Pace {
  /** Share of the window already elapsed, 0–100. */
  elapsedPct: number;
  /** `usedPct - elapsedPct`, in percentage points. Negative means under pace. */
  deltaPts: number;
  tone: PaceTone;
  /** Milliseconds before the reset the limit is projected to run out, if over pace. */
  projectedEarlyMs: number | null;
}

const paceTone = (deltaPts: number): PaceTone => {
  if (deltaPts <= -PACE_THRESHOLDS.neutral) return 'ahead';
  if (deltaPts > PACE_THRESHOLDS.warning) return 'critical';
  if (deltaPts >= PACE_THRESHOLDS.neutral) return 'warning';
  return 'neutral';
};

/**
 * Linear projection of when the limit runs out, expressed as the lead time
 * before the reset. Only meaningful while meaningfully over pace, and only
 * once enough of the window has elapsed for the rate to mean anything — a
 * burst in the first minutes of a window would otherwise project wildly.
 */
const projectEarlyMs = (
  usedPct: number,
  elapsedPct: number,
  deltaPts: number,
  windowMs: number,
): number | null => {
  if (deltaPts <= PACE_THRESHOLDS.projection) return null;
  if (usedPct <= 0 || elapsedPct < PACE_THRESHOLDS.minElapsedForProjection) return null;

  const elapsedAtLimit = (elapsedPct / usedPct) * 100;
  if (elapsedAtLimit >= 100) return null;

  return Math.round(((100 - elapsedAtLimit) / 100) * windowMs);
};

/**
 * Pace for one meter, or `null` when the window length or reset time is
 * unknown — callers should then omit the pace UI entirely.
 */
export const computePace = ({ usedPct, windowMs, msToReset }: PaceInput): Pace | null => {
  if (typeof windowMs !== 'number' || !Number.isFinite(windowMs) || windowMs <= 0) {
    return null;
  }

  if (typeof msToReset !== 'number' || !Number.isFinite(msToReset)) {
    return null;
  }

  const used = clampPercent(usedPct);
  const elapsedPct = clampPercent(((windowMs - msToReset) / windowMs) * 100);
  const deltaPts = used - elapsedPct;

  return {
    elapsedPct,
    deltaPts,
    tone: paceTone(deltaPts),
    projectedEarlyMs: projectEarlyMs(used, elapsedPct, deltaPts, windowMs),
  };
};

/** `computePace` fed from a stored `UsageLimit` and the current clock. */
export const paceFromLimit = (limit: UsageLimit, now: number): Pace | null => {
  if (!limit.resetsAt) {
    return null;
  }

  const resetsAt = new Date(limit.resetsAt).getTime();
  if (!Number.isFinite(resetsAt)) {
    return null;
  }

  return computePace({
    usedPct: limit.percentage,
    windowMs: limit.windowMs,
    msToReset: resetsAt - now,
  });
};

/** Signed percentage-point delta for display, e.g. `+18`, `−21`, `0`. */
export const formatPaceDelta = (deltaPts: number): string => {
  if (deltaPts > 0) return `+${deltaPts}`;
  if (deltaPts < 0) return `−${Math.abs(deltaPts)}`;
  return '0';
};
