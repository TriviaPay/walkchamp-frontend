/**
 * Merge rules for step counts across provider, app UI, and native notification.
 *
 * - Health Connect / HealthKit are always authoritative — never adopt native FGS
 *   sensor-inflated counts (native TYPE_STEP_COUNTER must not override verified reads).
 * - Legacy Android sensor only: on resume, take max(provider, native FGS) once so
 *   steps tracked while JS was asleep are not lost.
 */

import { Platform } from "react-native";
import { store } from "@/store";
import { raceProgressNotificationService } from "@/services/raceProgressNotificationService";
import { stepTrackingNotificationService } from "@/services/stepTrackingNotificationService";
import { stepProviderManager } from "@/services/steps/stepProviderManager";
import { getLocalDateStr, isStepSnapshotFromBeforeToday } from "@/utils/timezone";

export function mergeMonotonic(current: number, incoming: number): number {
  return Math.max(Math.max(0, Math.floor(current)), Math.max(0, Math.floor(incoming)));
}

/** One-shot merge after background — never lower than provider, may adopt native progress. */
export async function mergeWalkStepsWithNative(providerSteps: number): Promise<number> {
  const provider = Math.max(0, Math.floor(providerSteps));
  if (Platform.OS !== "android") return provider;

  // Verified sources (HC / HealthKit) must not be overwritten by native sensor ticks.
  if (stepProviderManager.usesVerifiedStepSource()) {
    if (__DEV__) {
      console.log(
        `[StepStore] skipped native walk merge — verified source=${stepProviderManager.getActiveProviderId()}`,
      );
    }
    return provider;
  }

  const nativeSteps = await stepTrackingNotificationService.getNativeWalkSteps();
  if (nativeSteps == null) return provider;

  const nativeState = await stepTrackingNotificationService.getNativeStepState();
  const activeUserId = store.getState().raceProgress.userId;
  if (
    activeUserId &&
    nativeState?.userId &&
    nativeState.userId !== activeUserId
  ) {
    if (__DEV__) {
      console.log(
        `[StepStore] skipped native walk merge — user mismatch native=${nativeState.userId} active=${activeUserId}`,
      );
    }
    return provider;
  }
  const today = getLocalDateStr();
  if (nativeState?.localDate && nativeState.localDate !== today) {
    if (__DEV__) {
      console.log(
        `[StepStore] skipped native walk merge — stale localDate=${nativeState.localDate}`,
      );
    }
    return provider;
  }

  const nativeUpdatedAt = nativeState?.updatedAt ?? nativeState?.lastUpdatedAt ?? 0;
  if (isStepSnapshotFromBeforeToday(nativeUpdatedAt, nativeSteps)) {
    if (__DEV__) {
      console.log(
        `[StepStore] skipped native walk merge — stale snapshot steps=${nativeSteps} updatedAt=${nativeUpdatedAt}`,
      );
    }
    return provider;
  }

  const merged = Math.max(provider, nativeSteps);
  if (__DEV__ && merged > provider) {
    console.log(
      `[StepStore] merged walk source=native_service provider=${provider} native=${nativeSteps} merged=${merged}`,
    );
  }
  return merged;
}

/** One-shot merge after background for live race. */
export async function mergeRaceStepsWithNative(providerSteps: number): Promise<number> {
  const provider = Math.max(0, Math.floor(providerSteps));
  if (Platform.OS !== "android") return provider;

  if (stepProviderManager.usesVerifiedStepSource()) {
    if (__DEV__) {
      console.log(
        `[StepStore] skipped native race merge — verified source=${stepProviderManager.getActiveProviderId()}`,
      );
    }
    return provider;
  }

  if (!stepProviderManager.usesRaceBaseline()) {
    return provider;
  }

  const nativeState = await stepTrackingNotificationService.getNativeStepState();
  const nativeFromUnified =
    nativeState?.activeRaceId && typeof nativeState.raceSteps === "number"
      ? nativeState.raceSteps
      : null;
  const nativeSteps =
    nativeFromUnified ?? (await raceProgressNotificationService.getNativeRaceSteps());
  if (nativeSteps == null) return provider;
  const merged = Math.max(provider, nativeSteps);
  if (__DEV__ && merged > provider) {
    console.log(
      `[StepStore] merged race source=native_service provider=${provider} native=${nativeSteps} merged=${merged}`,
    );
  }
  return merged;
}
