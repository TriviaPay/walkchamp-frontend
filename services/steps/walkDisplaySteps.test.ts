/**
 * Run: npx tsx services/steps/walkDisplaySteps.test.ts
 *
 * Preserved: HC 433 wins over inflated sensor 1,592.
 */
import assert from "node:assert/strict";
import {
  resolveWalkNotificationSteps,
  isInflatedProvisionalVsVerified,
} from "./walkDisplaySteps";

// Real HC 433 vs bad sensor 1592 → show 433
assert.equal(
  resolveWalkNotificationSteps({
    verifiedTodaySteps: 433,
    provisionalSensorTodaySteps: 1592,
  }),
  433,
);

// Small live lag allowed
assert.equal(
  resolveWalkNotificationSteps({
    verifiedTodaySteps: 433,
    provisionalSensorTodaySteps: 450,
  }),
  450,
);

// HC delayed — provisional OK
assert.equal(
  resolveWalkNotificationSteps({
    verifiedTodaySteps: 0,
    provisionalSensorTodaySteps: 120,
  }),
  120,
);

assert.equal(isInflatedProvisionalVsVerified(433, 1592), true);
assert.equal(isInflatedProvisionalVsVerified(433, 450), false);
assert.equal(isInflatedProvisionalVsVerified(0, 1592), false);

console.log("walkDisplaySteps.test.ts: ok");
