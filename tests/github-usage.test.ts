import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';
import {
  actionsMinutes,
  billingMonth,
  buildAccountRows,
  buildGithubUsage,
  carryBudgets,
  GithubService,
  parseBillingItems,
  parseBudgets,
} from '../src/background/services/GithubService';

// Synthetic billing values in the shape of GitHub's usage summary; no account data or tokens.
const NOW = Date.UTC(2026, 9, 18, 12);

const summary = {
  usageItems: [
    { product: 'Actions', sku: 'actions_linux', grossQuantity: 18223, netAmount: 0 },
    { product: 'Actions', sku: 'actions_macos', grossQuantity: 26, netAmount: 0 },
    { product: 'Actions', sku: 'actions_storage', grossQuantity: 39.1, netAmount: 0 },
    { product: 'Copilot', sku: 'copilot_ai_unit', grossQuantity: 100, netAmount: 4.256 },
  ],
};

const budgets = {
  budgets: [
    { budget_product_sku: 'actions', budget_amount: 50 },
    { budget_product_sku: 'ai_credits', budget_amount: 50 },
    { budget_product_sku: 'codespaces', budget_amount: 0 },
  ],
};

const org = { login: 'acme', kind: 'organization' as const, plan: 'enterprise' };

describe('GitHub billing rows', () => {
  it('bills by UTC calendar month', () => {
    const month = billingMonth(NOW);
    assert.equal(month.year, 2026);
    assert.equal(month.month, 10);
    assert.equal(new Date(month.end).toISOString(), '2026-11-01T00:00:00.000Z');
  });

  it('counts runner minutes at their multipliers against the plan allowance', () => {
    const [minutes] = buildAccountRows(
      { account: org, items: parseBillingItems(summary), budgets: [] },
      NOW,
    );
    // 18,223 Linux + 26 macOS × 10; storage is not minutes.
    assert.equal(minutes.limit.used, 18483);
    assert.equal(minutes.limit.limit, 50000);
    assert.equal(minutes.limit.percentage, 37);
    assert.equal(minutes.limit.unit, 'minutes');
    assert.equal(minutes.limit.resetsAt, '2026-11-01T00:00:00.000Z');
    assert.equal(minutes.limit.windowMs, 31 * 24 * 60 * 60 * 1000);
    assert.equal(minutes.label, 'Actions minutes');
    assert.equal(minutes.group, 'acme');
  });

  it('meters spend against each non-zero budget and skips zero caps', () => {
    const rows = buildAccountRows(
      { account: org, items: parseBillingItems(summary), budgets: parseBudgets(budgets, 'acme') },
      NOW,
    );
    assert.deepEqual(
      rows.map((row) => [row.label, row.limit.used, row.limit.limit, row.limit.percentage]),
      [
        ['Actions minutes', 18483, 50000, 37],
        ['Actions budget', 0, 50, 0],
        ['AI credits budget', 4.26, 50, 9],
      ],
    );
    assert.equal(rows[1].limit.unit, 'usd');
  });

  it('accepts budgets listed with a SKU array', () => {
    assert.deepEqual(
      parseBudgets(
        { budgets: [{ budget_product_skus: ['actions', 'packages'], budget_amount: 20 }] },
        'acme',
      ),
      [
        { sku: 'actions', amount: 20 },
        { sku: 'packages', amount: 20 },
      ],
    );
  });

  it('leaves free public-repository minutes out of the allowance', () => {
    const [minutes] = buildAccountRows(
      { account: org, items: parseBillingItems(summary), budgets: [], publicMinutes: 483 },
      NOW,
    );
    assert.equal(minutes.limit.used, 18000);
    assert.equal(minutes.limit.percentage, 36);
  });

  it('keeps only organization-wide budgets for this org', () => {
    const parsed = parseBudgets(
      {
        budgets: [
          {
            budget_product_sku: 'actions',
            budget_amount: 50,
            budget_scope: 'organization',
            budget_entity_name: 'acme',
          },
          {
            budget_product_sku: 'actions',
            budget_amount: 5,
            budget_scope: 'repository',
            budget_entity_name: 'acme/app',
          },
          {
            budget_product_sku: 'actions',
            budget_amount: 9,
            budget_scope: 'cost_center',
            budget_entity_name: 'ops',
          },
          {
            budget_product_sku: 'actions',
            budget_amount: 7,
            budget_scope: 'organization',
            budget_entity_name: 'other',
          },
        ],
      },
      'acme',
    );
    assert.deepEqual(parsed, [{ sku: 'actions', amount: 50 }]);
  });

  it('meters a single-SKU budget against that SKU only', () => {
    const rows = buildAccountRows(
      {
        account: org,
        items: [
          { product: 'Actions', sku: 'actions_linux', grossQuantity: 100, netAmount: 3 },
          { product: 'Actions', sku: 'actions_macos', grossQuantity: 10, netAmount: 6 },
        ],
        budgets: parseBudgets(
          {
            budgets: [
              { budget_type: 'SkuPricing', budget_product_sku: 'actions_linux', budget_amount: 30 },
            ],
          },
          'acme',
        ),
      },
      NOW,
    );
    assert.equal(rows[1].limit.used, 3);
    assert.equal(rows[1].limit.percentage, 10);
  });

  it('omits the minutes row when the plan allowance is unknown', () => {
    const rows = buildAccountRows(
      { account: { ...org, plan: null }, items: parseBillingItems(summary), budgets: [] },
      NOW,
    );
    assert.deepEqual(rows, []);
  });

  it('lists organizations before the personal account and takes the worst tone', () => {
    const usage = buildGithubUsage(
      'octo',
      [
        {
          account: { login: 'octo', kind: 'user', plan: 'pro' },
          items: [{ product: 'Actions', sku: 'actions_linux', grossQuantity: 2900, netAmount: 0 }],
          budgets: [],
        },
        { account: org, items: parseBillingItems(summary), budgets: [] },
      ],
      NOW,
    );
    assert.deepEqual(
      usage.accounts.map((account) => account.login),
      ['acme', 'octo'],
    );
    assert.equal(usage.windows[1].limit.percentage, 97);
    assert.equal(usage.status, 'critical');
  });
});

describe('Budget carry-over', () => {
  it('keeps the last budget rows when the budget listing fails', () => {
    const limit = { percentage: 0, resetsAt: '2026-11-01T00:00:00Z' };
    const previous = buildGithubUsage('octo', [], NOW);
    previous.windows = [
      { id: 'acme:actions-minutes', label: 'Actions minutes', group: 'acme', limit },
      { id: 'acme:budget:actions', label: 'Actions budget', group: 'acme', limit },
      { id: 'octo:actions-minutes', label: 'Actions minutes', group: 'octo', limit },
    ];
    const next = {
      ...previous,
      windows: [previous.windows[0], previous.windows[2]],
      budgetsMissing: ['acme'],
    };
    assert.deepEqual(
      carryBudgets(next, previous).windows.map((row) => row.id),
      ['acme:actions-minutes', 'acme:budget:actions', 'octo:actions-minutes'],
    );
    // Nothing to carry when the listing succeeded.
    const { budgetsMissing: _, ...fresh } = next;
    assert.equal(carryBudgets(fresh, previous), fresh);
    // Nor into a new billing month: last month's spend is not current.
    const nextMonth = { ...next, lastUpdated: Date.UTC(2026, 10, 1, 1) };
    assert.deepEqual(
      carryBudgets(nextMonth, previous).windows.map((row) => row.id),
      ['acme:actions-minutes', 'octo:actions-minutes'],
    );
  });
});

describe('Actions minutes', () => {
  it('counts slim and Arm standard runners and leaves larger runners out', () => {
    const items = [
      { sku: 'actions_linux_slim', grossQuantity: 10 },
      { sku: 'actions_linux_arm', grossQuantity: 20 },
      { sku: 'actions_windows_arm', grossQuantity: 5 },
      { sku: 'actions_linux_4_core', grossQuantity: 100 },
    ].map((item) => ({ product: 'actions', netAmount: 0, ...item }));
    assert.equal(actionsMinutes(items as Parameters<typeof actionsMinutes>[0]), 40);
  });
});

describe('GitHub usage request', () => {
  let store: Record<string, unknown>;

  beforeEach(() => {
    store = { github_token: 'test-token' };
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
    mock.timers.reset();
    delete (globalThis as { chrome?: unknown }).chrome;
  });

  it('reads the user and every org it can bill, skipping orgs it cannot', async () => {
    const requests: string[] = [];
    mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
      requests.push(url);
      assert.equal(new Headers(init.headers).get('Authorization'), 'Bearer test-token');
      const path = url.replace('https://api.github.com', '');
      if (path === '/user') {
        return Response.json(
          { login: 'octo', plan: { name: 'pro' } },
          { headers: { 'X-OAuth-Scopes': 'read:org, user' } },
        );
      }
      if (path.startsWith('/user/orgs'))
        return Response.json([{ login: 'acme' }, { login: 'other' }]);
      if (path === '/orgs/acme') return Response.json({ plan: { name: 'enterprise' } });
      if (path === '/orgs/other') return Response.json({});
      if (path.startsWith('/organizations/acme/settings/billing/usage/summary')) {
        assert.match(path, /year=2026&month=10$/);
        return Response.json(summary);
      }
      if (path.startsWith('/organizations/acme/settings/billing/budgets'))
        return Response.json(budgets);
      if (path.startsWith('/users/octo/settings/billing/usage/summary')) {
        return Response.json({ usageItems: [] });
      }
      return new Response('{}', { status: 403 });
    });

    const usage = await GithubService.fetchUsage(NOW);
    assert.ok(usage);
    assert.equal(usage.viewer, 'octo');
    assert.deepEqual(
      usage.accounts.map((account) => account.login),
      ['acme', 'octo'],
    );
    assert.deepEqual(
      usage.windows.map((row) => row.id),
      [
        'acme:actions-minutes',
        'acme:budget:actions',
        'acme:budget:ai_credits',
        'octo:actions-minutes',
      ],
    );
    assert.ok(!requests.some((url) => url.includes('/users/octo/settings/billing/budgets')));
    assert.deepEqual(usage.unreadable, [{ login: 'other', status: 403 }]);
  });

  it('reads orgs saved with a fine-grained token, which cannot list them', async () => {
    store = { github_token: 'github_pat_test', github_orgs: ['acme'] };
    mock.method(globalThis, 'fetch', async (url: string) => {
      const path = url.replace('https://api.github.com', '');
      if (path === '/user') return Response.json({ login: 'octo' });
      // Fine-grained tokens always get an empty org list.
      if (path.startsWith('/user/orgs')) return Response.json([]);
      if (path === '/orgs/acme') return Response.json({ plan: { name: 'enterprise' } });
      if (path.startsWith('/organizations/acme/settings/billing/usage/summary')) {
        return Response.json(summary);
      }
      if (path.startsWith('/organizations/acme/settings/billing/budgets'))
        return Response.json(budgets);
      // An org-owned token cannot read the personal report.
      return new Response('{}', { status: 404 });
    });

    const usage = await GithubService.fetchUsage(NOW);
    assert.ok(usage);
    assert.deepEqual(
      usage.accounts.map((account) => account.login),
      ['acme'],
    );
    assert.equal(usage.windows[0].limit.used, 18483);
    // The personal account failing is expected with an org token, so it is not reported.
    assert.deepEqual(usage.unreadable, []);
  });

  it('follows every page of organization memberships', async () => {
    const orgPages: string[] = [];
    mock.method(globalThis, 'fetch', async (url: string) => {
      const path = url.replace('https://api.github.com', '');
      if (path === '/user') return Response.json({ login: 'octo' });
      if (path.startsWith('/user/orgs')) {
        orgPages.push(path);
        if (path.endsWith('&page=1')) {
          return Response.json(Array.from({ length: 100 }, (_, i) => ({ login: `org-${i}` })));
        }
        return Response.json([{ login: 'last-org' }]);
      }
      return new Response('{}', { status: 404 });
    });

    const usage = await GithubService.fetchUsage(NOW);
    assert.deepEqual(orgPages, [
      '/user/orgs?per_page=100&page=1',
      '/user/orgs?per_page=100&page=2',
    ]);
    assert.ok(usage?.unreadable.some((entry) => entry.login === 'last-org'));
  });

  it('keeps a newer token when an older one is rejected mid-refresh', async () => {
    mock.method(globalThis, 'fetch', async () => {
      store.github_token = 'newer-token';
      return new Response('{}', { status: 401 });
    });
    assert.equal(await GithubService.fetchUsage(NOW, 'test-token'), null);
    assert.equal(store.github_token, 'newer-token');
  });

  it('saves a pasted token only after GitHub accepts it', async () => {
    store = {};
    mock.method(globalThis, 'fetch', async (_url: string, init: RequestInit) =>
      new Headers(init.headers).get('Authorization') === 'Bearer good-token'
        ? Response.json({ login: 'octo' })
        : new Response('{}', { status: 401 }),
    );

    await assert.rejects(GithubService.saveToken('bad-token', ['acme']), /token_rejected/);
    assert.equal(store.github_token, undefined);

    await GithubService.saveToken('  good-token ', [' acme ', '']);
    assert.equal(store.github_token, 'good-token');
    assert.deepEqual(store.github_orgs, ['acme']);

    await GithubService.signOut();
    assert.equal(store.github_token, undefined);
    assert.equal(store.github_orgs, undefined);
  });

  it('subtracts minutes run in public repositories', async () => {
    store = { github_token: 'github_pat_test', github_orgs: ['acme'] };
    const requests: string[] = [];
    mock.method(globalThis, 'fetch', async (url: string) => {
      const path = url.replace('https://api.github.com', '');
      requests.push(path);
      if (path === '/user') return Response.json({ login: 'octo' });
      if (path.startsWith('/user/orgs')) return Response.json([]);
      if (path === '/orgs/acme') return Response.json({ plan: { name: 'enterprise' } });
      if (path.startsWith('/organizations/acme/settings/billing/usage?')) {
        return Response.json({
          usageItems: [
            { repositoryName: 'private-app', unitType: 'Minutes', quantity: 18000 },
            // GitHub's documented example names repositories `owner/name`.
            { repositoryName: 'acme/open-lib', unitType: 'Minutes', quantity: 223 },
            { repositoryName: 'open-docs', unitType: 'GigabyteHours', quantity: 1 },
          ],
        });
      }
      if (path === '/orgs/acme/repos?type=public&per_page=100&page=1') {
        // A full first page sends the listing on to page 2.
        return Response.json([
          ...Array.from({ length: 99 }, (_, i) => ({ name: `filler-${i}` })),
          { name: 'open-docs' },
        ]);
      }
      if (path === '/orgs/acme/repos?type=public&per_page=100&page=2') {
        return Response.json([{ name: 'open-lib' }]);
      }
      if (path.endsWith('&repository=acme/open-lib')) {
        return Response.json({
          usageItems: [{ product: 'Actions', sku: 'actions_linux', grossQuantity: 223 }],
        });
      }
      if (path.startsWith('/organizations/acme/settings/billing/usage/summary')) {
        return Response.json(summary);
      }
      return new Response('{}', { status: 404 });
    });

    const usage = await GithubService.fetchUsage(NOW);
    // 18,483 weighted minutes in total, 223 of them free in open-lib.
    assert.equal(usage?.windows[0].limit.used, 18260);
    // open-docs only stored artifacts, so it is never summarised.
    assert.ok(!requests.some((path) => path.endsWith('repository=acme/open-docs')));
  });

  it('reads every page of the budget listing', async () => {
    store = { github_token: 'github_pat_test', github_orgs: ['acme'] };
    mock.method(globalThis, 'fetch', async (url: string) => {
      const path = url.replace('https://api.github.com', '');
      if (path === '/user') return Response.json({ login: 'octo' });
      if (path.startsWith('/user/orgs')) return Response.json([]);
      if (path === '/orgs/acme') return Response.json({ plan: { name: 'enterprise' } });
      if (path.startsWith('/organizations/acme/settings/billing/usage/summary')) {
        return Response.json(summary);
      }
      if (path === '/organizations/acme/settings/billing/budgets?per_page=100&page=1') {
        return Response.json({
          budgets: [{ budget_product_sku: 'actions', budget_amount: 50 }],
          has_next_page: true,
        });
      }
      if (path === '/organizations/acme/settings/billing/budgets?per_page=100&page=2') {
        return Response.json({
          budgets: [{ budget_product_sku: 'ai_credits', budget_amount: 50 }],
          has_next_page: false,
        });
      }
      return new Response('{}', { status: 404 });
    });

    const usage = await GithubService.fetchUsage(NOW);
    assert.deepEqual(
      usage?.windows.map((row) => row.id),
      ['acme:actions-minutes', 'acme:budget:actions', 'acme:budget:ai_credits'],
    );
  });

  it('treats a failed later budget page as a failed listing', async () => {
    store = { github_token: 'github_pat_test', github_orgs: ['acme'] };
    mock.method(globalThis, 'fetch', async (url: string) => {
      const path = url.replace('https://api.github.com', '');
      if (path === '/user') return Response.json({ login: 'octo' });
      if (path.startsWith('/user/orgs')) return Response.json([]);
      if (path.startsWith('/organizations/acme/settings/billing/usage/summary')) {
        return Response.json(summary);
      }
      if (path === '/orgs/acme') return Response.json({ plan: { name: 'enterprise' } });
      if (path.endsWith('/budgets?per_page=100&page=1')) {
        return Response.json({ budgets: budgets.budgets, has_next_page: true });
      }
      return new Response('{}', { status: 403 });
    });

    const usage = await GithubService.fetchUsage(NOW);
    assert.deepEqual(
      usage?.windows.map((row) => row.id),
      ['acme:actions-minutes'],
    );
    assert.deepEqual(usage?.budgetsMissing, ['acme']);
  });

  it('signs out when GitHub rejects the stored token', async () => {
    mock.method(globalThis, 'fetch', async () => new Response('{}', { status: 401 }));
    assert.equal(await GithubService.fetchUsage(NOW), null);
    assert.equal(store.github_token, undefined);
  });

  it('returns nothing without a token', async () => {
    delete store.github_token;
    const fetchMock = mock.method(globalThis, 'fetch', async () => Response.json({}));
    assert.equal(await GithubService.fetchUsage(NOW), null);
    assert.equal(fetchMock.mock.callCount(), 0);
  });

  it('stores the device code, then the token once GitHub approves it', async () => {
    delete store.github_token;
    mock.timers.enable({ apis: ['setTimeout'] });
    const tokenResponses = [
      { error: 'authorization_pending' },
      { access_token: 'granted-token', token_type: 'bearer' },
    ];
    mock.method(globalThis, 'fetch', async (url: string, init: RequestInit) => {
      const body = new URLSearchParams(String(init.body));
      if (url === 'https://github.com/login/device/code') {
        assert.ok(body.get('client_id'));
        assert.equal(body.get('scope'), 'read:org user');
        return Response.json({
          device_code: 'device-123',
          user_code: 'ABCD-1234',
          verification_uri: 'https://github.com/login/device',
          expires_in: 900,
          interval: 5,
        });
      }
      assert.equal(url, 'https://github.com/login/oauth/access_token');
      assert.equal(body.get('device_code'), 'device-123');
      return Response.json(tokenResponses.shift());
    });

    let signedIn = false;
    const flow = await GithubService.startSignIn(() => {
      signedIn = true;
    });
    assert.equal(flow.userCode, 'ABCD-1234');
    assert.deepEqual((store.github_device_flow as { userCode: string }).userCode, 'ABCD-1234');

    for (let round = 0; round < 2 && !signedIn; round += 1) {
      mock.timers.tick(5000);
      for (let i = 0; i < 20; i += 1) await new Promise((resolve) => setImmediate(resolve));
    }

    assert.equal(signedIn, true);
    assert.equal(store.github_token, 'granted-token');
    assert.equal(store.github_device_flow, undefined);
  });

  it('discards a token that arrives after the sign-in was cancelled', async () => {
    delete store.github_token;
    mock.timers.enable({ apis: ['setTimeout'] });
    mock.method(globalThis, 'fetch', async (url: string) => {
      if (url.endsWith('/device/code')) {
        return Response.json({
          device_code: 'd',
          user_code: 'LATE-0000',
          verification_uri: 'https://github.com/login/device',
          expires_in: 900,
          interval: 5,
        });
      }
      // The user cancels while the token request is in flight.
      await GithubService.signOut();
      return Response.json({ access_token: 'late-token' });
    });

    await GithubService.startSignIn(() => assert.fail('should not sign in'));
    mock.timers.tick(5000);
    for (let i = 0; i < 20; i += 1) await new Promise((resolve) => setImmediate(resolve));

    assert.equal(store.github_token, undefined);
  });

  it('records why a device sign-in ended without a token', async () => {
    delete store.github_token;
    mock.timers.enable({ apis: ['setTimeout'] });
    mock.method(globalThis, 'fetch', async (url: string) =>
      url.endsWith('/device/code')
        ? Response.json({
            device_code: 'd',
            user_code: 'WXYZ-0000',
            verification_uri: 'https://github.com/login/device',
            expires_in: 900,
            interval: 5,
          })
        : Response.json({ error: 'access_denied' }),
    );

    await GithubService.startSignIn(() => assert.fail('should not sign in'));
    mock.timers.tick(5000);
    for (let i = 0; i < 20; i += 1) await new Promise((resolve) => setImmediate(resolve));

    assert.equal((store.github_device_flow as { error?: string }).error, 'access_denied');
    assert.equal(store.github_token, undefined);
  });
});
