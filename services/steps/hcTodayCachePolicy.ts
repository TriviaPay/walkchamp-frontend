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
