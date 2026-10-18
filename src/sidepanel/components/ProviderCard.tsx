import React from 'react';
import { msg } from '../../shared/i18n';
import { formatExpiryDate, formatRelativeTime } from '../../shared/utils';
import {
  getUsageWindows,
  groupQuietModels,
  sortByWindow,
  withInferredWindow,
  type ProviderUsage,
} from '../../shared/usageWindows';
import { UsageCard } from './UsageCard';
import { UsageMetric } from './UsageMetric';

interface ProviderCardProps {
  title: string;
  iconSrc: string;
  iconAlt: string;
  usage?: ProviderUsage;
  loading: boolean;
  now: number;
  /** Hint shown when the provider has no snapshot yet. */
  emptyHint: string;
  /** Optional content pinned to the bottom of the card (e.g. a setting). */
  footer?: React.ReactNode;
}

const Skeleton: React.FC = () => (
  <div className="au-loader" aria-hidden="true">
    <div className="au-loader__line au-loader__line--w80" />
    <div className="au-loader__bar" />
    <div className="au-loader__line au-loader__line--w60" />
  </div>
);

/** Every limit the card shows: provider windows shortest first (5h, then
 *  weekly), followed by the model breakdown rows (e.g. Fable). */
const cardRows = (usage: ProviderUsage) => [
  ...sortByWindow(getUsageWindows(usage)),
  ...groupQuietModels(usage.models.map(withInferredWindow)),
];

/** Renders one provider's usage, handling loading / empty / data states. */
export const ProviderCard: React.FC<ProviderCardProps> = ({
  title,
  iconSrc,
  iconAlt,
  usage,
  loading,
  now,
  emptyHint,
  footer,
}) => {
  const subtitle = loading
    ? msg('loadingSnapshot')
    : usage
      ? msg('updated', formatRelativeTime(usage.lastUpdated, now))
      : msg('notConnected');

  const rows = usage && !loading ? cardRows(usage) : [];
  const resets = usage && 'resets' in usage ? usage.resets : undefined;

  return (
    <UsageCard title={title} subtitle={subtitle} iconSrc={iconSrc} iconAlt={iconAlt}>
      {loading ? (
        <Skeleton />
      ) : usage ? (
        <>
          {rows.map((row) => (
            <UsageMetric
              key={row.id}
              label={row.label}
              limit={row.limit}
              secondaryResetsAt={row.secondaryResetsAt}
              now={now}
            />
          ))}
          {'plan' in usage && usage.plan !== 'unknown' && (
            <p className="au-footnote">{msg('planLabel', usage.plan)}</p>
          )}
          {resets?.map((reset) => (
            <p key={reset.id} className="au-footnote">
              {msg('resetExpiresLabel', [reset.label, formatExpiryDate(reset.expiresAt)])}
            </p>
          ))}
          {resets === undefined &&
            'availableResets' in usage &&
            usage.availableResets !== null &&
            usage.availableResets > 0 && (
              <p className="au-footnote">
                {msg('availableResetsLabel', String(usage.availableResets))}
              </p>
            )}
        </>
      ) : (
        <p className="au-empty">{emptyHint}</p>
      )}
      {footer}
    </UsageCard>
  );
};
