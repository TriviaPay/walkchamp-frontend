/**
 * Run: npx tsx services/steps/verifiedAccountStepIsolation.test.ts
 */
import assert from "node:assert/strict";
import {
  applyVerifiedAccountStepIsolation,
  beginVerifiedAccountStepIsolation,
  clearVerifiedAccountStepIsolation,
  resolveIsolatedVerifiedTodaySteps,
} from "./verifiedAccountStepIsolation";

assert.equal(
  resolveIsolatedVerifiedTodaySteps({
    providerSteps: 85,
    accountFloor: 0,
    providerBaseline: 85,
  }),
  0,
  "switch-in: new account starts at own floor, not device HC",
);

assert.equal(
  resolveIsolatedVerifiedTodaySteps({
    providerSteps: 95,
    accountFloor: 0,
    providerBaseline: 85,
  }),
  10,
  "only post-bind walking is attributed",
);

assert.equal(
  resolveIsolatedVerifiedTodaySteps({
    providerSteps: 100,
    accountFloor: 54,
    providerBaseline: 95,
  }),
  59,
  "returning account keeps own floor + new delta",
);

assert.equal(
  resolveIsolatedVerifiedTodaySteps({
    providerSteps: 80,
    accountFloor: 54,
    providerBaseline: 95,
  }),
  54,
  "HC lag below baseline never regresses account floor",
);

clearVerifiedAccountStepIsolation();
beginVerifiedAccountStepIsolation({
  userId: "user-b",
  localDate: "2026-08-04",
  accountFloor: 0,
  providerBaseline: 85,
});
assert.equal(
  applyVerifiedAccountStepIsolation("user-b", 90, "2026-08-04"),
  5,
);
assert.equal(
  applyVerifiedAccountStepIsolation("user-a", 90, "2026-08-04"),
  null,
  "other user does not receive isolation mapping",
);
clearVerifiedAccountStepIsolation();

console.log("verifiedAccountStepIsolation.test.ts: all assertions passed");
