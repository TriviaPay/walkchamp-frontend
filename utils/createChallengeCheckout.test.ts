import assert from "node:assert/strict";
import {
  CHECKOUT_ACK_TERMS,
  CHECKOUT_ACK_UNLIMITED_L1,
  CHECKOUT_ACK_UNLIMITED_L2,
  CHECKOUT_CARD_GAP,
  CHECKOUT_GOLD,
  CHECKOUT_PRIZE_POOL_NOTE,
  buildCompactChallengeSummary,
  buildUnlimitedPaymentRows,
  checkoutAckLines,
  getTrackDisplayLabel,
  isAllowedPaymentSummaryLabel,
  isRulesAccepted,
} from "./createChallengeCheckout";
import {
  canContinueStep,
  createDefaultDraft,
  footerPrimaryLabel,
} from "./createChallengeFlow";
import { selectEffectiveChallengeSchedule } from "./createChallengeSchedule";
import { getDefaultPlayerCount } from "./players";
import { shouldShowDailyGoalRuleCard } from "./unlimitedDailyGoalRuleCard";

assert.equal(getDefaultPlayerCount(), 10);
assert.equal(createDefaultDraft().fixed.maxPlayers, 10);

const draft = createDefaultDraft();
draft.entryType = "usd";
draft.usdFormat = "unlimited_goal";
draft.unlimited.entryDollars = 12;
draft.unlimited.dailyGoalSteps = 10_000;
draft.unlimited.durationDays = 7;
draft.visibility = "public";
draft.trackLayout = "bg";

const now = new Date("2026-07-28T17:58:00");
const schedule = selectEffectiveChallengeSchedule({
  draft,
  durationDays: 7,
  timezone: "America/Chicago",
  deviceNow: now,
});

const summary = buildCompactChallengeSummary({
  draft,
  schedule,
  timezone: "America/Chicago",
  trackLabel: getTrackDisplayLabel(draft.trackLayout),
});

assert.equal(summary.title, "Review Challenge");
assert.equal(summary.entryLine, "$12 entry");
assert.deepEqual(summary.detailRows, []);

const payment = buildUnlimitedPaymentRows({
  entryFeeCents: 1200,
  platformFeeCents: 50,
  totalChargeCents: 1250,
  formatUsd: (c) => `$${(c / 100).toFixed(2)}`,
});
assert.equal(payment.entryLabel, "Entry Fee");
assert.equal(payment.taxLabel, "Tax / Payment Processing Fee");
assert.equal(payment.taxValue, "$0.00");
assert.equal(payment.platformFeeLabel, "Platform Service Fee");
assert.equal(payment.totalLabel, "Total Payable");
assert.equal(payment.totalValue, "$12.50");
assert.equal(payment.prizePoolNote, CHECKOUT_PRIZE_POOL_NOTE);
assert.equal(isAllowedPaymentSummaryLabel("Entry Fee"), true);
assert.equal(isAllowedPaymentSummaryLabel("Entry contribution"), false);

const ack = checkoutAckLines(draft);
assert.equal(ack.line1, CHECKOUT_ACK_UNLIMITED_L1);
assert.equal(ack.line2, CHECKOUT_ACK_UNLIMITED_L2);
assert.equal(ack.terms, CHECKOUT_ACK_TERMS);
assert.equal(CHECKOUT_GOLD, "#E8C547");

assert.equal(isRulesAccepted(draft), false);
assert.equal(canContinueStep(5, draft, now), false);
draft.unlimitedRulesAccepted = true;
assert.equal(canContinueStep(5, draft, now), true);
assert.ok(footerPrimaryLabel(5, draft).startsWith("Create & Pay"));

assert.equal(shouldShowDailyGoalRuleCard({ isUnlimited: true, step: 5 }), true);
assert.equal(CHECKOUT_CARD_GAP, 12);

console.log("createChallengeCheckout.test.ts: ok");
