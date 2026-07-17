import AsyncStorage from "@react-native-async-storage/async-storage";
import { getTodayKey } from "@/utils/format";
import { STORAGE_KEYS, storageGet, storageRemove, storageSet, storageSetDebounced } from "@/utils/storage";

const LEGACY_UNSCOPED_STEP_KEYS = [
  STORAGE_KEYS.DAILY_STEPS,
  STORAGE_KEYS.LAST_SYNCED_STEPS_DATE,
  STORAGE_KEYS.LAST_SYNCED_STEPS_COUNT,
  STORAGE_KEYS.TRACKING_LOCAL_DATE,
  STORAGE_KEYS.TOTAL_STEPS,
  STORAGE_KEYS.STREAK,
  STORAGE_KEYS.PENDING_RACE,
  "walk_steps_outbox",
  "todaySteps",
  "raceSteps",
  "stepBaseline",
  "lastStepCount",
  "dailySteps",
  "walkProgress",
  "stepSnapshot",
  "legacy_sensor_daily_baseline",
  "legacy_sensor_daily_date",
  "legacy_sensor_today_steps",
  "legacy_sensor_raw_at_sub",
  "lastSyncSteps",
  "currentRaceSteps",
] as const;

export function stepScopedKeys(userId: string, localDate = getTodayKey()) {
  return {
    steps: `steps:${userId}:${localDate}`,
    baseline: `baseline:${userId}:${localDate}`,
    stepSnapshot: `stepSnapshot:${userId}:${localDate}`,
    stepProgress: `stepProgress:${userId}:${localDate}`,
    lastSyncedStepsCount: `stepProgress:${userId}:${localDate}:lastSyncedStepsCount`,
    outbox: `stepProgress:${userId}:${localDate}:outbox`,
    currentLocalDate: `stepProgress:${userId}:currentLocalDate`,
    totalSteps: `stepProgress:${userId}:totalSteps`,
    streak: `stepProgress:${userId}:streak`,
  };
}

export function raceStepsKey(userId: string, raceId: string): string {
  return `raceSteps:${userId}:${raceId}`;
}

export async function readDailyStepsForUserDate(
  userId: string,
  localDate = getTodayKey(),
): Promise<number> {
  return (await storageGet<number>(stepScopedKeys(userId, localDate).steps)) ?? 0;
}

export async function writeDailyStepsForUserDate(
  userId: string,
  localDate: string,
  steps: number,
): Promise<void> {
  // Debounce hot step writes; latest value always wins. Flush on background separately.
  storageSetDebounced(
    stepScopedKeys(userId, localDate).steps,
    Math.max(0, Math.floor(steps)),
    750,
  );
}

export async function readWeeklyStepsForUser(
  userId: string,
  endDate = new Date(),
): Promise<number> {
  let total = 0;
  for (let i = 0; i < 7; i += 1) {
    const d = new Date(endDate);
    d.setDate(endDate.getDate() - i);
    const localDate =
      `${d.getFullYear()}-` +
      `${String(d.getMonth() + 1).padStart(2, "0")}-` +
      `${String(d.getDate()).padStart(2, "0")}`;
    total += await readDailyStepsForUserDate(userId, localDate);
  }
  return total;
}

export async function deleteLegacyUnscopedStepKeys(): Promise<void> {
  await Promise.all(
    LEGACY_UNSCOPED_STEP_KEYS.map(async (key) => {
      await storageRemove(key);
      if (__DEV__) console.log(`[StepStorage] deleted legacy unscoped key=${key}`);
    }),
  );
}

export async function clearScopedStepStateForUser(userId: string): Promise<void> {
  const allKeys = await AsyncStorage.getAllKeys();
  const prefixes = [
    `steps:${userId}:`,
    `baseline:${userId}:`,
    `raceSteps:${userId}:`,
    `stepSnapshot:${userId}:`,
    `stepProgress:${userId}:`,
  ];
  const keysToDelete = allKeys.filter((key) =>
    prefixes.some((prefix) => key.startsWith(prefix)),
  );
  if (keysToDelete.length > 0) {
    await AsyncStorage.multiRemove(keysToDelete);
  }
}
