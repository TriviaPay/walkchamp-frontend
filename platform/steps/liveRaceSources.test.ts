/**
 * Live race stepSource helpers — unit tests.
 * Run: npx tsx services/steps/liveRaceSources.test.ts
 */

import assert from "node:assert/strict";
import {
  canonicalLiveRaceStepSource,
  isAcceptedLiveRaceSource,
  isAcceptedRaceProgressSource,
} from "./liveRaceSources";
import { isAcceptedVerifiedSource } from "./verifiedStepSources";

assert.equal(isAcceptedLiveRaceSource("android_step_counter"), true);
assert.equal(isAcceptedLiveRaceSource("device_sensor"), true);
assert.equal(isAcceptedLiveRaceSource("ios_pedometer"), true);
assert.equal(isAcceptedLiveRaceSource("ios_core_motion"), true);
assert.equal(isAcceptedLiveRaceSource("health_connect"), false);

assert.equal(isAcceptedRaceProgressSource("android_step_counter"), true);
assert.equal(isAcceptedRaceProgressSource("health_connect"), true);
assert.equal(isAcceptedRaceProgressSource("healthkit"), true);
assert.equal(isAcceptedRaceProgressSource("ios_pedometer"), true);
assert.equal(isAcceptedRaceProgressSource("simulation"), true);
assert.equal(isAcceptedRaceProgressSource("pedometer"), false);

assert.equal(isAcceptedVerifiedSource("android_step_counter"), false);
assert.equal(canonicalLiveRaceStepSource("android"), "android_step_counter");
assert.equal(canonicalLiveRaceStepSource("ios"), "ios_pedometer");

console.log("liveRaceSources.test.ts — passed");
