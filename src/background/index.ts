import { REFRESH_ALARM, REFRESH_INTERVAL_MINUTES } from '../shared/constants';
import type { ExtensionMessage, MessageResponse, UsageState } from '../shared/types';
import { updateBadge } from './badge';
import { GithubService } from './services/GithubService';
import { UsageService } from './services/UsageService';

let hasStartedRefresh = false;
let refreshInFlight: Promise<UsageState> | null = null;
let badgeUpdateQueue: Promise<void> = Promise.resolve();

const queueBadgeUpdate = (state: UsageState): Promise<void> => {
  badgeUpdateQueue = badgeUpdateQueue.catch(() => undefined).then(() => updateBadge(state));
  return badgeUpdateQueue;
};

const refreshUsage = (): Promise<UsageState> => {
  if (refreshInFlight) {
    return refreshInFlight;
  }

  hasStartedRefresh = true;
  refreshInFlight = UsageService.refreshAllUsage()
    .then(async (state) => {
      await queueBadgeUpdate(state);
      return state;
    })
    .finally(() => {
      refreshInFlight = null;
    });

  return refreshInFlight;
};

void UsageService.getUsageState()
  .then((state) => (hasStartedRefresh ? undefined : queueBadgeUpdate(state)))
  .catch(() => undefined);

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(REFRESH_ALARM, { periodInMinutes: REFRESH_INTERVAL_MINUTES });
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

const signOutOfGithub = async (): Promise<UsageState> => {
  await GithubService.signOut();
  const state = await UsageService.getUsageState();
  delete state.github;
  await UsageService.saveUsageState(state);
  await queueBadgeUpdate(state);
  return state;
};

chrome.runtime.onMessage.addListener(
  (message: ExtensionMessage, _sender, sendResponse: (response: MessageResponse) => void) => {
    switch (message?.type) {
      case 'REFRESH_USAGE':
        return respond(refreshUsage(), sendResponse, 'refresh_failed');
      case 'GITHUB_SIGN_IN':
        return respond(
          GithubService.startSignIn(() => void refreshUsage().catch(() => undefined)),
          sendResponse,
          'sign_in_failed',
        );
      case 'GITHUB_SIGN_OUT':
        return respond(signOutOfGithub(), sendResponse, 'sign_out_failed');
      default:
        return undefined;
    }
  },
);
