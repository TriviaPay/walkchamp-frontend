/**
 * Hybrid verified vs provisional separation tests.
 * Run: npx tsx services/steps/hybridStepState.test.ts
 */

import assert from "node:assert/strict";
import {
  STEP_SOURCES,
  IOS_STEP_SOURCES,
  computeDisplayTodaySteps,
  resolveDailyDisplaySource,
  isProvisionalDailyStepSource,
  isVerifiedDailyStepSource,
  selectVerifiedTodayStepsForSync,
  decideVerifiedDailySync,
  reanchorAndroidRaceBaseline,
  migrateStepSourceAlias,
} from "./hybridStepState";
import { capWalkStepsForSyncCore } from "@/utils/stepAccuracyCore";

assert.equal(STEP_SOURCES.verifiedDailyAndroid, "health_connect");
assert.equal(STEP_SOURCES.provisionalDailyAndroid, "android_step_counter");
assert.equal(STEP_SOURCES.liveRaceAndroid, "android_step_counter");
assert.equal(IOS_STEP_SOURCES.verifiedDaily, "healthkit");
assert.equal(IOS_STEP_SOURCES.liveRace, "ios_pedometer");
assert.equal(migrateStepSourceAlias("android_health_connect"), "health_connect");
assert.equal(migrateStepSourceAlias("device_sensor"), "android_step_counter");

assert.equal(computeDisplayTodaySteps(100, 150), 150, "display prefers higher provisional");
assert.equal(computeDisplayTodaySteps(200, 150), 200, "display prefers higher verified");
assert.equal(computeDisplayTodaySteps(0, null), 0, "null provisional → verified");

assert.equal(
  resolveDailyDisplaySource({
    verifiedTodaySteps: 100,
    provisionalSensorTodaySteps: 150,
    platform: "android",
  }),
  "sensor_estimate",
);
assert.equal(
  resolveDailyDisplaySource({
    verifiedTodaySteps: 100,
    provisionalSensorTodaySteps: 150,
    platform: "ios",
  }),
  "pedometer_estimate",
);
assert.equal(
  resolveDailyDisplaySource({
    verifiedTodaySteps: 200,
    provisionalSensorTodaySteps: 150,
    platform: "android",
  }),
  "health_connect",
);
assert.equal(
  resolveDailyDisplaySource({
    verifiedTodaySteps: 200,
    provisionalSensorTodaySteps: 150,
    platform: "ios",
  }),
  "healthkit",
);

assert.equal(isProvisionalDailyStepSource("android_step_counter"), true);
assert.equal(isProvisionalDailyStepSource("ios_pedometer"), true);
assert.equal(isProvisionalDailyStepSource("health_connect"), false);
assert.equal(isVerifiedDailyStepSource("health_connect"), true);
assert.equal(isVerifiedDailyStepSource("android_step_counter"), false);

assert.equal(
  selectVerifiedTodayStepsForSync({
    verifiedTodaySteps: 197,
    displayTodaySteps: 250,
    lastHcProviderSteps: 0,
  }),
  197,
  "empty HC → sync verified lane only",
);

assert.equal(
  selectVerifiedTodayStepsForSync({
    verifiedTodaySteps: 197,
    displayTodaySteps: 250,
    lastHcProviderSteps: 210,
  }),
  210,
  "positive HC provider wins for sync selection ceiling path",
);

assert.equal(
  capWalkStepsForSyncCore(250, 0, true, 197),
  197,
  "capWalk: provisional UI must not POST when HC empty",
);

assert.equal(
  capWalkStepsForSyncCore(250, 240, true, 197),
  240,
  "capWalk: sync min(ui, provider) when HC present",
);

// Scenario 1: HC=0, sensor=500 → UI=500, no verified submit of 500
{
  const verified = 0;
  const provisional = 500;
  const display = computeDisplayTodaySteps(verified, provisional);
  assert.equal(display, 500);
  const selected = selectVerifiedTodayStepsForSync({
    verifiedTodaySteps: verified,
    displayTodaySteps: display,
    lastHcProviderSteps: 0,
  });
  assert.equal(selected, 0);
  const capped = capWalkStepsForSyncCore(selected, 0, true, 0);
  assert.equal(capped, 0);
  const decision = decideVerifiedDailySync({
    authenticated: true,
    localDateValid: true,
    trackingComplete: true,
    verifiedTodaySteps: verified,
    displayTodaySteps: display,
    lastHcProviderSteps: 0,
    providerQueryStatus: "empty",
    backendTodaySteps: 0,
    lastSyncedSteps: 0,
    syncTotalAfterCap: capped,
    platform: "android",
  });
  assert.equal(decision.action, "preserve_backend");
}

// Scenario 2: HC=400, sensor=500 → UI=500, verified sync=400
{
  const verified = 400;
  const provisional = 500;
  const display = computeDisplayTodaySteps(verified, provisional);
  assert.equal(display, 500);
  const selected = selectVerifiedTodayStepsForSync({
    verifiedTodaySteps: verified,
    displayTodaySteps: display,
    lastHcProviderSteps: 400,
  });
  assert.equal(selected, 400);
  const capped = capWalkStepsForSyncCore(selected, 400, true, 0);
  assert.equal(capped, 400);
  const decision = decideVerifiedDailySync({
    authenticated: true,
    localDateValid: true,
    trackingComplete: true,
    verifiedTodaySteps: verified,
    displayTodaySteps: display,
    lastHcProviderSteps: 400,
    providerQueryStatus: "ok",
    backendTodaySteps: 0,
    lastSyncedSteps: 0,
    syncTotalAfterCap: capped,
    platform: "android",
  });
  assert.equal(decision.action, "submit_verified");
  if (decision.action === "submit_verified") {
    assert.equal(decision.steps, 400);
    assert.equal(decision.source, "health_connect");
  }
}

// Scenario 3: HC later=520 → UI=520 verified, sync=520
{
  const verified = 520;
  const provisional = 500;
  const display = computeDisplayTodaySteps(verified, provisional);
  assert.equal(display, 520);
  const capped = capWalkStepsForSyncCore(520, 520, true, 400);
  assert.equal(capped, 520);
  const decision = decideVerifiedDailySync({
    authenticated: true,
    localDateValid: true,
    trackingComplete: true,
    verifiedTodaySteps: verified,
    displayTodaySteps: display,
    lastHcProviderSteps: 520,
    providerQueryStatus: "ok",
    backendTodaySteps: 400,
    lastSyncedSteps: 400,
    syncTotalAfterCap: capped,
    platform: "android",
  });
  assert.equal(decision.action, "submit_verified");
  if (decision.action === "submit_verified") {
    assert.equal(decision.steps, 520);
  }
}

// Scenario 4: HC error, sensor=800 → estimate UI, no verified sensor submission
{
  const decision = decideVerifiedDailySync({
    authenticated: true,
    localDateValid: true,
    trackingComplete: true,
    verifiedTodaySteps: 0,
    displayTodaySteps: 800,
    lastHcProviderSteps: null,
    providerQueryStatus: "temporary_error",
    backendTodaySteps: 200,
    lastSyncedSteps: 200,
    syncTotalAfterCap: 200,
    platform: "android",
  });
  assert.equal(decision.action, "preserve_backend");
}

// Android reboot re-anchor preserves accepted race progress
{
  const normal = reanchorAndroidRaceBaseline({
    currentRawSensorTotal: 12_000,
    lastRawSensorTotal: 11_500,
    sensorBaseline: 10_000,
    acceptedRaceSteps: 1_500,
    bootSessionChanged: false,
  });
  assert.equal(normal.reanchored, false);
  assert.equal(normal.liveRaceSteps, 2_000);

  const reboot = reanchorAndroidRaceBaseline({
    currentRawSensorTotal: 50,
    lastRawSensorTotal: 12_000,
    sensorBaseline: 10_000,
    acceptedRaceSteps: 2_000,
    bootSessionChanged: true,
  });
  assert.equal(reboot.reanchored, true);
  assert.equal(reboot.liveRaceSteps, 2_000, "accepted race steps preserved");
  assert.equal(reboot.sensorBaseline, 0, "newBaseline = max(0, 50 - 2000)");

  const after = reanchorAndroidRaceBaseline({
    currentRawSensorTotal: 150,
    lastRawSensorTotal: 50,
    sensorBaseline: reboot.sensorBaseline,
    acceptedRaceSteps: reboot.liveRaceSteps,
    bootSessionChanged: false,
  });
  assert.equal(after.liveRaceSteps, 2_000, "cannot drop below accepted after re-anchor");

  const rebootSmall = reanchorAndroidRaceBaseline({
    currentRawSensorTotal: 80,
    lastRawSensorTotal: 5_000,
    sensorBaseline: 4_000,
    acceptedRaceSteps: 100,
    bootSessionChanged: true,
  });
  assert.equal(rebootSmall.sensorBaseline, 0);
  const grow = reanchorAndroidRaceBaseline({
    currentRawSensorTotal: 250,
    lastRawSensorTotal: 80,
    sensorBaseline: rebootSmall.sensorBaseline,
    acceptedRaceSteps: 100,
    bootSessionChanged: false,
  });
  assert.equal(grow.liveRaceSteps, 250, "grows from re-anchored baseline");
}

console.log("hybridStepState.test.ts: all passed");
