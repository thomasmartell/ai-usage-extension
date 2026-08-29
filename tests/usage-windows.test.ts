import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { WINDOW_MS } from '../src/shared/constants';
import type { CodexUsage, ModelUsage } from '../src/shared/types';
import {
  getUsageWindows,
  groupQuietModels,
  sortByWindow,
  withInferredWindow,
} from '../src/shared/usageWindows';

const model = (id: string, label: string, windowMs?: number): ModelUsage => ({
  id,
  label,
  limit: {
    percentage: 54,
    resetsAt: '2026-08-27T06:00:00.000Z',
    ...(windowMs === undefined ? {} : { windowMs }),
  },
});

describe('withInferredWindow', () => {
  it('keeps an explicit window length untouched', () => {
    const row = model('scoped-2', 'Fable · 7d', WINDOW_MS.fiveHours);
    assert.equal(withInferredWindow(row), row);
  });

  it('recovers the window from the duration segment in a Codex id', () => {
    const row = withInferredWindow(model('codex:primary:604800', 'Weekly · 7d'));
    assert.equal(row.limit.windowMs, WINDOW_MS.sevenDays);
  });

  it('recovers the window from the label tag when the id has no duration', () => {
    assert.equal(
      withInferredWindow(model('scoped-2', 'Fable · 7d')).limit.windowMs,
      WINDOW_MS.sevenDays,
    );
    assert.equal(
      withInferredWindow(model('scoped-0', 'Fable · 5h')).limit.windowMs,
      WINDOW_MS.fiveHours,
    );
  });

  it('leaves rows alone when nothing reveals the window length', () => {
    const row = model('codex:primary:unknown', 'Usage limit');
    assert.equal(withInferredWindow(row).limit.windowMs, undefined);
  });
});

describe('groupQuietModels', () => {
  const spark5h = model('additional.spark:primary:18000', 'Spark · 5h', WINDOW_MS.fiveHours);
  const spark7d = model('additional.spark:primary:604800', 'Spark · 7d', WINDOW_MS.sevenDays);

  it('folds sibling windows into one row while all are untouched', () => {
    const quiet = [
      { ...spark5h, limit: { ...spark5h.limit, percentage: 0 } },
      { ...spark7d, limit: { ...spark7d.limit, percentage: 0 } },
    ];

    const [row, ...rest] = groupQuietModels(quiet);
    assert.equal(rest.length, 0);
    assert.equal(row.label, 'Spark · 5h / 7d');
    assert.equal(row.limit.windowMs, WINDOW_MS.fiveHours);
    assert.equal(row.secondaryResetsAt, spark7d.limit.resetsAt);
  });

  it('splits the group back out once any window carries usage', () => {
    const active = [{ ...spark5h, limit: { ...spark5h.limit, percentage: 12 } }, spark7d];
    assert.equal(groupQuietModels(active).length, 2);
  });

  it('leaves single rows and unrelated labels untouched', () => {
    const fable = model('scoped-2', 'Fable · 7d', WINDOW_MS.sevenDays);
    assert.deepEqual(groupQuietModels([fable]), [fable]);
  });
});

describe('sortByWindow', () => {
  it('puts the shortest window first', () => {
    const session = model('session', 'Session · 5h', WINDOW_MS.fiveHours);
    const weekly = model('weekly', 'Weekly · 7d', WINDOW_MS.sevenDays);

    const order = sortByWindow([weekly, session]).map((row) => row.id);
    assert.deepEqual(order, ['session', 'weekly']);
  });

  it('keeps the given order for equal windows and pushes unknown lengths last', () => {
    const weekly = model('weekly', 'Weekly · 7d', WINDOW_MS.sevenDays);
    const fable = model('fable', 'Fable · 7d', WINDOW_MS.sevenDays);
    const unknown = model('unknown', 'Usage limit');

    const order = sortByWindow([unknown, weekly, fable]).map((row) => row.id);
    assert.deepEqual(order, ['weekly', 'fable', 'unknown']);
  });
});

describe('getUsageWindows backfill', () => {
  it('backfills Codex windows stored without a window length', () => {
    const usage: CodexUsage = {
      windows: [model('codex:primary:18000', 'Session · 5h')],
      models: [],
      availableResets: null,
      status: 'ok',
      lastUpdated: 0,
    };

    const [session] = getUsageWindows(usage);
    assert.equal(session.limit.windowMs, WINDOW_MS.fiveHours);
  });
});
