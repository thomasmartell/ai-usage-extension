import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';
import { GithubService } from '../src/background/services/GithubService';
import { NetlifyService } from '../src/background/services/NetlifyService';
import { UsageService } from '../src/background/services/UsageService';
import type { UsageState } from '../src/shared/types';

describe('Usage state updates', () => {
  afterEach(() => {
    delete (globalThis as { chrome?: unknown }).chrome;
    mock.restoreAll();
  });

  it('applies concurrent changes in turn, so neither overwrites the other', async () => {
    let stored: Record<string, unknown> = {
      ai_usage_state: { github: { viewer: 'octo' }, netlify: { teams: [] } },
    };
    // Storage that answers slowly, as a real round trip can.
    const later = <T>(value: T) => new Promise<T>((resolve) => setTimeout(() => resolve(value), 5));
    (globalThis as { chrome?: unknown }).chrome = {
      storage: {
        local: {
          get: async () => later(structuredClone(stored)),
          set: async (items: Record<string, unknown>) => {
            await later(undefined);
            stored = { ...stored, ...structuredClone(items) };
          },
        },
      },
    };

    await Promise.all([
      UsageService.updateUsageState((state) => void delete state.github),
      UsageService.updateUsageState((state) => void delete state.netlify),
    ]);
    assert.deepEqual(stored.ai_usage_state as UsageState, {});
  });

  it('leaves a recent GitHub and Netlify snapshot alone unless forced', async () => {
    const minutesAgo = (minutes: number) => Date.now() - minutes * 60_000;
    let stored: Record<string, unknown> = {
      github_token: 'gho_test',
      netlify_token: 'nfp_test',
      ai_usage_state: {
        github: { viewer: 'octo', lastUpdated: minutesAgo(10) },
        netlify: { teams: [], lastUpdated: minutesAgo(20) },
      },
    };
    (globalThis as { chrome?: unknown }).chrome = {
      storage: {
        local: {
          get: async () => structuredClone(stored),
          set: async (items: Record<string, unknown>) => {
            stored = { ...stored, ...structuredClone(items) };
          },
        },
      },
    };
    mock.method(UsageService, 'fetchClaudeUsage', async () => null);
    mock.method(UsageService, 'fetchCodexUsage', async () => null);
    const github = mock.method(GithubService, 'fetchUsage', async () => null);
    const rate = { percentage: 11, resetsAt: '2026-10-18T19:52:40.000Z', used: 539, limit: 5000 };
    mock.method(GithubService, 'fetchRateLimit', async () => rate);
    const netlify = mock.method(NetlifyService, 'fetchUsage', async () => null);

    // GitHub was read 10 minutes ago (under 30); Netlify 20 (over 15).
    await UsageService.refreshAllUsage();
    assert.equal(github.mock.callCount(), 0);
    assert.equal(netlify.mock.callCount(), 1);
    // The free hourly-allowance read still updates the snapshot.
    assert.deepEqual((stored.ai_usage_state as UsageState).github?.apiLimit, rate);

    await UsageService.refreshAllUsage({ force: true });
    assert.equal(github.mock.callCount(), 1);
    assert.equal(netlify.mock.callCount(), 2);
  });
});
