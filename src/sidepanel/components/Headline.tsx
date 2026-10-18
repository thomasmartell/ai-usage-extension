import React from 'react';
import { USAGE_THRESHOLDS } from '../../shared/constants';
import { msg } from '../../shared/i18n';
import type { UsageState } from '../../shared/types';
import { peakUsage, splitLabel } from '../../shared/usageWindows';
import { clampPercent, formatRelativeTime, formatReset, getUsageTone } from '../../shared/utils';

const PROVIDERS = [
  ['claude', 'Claude'],
  ['codex', 'Codex'],
  ['github', 'GitHub'],
] as const;

interface HeadlineProps {
  usage: UsageState;
  now: number;
}

/** The one limit worth knowing about first, plus when the data was fetched. */
export const Headline: React.FC<HeadlineProps> = ({ usage, now }) => {
  const peaks = PROVIDERS.flatMap(([id, title]) => {
    const provider = usage[id];
    const peak = provider ? peakUsage(provider) : null;
    return peak ? [{ title, peak, lastUpdated: provider!.lastUpdated }] : [];
  });

  if (peaks.length === 0) {
    return <p className="au-headline__title">{msg('popupTitle')}</p>;
  }

  const top = peaks.reduce((a, b) => (b.peak.limit.percentage > a.peak.limit.percentage ? b : a));
  const percent = clampPercent(top.peak.limit.percentage);
  const tone = getUsageTone(percent);
  const name = `${top.title} ${splitLabel(top.peak.label).base}`;
  const updated = Math.max(...peaks.map((entry) => entry.lastUpdated));

  return (
    <div className="au-headline">
      <p className={`au-headline__title au-headline__title--${tone}`}>
        {percent >= 100
          ? msg('headlineHit', name)
          : percent >= USAGE_THRESHOLDS.warning
            ? msg('headlineWatch', [name, String(percent)])
            : msg('headlineClear')}
      </p>
      <p className="au-headline__meta">
        {percent >= USAGE_THRESHOLDS.warning
          ? msg('resetsLabel', formatReset(top.peak.limit.resetsAt, now))
          : msg('headlineHighest', [name, String(percent)])}
        {' · '}
        {msg('updated', formatRelativeTime(updated, now))}
      </p>
    </div>
  );
};
