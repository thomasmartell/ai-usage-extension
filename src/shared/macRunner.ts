import { MAC_RUNNER_HOST, STORAGE_KEYS } from './constants';

/**
 * Status of the self-hosted GitHub Actions runners on Tom's Mac, read through
 * the `com.tom.ci_runner` native-messaging helper (~/ci-runner/native-host.py).
 * Where the helper isn't installed, the card and badge stay hidden.
 */

export type MacRunnerVm = 'on' | 'off' | 'starting' | 'stopping';

export interface MacRunnerJob {
  repo: string;
  workflow: string | null;
  name: string | null;
  branch: string | null;
  pr: number | null;
  status: string;
  conclusion: string | null;
  startedAt: string | null;
  completedAt: string | null;
  url: string | null;
}

export interface MacRunnerRepo {
  repo: string;
  runner: { status: 'online' | 'offline' | 'missing' | 'unknown'; busy: boolean };
  now?: MacRunnerJob[];
  recent?: MacRunnerJob[];
}

/** Minutes GitHub would have billed for this month's jobs on the Mac (per-job, rounded up). */
export interface MacRunnerMinutes {
  /** `YYYY-MM`, UTC. */
  month: string;
  minutes: number;
  jobs: number;
  byRepo: Record<string, { minutes: number; jobs: number }>;
}

/** An open pull request with its CI state, from `gh pr list`. */
export interface MacRunnerPullRequest {
  repo: string;
  number: number;
  title: string | null;
  url: string | null;
  draft: boolean;
  checks: 'failing' | 'pending' | 'passing' | 'none';
  /** Up to three failing check names. */
  failing: string[];
  /** GitHub reports merge conflicts with the base branch. */
  conflicting: boolean;
}

export interface MacRunnerStatus {
  vm: MacRunnerVm;
  repos: MacRunnerRepo[];
  /** Epoch ms of the helper's last VM/runner check. */
  checkedAt: number;
  /** True when jobs, heartbeat and routing variables are included. */
  detail: boolean;
  /** Epoch ms written to MAC_RUNNER_SEEN by the Mac's heartbeat. */
  heartbeatAt?: number | null;
  macRunner?: string | null;
  /** Share of the Mac's memory that is free (`kern.memorystatus_level`). */
  memoryFreePercent?: number | null;
  minutes?: MacRunnerMinutes | null;
  prs?: MacRunnerPullRequest[];
}

/** Persisted snapshot: `available` is false when the helper isn't installed. */
export interface MacRunnerState {
  available: boolean;
  status?: MacRunnerStatus;
  error?: string;
}

type HostRequest = { cmd: 'status'; detail: boolean } | { cmd: 'start' } | { cmd: 'stop' };

interface HostReply {
  ok: boolean;
  status?: MacRunnerStatus;
  vm?: MacRunnerVm;
  error?: string;
}

/** The helper isn't installed (or this extension isn't allowed to use it). */
export class MacRunnerUnavailable extends Error {}

const HOST_MISSING = /native messaging host not found|not allowed|forbidden/i;

const callHost = async (request: HostRequest): Promise<HostReply> => {
  try {
    return (await chrome.runtime.sendNativeMessage(MAC_RUNNER_HOST, request)) as HostReply;
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    if (HOST_MISSING.test(message)) {
      throw new MacRunnerUnavailable(message);
    }
    throw new Error(message);
  }
};

export const readMacRunnerState = async (): Promise<MacRunnerState | null> => {
  const data = await chrome.storage.local.get(STORAGE_KEYS.macRunnerState);
  return (data[STORAGE_KEYS.macRunnerState] ?? null) as MacRunnerState | null;
};

/**
 * Fetch status and persist it. A light poll keeps the jobs, heartbeat and
 * variables from the last detailed one so the popup doesn't flicker.
 */
export const refreshMacRunner = async (detail: boolean): Promise<MacRunnerState> => {
  let next: MacRunnerState;
  try {
    const reply = await callHost({ cmd: 'status', detail });
    if (!reply.ok || !reply.status) {
      throw new Error(reply.error ?? 'status_failed');
    }
    const previous = (await readMacRunnerState())?.status;
    const status = reply.status;
    if (!status.detail && previous?.detail) {
      status.repos = status.repos.map((repo) => {
        const old = previous.repos.find((entry) => entry.repo === repo.repo);
        return { ...repo, now: old?.now, recent: old?.recent };
      });
      status.heartbeatAt = previous.heartbeatAt;
      status.macRunner = previous.macRunner;
      status.minutes = previous.minutes;
      status.prs = previous.prs;
    }
    next = { available: true, status };
  } catch (cause) {
    if (cause instanceof MacRunnerUnavailable) {
      next = { available: false };
    } else {
      const previous = await readMacRunnerState();
      next = {
        available: true,
        status: previous?.status,
        error: cause instanceof Error ? cause.message : 'status_failed',
      };
    }
  }
  await chrome.storage.local.set({ [STORAGE_KEYS.macRunnerState]: next });
  return next;
};

/** Ask the helper to start or stop the VM; it returns at once with the transitional state. */
export const setMacRunnerPower = async (action: 'start' | 'stop'): Promise<MacRunnerVm> => {
  const reply = await callHost({ cmd: action });
  if (!reply.ok || !reply.vm) {
    throw new Error(reply.error ?? `${action}_failed`);
  }
  return reply.vm;
};

/** Jobs running now across both repositories, per the runners' busy flags. */
export const busyRunnerCount = (status: MacRunnerStatus): number =>
  status.repos.filter((repo) => repo.runner.busy).length;
