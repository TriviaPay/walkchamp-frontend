/**
 * Live race vs verified health-store step source helpers.
 * Live sensor sources are allowed for race progress only — never for daily walk.
 */

import { isAcceptedVerifiedSource, isLegacyStepSourceId } from "./verifiedStepSources";

/** Backend/API sources accepted for live race progress (device sensor path). */
const ACCEPTED_LIVE_RACE_SOURCES = new Set([
  "android_step_counter",
  "device_sensor", // legacy alias — prefer android_step_counter / ios_pedometer on wire
  "ios_pedometer",
  "ios_core_motion",
  "sensor",
]);

export function isAcceptedLiveRaceSource(
  source: string | null | undefined,
): boolean {
  if (!source) return false;
  return ACCEPTED_LIVE_RACE_SOURCES.has(source.toLowerCase());
}

/** True when a race progress POST may include this stepSource. */
export function isAcceptedRaceProgressSource(
  source: string | null | undefined,
): boolean {
  if (!source) return false;
  if (source === "simulation" || source === "race_start") return true;
  if (isAcceptedVerifiedSource(source)) return true;
  if (isAcceptedLiveRaceSource(source)) return true;
  return false;
}

/**
 * Canonical live race stepSource for the platform.
 * Android: android_step_counter (TYPE_STEP_COUNTER).
 * iOS: ios_pedometer (CMPedometer) — checklist contract.
 */
export function canonicalLiveRaceStepSource(
  platform: "android" | "ios" | string,
): "android_step_counter" | "ios_pedometer" {
  if (platform === "android") return "android_step_counter";
  return "ios_pedometer";
}

export { isLegacyStepSourceId, isAcceptedVerifiedSource };
