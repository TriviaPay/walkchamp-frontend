/**
 * Run: npx tsx features/unlimited/mappers/unlimitedStreakParticipation.test.ts
 */
import assert from "node:assert/strict";
import {
  isStreakManualLeaveStatus,
  isUnlimitedViewerPastLivePhase,
  isViewerStreakBroken,
  resolveStreakDetailUiBranch,
  resolveUnlimitedCardBadge,
  resolveUnlimitedNextRacePhase,
} from "./unlimitedStreakParticipation";

assert.equal(isStreakManualLeaveStatus("disqualified"), false);
assert.equal(isStreakManualLeaveStatus("left"), true);
assert.equal(isStreakManualLeaveStatus("forfeited"), true);

assert.equal(
  isViewerStreakBroken({ viewerResultsReady: true, viewerResultReasonCode: "daily_goal_missed" }),
  true,
);
assert.equal(isViewerStreakBroken({ viewerStatus: "failed" }), true);
assert.equal(isViewerStreakBroken({ viewerStatus: "active", failedDays: 0 }), false);

assert.equal(
  isUnlimitedViewerPastLivePhase({
    viewerStatus: "active",
    verificationPending: true,
  }),
  true,
  "verificationPending ends live phase while backend viewerStatus stays active",
);
assert.equal(
  isUnlimitedViewerPastLivePhase({
    viewerStatus: "active",
    viewerEndAtMs: Date.now() - 60_000,
  }),
  true,
  "locked viewer window end ends live phase",
);

assert.equal(
  resolveStreakDetailUiBranch({
    viewerResultsReady: true,
    viewerResultReasonCode: "daily_goal_missed",
    resultsStatus: "in_progress",
  }),
  "pending_settlement",
);
assert.equal(
  resolveStreakDetailUiBranch({
    verificationPending: true,
    viewerStatus: "active",
    resultsStatus: "in_progress",
  }),
  "pending_settlement",
);
assert.equal(
  resolveStreakDetailUiBranch({
    viewerResultsReady: true,
    viewerResultReasonCode: "daily_goal_missed",
    resultsStatus: "results_ready",
  }),
  "broken",
);
assert.equal(
  resolveStreakDetailUiBranch({
    viewerResultsReady: true,
    resultsStatus: "results_ready",
  }),
  "final",
);
assert.equal(
  resolveStreakDetailUiBranch({ viewerStatus: "active", resultsStatus: "in_progress" }),
  "live",
);
assert.equal(
  resolveStreakDetailUiBranch({
    viewerStatus: "completed",
    finalVerificationStatus: "submitted",
    resultsStatus: "steps_validation_in_progress",
  }),
  "pending_settlement",
);

assert.deepEqual(
  resolveUnlimitedCardBadge({
    viewerStatus: "active",
    verificationPending: true,
    challengeStatus: "active",
  }),
  { kind: "verifying", label: "VERIFYING" },
);
assert.deepEqual(
  resolveUnlimitedCardBadge({
    viewerStatus: "active",
    challengeStatus: "active",
  }),
  { kind: "live", label: "LIVE" },
);
assert.equal(
  resolveUnlimitedNextRacePhase({
    status: "active",
    verificationPending: true,
    viewerStatus: "active",
  }),
  "verifying",
);

console.log("unlimitedStreakParticipation.test.ts: ok");
