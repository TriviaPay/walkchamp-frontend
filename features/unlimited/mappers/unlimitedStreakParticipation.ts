/**
 * Streak (unlimited_goal) participation vs prize eligibility.
 * Missed-day / prize-ineligible users stay on the live roster until they
 * manually leave or forfeit. Classic races keep their own DQ = out rules.
 */

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

/**
 * Recommended UI branch from the streak backend contract.
 * `live` = keep racing chrome. `broken` = personal failed result, challenge still running.
 * `final` = global or personal results_ready that is not a missed-day break.
 */
export function resolveStreakDetailUiBranch(
  input: StreakViewerResultInput,
): "broken" | "final" | "live" {
  const globalReady = (input.resultsStatus ?? "").trim().toLowerCase() === "results_ready";
  const ready = input.viewerResultsReady === true || globalReady;
  if (ready) {
    return isViewerStreakBroken(input) ? "broken" : "final";
  }
  if ((input.viewerStatus ?? "").trim().toLowerCase() === "failed") return "broken";
  return "live";
}
