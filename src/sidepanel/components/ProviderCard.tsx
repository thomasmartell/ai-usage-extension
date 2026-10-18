import React from 'react';
import { msg } from '../../shared/i18n';
import {
  clampPercent,
  formatExpiryDate,
  formatRelativeTime,
  getUsageTone,
} from '../../shared/utils';
import {
  getUsageWindows,
  groupQuietModels,
  leadUsage,
  withInferredWindow,
  type ProviderUsage,
} from '../../shared/usageWindows';
import { UsageCard } from './UsageCard';
import { UsageMetric } from './UsageMetric';

const STALE_AFTER_MS = 15 * 60 * 1000;

interface ProviderCardProps {
  title: string;
  iconSrc: string;
  iconAlt: string;
  /** The provider's own usage page, linked from the card title. */
  href?: string;
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

/** Provider windows longest first (weekly before the 5h session, since the
 *  weekly limits matter most; rows with no window, like budgets, last), then
 *  the model breakdown rows (e.g. Fable) beneath a divider. */
const cardRows = (usage: ProviderUsage) => ({
  windows: [...getUsageWindows(usage)].sort(
    (a, b) => (b.limit.windowMs ?? -1) - (a.limit.windowMs ?? -1),
  ),
  models: groupQuietModels(usage.models.map(withInferredWindow)),
});

/** The figure a card leads with: see `leadUsage`. */
const leadFigure = (usage: ProviderUsage): { percent: number; caption: string } | null => {
  const lead = leadUsage(usage);
  if (!lead) return null;
  return {
    percent: clampPercent(lead.row.limit.percentage),
    caption: lead.weekly
      ? msg('weeklyShort')
      : 'accounts' in usage
        ? msg('monthShort')
        : 'teams' in usage
          ? msg('cycleShort')
          : '',
  };
};

/** Reset credits the provider has granted, soonest-expiring first. */
const ResetList: React.FC<{ usage: ProviderUsage }> = ({ usage }) => {
  const resets = 'resets' in usage ? usage.resets : undefined;
  const legacyCount =
    resets === undefined && 'availableResets' in usage ? (usage.availableResets ?? 0) : 0;

  if (resets?.length) {
    const ordered = [...resets].sort(
      (a, b) =>
        new Date(a.expiresAt ?? Infinity).getTime() - new Date(b.expiresAt ?? Infinity).getTime(),
    );
    return (
      <div className="au-resets">
        <p className="au-resets__title">{msg('resetsHeading', String(resets.length))}</p>
        <ul className="au-resets__list">
          {ordered.map((reset) => (
            <li key={reset.id}>
              <span>{reset.label}</span>
              <span>{msg('expiresLabel', formatExpiryDate(reset.expiresAt))}</span>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  if (legacyCount > 0) {
    return (
      <div className="au-resets">
        <p className="au-resets__title">{msg('resetsHeading', String(legacyCount))}</p>
      </div>
    );
  }

  return null;
};

/** Renders one provider's usage, handling loading / empty / data states. */
export const ProviderCard: React.FC<ProviderCardProps> = ({
  title,
  iconSrc,
  iconAlt,
  href,
  usage,
  loading,
  now,
  emptyHint,
  footer,
}) => {
  // The header already says when data was fetched; a card only repeats it
  // when its own snapshot has fallen behind.
  const subtitle = loading
    ? msg('loadingSnapshot')
    : !usage
      ? msg('notConnected')
      : now - usage.lastUpdated > STALE_AFTER_MS
        ? msg('updated', formatRelativeTime(usage.lastUpdated, now))
        : undefined;

  const { windows, models } = usage && !loading ? cardRows(usage) : { windows: [], models: [] };
  const lead = usage && !loading ? leadFigure(usage) : null;

  const renderRows = (rows: typeof windows) =>
    rows.map((row, index) => (
      <React.Fragment key={row.id}>
        {row.group && row.group !== rows[index - 1]?.group && (
          <p className="au-group">
            <span>{row.group}</span>
            {row.limit.resetsAt && (
              <span>{msg('nextResetLabel', formatExpiryDate(row.limit.resetsAt))}</span>
            )}
          </p>
        )}
        <UsageMetric
          label={row.label}
          limit={row.limit}
          secondaryResetsAt={row.secondaryResetsAt}
          showReset={!row.group}
          now={now}
        />
      </React.Fragment>
    ));

  return (
    <UsageCard
      title={title}
      subtitle={subtitle}
      iconSrc={iconSrc}
      iconAlt={iconAlt}
      href={href}
      aside={
        lead && (
          <span className={`au-card__peak au-card__peak--${getUsageTone(lead.percent)}`}>
            <span>
              {lead.percent}
              <small>%</small>
            </span>
            {lead.caption && <span className="au-card__peak-caption">{lead.caption}</span>}
          </span>
        )
      }
    >
      {loading ? (
        <Skeleton />
      ) : usage ? (
        <>
          {renderRows(windows)}
          {models.length > 0 && windows.length > 0 && <hr className="au-divider" />}
          {renderRows(models)}
          <ResetList usage={usage} />
        </>
      ) : (
        <p className="au-empty">{emptyHint}</p>
      )}
      {footer}
    </UsageCard>
  );
};
