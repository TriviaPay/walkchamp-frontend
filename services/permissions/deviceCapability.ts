/**
 * Device capability snapshot for the current installation only.
 * Not persisted as permanent permission truth — refresh after OS/app changes.
 */

import { Platform } from "react-native";
import Constants from "expo-constants";
import { getInstallationId } from "@/services/deviceIdentity";
import { stepProviderManager } from "@/services/steps/stepProviderManager";

export type StepProviderKind =
  | "health_connect"
  | "android_step_counter"
  | "ios_pedometer"
  | "healthkit"
  | "unsupported";

export type DeviceCapabilitySnapshot = {
  installationId: string;
  platform: "android" | "ios" | "web";
  deviceModel?: string;
  manufacturer?: string;
  osVersion: string;
  androidApiLevel?: number;
  appVersion: string;
  buildNumber: string;
  /** Android 13+ (API 33+) only */
  notificationRuntimePermissionSupported: boolean;
  stepProvider: StepProviderKind;
  healthConnectStatus?:
    | "available"
    | "not_installed"
    | "update_required"
    | "unavailable";
  activityRecognitionSupported: boolean;
  motionPermissionSupported: boolean;
  locationRequired: boolean;
};

function mapProviderId(id: string | null | undefined): StepProviderKind {
  switch (id) {
    case "android_health_connect":
      return "health_connect";
    case "android_legacy_sensor":
      return "android_step_counter";
    case "ios_healthkit":
      return "healthkit";
    default:
      return "unsupported";
  }
}

export async function getDeviceCapabilitySnapshot(): Promise<DeviceCapabilitySnapshot> {
  const installationId = await getInstallationId();
  const platform =
    Platform.OS === "ios" ? "ios" : Platform.OS === "android" ? "android" : "web";
  const androidApiLevel =
    Platform.OS === "android" && typeof Platform.Version === "number"
      ? Platform.Version
      : undefined;

  let stepProvider: StepProviderKind = "unsupported";
  let healthConnectStatus: DeviceCapabilitySnapshot["healthConnectStatus"];

  try {
    await stepProviderManager.initialize().catch(() => null);
    stepProvider = mapProviderId(stepProviderManager.getActiveProviderId());

    if (Platform.OS === "android") {
      try {
        const { androidHealthConnectService } = await import(
          "@/services/steps/androidHealthConnectService"
        );
        const init = await androidHealthConnectService.initialize();
        if (init.availability === "available") healthConnectStatus = "available";
        else if (init.availability === "not_installed") healthConnectStatus = "not_installed";
        else if (init.availability === "needs_update") healthConnectStatus = "update_required";
        else healthConnectStatus = "unavailable";

        if (stepProvider === "unsupported" && healthConnectStatus === "available") {
          stepProvider = "health_connect";
        } else if (
          stepProvider === "unsupported" &&
          healthConnectStatus !== "available"
        ) {
          // Likely sensor-fallback candidate until provider selects.
          stepProvider = "android_step_counter";
        }
      } catch {
        healthConnectStatus = "unavailable";
      }
    } else if (Platform.OS === "ios" && stepProvider === "unsupported") {
      stepProvider = "healthkit";
    }
  } catch {
    stepProvider = Platform.OS === "ios" ? "healthkit" : "unsupported";
  }

  const snapshot: DeviceCapabilitySnapshot = {
    installationId,
    platform,
    deviceModel: Constants.deviceName ?? undefined,
    osVersion: String(Platform.Version),
    androidApiLevel,
    appVersion: Constants.expoConfig?.version ?? Constants.nativeAppVersion ?? "unknown",
    buildNumber: Constants.nativeBuildVersion ?? "",
    notificationRuntimePermissionSupported:
      Platform.OS === "ios" ||
      (Platform.OS === "android" && (androidApiLevel ?? 0) >= 33),
    stepProvider,
    healthConnectStatus,
    activityRecognitionSupported:
      Platform.OS === "android" && (androidApiLevel ?? 0) >= 29,
    motionPermissionSupported: Platform.OS === "ios",
    locationRequired: false,
  };

  if (__DEV__) {
    console.log(
      `[Permission] installationId=redacted platform=${snapshot.platform} osVersion=${snapshot.osVersion} androidApiLevel=${snapshot.androidApiLevel ?? "n/a"} provider=${snapshot.stepProvider} notificationRuntimeSupported=${snapshot.notificationRuntimePermissionSupported}`,
    );
  }

  return snapshot;
}
