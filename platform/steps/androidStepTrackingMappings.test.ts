/**
 * Pure mapping tests — run: npx tsx services/steps/androidStepTrackingMappings.test.ts
 */
import {
  HC_SDK,
  HC_MIN_API,
  isHealthConnectInstallable,
  mapSdkStatusToTrackingStatus,
  trackingStatusToUiState,
} from "./androidStepTrackingMappings";

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(msg);
}

assert(
  mapSdkStatusToTrackingStatus(HC_SDK.SDK_AVAILABLE, "unknown") === "available",
  "SDK_AVAILABLE + unknown perm → available",
);
assert(
  mapSdkStatusToTrackingStatus(HC_SDK.SDK_AVAILABLE, "granted") ===
    "permission_granted",
  "SDK_AVAILABLE + granted → permission_granted",
);
assert(
  mapSdkStatusToTrackingStatus(HC_SDK.SDK_AVAILABLE, "denied") ===
    "permission_denied",
  "SDK_AVAILABLE + denied → permission_denied",
);
assert(
  mapSdkStatusToTrackingStatus(
    HC_SDK.SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED,
    "unavailable",
  ) === "provider_update_required",
  "SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED → provider_update_required",
);
assert(
  mapSdkStatusToTrackingStatus(HC_SDK.SDK_UNAVAILABLE, "unavailable") ===
    "provider_not_installed",
  "SDK_UNAVAILABLE on API >= 28 → provider_not_installed",
);
assert(
  mapSdkStatusToTrackingStatus(HC_SDK.SDK_UNAVAILABLE, "unavailable", 27) ===
    "unsupported",
  "API < 28 → unsupported even if SDK would allow install",
);
assert(
  mapSdkStatusToTrackingStatus(
    HC_SDK.SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED,
    "unavailable",
    31,
  ) === "provider_update_required",
  "API 31 + SDK 2 → install flow",
);
assert(
  isHealthConnectInstallable(
    HC_SDK.SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED,
    31,
  ),
  "installable on API 31 + SDK 2",
);
assert(
  !isHealthConnectInstallable(HC_SDK.SDK_UNAVAILABLE, 31),
  "SDK 1 not installable",
);
assert(
  trackingStatusToUiState("unsupported") === "unsupported",
  "unsupported → unsupported UI",
);
assert(HC_SDK.SDK_AVAILABLE === 3, "SDK_AVAILABLE must be 3 per library");
assert(HC_MIN_API === 28, "HC_MIN_API must be 28");

console.log("androidStepTrackingMappings: all tests passed");
