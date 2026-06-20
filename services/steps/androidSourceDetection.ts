/**
 * Android step-source auto-detection.
 *
 * Priority order (matches product spec):
 *   1. Health Connect (verified)
 *   2. Optional fitness apps — only advertised if truly integrated or bridgeable
 *   3. Device TYPE_STEP_COUNTER via expo-sensors (limited — no rewards)
 *   4. Unsupported
 *
 * No fake data, no misleading app-compatibility claims.
 * Installed-app detection uses Linking.canOpenURL() as a best-effort probe —
 * on Android 11+ package-visibility restrictions mean a false result does NOT
 * mean the app is absent, only that we can't confirm it. We therefore only
 * use detection results to refine messaging, never to claim integration.
 */

import { Platform } from "react-native";
import { androidHCService, isExpoGo } from "./androidHealthConnectService";
import { HC_SDK, HC_MIN_API } from "./androidStepTrackingMappings";

// ── Source & verification types ────────────────────────────────────────────────

export type AndroidStepSourceId =
  | "android_health_connect"
  | "android_google_fit"
  | "android_samsung_health"
  | "fitbit_cloud"
  | "garmin_cloud"
  | "android_health_sync_bridge"
  | "android_device_step_counter"
  | "unsupported";

export type VerificationLevel = "verified" | "limited" | "unsupported";

export type HCStatus =
  | "available"
  | "permission_granted"
  | "permission_denied"
  | "not_installed"
  | "provider_update_required"
  | "unsupported";

export interface DetectedOptionalSource {
  id: AndroidStepSourceId;
  label: string;
  /** True = Linking probe succeeded (app likely installed). */
  likelyInstalled: boolean;
  /**
   * Whether Walk Champ has a real integration for this source right now.
   * false = show honest "not connected" message; do NOT pretend it works.
   */
  integrated: boolean;
  /**
   * Human-readable guidance shown in the setup UI.
   */
  statusMessage: string;
}

export interface AndroidStepSourceDetectionResult {
  platform: "android";
  recommendedSource: AndroidStepSourceId;
  availableSources: AndroidStepSourceId[];
  installedFitnessApps: DetectedOptionalSource[];
  healthConnectStatus: HCStatus;
  deviceStepSensorAvailable: boolean;
  verificationLevel: VerificationLevel;
  requiresUserAction: boolean;
}

// ── Optional-app probes ────────────────────────────────────────────────────────

/**
 * App packages whose deep-link schemes we probe.
 * These are best-effort only; see module doc for caveats.
 * Walk Champ has NO direct integration with any of these — we only use
 * Health Connect as the bridge. We advertise this honestly in the UI.
 */
const OPTIONAL_APPS: {
  id: AndroidStepSourceId;
  label: string;
  scheme: string;
  statusMessage: string;
}[] = [
  {
    id: "android_samsung_health",
    label: "Samsung Health",
    scheme: "shealth://",
    statusMessage:
      "Samsung Health can sync steps to Health Connect. Enable the sync in Samsung Health → Settings → Connected Services → Health Connect, then connect Health Connect to Walk Champ.",
  },
  {
    id: "android_google_fit",
    label: "Google Fit",
    scheme: "com.google.android.apps.fitness://",
    statusMessage:
      "Google Fit can sync steps to Health Connect. Open Google Fit → Settings → Manage your data in Health Connect, then connect Health Connect to Walk Champ.",
  },
  {
    id: "fitbit_cloud",
    label: "Fitbit",
    scheme: "fitbit://",
    statusMessage:
      "Direct Fitbit step sync is not yet supported. Fitbit does not natively sync to Health Connect. A future update may add Fitbit account connection.",
  },
  {
    id: "garmin_cloud",
    label: "Garmin Connect",
    scheme: "garmin-connect://",
    statusMessage:
      "Direct Garmin step sync is not yet supported. A future update may add Garmin API connection.",
  },
  {
    id: "android_health_sync_bridge",
    label: "Health Sync",
    scheme: "healthsync://",
    statusMessage:
      "Health Sync can bridge wearable data into Health Connect. Once synced, connect Health Connect to Walk Champ.",
  },
];

/** Always-available list for setup UI — shown even when Linking probes fail. */
export function getStaticFallbackFitnessApps(): DetectedOptionalSource[] {
  return OPTIONAL_APPS.map((app) => ({
    id: app.id,
    label: app.label,
    likelyInstalled: false,
    integrated: false,
    statusMessage: app.statusMessage,
  }));
}

async function probeAppInstalled(scheme: string): Promise<boolean> {
  try {
    const { Linking } =
      require("react-native") as typeof import("react-native");
    return await Linking.canOpenURL(scheme);
  } catch {
    return false;
  }
}

// ── Device step sensor ─────────────────────────────────────────────────────────

async function checkDeviceSensor(): Promise<boolean> {
  try {
    // expo-sensors Pedometer wraps TYPE_STEP_COUNTER on Android.
    // isAvailableAsync() returns true only when hardware sensor is present.
    const sensors =
      require("expo-sensors") as typeof import("expo-sensors");
    const available = await sensors.Pedometer.isAvailableAsync();
    return available;
  } catch {
    return false;
  }
}

async function probeOptionalAppsAndSensor(): Promise<{
  detectedApps: DetectedOptionalSource[];
  sensorAvailable: boolean;
}> {
  const detectedApps: DetectedOptionalSource[] = await Promise.all(
    OPTIONAL_APPS.map(async (app) => ({
      id: app.id,
      label: app.label,
      likelyInstalled: await probeAppInstalled(app.scheme),
      integrated: false,
      statusMessage: app.statusMessage,
    })),
  );
  const sensorAvailable = await checkDeviceSensor();
  return { detectedApps, sensorAvailable };
}

// ── Main detection function ────────────────────────────────────────────────────

/**
 * Detect the best available Android step source.
 * Call on app launch / setup screen open.
 * Safe to call multiple times (idempotent read — no side effects).
 */
export async function detectAndroidStepSources(): Promise<AndroidStepSourceDetectionResult> {
  if (Platform.OS !== "android") {
    return {
      platform: "android",
      recommendedSource: "unsupported",
      availableSources: [],
      installedFitnessApps: [],
      healthConnectStatus: "unsupported",
      deviceStepSensorAvailable: false,
      verificationLevel: "unsupported",
      requiresUserAction: false,
    };
  }

  if (isExpoGo()) {
    const { detectedApps, sensorAvailable } = await probeOptionalAppsAndSensor();
    return {
      platform: "android",
      recommendedSource: sensorAvailable ? "android_device_step_counter" : "unsupported",
      availableSources: sensorAvailable ? ["android_device_step_counter"] : [],
      installedFitnessApps: detectedApps.length > 0 ? detectedApps : getStaticFallbackFitnessApps(),
      healthConnectStatus: "unsupported",
      deviceStepSensorAvailable: sensorAvailable,
      verificationLevel: sensorAvailable ? "limited" : "unsupported",
      requiresUserAction: true,
    };
  }

  const apiLevel =
    typeof Platform.Version === "number" ? Platform.Version : 0;

  // ── 1. Health Connect ──────────────────────────────────────────────────────

  let hcStatus: HCStatus = "unsupported";
  let hcAvailable = false;

  try {
    const sdkStatus = await androidHCService.getSdkStatusRaw();

    if (sdkStatus === HC_SDK.SDK_AVAILABLE) {
      const init = await androidHCService.initialize();
      if (init.initialized) {
        hcStatus = init.permission === "granted" ? "permission_granted" : "available";
        hcAvailable = true;
      } else {
        hcStatus = "available";
        hcAvailable = true;
      }
    } else if (
      sdkStatus === HC_SDK.SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED &&
      apiLevel >= HC_MIN_API
    ) {
      hcStatus = "provider_update_required";
    } else if (sdkStatus === HC_SDK.SDK_UNAVAILABLE && apiLevel >= HC_MIN_API) {
      hcStatus = "not_installed";
    } else {
      hcStatus = "unsupported";
    }
  } catch {
    hcStatus = "unsupported";
  }

  const { detectedApps, sensorAvailable } = await probeOptionalAppsAndSensor();
  const fitnessApps =
    detectedApps.length > 0 ? detectedApps : getStaticFallbackFitnessApps();

  if (hcAvailable) {
    const availableSources: AndroidStepSourceId[] = ["android_health_connect"];
    if (sensorAvailable) availableSources.push("android_device_step_counter");
    return {
      platform: "android",
      recommendedSource: "android_health_connect",
      availableSources,
      installedFitnessApps: fitnessApps,
      healthConnectStatus: hcStatus,
      deviceStepSensorAvailable: sensorAvailable,
      verificationLevel: hcStatus === "permission_granted" ? "verified" : "verified",
      requiresUserAction: hcStatus !== "permission_granted",
    };
  }

  if (hcStatus === "provider_update_required" || hcStatus === "not_installed") {
    const availableSources: AndroidStepSourceId[] = ["android_health_connect"];
    if (sensorAvailable) availableSources.push("android_device_step_counter");
    return {
      platform: "android",
      recommendedSource: "android_health_connect",
      availableSources,
      installedFitnessApps: fitnessApps,
      healthConnectStatus: hcStatus,
      deviceStepSensorAvailable: sensorAvailable,
      verificationLevel: "unsupported",
      requiresUserAction: true,
    };
  }

  // ── 2. HC unsupported — sensor + optional apps ─────────────────────────────

  // ── Build result ───────────────────────────────────────────────────────────

  const availableSources: AndroidStepSourceId[] = [];
  if (sensorAvailable) availableSources.push("android_device_step_counter");

  const recommendedSource: AndroidStepSourceId = sensorAvailable
    ? "android_device_step_counter"
    : "unsupported";

  const verificationLevel: VerificationLevel = sensorAvailable
    ? "limited"
    : "unsupported";

  return {
    platform: "android",
    recommendedSource,
    availableSources,
    installedFitnessApps: fitnessApps,
    healthConnectStatus: "unsupported",
    deviceStepSensorAvailable: sensorAvailable,
    verificationLevel,
    requiresUserAction: true,
  };
}

/**
 * Derive verification level from an active source ID.
 * Used by WalkContext to publish `canJoinRewardRaces`.
 */
export function sourceToVerificationLevel(
  source: AndroidStepSourceId | "ios_healthkit" | null,
): VerificationLevel {
  if (!source) return "unsupported";
  switch (source) {
    case "ios_healthkit":
    case "android_health_connect":
      return "verified";
    case "android_device_step_counter":
      return "limited";
    default:
      return "unsupported";
  }
}
