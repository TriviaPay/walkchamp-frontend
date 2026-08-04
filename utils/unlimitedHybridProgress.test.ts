/**
 * Run: npx tsx utils/unlimitedHybridProgress.test.ts
 */
import assert from "node:assert/strict";
import {
  resolveUnlimitedDisplayedLiveSteps,
  resolveUnlimitedProgressSource,
  resolveUnlimitedVerificationStatus,
  pickUnlimitedRealtimeDisplaySteps,
  buildLocalUnlimitedDailyProgress,
} from "./unlimitedHybridProgress";

assert.equal(resolveUnlimitedDisplayedLiveSteps(28, 40), 40);
assert.equal(resolveUnlimitedDisplayedLiveSteps(40, 40), 40);
assert.equal(resolveUnlimitedDisplayedLiveSteps(40, 28), 40);
assert.equal(resolveUnlimitedDisplayedLiveSteps(28, null), 28);
assert.equal(resolveUnlimitedDisplayedLiveSteps(0, 125), 125);
assert.equal(resolveUnlimitedDisplayedLiveSteps(433, 1592), 433, "reject inflated sensor vs HC");
assert.equal(resolveUnlimitedDisplayedLiveSteps(433, 450), 450, "allow small live lag");

assert.equal(resolveUnlimitedProgressSource(28, 40), "mixed");
assert.equal(resolveUnlimitedProgressSource(0, 40), "provisional");
assert.equal(resolveUnlimitedProgressSource(40, 40), "verified");
assert.equal(resolveUnlimitedProgressSource(40, 28), "verified");
assert.equal(resolveUnlimitedProgressSource(0, 0), "unavailable");

assert.equal(
  resolveUnlimitedVerificationStatus({
    verifiedTodaySteps: 0,
    provisionalTodaySteps: 40,
  }),
  "verification_delayed",
);
assert.equal(
  resolveUnlimitedVerificationStatus({
    verifiedTodaySteps: 40,
    provisionalTodaySteps: 40,
  }),
  "verified",
);
assert.equal(
  resolveUnlimitedVerificationStatus({
    verifiedTodaySteps: 0,
    provisionalTodaySteps: 0,
    verifiedHealthAvailable: false,
  }),
  "unavailable",
);

// Multi-day total must never be used — pickUnlimited prefers displayedLiveSteps.
assert.equal(
  pickUnlimitedRealtimeDisplaySteps({
    displayedLiveSteps: 40,
    currentSteps: 1600,
    verifiedTodaySteps: 28,
    provisionalTodaySteps: 40,
  }),
  40,
);

const built = buildLocalUnlimitedDailyProgress({
  challengeId: "c1",
  userId: "u1",
  challengeDayKey: "2026-08-04",
  timezone: "Asia/Kolkata",
  verifiedTodaySteps: 28,
  provisionalTodaySteps: 40,
  verificationSource: "health_connect",
  provisionalSource: "android_step_counter",
});
assert.equal(built.displayedLiveSteps, 40);
assert.equal(built.verifiedTodaySteps, 28);
assert.equal(built.provisionalTodaySteps, 40);
assert.equal(built.progressSource, "mixed");
assert.equal(built.verificationStatus, "syncing");

console.log("unlimitedHybridProgress.test.ts: ok");
