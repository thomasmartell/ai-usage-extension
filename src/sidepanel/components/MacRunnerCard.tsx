import React, { useEffect, useState } from 'react';
import { msg } from '../../shared/i18n';
import type { MacRunnerJob, MacRunnerRepo, MacRunnerVm } from '../../shared/macRunner';
import { useNow } from '../../shared/hooks/useNow';
import { formatRelativeTime } from '../../shared/utils';
import type { UsageLimit } from '../../shared/types';
import type { MacRunnerData } from '../hooks/useMacRunner';

const VM_LABEL: Record<MacRunnerVm, string> = {
  on: 'macRunnerOn',
  off: 'macRunnerOff',
  starting: 'macRunnerStarting',
  stopping: 'macRunnerStopping',
};

const RESULT_MARK: Record<string, string> = {
  success: '✓',
  failure: '✕',
  cancelled: '–',
  skipped: '–',
};

const secondsAgo = (timestamp: number, now: number): string =>
  msg('timeAgo', `${Math.max(0, Math.round((now - timestamp) / 1000))}s`);

const parseTime = (iso: string | null): number | null => (iso ? Date.parse(iso) : null);

const jobTitle = (job: MacRunnerJob): string =>
  [job.name, job.pr ? `PR #${job.pr}` : job.branch].filter(Boolean).join(' · ');

const JobLink: React.FC<{ job: MacRunnerJob; children: React.ReactNode }> = ({ job, children }) =>
  job.url ? (
    <a
      className="au-runner__job"
      href={job.url}
      target="_blank"
      rel="noreferrer"
      title={job.workflow ?? ''}
    >
      {children}
    </a>
  ) : (
    <span className="au-runner__job">{children}</span>
  );

const RepoRow: React.FC<{ repo: MacRunnerRepo; vmOn: boolean; now: number }> = ({
  repo,
  vmOn,
  now,
}) => {
  const running = repo.now ?? [];
  const recent = repo.recent ?? [];
  const runnerLabel = !vmOn
    ? msg('macRunnerRunnerOff')
    : repo.runner.status !== 'online'
      ? msg('macRunnerRunnerConnecting')
      : repo.runner.busy
        ? msg('macRunnerRunnerBusy')
        : msg('macRunnerRunnerIdle');

  return (
    <div className="au-runner__repo">
      <p className="au-runner__repo-head">
        <span className="au-runner__repo-name">{repo.repo}</span>
        <span
          className={`au-runner__repo-state ${
            vmOn && repo.runner.busy ? 'au-runner__repo-state--busy' : ''
          }`}
        >
          {runnerLabel}
        </span>
      </p>
      {running.map((job) => {
        const started = parseTime(job.startedAt);
        return (
          <JobLink key={job.url ?? job.name} job={job}>
            <span className="au-runner__mark au-runner__mark--now" aria-hidden="true">
              ●
            </span>
            <span className="au-runner__job-name">{jobTitle(job)}</span>
            {started && (
              <span className="au-runner__job-time">{formatRelativeTime(started, now)}</span>
            )}
          </JobLink>
        );
      })}
      {recent.map((job) => {
        const finished = parseTime(job.completedAt);
        return (
          <JobLink key={job.url ?? `${job.name}-${job.completedAt}`} job={job}>
            <span
              className={`au-runner__mark au-runner__mark--${job.conclusion ?? 'unknown'}`}
              aria-label={job.conclusion ?? ''}
            >
              {RESULT_MARK[job.conclusion ?? ''] ?? '?'}
            </span>
            <span className="au-runner__job-name">{jobTitle(job)}</span>
            {finished && (
              <span className="au-runner__job-time">{formatRelativeTime(finished, now)}</span>
            )}
          </JobLink>
        );
      })}
      {running.length === 0 && recent.length === 0 && (
        <p className="au-footnote">{msg('macRunnerNoJobs')}</p>
      )}
    </div>
  );
};

/** Below this share of free memory, a running VM is worth stopping before heavy work. */
const LOW_MEMORY_PERCENT = 20;

interface MacRunnerCardProps {
  runner: MacRunnerData;
  /** The GitHub card's monthly Actions minutes row, to show what the Mac saved against it. */
  githubMinutes?: UsageLimit;
}

/** On/off state, power button and recent jobs for the self-hosted runners on the Mac. */
export const MacRunnerCard: React.FC<MacRunnerCardProps> = ({ runner, githubMinutes }) => {
  const now = useNow(5_000);
  const { state, switching, switchError, setPower } = runner;
  const [confirmStop, setConfirmStop] = useState(false);
  const status = state?.status;
  const vm = status?.vm;
  const busy = status?.repos.some((repo) => repo.runner.busy) ?? false;

  useEffect(() => {
    if (!confirmStop) return undefined;
    const id = window.setTimeout(() => setConfirmStop(false), 5_000);
    return () => window.clearTimeout(id);
  }, [confirmStop]);

  if (!state?.available || !status || !vm) {
    return null;
  }

  const pending = vm === 'starting' || vm === 'stopping';
  const onPower = (): void => {
    if (vm === 'off') {
      void setPower('start');
    } else if (busy && !confirmStop) {
      setConfirmStop(true);
    } else {
      setConfirmStop(false);
      void setPower('stop');
    }
  };
  const powerLabel =
    vm === 'off'
      ? msg('macRunnerStart')
      : confirmStop
        ? msg('macRunnerStopConfirm')
        : msg('macRunnerStop');

  return (
    <section className={`au-card au-runner au-runner--${vm}`}>
      <header className="au-runner__header">
        <div className="au-runner__state" role="status">
          <span className="au-runner__dot" aria-hidden="true" />
          {msg(VM_LABEL[vm])}
        </div>
        <div className="au-card__heading">
          <h2 className="au-card__title">{msg('macRunnerTitle')}</h2>
          <p className="au-card__subtitle">
            {msg('macRunnerChecked', secondsAgo(status.checkedAt, now))}
          </p>
        </div>
        <button
          type="button"
          className={`au-runner__power ${confirmStop ? 'au-runner__power--confirm' : ''}`}
          onClick={onPower}
          disabled={switching || pending}
        >
          {powerLabel}
        </button>
      </header>

      {(switchError || state.error) && (
        <p className="au-error" role="alert">
          {switchError ?? state.error}
        </p>
      )}

      {vm === 'on' &&
        status.memoryFreePercent != null &&
        status.memoryFreePercent < LOW_MEMORY_PERCENT && (
          <p className="au-runner__warning" role="alert">
            {msg('macRunnerLowMemory', String(status.memoryFreePercent))}
          </p>
        )}

      <div className="au-card__body">
        {status.repos.map((repo) => (
          <RepoRow key={repo.repo} repo={repo} vmOn={vm === 'on'} now={now} />
        ))}
        {status.minutes && (
          <p className="au-runner__minutes">
            {msg('macRunnerMinutes', [String(status.minutes.minutes), String(status.minutes.jobs)])}
            {githubMinutes?.limit
              ? ` · ${msg('macRunnerMinutesShare', [
                  ((status.minutes.minutes / githubMinutes.limit) * 100).toFixed(1),
                  githubMinutes.limit.toLocaleString(),
                ])}`
              : ''}
          </p>
        )}
        {status.detail && (
          <p className="au-footnote">
            {status.heartbeatAt
              ? msg('macRunnerHeartbeat', secondsAgo(status.heartbeatAt, now))
              : msg('macRunnerNoHeartbeat')}
            {' · '}
            {status.macRunner
              ? msg('macRunnerRouting', status.macRunner)
              : msg('macRunnerNoRouting')}
          </p>
        )}
      </div>
    </section>
  );
};
