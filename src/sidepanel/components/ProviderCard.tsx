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
import type { ModelUsage } from '../../shared/types';
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
 *  the model breakdown rows (e.g. Fable) beneath a divider. Rows under an
 *  account or team heading are sorted within it, so each group stays whole. */
const cardRows = (usage: ProviderUsage) => {
  const windows = getUsageWindows(usage);
  const groupOrder = new Map<string | undefined, number>();
  windows.forEach((row) => {
    if (!groupOrder.has(row.group)) groupOrder.set(row.group, groupOrder.size);
  });
  return {
    windows: [...windows].sort(
      (a, b) =>
        (groupOrder.get(a.group) ?? 0) - (groupOrder.get(b.group) ?? 0) ||
        (b.limit.windowMs ?? -1) - (a.limit.windowMs ?? -1),
    ),
    models: groupQuietModels(usage.models.map(withInferredWindow)),
  };
};

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

/**
 * Budgets (spending caps in USD) sit two abreast: each is one short line,
 * and pairing them keeps the cards short enough for the 2×2 popup.
 */
const pairBudgets = (rows: ModelUsage[]): Array<ModelUsage | [ModelUsage, ModelUsage]> => {
  const items: Array<ModelUsage | [ModelUsage, ModelUsage]> = [];
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const next = rows[index + 1];
    const isBudget = (candidate?: ModelUsage) => candidate?.limit.unit === 'usd';
    if (isBudget(row) && isBudget(next) && next!.group === row.group) {
      items.push([row, next!]);
      index += 1;
    } else {
      items.push(row);
    }
  }
  return items;
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
  // Without account headings (Claude, Codex), the longest window leads on its
  // own and the shorter ones, like the 5-hour session and per-model limits,
  // sit two abreast beneath it as the less pressing figures.
  const minor = windows.some((row) => row.group) ? [] : [...windows.slice(1), ...models];
  // A provider reporting only model limits has no lead row: it keeps the plain layout.
  const pairMinor = windows.length > 0 && minor.length >= 2;
  // GitHub's hourly API allowance, until the hour it describes has passed.
  const apiLimit =
    usage && !loading && 'accounts' in usage && usage.apiLimit?.resetsAt
      ? Date.parse(usage.apiLimit.resetsAt) > now
        ? usage.apiLimit
        : null
      : null;
  const lead = usage && !loading ? leadFigure(usage) : null;

  const metric = (row: (typeof windows)[number]) => (
    <UsageMetric
      key={row.id}
      label={row.label}
      limit={row.limit}
      secondaryResetsAt={row.secondaryResetsAt}
      showReset={!row.group}
      now={now}
    />
  );

  const renderRows = (rows: typeof windows) =>
    pairBudgets(rows).map((item, index, items) => {
      const first = Array.isArray(item) ? item[0] : item;
      const previous = items[index - 1];
      const previousGroup = (Array.isArray(previous) ? previous[0] : previous)?.group;
      return (
        <React.Fragment key={first.id}>
          {first.group && first.group !== previousGroup && (
            <p className="au-group">
              <span>{first.group}</span>
              {first.limit.resetsAt && (
                <span>{msg('nextResetLabel', formatExpiryDate(first.limit.resetsAt))}</span>
              )}
            </p>
          )}
          {Array.isArray(item) ? <div className="au-pair">{item.map(metric)}</div> : metric(item)}
        </React.Fragment>
      );
    });

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
          {pairMinor ? (
            <>
              {metric(windows[0])}
              {Array.from({ length: Math.ceil(minor.length / 2) }, (_, index) => {
                const pair = minor.slice(index * 2, index * 2 + 2);
                return pair.length === 2 ? (
                  <div className="au-pair" key={pair[0].id}>
                    {pair.map(metric)}
                  </div>
                ) : (
                  metric(pair[0])
                );
              })}
            </>
          ) : (
            <>
              {renderRows(windows)}
              {models.length > 0 && windows.length > 0 && <hr className="au-divider" />}
              {renderRows(models)}
            </>
          )}
          {apiLimit && (
            <>
              <hr className="au-divider" />
              {metric({ id: 'github-api', label: msg('githubApiCalls'), limit: apiLimit })}
            </>
          )}
          <ResetList usage={usage} />
        </>
      ) : (
        <p className="au-empty">{emptyHint}</p>
      )}
      {footer}
    </UsageCard>
  );
};
