/**
 * Wraps an async loader so that it runs at most once at a time and a success is kept for good.
 * A failure is reported to `onError` and the next call tries again, until `maxAttempts` attempts have
 * failed; after that the last rejection is returned for good.
 */
export function memoizeWithRetry<T>(
  load: () => Promise<T>,
  maxAttempts: number,
  onError: (e: unknown) => void,
): () => Promise<T> {
  let cached: Promise<T> | undefined;
  let attempts = 0;
  return () => {
    if (cached === undefined) {
      attempts += 1;
      // The async wrapper turns a synchronous throw in `load` into a rejection too.
      cached = (async () => load())().catch((e: unknown) => {
        if (attempts < maxAttempts) cached = undefined; // forget it first, so a throwing onError cannot block the retry
        onError(e);
        throw e;
      });
    }
    return cached;
  };
}
