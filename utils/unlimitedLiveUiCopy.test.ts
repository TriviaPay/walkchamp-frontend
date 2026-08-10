/**
 * Run: npx tsx utils/unlimitedLiveUiCopy.test.ts
 */
import assert from "node:assert/strict";
import {
  UNLIMITED_COPY,
  isUnlimitedPrizeLost,
  missedDayFooterCopy,
  resolveUnlimitedMissedDayIndex,
} from "./unlimitedLiveUiCopy";
import type { UnlimitedDayRow } from "./unlimitedDayProgress";
import type { UnlimitedViewerSchedule } from "./unlimitedViewerSchedule";

assert.equal(UNLIMITED_COPY.missADayOut, "Miss a day = out");
assert.equal(UNLIMITED_COPY.challengeName, "Streak Challenge");
assert.equal(UNLIMITED_COPY.modalBrand, "Streak Challenge");
assert.equal(UNLIMITED_COPY.lostBadge, "Streak Broken");
assert.equal(UNLIMITED_COPY.lostChip, "Streak Broken");
assert.equal(
  UNLIMITED_COPY.lostAfterMiss,
  "Challenge lost after missing a required day.",
);
assert.equal(
  UNLIMITED_COPY.modalWarning,
  "Miss any required day and you are out of the challenge.",
);

assert.equal(missedDayFooterCopy(2), "Missed Day 2 • Prize pool not eligible");
assert.equal(missedDayFooterCopy(null), "Prize pool not eligible");

assert.equal(
  isUnlimitedPrizeLost({ eligibility: "pending" }),
  false,
);
assert.equal(
  isUnlimitedPrizeLost({ eligibility: "not_eligible" }),
  true,
);
assert.equal(
  isUnlimitedPrizeLost({ qualificationStatus: "disqualified" }),
  true,
);
assert.equal(
  isUnlimitedPrizeLost({ prizePoolEligibilityStatus: "not_eligible" }),
  true,
);

const rows: UnlimitedDayRow[] = [
  {
    dayNumber: 1,
    localDate: "2026-08-01",
    status: "passed",
    dailyGoalSteps: 10000,
    verifiedSteps: 11000,
  },
  {
    dayNumber: 2,
    localDate: "2026-08-02",
    status: "failed",
    dailyGoalSteps: 10000,
    verifiedSteps: 2000,
  },
  {
    dayNumber: 3,
    localDate: "2026-08-03",
    status: "in_progress",
    dailyGoalSteps: 10000,
    verifiedSteps: 8420,
  },
];
assert.equal(
  resolveUnlimitedMissedDayIndex({ historyRows: rows, eligibility: "not_eligible" }),
  2,
);

const schedule = {
  completedDays: 1,
  durationDays: 7,
  viewerStatus: "failed",
} as UnlimitedViewerSchedule;
assert.equal(
  resolveUnlimitedMissedDayIndex({ schedule, eligibility: "not_eligible" }),
  2,
);

console.log("unlimitedLiveUiCopy.test.ts: ok");
