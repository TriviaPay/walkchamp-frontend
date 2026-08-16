/**
 * Run: npx tsx utils/accountDeletion.test.ts
 */
import assert from "node:assert/strict";
import {
  deleteAccountBalanceBlockMessage,
  messageForDeleteAccountResponse,
} from "./accountDeletion";

assert.equal(
  deleteAccountBalanceBlockMessage({ walletBalance: 0, pendingBalance: 0 }),
  null,
);
assert.ok(
  deleteAccountBalanceBlockMessage({ walletBalance: 1.5, pendingBalance: 0 }),
);
assert.ok(
  deleteAccountBalanceBlockMessage({ walletBalance: 0, pendingBalance: 2 }),
);
assert.ok(messageForDeleteAccountResponse(409).toLowerCase().includes("balance"));
assert.equal(
  messageForDeleteAccountResponse(500, { error: "nope" }),
  "nope",
);

console.log("accountDeletion.test.ts: ok");
