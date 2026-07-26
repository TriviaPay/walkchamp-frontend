/**
 * Hybrid scope tests — daily HC vs live TYPE_STEP_COUNTER separation.
 * Run: npx tsx services/steps/stepProviderManager.hybrid.test.ts
 */

import assert from "node:assert/strict";
import { FEATURE_FLAGS } from "@/config/featureFlags";
import { LIVE_RACE_SYNC_CONFIG } from "@/config/stepSyncConfig";
import {
  canonicalLiveRaceStepSource,
  isAcceptedLiveRaceSource,
  isAcceptedRaceProgressSource,
} from "@/services/steps/liveRaceSources";
import { isLegacyStepSourceId } from "@/services/steps/verifiedStepSources";

function run() {
  assert.equal(FEATURE_FLAGS.ENABLE_LIVE_RACE_DEVICE_SENSOR, true);
  assert.equal(LIVE_RACE_SYNC_CONFIG.backendSyncMs, 3_000);

  assert.equal(canonicalLiveRaceStepSource("android"), "android_step_counter");
  assert.equal(canonicalLiveRaceStepSource("ios"), "device_sensor");

  assert.equal(isAcceptedLiveRaceSource("android_step_counter"), true);
  assert.equal(isAcceptedLiveRaceSource("ios_pedometer"), true);
  assert.equal(isAcceptedLiveRaceSource("health_connect"), false);
  assert.equal(isAcceptedLiveRaceSource("ios_healthkit"), false);

  // Race POST may still accept verified sources for reconciliation payloads.
  assert.equal(isAcceptedRaceProgressSource("android_step_counter"), true);
  assert.equal(isAcceptedRaceProgressSource("health_connect"), true);

  assert.equal(isLegacyStepSourceId("android_legacy_sensor"), true);
  assert.equal(isLegacyStepSourceId("android_health_connect"), false);

  console.log("stepProviderManager.hybrid.test.ts — passed");
}

run();
