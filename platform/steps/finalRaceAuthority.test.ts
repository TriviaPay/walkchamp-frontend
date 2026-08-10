/**
 * Final race authority — no max() override of reconciliation.
 * Run: npx tsx services/steps/finalRaceAuthority.test.ts
 */

import assert from "node:assert/strict";
import {
  resolveFinalRaceAuthority,
  resolveFinishedRaceDisplaySteps,
  canShowFinalRaceOutcome,
} from "./finalRaceAuthority";

// Larger provisional must NOT override finalized downward reconciliation
{
  const r = resolveFinalRaceAuthority({
    targetSteps: 10_000,
    backendAcceptedLiveSteps: 3_000,
    backendReconciledSteps: 2_500,
    reconciliationStatus: "finalized",
    localLiveSteps: 4_000,
  });
  assert.equal(r.kind, "finalized");
  if (r.kind === "finalized") {
    assert.equal(r.finalAuthoritativeSteps, 2_500);
  }
  assert.equal(resolveFinishedRaceDisplaySteps(r), 2_500);
}

// Review required — no winner final steps
{
  const r = resolveFinalRaceAuthority({
    targetSteps: 10_000,
    backendAcceptedLiveSteps: 2_800,
    backendReconciledSteps: null,
    reconciliationStatus: "review_required",
    localLiveSteps: 5_000,
  });
  assert.equal(r.kind, "review_required");
  assert.equal(r.finalAuthoritativeSteps, null);
  assert.equal(resolveFinishedRaceDisplaySteps(r), 2_800);
}

// Pending — backend-accepted live preferred over local inflation
{
  const r = resolveFinalRaceAuthority({
    targetSteps: 10_000,
    backendAcceptedLiveSteps: 1_200,
    backendReconciledSteps: null,
    reconciliationStatus: "pending",
    localLiveSteps: 2_000,
  });
  assert.equal(r.kind, "provisional");
  assert.equal(resolveFinishedRaceDisplaySteps(r), 1_200);
  if (r.kind === "provisional") {
    assert.equal(r.displayLabel, "Verification pending");
  }
}

// Rejected — provisional display, never final win
{
  const r = resolveFinalRaceAuthority({
    targetSteps: 10_000,
    backendAcceptedLiveSteps: 1_100,
    backendReconciledSteps: null,
    reconciliationStatus: "verification_rejected",
    localLiveSteps: 3_000,
  });
  assert.equal(r.kind, "verification_rejected");
  assert.equal(r.finalAuthoritativeSteps, null);
  assert.equal(resolveFinishedRaceDisplaySteps(r), 1_100);
}

// Delayed messaging
{
  const r = resolveFinalRaceAuthority({
    targetSteps: 10_000,
    backendAcceptedLiveSteps: 800,
    backendReconciledSteps: null,
    reconciliationStatus: "verification_delayed",
    localLiveSteps: 900,
  });
  assert.equal(r.kind, "provisional");
  if (r.kind === "provisional") {
    assert.equal(r.displayLabel, "Verification taking longer than expected");
  }
}

// No backend yet — may show local provisional for UI only
{
  const r = resolveFinalRaceAuthority({
    targetSteps: 10_000,
    backendAcceptedLiveSteps: null,
    backendReconciledSteps: null,
    reconciliationStatus: "not_started",
    localLiveSteps: 900,
  });
  assert.equal(resolveFinishedRaceDisplaySteps(r), 900);
}

assert.equal(canShowFinalRaceOutcome("finalized"), true);
assert.equal(canShowFinalRaceOutcome("pending"), false);
assert.equal(
  canShowFinalRaceOutcome("pending", { verificationFeatureEnabled: false }),
  true,
);

console.log("finalRaceAuthority.test.ts: all passed");
