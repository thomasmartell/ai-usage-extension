export type UsageStatus = 'ok' | 'warning' | 'critical';

export type ProviderId = 'claude' | 'codex' | 'github' | 'netlify';

export interface UsageLimit {
  percentage: number;
  resetsAt: string | null;
  used?: number;
  limit?: number;
  /** Length of the rolling window in ms, when the provider reports one. */
  windowMs?: number;
  /** What `used` and `limit` count; absent means a plain request count. */
  unit?: 'minutes' | 'usd' | 'gb' | 'credits';
}

export interface ModelUsage {
  id: string;
  label: string;
  limit: UsageLimit;
  /** Reset of a sibling window folded into this row (see `groupQuietModels`). */
  secondaryResetsAt?: string | null;
  /** Heading the row sits under, e.g. the GitHub account it belongs to. */
  group?: string;
}

/** A usage-limit reset credit the provider has granted and not yet spent. */
export interface UsageReset {
  id: string;
  label: string;
  /** When the credit lapses if unused; `null` when the provider gives no expiry. */
  expiresAt: string | null;
}

export interface ClaudeUsage {
  plan: string;
  session: UsageLimit;
  weekly: UsageLimit;
  models: ModelUsage[];
  /** Optional so snapshots written before resets were tracked still type-check. */
  resets?: UsageReset[];
  status: UsageStatus;
  lastUpdated: number;
  raw?: Record<string, unknown>;
}

export interface CodexUsage {
  /** Rate-limit windows returned by Codex, classified by their server duration. */
  windows: ModelUsage[];
  /** Legacy fields retained as optional so stored pre-upgrade snapshots still render. */
  session?: UsageLimit;
  weekly?: UsageLimit;
  models: ModelUsage[];
  resets?: UsageReset[];
  /** Count from the usage endpoint; kept so older snapshots still show a figure. */
  availableResets: number | null;
  status: UsageStatus;
  lastUpdated: number;
  diagnostics?: {
    requestAccountFingerprint: string | null;
    responseAccountFingerprint: string | null;
  };
  raw?: Record<string, unknown>;
}

/** A GitHub account whose billing usage the signed-in user can read. */
export interface GithubAccount {
  login: string;
  kind: 'user' | 'organization';
  /** Plan name as GitHub reports it, e.g. `pro` or `enterprise`. */
  plan: string | null;
}

export interface GithubUsage {
  /** Login of the user the stored token belongs to. */
  viewer: string;
  accounts: GithubAccount[];
  /** Monthly allowance and budget rows across every readable account. */
  windows: ModelUsage[];
  models: ModelUsage[];
  /**
   * Accounts the token could not read, with the HTTP status and the scopes
   * GitHub said the endpoint accepts (`X-Accepted-OAuth-Scopes`).
   */
  unreadable?: Array<{ login: string; status: number; acceptedScopes?: string }>;
  /** Accounts whose budget listing failed this time (rate limit, outage). */
  budgetsMissing?: string[];
  /** The org membership list failed part-way, so some orgs may be missing. */
  orgsIncomplete?: boolean;
  /** With `orgsIncomplete`: the orgs this refresh did find, readable or not. */
  orgsChecked?: string[];
  /** Accounts whose usage summary failed transiently, so their last rows are kept. */
  accountsMissing?: string[];
  /** Accounts whose public-repository minutes could not be read this time. */
  minutesMissing?: string[];
  status: UsageStatus;
  lastUpdated: number;
}

export interface NetlifyUsage {
  teams: Array<{ slug: string; name: string; plan: string | null }>;
  /** Credit, build-minute and bandwidth rows for the current billing cycle. */
  windows: ModelUsage[];
  /** Teams (or the team listing) that gave no meters, with the HTTP status that explains it. */
  unreadable?: Array<{ name: string; status: number }>;
  /** Slugs of teams whose credit lookup failed this time, so their last rows are kept. */
  creditsMissing?: string[];
  /** The team listing itself failed; nothing in this snapshot is current. */
  listingFailed?: boolean;
  /** Slugs of teams whose credit reply had no plan-credit pool (legacy or garbled). */
  creditsUnconfirmed?: string[];
  models: ModelUsage[];
  status: UsageStatus;
  lastUpdated: number;
}

/** A device-flow sign-in waiting for the user to enter its code on github.com. */
export interface GithubDeviceFlow {
  userCode: string;
  verificationUri: string;
  /** Epoch ms after which the code stops working. */
  expiresAt: number;
  /** Set when the last attempt failed, so the popup can say why. */
  error?: string;
}

export interface UsageState {
  claude?: ClaudeUsage;
  codex?: CodexUsage;
  github?: GithubUsage;
  netlify?: NetlifyUsage;
}

/* -------------------------------------------------------------------------- */
/*  Messaging protocol                                                        */
/* -------------------------------------------------------------------------- */

/** Messages sent to the background service worker. */
export type ExtensionMessage =
  | { type: 'REFRESH_USAGE' }
  | { type: 'GITHUB_SIGN_IN' }
  | { type: 'GITHUB_SAVE_TOKEN'; token: string; orgs: string[] }
  | { type: 'GITHUB_SIGN_OUT' }
  | { type: 'NETLIFY_SAVE_TOKEN'; token: string }
  | { type: 'NETLIFY_SIGN_OUT' };

/** Response returned by the background worker for a given message. */
export type MessageResponse<T = unknown> =
  | { success: true; data: T }
  | { success: false; error: string };

/** Typed response for the `REFRESH_USAGE` message. */
export type RefreshUsageResponse = MessageResponse<UsageState>;
