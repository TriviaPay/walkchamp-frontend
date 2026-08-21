/**
 * Android step-source IDs used by WalkContext.
 * Verified daily = Health Connect only. TYPE_STEP_COUNTER is live/limited.
 */

export type AndroidStepSourceId =
  | "android_health_connect"
  | "android_device_step_counter"
  | "unsupported";

export type VerificationLevel = "verified" | "limited" | "unsupported";

/**
 * Derive verification level from an active source ID.
 * Used by WalkContext to publish `canJoinRewardRaces`.
 */
export function sourceToVerificationLevel(
  source: AndroidStepSourceId | "ios_healthkit" | null,
): VerificationLevel {
  if (!source) return "unsupported";
  switch (source) {
    case "ios_healthkit":
    case "android_health_connect":
      return "verified";
    case "android_device_step_counter":
      return "limited";
    default:
      return "unsupported";
  }
}
