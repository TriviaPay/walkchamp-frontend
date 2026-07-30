import assert from "node:assert/strict";
import {
  formatPlayerCountDisplay,
  isRoomCapacityFull,
  isUnlimitedGoalChallenge,
  isValidUnlimitedDailyGoalSteps,
  isValidUnlimitedDurationDays,
  isValidUnlimitedEntryFeeCents,
  previewUnlimitedTotalChargeCents,
  UNLIMITED_GOAL_PLATFORM_FEE_CENTS,
  getUnlimitedDailyGoalStepOptions,
  UNLIMITED_GOAL_ENTRY_AMOUNT_DOLLARS,
  UNLIMITED_GOAL_DURATION_DAYS,
  UNLIMITED_GOAL_DEFAULT_DAILY_STEPS,
} from "./unlimitedGoal";

assert.equal(isUnlimitedGoalChallenge("unlimited_goal"), true);
assert.equal(isUnlimitedGoalChallenge({ challengeType: "unlimited_goal" }), true);
assert.equal(isUnlimitedGoalChallenge({ challenge_type: "unlimited_goal" }), true);
assert.equal(isUnlimitedGoalChallenge({ entryType: "unlimited_goal" }), true);
assert.equal(isUnlimitedGoalChallenge({ capacityMode: "unlimited" }), true);
assert.equal(isUnlimitedGoalChallenge({ entryType: "paid_usd" }), false);
assert.equal(isUnlimitedGoalChallenge({ entryType: "free" }), false);

assert.equal(
  isRoomCapacityFull({ currentPlayers: 50_000, maxPlayers: 10, isUnlimited: true }),
  false,
);
assert.equal(
  isRoomCapacityFull({ currentPlayers: 10, maxPlayers: 10, isUnlimited: false }),
  true,
);

assert.equal(
  formatPlayerCountDisplay({ current: 1248, isUnlimited: true }),
  "1,248 joined",
);
assert.equal(
  formatPlayerCountDisplay({ current: 2, max: 10, isUnlimited: false }),
  "2/10",
);

assert.equal(isValidUnlimitedEntryFeeCents(1000), true);
assert.equal(isValidUnlimitedEntryFeeCents(100_000), true);
assert.equal(isValidUnlimitedEntryFeeCents(999), false);
assert.equal(isValidUnlimitedEntryFeeCents(2500), true); // $25
assert.equal(isValidUnlimitedEntryFeeCents(1100), true); // $11
assert.equal(isValidUnlimitedEntryFeeCents(1600), false); // $16 not in list
assert.equal(isValidUnlimitedEntryFeeCents(1001), false);

const preview = previewUnlimitedTotalChargeCents(10_000);
assert.equal(preview.platformFeeCents, UNLIMITED_GOAL_PLATFORM_FEE_CENTS);
assert.equal(preview.totalChargeCents, 10_050);

assert.equal(isValidUnlimitedDailyGoalSteps(10_000), true);
assert.equal(isValidUnlimitedDailyGoalSteps(UNLIMITED_GOAL_DEFAULT_DAILY_STEPS), true);
assert.equal(isValidUnlimitedDailyGoalSteps(2999), false);
assert.equal(isValidUnlimitedDailyGoalSteps(3100), false);
assert.equal(isValidUnlimitedDailyGoalSteps(20_000), true);
assert.equal(isValidUnlimitedDailyGoalSteps(15_000), true);
assert.equal(isValidUnlimitedDurationDays(7), true);
assert.equal(isValidUnlimitedDurationDays(14), false);
assert.equal(isValidUnlimitedDurationDays(15), false);
assert.equal(isValidUnlimitedDurationDays(30), true);
assert.equal(isValidUnlimitedDurationDays(60), true);
assert.equal(isValidUnlimitedDurationDays(90), true);

assert.deepEqual(
  [...UNLIMITED_GOAL_DURATION_DAYS],
  [7, 10, 30, 60, 90],
);
assert.deepEqual(
  [...UNLIMITED_GOAL_ENTRY_AMOUNT_DOLLARS],
  [
    10, 11, 12, 13, 14, 15,
    20, 25, 30, 35, 40, 45, 50,
    60, 70, 80, 90, 100,
    150, 200, 250, 300, 350,
    400, 450, 500, 550, 600, 650, 700, 750, 800, 850, 900, 950, 1000,
  ],
);

const daily = getUnlimitedDailyGoalStepOptions();
assert.equal(daily[0], 3000);
assert.equal(daily.at(-1), 20000);
assert.equal(daily.includes(10_000), true);

console.log("unlimitedGoal.test.ts: ok");
