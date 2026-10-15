export type UsageStatus = 'ok' | 'warning' | 'critical';

export type ProviderId = 'claude' | 'codex';

export interface UsageLimit {
  percentage: number;
  resetsAt: string | null;
  used?: number;
  limit?: number;
  /** Length of the rolling window in ms, when the provider reports one. */
  windowMs?: number;
}

export interface ModelUsage {
  id: string;
  label: string;
  limit: UsageLimit;
  /** Reset of a sibling window folded into this row (see `groupQuietModels`). */
  secondaryResetsAt?: string | null;
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

export interface UsageState {
  claude?: ClaudeUsage;
  codex?: CodexUsage;
}

/* -------------------------------------------------------------------------- */
/*  Messaging protocol                                                        */
/* -------------------------------------------------------------------------- */

/** Messages sent to the background service worker. */
export type ExtensionMessage = { type: 'REFRESH_USAGE' };

/** Response returned by the background worker for a given message. */
export type MessageResponse<T = unknown> =
  | { success: true; data: T }
  | { success: false; error: string };

/** Typed response for the `REFRESH_USAGE` message. */
export type RefreshUsageResponse = MessageResponse<UsageState>;
