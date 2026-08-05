import assert from "node:assert/strict";
import {
  buildHostPayload,
  createDefaultDraft,
  getFixedWinnerSplit,
  resolveChallengeFormat,
  canContinueStep,
  CREATE_CHALLENGE_TOTAL_STEPS,
} from "./createChallengeFlow";

assert.equal(CREATE_CHALLENGE_TOTAL_STEPS, 5);

const d = createDefaultDraft();
assert.equal(d.visibility, "public");
assert.equal(d.entryType, "usd");
assert.ok(d.usdFormat === "unlimited_goal" || d.usdFormat === "fixed");
assert.equal(d.fixed.maxPlayers, 10);
assert.equal(d.unlimited.dailyGoalSteps, 10_000);
assert.ok(
  resolveChallengeFormat(d) === "unlimited_goal" ||
    resolveChallengeFormat(d) === "fixed",
);

assert.equal(canContinueStep(1, d), true);
assert.equal(canContinueStep(2, { ...d, entryType: "coins" }), true);
assert.equal(canContinueStep(3, { ...d, entryType: "coins" }), true);

assert.equal(getFixedWinnerSplit(2).winnerCount, 1);
assert.equal(getFixedWinnerSplit(3).winnerCount, 2);
assert.equal(getFixedWinnerSplit(10).winnerCount, 3);
assert.deepEqual(
  getFixedWinnerSplit(10).rows.map((r) => r.percent),
  [50, 30, 20],
);

// Free payload
{
  const free = createDefaultDraft();
  free.entryType = "free";
  free.usdFormat = "fixed";
  free.startTimeIdx = 10;
  free.startDate = new Date(Date.now() + 86400000);
  free.rulesAccepted = true;
  const built = buildHostPayload(free, "America/Chicago");
  assert.equal(built.ok, true);
  if (built.ok) {
    assert.equal(built.body.entryType, "free");
    assert.equal(built.body.challengeFormat, "fixed");
    assert.equal(built.body.maxPlayers, free.fixed.maxPlayers);
    assert.equal(built.body.dailyGoalSteps, undefined);
    assert.equal(built.meta.isUnlimited, false);
    // Classic daily fixed: no calendar duration room — winners or 24h from start.
    assert.equal(built.body.challengeDurationDays, 0);
    assert.equal(built.body.challengeEndAtIso, undefined);
    assert.equal(built.meta.durationDays, 0);
  }
}

// Coins payload
{
  const coins = createDefaultDraft();
  coins.entryType = "coins";
  coins.startTimeIdx = 10;
  coins.startDate = new Date(Date.now() + 86400000);
  coins.rulesAccepted = true;
  const built = buildHostPayload(coins, "UTC");
  assert.equal(built.ok, true);
  if (built.ok) {
    assert.equal(built.body.entryType, "coins_battle");
    assert.equal(built.body.coinEntryAmount, coins.fixed.coinEntryAmount);
    assert.equal(built.body.maxParticipants, undefined);
  }
}

// USD Fixed
{
  const usd = createDefaultDraft();
  usd.entryType = "usd";
  usd.usdFormat = "fixed";
  usd.startTimeIdx = 10;
  usd.startDate = new Date(Date.now() + 86400000);
  assert.equal(buildHostPayload(usd, "UTC").ok, false);
  usd.rulesAccepted = true;
  const built = buildHostPayload(usd, "UTC");
  assert.equal(built.ok, true);
  if (built.ok) {
    assert.equal(built.body.entryType, "paid_usd");
    assert.equal(built.body.challengeFormat, "fixed");
    assert.equal(built.body.customEntryAmountCents, usd.fixed.usdAmountDollars * 100);
    assert.equal(built.body.dailyGoalSteps, undefined);
    assert.equal(built.body.capacityMode, undefined);
  }
}

// USD Unlimited
{
  const unl = createDefaultDraft();
  unl.entryType = "usd";
  unl.usdFormat = "unlimited_goal";
  unl.unlimitedRulesAccepted = true;
  const format = resolveChallengeFormat(unl);
  if (format === "unlimited_goal") {
    const built = buildHostPayload(unl, "America/Chicago");
    if (built.ok) {
      assert.equal(built.body.visibility, "public");
      assert.equal(typeof built.body.entryFeeCents, "number");
      assert.equal(typeof built.body.dailyGoalSteps, "number");
      assert.equal(typeof built.body.durationDays, "number");
      assert.ok(typeof built.body.startAtIso === "string");
      assert.equal(built.body.challengeTimezone, "America/Chicago");
      assert.ok(typeof built.body.title === "string");
      assert.equal(built.body.challengeType, undefined);
      assert.equal(built.body.entryType, undefined);
      assert.equal(built.body.capacityMode, undefined);
      assert.equal(built.body.maxPlayers, undefined);
      assert.equal(built.body.platformFeeCents, undefined);
      assert.equal(built.body.scheduledStartAtIso, undefined);
      assert.ok(built.meta.scheduledStartAt);
      assert.equal(built.meta.scheduledStartAt!.getHours(), 0);
      assert.equal(built.meta.scheduledStartAt!.getMinutes(), 0);
    } else {
      assert.fail(built.error);
    }
  }
}

console.log("createChallengeFlow.test.ts: ok");
