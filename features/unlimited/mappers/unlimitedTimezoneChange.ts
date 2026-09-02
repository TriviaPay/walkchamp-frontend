/**
 * Streak timezone-change + final-result stage helpers (backend-driven).
 * Pure — safe for npx tsx tests.
 */

import {
  mapCanonicalFinalFlowToStageId,
  type FinalResultStatus,
  type RaceFinalStatus,
} from "./unlimitedFinalFlow";
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

/** True when device IANA changed since we last recorded it for this user. */
export function deviceTimezoneChangeDetected(
  deviceTimezone: string,
  lastObservedDeviceTimezone: string | null | undefined,
): boolean {
  const device = (deviceTimezone ?? "").trim();
  const lastObserved = (lastObservedDeviceTimezone ?? "").trim();
  if (!device || !lastObserved) return false;
  return device !== lastObserved;
}

/** Banner above tab bar when travel changes device TZ and it differs from the challenge day TZ. */
export function shouldShowTimezoneDetectBanner(
  snap: UnlimitedTimezoneSnapshot,
  deviceTimezone: string,
  lastObservedDeviceTimezone?: string | null,
): boolean {
  const status = (snap.challengeStatus ?? "").toLowerCase();
  if (status && !["active", "waiting", "starting", "open"].includes(status)) {
    // Still allow while active viewer schedule exists.
    if (status === "completed" || status === "cancelled" || status === "canceled") return false;
  }
  if (!deviceTimezoneChangeDetected(deviceTimezone, lastObservedDeviceTimezone)) {
    return false;
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

/**
 * Device TZ changed but now matches the challenge — no prompt; advance the baseline.
 */
export function shouldSilentlyAcknowledgeDeviceTimezone(
  deviceTimezone: string,
  lastObservedDeviceTimezone: string | null | undefined,
  viewerTimezone: string | null | undefined,
): boolean {
  if (!deviceTimezoneChangeDetected(deviceTimezone, lastObservedDeviceTimezone)) {
    return false;
  }
  return !deviceTimezoneDiffersFromChallenge(deviceTimezone, viewerTimezone);
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
  icon: "flag" | "hourglass" | "search" | "check" | "trophy" | "users";
  /** Tinted card background (final-result flow reference). */
  highlightBg?: string;
  /** Icon circle tint behind the stage glyph. */
  iconBg?: string;
};

export const UNLIMITED_FINAL_RESULT_STAGES: Record<
  UnlimitedFinalResultStageId,
  Omit<UnlimitedFinalResultStage, "id">
> = {
  final_day_completed: {
    title: "Final Day Completed",
    description: "Waiting for other participants to finish in their local time zones.",
    accent: "#38BDF8",
    border: "rgba(56,189,248,0.88)",
    icon: "flag",
    highlightBg: "rgba(8,36,58,0.96)",
    iconBg: "rgba(56,189,248,0.22)",
  },
  final_results_pending: {
    title: "Final Results Pending",
    description: "We're waiting for all participants' challenge days to finish.",
    accent: "#FACC15",
    border: "rgba(250,204,21,0.82)",
    icon: "users",
    highlightBg: "rgba(48,38,8,0.96)",
    iconBg: "rgba(250,204,21,0.2)",
  },
  verifying_final_results: {
    title: "Verifying Final Results",
    description: "We're verifying the final activity for all participants. This can take up to 4 hours.",
    accent: "#C084FC",
    border: "rgba(192,132,252,0.88)",
    icon: "search",
    highlightBg: "rgba(42,18,62,0.96)",
    iconBg: "rgba(192,132,252,0.22)",
  },
  results_ready: {
    title: "Results Ready",
    description: "Final results are ready! Preparing leaderboard.",
    accent: "#4ADE80",
    border: "rgba(74,222,128,0.88)",
    icon: "check",
    highlightBg: "rgba(8,48,32,0.96)",
    iconBg: "rgba(74,222,128,0.22)",
  },
  challenge_completed: {
    title: "Challenge Completed",
    description: "Here are the final results! Congrats to all!",
    accent: "#FB923C",
    border: "rgba(251,146,60,0.9)",
    icon: "trophy",
    highlightBg: "rgba(52,28,8,0.96)",
    iconBg: "rgba(251,146,60,0.22)",
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
  /** Backend viewer block — personal window ended, day(s) still verifying. */
  verificationPending?: boolean | null;
  finalResultStatus?: FinalResultStatus | string | null;
  raceFinalStatus?: RaceFinalStatus | string | null;
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

  const fromCanonical = mapCanonicalFinalFlowToStageId(
    (input.finalResultStatus as FinalResultStatus | null | undefined) ?? null,
    (input.raceFinalStatus as RaceFinalStatus | null | undefined) ?? null,
  );
  if (fromCanonical) {
    current = fromCanonical;
  } else if (input.verificationPending === true) {
    current = "verifying_final_results";
  } else if (input.resultStatus === "results_ready") {
    current = input.showingFinalResults ? "challenge_completed" : "results_ready";
  } else if (verifying || allOthersDone) {
    current = "verifying_final_results";
  } else if (input.resultStatus === "waiting_for_participants") {
    current = "final_day_completed";
  } else if (input.viewerPersonallyFinished || input.pastLivePhase) {
    current = "final_day_completed";
  }

  if (!current) return [];

  const order: UnlimitedFinalResultStageId[] = [
    "final_day_completed",
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
