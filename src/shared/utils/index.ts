import { USAGE_THRESHOLDS } from '../constants';
import { msg } from '../i18n';
import type { UsageLimit, UsageStatus } from '../types';

/** @deprecated kept as an alias — prefer `UsageStatus` from shared/types. */
export type UsageTone = UsageStatus;

/** Round a number into the inclusive 0–100 range. */
export const clampPercent = (value: number): number =>
  Math.max(0, Math.min(100, Math.round(value)));

/** Map a usage percentage to its severity tone. */
export const getUsageTone = (value: number): UsageStatus => {
  const percent = clampPercent(value);

  if (percent >= USAGE_THRESHOLDS.critical) {
    return 'critical';
  }

  if (percent >= USAGE_THRESHOLDS.warning) {
    return 'warning';
  }

  return 'ok';
};

/**
 * Human-readable span of time.
 * Returns e.g. `3d 1h`, `2h 13m`, `45m`.
 */
export const formatDuration = (ms: number): string => {
  const totalMinutes = Math.floor(Math.max(0, ms) / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours >= 24) {
    const days = Math.floor(hours / 24);
    return `${days}${msg('timeDayShort')} ${hours % 24}${msg('timeHourShort')}`;
  }

  if (hours > 0) {
    return `${hours}${msg('timeHourShort')} ${minutes}${msg('timeMinuteShort')}`;
  }

  return `${minutes}${msg('timeMinuteShort')}`;
};

/**
 * Human-readable countdown to a reset timestamp.
 * Returns e.g. `2h 13m`, `45m`, `now`, or `unknown`.
 */
export const formatReset = (resetAt: string | null, now: number): string => {
  if (!resetAt) {
    return msg('timeUnknown');
  }

  const diff = new Date(resetAt).getTime() - now;
  if (!Number.isFinite(diff)) {
    return msg('timeUnknown');
  }

  if (diff <= 0) {
    return msg('timeNow');
  }

  return formatDuration(diff);
};

/**
 * Short calendar date for when a reset credit lapses, e.g. `22 Oct`.
 * Returns `unknown` when the provider gave no usable date.
 */
export const formatExpiryDate = (expiresAt: string | null): string => {
  if (!expiresAt) {
    return msg('timeUnknown');
  }

  const date = new Date(expiresAt);
  if (!Number.isFinite(date.getTime())) {
    return msg('timeUnknown');
  }

  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
};

/**
 * Human-readable "time since" label for a past timestamp.
 * Returns e.g. `just now`, `5m ago`, `3h ago`.
 */
export const formatRelativeTime = (timestamp: number, now: number): string => {
  const minutes = Math.floor(Math.max(0, now - timestamp) / 60_000);

  if (minutes < 1) {
    return msg('timeJustNow');
  }

  if (minutes < 60) {
    return msg('timeAgo', `${minutes}${msg('timeMinuteShort')}`);
  }

  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return msg('timeAgo', `${hours}${msg('timeHourShort')}`);
  }

  return msg('timeAgo', `${Math.floor(hours / 24)}${msg('timeDayShort')}`);
};

/** `used / limit` in the limit's unit, e.g. `18,249 / 50,000 min` or `$12.40 / $50.00`. */
export const formatCount = ({ used = 0, limit = 0, unit }: UsageLimit): string => {
  if (unit === 'usd') {
    const usd = new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: 'USD',
      currencyDisplay: 'narrowSymbol',
      // Whole budgets read as `$50`; spend keeps its cents.
      minimumFractionDigits: Number.isInteger(used) && Number.isInteger(limit) ? 0 : 2,
    });
    return `${usd.format(used)} / ${usd.format(limit)}`;
  }

  if (unit === 'gb') {
    const gb = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 });
    return msg('unitGigabytes', [gb.format(used), gb.format(limit)]);
  }

  if (unit === 'minutes') {
    const count = new Intl.NumberFormat(undefined);
    return msg('unitMinutes', [count.format(used), count.format(limit)]);
  }

  return `${used} / ${limit}`;
};
