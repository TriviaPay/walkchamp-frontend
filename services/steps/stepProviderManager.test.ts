/**
 * Unit tests for step provider manager selection logic.
 * Run: npx tsx services/steps/stepProviderManager.test.ts
 */

import assert from "node:assert/strict";
import { LIVE_RACE_SYNC_CONFIG } from "@/config/stepSyncConfig";

function run() {
  assert.equal(LIVE_RACE_SYNC_CONFIG.backendSyncMs, 5_000);
  assert.equal(LIVE_RACE_SYNC_CONFIG.minStepDeltaToSync, 1);
  assert.equal(LIVE_RACE_SYNC_CONFIG.flushOnAppBackground, true);
  assert.equal(LIVE_RACE_SYNC_CONFIG.flushOnGoalComplete, true);

  console.log("stepProviderManager.test.ts — config assertions passed");
}

run();
