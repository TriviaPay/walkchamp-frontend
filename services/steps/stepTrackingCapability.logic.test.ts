/**
 * Run: npx tsx services/steps/stepTrackingCapability.logic.test.ts
 */
import assert from "node:assert/strict";
import { resolvePaidChallengeEligibility } from "./stepTrackingCapabilityLogic";

assert.equal(
  resolvePaidChallengeEligibility({
    verifiedHealthAvailable: true,
    verificationStatus: "ready",
  }),
  "eligible",
);
assert.equal(
  resolvePaidChallengeEligibility({
    verifiedHealthAvailable: true,
    verificationStatus: "permission_required",
  }),
  "setup_required",
);
assert.equal(
  resolvePaidChallengeEligibility({
    verifiedHealthAvailable: true,
    verificationStatus: "provider_required",
  }),
  "setup_required",
);
assert.equal(
  resolvePaidChallengeEligibility({
    verifiedHealthAvailable: true,
    verificationStatus: "sync_delayed",
  }),
  "temporarily_delayed",
);
assert.equal(
  resolvePaidChallengeEligibility({
    verifiedHealthAvailable: false,
    verificationStatus: "unsupported",
  }),
  "unsupported",
);

console.log("stepTrackingCapability.logic.test.ts: ok");
