/**
 * Pure Health Connect SDK → setup status mappings (no React Native imports).
 * Also exports source types and verification levels used across the step system.
 */

export const HC_SDK = {
  SDK_UNAVAILABLE: 1,
  SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED: 2,
  SDK_AVAILABLE: 3,
} as const;

export type AndroidStepTrackingStatus =
  | "available"
  | "provider_update_required"
  | "provider_not_installed"
  | "unsupported"
  | "permission_granted"
  | "permission_denied"
  | "expo_go"
  | "error";

export type AndroidSetupUIState =
  // ── Health Connect states ──────────────────────────────────────────────────
  | "checking"       // running detection
  | "ready"          // HC available, permission not yet granted
  | "permission"     // HC available, permission was denied
  | "install_update" // HC needs install or update from Play Store
  | "granted"        // HC available + permission granted
  // ── Extended states ────────────────────────────────────────────────────────
  | "optional_apps"      // HC unsupported; show optional fitness apps list
  | "limited_sensor"     // No verified source; device TYPE_STEP_COUNTER only
  | "fully_unsupported"  // Nothing available at all
  // ── Misc ──────────────────────────────────────────────────────────────────
  | "standalone"     // Expo Go — needs standalone build
  | "unsupported"    // HC not supported on this device (legacy alias)
  | "error";         // Unrecoverable error

export type HCPermStatus = "granted" | "unknown" | "denied" | "unavailable";

/** Minimum Android API for Health Connect install flow (Android 9+). */
export const HC_MIN_API = 28;

export function isHealthConnectInstallable(
  sdkStatus: number,
  apiLevel: number,
): boolean {
  return (
    apiLevel >= HC_MIN_API &&
    sdkStatus === HC_SDK.SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED
  );
}

export function isHealthConnectSupported(
  sdkStatus: number,
  apiLevel: number,
): boolean {
  if (apiLevel < HC_MIN_API) return false;
  if (sdkStatus === HC_SDK.SDK_AVAILABLE) return true;
  if (sdkStatus === HC_SDK.SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED) return true;
  return false;
}

export function mapSdkStatusToTrackingStatus(
  sdkStatus: number,
  permission: HCPermStatus | "unavailable",
  apiLevel = HC_MIN_API,
): AndroidStepTrackingStatus {
  if (apiLevel < HC_MIN_API) {
    return "unsupported";
  }
  if (sdkStatus === HC_SDK.SDK_AVAILABLE) {
    if (permission === "granted") return "permission_granted";
    if (permission === "denied") return "permission_denied";
    return "available";
  }
  if (sdkStatus === HC_SDK.SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED) {
    return "provider_update_required";
  }
  if (sdkStatus === HC_SDK.SDK_UNAVAILABLE) {
    // Android 9-13: Health Connect app may be missing from device.
    // Android 14+: this generally indicates the provider surface is unavailable.
    return apiLevel >= HC_MIN_API ? "provider_not_installed" : "unsupported";
  }
  return "error";
}

export function trackingStatusToUiState(
  status: AndroidStepTrackingStatus,
): AndroidSetupUIState {
  switch (status) {
    case "expo_go":
      return "standalone";
    case "permission_granted":
      return "granted";
    case "available":
      return "ready";
    case "provider_update_required":
    case "provider_not_installed":
      return "install_update";
    case "permission_denied":
      return "permission";
    case "unsupported":
      return "unsupported";
    case "error":
      return "error";
    default:
      return "error";
  }
}

export type HCAvailability =
  | "available"
  | "not_installed"
  | "needs_update"
  | "not_supported";

export function toHcAvailability(
  status: AndroidStepTrackingStatus,
): HCAvailability {
  switch (status) {
    case "available":
    case "permission_granted":
    case "permission_denied":
      return "available";
    case "provider_update_required":
      return "needs_update";
    case "provider_not_installed":
      return "not_installed";
    case "unsupported":
    case "expo_go":
    case "error":
    default:
      return "not_supported";
  }
}
