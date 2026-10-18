import { useCallback, useEffect, useState } from 'react';
import { STORAGE_KEYS } from '../../shared/constants';
import { requestGithubSignIn, requestGithubSignOut } from '../../shared/messaging';
import type { GithubDeviceFlow } from '../../shared/types';

export interface GithubAuth {
  signedIn: boolean;
  /** The device-flow code waiting for approval, if a sign-in is in progress. */
  deviceFlow: GithubDeviceFlow | null;
  starting: boolean;
  error: string | null;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
}

/** Sign-in state for the GitHub card, kept in sync with `chrome.storage.local`. */
export const useGithubAuth = (): GithubAuth => {
  const [signedIn, setSignedIn] = useState(false);
  const [deviceFlow, setDeviceFlow] = useState<GithubDeviceFlow | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    void chrome.storage.local
      .get([STORAGE_KEYS.githubToken, STORAGE_KEYS.githubDeviceFlow])
      .then((stored) => {
        if (!active) return;
        setSignedIn(Boolean(stored[STORAGE_KEYS.githubToken]));
        setDeviceFlow((stored[STORAGE_KEYS.githubDeviceFlow] as GithubDeviceFlow) ?? null);
      });

    const listener = (
      changes: Record<string, chrome.storage.StorageChange>,
      areaName: string,
    ): void => {
      if (areaName !== 'local') return;
      if (changes[STORAGE_KEYS.githubToken]) {
        setSignedIn(Boolean(changes[STORAGE_KEYS.githubToken].newValue));
      }
      if (changes[STORAGE_KEYS.githubDeviceFlow]) {
        setDeviceFlow(
          (changes[STORAGE_KEYS.githubDeviceFlow].newValue as GithubDeviceFlow) ?? null,
        );
      }
    };

    chrome.storage.onChanged.addListener(listener);
    return () => {
      active = false;
      chrome.storage.onChanged.removeListener(listener);
    };
  }, []);

  const signIn = useCallback(async (): Promise<void> => {
    setStarting(true);
    setError(null);
    try {
      setDeviceFlow(await requestGithubSignIn());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'sign_in_failed');
    } finally {
      setStarting(false);
    }
  }, []);

  const signOut = useCallback(async (): Promise<void> => {
    setError(null);
    await requestGithubSignOut();
  }, []);

  return { signedIn, deviceFlow, starting, error, signIn, signOut };
};
