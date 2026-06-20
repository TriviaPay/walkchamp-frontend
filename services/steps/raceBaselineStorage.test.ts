/**
 * Unit tests for race baseline isolation.
 * Run: npx tsx services/steps/raceBaselineStorage.test.ts
 */

import assert from "node:assert/strict";
import {
  clearRaceBaseline,
  getRaceBaseline,
  setRaceBaseline,
} from "./raceBaselineStorage";

async function run() {
  await setRaceBaseline("race-a", "user-1", "android_legacy_sensor", 1000);
  await setRaceBaseline("race-b", "user-1", "android_legacy_sensor", 2500);

  assert.equal(
    await getRaceBaseline("race-a", "user-1", "android_legacy_sensor"),
    1000,
  );
  assert.equal(
    await getRaceBaseline("race-b", "user-1", "android_legacy_sensor"),
    2500,
  );

  await clearRaceBaseline("race-a", "user-1", "android_legacy_sensor");
  assert.equal(
    await getRaceBaseline("race-a", "user-1", "android_legacy_sensor"),
    null,
  );
  assert.equal(
    await getRaceBaseline("race-b", "user-1", "android_legacy_sensor"),
    2500,
  );

  console.log("raceBaselineStorage.test.ts — all passed");
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
