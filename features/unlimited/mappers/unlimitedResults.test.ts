/**
 * Run: npx tsx utils/unlimitedResults.test.ts
 */
import assert from "node:assert/strict";
import {
  resolveUnlimitedResultStatus,
  resolvePrizePoolEligibilityStatus,
  prizePoolEligibilityLabel,
  liveEligibilityLabel,
  resultsScreenCopy,
  resolveUnlimitedResultCardState,
} from "./unlimitedResults";

// ── §1/§2 CORE RULE: never "results_ready" just because the viewer finished ──
{
  // Participant A (India) finishes their Day 7 hours before B/C — global challenge
  // still "active" because B/C's local windows haven't ended.
  const status = resolveUnlimitedResultStatus({
    challengeStatus: "active",
    settlementStatus: null,
    viewerPersonallyFinished: true,
  });
  assert.equal(status, "waiting_for_participants");
}

// Prefer backend resultsStatus when present (maps in_progress → challenge_in_progress).
{
  assert.equal(
    resolveUnlimitedResultStatus({
      resultsStatus: "results_ready",
      challengeStatus: "active",
      settlementStatus: null,
      viewerPersonallyFinished: false,
    }),
    "results_ready",
  );
  assert.equal(
    resolveUnlimitedResultStatus({
      resultsStatus: "in_progress",
      challengeStatus: "active",
      settlementStatus: null,
      viewerPersonallyFinished: true,
    }),
    "waiting_for_participants",
  );
}

// Still racing personally → normal in-progress UI, not waiting/ready.
{
  const status = resolveUnlimitedResultStatus({
    challengeStatus: "active",
    settlementStatus: null,
    viewerPersonallyFinished: false,
  });
  assert.equal(status, "challenge_in_progress");
}

// Global "settling" (backend running settlement) → validating, regardless of viewer.
{
  for (const viewerPersonallyFinished of [true, false]) {
    const status = resolveUnlimitedResultStatus({
      challengeStatus: "settling",
      settlementStatus: "pending",
      viewerPersonallyFinished,
    });
    assert.equal(status, "steps_validation_in_progress");
  }
}

// Global "completed" but settlementStatus still pending/in_progress/manual_review → validating.
for (const settlementStatus of ["pending", "in_progress", "manual_review", null, undefined, ""]) {
  const status = resolveUnlimitedResultStatus({
    challengeStatus: "completed",
    settlementStatus,
    viewerPersonallyFinished: true,
  });
  assert.equal(status, "steps_validation_in_progress", `settlementStatus=${settlementStatus}`);
}

// Global "completed" + finalized settlement → results_ready.
for (const settlementStatus of ["completed", "refunded", "rolled_over"]) {
  const status = resolveUnlimitedResultStatus({
    challengeStatus: "completed",
    settlementStatus,
    viewerPersonallyFinished: true,
  });
  assert.equal(status, "results_ready", `settlementStatus=${settlementStatus}`);
}

// Platform cancellation is a final (non-monetary) outcome, never an infinite wait.
{
  const status = resolveUnlimitedResultStatus({
    challengeStatus: "cancelled_by_platform",
    settlementStatus: null,
    viewerPersonallyFinished: true,
  });
  assert.equal(status, "results_ready");
}

// ── §8 PRIZE POOL ELIGIBILITY ──────────────────────────────────────────────────
{
  // Mid-challenge, no disqualification yet → pending ("Still Eligible").
  assert.equal(
    resolvePrizePoolEligibilityStatus({
      resultStatus: "challenge_in_progress",
      qualificationStatus: "active",
    }),
    "pending",
  );
  assert.equal(liveEligibilityLabel("pending"), "Still Eligible");

  // A finalized failed day disqualifies immediately, even while others still race.
  assert.equal(
    resolvePrizePoolEligibilityStatus({
      resultStatus: "waiting_for_participants",
      qualificationStatus: "disqualified",
    }),
    "not_eligible",
  );
  assert.equal(liveEligibilityLabel("not_eligible"), "Prize Eligibility Lost");

  // Settlement winner.
  assert.equal(
    resolvePrizePoolEligibilityStatus({
      resultStatus: "results_ready",
      qualificationStatus: "qualified",
    }),
    "eligible",
  );
  assert.equal(prizePoolEligibilityLabel("eligible"), "Prize Pool Eligible");

  // Results ready but never flipped to qualified → not eligible (backend never called them a winner).
  assert.equal(
    resolvePrizePoolEligibilityStatus({
      resultStatus: "results_ready",
      qualificationStatus: "active",
    }),
    "not_eligible",
  );
  assert.equal(prizePoolEligibilityLabel("not_eligible"), "Prize Pool Not Eligible");

  // Pending while still validating (not yet results_ready), even if disqualification unknown.
  assert.equal(
    resolvePrizePoolEligibilityStatus({
      resultStatus: "steps_validation_in_progress",
      qualificationStatus: "active",
    }),
    "pending",
  );
  assert.equal(prizePoolEligibilityLabel("pending"), "Eligibility Pending");
}

// ── §16-18 RESULTS SCREEN COPY — no final payout language pre-settlement ──────
{
  const waiting = resultsScreenCopy("waiting_for_participants");
  assert.equal(waiting.title, "Challenge Complete");
  assert.match(waiting.statusHeadline, /Waiting for all participants/);
  assert.ok(!/winner|payout|prize share/i.test(waiting.message + waiting.secondaryText));

  const validating = resultsScreenCopy("steps_validation_in_progress");
  assert.match(validating.statusHeadline, /Validation in Progress/);
  assert.ok(!/winner|payout|prize share/i.test(validating.message));

  const ready = resultsScreenCopy("results_ready");
  assert.match(ready.statusHeadline, /Validation Completed/);
}

// ── §25 WALK CARD STATE MACHINE ────────────────────────────────────────────────
{
  assert.equal(resolveUnlimitedResultCardState("challenge_in_progress"), null);
  assert.equal(resolveUnlimitedResultCardState("waiting_for_participants"), "results_pending");
  assert.equal(resolveUnlimitedResultCardState("steps_validation_in_progress"), "validation_in_progress");
  assert.equal(resolveUnlimitedResultCardState("results_ready"), "view_results");
}

// ── TIMEZONES: India finishes before US, still sees "waiting", not final ─────
{
  // India participant's own viewerStatus is "completed" (their 7 days ended),
  // but the challenge (anchored to the LAST participant's window) is still active
  // because the US participant hasn't reached their local day 7 end yet.
  const indiaViewerStatus = resolveUnlimitedResultStatus({
    challengeStatus: "active",
    settlementStatus: null,
    viewerPersonallyFinished: true,
  });
  assert.equal(indiaViewerStatus, "waiting_for_participants");
  assert.notEqual(indiaViewerStatus, "results_ready");
}

// ── REALTIME SEQUENCE: waiting → validating → ready (spec §23, §30) ───────────
// Simulates the same 3 backend payloads a Pusher `challenge_completed` refresh
// (or the results-screen poll fallback) would deliver over time for one viewer
// who finished early while others were still racing.
{
  const viewerPersonallyFinished = true;

  const t1 = resolveUnlimitedResultStatus({
    challengeStatus: "active",
    settlementStatus: null,
    viewerPersonallyFinished,
  });
  assert.equal(t1, "waiting_for_participants");

  const t2 = resolveUnlimitedResultStatus({
    challengeStatus: "settling",
    settlementStatus: "in_progress",
    viewerPersonallyFinished,
  });
  assert.equal(t2, "steps_validation_in_progress");

  const t3 = resolveUnlimitedResultStatus({
    challengeStatus: "completed",
    settlementStatus: "completed",
    viewerPersonallyFinished,
  });
  assert.equal(t3, "results_ready");

  // Never skips backwards or jumps straight to ready from waiting.
  const sequence = [t1, t2, t3];
  assert.deepEqual(sequence, [
    "waiting_for_participants",
    "steps_validation_in_progress",
    "results_ready",
  ]);
}

console.log("unlimitedResults.test.ts: ok");
