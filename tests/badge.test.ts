import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { barLayout, summarizeUsage } from '../src/background/badge';

describe('Toolbar bar icon', () => {
  it('lays out one pixel-aligned bar per provider, filled from the bottom', () => {
    const bars = barLayout(32, [0, 50, 100, 1]);
    assert.equal(bars.length, 4);
    for (const bar of bars) {
      assert.ok(Number.isInteger(bar.x) && Number.isInteger(bar.fillTop));
      assert.ok(bar.x >= 0 && bar.x + bar.width <= 32);
    }
    const [empty, half, full, sliver] = bars;
    assert.equal(empty.fillTop, empty.bottom);
    assert.equal(full.fillTop, full.top);
    assert.equal(half.bottom - half.fillTop, (half.bottom - half.top) / 2);
    // Any usage at all stays visible.
    assert.equal(sliver.bottom - sliver.fillTop, 1);
  });

  it('uses each card’s lead figure, so Netlify’s add-ons do not lead', () => {
    const limit = { percentage: 30, resetsAt: '2026-11-13T00:00:00Z' };
    const summary = summarizeUsage({
      netlify: {
        teams: [],
        windows: [
          { id: 'p', label: 'Plan credits', limit },
          { id: 'a', label: 'Add-on credits', limit: { percentage: 40, resetsAt: null } },
        ],
        models: [],
        status: 'ok',
        lastUpdated: 0,
      },
    });
    assert.deepEqual(summary?.percents, [30]);
    assert.match(summary?.tooltip ?? '', /Netlify · Plan credits/);
  });
});
