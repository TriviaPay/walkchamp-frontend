/**
 * Max steps provisional TYPE_STEP_COUNTER may lead verified HC/HK for live lag.
 * Anything larger is treated as a bad sensor baseline (e.g. 1592 vs HC 433).
 */
export const MAX_PROVISIONAL_AHEAD_OF_VERIFIED = 250;

/**
 * Walk tab + Daily Walk notification (91002) display.
 * Prefer verified HC/HK when present; allow only small provisional live lag.
 * Never show a wildly inflated sensor absolute as the daily total.
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
  if (verified > 0) {
    if (
      provisional > verified &&
      provisional - verified <= MAX_PROVISIONAL_AHEAD_OF_VERIFIED
    ) {
      return provisional;
    }
    return verified;
  }
  // HC/HK delayed or empty — provisional may drive live UX.
  return Math.max(
    verified,
    provisional,
    Math.max(0, Math.floor(params.todaySteps ?? 0)),
  );
}

/**
 * Whether a provisional absolute should be rejected as a bad baseline.
 */
export function isInflatedProvisionalVsVerified(
  verified: number,
  provisional: number,
  maxAhead: number = MAX_PROVISIONAL_AHEAD_OF_VERIFIED,
): boolean {
  const v = Math.max(0, Math.floor(verified));
  const p = Math.max(0, Math.floor(provisional));
  return v > 0 && p > v + maxAhead;
}
