/**
 * Android 14+ production architecture matrix (unit-level).
 * Run: npx tsx platform/steps/android14Architecture.test.ts
 */
import assert from "node:assert/strict";
import {
  HC_MIN_API,
  isHealthConnectInstallable,
  mapSdkStatusToTrackingStatus,
} from "./androidStepTrackingMappings";
import {
  resolveVerifiedStatusFromSdk,
  resolvePrizeEligibility,
  resolveStepProviderState,
  resolveVerifiedCapabilityKind,
} from "./stepProviderStateLogic";
import {
  resolveWalkNotificationSteps,
  shouldAcceptVerifiedZero,
} from "./walkDisplaySteps";

assert.equal(HC_MIN_API, 34);
assert.equal(
  isHealthConnectInstallable(2, 34),
  false,
  "Android 14+ must not use HC APK install",
);
assert.equal(mapSdkStatusToTrackingStatus(3, "granted", 34), "permission_granted");
assert.equal(
  mapSdkStatusToTrackingStatus(2, "unavailable", 34),
  "provider_update_required",
);
assert.equal(mapSdkStatusToTrackingStatus(1, "unavailable", 34), "unsupported");

assert.equal(
  resolveVerifiedStatusFromSdk({
    sdkAvailability: "available",
    readGranted: true,
    aggregateSteps: 0,
  }),
  "ready_no_data",
);

assert.equal(
  resolveVerifiedStatusFromSdk({
    sdkAvailability: "available",
    readGranted: true,
    aggregateSteps: 0,
    readError: true,
  }),
  "error",
  "HC read exception is ERROR, not verified 0",
);

assert.equal(
  resolveVerifiedStatusFromSdk({
    sdkAvailability: "needs_update",
    readGranted: false,
    aggregateSteps: 0,
  }),
  "update_required",
);

const nativeZero = resolveStepProviderState({
  platform: "android",
  verifiedProvider: "health_connect",
  verifiedStatus: "ready_no_data",
  verifiedCapability: "native_hc",
  verifiedSteps: 0,
  onDeviceHcStepsAvailable: true,
  localProvider: "step_counter",
  provisionalStatus: "ready",
  provisionalTodayEstimate: 6420,
  displayedSteps: 6420,
  sdkAvailability: "available",
});
assert.equal(nativeZero.canUsePrizeFeatures, true);
assert.equal(nativeZero.displayedSteps, 6420);
assert.equal(nativeZero.verifiedSteps, 0);
assert.equal(nativeZero.nextAction, "none");

const extBelow20 = resolveStepProviderState({
  platform: "android",
  verifiedProvider: "health_connect",
  verifiedStatus: "ready_no_data",
  verifiedCapability: "hc_available",
  verifiedSteps: 0,
  onDeviceHcStepsAvailable: false,
  localProvider: "step_counter",
  provisionalStatus: "ready",
  provisionalTodayEstimate: 80,
  displayedSteps: 80,
  sdkAvailability: "available",
});
assert.equal(extBelow20.canUsePrizeFeatures, true);
assert.equal(extBelow20.nextAction, "none");
assert.equal(extBelow20.onDeviceHcStepsAvailable, false);
assert.equal(extBelow20.verifiedStatus, "ready_no_data");
assert.equal(extBelow20.displayedSteps, 80);

const extBelow20Wearable = resolveStepProviderState({
  platform: "android",
  verifiedProvider: "health_connect",
  verifiedStatus: "ready",
  verifiedCapability: "external_hc_confirmed",
  verifiedSteps: 8500,
  onDeviceHcStepsAvailable: false,
  localProvider: "step_counter",
  provisionalStatus: "ready",
  provisionalTodayEstimate: 120,
  displayedSteps: 8500,
  sdkAvailability: "available",
});
assert.equal(extBelow20Wearable.canUsePrizeFeatures, true);
assert.equal(extBelow20Wearable.verifiedSteps, 8500);
assert.equal(extBelow20Wearable.onDeviceHcStepsAvailable, false);
assert.equal(extBelow20Wearable.nextAction, "none");

assert.equal(
  resolveStepProviderState({
    platform: "android",
    verifiedProvider: "health_connect",
    verifiedStatus: "update_required",
    verifiedCapability: "unavailable",
    verifiedSteps: 0,
    onDeviceHcStepsAvailable: false,
    provisionalStatus: "ready",
    provisionalTodayEstimate: 80,
    displayedSteps: 80,
    sdkAvailability: "needs_update",
  }).nextAction,
  "update_health_connect",
);

assert.equal(
  resolvePrizeEligibility({
    verifiedStatus: "ready_no_data",
    verifiedCapability: "healthkit",
  }).canUsePrizeFeatures,
  true,
);

assert.equal(
  resolveWalkNotificationSteps({
    verifiedTodaySteps: 0,
    provisionalSensorTodaySteps: 6420,
    todaySteps: 6420,
    verifiedAuthoritative: true,
  }),
  0,
  "HC 0 is the daily number — no sensor fallback",
);

assert.equal(
  shouldAcceptVerifiedZero({
    incomingSteps: 0,
    previousSteps: 5000,
    freshLocalDay: false,
  }),
  false,
  "temporary HC 0 must not destroy last good verified",
);

assert.equal(
  shouldAcceptVerifiedZero({
    incomingSteps: 0,
    previousSteps: 0,
    freshLocalDay: true,
  }),
  true,
  "midnight 0 is valid",
);

assert.equal(
  resolveVerifiedCapabilityKind({
    platform: "android",
    hcAvailable: true,
    readGranted: true,
    nativeOnDeviceSteps: false,
    externalConfirmed: false,
  }),
  "hc_available",
  "Ext <20 does not make Health Connect unavailable",
);
assert.equal(
  resolveVerifiedCapabilityKind({
    platform: "android",
    hcAvailable: true,
    readGranted: true,
    nativeOnDeviceSteps: true,
    externalConfirmed: false,
  }),
  "native_hc",
);
assert.equal(
  resolveVerifiedCapabilityKind({
    platform: "android",
    hcAvailable: true,
    readGranted: true,
    nativeOnDeviceSteps: false,
    externalConfirmed: true,
  }),
  "external_hc_confirmed",
);
assert.equal(
  resolveVerifiedCapabilityKind({
    platform: "android",
    hcAvailable: false,
    readGranted: false,
    nativeOnDeviceSteps: false,
    externalConfirmed: false,
  }),
  "unavailable",
);

{
  const fs = require("node:fs") as typeof import("node:fs");
  const path = require("node:path") as typeof import("node:path");
  const root = path.join(__dirname, "..", "..");
  const gradleProps = fs.readFileSync(path.join(root, "android", "gradle.properties"), "utf8");
  const appJson = JSON.parse(fs.readFileSync(path.join(root, "app.json"), "utf8")) as {
    expo: { plugins: unknown[] };
  };
  const buildProps = (appJson.expo.plugins as unknown[]).find(
    (entry) => Array.isArray(entry) && entry[0] === "expo-build-properties",
  ) as [string, { android?: Record<string, number> }] | undefined;
  const androidProps = buildProps?.[1]?.android ?? {};
  assert.equal(androidProps.minSdkVersion, 34);
  assert.equal(androidProps.compileSdkVersion, 36);
  assert.equal(androidProps.targetSdkVersion, 36);
  assert.match(gradleProps, /android\.minSdkVersion=34/);
  assert.match(gradleProps, /android\.compileSdkVersion=36/);
  assert.match(gradleProps, /android\.targetSdkVersion=36/);
}

console.log("android14Architecture: all tests passed");
