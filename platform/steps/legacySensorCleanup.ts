/**
 * Cleanup helpers for TYPE_STEP_COUNTER / pedometer scoped storage.
 * Live race may use the sensor; daily walk remains Health Connect / HealthKit.
 */

import { storageRemove } from "@/utils/storage";
import { stepScopedKeys } from "@/utils/stepScopedStorage";
import { getLocalDateKey } from "./stepProviderTypes";

const LEGACY_KEYS = [
  "legacy_sensor_daily_baseline",
  "legacy_sensor_daily_date",
  "legacy_sensor_today_steps",
  "legacy_sensor_raw_at_sub",
] as const;

/** Clear scoped + unscoped legacy sensor keys for a user (logout / account switch). */
export async function clearAndroidLegacySensorScopedState(
  userId: string,
): Promise<void> {
  try {
    const {
      clearAndroidLegacySensorScopedState: clearProvider,
    } = await import("./providers/androidLegacySensorProvider");
    await clearProvider(userId);
  } catch {
    /* provider optional during cleanup */
  }
  const today = getLocalDateKey();
  const keys = stepScopedKeys(userId, today);
  await Promise.all([
    storageRemove(keys.baseline),
    storageRemove(keys.steps),
    storageRemove(keys.stepSnapshot),
    storageRemove(keys.currentLocalDate),
    ...LEGACY_KEYS.map((k) => storageRemove(k as never)),
  ]);
}

/** Clear unscoped leftover keys after logout (older app versions). */
export async function clearSignedOutLegacySensorState(): Promise<void> {
  try {
    const { clearSignedOutLegacySensorState: clearProvider } = await import(
      "./providers/androidLegacySensorProvider"
    );
    await clearProvider();
  } catch {
    /* optional */
  }
  await Promise.all(LEGACY_KEYS.map((k) => storageRemove(k as never)));
}

/** Bind live-race sensor provider to the signed-in user. */
export function setAndroidLegacySensorUserContext(userId: string | null): void {
  try {
    const {
      setAndroidLegacySensorUserContext: bind,
    } = require("./providers/androidLegacySensorProvider") as typeof import("./providers/androidLegacySensorProvider");
    bind(userId);
  } catch {
    /* provider optional */
  }
}
