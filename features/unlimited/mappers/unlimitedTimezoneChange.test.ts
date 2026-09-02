/**
 * Run: npx tsx features/unlimited/mappers/unlimitedTimezoneChange.test.ts
 */
import assert from "node:assert/strict";
import {
  deviceTimezoneChangeDetected,
  deviceTimezoneDiffersFromChallenge,
  resolveUnlimitedFinalResultStages,
  shouldShowTimezoneDetectBanner,
  shouldShowTimezoneTransitionBanner,
  shouldSilentlyAcknowledgeDeviceTimezone,
} from "./unlimitedTimezoneChange";

assert.equal(deviceTimezoneDiffersFromChallenge("Asia/Kolkata", "America/Chicago"), true);
assert.equal(deviceTimezoneDiffersFromChallenge("America/Chicago", "America/Chicago"), false);

assert.equal(deviceTimezoneChangeDetected("Asia/Kolkata", "America/Chicago"), true);
assert.equal(deviceTimezoneChangeDetected("Asia/Kolkata", "Asia/Kolkata"), false);
assert.equal(deviceTimezoneChangeDetected("Asia/Kolkata", null), false);

assert.equal(
  shouldShowTimezoneDetectBanner(
    {
      challengeId: "c1",
      viewerTimezone: "America/Chicago",
      challengeStatus: "active",
    },
    "Asia/Kolkata",
    "America/Chicago",
  ),
  true,
);

assert.equal(
  shouldShowTimezoneDetectBanner(
    {
      challengeId: "c1",
      viewerTimezone: "America/Chicago",
      challengeStatus: "active",
    },
    "Asia/Kolkata",
    "Asia/Kolkata",
  ),
  false,
);

assert.equal(
  shouldShowTimezoneDetectBanner(
    {
      challengeId: "c1",
      viewerTimezone: "America/Chicago",
      challengeStatus: "active",
    },
    "Asia/Kolkata",
    null,
  ),
  false,
);

assert.equal(
  shouldSilentlyAcknowledgeDeviceTimezone("America/Chicago", "Asia/Kolkata", "America/Chicago"),
  true,
);

assert.equal(
  shouldSilentlyAcknowledgeDeviceTimezone("Asia/Kolkata", "Asia/Kolkata", "America/Chicago"),
  false,
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
    "America/Chicago",
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
assert.equal(waiting.length, 1);
assert.equal(waiting[0].id, "final_day_completed");
assert.equal(waiting[0].title, "Final Day Completed");

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

const canonical = resolveUnlimitedFinalResultStages({
  resultStatus: "waiting_for_participants",
  viewerPersonallyFinished: true,
  finalResultStatus: "FINAL_VERIFICATION",
  raceFinalStatus: "FINAL_VERIFICATION",
});
assert.equal(canonical.at(-1)?.id, "verifying_final_results");

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
