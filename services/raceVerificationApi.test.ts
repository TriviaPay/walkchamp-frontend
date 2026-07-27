/**
 * Race verification helpers — unit tests (no network / no RN).
 * Run: npx tsx services/raceVerificationApi.test.ts
 */

import assert from "node:assert/strict";
import {
  mintLiveRaceSessionId,
  clampRaceSessionId,
} from "./steps/liveRaceSessionId";
import {
  resultStatusDisplayLabel,
  verificationStatusToReconciliation,
} from "./raceVerificationStatusMap";

assert.equal(verificationStatusToReconciliation("finalized"), "finalized");
assert.equal(verificationStatusToReconciliation("review_required"), "review_required");
assert.equal(
  verificationStatusToReconciliation("verification_rejected"),
  "verification_rejected",
);
assert.equal(verificationStatusToReconciliation("live"), "pending");
assert.equal(
  verificationStatusToReconciliation("verification_delayed"),
  "verification_delayed",
);

assert.equal(resultStatusDisplayLabel("finalized"), "Final result verified");
assert.equal(resultStatusDisplayLabel("verification_pending"), "Verifying your steps");
assert.equal(
  resultStatusDisplayLabel("verification_delayed"),
  "Verification taking longer than expected",
);

const id = mintLiveRaceSessionId({
  userId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
  raceId: "11111111-2222-3333-4444-555555555555",
});
assert.ok(id.length <= 64, `session id too long: ${id.length}`);
assert.equal(clampRaceSessionId("x".repeat(80))?.length, 64);
assert.equal(clampRaceSessionId(""), undefined);

console.log("raceVerificationApi.test.ts — passed");
