/**
 * Run: npx tsx features/unlimited/mappers/unlimitedTimezoneChange.test.ts
 */
import assert from "node:assert/strict";
import {
  deviceTimezoneDiffersFromChallenge,
  resolveUnlimitedFinalResultStages,
  shouldShowTimezoneDetectBanner,
  shouldShowTimezoneTransitionBanner,
} from "./unlimitedTimezoneChange";

assert.equal(deviceTimezoneDiffersFromChallenge("Asia/Kolkata", "America/Chicago"), true);
assert.equal(deviceTimezoneDiffersFromChallenge("America/Chicago", "America/Chicago"), false);

assert.equal(
  shouldShowTimezoneDetectBanner(
    {
      challengeId: "c1",
      viewerTimezone: "America/Chicago",
      challengeStatus: "active",
    },
    "Asia/Kolkata",
  ),
  true,
);

assert.equal(
  shouldShowTimezoneDetectBanner(
    {
      challengeId: "c1",
      viewerTimezone: "America/Chicago",
      pendingTimezone: "Asia/Kolkata",
      timezoneChangeAppliesToChallenge: true,
      challengeStatus: "active",
    },
    "Asia/Kolkata",
  ),
  false,
);

assert.equal(
  shouldShowTimezoneTransitionBanner({
    challengeId: "c1",
    viewerTimezone: "America/Chicago",
    pendingTimezone: "Asia/Kolkata",
    timezoneChangeAppliesToChallenge: true,
  }),
  true,
);

const waiting = resolveUnlimitedFinalResultStages({
  resultStatus: "waiting_for_participants",
  viewerPersonallyFinished: true,
});
assert.equal(waiting.length, 2);
assert.equal(waiting[0].id, "final_day_completed");
assert.equal(waiting[1].id, "final_results_pending");
assert.equal(waiting[1].title, "Final Results Pending");

const verifying = resolveUnlimitedFinalResultStages({
  resultStatus: "steps_validation_in_progress",
  viewerPersonallyFinished: true,
  finalVerificationStatus: "submitted",
});
assert.equal(verifying.at(-1)?.id, "verifying_final_results");
assert.equal(verifying.at(-1)?.title, "Verifying Final Results");

const pendingFlag = resolveUnlimitedFinalResultStages({
  resultStatus: "challenge_in_progress",
  viewerPersonallyFinished: true,
  verificationPending: true,
  pastLivePhase: true,
});
assert.equal(pendingFlag.at(-1)?.id, "verifying_final_results");

const ready = resolveUnlimitedFinalResultStages({
  resultStatus: "results_ready",
  viewerPersonallyFinished: true,
  showingFinalResults: false,
});
assert.equal(ready.at(-1)?.id, "results_ready");

const done = resolveUnlimitedFinalResultStages({
  resultStatus: "results_ready",
  viewerPersonallyFinished: true,
  showingFinalResults: true,
});
assert.equal(done.at(-1)?.id, "challenge_completed");
assert.equal(done.at(-1)?.title, "Challenge Completed");

console.log("unlimitedTimezoneChange.test.ts: ok");
