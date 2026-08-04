/**
 * Hybrid Android live daily display.
 *
 * Health Connect stays the verified daily source, but Samsung/HC often returns
 * records=0 for long stretches. TYPE_STEP_COUNTER (Pedometer) advances the Walk
 * UI + Redux display the same way the ongoing FGS notification does — without
 * replacing the HC provider or claiming sensor as verified backend truth.
 */

import { Platform } from "react-native";
import { store } from "@/store";
import { FEATURE_FLAGS } from "@/config/featureFlags";
import { stepProviderManager } from "@/services/steps/stepProviderManager";
import { updateStepProgressFromRealSource } from "@/services/stepProgressCoordinator";
import { hasActivityRecognitionPermission } from "@/services/permissions/activityRecognitionPermissionService";

type PedometerSub = { remove: () => void };
type PedometerAPI = {
  isAvailableAsync: () => Promise<boolean>;
  getPermissionsAsync: () => Promise<{ status: string }>;
  watchStepCount: (cb: (r: { steps: number }) => void) => PedometerSub;
};

let _sub: PedometerSub | null = null;
let _startedAt = 0;
let _sessionFloor = 0;
let _anchorToday = 0;
let _floored = false;

function loadPedometer(): PedometerAPI | null {
  try {
    const m = require("expo-sensors") as { Pedometer?: PedometerAPI };
    return m.Pedometer ?? null;
  } catch {
    return null;
  }
}

function mapHcSource(): "health_connect" | "healthkit" {
  return stepProviderManager.getActiveProviderId() === "ios_healthkit"
    ? "healthkit"
    : "health_connect";
}
void mapHcSource;

/**
 * Start Pedometer-backed live daily display for hybrid HC mode.
 * Safe to call repeatedly — restarts the watch with a fresh anchor.
 */
export async function startHybridLiveDailyDisplay(): Promise<boolean> {
  if (Platform.OS !== "android") return false;
  if (!FEATURE_FLAGS.ENABLE_LIVE_RACE_DEVICE_SENSOR) return false;
  if (!stepProviderManager.usesVerifiedStepSource()) return false;

  const arOk = await hasActivityRecognitionPermission();
  if (!arOk) {
    if (__DEV__) {
      console.log("[HybridLive] skip — ACTIVITY_RECOGNITION not granted");
    }
    return false;
  }

  const ped = loadPedometer();
  if (!ped) return false;
  try {
    const available = await ped.isAvailableAsync();
    if (!available) return false;
    const { status } = await ped.getPermissionsAsync();
    if (status !== "granted") {
      if (__DEV__) console.log("[HybridLive] skip — pedometer permission not granted");
      return false;
    }
  } catch {
    return false;
  }

  stopHybridLiveDailyDisplay();

  _anchorToday = Math.max(
    0,
    Math.floor(
      store.getState().raceProgress.verifiedTodaySteps ??
        store.getState().raceProgress.todaySteps,
    ),
  );
  _sessionFloor = 0;
  _floored = false;
  _startedAt = Date.now();

  _sub = ped.watchStepCount((result) => {
    if (!stepProviderManager.usesVerifiedStepSource()) return;
    // Never advance provisional for a stale / missing Redux user (post-logout leak).
    if (!store.getState().raceProgress.userId) return;

    const raw = Math.max(0, Math.floor(result.steps));
    const since = Date.now() - _startedAt;

    // Discard the first subscribe burst (classic Android phantom).
    if (!_floored && since < 4_000) {
      if (raw <= 0) return;
      _sessionFloor = raw;
      _floored = true;
      _anchorToday = Math.max(
        _anchorToday,
        Math.floor(
          store.getState().raceProgress.verifiedTodaySteps ??
            store.getState().raceProgress.todaySteps,
        ),
      );
      return;
    }
    if (!_floored) {
      _sessionFloor = raw;
      _floored = true;
    }

    const redux = Math.max(
      0,
      Math.floor(store.getState().raceProgress.todaySteps),
    );
    // If HC/backend/FGS moved the canonical total ahead, re-anchor so we don't
    // double-count sensor deltas on top of an already-raised floor.
    if (redux > _anchorToday) {
      _anchorToday = redux;
      _sessionFloor = raw;
    }

    const delta = Math.max(0, raw - _sessionFloor);
    const next = Math.max(redux, _anchorToday + delta);
    if (next <= redux) return;

    const verified = Math.max(
      0,
      Math.floor(store.getState().raceProgress.verifiedTodaySteps ?? 0),
    );
    // Never publish a bad sensor absolute when HC already has today's total.
    if (verified > 0 && next > verified + 250) {
      _anchorToday = verified;
      _sessionFloor = raw;
      return;
    }

    updateStepProgressFromRealSource({
      todaySteps: next,
      // Provisional daily display only — never label as Health Connect verified.
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
  });

  if (__DEV__) {
    console.log(
      `[HybridLive] started anchor=${_anchorToday} (HC verified + sensor display)`,
    );
  }
  return true;
}

export function stopHybridLiveDailyDisplay(): void {
  if (_sub) {
    try {
      _sub.remove();
    } catch {
      /* ignore */
    }
    _sub = null;
  }
  _floored = false;
  _sessionFloor = 0;
}

export function isHybridLiveDailyDisplayActive(): boolean {
  return _sub != null;
}
