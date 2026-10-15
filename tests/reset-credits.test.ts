import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';
import {
  buildClaudeUsage,
  buildCodexResets,
  UsageService,
} from '../src/background/services/UsageService';
import { formatExpiryDate } from '../src/shared/utils';

// Synthetic fixtures modelled on the live response shapes; no real ids, emails or tokens.
const codexCredits = {
  available_count: 2,
  credits: [
    {
      id: 'credit-a',
      title: 'Full reset',
      reset_type: 'codex_rate_limits',
      status: 'available',
      expires_at: '2026-10-29T18:50:05.613502Z',
    },
    {
      id: 'credit-b',
      title: 'Full reset',
      reset_type: 'codex_rate_limits',
      status: 'available',
      expires_at: '2026-11-06T23:22:08.951149Z',
    },
    {
      id: 'credit-used',
      title: 'Full reset',
      status: 'redeemed',
      expires_at: '2026-09-01T00:00:00Z',
    },
  ],
};

const codexUsage = {
  rate_limit: {
    primary_window: { used_percent: 77, limit_window_seconds: 604800, reset_at: 1_792_473_800 },
    secondary_window: null,
  },
  rate_limit_reset_credits: { available_count: 2 },
};

const claudeUsage = {
  five_hour: { utilization: 7, resets_at: '2026-10-15T10:00:00+00:00' },
  seven_day: { utilization: 74, resets_at: '2026-10-15T09:00:00+00:00' },
  cedar_ember: {
    eligible: true,
    grants: [
      {
        id: 'launch-promo',
        label: 'Launch promotion: one usage-limit reset',
        type: 'full',
        resets_left: 1,
        resets_total: 1,
        ends_at: '2026-10-22T16:00:00+00:00',
        usable_now: true,
      },
      {
        id: 'spent-promo',
        label: 'Older promotion',
        type: 'full',
        resets_left: 0,
        resets_total: 1,
        ends_at: '2026-12-01T00:00:00+00:00',
        usable_now: true,
      },
      {
        id: 'held-promo',
        label: 'Not yet usable',
        type: 'five_hour',
        resets_left: 1,
        resets_total: 1,
        ends_at: '2026-12-01T00:00:00+00:00',
        usable_now: false,
      },
    ],
  },
};

describe('buildCodexResets', () => {
  it('lists available credits with their expiry and skips redeemed ones', () => {
    assert.deepEqual(buildCodexResets(codexCredits), [
      { id: 'credit-a', label: 'Full reset', expiresAt: '2026-10-29T18:50:05.613502Z' },
      { id: 'credit-b', label: 'Full reset', expiresAt: '2026-11-06T23:22:08.951149Z' },
    ]);
  });

  it('returns nothing for a missing or malformed response', () => {
    assert.deepEqual(buildCodexResets(null), []);
    assert.deepEqual(buildCodexResets({ credits: 'nope' }), []);
  });
});

describe('buildClaudeUsage resets', () => {
  it('maps usable grants with resets left to resets with an expiry', () => {
    const usage = buildClaudeUsage(claudeUsage);
    assert.ok(usage);
    assert.deepEqual(usage.resets, [
      { id: 'launch-promo', label: 'Full reset', expiresAt: '2026-10-22T16:00:00+00:00' },
    ]);
    assert.equal(usage.weekly.percentage, 74);
  });

  it('yields an empty list when the grants field is absent', () => {
    const usage = buildClaudeUsage({ five_hour: {}, seven_day: {} });
    assert.ok(usage);
    assert.deepEqual(usage.resets, []);
  });
});

describe('fetching reset credits', () => {
  const sessionUrl = 'https://chatgpt.com/api/auth/session';
  const usageUrl = 'https://chatgpt.com/backend-api/wham/usage';
  const creditsUrl = 'https://chatgpt.com/backend-api/wham/rate-limit-reset-credits';

  beforeEach(() => {
    // Minimal chrome stub so the Claude org lookup resolves without a browser.
    (globalThis as { chrome?: unknown }).chrome = {
      storage: {
        local: {
          get: async () => ({ claude_org_id: 'org-test' }),
          set: async () => undefined,
          remove: async () => undefined,
        },
      },
      cookies: { get: async () => null },
    };
  });

  afterEach(() => {
    mock.restoreAll();
    delete (globalThis as { chrome?: unknown }).chrome;
  });

  it('attaches Codex resets from the reset-credits endpoint using the usage headers', async () => {
    const requests: Array<{ url: string; init: RequestInit }> = [];
    mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
      requests.push({ url, init });
      if (url === sessionUrl) {
        return Response.json({ accessToken: 'test-token', account_id: 'test-account' });
      }
      if (url === usageUrl) return Response.json(codexUsage);
      assert.equal(url, creditsUrl);
      return Response.json(codexCredits);
    });

    const usage = await UsageService.fetchCodexUsage();
    assert.ok(usage);
    assert.equal(usage.resets?.length, 2);
    assert.equal(usage.availableResets, 2);

    const credits = requests.find((request) => request.url === creditsUrl);
    assert.ok(credits);
    const headers = new Headers(credits.init.headers);
    assert.equal(headers.get('Authorization'), 'Bearer test-token');
    assert.equal(headers.get('ChatGPT-Account-Id'), 'test-account');
  });

  it('keeps the Codex usage when the reset-credits endpoint fails', async () => {
    mock.method(globalThis, 'fetch', async (url: string) => {
      if (url === sessionUrl) return Response.json({ accessToken: 'test-token' });
      if (url === usageUrl) return Response.json(codexUsage);
      return new Response('nope', { status: 500 });
    });

    const usage = await UsageService.fetchCodexUsage();
    assert.ok(usage);
    assert.equal(usage.windows[0].limit.percentage, 77);
    assert.deepEqual(usage.resets, []);
  });

  it('asks the Claude usage endpoint for reset grants', async () => {
    let requested: string | null = null;
    mock.method(globalThis, 'fetch', async (url: string) => {
      requested = url;
      return Response.json(claudeUsage);
    });

    const usage = await UsageService.fetchClaudeUsage();
    assert.ok(usage);
    assert.equal(requested, 'https://claude.ai/api/organizations/org-test/usage?cedar_ember=1');
    assert.equal(usage.resets?.length, 1);
  });
});

describe('formatExpiryDate', () => {
  it('renders a short day and month', () => {
    const text = formatExpiryDate('2026-10-22T12:00:00Z');
    assert.match(text, /22/);
    assert.match(text, /Oct/);
  });

  it('falls back to unknown for a missing or invalid date', () => {
    assert.equal(formatExpiryDate(null), 'unknown');
    assert.equal(formatExpiryDate('not a date'), 'unknown');
  });
});
