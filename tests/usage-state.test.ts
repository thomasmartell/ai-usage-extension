import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { UsageService } from '../src/background/services/UsageService';
import type { UsageState } from '../src/shared/types';

describe('Usage state updates', () => {
  afterEach(() => {
    delete (globalThis as { chrome?: unknown }).chrome;
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
});
