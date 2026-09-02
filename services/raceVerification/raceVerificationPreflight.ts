/**
 * resolvePrizeRaceReadiness() — protected-race preflight.
 * Does NOT replace resolveStepTrackingCapability().
 */

import { Platform } from "react-native";
import NetInfo from "@react-native-community/netinfo";
import { FEATURE_FLAGS, isProtectedRaceVerificationEnabled } from "@/config/featureFlags";
import { isProtectedRacePlatformSupported } from "./prizeRaceHelpers";
import { getInstallationId } from "@/services/deviceIdentity";
import { hasActivityRecognitionPermission } from "@/services/permissions/activityRecognitionPermissionService";
import { stepProviderManager } from "@/services/steps/stepProviderManager";
import { resolveStepTrackingCapability } from "@/platform/steps/stepTrackingCapability";
import {
  getHealthConnectSdkExtensionVersion,
  isHealthConnectOnDeviceStepsAvailable,
} from "@/platform/steps/hcOnDeviceSteps";
import { store } from "@/store";
import { resolveApprovedNativeSourceId } from "./approvedSourceResolver";
import { isIntegrityCapabilityAvailable } from "./raceIntegrityService";
import { evaluatePrizeRaceReadiness } from "./raceVerificationPreflightLogic";
import type { PrizeRaceReadiness } from "./raceVerificationTypes";

export type ResolvePrizeRaceReadinessArgs = {
  userId: string | null | undefined;
  registeredDeviceId?: string | null;
  verificationSessionObtained: boolean;
  integrityRequired?: boolean;
  raceAlreadyStarted?: boolean;
  raceAlreadyEnded?: boolean;
};

function androidApiLevel(): number {
  const v = Platform.Version;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const n = Number.parseInt(String(v), 10);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Preflight for protected/prize races. Reuses capability probes; keeps
 * daily Walk eligibility separate via resolveStepTrackingCapability().
 */
export async function resolvePrizeRaceReadiness(
  args: ResolvePrizeRaceReadinessArgs,
): Promise<PrizeRaceReadiness> {
  if (!isProtectedRaceVerificationEnabled()) {
    return {
      eligible: true,
      sensorReady: true,
      healthPlatformReady: true,
      approvedSourceReady: true,
      registeredDeviceReady: true,
      integrityReady: true,
      connectivityReady: true,
      userMessage: "Ready to Race",
    };
  }

  if (!isProtectedRacePlatformSupported()) {
    return {
      eligible: false,
      sensorReady: false,
      healthPlatformReady: false,
      approvedSourceReady: false,
      registeredDeviceReady: false,
      integrityReady: false,
      connectivityReady: true,
      failureReason: "ios_not_configured",
      userMessage:
        "Verified prize challenges aren't available on iPhone yet. Free races are still available.",
    };
  }

  const net = await NetInfo.fetch().catch(() => null);
  const internetConnected =
    net == null
      ? true
      : net.isConnected !== false && net.isInternetReachable !== false;

  const currentDeviceId = await getInstallationId().catch(() => null);
  const registeredDeviceId =
    args.registeredDeviceId ??
    store.getState().prizeVerification.registeredDeviceId ??
    currentDeviceId;

  await stepProviderManager.initialize().catch(() => null);
  const capability = await resolveStepTrackingCapability().catch(() => null);

  let sensorReady = capability?.provisionalTrackingAvailable === true;
  if (FEATURE_FLAGS.ENABLE_LIVE_RACE_DEVICE_SENSOR) {
    const liveOk = await stepProviderManager
      .ensureLiveRaceSensorReady()
      .catch(() => false);
    if (liveOk === true) sensorReady = true;
  }

  const healthPlatformReady =
    capability?.verifiedHealthAvailable === true &&
    capability?.verifiedPermissionGranted === true;

  // iOS: HealthKit auth is not a reliable boolean — require records/readable path.
  let approvedSourceReady = false;
  if (Platform.OS === "ios") {
    const recordsOk = capability?.verifiedRecordsAvailable === true;
    const source = await resolveApprovedNativeSourceId();
    approvedSourceReady =
      healthPlatformReady && (recordsOk || source.ready);
    if (source.approvedSourceId) {
      // Source id may still be unresolved on first builds; records gate is primary.
    }
  } else {
    const source = await resolveApprovedNativeSourceId();
    const arOk = await hasActivityRecognitionPermission().catch(() => false);
    approvedSourceReady =
      source.ready &&
      !!source.approvedSourceId &&
      arOk &&
      isHealthConnectOnDeviceStepsAvailable();
  }

  const integrityRequired = args.integrityRequired !== false;
  const integrityCapabilityAvailable = await isIntegrityCapabilityAvailable();

  const androidApiOk =
    Platform.OS !== "android" ? undefined : androidApiLevel() >= 34;
  const sdkExtensionOk =
    Platform.OS !== "android"
      ? undefined
      : isHealthConnectOnDeviceStepsAvailable() ||
        getHealthConnectSdkExtensionVersion() >= 13;

  return evaluatePrizeRaceReadiness({
    authenticated: !!args.userId?.trim(),
    internetConnected,
    registeredDeviceId,
    currentDeviceId,
    verificationSessionObtained: args.verificationSessionObtained,
    raceAlreadyStarted: !!args.raceAlreadyStarted,
    raceAlreadyEnded: !!args.raceAlreadyEnded,
    integrityCapabilityAvailable,
    integrityRequired,
    sensorReady,
    healthPlatformReady: !!healthPlatformReady,
    approvedSourceReady,
    androidApiOk,
    sdkExtensionOk,
  });
}
