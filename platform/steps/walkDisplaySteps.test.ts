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
  shouldAcceptVerifiedZero,
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

// No active race: HC=0 + a big stored/provisional total is unexplained — treat
// as yesterday's leftover and show 0, never the +250 cap.
assert.equal(
  resolveWalkNotificationSteps({
    verifiedTodaySteps: 0,
    provisionalSensorTodaySteps: 9953,
    todaySteps: 9953,
  }),
  0,
);
// A live race actively holding the sensor is real justification for a big jump
// while HC just hasn't synced yet today — trust the (already ingest-vetted)
// provisional total instead of blanking the Walk tab to 0.
assert.equal(
  resolveWalkNotificationSteps({
    verifiedTodaySteps: 0,
    provisionalSensorTodaySteps: 3122,
    todaySteps: 3122,
    raceActive: true,
  }),
  3122,
);

// During a live race with no HC today, leftover thousands stay off Daily Walk.
// Small stored daily totals must not flicker to 0.
assert.equal(
  resolveWalkNotificationSteps({
    verifiedTodaySteps: 0,
    provisionalSensorTodaySteps: 120,
    todaySteps: 120,
    raceActive: true,
  }),
  120,
);
assert.equal(
  resolveWalkNotificationSteps({
    verifiedTodaySteps: 0,
    todaySteps: 250,
    raceActive: true,
  }),
  250,
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

// During a live/sponsored race, do not let sensor/race totals replace HC daily.
assert.equal(
  resolveWalkNotificationSteps({
    verifiedTodaySteps: 113,
    provisionalSensorTodaySteps: 241,
    todaySteps: 241,
    raceActive: true,
  }),
  113,
);
assert.equal(
  resolveWalkNotificationSteps({
    verifiedTodaySteps: 113,
    provisionalSensorTodaySteps: 130,
    raceActive: true,
  }),
  130,
);

// Mid-day HC empty poll must not wipe a known total.
assert.equal(
  shouldAcceptVerifiedZero({ incomingSteps: 0, previousSteps: 6890, freshLocalDay: false }),
  false,
);
// True midnight: HC=0 may clear yesterday.
assert.equal(
  shouldAcceptVerifiedZero({ incomingSteps: 0, previousSteps: 9953, freshLocalDay: true }),
  true,
);
assert.equal(
  shouldAcceptVerifiedZero({ incomingSteps: 0, previousSteps: 0, freshLocalDay: false }),
  true,
);
assert.equal(
  shouldAcceptVerifiedZero({ incomingSteps: 433, previousSteps: 1592, freshLocalDay: false }),
  true,
);

console.log("walkDisplaySteps.test.ts: ok");
