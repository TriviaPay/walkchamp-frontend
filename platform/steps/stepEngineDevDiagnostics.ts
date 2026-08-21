/**
 * DEV-only step-engine diagnostics. Do not log private Health Connect records.
 */

import { Platform } from "react-native";
import { store } from "@/store";
import { androidHCService } from "./androidHealthConnectService";
import {
  getHealthConnectSdkExtensionVersion,
  isHealthConnectOnDeviceStepsAvailable,
} from "./hcOnDeviceSteps";
import { resolvePrizeEligibility } from "./stepProviderStateLogic";
import {
  getExternalVerifiedSourceConfirmed,
  resolveVerifiedCapabilityKind,
} from "./verifiedCapabilityStore";

export type StepEngineDevDiagnostics = {
  androidApiLevel: number;
  sdkExtensionVersion: number;
  hcSdkStatus: number | null;
  readStepsGranted: boolean | null;
  nativeHcStepCaptureAvailable: boolean;
  verifiedStatus: string;
  verifiedCapability: string;
  verifiedAggregate: number | null;
  localTodaySteps: number | null;
  stepCounterAvailable: boolean | null;
  sensorRawValue: number | null;
  sensorBaseline: number | null;
  raceSessionDelta: number | null;
  displayedTodaySteps: number;
  canUsePrizeFeatures: boolean;
  prizeBlockReason: string | null;
};

export async function collectStepEngineDevDiagnostics(): Promise<StepEngineDevDiagnostics> {
  const apiLevel =
    Platform.OS === "android" && typeof Platform.Version === "number"
      ? Platform.Version
      : 0;
  let hcSdkStatus: number | null = null;
  try {
    hcSdkStatus = await androidHCService.getSdkStatusRaw();
  } catch {
    hcSdkStatus = null;
  }
  let readGranted: boolean | null = null;
  try {
    const perm = await androidHCService.getPermissionStatus();
    readGranted = perm === "granted";
  } catch {
    readGranted = null;
  }
  const nativeHc = isHealthConnectOnDeviceStepsAvailable();
  const externalConfirmed = await getExternalVerifiedSourceConfirmed();
  const rp = store.getState().raceProgress;
  const capability = resolveVerifiedCapabilityKind({
    platform: Platform.OS === "ios" ? "ios" : "android",
    hcAvailable: true,
    readGranted: readGranted === true,
    nativeOnDeviceSteps: nativeHc,
    externalConfirmed,
  });
  const prize = resolvePrizeEligibility({
    verifiedStatus:
      rp.verifiedTodaySteps > 0
        ? "ready"
        : readGranted
          ? "ready_no_data"
          : "permission_required",
    verifiedCapability: capability,
  });

  let stepCounterAvailable: boolean | null = null;
  let sensorRaw: number | null = null;
  let sensorBaseline: number | null = null;
  try {
    const { stepTrackingNotificationService } = await import(
      "@/services/stepTrackingNotificationService"
    );
    const native = await stepTrackingNotificationService.getNativeStepState(
      rp.userId ?? undefined,
    );
    sensorRaw =
      typeof native?.sensorTotal === "number" ? native.sensorTotal : null;
    sensorBaseline =
      typeof native?.dailyBaseline === "number" ? native.dailyBaseline : null;
    stepCounterAvailable = sensorRaw != null;
  } catch {
    /* optional */
  }

  const raceSessionDelta =
    sensorRaw != null && sensorBaseline != null
      ? Math.max(0, sensorRaw - sensorBaseline)
      : rp.raceStatus === "active"
        ? Math.max(0, Math.floor(rp.raceSteps ?? 0))
        : null;

  return {
    androidApiLevel: apiLevel,
    sdkExtensionVersion: getHealthConnectSdkExtensionVersion(),
    hcSdkStatus,
    readStepsGranted: readGranted,
    nativeHcStepCaptureAvailable: nativeHc,
    verifiedStatus:
      rp.verifiedTodaySteps > 0
        ? "ready"
        : readGranted
          ? "ready_no_data"
          : "pending",
    verifiedCapability: capability,
    verifiedAggregate: rp.verifiedTodaySteps ?? null,
    localTodaySteps: rp.provisionalSensorTodaySteps ?? null,
    stepCounterAvailable,
    sensorRawValue: sensorRaw,
    sensorBaseline,
    raceSessionDelta,
    displayedTodaySteps: Math.max(0, Math.floor(rp.todaySteps ?? 0)),
    canUsePrizeFeatures: prize.canUsePrizeFeatures,
    prizeBlockReason: prize.prizeBlockReason,
  };
}

export async function logStepEngineDevDiagnostics(reason: string): Promise<void> {
  if (typeof __DEV__ === "undefined" || !__DEV__) return;
  try {
    const diag = await collectStepEngineDevDiagnostics();
    console.log(`[StepEngineDiag] reason=${reason}`, diag);
  } catch (e) {
    console.log("[StepEngineDiag] failed", e);
  }
}
