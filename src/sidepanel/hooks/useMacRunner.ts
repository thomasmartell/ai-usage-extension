import { useCallback, useEffect, useState } from 'react';
import { STORAGE_KEYS } from '../../shared/constants';
import {
  readMacRunnerState,
  refreshMacRunner,
  setMacRunnerPower,
  type MacRunnerState,
} from '../../shared/macRunner';

/** Poll faster while the VM is starting or stopping so the card settles quickly. */
const POLL_MS = 10_000;
const PENDING_POLL_MS = 3_000;

export interface MacRunnerData {
  state: MacRunnerState | null;
  /** Set while a start/stop request is on its way to the helper. */
  switching: boolean;
  switchError: string | null;
  setPower: (action: 'start' | 'stop') => Promise<void>;
}

export const useMacRunner = (): MacRunnerData => {
  const [state, setState] = useState<MacRunnerState | null>(null);
  const [switching, setSwitching] = useState(false);
  const [switchError, setSwitchError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void readMacRunnerState().then((stored) => active && setState(stored));
    void refreshMacRunner(true).then((fresh) => active && setState(fresh));

    const listener = (
      changes: Record<string, chrome.storage.StorageChange>,
      areaName: string,
    ): void => {
      const change = changes[STORAGE_KEYS.macRunnerState];
      if (areaName === 'local' && change) {
        setState((change.newValue ?? null) as MacRunnerState | null);
      }
    };
    chrome.storage.onChanged.addListener(listener);
    return () => {
      active = false;
      chrome.storage.onChanged.removeListener(listener);
    };
  }, []);

  const vm = state?.status?.vm;
  const available = state?.available === true;
  useEffect(() => {
    if (!available) {
      return undefined;
    }
    const pending = vm === 'starting' || vm === 'stopping';
    const id = window.setInterval(
      () => void refreshMacRunner(true),
      pending ? PENDING_POLL_MS : POLL_MS,
    );
    return () => window.clearInterval(id);
  }, [available, vm]);

  const setPower = useCallback(async (action: 'start' | 'stop'): Promise<void> => {
    setSwitching(true);
    setSwitchError(null);
    try {
      await setMacRunnerPower(action);
      await refreshMacRunner(true);
    } catch (cause) {
      setSwitchError(cause instanceof Error ? cause.message : `${action}_failed`);
    } finally {
      setSwitching(false);
    }
  }, []);

  return { state, switching, switchError, setPower };
};
