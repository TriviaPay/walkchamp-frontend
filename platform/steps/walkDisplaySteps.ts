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
  /**
   * When a live / sponsored race owns the sensor, daily total must stay on HC/HK.
   * Race deltas belong on the race tray — not Walk "total steps".
   */
  raceActive?: boolean;
  /**
   * When HC/HK is not verified authority (no writer / unsupported), show the
   * live sensor total. Never treat that as prize-eligible verified data.
   */
  verifiedAuthoritative?: boolean;
  /** TYPE_STEP_COUNTER since-boot total — used to reject raw counter as "today". */
  sensorTotal?: number | null;
  dailyBaseline?: number | null;
}): number {
  const verified = Math.max(0, Math.floor(params.verifiedTodaySteps ?? 0));
  const provisional =
    params.provisionalSensorTodaySteps == null
      ? 0
      : Math.max(0, Math.floor(params.provisionalSensorTodaySteps));
  const fallback = Math.max(0, Math.floor(params.todaySteps ?? 0));

  if (params.verifiedAuthoritative === false) {
    const live = Math.max(provisional, fallback);
    // Phone-sensor daily is allowed on unsupported devices, but never the
    // raw since-boot counter (same hardware number after reinstall / cold start).
    if (
      looksLikeSinceBootCounter({
        todaySteps: live,
        sensorTotal: params.sensorTotal,
        dailyBaseline: params.dailyBaseline,
      })
    ) {
      return verified;
    }
    // Unsupported / no HC: show sensor, but still drop since-boot style
    // leftovers when we already have a smaller trusted total.
    if (verified > 0 && isStaleSensorAbsolute(verified, provisional)) {
      return Math.max(verified, fallback > 0 && !isStaleSensorAbsolute(verified, fallback) ? fallback : verified);
    }
    if (verified > 0 && isStaleSensorAbsolute(verified, fallback)) {
      return Math.max(verified, provisional);
    }
    return Math.max(verified, live);
  }

  if (!params.raceActive) {
    // No active race to justify a big jump — a large provisional/fallback while
    // HC still shows 0 is almost always yesterday's leftover, not live walking.
    if (isStaleSensorAbsolute(verified, provisional)) return verified;
    if (isStaleSensorAbsolute(verified, fallback)) return verified;
    return Math.max(verified, provisional, fallback);
  }

  // Race active: `provisional` already passed the ingest-time plausibility gate
  // in the Redux reducer (raceProgressSlice) before ever reaching here, and an
  // active race holding the sensor is strong evidence a jump is genuine live
  // walking — not stale leftover. Re-applying the blunt "candidate > 1000 is
  // stale" rule to it here (as before) wrongly zeroed out real live-session
  // steps whenever Health Connect simply hadn't synced yet today (verified
  // stuck at 0, which is routine mid-race), showing "Total Steps: 0" on the
  // Walk tab while the race tray (unaffected by this function) kept counting
  // correctly from the same sensor. `fallback` may still come from an
  // untrusted/raw cache, so it keeps the stale check.
  if (isStaleSensorAbsolute(verified, fallback)) {
    return Math.max(verified, provisional);
  }
  const live = Math.max(provisional, fallback);
  // Small stored daily totals (including a backend row) must not flicker 0↔N.
  if (verified <= 0) return live;
  const raceLiveCap = 80;
  if (live > verified + raceLiveCap) return verified;
  return Math.max(verified, live);
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

/**
 * True when a large daily absolute is almost certainly TYPE_STEP_COUNTER since-boot
 * (or a poisoned cache), not a real Health Connect / HealthKit day total.
 * Used when the verified provider currently reports 0 / empty.
 */
export function isPoisonedSensorDailyAbsolute(
  providerSteps: number,
  candidate: number,
): boolean {
  const provider = Math.max(0, Math.floor(providerSteps));
  const candidateSteps = Math.max(0, Math.floor(candidate));
  if (provider > 0) return false;
  return isStaleSensorAbsolute(0, candidateSteps);
}

/**
 * True when `todaySteps` is the raw TYPE_STEP_COUNTER since-boot value, not a
 * local-day total. A real daily session has today = sensorTotal - dailyBaseline.
 */
export function looksLikeSinceBootCounter(opts: {
  todaySteps: number;
  sensorTotal?: number | null;
  dailyBaseline?: number | null;
}): boolean {
  const today = Math.max(0, Math.floor(opts.todaySteps));
  if (today < 1000) return false;
  const sensor =
    opts.sensorTotal == null || !Number.isFinite(opts.sensorTotal)
      ? null
      : opts.sensorTotal;
  if (sensor != null && sensor >= 0) {
    return Math.abs(today - sensor) <= 2;
  }
  return false;
}

/**
 * Last known verified total for this account today: live HC/HK, else GET /api/walk/today.
 * Never treat a real account DB row as since-boot poison.
 */
export function accountVerifiedFloor(
  healthConnectSteps: number,
  accountDbSteps: number,
): number {
  return Math.max(
    0,
    Math.floor(healthConnectSteps),
    Math.floor(accountDbSteps),
  );
}

/**
 * Samsung/HC often returns aggregate COUNT_TOTAL=0 with no records mid-day.
 * That is lag, not a verified empty day. Only accept verified 0 after midnight
 * rollover (freshLocalDay) or when there was no prior total to protect.
 */
export function shouldAcceptVerifiedZero(opts: {
  incomingSteps: number;
  previousSteps: number;
  freshLocalDay?: boolean;
}): boolean {
  const incoming = Math.max(0, Math.floor(opts.incomingSteps));
  const previous = Math.max(0, Math.floor(opts.previousSteps));
  if (incoming > 0) return true;
  if (opts.freshLocalDay === true) return true;
  return previous <= 0;
}
