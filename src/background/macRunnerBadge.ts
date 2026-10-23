import { busyRunnerCount, type MacRunnerState } from '../shared/macRunner';

const BADGE_COLOR = {
  on: '#3f8f4f',
  off: '#5c5a56',
  pending: '#b08243',
} as const;

/**
 * The toolbar badge text belongs to the Mac runner: ON (green), the number of
 * jobs running (green), … while starting or stopping (amber) or OFF (grey).
 * The usage meter keeps the icon itself.
 */
export const updateMacRunnerBadge = async (state: MacRunnerState | null): Promise<void> => {
  const status = state?.available ? state.status : undefined;
  if (!status) {
    await chrome.action.setBadgeText({ text: '' });
    return;
  }

  const busy = busyRunnerCount(status);
  const [text, color] =
    status.vm === 'starting' || status.vm === 'stopping'
      ? ['…', BADGE_COLOR.pending]
      : status.vm === 'on'
        ? [busy > 0 ? String(busy) : 'ON', BADGE_COLOR.on]
        : ['OFF', BADGE_COLOR.off];

  await Promise.all([
    chrome.action.setBadgeText({ text }),
    chrome.action.setBadgeBackgroundColor({ color }),
    chrome.action.setBadgeTextColor?.({ color: '#ffffff' }),
  ]);
};
