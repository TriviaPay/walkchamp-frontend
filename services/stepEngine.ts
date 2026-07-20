/**
 * StepEngine — normalized step pipeline facade.
 *
 * Architecture:
 *   PlatformStepProvider (stepProviderManager)
 *     → HealthConnectProvider | AndroidSensorProvider | HealthKitProvider
 *   StepCoordinator (stepProgressCoordinator)
 *     → canonical Redux store, notification, midnight reset, backend race sync
 *   WalkContext
 *     → daily poll/hydrate, UI state, backend daily sync
 *
 * All surfaces (Walk, Live Race, progress icons, Android notification) must read
 * from the same normalized totals — never independently recompute daily steps.
 */

import { getTodayKey } from "@/utils/format";
import { stepEngineLog } from "@/utils/stepAccuracy";
import { stepProviderManager } from "@/services/steps/stepProviderManager";
import {
  getRaceProgressState,
  handleMidnightRolloverIfNeeded,
  updateStepProgressFromRealSource,
} from "@/services/stepProgressCoordinator";
import type { StepProgressSource } from "@/store/slices/raceProgressSlice";

export type NormalizedStepState = {
  userId: string | null;
  localDate: string;
  source: StepProgressSource;
  todaySteps: number;
  dailyGoal: number;
  activeRaceId: string | null;
  raceSteps: number;
  raceStatus: string;
  lastUpdatedAt: string | null;
  isLoading: boolean;
};

/** Canonical step state for diagnostics and cross-screen sync checks. */
export function getNormalizedStepState(): NormalizedStepState {
  const s = getRaceProgressState();
  return {
    userId: s.userId,
    localDate: getTodayKey(),
    source: s.stepSource,
    todaySteps: s.todaySteps,
    dailyGoal: s.dailyGoal,
    activeRaceId: s.activeRaceId,
    raceSteps: s.raceSteps,
    raceStatus: s.raceStatus,
    lastUpdatedAt: s.todayStepsLastUpdatedAt,
    isLoading: false,
  };
}

export async function refreshStepSourceSelection(): Promise<void> {
  await stepProviderManager.initialize(true);
  const id = stepProviderManager.getActiveProviderId();
  const selected =
    id === "android_health_connect"
      ? "health_connect"
      : id === "android_legacy_sensor"
        ? "sensor"
        : id === "ios_healthkit"
          ? "healthkit"
          : "none";
  stepEngineLog("StepSource", `refreshed selected=${selected}`);
}

export {
  stepProviderManager as platformStepProvider,
  handleMidnightRolloverIfNeeded,
  updateStepProgressFromRealSource,
  getRaceProgressState,
  stepEngineLog,
};
