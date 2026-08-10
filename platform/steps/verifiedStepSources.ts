/**
 * Pure helpers for verified vs legacy step sources (no React Native imports).
 */

const LEGACY_SOURCE_IDS = new Set([
  "android_legacy_sensor",
  "android_step_counter",
  "android_counter",
  "sensor",
  "legacy",
  "phone_sensor",
  "activity_sensor",
  "pedometer",
  "android_device_step_counter",
]);

const ACCEPTED_VERIFIED_SOURCES = new Set([
  "health_connect",
  "android_health_connect",
  "healthkit",
  "ios_healthkit",
]);

/** Reject stored / inbound legacy source labels — never treat as verified. */
export function isLegacyStepSourceId(
  id: string | null | undefined,
): boolean {
  if (!id) return false;
  return LEGACY_SOURCE_IDS.has(id.toLowerCase());
}

/** True if a backend/API source string is allowed for verified submissions. */
export function isAcceptedVerifiedSource(
  source: string | null | undefined,
): boolean {
  if (!source) return false;
  if (isLegacyStepSourceId(source)) return false;
  return ACCEPTED_VERIFIED_SOURCES.has(source.toLowerCase());
}
