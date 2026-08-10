/**
 * Contract tests: Unlimited must track like classic for live UX, but never
 * write classic race progress. Run: npx tsx services/unlimitedStepTracking.contract.test.ts
 */
import assert from "node:assert/strict";
import {
  clearUnlimitedClassicProgressBlocks,
  getUnlimitedLiveContext,
  isUnlimitedClassicProgressBlocked,
  registerUnlimitedClassicProgressBlock,
  unregisterUnlimitedClassicProgressBlock,
} from "../guards/unlimitedRaceProgressGuard";
import {
  resolveUnlimitedLiveDayContext,
  shouldNativeSyncClassicRaceProgress,
  shouldPauseWalkBackendSync,
} from "../utils/unlimitedLiveDayContext";

// Do not import unlimitedProvisionalProgressApi here — it pulls react-native.

clearUnlimitedClassicProgressBlocks();

const CHALLENGE_ID = "ul-contract-chal-1";

// Register with participant day context (matchmaking / live-detail must do this).
registerUnlimitedClassicProgressBlock(CHALLENGE_ID, {
  challengeDayKey: "2026-08-10",
  timezone: "Asia/Kolkata",
});
assert.equal(isUnlimitedClassicProgressBlocked(CHALLENGE_ID), true);
assert.deepEqual(getUnlimitedLiveContext(CHALLENGE_ID), {
  challengeDayKey: "2026-08-10",
  timezone: "Asia/Kolkata",
});

// Classic progress path must be skipped (JS + native policy).
assert.equal(
  shouldNativeSyncClassicRaceProgress({
    unlimitedDailyMode: true,
    isUnlimitedChallengeIdBlocked: isUnlimitedClassicProgressBlocked(CHALLENGE_ID),
  }),
  false,
);

// Walk sync stays on while Unlimited "live race" tray is active.
assert.equal(
  shouldPauseWalkBackendSync({
    classicLiveRaceActive: false,
    unlimitedDailyModeActive: true,
  }),
  false,
);

// Day context prefers participant over host (prevents WRONG_CHALLENGE_DAY).
{
  const ctx = resolveUnlimitedLiveDayContext({
    participantChallengeDayKey: getUnlimitedLiveContext(CHALLENGE_ID)?.challengeDayKey,
    participantTimezone: getUnlimitedLiveContext(CHALLENGE_ID)?.timezone,
    raceChallengeDayKey: "2026-08-09",
    raceChallengeTimezone: "UTC",
  });
  assert.equal(ctx?.challengeDayKey, "2026-08-10");
  assert.equal(ctx?.timezone, "Asia/Kolkata");
}

unregisterUnlimitedClassicProgressBlock(CHALLENGE_ID);
assert.equal(isUnlimitedClassicProgressBlocked(CHALLENGE_ID), false);
assert.equal(getUnlimitedLiveContext(CHALLENGE_ID), null);

clearUnlimitedClassicProgressBlocks();
console.log("unlimitedStepTracking.contract.test.ts: ok");
