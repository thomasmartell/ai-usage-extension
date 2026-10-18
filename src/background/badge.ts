import { USAGE_THRESHOLDS } from '../shared/constants';
import { msg } from '../shared/i18n';
import type { ProviderId, UsageState } from '../shared/types';
import { clampPercent } from '../shared/utils';
import { leadUsage } from '../shared/usageWindows';

const iconPath = (range: number): string => `icons/badges/range-${range}.png`;

const ICON_SIZES = [16, 32, 48, 128] as const;
type IconSize = (typeof ICON_SIZES)[number];
type ActionIconData = Record<IconSize, ImageData>;

const loadIconData = async (range: number, size: IconSize): Promise<[IconSize, ImageData]> => {
  const response = await fetch(chrome.runtime.getURL(iconPath(range)));
  if (!response.ok) {
    throw new Error(`Unable to load badge icon for ${range}%`);
  }

  const canvas = new OffscreenCanvas(size, size);
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('Unable to render badge icon');
  }

  const bitmap = await createImageBitmap(await response.blob());
  try {
    context.drawImage(bitmap, 0, 0, size, size);
    return [size, context.getImageData(0, 0, size, size)];
  } finally {
    bitmap.close();
  }
};

const actionIconData = async (range: number): Promise<ActionIconData> =>
  Object.fromEntries(
    await Promise.all(ICON_SIZES.map((size) => loadIconData(range, size))),
  ) as ActionIconData;

const setActionIcon = async (range: number): Promise<void> => {
  await chrome.action.setIcon({ imageData: await actionIconData(range) });
};

/* -------------------- Bar icon -------------------- */

const ICON_COLORS = {
  tile: '#1d1c19',
  track: '#3b3934',
  ok: '#7fc48f',
  warning: '#e0a458',
  critical: '#e0705a',
} as const;

const barColor = (percent: number): string =>
  percent >= USAGE_THRESHOLDS.critical
    ? ICON_COLORS.critical
    : percent >= USAGE_THRESHOLDS.warning
      ? ICON_COLORS.warning
      : ICON_COLORS.ok;

export interface BarRect {
  x: number;
  width: number;
  /** Top of the whole bar (its track) and of its filled part. */
  top: number;
  fillTop: number;
  bottom: number;
}

/**
 * Pixel-aligned geometry for one bar per provider inside a square icon of
 * `size`: bars share the width, fill upwards from the bottom, and any usage
 * above zero shows at least one pixel so a connected provider is visible.
 */
export const barLayout = (size: number, percents: number[]): BarRect[] => {
  const pad = Math.max(1, Math.round(size * 0.14));
  const gap = Math.max(1, Math.round(size / 16));
  const count = percents.length;
  // Shared width, capped so two or three bars still read as bars.
  const width = Math.max(
    1,
    Math.min(Math.round(size * 0.2), Math.floor((size - pad * 2 - gap * (count - 1)) / count)),
  );
  const left = Math.floor((size - (width * count + gap * (count - 1))) / 2);
  const top = pad;
  const bottom = size - pad;
  const height = bottom - top;
  return percents.map((percent, index) => {
    const filled = Math.round((height * clampPercent(percent)) / 100);
    return {
      x: left + index * (width + gap),
      width,
      top,
      fillTop: bottom - (percent > 0 ? Math.max(1, filled) : 0),
      bottom,
    };
  });
};

const drawBars = (size: IconSize, percents: number[]): ImageData => {
  const canvas = new OffscreenCanvas(size, size);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Unable to render badge icon');

  context.fillStyle = ICON_COLORS.tile;
  context.beginPath();
  context.roundRect(0, 0, size, size, Math.round(size * 0.22));
  context.fill();

  barLayout(size, percents).forEach((bar, index) => {
    context.fillStyle = ICON_COLORS.track;
    context.fillRect(bar.x, bar.top, bar.width, bar.bottom - bar.top);
    context.fillStyle = barColor(percents[index]);
    context.fillRect(bar.x, bar.fillTop, bar.width, bar.bottom - bar.fillTop);
  });
  return context.getImageData(0, 0, size, size);
};

const setBarIcon = async (percents: number[]): Promise<void> => {
  const imageData = Object.fromEntries(
    ICON_SIZES.map((size) => [size, drawBars(size, percents)]),
  ) as ActionIconData;
  await chrome.action.setIcon({ imageData });
};

const PROVIDER_TITLE: Record<ProviderId, string> = {
  claude: 'Claude',
  codex: 'Codex',
  github: 'GitHub',
  netlify: 'Netlify',
};

interface UsageSummary {
  /** Each connected provider's lead figure, in card order. */
  percents: number[];
  tooltip: string;
}

/** The figure each card leads with, so the icon's bars match the popup. */
export const summarizeUsage = (state: UsageState): UsageSummary | null => {
  const rows: Array<{ provider: ProviderId; label: string; percent: number }> = [];

  (['claude', 'codex', 'github', 'netlify'] as const).forEach((provider) => {
    const usage = state[provider];
    if (!usage) return;
    const lead = leadUsage(usage);
    if (!lead) return;
    rows.push({
      provider,
      label: lead.row.label,
      percent: clampPercent(lead.row.limit.percentage),
    });
  });

  if (rows.length === 0) {
    return null;
  }

  const tooltip = [
    msg('appShortName'),
    ...rows.map(
      (row) =>
        `${PROVIDER_TITLE[row.provider]} · ${row.label} ${msg('percentUsed', String(row.percent))}`,
    ),
  ].join('\n');

  return { percents: rows.map((row) => row.percent), tooltip };
};

const resetBadge = async (): Promise<void> => {
  await Promise.all([
    setActionIcon(10),
    chrome.action.setBadgeText({ text: '' }),
    chrome.action.setTitle({ title: msg('appShortName') }),
  ]);
};

export const updateBadge = async (state: UsageState): Promise<void> => {
  const summary = summarizeUsage(state);
  if (!summary) {
    await resetBadge();
    return;
  }

  await Promise.all([
    setBarIcon(summary.percents),
    chrome.action.setBadgeText({ text: '' }),
    chrome.action.setTitle({ title: summary.tooltip }),
  ]);
};
