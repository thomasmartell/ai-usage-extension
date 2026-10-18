import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Headline } from '../src/sidepanel/components/Headline';
import { ProviderCard } from '../src/sidepanel/components/ProviderCard';
import type { ClaudeUsage, CodexUsage, UsageState } from '../src/shared/types';

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

    assert.match(html, /Resets available · 2/);
    // Day/month order follows the runtime locale, so accept either.
    assert.match(html, /<span>Full reset<\/span><span>expires (29 Oct|Oct 29)<\/span>/);
    assert.match(html, /<span>Full reset<\/span><span>expires unknown<\/span>/);
  });

  it('falls back to the bare count for snapshots that predate reset details', () => {
    const html = render({
      windows: [],
      models: [],
      availableResets: 2,
      status: 'ok',
      lastUpdated: NOW,
    });

    assert.match(html, /Resets available · 2/);
  });

  it('shows no count when fresh reset details say there are none', () => {
    const html = render({
      windows: [],
      models: [],
      resets: [],
      availableResets: 2,
      status: 'ok',
      lastUpdated: NOW,
    });

    assert.doesNotMatch(html, /Resets available/);
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

    assert.match(html, /<span>Full reset<\/span><span>expires (22 Oct|Oct 22)<\/span>/);
  });
});

describe('ProviderCard layout', () => {
  it('leads with the weekly limit, lists it before the session, and leaves out the plan', () => {
    const html = render({
      plan: 'Max',
      session: { ...limit, percentage: 33 },
      weekly: { ...limit, percentage: 91 },
      models: [],
      resets: [],
      status: 'warning',
      lastUpdated: NOW,
    });

    assert.match(html, /au-card__peak--warning"><span>91<small>%<\/small><\/span>/);
    assert.match(html, /weekly<\/span>/);
    assert.ok(html.indexOf('Weekly · 7d') < html.indexOf('Session · 5h'));
    assert.doesNotMatch(html, /Plan · Max/);
  });
});

describe('ProviderCard lead figure', () => {
  it('leads Netlify with plan credits, not add-ons that never reset', () => {
    const html = renderToStaticMarkup(
      createElement(ProviderCard, {
        title: 'Netlify',
        iconSrc: '',
        iconAlt: '',
        loading: false,
        now: NOW,
        emptyHint: 'empty',
        usage: {
          teams: [{ slug: 'acme', name: 'Acme', plan: 'Pro' }],
          windows: [
            { id: 'p', label: 'Plan credits', group: 'Acme', limit: { ...limit, percentage: 30 } },
            {
              id: 'a',
              label: 'Add-on credits',
              group: 'Acme',
              limit: { percentage: 40, resetsAt: null },
            },
          ],
          models: [],
          status: 'ok',
          lastUpdated: NOW,
        },
      }),
    );
    assert.match(html, /au-card__peak[^>]*><span>30<small>/);
  });
});

describe('ProviderCard budget pairs', () => {
  it('sets two budgets of one account side by side', () => {
    const budget = (id: string, label: string) => ({
      id,
      label,
      group: 'acme',
      limit: {
        percentage: 0,
        resetsAt: '2026-11-01T00:00:00Z',
        used: 0,
        limit: 50,
        unit: 'usd' as const,
      },
    });
    const html = renderToStaticMarkup(
      createElement(ProviderCard, {
        title: 'GitHub',
        iconSrc: '',
        iconAlt: '',
        loading: false,
        now: NOW,
        emptyHint: 'empty',
        usage: {
          viewer: 'octo',
          accounts: [],
          windows: [budget('a', 'Actions budget'), budget('b', 'AI credits budget')],
          models: [],
          status: 'ok',
          lastUpdated: NOW,
        },
      }),
    );
    assert.match(html, /au-pair[^]*Actions budget[^]*AI credits budget/);
  });
});

describe('ProviderCard groups', () => {
  it('keeps each account’s rows together while sorting by window', () => {
    const row = (id: string, group: string, windowMs?: number) => ({
      id,
      label: id,
      group,
      limit: { percentage: 5, resetsAt: '2026-11-01T00:00:00Z', ...(windowMs ? { windowMs } : {}) },
    });
    const html = renderToStaticMarkup(
      createElement(ProviderCard, {
        title: 'GitHub',
        iconSrc: '',
        iconAlt: '',
        loading: false,
        now: NOW,
        emptyHint: 'empty',
        usage: {
          viewer: 'octo',
          accounts: [],
          windows: [
            row('org-a budget', 'org-a'),
            row('org-a minutes', 'org-a', 1000),
            row('org-b minutes', 'org-b', 1000),
            row('org-b budget', 'org-b'),
          ],
          models: [],
          status: 'ok',
          lastUpdated: NOW,
        },
      }),
    );
    assert.match(html, /org-a minutes[^]*org-a budget[^]*org-b minutes[^]*org-b budget/);
  });
});

describe('Headline', () => {
  it('gives a limit that never resets no reset clause', () => {
    const html = renderToStaticMarkup(
      createElement(Headline, {
        now: NOW,
        usage: {
          netlify: {
            teams: [],
            windows: [
              {
                id: 'acme:addon-credits',
                label: 'Add-on credits',
                limit: { percentage: 90, resetsAt: null },
              },
            ],
            models: [],
            status: 'warning',
            lastUpdated: NOW,
          },
        } as UsageState,
      }),
    );
    assert.match(html, /Netlify Add-on credits limit at 90%/);
    assert.doesNotMatch(html, /[Rr]esets/);
  });

  it('names a Netlify limit when it is the fullest', () => {
    const html = renderToStaticMarkup(
      createElement(Headline, {
        now: NOW,
        usage: {
          claude: {
            windows: [{ id: 'w', label: 'Weekly', limit: { ...limit, percentage: 40 } }],
            models: [],
            status: 'ok',
            lastUpdated: NOW,
          },
          netlify: {
            teams: [{ slug: 'acme', name: 'Acme', plan: 'Pro' }],
            windows: [
              {
                id: 'acme:build-minutes',
                label: 'Build minutes',
                group: 'Acme',
                limit: { ...limit, percentage: 99 },
              },
            ],
            models: [],
            status: 'critical',
            lastUpdated: NOW,
          },
        } as UsageState,
      }),
    );
    assert.match(html, /Netlify Build minutes/);
  });
});
