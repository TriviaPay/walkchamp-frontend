/**
 * Unlimited Daily Goal Challenge — delayed results / prize-pool eligibility.
 *
 * PRODUCT RULE: participants are in different locked timezones, so the
 * logged-in participant finishing their own final local day NEVER means the
 * challenge's results are final. Results only become final once the BACKEND
 * (Backend/src/lib/unlimitedChallengeSettlement.ts `settleUnlimitedChallenge`)
 * has settled every participant — which itself only runs once every
 * non-`left` participant's required days are `passed`/`failed` (see
 * `unlimitedChallengeSettlement.ts` lines ~31-44).
 *
 * This module derives a `UnlimitedChallengeResultStatus` from EXISTING
 * backend-authoritative fields only:
 *   - `challenge.status`      (waiting|starting|active|settling|completed|cancelled_by_platform)
 *   - `challenge.settlementStatus` (pending|in_progress|completed|manual_review|rolled_over|refunded)
 *   - the viewer's OWN personal completion (from computeUnlimitedViewerSchedule),
 *     used ONLY to distinguish "still racing" from "waiting for everyone else" —
 *     never to conclude "results_ready" (that requires the GLOBAL challenge
 *     status to be settled, see resolveUnlimitedResultStatus below).
 *
 * No backend change. No frontend-invented final eligibility or prize amounts.
 */

// ── Result state model (spec §3) ──────────────────────────────────────────────

export type UnlimitedChallengeResultStatus =
  | "challenge_in_progress"
  | "waiting_for_participants"
  | "steps_validation_in_progress"
  | "results_ready";

export interface UnlimitedResultStatusInput {
  /** Raw backend `challenge.status`. */
  challengeStatus: string | null | undefined;
  /** Raw backend `challenge.settlementStatus`. */
  settlementStatus: string | null | undefined;
  /** True once the logged-in participant's own locked-timezone duration has ended
   *  (i.e. their `viewerStatus` from computeUnlimitedViewerSchedule is
   *  "completed" / "failed" / "left" — they are done, win or lose). */
  viewerPersonallyFinished: boolean;
}

/** Settlement outcomes that mean "nothing left to validate" (spec §7, §11). */
const FINAL_SETTLEMENT_STATUSES = new Set(["completed", "refunded", "rolled_over"]);

/**
 * Derive the Unlimited result-state the frontend should render.
 *
 * Never returns "results_ready" from the viewer's own local end time alone —
 * only the global `challengeStatus`/`settlementStatus` pair (backend-authoritative,
 * only flipped by `settleUnlimitedChallenge` after EVERY participant is done)
 * can produce that state.
 */
export function resolveUnlimitedResultStatus(
  input: UnlimitedResultStatusInput,
): UnlimitedChallengeResultStatus {
  const status = (input.challengeStatus ?? "").trim().toLowerCase();
  const settlement = (input.settlementStatus ?? "").trim().toLowerCase();

  if (status === "cancelled_by_platform" || status === "cancelled" || status === "canceled") {
    // A platform cancellation is itself a final (non-monetary) outcome — never
    // strand the participant on an infinite "waiting for others" screen.
    return "results_ready";
  }

  if (status === "completed") {
    if (FINAL_SETTLEMENT_STATUSES.has(settlement)) return "results_ready";
    // "" / "pending" / "in_progress" / "manual_review" / unknown → still validating.
    return "steps_validation_in_progress";
  }

  if (status === "settling") {
    return "steps_validation_in_progress";
  }

  // waiting | starting | active | "" (unknown) — the GLOBAL challenge has not
  // finished. Only the viewer's OWN completion decides in_progress vs waiting.
  return input.viewerPersonallyFinished ? "waiting_for_participants" : "challenge_in_progress";
}

// ── Prize-pool eligibility (spec §8) ──────────────────────────────────────────

export type PrizePoolEligibilityStatus = "pending" | "eligible" | "not_eligible";

export interface PrizePoolEligibilityInput {
  resultStatus: UnlimitedChallengeResultStatus;
  /** Backend participant.qualificationStatus: active|goal_completed_today|pending_verification|disqualified|left|qualified. */
  qualificationStatus: string | null | undefined;
}

/**
 * Backend only ever writes `qualified` (settlement winner) or `disqualified`
 * (day-finalize failure) — see Backend/src/lib/unlimitedChallengeJobs.ts:150-158
 * and unlimitedChallengeSettlement.ts:160-163. Everything else is "pending"
 * until settlement, except once results are final: a participant left in
 * `active`/`left` at that point was never flipped to `qualified`, i.e. they
 * did not win, so it is safe to show `not_eligible` (never a frontend guess —
 * simply "backend did not mark you a winner").
 */
export function resolvePrizePoolEligibilityStatus(
  input: PrizePoolEligibilityInput,
): PrizePoolEligibilityStatus {
  const q = (input.qualificationStatus ?? "").trim().toLowerCase();
  if (q === "disqualified") return "not_eligible";
  if (q === "qualified") return "eligible";
  if (input.resultStatus === "results_ready") return "not_eligible";
  return "pending";
}

/** Results-screen label (spec §8, §16-18). */
export function prizePoolEligibilityLabel(status: PrizePoolEligibilityStatus): string {
  switch (status) {
    case "eligible":
      return "Prize Pool Eligible";
    case "not_eligible":
      return "Prize Pool Not Eligible";
    default:
      return "Eligibility Pending";
  }
}

/** Feather icon name paired with each eligibility state (spec §8 "Optional icons"). */
export function prizePoolEligibilityIcon(
  status: PrizePoolEligibilityStatus,
): "clock" | "check-circle" | "x-circle" {
  switch (status) {
    case "eligible":
      return "check-circle";
    case "not_eligible":
      return "x-circle";
    default:
      return "clock";
  }
}

/**
 * In-progress / current-day-card label (spec §15) — deliberately distinct
 * wording from the Results screen ("Still Eligible" vs "Eligibility Pending"),
 * since the challenge itself isn't settled yet.
 */
export function liveEligibilityLabel(status: PrizePoolEligibilityStatus): string {
  switch (status) {
    case "not_eligible":
      return "Prize Eligibility Lost";
    default:
      return "Still Eligible";
  }
}

// ── Results-screen copy blocks (spec §16-18, §24) ─────────────────────────────

export interface UnlimitedResultsCopy {
  title: string;
  statusHeadline: string;
  message: string;
  secondaryText: string | null;
}

export function resultsScreenCopy(status: UnlimitedChallengeResultStatus): UnlimitedResultsCopy {
  switch (status) {
    case "waiting_for_participants":
      return {
        title: "Challenge Complete",
        statusHeadline: "Waiting for all participants",
        message:
          "Your challenge is complete. Some participants are still finishing the race in their local time zones.",
        secondaryText:
          "Final prize-pool results will be available after every participant finishes and all daily steps are verified.",
      };
    case "steps_validation_in_progress":
      return {
        title: "Challenge Results",
        statusHeadline: "Steps Validation in Progress",
        message:
          "All participants have completed the challenge. We're validating daily step records before finalizing prize-pool eligibility.",
        secondaryText: "Results will be announced soon.",
      };
    case "results_ready":
      return {
        title: "Challenge Results",
        statusHeadline: "Steps Validation Completed",
        message:
          "All participant step records have been validated. Check your prize-pool eligibility and final challenge results.",
        secondaryText: null,
      };
    default:
      return {
        title: "Challenge Results",
        statusHeadline: "Challenge In Progress",
        message: "Your daily challenge is still active.",
        secondaryText: null,
      };
  }
}

/** Final-state per-participant message (spec §7). Never implies a technical failure. */
export function finalEligibilityMessage(status: PrizePoolEligibilityStatus): string {
  if (status === "eligible") {
    return "Congratulations! You completed the required daily step goal for every challenge day.";
  }
  if (status === "not_eligible") {
    return "You missed the required daily step goal on one or more challenge days.";
  }
  return "Your final eligibility will be confirmed shortly.";
}

// ── Notification copy (spec §24) — never claims a win before settlement. ──────

export function resultStatusNotificationBody(status: UnlimitedChallengeResultStatus): string | null {
  switch (status) {
    case "waiting_for_participants":
      return "Challenge complete — waiting for other participants.";
    case "steps_validation_in_progress":
      return "Step validation is in progress.";
    case "results_ready":
      return "Challenge results are ready. Check your prize-pool eligibility.";
    default:
      return null;
  }
}

// ── Walk-tab result card state (spec §25) ─────────────────────────────────────

export type UnlimitedResultCardState = "results_pending" | "validation_in_progress" | "view_results";

export function resolveUnlimitedResultCardState(
  status: UnlimitedChallengeResultStatus,
): UnlimitedResultCardState | null {
  switch (status) {
    case "waiting_for_participants":
      return "results_pending";
    case "steps_validation_in_progress":
      return "validation_in_progress";
    case "results_ready":
      return "view_results";
    default:
      return null;
  }
}

export function unlimitedResultCardCopy(state: UnlimitedResultCardState): {
  title: string;
  subtitle: string;
} {
  switch (state) {
    case "results_pending":
      return { title: "Results Pending", subtitle: "Waiting for all participants and step validation." };
    case "validation_in_progress":
      return { title: "Validation in Progress", subtitle: "Daily steps are being verified." };
    case "view_results":
      return { title: "View Results", subtitle: "Prize-pool results are ready." };
  }
}
