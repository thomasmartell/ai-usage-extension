import { useCallback, useEffect, useState } from 'react';
import { STORAGE_KEYS } from '../../shared/constants';
import { msg } from '../../shared/i18n';
import { readUsageState, requestUsageRefresh } from '../../shared/messaging';
import type { UsageState } from '../../shared/types';

export interface UsageData {
  usage: UsageState;
  claudeOverlayEnabled: boolean;
  codexOverlayEnabled: boolean;
  settingsExpanded: boolean;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  setClaudeOverlayEnabled: (enabled: boolean) => void;
  setCodexOverlayEnabled: (enabled: boolean) => void;
  setSettingsExpanded: (expanded: boolean) => void;
}

export const useUsageData = (): UsageData => {
  const [usage, setUsage] = useState<UsageState>({});
  const [claudeOverlayEnabled, setClaudeOverlayState] = useState(true);
  const [codexOverlayEnabled, setCodexOverlayState] = useState(true);
  const [settingsExpanded, setSettingsExpandedState] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    const hydrate = async (): Promise<void> => {
      const [state, settings] = await Promise.all([
        readUsageState(),
        chrome.storage.local.get([
          STORAGE_KEYS.claudeOverlayEnabled,
          STORAGE_KEYS.codexOverlayEnabled,
          STORAGE_KEYS.settingsExpanded,
        ]),
      ]);

      if (!active) {
        return;
      }

      setUsage(state);
      setClaudeOverlayState(settings[STORAGE_KEYS.claudeOverlayEnabled] !== false);
      setCodexOverlayState(settings[STORAGE_KEYS.codexOverlayEnabled] !== false);
      setSettingsExpandedState(settings[STORAGE_KEYS.settingsExpanded] === true);
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

      if (changes[STORAGE_KEYS.claudeOverlayEnabled]) {
        setClaudeOverlayState(changes[STORAGE_KEYS.claudeOverlayEnabled].newValue !== false);
      }

      if (changes[STORAGE_KEYS.codexOverlayEnabled]) {
        setCodexOverlayState(changes[STORAGE_KEYS.codexOverlayEnabled].newValue !== false);
      }

      if (changes[STORAGE_KEYS.settingsExpanded]) {
        setSettingsExpandedState(changes[STORAGE_KEYS.settingsExpanded].newValue === true);
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

  const setClaudeOverlayEnabled = useCallback((enabled: boolean): void => {
    setClaudeOverlayState(enabled);
    void chrome.storage.local.set({ [STORAGE_KEYS.claudeOverlayEnabled]: enabled });
  }, []);

  const setCodexOverlayEnabled = useCallback((enabled: boolean): void => {
    setCodexOverlayState(enabled);
    void chrome.storage.local.set({ [STORAGE_KEYS.codexOverlayEnabled]: enabled });
  }, []);

  const setSettingsExpanded = useCallback((expanded: boolean): void => {
    setSettingsExpandedState(expanded);
    void chrome.storage.local.set({ [STORAGE_KEYS.settingsExpanded]: expanded });
  }, []);

  return {
    usage,
    claudeOverlayEnabled,
    codexOverlayEnabled,
    settingsExpanded,
    loading,
    refreshing,
    error,
    refresh,
    setClaudeOverlayEnabled,
    setCodexOverlayEnabled,
    setSettingsExpanded,
  };
};
