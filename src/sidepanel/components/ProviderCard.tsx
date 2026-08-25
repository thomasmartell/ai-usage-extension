import React from 'react';
import { msg } from '../../shared/i18n';
import { formatRelativeTime, getUsageTone } from '../../shared/utils';
import {
  getUsageWindows,
  groupQuietModels,
  sortByRisk,
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

/** Every limit the card shows — provider windows and model breakdown rows
 *  merged into one list, riskiest first. */
const cardRows = (usage: ProviderUsage, now: number) =>
  sortByRisk(
    [...getUsageWindows(usage), ...groupQuietModels(usage.models.map(withInferredWindow))],
    now,
  );

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

  const rows = usage && !loading ? cardRows(usage, now) : [];
  const binding = rows.length > 1 ? rows[0] : null;

  return (
    <UsageCard
      title={title}
      subtitle={subtitle}
      iconSrc={iconSrc}
      iconAlt={iconAlt}
      headerExtra={
        binding && (
          <span className={`au-binding au-binding--${getUsageTone(binding.limit.percentage)}`}>
            {msg('bindingLabel', binding.label)}
          </span>
        )
      }
    >
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
          {'availableResets' in usage && usage.availableResets !== null && (
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
