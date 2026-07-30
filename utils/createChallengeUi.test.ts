import assert from "node:assert/strict";
import {
  indexOfDiscreteValue,
  ratioFromIndex,
  snapIndexFromRatio,
} from "./premiumStepSliderMath";
import { isUnlimitedGoalFrontendEnabled } from "../config/featureFlags";
import {
  CREATE_CHALLENGE_TOTAL_STEPS,
  applyUnlimitedMidnightSchedule,
  canContinueStep,
  createDefaultDraft,
  footerPrimaryLabel,
  getStepBlockReason,
  mapUnlimitedDraftToReviewModel,
  resolveChallengeFormat,
  validateFixedChallengeDraft,
  validateUnlimitedChallengeDraft,
  validateUnlimitedScheduleDraft,
} from "./createChallengeFlow";
import {
  UNLIMITED_GOAL_ENTRY_AMOUNT_DOLLARS,
  UNLIMITED_GOAL_DURATION_DAYS,
  getUnlimitedDailyGoalStepOptions,
} from "./unlimitedGoal";

assert.equal(CREATE_CHALLENGE_TOTAL_STEPS, 5);

// Discrete snap math
assert.equal(snapIndexFromRatio(0, 7), 0);
assert.equal(snapIndexFromRatio(1, 7), 6);
assert.equal(snapIndexFromRatio(0.5, 5), 2);
assert.equal(ratioFromIndex(0, 5), 0);
assert.equal(ratioFromIndex(4, 5), 1);
assert.equal(indexOfDiscreteValue([10, 25, 50], 25), 1);

// Option sets
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
assert.deepEqual(
  [...UNLIMITED_GOAL_DURATION_DAYS],
  [7, 10, 30, 60, 90],
);
const daily = getUnlimitedDailyGoalStepOptions();
assert.equal(daily[0], 3000);
assert.equal(daily.at(-1), 20000);

const draft = createDefaultDraft();
assert.equal(draft.visibility, "public");
assert.equal(draft.entryType, "usd");
assert.equal(draft.unlimited.entryDollars, 10);
assert.equal(draft.unlimited.dailyGoalSteps, 10_000);
assert.equal(draft.unlimited.durationDays, 7);

const format = resolveChallengeFormat(draft);
assert.ok(format === "unlimited_goal" || format === "fixed");

// Step 1
assert.equal(canContinueStep(1, draft), true);

// Step 2 — type only (Free/Coins always continue; USD needs format)
assert.equal(canContinueStep(2, { ...draft, entryType: "free" }), true);
assert.equal(canContinueStep(2, { ...draft, entryType: "coins" }), true);
assert.equal(canContinueStep(2, { ...draft, entryType: "usd", usdFormat: "fixed" }), true);
assert.equal(
  canContinueStep(2, { ...draft, entryType: "usd", usdFormat: "unlimited_goal" }),
  isUnlimitedGoalFrontendEnabled(),
);

// Step 3 — entry + goal (invalid daily blocks)
{
  const unl = createDefaultDraft();
  unl.entryType = "usd";
  unl.usdFormat = "unlimited_goal";
  assert.equal(canContinueStep(3, unl), true);
  assert.equal(
    canContinueStep(3, {
      ...unl,
      unlimited: { ...unl.unlimited, dailyGoalSteps: 2500 },
    }),
    false,
  );
  assert.equal(
    getStepBlockReason(3, {
      ...unl,
      unlimited: { ...unl.unlimited, dailyGoalSteps: 2500 },
    }),
    "invalid_daily_goal",
  );
}

// Step 2 must NOT require entry/goal (when unlimited is enabled)
{
  const unl = createDefaultDraft();
  unl.entryType = "usd";
  unl.usdFormat = "unlimited_goal";
  unl.unlimited = { ...unl.unlimited, dailyGoalSteps: 2500 };
  assert.equal(
    canContinueStep(2, unl),
    isUnlimitedGoalFrontendEnabled(),
    "Step 2 is type-only when unlimited enabled",
  );
}

// Footer labels
assert.equal(footerPrimaryLabel(1, draft), "Continue");
assert.equal(footerPrimaryLabel(2, draft), "Continue");
assert.equal(footerPrimaryLabel(3, draft), "Continue");
assert.equal(footerPrimaryLabel(4, draft), "Review Challenge");
assert.match(footerPrimaryLabel(5, draft), /Create & Pay/);

// Unlimited schedule: midnight tomorrow is valid; rules not required until Step 5
{
  const now = new Date();
  const unl = applyUnlimitedMidnightSchedule(createDefaultDraft(), now);
  unl.entryType = "usd";
  unl.usdFormat = "unlimited_goal";
  if (isUnlimitedGoalFrontendEnabled()) {
    assert.equal(validateUnlimitedScheduleDraft(unl, now), null);
    assert.equal(canContinueStep(4, unl), true);
    assert.equal(unl.unlimitedRulesAccepted, false);
    assert.equal(validateUnlimitedChallengeDraft(unl), "rules_not_accepted");
    unl.unlimitedRulesAccepted = true;
    assert.equal(validateUnlimitedChallengeDraft(unl), null);
  } else {
    assert.equal(validateUnlimitedScheduleDraft(unl, now), "unlimited_disabled");
  }
}

// Unlimited must not require fixed player count
{
  const now = new Date();
  const unl = applyUnlimitedMidnightSchedule(createDefaultDraft(), now);
  unl.entryType = "usd";
  unl.usdFormat = "unlimited_goal";
  unl.fixed = { ...unl.fixed, maxPlayers: 1 }; // invalid for fixed — ignored for unlimited
  if (isUnlimitedGoalFrontendEnabled()) {
    assert.equal(canContinueStep(4, unl), true);
    assert.notEqual(getStepBlockReason(4, unl), "fixed_players_missing");
  }
}

// Fixed still requires 2–10 players
{
  const fixed = createDefaultDraft();
  fixed.entryType = "usd";
  fixed.usdFormat = "fixed";
  fixed.fixed = { ...fixed.fixed, maxPlayers: 1 };
  assert.equal(canContinueStep(4, fixed), false);
  assert.equal(getStepBlockReason(4, fixed), "fixed_players_missing");
  fixed.fixed = { ...fixed.fixed, maxPlayers: 4 };
  fixed.startTimeIdx = 10;
  fixed.startDate = new Date(Date.now() + 86400000);
  assert.equal(canContinueStep(4, fixed), true);
  assert.equal(validateFixedChallengeDraft(fixed), "rules_not_accepted");
}

// Review model isolation
{
  const unl = createDefaultDraft();
  unl.unlimited = { entryDollars: 100, dailyGoalSteps: 8000, durationDays: 30 };
  unl.fixed = { ...unl.fixed, maxPlayers: 8, usdAmountDollars: 25, targetSteps: 5000 };
  unl.startTimeIdx = 10;
  unl.startDate = new Date(Date.now() + 86400000);
  const model = mapUnlimitedDraftToReviewModel(unl, "America/Chicago");
  assert.equal(model.entryAmountCents, 10_000);
  assert.equal(model.dailyGoalSteps, 8000);
  assert.equal(model.durationDays, 30);
  assert.equal(model.capacityMode, "unlimited");
  assert.equal(model.prizeSplitRule, "equal_qualified_split");
  assert.equal(model.platformFeeCents, 50);
  assert.equal(model.totalDueCents, 10_050);
}

// Draft isolation — switching formats keeps separate values
{
  const d = createDefaultDraft();
  d.usdFormat = "unlimited_goal";
  d.unlimited.entryDollars = 500;
  d.unlimited.dailyGoalSteps = 12000;
  const savedUnlimited = { ...d.unlimited };
  d.usdFormat = "fixed";
  d.fixed.usdAmountDollars = 15;
  assert.equal(d.unlimited.entryDollars, savedUnlimited.entryDollars);
  assert.equal(d.fixed.usdAmountDollars, 15);
  d.usdFormat = "unlimited_goal";
  assert.equal(d.unlimited.entryDollars, 500);
  assert.equal(d.unlimited.dailyGoalSteps, 12000);
}

console.log("createChallengeUi.test.ts: ok");
