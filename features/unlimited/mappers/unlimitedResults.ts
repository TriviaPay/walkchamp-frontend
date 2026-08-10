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
 * Prefer backend `resultsStatus` when present. Otherwise derive from
 * `challenge.status` + `settlementStatus` + the viewer's personal finish
 * (viewerStatus) — never treat global `status` alone as final results.
 */

// ── Result state model (spec §3) ──────────────────────────────────────────────

export type UnlimitedChallengeResultStatus =
  | "challenge_in_progress"
  | "waiting_for_participants"
  | "steps_validation_in_progress"
  | "results_ready";

export interface UnlimitedResultStatusInput {
  /** Backend `challenge.resultsStatus` when present — preferred over status/settlement. */
  resultsStatus?: string | null | undefined;
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

/** Map backend resultsStatus vocabulary onto the FE result-state model. */
export function normalizeBackendResultsStatus(
  raw: string | null | undefined,
): UnlimitedChallengeResultStatus | null {
  const s = (raw ?? "").trim().toLowerCase();
  if (!s) return null;
  if (s === "results_ready") return "results_ready";
  if (s === "waiting_for_participants") return "waiting_for_participants";
  if (s === "steps_validation_in_progress") return "steps_validation_in_progress";
  // Backend uses `in_progress` while FE copy uses `challenge_in_progress`.
  if (s === "in_progress" || s === "challenge_in_progress") return "challenge_in_progress";
  return null;
}

/**
 * Derive the Unlimited result-state the frontend should render.
 *
 * Prefer `resultsStatus` from the backend. Fallback never returns "results_ready"
 * from the viewer's own local end time alone — only global settlement / results_ready.
 */
export function resolveUnlimitedResultStatus(
  input: UnlimitedResultStatusInput,
): UnlimitedChallengeResultStatus {
  const fromBackend = normalizeBackendResultsStatus(input.resultsStatus);
  if (fromBackend) {
    // Backend may still say in_progress while this viewer personally finished —
    // show "waiting for others" so we don't keep the live racing chrome.
    if (fromBackend === "challenge_in_progress" && input.viewerPersonallyFinished) {
      return "waiting_for_participants";
    }
    return fromBackend;
  }

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
  /** Backend participant.prizePoolEligibilityStatus when present (pending|eligible|not_eligible). */
  prizePoolEligibilityStatus?: string | null | undefined;
}

/**
 * Prefer backend `prizePoolEligibilityStatus` when set. Otherwise derive from
 * qualificationStatus + resultStatus (qualified/disqualified/results_ready).
 */
export function resolvePrizePoolEligibilityStatus(
  input: PrizePoolEligibilityInput,
): PrizePoolEligibilityStatus {
  const q = (input.qualificationStatus ?? "").trim().toLowerCase();
  // Terminal membership always wins over a stale pending eligibility field.
  if (q === "disqualified") return "not_eligible";
  if (q === "qualified") return "eligible";
  const fromBackend = (input.prizePoolEligibilityStatus ?? "").trim().toLowerCase();
  if (fromBackend === "eligible" || fromBackend === "not_eligible" || fromBackend === "pending") {
    return fromBackend;
  }
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

export function resultsScreenCopy(
  status: UnlimitedChallengeResultStatus,
  counters?: {
    registeredParticipantCount?: number | null;
    participantsFinishedCount?: number | null;
    participantsPendingCount?: number | null;
  },
): UnlimitedResultsCopy {
  switch (status) {
    case "waiting_for_participants": {
      const pending = counters?.participantsPendingCount;
      const finished = counters?.participantsFinishedCount;
      const registered = counters?.registeredParticipantCount;
      const countLine =
        typeof pending === "number" && pending >= 0 && typeof registered === "number" && registered > 0
          ? `${finished ?? Math.max(0, registered - pending)} of ${registered} participants finished — ${pending} still in their local timezone.`
          : null;
      return {
        title: "Challenge Complete",
        statusHeadline: "Waiting for all participants",
        message:
          countLine ??
          "Your challenge is complete. Some participants are still finishing the race in their local time zones.",
        secondaryText:
          "Final prize-pool results will be available after every participant finishes and all daily steps are verified.",
      };
    }
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
