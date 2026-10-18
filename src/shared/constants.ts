/**
 * Single source of truth for keys and identifiers shared across every
 * extension context (background, content script, sidepanel/popup, welcome).
 */

export const STORAGE_KEYS = {
  /** Persisted `UsageState` snapshot. */
  usageState: 'ai_usage_state',
  /** Rolling 7-day history of usage samples, keyed per limit. */
  usageHistory: 'ai_usage_history',
  /** Cached Claude organization id used to build the usage endpoint. */
  claudeOrgId: 'claude_org_id',
  /** Whether the on-page overlay is shown on claude.ai. */
  claudeOverlayEnabled: 'claude_overlay_enabled',
  /** Whether the on-page overlay is collapsed into its side tab. */
  claudeOverlayCollapsed: 'claude_overlay_collapsed',
  codexOverlayEnabled: 'codex_overlay_enabled',
  codexOverlayCollapsed: 'codex_overlay_collapsed',
  /** OAuth token from GitHub's device flow; read only by the background worker. */
  githubToken: 'github_token',
  /** Organization logins saved with a pasted token, which cannot list them. */
  githubOrgs: 'github_orgs',
  /** Netlify personal access token pasted into the popup. */
  netlifyToken: 'netlify_token',
  /** Device-flow sign-in in progress (`GithubDeviceFlow`), shown by the popup. */
  githubDeviceFlow: 'github_device_flow',
} as const;

/** Name of the recurring alarm that refreshes usage in the background. */
export const REFRESH_ALARM = 'refreshUsage';

/** How often the background worker re-fetches usage, in minutes. */
export const REFRESH_INTERVAL_MINUTES = 5;

/** Fixed window lengths, in milliseconds, for the limits Claude reports. */
export const WINDOW_MS = {
  fiveHours: 5 * 60 * 60 * 1000,
  sevenDays: 7 * 24 * 60 * 60 * 1000,
} as const;

/** Percentage thresholds that drive the ok / warning / critical tone. */
export const USAGE_THRESHOLDS = {
  warning: 75,
  critical: 92,
} as const;

/**
 * GitHub OAuth App used for device-flow sign-in. A client id is public by
 * design; the device flow needs no client secret.
 */
export const GITHUB_OAUTH = {
  clientId: 'Ov23litw7j2JC0ecJHVP',
  /**
   * `user` reads the personal billing report; `read:org` lists the orgs to
   * check. Org billing endpoints accept only `admin:org` or `repo` from an
   * OAuth token, so org billing is read with a pasted fine-grained token
   * (read-only Administration) instead of asking for admin rights here.
   */
  scopes: 'read:org user',
} as const;
