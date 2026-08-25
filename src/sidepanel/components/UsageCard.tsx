import React from 'react';

interface UsageCardProps {
  title: string;
  subtitle?: string;
  iconSrc?: string;
  iconAlt?: string;
  /** Optional element pinned to the right edge of the header (e.g. binding chip). */
  headerExtra?: React.ReactNode;
  children: React.ReactNode;
}

/** Presentational shell for a single provider's usage panel. */
export const UsageCard: React.FC<UsageCardProps> = ({
  title,
  subtitle,
  iconSrc,
  iconAlt,
  headerExtra,
  children,
}) => {
  return (
    <section className="au-card">
      <header className="au-card__header">
        {iconSrc && <img className="au-brand" src={iconSrc} alt={iconAlt ?? `${title} logo`} />}
        <div className="au-card__heading">
          <h2 className="au-card__title">{title}</h2>
          {subtitle && <p className="au-card__subtitle">{subtitle}</p>}
        </div>
        {headerExtra}
      </header>
      <div className="au-card__body">{children}</div>
    </section>
  );
};
