/**
 * Fixed-player cash entry fee — API allowlist $3 / $5 / $10 / $15 / $20 / $25.
 */

import assert from "node:assert/strict";
import {
  USD_FIXED_ENTRY_DOLLARS,
  USD_FIXED_ENTRY_DEFAULT_DOLLARS,
  USD_FIXED_ENTRY_MAX_DOLLARS,
  USD_FIXED_ENTRY_MIN_DOLLARS,
  buildHostPayload,
  clampUsdFixedEntryDollars,
  createDefaultDraft,
  formatUsdFixedCashChallengeLabel,
  isValidUsdFixedEntryDollars,
  usdFixedEntryDollarsToCents,
} from "./createChallengeFlow";

assert.equal(USD_FIXED_ENTRY_MIN_DOLLARS, 3);
assert.equal(USD_FIXED_ENTRY_MAX_DOLLARS, 25);
assert.equal(USD_FIXED_ENTRY_DEFAULT_DOLLARS, 3);
assert.deepEqual([...USD_FIXED_ENTRY_DOLLARS], [3, 5, 10, 15, 20, 25]);

{
  const d = createDefaultDraft();
  assert.equal(d.fixed.usdAmountDollars, 3);
}

assert.equal(isValidUsdFixedEntryDollars(3), true);
assert.equal(isValidUsdFixedEntryDollars(5), true);
assert.equal(isValidUsdFixedEntryDollars(10), true);
assert.equal(isValidUsdFixedEntryDollars(15), true);
assert.equal(isValidUsdFixedEntryDollars(20), true);
assert.equal(isValidUsdFixedEntryDollars(25), true);
assert.equal(isValidUsdFixedEntryDollars(4), false);
assert.equal(isValidUsdFixedEntryDollars(7), false);
assert.equal(isValidUsdFixedEntryDollars(12), false);
assert.equal(isValidUsdFixedEntryDollars(2), false);
assert.equal(isValidUsdFixedEntryDollars(26), false);
assert.equal(isValidUsdFixedEntryDollars(5.5), false);
assert.equal(isValidUsdFixedEntryDollars(null), false);

assert.equal(clampUsdFixedEntryDollars(2), 3);
assert.equal(clampUsdFixedEntryDollars(26), 25);
assert.equal(clampUsdFixedEntryDollars(7), 5);
assert.equal(clampUsdFixedEntryDollars(8), 10);
assert.equal(clampUsdFixedEntryDollars(12), 10);
assert.equal(clampUsdFixedEntryDollars(13), 15);
assert.equal(clampUsdFixedEntryDollars(NaN), 3);
assert.equal(clampUsdFixedEntryDollars(15), 15);

assert.equal(usdFixedEntryDollarsToCents(3), 300);
assert.equal(usdFixedEntryDollarsToCents(10), 1000);
assert.equal(usdFixedEntryDollarsToCents(25), 2500);
assert.equal(usdFixedEntryDollarsToCents(7), 500); // snaps to nearest allowed

assert.equal(formatUsdFixedCashChallengeLabel(3), "$3 Cash Challenge");
assert.equal(formatUsdFixedCashChallengeLabel(20), "$20 Cash Challenge");
assert.equal(formatUsdFixedCashChallengeLabel(7), "$5 Cash Challenge");

for (const dollars of USD_FIXED_ENTRY_DOLLARS) {
  const draft = createDefaultDraft();
  draft.entryType = "usd";
  draft.usdFormat = "fixed";
  draft.fixed.usdAmountDollars = dollars;
  draft.startTimeIdx = 10;
  draft.startDate = new Date(Date.now() + 86400000);
  draft.rulesAccepted = true;
  const built = buildHostPayload(draft, "UTC");
  assert.equal(built.ok, true, `expected ok for $${dollars}`);
  if (built.ok) {
    assert.equal(built.body.entryType, "paid_usd");
    assert.equal(built.body.customEntryAmountCents, dollars * 100);
  }
}

{
  const draft = createDefaultDraft();
  draft.entryType = "usd";
  draft.usdFormat = "fixed";
  draft.startTimeIdx = 10;
  draft.startDate = new Date(Date.now() + 86400000);
  draft.rulesAccepted = true;
  draft.fixed.usdAmountDollars = 7;
  assert.equal(buildHostPayload(draft, "UTC").ok, false);
  draft.fixed.usdAmountDollars = 4;
  assert.equal(buildHostPayload(draft, "UTC").ok, false);
}

console.log("usdFixedEntryFee.test.ts: ok");
