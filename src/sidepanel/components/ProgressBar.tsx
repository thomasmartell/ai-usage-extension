import React from 'react';
import { msg } from '../../shared/i18n';
import { formatPaceDelta, type Pace } from '../../shared/pace';
import { clampPercent, getUsageTone } from '../../shared/utils';

interface ProgressBarProps {
  percentage: number;
  label: string;
  /** Pace against the window's elapsed time, when the window length is known. */
  pace?: Pace | null;
}

/**
 * Usage and time share one track: the fill is what's spent, the bright line
 * is *now*, and the region between them is either banked budget (a green
 * stripe behind the line) or overdraw (a hot segment past it). The pace chip
 * repeats the gap as a number.
 */
export const ProgressBar: React.FC<ProgressBarProps> = ({ percentage, label, pace }) => {
  const value = clampPercent(percentage);
  const tone = getUsageTone(value);
  const valueLabel = msg('percentUsed', String(value));

  const elapsed = pace ? pace.elapsedPct : null;
  const banked = elapsed !== null && elapsed > value;
  const overdrawn = elapsed !== null && value > elapsed;
  const overTone = pace?.tone === 'critical' ? 'critical' : 'warning';

  return (
    <div className="au-progress">
      <div className="au-progress__row">
        <span className="au-progress__label">{label}</span>
        <span className="au-progress__readout">
          <span className="au-progress__value">{valueLabel}</span>
          {pace && (
            <span className={`au-pace-chip au-pace-chip--${pace.tone}`}>
              {msg('paceDeltaLabel', formatPaceDelta(pace.deltaPts))}
            </span>
          )}
        </span>
      </div>
      <div
        className={`au-track au-track--${tone}`}
        role="progressbar"
        aria-label={label}
        aria-valuenow={value}
        aria-valuetext={valueLabel}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        {banked && (
          <span
            className="au-track__bank"
            style={{ left: `${value}%`, width: `${elapsed - value}%` }}
            aria-hidden="true"
          />
        )}
        <div
          className="au-track__fill"
          style={{ width: `${overdrawn ? elapsed : value}%` }}
        />
        {overdrawn && (
          <span
            className={`au-track__over au-track__over--${overTone}`}
            style={{ left: `${elapsed}%`, width: `${value - elapsed}%` }}
            aria-hidden="true"
          />
        )}
        {elapsed !== null && (
          <span
            className="au-track__now"
            style={{ left: `clamp(1px, calc(${elapsed}% - 1px), calc(100% - 3px))` }}
            aria-hidden="true"
          />
        )}
      </div>
    </div>
  );
};
