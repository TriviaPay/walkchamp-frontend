/**
 * Characterization lock for step sync interval contracts.
 * Changing these values alters production freshness — only update intentionally.
 * Run: npx tsx config/stepSyncConfig.test.ts
 */

import assert from "node:assert/strict";
import { STEP_SYNC_CONFIG } from "./stepSyncConfig";

assert.equal(STEP_SYNC_CONFIG.WALK_BACKEND_SYNC_MS, 3_000);
assert.equal(STEP_SYNC_CONFIG.WALK_LOCAL_RECONCILE_POLL_MS, 3_000);
assert.equal(STEP_SYNC_CONFIG.RACE_LOCAL_POLL_MS, 1_000);
assert.equal(STEP_SYNC_CONFIG.RACE_BACKEND_SYNC_MS, 3_000);
assert.equal(STEP_SYNC_CONFIG.RACE_BACKEND_SYNC_MIN_DELTA, 1);
assert.equal(STEP_SYNC_CONFIG.RACE_BACKEND_SYNC_FORCE_DELTA, 60);
assert.equal(STEP_SYNC_CONFIG.RACE_UI_UPDATE_MS, 1_000);
assert.equal(STEP_SYNC_CONFIG.WALK_BACKEND_SYNC_MIN_DELTA_VERIFIED, 5);
assert.equal(STEP_SYNC_CONFIG.WALK_BACKEND_SYNC_MIN_DELTA_LEGACY, 3);
assert.equal(STEP_SYNC_CONFIG.WALK_PHANTOM_STEP_BUMP, 1);
assert.equal(STEP_SYNC_CONFIG.WALK_MAX_STEP_SPIKE, 500);
assert.equal(STEP_SYNC_CONFIG.LEGACY_MAX_UNCONFIRMED_AHEAD, 12);
assert.equal(STEP_SYNC_CONFIG.LEGACY_MAX_TICK_JUMP, 8);
assert.equal(STEP_SYNC_CONFIG.STEP_DEBUG_VERBOSE, false);

console.log("stepSyncConfig.test.ts — interval contracts locked");
