const FALLBACK_MESSAGES: Record<string, string> = {
  appName: 'AI Usage Tracker: Claude & Codex Limits',
  appShortName: 'AI Usage Tracker',
  appDescription:
    'Track Claude and ChatGPT (Codex) session and weekly usage limits in a popup, toolbar badge, and on-page overlay. Privacy-first, no setup.',
  popupEyebrow: 'AI Capacity',
  popupTitle: 'Usage',
  netlifyBuildMinutes: 'Build minutes',
  netlifyBandwidth: 'Bandwidth',
  emptyNetlify: 'Paste a Netlify personal access token to see build minutes and bandwidth.',
  netlifyCreateToken: 'Create one on Netlify',
  unitGigabytes: '$1 / $2 GB',
  cycleShort: 'this cycle',
  openUsagePage: 'Open $1 usage page',
  weeklyShort: 'weekly',
  monthShort: 'this month',
  resetsHeading: 'Resets available · $1',
  expiresLabel: 'expires $1',
  headlineHit: '$1 limit reached',
  headlineWatch: '$1 limit at $2%',
  headlineClear: 'All limits comfortable',
  headlineHighest: 'highest is $1 at $2%',
  refreshUsage: 'Refresh usage',
  refreshUsageLimits: 'Refresh usage limits',
  refreshErrorPrefix: 'Couldn’t refresh',
  refreshFailed: 'Refresh failed',
  availableResetsLabel: 'Available resets · $1',
  fullReset: 'Full reset',
  resetExpiresLabel: '$1 · expires $2',
  loadingSnapshot: 'loading snapshot',
  notConnected: 'not connected',
  updated: 'updated $1',
  refreshing: 'refreshing...',
  waitingForSnapshot: 'waiting for snapshot',
  sessionLimit: 'Session · 5h',
  dailyLimit: 'Daily · 1d',
  weeklyLimit: 'Weekly · 7d',
  monthlyLimit: 'Monthly · 30d',
  annualLimit: 'Annual · 1y',
  usageLimit: 'Usage limit',
  secondaryUsageLimit: 'Secondary usage limit',
  percentUsed: '$1% used',
  planLabel: 'Plan · $1',
  resetsLabel: 'resets $1',
  paceElapsedLabel: '$1% through',
  paceDeltaLabel: '$1 pts',
  paceProjectionLabel: 'at this rate: limit ~$1 before reset',
  nextResetLabel: 'resets $1',
  showLimits: 'Show limits',
  hideLimits: 'Hide limits',
  limitsTab: 'LIMITS',
  emptyClaude: 'No data yet. Open claude.ai while signed in, then refresh.',
  emptyCodex: 'No data yet. Open chatgpt.com while signed in, then refresh.',
  emptyOverlay: 'No data yet. Open the popup and refresh.',
  emptyGithub:
    'Sign in to see Actions minutes and budget spend for your account and organizations.',
  githubActionsMinutes: 'Actions minutes',
  githubBudget: '$1 budget',
  githubUseToken: 'Use a token instead',
  githubTokenHint:
    'Fine-grained token owned by the organization, with read-only Administration and Plan access.',
  githubTokenLabel: 'Token',
  githubOrgLabel: 'Organization',
  githubSaveToken: 'Save token',
  githubCreateToken: 'Create one on GitHub',
  githubUnreadable: 'Can’t read billing for $1 (HTTP $2)',
  githubSignIn: 'Sign in with GitHub',
  githubSignOut: 'Sign out',
  githubCancel: 'Cancel',
  githubEnterCode: 'Enter this code on GitHub:',
  githubOpenAndCopy: 'Copy code and open GitHub',
  githubWaiting: 'Waiting for approval…',
  githubSignInFailed: 'Sign-in didn’t finish ($1). Try again.',
  githubSignedInAs: 'Signed in as $1',
  githubNoBilling: 'This account can’t read any billing usage.',
  unitMinutes: '$1 / $2 min',
  sourceCode: 'Source code',
  github: 'GitHub',
  timeUnknown: 'unknown',
  timeNow: 'now',
  timeJustNow: 'just now',
  timeAgo: '$1 ago',
  timeDayShort: 'd',
  timeHourShort: 'h',
  timeMinuteShort: 'm',
};

export const msg = (name: string, substitutions?: string | string[]): string => {
  const value = globalThis.chrome?.i18n?.getMessage(name, substitutions);
  if (value) {
    return value;
  }

  const fallback = FALLBACK_MESSAGES[name] ?? name;
  const values = Array.isArray(substitutions)
    ? substitutions
    : substitutions
      ? [substitutions]
      : [];

  return values.reduce(
    (text, substitution, index) => text.split(`$${index + 1}`).join(substitution),
    fallback,
  );
};
