import React from 'react';
import { msg } from '../../shared/i18n';
import type { MacRunnerPullRequest } from '../../shared/macRunner';
import type { MacRunnerData } from '../hooks/useMacRunner';

/** How many pull requests needing attention to list before folding the rest into a count. */
const MAX_LISTED = 6;

const needsAttention = (pr: MacRunnerPullRequest): boolean =>
  pr.checks === 'failing' || pr.conflicting;

const PullRequestRow: React.FC<{ pr: MacRunnerPullRequest }> = ({ pr }) => {
  const problems = [
    pr.checks === 'failing' && msg('prFailing'),
    pr.conflicting && msg('prConflicting'),
    pr.draft && msg('prDraft'),
  ].filter(Boolean);

  return (
    <a
      className="au-runner__job"
      href={pr.url ?? undefined}
      target="_blank"
      rel="noreferrer"
      title={pr.failing.join(', ')}
    >
      <span
        className={`au-runner__mark au-runner__mark--${pr.checks === 'failing' ? 'failure' : 'unknown'}`}
        aria-hidden="true"
      >
        {pr.checks === 'failing' ? '✕' : '!'}
      </span>
      <span className="au-runner__job-name">
        #{pr.number} {pr.title}
      </span>
      <span className="au-runner__job-time">{problems.join(' · ')}</span>
    </a>
  );
};

/** Open pull requests across the runner's repositories, flagging failing CI and conflicts. */
export const PullRequestsCard: React.FC<{ runner: MacRunnerData }> = ({ runner }) => {
  const status = runner.state?.available ? runner.state.status : undefined;
  if (!status?.prs) {
    return null;
  }

  const prs = status.prs;
  return (
    <section className="au-card au-runner">
      <header className="au-card__header">
        <div className="au-card__heading">
          <h2 className="au-card__title">{msg('prTitle')}</h2>
        </div>
      </header>
      <div className="au-card__body">
        {status.repos.map(({ repo }) => {
          const open = prs.filter((pr) => pr.repo === repo);
          const flagged = open.filter(needsAttention);
          return (
            <div className="au-runner__repo" key={repo}>
              <p className="au-runner__repo-head">
                <span className="au-runner__repo-name">{repo}</span>
                <span className="au-runner__repo-state">
                  {msg('prSummary', [
                    String(open.length),
                    String(open.filter((pr) => pr.checks === 'failing').length),
                    String(open.filter((pr) => pr.conflicting).length),
                  ])}
                </span>
              </p>
              {flagged.slice(0, MAX_LISTED).map((pr) => (
                <PullRequestRow key={pr.number} pr={pr} />
              ))}
              {flagged.length > MAX_LISTED && (
                <p className="au-footnote">{msg('prMore', String(flagged.length - MAX_LISTED))}</p>
              )}
              {flagged.length === 0 && <p className="au-footnote">{msg('prAllGood')}</p>}
            </div>
          );
        })}
      </div>
    </section>
  );
};
