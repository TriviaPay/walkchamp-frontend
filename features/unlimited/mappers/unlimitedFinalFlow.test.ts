/**
 * Run: npx tsx features/unlimited/mappers/unlimitedFinalFlow.test.ts
 */
import assert from "node:assert/strict";
import {
  buildFinalFlowStagesFromBackend,
  mapCanonicalFinalFlowToStageId,
  parseUnlimitedFinalFlow,
  readUnlimitedFinalFlowFields,
} from "./unlimitedFinalFlow";

const parsed = readUnlimitedFinalFlowFields({
  viewer: {
    finalResultStatus: "FINAL_VERIFICATION",
    raceFinalStatus: "FINAL_VERIFICATION",
    finalFlowStatus: "verifying_final_results",
    finalFlow: {
      finalResultStatus: "FINAL_VERIFICATION",
      raceFinalStatus: "FINAL_VERIFICATION",
      status: "verifying_final_results",
      title: "Verifying Final Results",
      message: "We're verifying the final activity for all participants.",
    },
  },
});
assert.equal(parsed.finalResultStatus, "FINAL_VERIFICATION");
assert.equal(parsed.raceFinalStatus, "FINAL_VERIFICATION");
assert.equal(parsed.finalFlowStatus, "verifying_final_results");
assert.equal(parsed.finalFlow?.title, "Verifying Final Results");

const fromFinalResult = readUnlimitedFinalFlowFields({
  viewer: {
    finalResultStatus: "FINAL_DAY_COMPLETED_WAITING",
    raceFinalStatus: "WAITING_FOR_PARTICIPANT_DAY_ENDS",
    finalResult: {
      participantStatus: "FINAL_DAY_COMPLETED_WAITING",
      raceStatus: "WAITING_FOR_PARTICIPANT_DAY_ENDS",
      title: "Final Day Completed",
      message: "Your final challenge day is complete. We're waiting for the remaining participants to finish in their local time zones.",
    },
    finalFlow: {
      status: "final_day_completed",
      title: "Deprecated Title",
      message: "Deprecated message from legacy finalFlow.",
    },
  },
});
assert.equal(fromFinalResult.finalFlow?.title, "Final Day Completed");
assert.ok(
  fromFinalResult.finalFlow?.message?.includes("remaining participants"),
  "prefers canonical finalResult.message over legacy finalFlow",
);

assert.equal(
  mapCanonicalFinalFlowToStageId("FINAL_DAY_COMPLETED_WAITING", "WAITING_FOR_PARTICIPANT_DAY_ENDS"),
  "final_day_completed",
);
assert.equal(
  mapCanonicalFinalFlowToStageId("RESULTS_READY", "PREPARING_LEADERBOARD"),
  "results_ready",
);
assert.equal(
  mapCanonicalFinalFlowToStageId("RESULTS_ANNOUNCED", "RESULTS_ANNOUNCED"),
  "challenge_completed",
);

const stages = buildFinalFlowStagesFromBackend(
  "verifying_final_results",
  parseUnlimitedFinalFlow({
    status: "verifying_final_results",
    title: "Verifying Final Results",
    message: "We're verifying the final activity for all participants.",
  }),
);
assert.equal(stages.length, 2);
assert.equal(stages[1]?.title, "Verifying Final Results");
assert.equal(stages[1]?.icon, "search");

console.log("unlimitedFinalFlow.test.ts: ok");
