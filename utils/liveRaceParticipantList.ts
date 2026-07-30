/**
 * Shared Live Race participant list helpers.
 * Used by Race Track (top 10), right panel, and Live Board for all race types.
 */

export const LIVE_RACE_TRACK_TOP_N = 10;

/** Known ghost / system host display names excluded from race participant UIs. */
const GHOST_HOST_NAME_RE =
  /^(walk\s*champ\s*admin|walkchamp\s*admin|system\s*host|ghost\s*host)$/i;

export type RaceListParticipantLike = {
  id?: string | null;
  userId?: string | null;
  username?: string | null;
  displayName?: string | null;
  currentSteps?: number | null;
  rank?: number | null;
  status?: string | null;
  isHost?: boolean | null;
  isGhost?: boolean | null;
  isSystemHost?: boolean | null;
  isGhostHost?: boolean | null;
};

export function isGhostOrSystemHost(p: RaceListParticipantLike): boolean {
  if (p.isGhost === true || p.isSystemHost === true || p.isGhostHost === true) {
    return true;
  }
  const name = (p.username ?? p.displayName ?? "").trim();
  return name.length > 0 && GHOST_HOST_NAME_RE.test(name);
}

export function isIneligibleRaceParticipant(p: RaceListParticipantLike): boolean {
  const status = (p.status ?? "").toLowerCase();
  return (
    status === "left" ||
    status === "disqualified" ||
    status === "dq" ||
    status === "ineligible" ||
    status === "removed"
  );
}

/** Participants eligible for track / leaderboard lists (excludes ghost host + left/DQ). */
export function filterRaceParticipantsForDisplay<T extends RaceListParticipantLike>(
  participants: T[],
): T[] {
  return participants.filter(
    (p) => !isGhostOrSystemHost(p) && !isIneligibleRaceParticipant(p),
  );
}

export function sortParticipantsByLiveSteps<T extends { steps: number; id: string }>(
  rows: T[],
): T[] {
  return [...rows].sort((a, b) => {
    if (b.steps !== a.steps) return b.steps - a.steps;
    return a.id.localeCompare(b.id);
  });
}

/**
 * Authoritative top-N for the animated Race Track background.
 * Does not mutate input. Stable IDs should be used as React keys by callers.
 */
export function selectTopParticipantsForRaceTrack<T extends { steps: number; id: string }>(
  sortedByStepsDesc: T[],
  topN: number = LIVE_RACE_TRACK_TOP_N,
): T[] {
  if (topN <= 0) return [];
  return sortedByStepsDesc.slice(0, topN);
}

/** Prefer backend rank when present; otherwise 1-based index in sorted list. */
export function resolveDisplayRank(
  backendRank: number | null | undefined,
  sortedIndex: number,
): number {
  if (backendRank != null && backendRank > 0) return backendRank;
  return sortedIndex + 1;
}
