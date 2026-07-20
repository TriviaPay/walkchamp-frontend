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
import { isJsAuthoritativeStepSession } from "@/services/steps/jsStepOwnership";
import { getLocalDateStr, isStepSnapshotFromBeforeToday } from "@/utils/timezone";
import { sanitizeLegacyProviderSteps } from "@/utils/stepAccuracy";
import { STEP_SYNC_CONFIG } from "@/config/stepSyncConfig";
import { stepAudit } from "@/utils/stepAudit";

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
    stepAudit.noteMerge({
      providerId: stepProviderManager.getActiveProviderId(),
      eventOrigin: "merge",
      displayMergeInputs: `provider=${provider};native=skipped_verified`,
      displayMergeResult: provider,
      calculatedDailySteps: provider,
    });
    return provider;
  }

  // JS live watch / race poll owns UI — FGS is notification-only (no Redux adoption).
  if (isJsAuthoritativeStepSession()) {
    stepAudit.noteMerge({
      providerId: stepProviderManager.getActiveProviderId(),
      eventOrigin: "merge",
      displayMergeInputs: `provider=${provider};native=skipped_js_owns`,
      displayMergeResult: provider,
      calculatedDailySteps: provider,
    });
    return provider;
  }

  const nativeSteps = await stepTrackingNotificationService.getNativeWalkSteps();
  if (nativeSteps == null) return provider;

  const activeUserId = store.getState().raceProgress.userId;
  const nativeState = await stepTrackingNotificationService.getNativeStepState(
    activeUserId ?? undefined,
  );
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
  const sanitized = sanitizeLegacyProviderSteps(merged, provider, provider);
  if (sanitized < merged && __DEV__ && STEP_SYNC_CONFIG.STEP_DEBUG_VERBOSE) {
    console.log(
      `[StepStore] sanitized native walk merge provider=${provider} native=${nativeSteps} merged=${merged} final=${sanitized}`,
    );
  }
  stepAudit.noteMerge({
    providerId: stepProviderManager.getActiveProviderId(),
    eventOrigin: "fgs",
    displayMergeInputs: `provider=${provider};native=${nativeSteps};merged=${merged}`,
    displayMergeResult: sanitized,
    calculatedDailySteps: sanitized,
  });
  if (sanitized > provider) {
    stepAudit.log(
      {
        provider: "android_counter",
        eventOrigin: "fgs",
        suspiciousIncreaseReason: "native_fgs_ahead_of_provider",
        calculatedDailySteps: sanitized,
        previousDailySteps: provider,
      },
      true,
    );
  }
  return sanitized;
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

  if (isJsAuthoritativeStepSession()) {
    if (__DEV__) {
      console.log("[StepStore] skipped native race merge — JS session owns race steps");
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
