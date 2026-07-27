/**
 * Hybrid step-state helpers — verified vs provisional lanes.
 *
 * Android:
 *   verified daily = Health Connect
 *   provisional display = TYPE_STEP_COUNTER
 *   live race = TYPE_STEP_COUNTER
 *   race verify = Health Connect
 *
 * iOS:
 *   verified daily = HealthKit
 *   provisional display = CMPedometer (while app can execute)
 *   live race = CMPedometer
 *   race verify = HealthKit
 *
 * Never upload provisional display values as verified daily Health Connect / HealthKit.
 */

/** Canonical step sources for new state and requests. */
export const STEP_SOURCES = {
  verifiedDailyAndroid: "health_connect",
  provisionalDailyAndroid: "android_step_counter",
  liveRaceAndroid: "android_step_counter",

  verifiedDailyIOS: "healthkit",
  provisionalDailyIOS: "ios_pedometer",
  liveRaceIOS: "ios_pedometer",

  /** @deprecated Migration aliases only — do not write into new state/requests. */
  verifiedDailyAndroidApi: "android_health_connect",
  verifiedDailyIos: "healthkit",
  verifiedDailyIosApi: "ios_healthkit",
  liveRaceIos: "ios_pedometer",
  liveRaceIosApi: "device_sensor",
} as const;

export const IOS_STEP_SOURCES = {
  verifiedDaily: STEP_SOURCES.verifiedDailyIOS,
  provisionalDaily: STEP_SOURCES.provisionalDailyIOS,
  liveRace: STEP_SOURCES.liveRaceIOS,
} as const;

/**
 * Map legacy / alternate labels → canonical STEP_SOURCES values.
 * Keep aliases here only; do not propagate into new Redux or API payloads.
 */
export function migrateStepSourceAlias(source: string | null | undefined): string | null {
  if (!source) return null;
  switch (source.toLowerCase()) {
    case "android_health_connect":
    case "health_connect":
      return STEP_SOURCES.verifiedDailyAndroid;
    case "ios_healthkit":
    case "healthkit":
      return STEP_SOURCES.verifiedDailyIOS;
    case "android_counter":
    case "android_legacy_sensor":
    case "android_device_step_counter":
    case "device_sensor":
    case "phone_sensor":
    case "sensor":
    case "activity_sensor":
    case "android_step_counter":
      return STEP_SOURCES.liveRaceAndroid;
    case "ios_core_motion":
    case "core_motion":
    case "pedometer":
    case "ios_pedometer":
      return STEP_SOURCES.liveRaceIOS;
    default:
      return source;
  }
}

export type DailyDisplaySource =
  | "health_connect"
  | "healthkit"
  | "sensor_estimate"
  | "pedometer_estimate";

export type DailyVerificationStatus =
  | "verified"
  | "pending"
  | "delayed"
  | "temporarily_unavailable"
  | "unavailable";

/**
 * Formal hybrid race state — live vs verified vs backend reconciliation.
 * finalAuthoritativeSteps comes only from backend reconciliation status.
 */
export type HybridRaceState = {
  raceId: string | null;
  participantId: string | null;

  liveSteps: number;
  liveSource: "android_step_counter" | "ios_pedometer" | null;

  liveSessionId: string | null;
  liveSequence: number;
  lastLiveUpdateAt: string | null;

  verifiedSteps: number | null;
  verificationSource: "health_connect" | "healthkit" | null;
  lastVerifiedAt: string | null;

  backendAcceptedLiveSteps: number;
  backendReconciledSteps: number | null;

  reconciliationStatus:
    | "not_started"
    | "pending"
    | "verification_delayed"
    | "review_required"
    | "verification_rejected"
    | "finalized";

  finalAuthoritativeSteps: number | null;

  status:
    | "idle"
    | "starting"
    | "live"
    | "background"
    | "recovering"
    | "verifying"
    | "reconciling"
    | "completed"
    | "error";
};

export type DailyStepState = {
  verifiedTodaySteps: number;
  provisionalTodaySteps: number | null;
  displayTodaySteps: number;
  /** @deprecated Compatibility display alias — equals displayTodaySteps. */
  todaySteps: number;
  verifiedAt: string | null;
  provisionalUpdatedAt: string | null;
  verifiedSource: "health_connect" | "healthkit" | null;
  provisionalSource: "android_step_counter" | "ios_pedometer" | null;
  verificationStatus:
    | "verified"
    | "pending"
    | "delayed"
    | "provider_unavailable"
    | "permission_missing"
    | "temporary_error"
    | "temporarily_unavailable"
    | "unavailable";
  localDate: string;
  timezone: string;
  displaySource: DailyDisplaySource;
};

export type AndroidDailyStepState = {
  verifiedTodaySteps: number;
  provisionalSensorTodaySteps: number | null;
  displayTodaySteps: number;
  verifiedAt: string | null;
  sensorUpdatedAt: string | null;
  displaySource: DailyDisplaySource;
  verificationStatus: DailyVerificationStatus;
};

export type AndroidHybridRaceState = {
  raceId: string | null;
  liveSensorSteps: number;
  verifiedRaceSteps: number | null;
  reconciledRaceSteps: number;
  lastLiveUpdateAt: string | null;
  lastVerificationAt: string | null;
  lastUploadedLiveSteps: number;
  liveSource: "android_step_counter" | null;
  verificationSource: "health_connect";
  status:
    | "idle"
    | "starting"
    | "live"
    | "background"
    | "verifying"
    | "reconciling"
    | "completed"
    | "error";
};

export type IOSDailyStepState = {
  verifiedTodaySteps: number;
  provisionalPedometerTodaySteps: number | null;
  displayTodaySteps: number;
  verifiedAt: string | null;
  pedometerUpdatedAt: string | null;
  displaySource: "healthkit" | "pedometer_estimate";
  verificationStatus: DailyVerificationStatus;
};

export type VerifiedDailySyncDecision =
  | {
      action: "submit_verified";
      steps: number;
      source: "health_connect" | "healthkit";
      measuredAtUtc: string;
    }
  | {
      action: "preserve_backend";
      reason:
        | "provider_empty"
        | "provider_delayed"
        | "provider_unavailable"
        | "permission_missing"
        | "temporary_error";
    }
  | {
      action: "skip";
      reason:
        | "unchanged"
        | "not_authenticated"
        | "invalid_date"
        | "tracking_incomplete"
        | "below_min_delta";
    };

export type VerifiedDailyProviderQueryStatus =
  | "ok"
  | "empty"
  | "delayed"
  | "unavailable"
  | "permission_missing"
  | "temporary_error"
  | "unknown";

/** Display-only merge — never used for verified backend daily sync. */
export function computeDisplayTodaySteps(
  verifiedTodaySteps: number,
  provisionalTodaySteps: number | null | undefined,
): number {
  const verified = Math.max(0, Math.floor(verifiedTodaySteps));
  const provisional =
    provisionalTodaySteps == null
      ? 0
      : Math.max(0, Math.floor(provisionalTodaySteps));
  return Math.max(verified, provisional);
}

export function resolveDailyDisplaySource(params: {
  verifiedTodaySteps: number;
  provisionalSensorTodaySteps: number | null | undefined;
  platform: "android" | "ios" | string;
}): DailyDisplaySource {
  const verified = Math.max(0, Math.floor(params.verifiedTodaySteps));
  const provisional =
    params.provisionalSensorTodaySteps == null
      ? 0
      : Math.max(0, Math.floor(params.provisionalSensorTodaySteps));
  if (provisional > verified) {
    return params.platform === "ios" ? "pedometer_estimate" : "sensor_estimate";
  }
  return params.platform === "ios" ? "healthkit" : "health_connect";
}

/** Sources that advance provisional daily display only (never verified sync). */
export function isProvisionalDailyStepSource(
  source: string | null | undefined,
): boolean {
  if (!source) return false;
  switch (source.toLowerCase()) {
    case "android_step_counter":
    case "android_counter":
    case "android_legacy_sensor":
    case "android_device_step_counter":
    case "sensor":
    case "device_sensor":
    case "ios_pedometer":
    case "ios_core_motion":
    case "pedometer":
    case "phone_sensor":
    case "activity_sensor":
      return true;
    default:
      return false;
  }
}

export function isVerifiedDailyStepSource(
  source: string | null | undefined,
): boolean {
  if (!source) return false;
  switch (source.toLowerCase()) {
    case "health_connect":
    case "android_health_connect":
    case "healthkit":
    case "ios_healthkit":
      return true;
    default:
      return false;
  }
}

/**
 * Steps eligible for verified daily backend POST.
 * Prefer explicit verified lane; never prefer provisional-only inflation.
 */
export function selectVerifiedTodayStepsForSync(params: {
  verifiedTodaySteps: number;
  displayTodaySteps: number;
  lastHcProviderSteps: number | null | undefined;
}): number {
  const verified = Math.max(0, Math.floor(params.verifiedTodaySteps));
  const provider =
    params.lastHcProviderSteps == null
      ? null
      : Math.max(0, Math.floor(params.lastHcProviderSteps));
  if (provider != null && provider > 0) {
    return Math.max(verified, provider);
  }
  // HC/HK empty — sync verified lane only (may equal last good HC), not display.
  return verified;
}

/**
 * Typed decision for verified daily backend synchronization.
 * Never submits provisional/display inflation as Health Connect / HealthKit.
 */
export function decideVerifiedDailySync(params: {
  authenticated: boolean;
  localDateValid: boolean;
  trackingComplete: boolean;
  verifiedTodaySteps: number;
  displayTodaySteps: number;
  lastHcProviderSteps: number | null | undefined;
  providerQueryStatus: VerifiedDailyProviderQueryStatus;
  backendTodaySteps: number;
  lastSyncedSteps: number;
  syncTotalAfterCap: number;
  platform: "android" | "ios" | string;
  measuredAtUtc?: string;
  minDelta?: number;
}): VerifiedDailySyncDecision {
  if (!params.authenticated) {
    return { action: "skip", reason: "not_authenticated" };
  }
  if (!params.localDateValid) {
    return { action: "skip", reason: "invalid_date" };
  }
  if (!params.trackingComplete) {
    return { action: "skip", reason: "tracking_incomplete" };
  }

  assertDisplayNotPassedAsVerified(
    params.displayTodaySteps,
    params.syncTotalAfterCap,
    params.verifiedTodaySteps,
    params.lastHcProviderSteps,
  );

  switch (params.providerQueryStatus) {
    case "delayed":
      return { action: "preserve_backend", reason: "provider_delayed" };
    case "unavailable":
      return { action: "preserve_backend", reason: "provider_unavailable" };
    case "permission_missing":
      return { action: "preserve_backend", reason: "permission_missing" };
    case "temporary_error":
      return { action: "preserve_backend", reason: "temporary_error" };
    case "empty":
      // Cap already floor-preserved backend; do not invent or re-POST a HC reading.
      return { action: "preserve_backend", reason: "provider_empty" };
    default:
      break;
  }

  const delta = params.syncTotalAfterCap - params.lastSyncedSteps;
  if (delta <= 0) {
    return { action: "skip", reason: "unchanged" };
  }
  const minDelta = params.minDelta ?? 1;
  if (delta < minDelta) {
    return { action: "skip", reason: "below_min_delta" };
  }

  const source =
    params.platform === "ios"
      ? STEP_SOURCES.verifiedDailyIOS
      : STEP_SOURCES.verifiedDailyAndroid;

  return {
    action: "submit_verified",
    steps: Math.max(0, Math.floor(params.syncTotalAfterCap)),
    source,
    measuredAtUtc: params.measuredAtUtc ?? new Date().toISOString(),
  };
}

/** Dev-only: verified daily request cannot use a sensor/provisional source. */
export function assertVerifiedDailySyncSource(
  source: string | null | undefined,
): void {
  if (typeof __DEV__ === "undefined" || !__DEV__) return;
  if (isProvisionalDailyStepSource(source)) {
    throw new Error(
      "[HybridSteps] verified daily sync cannot use sensor/provisional source",
    );
  }
}

/**
 * Dev-only: displayTodaySteps must not be the sole basis for verified sync
 * when it exceeds verified + provider.
 */
export function assertDisplayNotPassedAsVerified(
  displayTodaySteps: number,
  syncTotal: number,
  verifiedTodaySteps: number,
  providerSteps: number | null | undefined,
): void {
  if (typeof __DEV__ === "undefined" || !__DEV__) return;
  const display = Math.max(0, Math.floor(displayTodaySteps));
  const sync = Math.max(0, Math.floor(syncTotal));
  const verified = Math.max(0, Math.floor(verifiedTodaySteps));
  const provider =
    providerSteps == null ? 0 : Math.max(0, Math.floor(providerSteps));
  const authoritativeCeiling = Math.max(verified, provider);
  if (sync > authoritativeCeiling && sync === display && display > verified) {
    throw new Error(
      "[HybridSteps] displayTodaySteps cannot be passed to verified sync",
    );
  }
}

/**
 * Android race reboot / sensor-reset re-anchor (mirrors NativeStepSensorEngine).
 * Preserves already-accepted race progress; does not zero race steps.
 */
export function reanchorAndroidRaceBaseline(params: {
  currentRawSensorTotal: number;
  lastRawSensorTotal: number;
  sensorBaseline: number;
  acceptedRaceSteps: number;
  bootSessionChanged: boolean;
}): {
  sensorBaseline: number;
  liveRaceSteps: number;
  reanchored: boolean;
} {
  const current = Math.max(0, Math.floor(params.currentRawSensorTotal));
  const last = Math.max(0, Math.floor(params.lastRawSensorTotal));
  const accepted = Math.max(0, Math.floor(params.acceptedRaceSteps));
  const resetDetected =
    params.bootSessionChanged || current < last;
  if (resetDetected) {
    const newBaseline = Math.max(0, current - accepted);
    return {
      sensorBaseline: newBaseline,
      liveRaceSteps: accepted,
      reanchored: true,
    };
  }
  const live = Math.max(accepted, current - Math.floor(params.sensorBaseline));
  return {
    sensorBaseline: Math.floor(params.sensorBaseline),
    liveRaceSteps: Math.max(0, live),
    reanchored: false,
  };
}
