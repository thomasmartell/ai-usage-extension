import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import { UsageService } from '../src/background/services/UsageService';

const sessionUrl = 'https://chatgpt.com/api/auth/session';
const usageUrl = 'https://chatgpt.com/backend-api/wham/usage';

// Synthetic response values model the reported mismatch; no account data or tokens.
const payload = {
  rate_limit: {
    primary_window: {
      used_percent: 69,
      limit_window_seconds: 604800,
      reset_at: 1800000000,
    },
    secondary_window: null,
  },
  rate_limit_reset_credits: { available_count: 2 },
};

describe('Codex usage request', () => {
  afterEach(() => mock.restoreAll());

  it('matches the current ChatGPT usage request context and bypasses HTTP cache', async () => {
    const requests: Array<{ url: string; init: RequestInit }> = [];
    mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
      requests.push({ url, init });
      if (url === sessionUrl) {
        return Response.json({ accessToken: 'test-token', account_id: 'test-account' });
      }
      assert.equal(url, usageUrl);
      return Response.json(payload);
    });

    const usage = await UsageService.fetchCodexUsage();
    assert.equal(usage?.windows[0].limit.percentage, 69);
    assert.equal(usage?.windows[0].label, 'Weekly · 7d');
    assert.equal(usage?.availableResets, 2);
    assert.equal(requests.length, 2);
    const headers = new Headers(requests[1].init.headers);
    assert.equal(headers.get('OAI-App-Brand'), 'chatgpt');
    assert.equal(headers.get('ChatGPT-Account-Id'), 'test-account');
    assert.equal(headers.get('Authorization'), 'Bearer test-token');
    for (const request of requests) {
      assert.equal(request.init.cache, 'no-store');
      assert.equal(request.init.credentials, 'include');
    }
  });

  it('uses the selected nested account instead of an unscoped or default account', async () => {
    let requestedAccount: string | null = null;
    mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
      if (url === sessionUrl) {
        return Response.json({
          accessToken: 'test-token',
          account: { id: 'selected-account' },
          user: { default_account_id: 'other-account' },
          accounts: [{ id: 'other-account' }],
        });
      }
      assert.equal(url, usageUrl);
      requestedAccount = new Headers(init.headers).get('ChatGPT-Account-Id');
      return Response.json({
        ...payload,
        rate_limit: {
          ...payload.rate_limit,
          primary_window: {
            ...payload.rate_limit.primary_window,
            used_percent: requestedAccount === 'selected-account' ? 69 : 100,
          },
        },
      });
    });
    const usage = await UsageService.fetchCodexUsage();
    assert.equal(usage?.windows[0].limit.percentage, 69);
    assert.equal(requestedAccount, 'selected-account');
    assert.match(usage?.diagnostics?.requestAccountFingerprint ?? '', /^[0-9a-f]{12}$/);
  });

  it('reads the account binding from the access token when session account fields are absent', async () => {
    const claims = {
      'https://api.openai.com/auth': { chatgpt_account_id: 'token-account' },
    };
    const token = `test.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.test`;
    let account: string | null = null;
    mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
      if (url === sessionUrl) return Response.json({ accessToken: token });
      account = new Headers(init.headers).get('ChatGPT-Account-Id');
      return Response.json(payload);
    });
    const usage = await UsageService.fetchCodexUsage();
    assert.equal(account, 'token-account');
    assert.match(usage?.diagnostics?.requestAccountFingerprint ?? '', /^[0-9a-f]{12}$/);
  });

  it('does not mistake a token user ID for an account ID or fail on opaque tokens', async () => {
    for (const token of [
      'opaque-token',
      'test.%%%invalid.test',
      `test.${Buffer.from(
        JSON.stringify({ sub: 'user-id', 'https://api.openai.com/auth': { user_id: 'user-id' } }),
      ).toString('base64url')}.test`,
    ]) {
      let account: string | null = null;
      mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
        if (url === sessionUrl) return Response.json({ accessToken: token });
        account = new Headers(init.headers).get('ChatGPT-Account-Id');
        return Response.json(payload);
      });
      assert.ok(await UsageService.fetchCodexUsage());
      assert.equal(account, null);
      mock.restoreAll();
    }
  });

  it('does not request usage without a signed-in session', async () => {
    const fetchMock = mock.method(globalThis, 'fetch', async () => Response.json({}));
    assert.equal(await UsageService.fetchCodexUsage(), null);
    assert.equal(fetchMock.mock.callCount(), 1);
  });
});
