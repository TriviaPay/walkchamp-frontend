/**
 * Stale payment-quote response guard — sequence numbers ignore out-of-order replies.
 */

import assert from "node:assert/strict";

function applyQuoteIfCurrent(
  seq: number,
  currentSeq: number,
  apply: () => void,
): boolean {
  if (seq !== currentSeq) return false;
  apply();
  return true;
}

let applied = 0;
let current = 0;

current = 1;
assert.equal(applyQuoteIfCurrent(1, current, () => { applied = 1; }), true);
assert.equal(applied, 1);

current = 2;
assert.equal(applyQuoteIfCurrent(1, current, () => { applied = 99; }), false);
assert.equal(applied, 1);

assert.equal(applyQuoteIfCurrent(2, current, () => { applied = 2; }), true);
assert.equal(applied, 2);

console.log("cashQuoteStaleGuard.test.ts: ok");
