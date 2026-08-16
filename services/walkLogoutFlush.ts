/**
 * Persist today's daily-walk total to the API before the session is dropped.
 * Live races pause POST /api/walk/steps, so logout/login otherwise hydrates 0.
 */

import { getValidSession } from "@/services/authService";
import { timeoutSignal, STEP_SYNC_TIMEOUT } from "@/utils/authFetch";
import { getTodayKey } from "@/utils/format";
import { store } from "@/store";
import { storageGet } from "@/utils/storage";
import {
  readDailyStepsForUserDate,
  stepScopedKeys,
} from "@/utils/stepScopedStorage";
import { STEP_SOURCES } from "@/services/steps/hybridStepState";
import { stepProviderManager } from "@/services/steps/stepProviderManager";
import { Platform } from "react-native";
import { setWalkBackendSyncPaused } from "@/services/walkSyncCoordinator";

const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? "";

export async function flushDailyWalkBeforeLogout(userId: string): Promise<void> {
  if (!userId) return;
  setWalkBackendSyncPaused(false);

  const today = getTodayKey();
  const keys = stepScopedKeys(userId, today);
  const rp = store.getState().raceProgress;
  const local = await readDailyStepsForUserDate(userId, today).catch(() => 0);
  const lastSynced = (await storageGet<number>(keys.lastSyncedStepsCount).catch(() => 0)) ?? 0;
  const total = Math.max(
    0,
    Math.floor(local),
    Math.floor(rp.verifiedTodaySteps ?? 0),
    Math.floor(rp.todaySteps ?? 0),
  );
  if (total <= 0 || total <= lastSynced) return;

  const session = await getValidSession();
  if (!session) return;

  const source =
    Platform.OS === "ios"
      ? STEP_SOURCES.verifiedDailyIOS
      : stepProviderManager.usesVerifiedStepSource()
        ? STEP_SOURCES.verifiedDailyAndroid
        : null;
  if (!source) return;

  const delta = Math.max(1, total - lastSynced);
  try {
    const res = await fetch(`${API_BASE}/api/walk/steps`, {
      method: "POST",
      signal: timeoutSignal(STEP_SYNC_TIMEOUT),
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session}`,
      },
      body: JSON.stringify({
        steps: delta,
        distanceMeters: 0,
        caloriesBurned: 0,
        durationSeconds: 0,
        totalSteps: total,
        dailySteps: total,
        source,
        userId,
        localDate: today,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        timestampUtc: new Date().toISOString(),
      }),
    });
    if (__DEV__) {
      console.log(
        `[WalkLogoutFlush] POST /api/walk/steps status=${res.status} total=${total} lastSynced=${lastSynced}`,
      );
    }
  } catch {
    /* best-effort — local cache still restored on next login */
  }
}
