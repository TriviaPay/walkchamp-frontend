/**
 * Run: npx tsx services/steps/walkDisplaySteps.test.ts
 *
 * Preserved: HC 433 wins over inflated sensor 1,592.
 * Live provisional may lead HC so the ongoing notification keeps updating.
 */
import assert from "node:assert/strict";
import {
  resolveWalkNotificationSteps,
  isInflatedProvisionalVsVerified,
  isStaleSensorAbsolute,
} from "./walkDisplaySteps";

// Real HC 433 vs bad sensor 1592 → show 433
assert.equal(
  resolveWalkNotificationSteps({
    verifiedTodaySteps: 433,
    provisionalSensorTodaySteps: 1592,
  }),
  433,
);

// Live walk ahead of lagging HC — show provisional (notification must move)
assert.equal(
  resolveWalkNotificationSteps({
    verifiedTodaySteps: 433,
    provisionalSensorTodaySteps: 450,
  }),
  450,
);
assert.equal(
  resolveWalkNotificationSteps({
    verifiedTodaySteps: 5,
    provisionalSensorTodaySteps: 320,
  }),
  320,
);

// HC delayed — small provisional OK
assert.equal(
  resolveWalkNotificationSteps({
    verifiedTodaySteps: 0,
    provisionalSensorTodaySteps: 120,
  }),
  120,
);

// Fresh local day: HC=0 must beat yesterday's sensor absolute
assert.equal(
  resolveWalkNotificationSteps({
    verifiedTodaySteps: 0,
    provisionalSensorTodaySteps: 9953,
  }),
  0,
);
assert.equal(
  resolveWalkNotificationSteps({
    verifiedTodaySteps: 5,
    provisionalSensorTodaySteps: 9986,
  }),
  5,
);

assert.equal(isInflatedProvisionalVsVerified(433, 1592), true);
assert.equal(isInflatedProvisionalVsVerified(433, 450), false);
assert.equal(isStaleSensorAbsolute(0, 1592), true);
assert.equal(isStaleSensorAbsolute(5, 120), false);

console.log("walkDisplaySteps.test.ts: ok");
