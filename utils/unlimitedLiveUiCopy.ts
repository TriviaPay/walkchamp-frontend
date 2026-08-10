/**
 * Exact Unlimited Live Race copy bank (Images 1–3 + delayed results).
 * Pure helpers — safe for npx tsx tests.
 */

import type { UnlimitedDayRow } from "./unlimitedDayProgress";
import type { PrizePoolEligibilityStatus } from "./unlimitedResults";
import type { UnlimitedViewerSchedule } from "./unlimitedViewerSchedule";

export const UNLIMITED_COPY = {
  missADayOut: "Miss a day = out",
  prizePoolNotEligible: "Prize pool not eligible",
  lostAfterMiss: "Challenge lost after missing a required day.",
  modalWarning: "Miss any required day and you are out of the challenge.",
  modalInfoPrefix: "Only top 10 players appear on the race track; full rankings are available in ",
  modalInfoHighlight: "Live Board",
  modalCta: "Let's go!",
  modalTitle: "Challenge Progress",
  /** Product display name (create flow, live race, modal brand). */
  challengeName: "Streak Challenge",
  challengeNamePlural: "Streak Challenges",
  modalBrand: "Streak Challenge",
  /** Badge when the viewer missed a required day (was "LOST"). */
  lostBadge: "Streak Broken",
  /** Live Board chip for a disqualified Unlimited participant. */
  lostChip: "Streak Broken",
  todayGoal: "Today Goal",
} as const;

/** Live / waiting titles: `Streak · 10,000 steps/day`. */
export function streakChallengeTitle(dailyGoalSteps: number): string {
  const n = Math.max(0, Math.floor(dailyGoalSteps));
  return `Streak · ${n > 0 ? n.toLocaleString() : "—"} steps/day`;
}

export function missedDayFooterCopy(missedDayIndex: number | null | undefined): string {
  if (typeof missedDayIndex === "number" && missedDayIndex > 0) {
    return `Missed Day ${missedDayIndex} • ${UNLIMITED_COPY.prizePoolNotEligible}`;
  }
  return UNLIMITED_COPY.prizePoolNotEligible;
}

/** First failed day from history, else inferred from schedule aggregates. */
export function resolveUnlimitedMissedDayIndex(params: {
  historyRows?: UnlimitedDayRow[] | null;
  schedule?: UnlimitedViewerSchedule | null;
  eligibility?: PrizePoolEligibilityStatus | null;
}): number | null {
  const rows = params.historyRows;
  if (Array.isArray(rows)) {
    const failed = rows.find((r) => r.status === "failed");
    if (failed) return failed.dayNumber;
  }
  const schedule = params.schedule;
  if (
    params.eligibility === "not_eligible" ||
    schedule?.viewerStatus === "failed"
  ) {
    if (schedule) {
      // First non-passed day after completedDays is the miss.
      const idx = Math.min(schedule.completedDays + 1, schedule.durationDays);
      return Math.max(1, idx);
    }
  }
  return null;
}

export function isUnlimitedPrizeLost(params: {
  eligibility?: PrizePoolEligibilityStatus | null;
  prizePoolEligibilityStatus?: string | null;
  qualificationStatus?: string | null;
  viewerStatus?: string | null;
}): boolean {
  if (params.eligibility === "not_eligible") return true;
  const pool = (params.prizePoolEligibilityStatus ?? "").trim().toLowerCase();
  if (pool === "not_eligible") return true;
  const q = (params.qualificationStatus ?? "").trim().toLowerCase();
  if (q === "disqualified") return true;
  const v = (params.viewerStatus ?? "").trim().toLowerCase();
  return v === "failed";
}
