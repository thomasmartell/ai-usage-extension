import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { WINDOW_MS } from '../src/shared/constants';
import { computePace, formatPaceDelta, paceFromLimit } from '../src/shared/pace';
import type { UsageLimit } from '../src/shared/types';

const HOUR = 60 * 60 * 1000;
const NOW = Date.parse('2026-08-24T12:00:00.000Z');

/** A limit that resets `msToReset` from `NOW`. */
const limitAt = (percentage: number, msToReset: number, windowMs?: number): UsageLimit => ({
  percentage,
  resetsAt: new Date(NOW + msToReset).toISOString(),
  ...(windowMs === undefined ? {} : { windowMs }),
});

describe('computePace', () => {
  it('reports banking time when usage trails the clock', () => {
    // 3h of a 5h window gone (60%), 8% spent.
    const pace = computePace({ usedPct: 8, windowMs: 5 * HOUR, msToReset: 2 * HOUR });

    assert.ok(pace);
    assert.equal(pace.elapsedPct, 60);
    assert.equal(pace.deltaPts, -52);
    assert.equal(pace.tone, 'ahead');
    assert.equal(pace.showDelta, true);
    assert.equal(pace.projectedEarlyMs, null);
  });

  it('reports on pace inside the ±5 point band without a projection', () => {
    const pace = computePace({ usedPct: 52, windowMs: 5 * HOUR, msToReset: 2.5 * HOUR });

    assert.ok(pace);
    assert.equal(pace.elapsedPct, 50);
    assert.equal(pace.deltaPts, 2);
    assert.equal(pace.tone, 'neutral');
    assert.equal(pace.projectedEarlyMs, null);
  });

  it('grades overspend as warning up to +15 points and critical beyond it', () => {
    const warning = computePace({ usedPct: 62, windowMs: 5 * HOUR, msToReset: 2.5 * HOUR });
    const critical = computePace({ usedPct: 70, windowMs: 5 * HOUR, msToReset: 2.5 * HOUR });

    assert.equal(warning?.deltaPts, 12);
    assert.equal(warning?.tone, 'warning');
    assert.equal(critical?.deltaPts, 20);
    assert.equal(critical?.tone, 'critical');
  });

  it('holds the tone boundaries exactly at ±5 and +15', () => {
    const tone = (usedPct: number): string | undefined =>
      computePace({ usedPct, windowMs: 5 * HOUR, msToReset: 2.5 * HOUR })?.tone;

    assert.equal(tone(45), 'ahead'); // -5
    assert.equal(tone(46), 'neutral'); // -4
    assert.equal(tone(54), 'neutral'); // +4
    assert.equal(tone(55), 'warning'); // +5
    assert.equal(tone(65), 'warning'); // +15
    assert.equal(tone(66), 'critical'); // +16
  });

  it('projects when the limit runs out once more than 10 points over pace', () => {
    // Half the 5h window gone, 75% spent → 100% at 2/3 of the window,
    // i.e. 1h40m before the reset.
    const pace = computePace({ usedPct: 75, windowMs: 5 * HOUR, msToReset: 2.5 * HOUR });

    assert.ok(pace);
    assert.equal(pace.deltaPts, 25);
    assert.equal(pace.projectedEarlyMs, Math.round((5 / 3) * HOUR));
  });

  it('never projects while at or under pace', () => {
    const underPace = computePace({ usedPct: 20, windowMs: 5 * HOUR, msToReset: 2.5 * HOUR });
    const justOver = computePace({ usedPct: 60, windowMs: 5 * HOUR, msToReset: 2.5 * HOUR });

    assert.equal(underPace?.projectedEarlyMs, null);
    assert.equal(justOver?.deltaPts, 10); // +10 is not yet "more than 10"
    assert.equal(justOver?.projectedEarlyMs, null);
  });

  it('withholds the projection until enough of the window has elapsed', () => {
    // 5% of the window gone: a burst this early extrapolates to nonsense.
    const tooEarly = computePace({
      usedPct: 30,
      windowMs: 7 * 24 * HOUR,
      msToReset: 6.65 * 24 * HOUR,
    });
    // 10% gone is the point where the rate starts to mean something.
    const enough = computePace({
      usedPct: 30,
      windowMs: 7 * 24 * HOUR,
      msToReset: 6.3 * 24 * HOUR,
    });

    assert.equal(tooEarly?.elapsedPct, 5);
    assert.equal(tooEarly?.deltaPts, 25);
    assert.equal(tooEarly?.tone, 'critical');
    assert.equal(tooEarly?.projectedEarlyMs, null);

    assert.equal(enough?.elapsedPct, 10);
    assert.equal(enough?.projectedEarlyMs, Math.round((2 / 3) * 7 * 24 * HOUR));
  });

  it('suppresses the delta chip on an untouched meter', () => {
    const pace = computePace({ usedPct: 0, windowMs: 7 * 24 * HOUR, msToReset: 3 * 24 * HOUR });

    assert.ok(pace);
    assert.equal(pace.elapsedPct, 57);
    assert.equal(pace.deltaPts, -57);
    assert.equal(pace.showDelta, false);
  });

  it('handles a just-reset window without dividing by zero', () => {
    const pace = computePace({ usedPct: 4, windowMs: 5 * HOUR, msToReset: 5 * HOUR });

    assert.ok(pace);
    assert.equal(pace.elapsedPct, 0);
    assert.equal(pace.deltaPts, 4);
    assert.equal(pace.tone, 'neutral');
    assert.equal(pace.projectedEarlyMs, null);
    assert.ok(Number.isFinite(pace.deltaPts));
  });

  it('refuses to project from a just-reset window, however much was spent', () => {
    // No time has elapsed, so there is no rate to extrapolate from.
    const pace = computePace({ usedPct: 30, windowMs: 5 * HOUR, msToReset: 5 * HOUR });

    assert.ok(pace);
    assert.equal(pace.elapsedPct, 0);
    assert.equal(pace.deltaPts, 30);
    assert.equal(pace.tone, 'critical');
    assert.equal(pace.projectedEarlyMs, null);
  });

  it('clamps a window that is already spent or reset in the past', () => {
    const expired = computePace({ usedPct: 90, windowMs: 5 * HOUR, msToReset: -HOUR });
    const skewed = computePace({ usedPct: 10, windowMs: 5 * HOUR, msToReset: 9 * HOUR });

    assert.equal(expired?.elapsedPct, 100);
    assert.equal(expired?.deltaPts, -10);
    assert.equal(skewed?.elapsedPct, 0);
    assert.equal(skewed?.deltaPts, 10);
  });

  it('returns null — no pace UI at all — when the window length is unknown', () => {
    assert.equal(computePace({ usedPct: 40, msToReset: 2 * HOUR }), null);
    assert.equal(computePace({ usedPct: 40, windowMs: null, msToReset: 2 * HOUR }), null);
    assert.equal(computePace({ usedPct: 40, windowMs: 0, msToReset: 2 * HOUR }), null);
    assert.equal(computePace({ usedPct: 40, windowMs: Number.NaN, msToReset: 2 * HOUR }), null);
  });

  it('returns null when the reset time is unknown', () => {
    assert.equal(computePace({ usedPct: 40, windowMs: 5 * HOUR }), null);
    assert.equal(computePace({ usedPct: 40, windowMs: 5 * HOUR, msToReset: null }), null);
    assert.equal(computePace({ usedPct: 40, windowMs: 5 * HOUR, msToReset: Number.NaN }), null);
  });
});

describe('paceFromLimit', () => {
  it('paces a stored limit against the current clock', () => {
    const pace = paceFromLimit(limitAt(35, 3 * 24 * HOUR, WINDOW_MS.sevenDays), NOW);

    assert.ok(pace);
    assert.equal(pace.elapsedPct, 57);
    assert.equal(pace.deltaPts, -22);
    assert.equal(pace.tone, 'ahead');
  });

  it('has no pace for limits with no reset time or no window length', () => {
    assert.equal(paceFromLimit({ percentage: 35, resetsAt: null }, NOW), null);
    assert.equal(paceFromLimit({ percentage: 35, resetsAt: 'not-a-date' }, NOW), null);
    assert.equal(paceFromLimit(limitAt(35, 3 * 24 * HOUR), NOW), null);
  });
});

describe('formatPaceDelta', () => {
  it('signs the delta for display', () => {
    assert.equal(formatPaceDelta(18), '+18');
    assert.equal(formatPaceDelta(-21), '−21');
    assert.equal(formatPaceDelta(0), '0');
  });
});
