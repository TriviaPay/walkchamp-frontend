/**
 * Unit tests for verified / legacy step source helpers (pure, no RN).
 * Run: npx tsx services/steps/verifiedStepSources.test.ts
 */

import assert from "node:assert/strict";
import {
  isAcceptedVerifiedSource,
  isLegacyStepSourceId,
} from "@/services/steps/verifiedStepSources";
import { LIVE_RACE_SYNC_CONFIG } from "@/config/stepSyncConfig";

function run() {
  assert.equal(LIVE_RACE_SYNC_CONFIG.backendSyncMs, 3_000);
  assert.equal(LIVE_RACE_SYNC_CONFIG.minStepDeltaToSync, 1);

  assert.equal(isAcceptedVerifiedSource("health_connect"), true);
  assert.equal(isAcceptedVerifiedSource("android_health_connect"), true);
  assert.equal(isAcceptedVerifiedSource("healthkit"), true);
  assert.equal(isAcceptedVerifiedSource("ios_healthkit"), true);

  for (const id of [
    "sensor",
    "legacy",
    "phone_sensor",
    "activity_sensor",
    "pedometer",
    "android_legacy_sensor",
    "android_device_step_counter",
    "android_step_counter",
  ]) {
    assert.equal(isLegacyStepSourceId(id), true, `expected legacy: ${id}`);
    assert.equal(isAcceptedVerifiedSource(id), false, `must reject: ${id}`);
  }

  assert.equal(isAcceptedVerifiedSource(null), false);
  assert.equal(isAcceptedVerifiedSource(""), false);
  assert.equal(isAcceptedVerifiedSource("unknown"), false);
  assert.equal(isLegacyStepSourceId("android_health_connect"), false);
  assert.equal(isLegacyStepSourceId("ios_healthkit"), false);

  console.log("verifiedStepSources.test.ts — passed");
}

run();
