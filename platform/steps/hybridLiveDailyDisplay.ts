/**
 * Hybrid Android live daily display for devices without Health Connect / HealthKit.
 * Verified HC/HK phones never start this poll — daily steps come from HC only.
 *
 * Do not start a second Pedometer.watchStepCount here — that races the FGS
 * listener. Poll native todaySteps (session = sensorTotal - dailyBaseline).
 */

import { Platform } from "react-native";
import { store } from "@/store";
import { FEATURE_FLAGS } from "@/config/featureFlags";
import { updateStepProgressFromRealSource } from "@/services/stepProgressCoordinator";
import {
  ensureActivityRecognitionPermission,
  hasActivityRecognitionPermission,
} from "@/services/permissions/activityRecognitionPermissionService";
import { stepTrackingNotificationService } from "@/services/stepTrackingNotificationService";
import { androidLegacySensorProvider } from "./providers/androidLegacySensorProvider";
import { looksLikeSinceBootCounter, shouldHoldSensorSessionUntilVerifiedRead } from "./walkDisplaySteps";
import { getLocalDateStr } from "@/utils/timezone";
import { getVerifiedSensorAnchor, resolveAnchoredDisplaySteps } from "./verifiedSensorAnchor";

/** Frequent enough to feel live with the ongoing notification. */
const POLL_MS = 1_000;

let _pollTimer: ReturnType<typeof setInterval> | null = null;
let _polling = false;

async function readLiveSessionSteps(userId: string): Promise<number> {
  let live = 0;
  try {
    const { steps } = await androidLegacySensorProvider.getTodaySteps();
    live = Math.max(live, Math.max(0, Math.floor(steps)));
  } catch {
    /* optional */
  }
  try {
    const native = await stepTrackingNotificationService.getNativeStepState(userId);
    const nativeToday =
      native && typeof native.todaySteps === "number"
        ? Math.max(0, Math.floor(native.todaySteps))
        : 0;
    const today = getLocalDateStr();
    if (
      native &&
      nativeToday > 0 &&
      (!native.userId || native.userId === userId) &&
      (!native.localDate || native.localDate === today) &&
      !looksLikeSinceBootCounter({
        todaySteps: nativeToday,
        sensorTotal: native.sensorTotal,
        dailyBaseline: native.dailyBaseline,
      })
    ) {
      live = Math.max(live, nativeToday);
    }
  } catch {
    /* optional */
  }
  return live;
}

async function pollOnce(): Promise<void> {
  if (_polling) return;
  _polling = true;
  try {
    const userId = store.getState().raceProgress.userId;
    if (!userId) return;

    const raw = await readLiveSessionSteps(userId);
    const rp = store.getState().raceProgress;
    if (
      rp.stepSource === "health_connect" ||
      rp.stepSource === "android_health_connect" ||
      rp.stepSource === "healthkit" ||
      rp.stepSource === "ios_healthkit"
    ) {
      return;
    }
    const verified = Math.max(0, Math.floor(rp.verifiedTodaySteps ?? 0));
    if (
      shouldHoldSensorSessionUntilVerifiedRead({
        sessionSteps: raw,
        verifiedSteps: verified,
        hasVerifiedAnchor: getVerifiedSensorAnchor()?.localDate === getLocalDateStr(),
      })
    ) {
      return;
    }
    let sensorTotal: number | null = null;
    try {
      const native = await stepTrackingNotificationService.getNativeStepState(userId);
      sensorTotal =
        native && typeof native.sensorTotal === "number" ? native.sensorTotal : null;
    } catch {
      sensorTotal = null;
    }
    const anchored = resolveAnchoredDisplaySteps({
      verifiedSteps: verified,
      sensorTotal,
      sessionTodaySteps: raw,
    });
    const next = Math.max(verified, anchored);
    if (next <= verified) return;

    updateStepProgressFromRealSource({
      todaySteps: next,
      stepSource: "android_step_counter",
      dailyLane: "provisional",
      updatedAt: new Date().toISOString(),
      fromWatch: true,
    });

    try {
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
 * Start polling native FGS + cached sensor session for hybrid HC mode.
 * Safe to call repeatedly — restarts the poll loop fresh.
 */
export async function startHybridLiveDailyDisplay(): Promise<boolean> {
  if (Platform.OS !== "android") return false;
  const dailySource = store.getState().raceProgress.stepSource;
  if (
    dailySource === "health_connect" ||
    dailySource === "android_health_connect" ||
    dailySource === "healthkit" ||
    dailySource === "ios_healthkit"
  ) {
    return false;
  }
  if (!FEATURE_FLAGS.ENABLE_LIVE_RACE_DEVICE_SENSOR) return false;

  let arOk = await hasActivityRecognitionPermission();
  if (!arOk) {
    // HC can be fully allowed while Samsung writes nothing. Live Walk still
    // needs Physical activity — do not silently stay at 0.
    arOk = await ensureActivityRecognitionPermission({
      promptIfMissing: true,
      allowSettingsHelper: true,
    });
  }
  if (!arOk) {
    if (__DEV__) {
      console.log("[HybridLive] skip — ACTIVITY_RECOGNITION not granted");
    }
    return false;
  }

  const available = await androidLegacySensorProvider.isAvailable();
  if (!available) {
    if (__DEV__) {
      console.log("[HybridLive] skip — TYPE_STEP_COUNTER unavailable");
    }
    return false;
  }

  stopHybridLiveDailyDisplay();

  try {
    await stepTrackingNotificationService.ensureNativeBackgroundTracking();
  } catch {
    /* FGS may already be running */
  }
  void pollOnce();
  _pollTimer = setInterval(() => {
    void pollOnce();
  }, POLL_MS);

  if (__DEV__) {
    console.log(
      "[HybridLive] started — native FGS session + cached sensor (HC stays verified)",
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
