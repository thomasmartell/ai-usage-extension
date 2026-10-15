import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ProviderCard } from '../src/sidepanel/components/ProviderCard';
import type { ClaudeUsage, CodexUsage } from '../src/shared/types';

const NOW = Date.parse('2026-10-15T06:00:00Z');

const render = (usage: ClaudeUsage | CodexUsage) =>
  renderToStaticMarkup(
    createElement(ProviderCard, {
      title: 'Test',
      iconSrc: '',
      iconAlt: '',
      usage,
      loading: false,
      now: NOW,
      emptyHint: 'empty',
    }),
  );

const limit = { percentage: 10, resetsAt: '2026-10-15T10:00:00Z' };

describe('ProviderCard resets', () => {
  it('lists each reset credit with its expiry date', () => {
    const html = render({
      windows: [],
      models: [],
      resets: [
        { id: 'a', label: 'Full reset', expiresAt: '2026-10-29T12:00:00Z' },
        { id: 'b', label: 'Full reset', expiresAt: null },
      ],
      availableResets: 2,
      status: 'ok',
      lastUpdated: NOW,
    });

    // Day/month order follows the runtime locale, so accept either.
    assert.match(html, /Full reset · expires (29 Oct|Oct 29)/);
    assert.match(html, /Full reset · expires unknown/);
    assert.doesNotMatch(html, /Available resets/);
  });

  it('falls back to the bare count for snapshots that predate reset details', () => {
    const html = render({
      windows: [],
      models: [],
      availableResets: 2,
      status: 'ok',
      lastUpdated: NOW,
    });

    assert.match(html, /Available resets · 2/);
  });

  it('shows Claude resets alongside the usage rows', () => {
    const html = render({
      plan: 'unknown',
      session: limit,
      weekly: limit,
      models: [],
      resets: [{ id: 'promo', label: 'Full reset', expiresAt: '2026-10-22T16:00:00Z' }],
      status: 'ok',
      lastUpdated: NOW,
    });

    assert.match(html, /Full reset · expires (22 Oct|Oct 22)/);
  });
});
