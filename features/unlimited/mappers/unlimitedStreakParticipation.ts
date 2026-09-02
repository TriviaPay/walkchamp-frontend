/**
 * Streak (unlimited_goal) participation vs prize eligibility.
 * Missed-day / prize-ineligible users stay on the live roster until they
 * manually leave or forfeit. Classic races keep their own DQ = out rules.
 */

import { canPublishFinalResult, normalizeBackendResultsStatus } from "./unlimitedResults";
import type { FinalResultStatus } from "./unlimitedFinalFlow";

export const STREAK_REMOVED_STATUSES = new Set([
  "left",
  "forfeited",
  "withdrawn",
  "withdrew",
  "quit",
  "removed",
  "cancelled",
  "canceled",
  "refunded",
]);

export function isStreakChallengeKind(opts?: {
  challengeType?: string | null;
  capacityMode?: string | null;
  entryType?: string | null;
}): boolean {
  const type = String(opts?.challengeType ?? "").trim().toLowerCase();
  const cap = String(opts?.capacityMode ?? "").trim().toLowerCase();
  const entry = String(opts?.entryType ?? "").trim().toLowerCase();
  return type === "unlimited_goal" || cap === "unlimited" || entry === "unlimited_goal";
}

export function isStreakManualLeaveStatus(status: string | null | undefined): boolean {
  return STREAK_REMOVED_STATUSES.has((status ?? "").trim().toLowerCase());
}

export type StreakViewerResultInput = {
  viewerResultsReady?: boolean | null;
  viewerResultReasonCode?: string | null;
  viewerStatus?: string | null;
  resultsStatus?: string | null;
  failedDays?: number | null;
  eligibilityReasonCode?: string | null;
  finalVerificationStatus?: string | null;
  /** Backend viewer block — personal window ended, last day(s) still verifying. */
  verificationPending?: boolean | null;
};

export function isViewerStreakBroken(input: StreakViewerResultInput): boolean {
  const reason = (input.viewerResultReasonCode ?? input.eligibilityReasonCode ?? "")
    .trim()
    .toLowerCase();
  if (reason === "daily_goal_missed") return true;
  if (input.viewerResultsReady === true && reason === "daily_goal_missed") return true;
  if ((input.viewerStatus ?? "").trim().toLowerCase() === "failed") return true;
  return (input.failedDays ?? 0) > 0;
}

export type StreakDetailUiBranch = "broken" | "final" | "live" | "pending_settlement";

export type UnlimitedPastLiveInput = StreakViewerResultInput & {
  viewerEndAt?: string | null;
  challengeStatus?: string | null;
  completedDays?: number | null;
  durationDays?: number | null;
  /** Viewer locked-timezone end (ms) — from backend viewerEndAt or schedule math. */
  viewerEndAtMs?: number | null;
  /** Backend final-result flow — when set, viewer is past live daily racing. */
  finalFlowStatus?: string | null;
  finalResultStatus?: FinalResultStatus | string | null;
};

export function buildUnlimitedPastLiveInput(
  race: {
    viewerResultsReady?: boolean | null;
    viewerResultReasonCode?: string | null;
    viewerStatus?: string | null;
    resultsStatus?: string | null;
    finalVerificationStatus?: string | null;
    viewerEndAt?: string | null;
    rawStatus?: string | null;
    status?: string | null;
    verificationPending?: boolean | null;
    completedDays?: number | null;
    passedDays?: number | null;
    challengeDurationDays?: number | null;
    finalFlowStatus?: string | null;
    finalResultStatus?: string | null;
  },
  opts?: {
    finalVerificationStatus?: string | null;
    viewerEndAtMs?: number | null;
  },
): UnlimitedPastLiveInput {
  return {
    viewerResultsReady: race.viewerResultsReady,
    viewerResultReasonCode: race.viewerResultReasonCode,
    viewerStatus: race.viewerStatus,
    resultsStatus: race.resultsStatus,
    finalVerificationStatus: opts?.finalVerificationStatus ?? race.finalVerificationStatus,
    viewerEndAt: race.viewerEndAt,
    challengeStatus: race.rawStatus ?? race.status,
    verificationPending: race.verificationPending,
    completedDays: race.completedDays ?? race.passedDays,
    durationDays: race.challengeDurationDays,
    viewerEndAtMs: opts?.viewerEndAtMs,
    finalFlowStatus: race.finalFlowStatus,
    finalResultStatus: race.finalResultStatus,
  };
}

/** True when the viewer is past live daily racing (backend contract — no device clock). */
export function isUnlimitedViewerPastLivePhase(input: UnlimitedPastLiveInput): boolean {
  if (input.finalResultStatus) return true;
  if (input.finalFlowStatus) return true;
  if (input.verificationPending === true) return true;
  if (input.viewerResultsReady === true) return true;
  const viewer = (input.viewerStatus ?? "").trim().toLowerCase();
  if (viewer === "completed" || viewer === "failed" || viewer === "left") return true;
  const verify = (input.finalVerificationStatus ?? "").trim().toLowerCase();
  if (verify === "requested" || verify === "submitted" || verify === "completed") return true;
  const challenge = (input.challengeStatus ?? "").trim().toLowerCase();
  if (challenge === "settling" || challenge === "completed") return true;
  const rs = normalizeBackendResultsStatus(input.resultsStatus ?? null);
  if (
    rs === "waiting_for_participants" ||
    rs === "steps_validation_in_progress" ||
    rs === "results_ready"
  ) {
    return true;
  }
  return false;
}

export type UnlimitedCardBadgeKind = "live" | "verifying" | "finished" | "waiting";

/** Live / Walk card badge — viewer-scoped when backend viewer fields are present. */
export function resolveUnlimitedCardBadge(
  input: UnlimitedPastLiveInput & { globalStatus?: string | null },
): { kind: UnlimitedCardBadgeKind; label: string } {
  const global = (input.challengeStatus ?? input.globalStatus ?? "").trim().toLowerCase();
  if (global === "completed" || global === "finished" || global === "ended") {
    return { kind: "finished", label: "FINISHED" };
  }
  if (isUnlimitedViewerPastLivePhase(input)) {
    return { kind: "verifying", label: "VERIFYING" };
  }
  const viewer = (input.viewerStatus ?? "").trim().toLowerCase();
  if (viewer === "scheduled" || global === "waiting") {
    return { kind: "waiting", label: "WAITING" };
  }
  return { kind: "live", label: "LIVE" };
}

/** My Race card phase when viewer fields are present on the room row. */
export function resolveUnlimitedNextRacePhase(input: {
  status?: string | null;
  viewerStatus?: string | null;
  verificationPending?: boolean | null;
  viewerEndAt?: string | null;
  resultsStatus?: string | null;
  viewerResultsReady?: boolean | null;
  completedDays?: number | null;
  challengeDurationDays?: number | null;
  finalFlowStatus?: string | null;
  finalResultStatus?: FinalResultStatus | string | null;
}): "racing" | "verifying" | null {
  if (
    input.viewerStatus == null &&
    input.verificationPending !== true &&
    input.viewerEndAt == null &&
    !input.finalFlowStatus &&
    !input.finalResultStatus
  ) {
    return null;
  }
  const badge = resolveUnlimitedCardBadge(
    buildUnlimitedPastLiveInput({
      viewerStatus: input.viewerStatus,
      verificationPending: input.verificationPending,
      viewerEndAt: input.viewerEndAt,
      resultsStatus: input.resultsStatus,
      viewerResultsReady: input.viewerResultsReady,
      completedDays: input.completedDays,
      rawStatus: input.status,
      challengeDurationDays: input.challengeDurationDays,
      finalFlowStatus: input.finalFlowStatus,
      finalResultStatus: input.finalResultStatus,
    }),
  );
  if (badge.kind === "verifying") return "verifying";
  if (badge.kind === "live") return "racing";
  return null;
}

/**
 * Recommended UI branch from the streak backend contract.
 * Winner/loser chrome only after global `results_ready`.
 */
export function resolveStreakDetailUiBranch(
  input: StreakViewerResultInput,
): StreakDetailUiBranch {
  const globalReady = canPublishFinalResult(input.resultsStatus);
  if (globalReady) {
    return isViewerStreakBroken(input) ? "broken" : "final";
  }
  if (input.verificationPending === true) return "pending_settlement";
  const viewer = (input.viewerStatus ?? "").trim().toLowerCase();
  const verify = (input.finalVerificationStatus ?? "").trim().toLowerCase();
  if (
    input.viewerResultsReady === true ||
    viewer === "completed" ||
    viewer === "failed" ||
    verify === "requested" ||
    verify === "submitted" ||
    verify === "completed"
  ) {
    return "pending_settlement";
  }
  return "live";
}
