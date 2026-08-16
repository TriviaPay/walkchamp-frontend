/**
 * Hybrid Android live daily display.
 *
 * Health Connect stays the verified daily source, but on many devices/OEMs HC
 * simply never receives step records (healthConnectSourceCount=0 forever) even
 * though the phone is clearly walking — the same hardware TYPE_STEP_COUNTER the
 * ongoing race/FGS notification already reads correctly still advances.
 *
 * Rather than opening a second, independent expo-sensors Pedometer subscription
 * (which competed with — and on some devices never received callbacks alongside
 * — the one `androidLegacySensorProvider` already owns for live race tracking),
 * this simply polls that same already-proven-working provider's `getTodaySteps()`
 * and mirrors it into the Redux provisional lane. It never replaces the HC
 * provider or claims sensor data as verified backend truth.
 */

import { Platform } from "react-native";
import { store } from "@/store";
import { FEATURE_FLAGS } from "@/config/featureFlags";
import { updateStepProgressFromRealSource } from "@/services/stepProgressCoordinator";
import { hasActivityRecognitionPermission } from "@/services/permissions/activityRecognitionPermissionService";
import { androidLegacySensorProvider } from "./providers/androidLegacySensorProvider";

/** Frequent enough to feel live, cheap enough to run alongside HC polling. */
const POLL_MS = 4_000;

let _pollTimer: ReturnType<typeof setInterval> | null = null;
let _polling = false;

async function pollOnce(): Promise<void> {
  if (_polling) return; // avoid overlapping reads if one tick runs long
  _polling = true;
  try {
    if (!store.getState().raceProgress.userId) return;

    const { steps } = await androidLegacySensorProvider.getTodaySteps();
    const raw = Math.max(0, Math.floor(steps));
    const verified = Math.max(
      0,
      Math.floor(store.getState().raceProgress.verifiedTodaySteps ?? 0),
    );
    const next = Math.max(raw, verified);
    if (next <= verified) return;

    updateStepProgressFromRealSource({
      todaySteps: next,
      // Provisional daily display only — never label as Health Connect verified.
      // Session totals may lead HC so the Walk tab + ongoing notification keep updating.
      stepSource: "android_step_counter",
      dailyLane: "provisional",
      updatedAt: new Date().toISOString(),
      fromWatch: true,
    });

    // Background Unlimited provisional live path (Redis) — never walk/steps verified.
    try {
      const rpUser = store.getState().raceProgress.userId;
      if (!rpUser) return;
      const {
        getBlockedUnlimitedChallengeIds,
        getUnlimitedLiveContext,
      } = require("@/services/unlimitedRaceProgressGuard") as typeof import("@/services/unlimitedRaceProgressGuard");
      const { uploadUnlimitedProvisionalProgress } = require(
        "@/services/unlimitedProvisionalProgressApi",
      ) as typeof import("@/services/unlimitedProvisionalProgressApi");
      for (const challengeId of getBlockedUnlimitedChallengeIds()) {
        const ctx = getUnlimitedLiveContext(challengeId);
        if (!ctx?.challengeDayKey) continue;
        void uploadUnlimitedProvisionalProgress({
          challengeId,
          challengeDayKey: ctx.challengeDayKey,
          timezone: ctx.timezone,
          provisionalCumulativeSteps: next,
        });
      }
    } catch {
      /* optional */
    }
  } catch (e) {
    if (__DEV__) console.log("[HybridLive] poll error", e);
  } finally {
    _polling = false;
  }
}

/**
 * Start polling the legacy sensor provider for hybrid HC mode.
 * Safe to call repeatedly — restarts the poll loop fresh.
 */
export async function startHybridLiveDailyDisplay(): Promise<boolean> {
  if (Platform.OS !== "android") return false;
  if (!FEATURE_FLAGS.ENABLE_LIVE_RACE_DEVICE_SENSOR) return false;

  const arOk = await hasActivityRecognitionPermission();
  if (!arOk) {
    if (__DEV__) {
      console.log("[HybridLive] skip — ACTIVITY_RECOGNITION not granted");
    }
    return false;
  }

  const available = await androidLegacySensorProvider.isAvailable();
  if (!available) {
    if (__DEV__) console.log("[HybridLive] skip — legacy sensor unavailable");
    return false;
  }

  stopHybridLiveDailyDisplay();

  void pollOnce();
  _pollTimer = setInterval(() => {
    void pollOnce();
  }, POLL_MS);

  if (__DEV__) {
    console.log(
      "[HybridLive] started — polling androidLegacySensorProvider (same source as race baseline)",
    );
  }
  return true;
}

export function stopHybridLiveDailyDisplay(): void {
  if (_pollTimer) {
    clearInterval(_pollTimer);
    _pollTimer = null;
  }
}

export function isHybridLiveDailyDisplayActive(): boolean {
  return _pollTimer != null;
}
