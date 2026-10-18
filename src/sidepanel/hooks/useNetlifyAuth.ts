import { useCallback, useEffect, useState } from 'react';
import { STORAGE_KEYS } from '../../shared/constants';
import { requestNetlifySaveToken, requestNetlifySignOut } from '../../shared/messaging';

export interface NetlifyAuth {
  signedIn: boolean;
  saving: boolean;
  error: string | null;
  saveToken: (token: string) => Promise<void>;
  signOut: () => Promise<void>;
}

/** Whether a Netlify token is stored, kept in sync with `chrome.storage.local`. */
export const useNetlifyAuth = (): NetlifyAuth => {
  const [signedIn, setSignedIn] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void chrome.storage.local.get(STORAGE_KEYS.netlifyToken).then((stored) => {
      if (active) setSignedIn(Boolean(stored[STORAGE_KEYS.netlifyToken]));
    });

    const listener = (
      changes: Record<string, chrome.storage.StorageChange>,
      areaName: string,
    ): void => {
      if (areaName === 'local' && changes[STORAGE_KEYS.netlifyToken]) {
        setSignedIn(Boolean(changes[STORAGE_KEYS.netlifyToken].newValue));
      }
    };

    chrome.storage.onChanged.addListener(listener);
    return () => {
      active = false;
      chrome.storage.onChanged.removeListener(listener);
    };
  }, []);

  const saveToken = useCallback(async (token: string): Promise<void> => {
    setSaving(true);
    setError(null);
    try {
      await requestNetlifySaveToken(token);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'token_rejected');
    } finally {
      setSaving(false);
    }
  }, []);

  const signOut = useCallback(async (): Promise<void> => {
    setError(null);
    await requestNetlifySignOut();
  }, []);

  return { signedIn, saving, error, saveToken, signOut };
};
