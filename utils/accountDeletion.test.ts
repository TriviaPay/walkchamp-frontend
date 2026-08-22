/**
 * Run: npx tsx utils/accountDeletion.test.ts
 */
import assert from "node:assert/strict";
import { messageForAccountDeletionRequestResponse } from "./accountDeletion";

assert.equal(
  messageForAccountDeletionRequestResponse(429),
  "Too many requests. Please wait and try again.",
);
assert.equal(
  messageForAccountDeletionRequestResponse(500, { error: "nope" }),
  "nope",
);

console.log("accountDeletion.test.ts: ok");
