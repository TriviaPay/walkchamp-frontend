/**
 * Run: npx tsx platform/steps/verifiedSensorAnchor.test.ts
 */
import assert from "node:assert/strict";
import {
  noteVerifiedHealthConnectRead,
  resetVerifiedSensorAnchor,
  resolveAnchoredDisplaySteps,
  resolveDisplayVerification,
} from "./verifiedSensorAnchor";
import {
  resolveVerifiedStatusFromSdk,
  resolveStepProviderState,
  resolvePrizeEligibility,
} from "./stepProviderStateLogic";

resetVerifiedSensorAnchor();
noteVerifiedHealthConnectRead({
  verifiedSteps: 52,
  sensorTotal: 20000,
  localDate: "2026-08-21",
});
assert.equal(
  resolveAnchoredDisplaySteps({
    verifiedSteps: 52,
    sensorTotal: 20052,
    sessionTodaySteps: 52,
    localDate: "2026-08-21",
  }),
  52,
  "HC 52 + same sensor dump 52 must not display 104",
);
assert.equal(
  resolveAnchoredDisplaySteps({
    verifiedSteps: 52,
    sensorTotal: 20000,
    sessionTodaySteps: 52,
    localDate: "2026-08-21",
  }),
  52,
  "HC and native session are the same day — show 52, do not add",
);

resetVerifiedSensorAnchor();
noteVerifiedHealthConnectRead({
  verifiedSteps: 10,
  sensorTotal: 22380,
  localDate: "2026-08-21",
});
assert.equal(
  resolveAnchoredDisplaySteps({
    verifiedSteps: 10,
    sensorTotal: 22380,
    sessionTodaySteps: 500,
    localDate: "2026-08-21",
  }),
  10,
  "when HC has a total, Walk shows that total — not a native session",
);

resetVerifiedSensorAnchor();
noteVerifiedHealthConnectRead({
  verifiedSteps: 0,
  sensorTotal: 22380,
  localDate: "2026-08-21",
});
assert.equal(
  resolveAnchoredDisplaySteps({
    verifiedSteps: 0,
    sensorTotal: 22380,
    sessionTodaySteps: 20,
    localDate: "2026-08-21",
  }),
  0,
  "after HC 0, leftover 20 with no sensor movement stays off Walk",
);
assert.equal(
  resolveAnchoredDisplaySteps({
    verifiedSteps: 0,
    sensorTotal: 22400,
    sessionTodaySteps: 20,
    localDate: "2026-08-21",
  }),
  20,
  "after HC 0, hardware movement is live display",
);

resetVerifiedSensorAnchor();
assert.equal(
  resolveAnchoredDisplaySteps({
    verifiedSteps: 0,
    sensorTotal: 22380,
    sessionTodaySteps: 20,
    localDate: "2026-08-17",
  }),
  0,
  "no anchor yet: leftover 20 is not today's walk",
);
assert.equal(
  resolveAnchoredDisplaySteps({
    verifiedSteps: 0,
    sensorTotal: 22380,
    sessionTodaySteps: 40,
    localDate: "2026-08-17",
  }),
  0,
  "no anchor yet: small FGS crumb stays off Walk until HC loads",
);
assert.equal(
  resolveAnchoredDisplaySteps({
    verifiedSteps: 0,
    sensorTotal: 22380,
    sessionTodaySteps: 2345,
    localDate: "2026-08-17",
  }),
  2345,
  "no anchor yet: a real in-progress FGS session still shows while HC lags",
);

noteVerifiedHealthConnectRead({
  verifiedSteps: 5000,
  sensorTotal: 22380,
  localDate: "2026-08-17",
});
assert.equal(
  resolveAnchoredDisplaySteps({
    verifiedSteps: 5000,
    sensorTotal: 22680,
    sessionTodaySteps: 4000,
    localDate: "2026-08-17",
  }),
  5000,
  "when HC has today's total, display that number — do not add sensor delta",
);

noteVerifiedHealthConnectRead({
  verifiedSteps: 5820,
  sensorTotal: 22680,
  localDate: "2026-08-17",
});
assert.equal(
  resolveAnchoredDisplaySteps({
    verifiedSteps: 5820,
    sensorTotal: 22700,
    sessionTodaySteps: 4200,
    localDate: "2026-08-17",
  }),
  5820,
  "Walk daily stays on the latest Health Connect total",
);

assert.equal(
  resolveDisplayVerification({
    verifiedSteps: 5820,
    displaySteps: 5820,
    verifiedStatus: "ready",
  }),
  "verified",
);

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
    aggregateSteps: 12,
  }),
  "ready",
);
assert.equal(
  resolveVerifiedStatusFromSdk({
    sdkAvailability: "not_supported",
    readGranted: false,
    aggregateSteps: 0,
  }),
  "unavailable",
);

const state = resolveStepProviderState({
  platform: "android",
  verifiedProvider: "health_connect",
  verifiedStatus: "ready_no_data",
  verifiedCapability: "native_hc",
  verifiedSteps: 0,
  onDeviceHcStepsAvailable: true,
  provisionalStatus: "ready",
  provisionalTodayEstimate: 40,
  displayedSteps: 40,
  sdkAvailability: "available",
});
assert.equal(state.canUsePrizeFeatures, true, "native HC 0 steps remains prize-capable");
assert.equal(state.canJoinPrizeChallenge, true);
assert.equal(state.nextAction, "none");
assert.equal(state.displayVerification, "syncing");

const localOnly = resolveStepProviderState({
  platform: "android",
  verifiedProvider: "health_connect",
  verifiedStatus: "ready_no_data",
  verifiedCapability: "hc_available",
  verifiedSteps: 0,
  onDeviceHcStepsAvailable: false,
  localProvider: "step_counter",
  localTodaySteps: 80,
  provisionalStatus: "ready",
  provisionalTodayEstimate: 80,
  displayedSteps: 80,
  sdkAvailability: "available",
});
assert.equal(localOnly.canUsePrizeFeatures, true);
assert.equal(localOnly.prizeBlockReason, null);
assert.equal(localOnly.nextAction, "none");
assert.equal(localOnly.onDeviceHcStepsAvailable, false);

const externalZero = resolveStepProviderState({
  platform: "android",
  verifiedProvider: "health_connect",
  verifiedStatus: "ready_no_data",
  verifiedCapability: "external_hc_confirmed",
  verifiedSteps: 0,
  onDeviceHcStepsAvailable: false,
  provisionalStatus: "ready",
  provisionalTodayEstimate: 0,
  displayedSteps: 0,
  sdkAvailability: "available",
});
assert.equal(externalZero.canUsePrizeFeatures, true, "external HC confirmed + 0 remains prize-capable");

const healthkitZero = resolvePrizeEligibility({
  verifiedStatus: "ready_no_data",
  verifiedCapability: "healthkit",
});
assert.equal(healthkitZero.canUsePrizeFeatures, true);

console.log("verifiedSensorAnchor + stepProviderStateLogic tests passed");
