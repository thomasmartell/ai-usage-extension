import { STORAGE_KEYS } from './constants';
import type { ExtensionMessage, GithubDeviceFlow, MessageResponse, UsageState } from './types';

/**
 * Read the last persisted usage snapshot from `chrome.storage.local`.
 * Safe to call from any extension context.
 */
export const readUsageState = async (): Promise<UsageState> => {
  const data = await chrome.storage.local.get(STORAGE_KEYS.usageState);
  return (data[STORAGE_KEYS.usageState] ?? {}) as UsageState;
};

const sendToBackground = async <T>(message: ExtensionMessage): Promise<T> => {
  const response = (await chrome.runtime.sendMessage(message)) as MessageResponse<T> | undefined;

  if (!response) {
    throw new Error('No response from the background worker');
  }

  if (!response.success) {
    throw new Error(response.error);
  }

  return response.data;
};

/**
 * Ask the background worker to fetch fresh usage for every provider.
 * Resolves with the new snapshot or throws with a descriptive error.
 */
export const requestUsageRefresh = (): Promise<UsageState> =>
  sendToBackground<UsageState>({ type: 'REFRESH_USAGE' });

/** Start GitHub device-flow sign-in; resolves with the code to show the user. */
export const requestGithubSignIn = (): Promise<GithubDeviceFlow> =>
  sendToBackground<GithubDeviceFlow>({ type: 'GITHUB_SIGN_IN' });

/** Store a pasted GitHub token and the org logins it should read. */
export const requestGithubSaveToken = (token: string, orgs: string[]): Promise<UsageState> =>
  sendToBackground<UsageState>({ type: 'GITHUB_SAVE_TOKEN', token, orgs });

/** Forget the stored GitHub token and its usage snapshot. */
export const requestGithubSignOut = (): Promise<UsageState> =>
  sendToBackground<UsageState>({ type: 'GITHUB_SIGN_OUT' });

/** Store a pasted Netlify personal access token. */
export const requestNetlifySaveToken = (token: string): Promise<UsageState> =>
  sendToBackground<UsageState>({ type: 'NETLIFY_SAVE_TOKEN', token });

/** Forget the stored Netlify token and its usage snapshot. */
export const requestNetlifySignOut = (): Promise<UsageState> =>
  sendToBackground<UsageState>({ type: 'NETLIFY_SIGN_OUT' });
