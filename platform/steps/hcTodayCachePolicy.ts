/**
 * Pure helpers for Health Connect today-cache policy (unit-tested).
 */

/** True when `start` is within 60s of local midnight for `now`. */
export function isLocalTodayRangeStart(start: Date, now: Date = new Date()): boolean {
  const midnight = new Date(now);
  midnight.setHours(0, 0, 0, 0);
  return Math.abs(start.getTime() - midnight.getTime()) < 60_000;
}

/**
 * Next today-cache value after a successful HC range read.
 * Race / non-today ranges leave the cache unchanged.
 * Today ranges use monotonic max so transient 0 cannot wipe a higher total.
 */
export function nextCachedTodaySteps(args: {
  previousCache: number;
  rangeStart: Date;
  rangeEnd: Date;
  steps: number;
  now?: Date;
}): number {
  const now = args.now ?? args.rangeEnd;
  if (!isLocalTodayRangeStart(args.rangeStart, now)) {
    return args.previousCache;
  }
  return Math.max(args.previousCache, Math.max(0, Math.floor(args.steps)));
}

/**
 * After uninstall/reinstall (or a cold HC 0), do not wait a full 30s to reread.
 * Fast retries only run until `catchUpUntilMs` (or while the last read errored).
 * Once today's aggregate is > 0, use the steady Health Connect interval.
 */
export function shouldRereadHealthConnectToday(opts: {
  lastReadAtMs: number;
  lastSteps: number;
  lastWasError?: boolean;
  nowMs?: number;
  steadyIntervalMs: number;
  emptyRetryMs: number;
  catchUpUntilMs?: number;
  /** During catch-up, treat totals below this as "HC not loaded yet" (reinstall remainder). */
  catchUpBelowSteps?: number;
}): boolean {
  if (opts.lastReadAtMs <= 0) return true;
  const now = opts.nowMs ?? Date.now();
  const elapsed = Math.max(0, now - opts.lastReadAtMs);
  const below = Math.max(1, Math.floor(opts.catchUpBelowSteps ?? 1));
  const catchingUp =
    (opts.catchUpUntilMs ?? 0) > now &&
    Math.max(0, Math.floor(opts.lastSteps)) < below;
  if (opts.lastWasError === true || catchingUp) {
    return elapsed >= opts.emptyRetryMs;
  }
  return elapsed >= opts.steadyIntervalMs;
}
