import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';
import {
  buildAccountRows,
  NetlifyService,
  parseAccounts,
} from '../src/background/services/NetlifyService';

// Synthetic values in the shape of Netlify's account listing and team build
// status; no account data or tokens.
const account = {
  id: 'team-1',
  slug: 'acme',
  name: 'Acme team',
  type_name: 'Pro',
  capabilities: {
    bandwidth: { included: 1_000_000_000_000, used: 123_400_000_000 },
    build_minutes: { included: 25000, used: 1 },
  },
};

const buildStatus = {
  minutes: {
    current: 6250,
    included_minutes: 25000,
    included_minutes_with_packs: 25000,
    period_start_date: '2026-10-05T00:00:00Z',
    period_end_date: '2026-11-05T00:00:00Z',
  },
};

describe('Netlify rows', () => {
  it('meters build minutes over the billing cycle and bandwidth in GB', () => {
    const [team] = parseAccounts([account]);
    const [minutes, bandwidth] = buildAccountRows(team, buildStatus, true);

    assert.equal(minutes.label, 'Build minutes');
    assert.equal(minutes.limit.used, 6250);
    assert.equal(minutes.limit.limit, 25000);
    assert.equal(minutes.limit.percentage, 25);
    assert.equal(minutes.limit.unit, 'minutes');
    assert.equal(minutes.limit.resetsAt, '2026-11-05T00:00:00.000Z');
    assert.equal(minutes.limit.windowMs, 31 * 24 * 60 * 60 * 1000);
    assert.equal(minutes.group, 'Acme team');

    assert.equal(bandwidth.label, 'Bandwidth');
    assert.equal(bandwidth.limit.used, 123.4);
    assert.equal(bandwidth.limit.limit, 1000);
    assert.equal(bandwidth.limit.percentage, 12);
    assert.equal(bandwidth.limit.unit, 'gb');
  });

  it('falls back to the account capability when build status is unavailable', () => {
    const [team] = parseAccounts([account]);
    const [minutes] = buildAccountRows(team, null, false);
    assert.equal(minutes.limit.used, 1);
    assert.equal(minutes.limit.limit, 25000);
    assert.equal(minutes.limit.resetsAt, null);
    assert.equal(minutes.group, undefined);
  });

  it('skips meters the account does not report', () => {
    const [team] = parseAccounts([{ id: 'x', slug: 'x', capabilities: {} }]);
    assert.deepEqual(buildAccountRows(team, {}, false), []);
  });
});

describe('Netlify usage request', () => {
  let store: Record<string, unknown>;

  beforeEach(() => {
    store = { netlify_token: 'test-token' };
    (globalThis as { chrome?: unknown }).chrome = {
      storage: {
        local: {
          get: async (keys: string | string[]) =>
            Object.fromEntries(
              [keys]
                .flat()
                .filter((key) => key in store)
                .map((key) => [key, store[key]]),
            ),
          set: async (items: Record<string, unknown>) => void Object.assign(store, items),
          remove: async (keys: string | string[]) => {
            for (const key of [keys].flat()) delete store[key];
          },
        },
      },
    };
  });

  afterEach(() => {
    mock.restoreAll();
    delete (globalThis as { chrome?: unknown }).chrome;
  });

  it('reads each team and its build status with the stored token', async () => {
    const requests: string[] = [];
    mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
      requests.push(url);
      assert.equal(new Headers(init.headers).get('Authorization'), 'Bearer test-token');
      if (url === 'https://api.netlify.com/api/v1/accounts') return Response.json([account]);
      assert.equal(url, 'https://api.netlify.com/api/v1/acme/builds/status');
      return Response.json(buildStatus);
    });

    const usage = await NetlifyService.fetchUsage(Date.UTC(2026, 9, 18));
    assert.deepEqual(usage?.teams, [{ slug: 'acme', name: 'Acme team', plan: 'Pro' }]);
    assert.deepEqual(
      usage?.windows.map((row) => row.id),
      ['acme:build-minutes', 'acme:bandwidth'],
    );
    assert.equal(usage?.status, 'ok');
    assert.equal(requests.length, 2);
  });

  it('forgets a token Netlify rejects', async () => {
    mock.method(globalThis, 'fetch', async () => new Response('{}', { status: 401 }));
    assert.equal(await NetlifyService.fetchUsage(), null);
    assert.equal(store.netlify_token, undefined);
  });

  it('saves a pasted token only after Netlify accepts it', async () => {
    store = {};
    mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) =>
      new Headers(init.headers).get('Authorization') === 'Bearer good-token'
        ? Response.json({ id: 'user' })
        : new Response('{}', { status: 401 }),
    );

    await assert.rejects(NetlifyService.saveToken('bad-token'), /token_rejected/);
    assert.equal(store.netlify_token, undefined);

    await NetlifyService.saveToken(' good-token ');
    assert.equal(store.netlify_token, 'good-token');
  });
});
