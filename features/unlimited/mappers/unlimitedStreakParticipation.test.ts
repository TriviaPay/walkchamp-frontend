/**
 * Run: npx tsx features/unlimited/mappers/unlimitedStreakParticipation.test.ts
 */
import assert from "node:assert/strict";
import {
  isStreakManualLeaveStatus,
  isViewerStreakBroken,
  resolveStreakDetailUiBranch,
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
  resolveStreakDetailUiBranch({
    viewerResultsReady: true,
    viewerResultReasonCode: "daily_goal_missed",
    resultsStatus: "in_progress",
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

console.log("unlimitedStreakParticipation.test.ts: ok");
