/**
 * Subtle top-three + current-user rank styling for Live Race participant cards.
 * Keeps gold/silver/bronze markers when the current user is also in top 3.
 */

export const RANK_GOLD = "#FFD700";
export const RANK_SILVER = "#C0C0C0";
export const RANK_BRONZE = "#CD7F32";
export const RANK_CURRENT_USER_GREEN = "#00E676";
/** Ranks 4+ on the Race Track use white (top three keep medal colors). */
export const RANK_TRACK_DEFAULT = "#FFFFFF";

export function getTopThreeRankAccent(rank: number): string | null {
  if (rank === 1) return RANK_GOLD;
  if (rank === 2) return RANK_SILVER;
  if (rank === 3) return RANK_BRONZE;
  return null;
}

/** Race Track avatar / badge accent: gold/silver/bronze for 1–3, white for 4+. */
export function getLiveRaceTrackAccent(rank: number): string {
  return getTopThreeRankAccent(rank) ?? RANK_TRACK_DEFAULT;
}

export function getRankAccessibilityLabel(
  rank: number,
  opts?: { isCurrentUser?: boolean },
): string {
  const base =
    rank === 1
      ? "Rank 1, gold position"
      : rank === 2
        ? "Rank 2, silver position"
        : rank === 3
          ? "Rank 3, bronze position"
          : `Rank ${rank}`;
  return opts?.isCurrentUser ? `${base}, you` : base;
}

/** Outer border for the row/card: green for current user wins over medal border. */
export function getParticipantRowBorderColor(
  rank: number,
  isCurrentUser: boolean,
  fallback: string = "transparent",
): string {
  if (isCurrentUser) return RANK_CURRENT_USER_GREEN;
  return getTopThreeRankAccent(rank) ?? fallback;
}

/** Rank badge fill/border — medal colors for 1–3, muted otherwise. */
export function getRankBadgeColors(
  rank: number,
  mutedForeground: string,
): { accent: string; label: string } {
  const accent = getTopThreeRankAccent(rank);
  if (accent) return { accent, label: accent };
  return { accent: mutedForeground, label: mutedForeground };
}
