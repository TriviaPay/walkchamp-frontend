/**
 * Max steps provisional TYPE_STEP_COUNTER may lead verified HC/HK for live lag.
 * Anything larger is treated as a bad sensor baseline (e.g. 1592 vs HC 433).
 */
export const MAX_PROVISIONAL_AHEAD_OF_VERIFIED = 250;

/**
 * Walk tab + Daily Walk notification (91002) display.
 * Prefer live provisional (sensor session) when it is ahead of HC/HK, so the
 * ongoing notification keeps updating while Health Connect lags.
 * Still reject yesterday-style absolutes (huge jump from a low HC total).
 */
export function resolveWalkNotificationSteps(params: {
  verifiedTodaySteps: number;
  provisionalSensorTodaySteps?: number | null;
  todaySteps?: number;
}): number {
  const verified = Math.max(0, Math.floor(params.verifiedTodaySteps ?? 0));
  const provisional =
    params.provisionalSensorTodaySteps == null
      ? 0
      : Math.max(0, Math.floor(params.provisionalSensorTodaySteps));
  const fallback = Math.max(0, Math.floor(params.todaySteps ?? 0));

  // Yesterday-style absolute: thousands while HC says ~0/small — ignore it.
  if (isStaleSensorAbsolute(verified, provisional)) {
    return Math.max(verified, Math.min(fallback, verified + MAX_PROVISIONAL_AHEAD_OF_VERIFIED));
  }
  if (isStaleSensorAbsolute(verified, fallback)) {
    return Math.max(verified, provisional);
  }

  return Math.max(verified, provisional, fallback);
}

/**
 * True when a sensor absolute looks like yesterday's leftover (or a bad baseline),
 * not a normal live walk ahead of a lagging HC read.
 */
export function isStaleSensorAbsolute(
  verified: number,
  candidate: number,
  maxAhead: number = MAX_PROVISIONAL_AHEAD_OF_VERIFIED,
): boolean {
  const v = Math.max(0, Math.floor(verified));
  const c = Math.max(0, Math.floor(candidate));
  // Classic bad baseline: HC small/zero, sensor still holding ~thousands.
  return c >= 1000 && c > v + Math.max(maxAhead, 1000);
}

/**
 * Whether a provisional absolute should be rejected as a bad baseline jump.
 * Used at ingest — not for capping live session growth on the notification.
 */
export function isInflatedProvisionalVsVerified(
  verified: number,
  provisional: number,
  maxAhead: number = MAX_PROVISIONAL_AHEAD_OF_VERIFIED,
): boolean {
  return isStaleSensorAbsolute(verified, provisional, maxAhead);
}
