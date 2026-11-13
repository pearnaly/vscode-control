/** How far Node's time origin may differ from the uptime-based estimate before it is not trusted. */
export const MAX_ORIGIN_ERROR_MS = 60_000;

/**
 * The value to record as a window's `startedAt`, or undefined when there is no trustworthy one.
 *
 * `origin` is `Math.round(performance.timeOrigin)`, `estimate` is `Date.now() - process.uptime() * 1000` and
 * `now` is `Date.now()`. The origin is used only when it is a positive safe integer (the discovery file is
 * validated, so NaN or 0 would fail the whole registration), not later than `now`, and within
 * `MAX_ORIGIN_ERROR_MS` of the estimate (an origin that is too early would make the bridge call the window
 * stale). Without `startedAt` a file behaves like one from 0.1.x: it is never called stale.
 */
export function chooseStartedAt(origin: number, estimate: number, now: number): number | undefined {
  if (!Number.isSafeInteger(origin) || origin <= 0) return undefined;
  if (origin > now) return undefined;
  // Written so that a NaN estimate is rejected too.
  if (!(Math.abs(origin - estimate) <= MAX_ORIGIN_ERROR_MS)) return undefined;
  return origin;
}
