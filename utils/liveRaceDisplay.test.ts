/**
 * Unit tests for live race / walk display helpers.
 * Run: npx tsx utils/liveRaceDisplay.test.ts
 */

import assert from "node:assert/strict";
import {
  formatRaceSteps,
  resolveDisplayTodaySteps,
  resolveLiveRaceDisplaySteps,
} from "./liveRaceDisplay";

assert.equal(formatRaceSteps(0), "0");
assert.equal(formatRaceSteps(999), "999");
assert.equal(formatRaceSteps(1000), "1k");
assert.equal(formatRaceSteps(1500), "1.5k");

assert.equal(resolveLiveRaceDisplaySteps(10, 20), 20);
assert.equal(resolveLiveRaceDisplaySteps(30, 5), 30);
assert.equal(resolveLiveRaceDisplaySteps(undefined, 7), 7);

assert.equal(resolveDisplayTodaySteps(100, 50), 100);
assert.equal(resolveDisplayTodaySteps(40, 90), 90);

console.log("liveRaceDisplay.test.ts: ok");
