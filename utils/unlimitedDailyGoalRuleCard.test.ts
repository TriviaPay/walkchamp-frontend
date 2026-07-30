import assert from "node:assert/strict";
import {
  DAILY_GOAL_RULE_A11Y_LABEL,
  DAILY_GOAL_RULE_PRIMARY,
  DAILY_GOAL_RULE_PULSE_CYCLES,
  DAILY_GOAL_RULE_TITLE,
  DAILY_GOAL_RULE_THEMES,
  selectDailyGoalRuleTheme,
  shouldShowDailyGoalRuleCard,
} from "./unlimitedDailyGoalRuleCard";
import {
  canContinueStep,
  createDefaultDraft,
  footerPrimaryLabel,
} from "./createChallengeFlow";

assert.equal(shouldShowDailyGoalRuleCard({ isUnlimited: true, step: 5 }), true);
assert.equal(shouldShowDailyGoalRuleCard({ isUnlimited: false, step: 5 }), false);

assert.equal(DAILY_GOAL_RULE_TITLE, "Daily Goal Rule");
assert.equal(DAILY_GOAL_RULE_PRIMARY, "Complete your daily goal every day.");
assert.equal(
  DAILY_GOAL_RULE_A11Y_LABEL,
  "Daily Goal Rule. Complete your daily goal every day.",
);

const pub = selectDailyGoalRuleTheme("public");
assert.equal(pub.border, "#13C8FF");
assert.equal(DAILY_GOAL_RULE_THEMES.private.border, "#C33EFF");
assert.equal(DAILY_GOAL_RULE_PULSE_CYCLES, 3);

{
  const draft = createDefaultDraft();
  draft.entryType = "usd";
  draft.usdFormat = "unlimited_goal";
  draft.unlimitedRulesAccepted = false;
  assert.equal(canContinueStep(5, draft), false);
  draft.unlimitedRulesAccepted = true;
  assert.equal(canContinueStep(5, draft), true);
  assert.ok(footerPrimaryLabel(5, draft).startsWith("Create & Pay"));
}

console.log("unlimitedDailyGoalRuleCard.test.ts: ok");
