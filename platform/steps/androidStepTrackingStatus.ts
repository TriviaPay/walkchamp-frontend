/**
 * Android Health Connect compatibility detection for Walk Champ setup UI.
 */

import { Platform } from "react-native";
import {
  androidHCService,
  isExpoGo,
  type HCPermStatus,
} from "./androidHealthConnectService";
import { stepProviderManager } from "./stepProviderManager";
import {
  HC_SDK,
  HC_MIN_API,
  isHealthConnectInstallable,
  isHealthConnectSupported,
  mapSdkStatusToTrackingStatus,
  toHcAvailability,
  trackingStatusToUiState,
  type AndroidSetupUIState,
  type AndroidStepTrackingStatus,
  type HCAvailability,
} from "./androidStepTrackingMappings";

export {
  HC_SDK,
  HC_MIN_API,
  isHealthConnectInstallable,
  isHealthConnectSupported,
  mapSdkStatusToTrackingStatus,
  trackingStatusToUiState,
  toHcAvailability,
  type AndroidSetupUIState,
  type AndroidStepTrackingStatus,
};

export interface AndroidStepTrackingStatusResult {
  status: AndroidStepTrackingStatus;
  uiState: AndroidSetupUIState;
  sdkStatus: number | null;
  permission: HCPermStatus | "unavailable";
  initialized: boolean;
  message?: string;
}

let _cachedStatus: AndroidStepTrackingStatusResult | null = null;
let _cachedStatusAt = 0;
const STATUS_CACHE_MS = 5000;

export function invalidateAndroidStepTrackingStatusCache(): void {
  _cachedStatus = null;
  _cachedStatusAt = 0;
}

/**
 * Detect Android Health Connect compatibility and permission state.
 */
export async function getAndroidStepTrackingStatus(
  forceRefresh = false,
): Promise<AndroidStepTrackingStatusResult> {
  if (Platform.OS !== "android") {
    return {
      status: "unsupported",
      uiState: "unsupported",
      sdkStatus: null,
      permission: "unavailable",
      initialized: false,
      message: "Not Android",
    };
  }

  if (isExpoGo()) {
    return {
      status: "expo_go",
      uiState: "standalone",
      sdkStatus: null,
      permission: "unavailable",
      initialized: false,
    };
  }

  if (
    !forceRefresh &&
    _cachedStatus &&
    Date.now() - _cachedStatusAt < STATUS_CACHE_MS
  ) {
    return _cachedStatus;
  }

  try {
    const apiLevel =
      typeof Platform.Version === "number" ? Platform.Version : 0;
    const sdkStatus = await androidHCService.getSdkStatusRaw();
    const init = await androidHCService.initialize();

    const status = mapSdkStatusToTrackingStatus(
      sdkStatus,
      init.permission,
      apiLevel,
    );

    if (__DEV__) {
      console.log(
        `[AndroidHC] status=${status} sdk=${sdkStatus} api=${apiLevel} perm=${init.permission}`,
      );
    }

    const result = {
      status,
      uiState: trackingStatusToUiState(status),
      sdkStatus: sdkStatus >= 0 ? sdkStatus : null,
      permission: init.permission,
      initialized: init.initialized,
    };
    _cachedStatus = result;
    _cachedStatusAt = Date.now();
    return result;
  } catch (e) {
    const result: AndroidStepTrackingStatusResult = {
      status: "error",
      uiState: "error",
      sdkStatus: null,
      permission: "unavailable",
      initialized: false,
      message: e instanceof Error ? e.message : "Unknown error",
    };
    return result;
  }
}

export async function refreshAndroidStepTrackingStatus(): Promise<AndroidStepTrackingStatusResult> {
  invalidateAndroidStepTrackingStatusCache();
  await androidHCService.refresh();
  return getAndroidStepTrackingStatus(true);
}

/**
 * initialize → request READ_STEPS → read today → return updated status.
 */
export async function enableAndroidStepTracking(): Promise<AndroidStepTrackingStatusResult> {
  if (isExpoGo()) {
    return {
      status: "expo_go",
      uiState: "standalone",
      sdkStatus: null,
      permission: "unavailable",
      initialized: false,
    };
  }

  const withTimeout = async (): Promise<AndroidStepTrackingStatusResult> => {
    const before = await getAndroidStepTrackingStatus();
    if (
      before.status === "provider_update_required" ||
      before.status === "provider_not_installed"
    ) {
      const legacy = await stepProviderManager.requestStepPermission().catch(() => ({
        status: "unavailable" as const,
        providerId: null,
      }));
      invalidateAndroidStepTrackingStatusCache();
      if (legacy.status === "granted") {
        return getAndroidStepTrackingStatus(true);
      }
      await androidHCService.openInstallPage().catch(() => {});
      return before;
    }
    if (
      before.status === "unsupported" ||
      before.status === "expo_go" ||
      before.status === "error"
    ) {
      const fallback = await stepProviderManager.requestStepPermission().catch(() => ({
        status: "unavailable" as const,
        providerId: null,
      }));
      invalidateAndroidStepTrackingStatusCache();
      if (fallback.status === "granted") {
        return getAndroidStepTrackingStatus(true);
      }
      return before;
    }

    const result = await stepProviderManager.requestStepPermission().catch(() => ({
      status: "unavailable" as const,
      providerId: null,
    }));
    invalidateAndroidStepTrackingStatusCache();
    if (result.status === "granted") {
      await stepProviderManager.getTodaySteps().catch(() => null);
      return getAndroidStepTrackingStatus(true);
    }

    return getAndroidStepTrackingStatus(true);
  };

  try {
    return await Promise.race([
      withTimeout(),
      new Promise<AndroidStepTrackingStatusResult>((resolve) => {
        setTimeout(() => {
          console.log("[AndroidHC] enableAndroidStepTracking timed out after 45s");
          void getAndroidStepTrackingStatus(true).then(resolve);
        }, 45_000);
      }),
    ]);
  } catch (e) {
    if (__DEV__) console.log("[AndroidHC] enableAndroidStepTracking error", e);
    return getAndroidStepTrackingStatus(true);
  }
}

// Re-export for WalkContext
export type { HCAvailability };
