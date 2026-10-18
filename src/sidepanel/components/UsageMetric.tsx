import React from 'react';
import { msg } from '../../shared/i18n';
import { paceFromLimit } from '../../shared/pace';
import type { UsageLimit } from '../../shared/types';
import { formatCount, formatDuration, formatReset } from '../../shared/utils';
import { ProgressBar } from './ProgressBar';

interface UsageMetricProps {
  label: string;
  limit: UsageLimit;
  /** Reset of a sibling window folded into this row. */
  secondaryResetsAt?: string | null;
  /** False when a heading above already says when this row resets. */
  showReset?: boolean;
  now: number;
}

/** A labelled progress bar plus its "used / limit · elapsed · resets" caption. */
export const UsageMetric: React.FC<UsageMetricProps> = ({
  label,
  limit,
  secondaryResetsAt,
  showReset = true,
  now,
}) => {
  const hasCount =
    typeof limit.used === 'number' && typeof limit.limit === 'number' && limit.limit > 0;
  const pace = paceFromLimit(limit, now);

  return (
    <div className="au-metric">
      <ProgressBar label={label} percentage={limit.percentage} pace={pace} />
      <p className="au-meta">
        {[
          hasCount && <span key="count">{formatCount(limit)}</span>,
          pace && msg('paceElapsedLabel', String(pace.elapsedPct)),
          showReset &&
            msg('resetsLabel', formatReset(limit.resetsAt, now)) +
              (secondaryResetsAt ? ` / ${formatReset(secondaryResetsAt, now)}` : ''),
        ]
          .filter(Boolean)
          .flatMap((part, index) => (index === 0 ? [part] : [' · ', part]))}
      </p>
      {pace && pace.projectedEarlyMs !== null && (
        <p className="au-projection">
          {msg('paceProjectionLabel', formatDuration(pace.projectedEarlyMs))}
        </p>
      )}
    </div>
  );
};
