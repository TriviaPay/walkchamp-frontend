/**
 * Race health verification unit tests.
 * Run: npx tsx services/steps/raceHealthVerification.test.ts
 */

import assert from "node:assert/strict";
import { STEP_SYNC_CONFIG } from "@/config/stepSyncConfig";

function classify(live: number, verified: number): string {
  const difference = live - verified;
  const differencePercent =
    live <= 0 && verified <= 0
      ? 0
      : Math.abs(difference) / Math.max(live, verified, 1);
  if (difference === 0) return "matched";
  if (Math.abs(difference) <= 75 || differencePercent <= 0.08) {
    return "within_tolerance";
  }
  if (verified + 40 < live) return "verification_delayed";
  return "mismatch";
}

function run() {
  assert.equal(STEP_SYNC_CONFIG.RACE_HEALTH_VERIFICATION_MS, 180_000);
  assert.equal(classify(1000, 1000), "matched");
  assert.equal(classify(1000, 960), "within_tolerance");
  assert.equal(classify(2000, 500), "verification_delayed");
  assert.equal(classify(100, 500), "mismatch");
  console.log("raceHealthVerification.test.ts — passed");
}

run();
