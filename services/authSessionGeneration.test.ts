/**
 * Run: npx tsx services/authSessionGeneration.test.ts
 */
import assert from "node:assert/strict";
import {
  bumpAuthGeneration,
  getAuthGeneration,
  isAuthGenerationCurrent,
  captureRaceRealtimeGuard,
} from "./authSessionGeneration";

const g0 = getAuthGeneration();
const g1 = bumpAuthGeneration();
assert.equal(g1, g0 + 1);
assert.equal(isAuthGenerationCurrent(g1), true);
assert.equal(isAuthGenerationCurrent(g0), false);

const guard = captureRaceRealtimeGuard({ userId: "user-a", raceId: "race-1" });
assert.ok(guard);
assert.equal(guard.accepts("race-1"), true);
assert.equal(guard.accepts("race-other"), false);

const g2 = bumpAuthGeneration();
assert.equal(isAuthGenerationCurrent(g2), true);
// After generation bump, prior race guard must reject (even same race id).
assert.equal(guard.accepts("race-1"), false);

console.log("authSessionGeneration.test.ts: ok");
