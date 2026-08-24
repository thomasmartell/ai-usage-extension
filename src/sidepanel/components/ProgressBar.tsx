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

export const ProgressBar: React.FC<ProgressBarProps> = ({ percentage, label, pace }) => {
  const value = clampPercent(percentage);
  const tone = getUsageTone(value);
  const valueLabel = msg('percentUsed', String(value));

  return (
    <div className="au-progress">
      <div className="au-progress__row">
        <span className="au-progress__label">{label}</span>
        <span className="au-progress__readout">
          <span className="au-progress__value">{valueLabel}</span>
          {pace && pace.showDelta && (
            <span className={`au-pace-chip au-pace-chip--${pace.tone}`}>
              {msg('paceDeltaLabel', formatPaceDelta(pace.deltaPts))}
            </span>
          )}
        </span>
      </div>
      <div
        className={`au-meter au-meter--${tone}`}
        role="progressbar"
        aria-label={label}
        aria-valuenow={value}
        aria-valuetext={valueLabel}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div className="au-meter__fill" style={{ width: `${value}%` }} />
        {pace && (
          <span
            className="au-meter__tick"
            style={{ left: `clamp(0px, calc(${pace.elapsedPct}% - 1px), calc(100% - 2px))` }}
            aria-hidden="true"
          />
        )}
      </div>
    </div>
  );
};
