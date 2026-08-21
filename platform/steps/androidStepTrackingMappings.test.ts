/**
 * Pure mapping tests — run: npx tsx platform/steps/androidStepTrackingMappings.test.ts
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
    "unsupported",
  "SDK_UNAVAILABLE → HC unavailable, not missing-app install",
);
assert(
  mapSdkStatusToTrackingStatus(HC_SDK.SDK_UNAVAILABLE, "unavailable", 33) ===
    "unsupported",
  "API < 34 is outside WalkChamp Android runtime",
);
assert(
  mapSdkStatusToTrackingStatus(
    HC_SDK.SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED,
    "unavailable",
    34,
  ) === "provider_update_required",
  "API 34 + SDK 2 → system update, not HC APK install",
);
assert(
  !isHealthConnectInstallable(
    HC_SDK.SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED,
    34,
  ),
  "Android 14+ must not use the old HC APK install flow",
);
assert(
  !isHealthConnectInstallable(HC_SDK.SDK_UNAVAILABLE, 34),
  "SDK_UNAVAILABLE is not installable",
);
assert(
  trackingStatusToUiState("provider_update_required") === "system_update",
  "update required → system_update UI",
);
assert(
  trackingStatusToUiState("unsupported") === "unsupported",
  "unsupported → unsupported UI",
);
assert(HC_SDK.SDK_AVAILABLE === 3, "SDK_AVAILABLE must be 3 per library");
assert(HC_MIN_API === 34, "HC_MIN_API must match minSdk 34");

console.log("androidStepTrackingMappings: all tests passed");
