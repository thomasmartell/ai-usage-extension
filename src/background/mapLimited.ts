/**
 * Requests in flight at once for per-account lookups. GitHub asks
 * integrators not to fire requests concurrently, and Netlify allows about
 * 500 a minute, so a burst across many orgs or teams trips their limits.
 */
const MAX_CONCURRENT = 4;

/** `items.map(work)`, with at most `MAX_CONCURRENT` running at a time, in order. */
export const mapLimited = async <T, R>(
  items: T[],
  work: (item: T) => Promise<R>,
  limit = MAX_CONCURRENT,
): Promise<R[]> => {
  const results: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await work(items[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
};
