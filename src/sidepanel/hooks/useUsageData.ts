import { useCallback, useEffect, useState } from 'react';
import { STORAGE_KEYS } from '../../shared/constants';
import { msg } from '../../shared/i18n';
import { readUsageState, requestUsageRefresh } from '../../shared/messaging';
import type { UsageState } from '../../shared/types';

export interface UsageData {
  usage: UsageState;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export const useUsageData = (): UsageData => {
  const [usage, setUsage] = useState<UsageState>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    const hydrate = async (): Promise<void> => {
      const state = await readUsageState();

      if (!active) {
        return;
      }

      setUsage(state);
      setLoading(false);
    };

    void hydrate();

    const listener = (
      changes: Record<string, chrome.storage.StorageChange>,
      areaName: string,
    ): void => {
      if (areaName !== 'local') {
        return;
      }

      if (changes[STORAGE_KEYS.usageState]) {
        setUsage((changes[STORAGE_KEYS.usageState].newValue ?? {}) as UsageState);
      }
    };

    chrome.storage.onChanged.addListener(listener);
    return () => {
      active = false;
      chrome.storage.onChanged.removeListener(listener);
    };
  }, []);

  const refresh = useCallback(async (): Promise<void> => {
    setRefreshing(true);
    setError(null);
    try {
      setUsage(await requestUsageRefresh());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : msg('refreshFailed'));
    } finally {
      setRefreshing(false);
    }
  }, []);

  return { usage, loading, refreshing, error, refresh };
};
