import { REFRESH_ALARM, REFRESH_INTERVAL_MINUTES } from '../shared/constants';
import type { ExtensionMessage, MessageResponse, UsageState } from '../shared/types';
import { updateBadge } from './badge';
import { createRefresher } from './refreshQueue';
import { GithubService } from './services/GithubService';
import { NetlifyService } from './services/NetlifyService';
import { UsageService } from './services/UsageService';

const LEGACY_OVERLAY_KEYS = [
  'claude_overlay_enabled',
  'claude_overlay_collapsed',
  'codex_overlay_enabled',
  'codex_overlay_collapsed',
];

let hasStartedRefresh = false;
let badgeUpdateQueue: Promise<void> = Promise.resolve();

const queueBadgeUpdate = (state: UsageState): Promise<void> => {
  badgeUpdateQueue = badgeUpdateQueue.catch(() => undefined).then(() => updateBadge(state));
  return badgeUpdateQueue;
};

/** `force` fetches GitHub and Netlify even if their snapshot is still recent. */
const { refresh: refreshUsage, refreshAfterChange: refreshUsageAfterChange } = createRefresher(
  async ({ force }) => {
    hasStartedRefresh = true;
    const state = await UsageService.refreshAllUsage({ force });
    await queueBadgeUpdate(state);
    return state;
  },
);

void UsageService.getUsageState()
  .then((state) => (hasStartedRefresh ? undefined : queueBadgeUpdate(state)))
  .catch(() => undefined);

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(REFRESH_ALARM, { periodInMinutes: REFRESH_INTERVAL_MINUTES });
  // Preferences left behind by the on-page overlays, which have been removed.
  void chrome.storage.local.remove(LEGACY_OVERLAY_KEYS);
  void refreshUsage().catch(() => undefined);
});

chrome.runtime.onStartup.addListener(() => {
  void refreshUsage().catch(() => undefined);
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === REFRESH_ALARM) {
    void refreshUsage().catch(() => undefined);
  }
});

const respond = <T>(
  work: Promise<T>,
  sendResponse: (response: MessageResponse<T>) => void,
  fallbackError: string,
): true => {
  work
    .then((data) => sendResponse({ success: true, data }))
    .catch((error: unknown) => {
      sendResponse({
        success: false,
        error: error instanceof Error ? error.message : fallbackError,
      });
    });
  return true;
};

/** Forget a provider's token and drop its snapshot from the stored state. */
const signOutOf = async (
  provider: 'github' | 'netlify',
  signOut: () => Promise<void>,
): Promise<UsageState> => {
  await signOut();
  const state = await UsageService.updateUsageState((current) => {
    delete current[provider];
  });
  await queueBadgeUpdate(state);
  return state;
};

chrome.runtime.onMessage.addListener(
  (message: ExtensionMessage, _sender, sendResponse: (response: MessageResponse) => void) => {
    switch (message?.type) {
      case 'REFRESH_USAGE':
        // Asked for from the popup, so every provider is fetched now.
        return respond(refreshUsage({ force: true }), sendResponse, 'refresh_failed');
      case 'GITHUB_SIGN_IN':
        return respond(
          GithubService.startSignIn(() => void refreshUsageAfterChange().catch(() => undefined)),
          sendResponse,
          'sign_in_failed',
        );
      case 'GITHUB_SAVE_TOKEN':
        return respond(
          GithubService.saveToken(message.token, message.orgs).then(refreshUsageAfterChange),
          sendResponse,
          'token_rejected',
        );
      case 'GITHUB_SIGN_OUT':
        return respond(
          signOutOf('github', () => GithubService.signOut()),
          sendResponse,
          'sign_out_failed',
        );
      case 'NETLIFY_SAVE_TOKEN':
        return respond(
          NetlifyService.saveToken(message.token).then(refreshUsageAfterChange),
          sendResponse,
          'token_rejected',
        );
      case 'NETLIFY_SIGN_OUT':
        return respond(
          signOutOf('netlify', () => NetlifyService.signOut()),
          sendResponse,
          'sign_out_failed',
        );
      default:
        return undefined;
    }
  },
);
