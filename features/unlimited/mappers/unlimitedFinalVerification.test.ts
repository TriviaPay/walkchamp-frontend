/**
 * Run: npx tsx features/unlimited/mappers/unlimitedFinalVerification.test.ts
 */
import assert from "node:assert/strict";
import {
  canPublishFinalResult,
  resolveUnlimitedResultStatus,
  resolvePrizePoolEligibilityStatus,
} from "./unlimitedResults";
import { resolveStreakDetailUiBranch } from "./unlimitedStreakParticipation";
import { UNLIMITED_COPY, isUnlimitedPrizeLost } from "./unlimitedLiveUiCopy";
import {
  classifyUnlimitedFinalVerificationError,
  canonicalUnlimitedFinalHealthSource,
  isUnlimitedFinalVerificationRequested,
  nextUnlimitedFinalVerificationRetryMs,
  selectUnlimitedFinalDayWindow,
  unlimitedFinalVerificationPendingCopy,
} from "./unlimitedFinalVerification";
import type { UnlimitedDailyHistoryPayload } from "./unlimitedDayProgress";

// India finished while USA remains open — never unlock final results.
{
  const status = resolveUnlimitedResultStatus({
    challengeStatus: "active",
    settlementStatus: null,
    viewerPersonallyFinished: true,
  });
  assert.equal(status, "waiting_for_participants");
  assert.equal(canPublishFinalResult("waiting_for_participants"), false);
  assert.equal(canPublishFinalResult("in_progress"), false);
  assert.equal(canPublishFinalResult("steps_validation_in_progress"), false);
  assert.equal(canPublishFinalResult("results_ready"), true);
}

// No winner/loser UI before global results_ready.
{
  assert.equal(
    resolveStreakDetailUiBranch({
      viewerStatus: "failed",
      resultsStatus: "waiting_for_participants",
    }),
    "pending_settlement",
  );
  assert.equal(
    resolveStreakDetailUiBranch({
      viewerStatus: "completed",
      finalVerificationStatus: "submitted",
      resultsStatus: "steps_validation_in_progress",
    }),
    "pending_settlement",
  );
  assert.equal(
    isUnlimitedPrizeLost({
      qualificationStatus: "disqualified",
      resultsStatus: "waiting_for_participants",
    }),
    false,
  );
  assert.equal(
    isUnlimitedPrizeLost({
      qualificationStatus: "disqualified",
      resultsStatus: "results_ready",
    }),
    true,
  );
  assert.equal(
    resolvePrizePoolEligibilityStatus({
      resultStatus: "waiting_for_participants",
      qualificationStatus: "disqualified",
    }),
    "pending",
  );
}

// Exact server interval forwarded unchanged (never reconstructed).
{
  const payload: UnlimitedDailyHistoryPayload = {
    durationDays: 7,
    finalVerificationRequired: true,
    finalVerificationStatus: "requested",
    days: [
      {
        dayNumber: 7,
        dayIndex: 7,
        participantLocalDate: "2026-08-15",
        windowStartUtc: "2026-08-15T05:00:00.000Z",
        windowEndUtc: "2026-08-16T05:00:00.000Z",
        dayStatus: "passed",
      },
    ],
  };
  const window = selectUnlimitedFinalDayWindow(payload);
  assert.deepEqual(window, {
    dayNumber: 7,
    intervalStartUtc: "2026-08-15T05:00:00.000Z",
    intervalEndUtc: "2026-08-16T05:00:00.000Z",
  });
  assert.equal(isUnlimitedFinalVerificationRequested(payload), true);
}

// Health permission / provider unavailable — never substitute sensor data.
{
  assert.equal(canonicalUnlimitedFinalHealthSource("android_step_counter"), null);
  assert.equal(canonicalUnlimitedFinalHealthSource("ios_pedometer"), null);
  assert.equal(canonicalUnlimitedFinalHealthSource("health_connect"), "health_connect");
  assert.equal(canonicalUnlimitedFinalHealthSource("healthkit"), "healthkit");
  assert.equal(canonicalUnlimitedFinalHealthSource("android_health_connect"), "health_connect");
  assert.equal(canonicalUnlimitedFinalHealthSource("ios_healthkit"), "healthkit");
}

// Network retry + stop / wait / refetch actions.
{
  assert.equal(
    classifyUnlimitedFinalVerificationError({ httpStatus: 0, code: "network_error" }),
    "retry",
  );
  assert.equal(
    classifyUnlimitedFinalVerificationError({ httpStatus: 503 }),
    "retry",
  );
  assert.equal(
    classifyUnlimitedFinalVerificationError({
      httpStatus: 409,
      code: "participant_days_still_open",
    }),
    "wait",
  );
  assert.equal(
    classifyUnlimitedFinalVerificationError({
      httpStatus: 409,
      code: "verification_before_race_boundary",
    }),
    "wait",
  );
  assert.equal(
    classifyUnlimitedFinalVerificationError({
      httpStatus: 400,
      code: "verification_window_mismatch",
    }),
    "refetch",
  );
  assert.equal(
    classifyUnlimitedFinalVerificationError({
      httpStatus: 403,
      code: "not_settlement_participant",
    }),
    "stop",
  );
  assert.equal(
    classifyUnlimitedFinalVerificationError({
      httpStatus: 200,
      code: undefined,
    }),
    "stop",
  );
  assert.equal(nextUnlimitedFinalVerificationRetryMs(0), 30_000);
  assert.equal(nextUnlimitedFinalVerificationRetryMs(1), 60_000);
  assert.ok(nextUnlimitedFinalVerificationRetryMs(10) <= 5 * 60_000);
}

// Manual submitted state + resume-after-request pending copy.
{
  const submitted = unlimitedFinalVerificationPendingCopy("submitted");
  assert.equal(submitted.title, "Final health data received");
  assert.equal(submitted.subtitle, "Verification review in progress");
  assert.equal(submitted.title, UNLIMITED_COPY.healthDataReceived);
  assert.equal(submitted.subtitle, UNLIMITED_COPY.verificationReview);
  const requested = unlimitedFinalVerificationPendingCopy("requested");
  assert.equal(requested.title, "Final Day: Completed");
  assert.equal(requested.subtitle, "Verification: Pending final race settlement");
  assert.equal(
    isUnlimitedFinalVerificationRequested({
      finalVerificationStatus: "requested",
      finalVerificationRequired: false,
    }),
    true,
  );
  assert.equal(
    isUnlimitedFinalVerificationRequested({
      finalVerificationStatus: "pending",
      finalVerificationRequired: true,
    }),
    true,
  );
}

console.log("unlimitedFinalVerification.test.ts: ok");
