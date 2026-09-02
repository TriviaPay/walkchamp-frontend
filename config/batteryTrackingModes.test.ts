/**
 * Run: npx tsx config/batteryTrackingModes.test.ts
 */
import assert from "node:assert/strict";
import {
  modeAllowsLiveRaceWorkload,
  raceBackendSyncIntervalForMode,
  reconcileIntervalForMode,
  resolveBatteryTrackingMode,
} from "./batteryTrackingModes";

assert.equal(
  resolveBatteryTrackingMode({
    appVisible: false,
    walkFgsActive: false,
    raceLive: false,
    finalizing: false,
  }),
  "idle",
);

assert.equal(
  resolveBatteryTrackingMode({
    appVisible: true,
    walkFgsActive: false,
    raceLive: false,
    finalizing: false,
  }),
  "app_active",
);

assert.equal(
  resolveBatteryTrackingMode({
    appVisible: true,
    walkFgsActive: true,
    raceLive: false,
    finalizing: false,
  }),
  "active_walk_foreground",
);

assert.equal(
  resolveBatteryTrackingMode({
    appVisible: false,
    walkFgsActive: true,
    raceLive: true,
    finalizing: false,
  }),
  "live_race_background",
);

assert.equal(
  resolveBatteryTrackingMode({
    appVisible: false,
    walkFgsActive: true,
    raceLive: false,
    finalizing: false,
    autoTrackingEnabled: true,
  }),
  "auto_tracking_idle",
);

assert.equal(
  resolveBatteryTrackingMode({
    appVisible: true,
    walkFgsActive: false,
    raceLive: false,
    finalizing: true,
  }),
  "finalizing",
);

assert.ok(reconcileIntervalForMode("idle") >= 60_000);
assert.ok(reconcileIntervalForMode("auto_tracking_idle") >= 60_000);
assert.ok(reconcileIntervalForMode("live_race_background") >= 30_000);
assert.ok(raceBackendSyncIntervalForMode("live_race_background") >= 15_000);
assert.equal(modeAllowsLiveRaceWorkload("auto_tracking_idle"), false);
assert.equal(modeAllowsLiveRaceWorkload("live_race_foreground"), true);

console.log("batteryTrackingModes.test.ts: ok");
