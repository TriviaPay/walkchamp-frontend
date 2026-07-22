/**
 * Characterization: payment UI must display backend quote totals.
 * Run: npx tsx utils/paymentDisplayTrust.test.ts
 */

import assert from "node:assert/strict";
import { selectTrustedPaymentDisplay } from "./paymentDisplayTrust";

// Prefer backend totalPayable over any local fee sum
const quote = {
  entryFee: 5,
  paymentProcessingFee: 0.5,
  platformServiceFee: 0.25,
  totalPayable: 6.1, // backend may include tax / rounding not visible as fee fields
  canAfford: true,
  walletBalance: 20,
};

const display = selectTrustedPaymentDisplay(quote);
assert.ok(display);
assert.equal(display.totalPayable, 6.1, "must use backend totalPayable");
assert.equal(display.trustedTotal, true);
assert.notEqual(
  display.totalPayable,
  quote.entryFee + quote.paymentProcessingFee + quote.platformServiceFee,
  "must not recompute total as local fee sum when totals differ",
);

// Cents-only quote still trusted
const centsOnly = selectTrustedPaymentDisplay({
  totalPayableCents: 610,
  entryFeeCents: 500,
  paymentProcessingFeeCents: 50,
  platformServiceFeeCents: 25,
});
assert.ok(centsOnly);
assert.equal(centsOnly.totalPayable, 6.1);
assert.equal(centsOnly.trustedTotal, true);

// Missing backend total → not trusted (do not invent from fees)
const untrusted = selectTrustedPaymentDisplay({
  entryFee: 5,
  paymentProcessingFee: 1,
  platformServiceFee: 1,
});
assert.ok(untrusted);
assert.equal(untrusted.trustedTotal, false);
assert.equal(untrusted.totalPayable, 0);

// null quote
assert.equal(selectTrustedPaymentDisplay(null), null);
assert.equal(selectTrustedPaymentDisplay(undefined), null);

// Prefer dollars over cents when both present
const both = selectTrustedPaymentDisplay({
  totalPayable: 7,
  totalPayableCents: 9999,
});
assert.ok(both);
assert.equal(both.totalPayable, 7);

console.log("paymentDisplayTrust.test.ts — all assertions passed");
