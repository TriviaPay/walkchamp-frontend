/**
 * Streak timezone-change + final-result stage helpers (backend-driven).
 * Pure — safe for npx tsx tests.
 */

import type { UnlimitedChallengeResultStatus } from "./unlimitedResults";

export type TimezoneChangeModalStage =
  | "detect"
  | "updated"
  | "final_day_locked";

export type UnlimitedTimezoneSnapshot = {
  challengeId: string;
  /** Backend current-day / viewer timezone (do not recalculate locally). */
  viewerTimezone: string | null;
  accountTimezone?: string | null;
  pendingTimezone?: string | null;
  timezoneEffectiveDay?: number | null;
  timezoneChangeAppliesToChallenge?: boolean | null;
  finalDayTimezoneLocked?: boolean | null;
  currentDayIndex?: number | null;
  challengeDurationDays?: number | null;
  challengeStatus?: string | null;
  viewerStatus?: string | null;
};

/** True when device IANA differs from the challenge's current-day timezone. */
export function deviceTimezoneDiffersFromChallenge(
  deviceTimezone: string,
  viewerTimezone: string | null | undefined,
): boolean {
  const device = (deviceTimezone ?? "").trim();
  const viewer = (viewerTimezone ?? "").trim();
  if (!device || !viewer) return false;
  return device !== viewer;
}

/** Banner above tab bar when a change is detected but not yet confirmed for this device TZ. */
export function shouldShowTimezoneDetectBanner(
  snap: UnlimitedTimezoneSnapshot,
  deviceTimezone: string,
): boolean {
  const status = (snap.challengeStatus ?? "").toLowerCase();
  if (status && !["active", "waiting", "starting", "open"].includes(status)) {
    // Still allow while active viewer schedule exists.
    if (status === "completed" || status === "cancelled" || status === "canceled") return false;
  }
  const viewer = snap.viewerTimezone;
  if (!deviceTimezoneDiffersFromChallenge(deviceTimezone, viewer)) return false;
  // Already confirmed this device TZ as pending for a future day — use transition banner instead.
  if (
    snap.pendingTimezone &&
    snap.pendingTimezone === deviceTimezone.trim() &&
    snap.timezoneChangeAppliesToChallenge === true
  ) {
    return false;
  }
  return true;
}

/** In-race / detail transition banner after a confirmed future-day change. */
export function shouldShowTimezoneTransitionBanner(
  snap: UnlimitedTimezoneSnapshot,
): boolean {
  if (snap.timezoneChangeAppliesToChallenge !== true) return false;
  const pending = (snap.pendingTimezone ?? "").trim();
  const viewer = (snap.viewerTimezone ?? "").trim();
  if (!pending || !viewer) return false;
  return pending !== viewer;
}

export function nextChallengeDayGuess(snap: UnlimitedTimezoneSnapshot): number {
  const current =
    typeof snap.currentDayIndex === "number" && snap.currentDayIndex > 0
      ? snap.currentDayIndex
      : 1;
  const duration =
    typeof snap.challengeDurationDays === "number" && snap.challengeDurationDays > 0
      ? snap.challengeDurationDays
      : current + 1;
  return Math.min(current + 1, duration + 1);
}

// ── Progressive final-result stages (Image 4) ─────────────────────────────────

export type UnlimitedFinalResultStageId =
  | "final_day_completed"
  | "final_results_pending"
  | "verifying_final_results"
  | "results_ready"
  | "challenge_completed";

export type UnlimitedFinalResultStage = {
  id: UnlimitedFinalResultStageId;
  title: string;
  description: string;
  accent: string;
  border: string;
  icon: "flag" | "hourglass" | "search" | "check" | "trophy";
};

export const UNLIMITED_FINAL_RESULT_STAGES: Record<
  UnlimitedFinalResultStageId,
  Omit<UnlimitedFinalResultStage, "id">
> = {
  final_day_completed: {
    title: "Final Day Completed",
    description: "Waiting for all participants to finish their challenge day.",
    accent: "#3B82F6",
    border: "rgba(59,130,246,0.65)",
    icon: "flag",
  },
  final_results_pending: {
    title: "Final Results Pending",
    description: "We're waiting for all participants' challenge days to finish.",
    accent: "#FBBF24",
    border: "rgba(251,191,36,0.65)",
    icon: "hourglass",
  },
  verifying_final_results: {
    title: "Verifying Final Results",
    description: "We're verifying the final activity for all participants.",
    accent: "#A78BFA",
    border: "rgba(167,139,250,0.7)",
    icon: "search",
  },
  results_ready: {
    title: "Results Ready",
    description: "Final results are ready! Preparing leaderboard.",
    accent: "#00E676",
    border: "rgba(0,230,118,0.7)",
    icon: "check",
  },
  challenge_completed: {
    title: "Challenge Completed",
    description: "Here are the final results! Congrats to all!",
    accent: "#F59E0B",
    border: "rgba(245,158,11,0.75)",
    icon: "trophy",
  },
};

/**
 * Resolve which progressive stages to show (all stages up through current).
 * Driven by backend resultsStatus + viewer finish + final-verification status.
 */
export function resolveUnlimitedFinalResultStages(input: {
  resultStatus: UnlimitedChallengeResultStatus;
  viewerPersonallyFinished: boolean;
  finalVerificationStatus?: string | null;
  /** When results screen is showing final leaderboard / eligibility. */
  showingFinalResults?: boolean;
  /** Backend says viewer is past live daily racing — always surface a pending stage. */
  pastLivePhase?: boolean;
  registeredParticipantCount?: number | null;
  participantsFinishedCount?: number | null;
  participantsPendingCount?: number | null;
  pendingOpponentLabel?: string | null;
}): UnlimitedFinalResultStage[] {
  const fv = (input.finalVerificationStatus ?? "").trim().toLowerCase();
  const verifying =
    input.resultStatus === "steps_validation_in_progress" ||
    fv === "requested" ||
    fv === "submitted";

  const pending = input.participantsPendingCount;
  const registered = input.registeredParticipantCount;
  const finished = input.participantsFinishedCount;
  const opponent = (input.pendingOpponentLabel ?? "").trim();
  const allOthersDone =
    typeof pending === "number"
      ? pending <= 0
      : typeof registered === "number" &&
        typeof finished === "number" &&
        registered > 0 &&
        finished >= registered;

  const waitingDescription = (): string => {
    if (allOthersDone) {
      return "All participants finished. Preparing final verification.";
    }
    if (opponent && typeof pending === "number" && pending === 1) {
      return `Waiting for ${opponent} to finish their challenge.`;
    }
    if (
      typeof finished === "number" &&
      typeof registered === "number" &&
      registered > 0
    ) {
      const still = typeof pending === "number" ? pending : Math.max(0, registered - finished);
      if (still === 1 && registered === 2) {
        return opponent
          ? `Waiting for ${opponent} to finish their final day.`
          : "Waiting for your opponent to finish their final day.";
      }
      return `${finished} of ${registered} participants finished — ${still} still in progress.`;
    }
    return UNLIMITED_FINAL_RESULT_STAGES.final_results_pending.description;
  };

  const finalDayDescription = (): string => {
    if (allOthersDone) {
      return "All participants finished. Final results are being prepared.";
    }
    if (opponent && typeof pending === "number" && pending === 1) {
      return `You finished your final day. Waiting for ${opponent} to complete theirs.`;
    }
    if (
      typeof finished === "number" &&
      typeof registered === "number" &&
      registered > 0 &&
      typeof pending === "number" &&
      pending === 1 &&
      registered === 2
    ) {
      return opponent
        ? `You finished your final day. Waiting for ${opponent} to complete theirs.`
        : "You finished your final day. Waiting for your opponent to complete theirs.";
    }
    return UNLIMITED_FINAL_RESULT_STAGES.final_day_completed.description;
  };

  let current: UnlimitedFinalResultStageId | null = null;

  if (input.resultStatus === "results_ready") {
    current = input.showingFinalResults ? "challenge_completed" : "results_ready";
  } else if (verifying || allOthersDone) {
    current = "verifying_final_results";
  } else if (input.resultStatus === "waiting_for_participants") {
    current = "final_results_pending";
  } else if (input.viewerPersonallyFinished || input.pastLivePhase) {
    current = input.pastLivePhase ? "final_results_pending" : "final_day_completed";
  }

  if (!current) return [];

  const order: UnlimitedFinalResultStageId[] = [
    "final_day_completed",
    "final_results_pending",
    "verifying_final_results",
    "results_ready",
    "challenge_completed",
  ];
  const idx = order.indexOf(current);
  return order.slice(0, idx + 1).map((id) => {
    const base = { id, ...UNLIMITED_FINAL_RESULT_STAGES[id] };
    if (id === "final_day_completed" && current === "final_day_completed") {
      return { ...base, description: finalDayDescription() };
    }
    if (id === "final_results_pending" && current === "final_results_pending") {
      return { ...base, description: waitingDescription() };
    }
    return base;
  });
}
