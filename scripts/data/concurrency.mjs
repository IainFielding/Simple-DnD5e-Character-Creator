/**
 * Run `fn` over every item with at most `limit` calls in flight at once. A pool of
 * workers pulls from a shared queue until it drains, so a slow item never blocks the
 * others the way a plain sequential `for await` loop does — the warm-up's many small
 * `fromUuid`/compendium reads overlap instead of paying each round-trip back to back.
 *
 * Results aren't collected (callers warm memo caches for their side effects), and each
 * caller is expected to swallow its own per-item failures, so a rejection here aborts
 * the batch deliberately. Resolves once every item has been processed.
 *
 * @template T
 * @param {Iterable<T>} items
 * @param {number} limit            Maximum concurrent invocations.
 * @param {(item: T) => Promise<void>|void} fn
 * @returns {Promise<void>}
 */
export async function forEachLimit(items, limit, fn) {
  const queue = [...items];
  // No `await` sits between the length check and the shift, so concurrent workers can
  // never pull the same item: the single-threaded event loop runs each pair atomically.
  const worker = async () => {
    while ( queue.length ) await fn(queue.shift());
  };
  const count = Math.max(1, Math.min(limit, queue.length));
  await Promise.all(Array.from({ length: count }, worker));
}

/** Default in-flight cap for the builder's compendium warm-up loops. */
export const WARM_CONCURRENCY = 8;
