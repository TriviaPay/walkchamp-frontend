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
 * Fast retries only run until `catchUpUntilMs` (or while the last read errored),
 * and are hard-capped by `maxFastRetries` so 2.5s cannot loop indefinitely.
 * Once today's aggregate is > 0 (or the fast budget is spent), use the steady interval.
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
  /** Completed empty/fast attempts in the current catch-up window. */
  fastRetryCount?: number;
  /** Max empty/fast attempts before falling back to steadyIntervalMs (default 5). */
  maxFastRetries?: number;
}): boolean {
  if (opts.lastReadAtMs <= 0) return true;
  const now = opts.nowMs ?? Date.now();
  const elapsed = Math.max(0, now - opts.lastReadAtMs);
  const below = Math.max(1, Math.floor(opts.catchUpBelowSteps ?? 1));
  const catchingUp =
    (opts.catchUpUntilMs ?? 0) > now &&
    Math.max(0, Math.floor(opts.lastSteps)) < below;
  const maxFast = Math.max(1, Math.floor(opts.maxFastRetries ?? 5));
  const fastCount = Math.max(0, Math.floor(opts.fastRetryCount ?? 0));
  const fastBudgetRemaining = fastCount < maxFast;

  if (opts.lastWasError === true) {
    // Errors use the empty interval but still respect the attempt budget.
    if (!fastBudgetRemaining) {
      return elapsed >= opts.steadyIntervalMs;
    }
    return elapsed >= opts.emptyRetryMs;
  }
  if (catchingUp && fastBudgetRemaining) {
    return elapsed >= opts.emptyRetryMs;
  }
  return elapsed >= opts.steadyIntervalMs;
}
