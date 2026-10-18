import type { UsageState } from '../shared/types';

type Run = (options: { force: boolean }) => Promise<UsageState>;

/**
 * One refresh at a time. A background refresh asked for while one runs
 * shares it; a forced one (the refresh button, a new token) waits for a
 * background run to finish and then fetches everything, since that run may
 * have skipped GitHub and Netlify.
 */
export const createRefresher = (run: Run) => {
  let inFlight: Promise<UsageState> | null = null;
  let inFlightForced = false;

  const refresh = ({ force = false } = {}): Promise<UsageState> => {
    if (inFlight) {
      if (!force || inFlightForced) return inFlight;
      return inFlight.catch(() => undefined).then(() => refresh({ force: true }));
    }
    inFlightForced = force;
    inFlight = run({ force }).finally(() => {
      inFlight = null;
    });
    return inFlight;
  };

  /** A forced refresh that starts after any in-flight one, so it reads current tokens. */
  const refreshAfterChange = (): Promise<UsageState> =>
    (inFlight ?? Promise.resolve()).catch(() => undefined).then(() => refresh({ force: true }));

  return { refresh, refreshAfterChange };
};
