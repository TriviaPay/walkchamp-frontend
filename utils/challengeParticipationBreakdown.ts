/**
 * Challenge Participation Breakdown — display helpers only.
 * Counts and percentages come from the backend. Do not derive them from
 * challengeHistory, racesPlayed, or local race results.
 */

export type ChallengeParticipationKey =
  | "free"
  | "coins"
  | "topFinishers"
  | "sponsoredEvents"
  | "streakChallenge";

export type ChallengeParticipationTypeStats = {
  count: number;
  percentage: number;
};

export type ChallengeParticipationBreakdown = {
  totalParticipatedChallenges: number;
  byType: {
    free: ChallengeParticipationTypeStats;
    coins: ChallengeParticipationTypeStats;
    topFinishers: ChallengeParticipationTypeStats;
    sponsoredEvents: ChallengeParticipationTypeStats;
    streakChallenge: ChallengeParticipationTypeStats;
  };
};

export const CHALLENGE_PARTICIPATION_KEYS: readonly ChallengeParticipationKey[] = [
  "free",
  "coins",
  "topFinishers",
  "sponsoredEvents",
  "streakChallenge",
] as const;

export const CHALLENGE_PARTICIPATION_ROWS = [
  {
    key: "free",
    label: "Free",
    icon: "users",
    a11yName: "Free challenges",
    color: "#10B981",
  },
  {
    key: "coins",
    label: "Coins",
    icon: "circle",
    a11yName: "Coins challenges",
    color: "#06B6D4",
  },
  {
    key: "topFinishers",
    label: "Top Finishers",
    icon: "award",
    a11yName: "Top Finishers challenges",
    color: "#3B82F6",
  },
  {
    key: "sponsoredEvents",
    label: "Sponsored Events",
    icon: "gift",
    a11yName: "Sponsored Events",
    color: "#EC4899",
  },
  {
    key: "streakChallenge",
    label: "Streak Challenge",
    icon: "zap",
    a11yName: "Streak Challenges",
    color: "#8B5CF6",
  },
] as const;

export type ChallengeParticipationRowMeta =
  (typeof CHALLENGE_PARTICIPATION_ROWS)[number];

export type ChallengeParticipationDisplayRow = ChallengeParticipationRowMeta & {
  count: number;
  percentage: number;
  formattedPercentage: string;
  barWidthPercent: number;
};

export function formatPercentage(value: number): string {
  if (!Number.isFinite(value)) return "0%";

  const safeValue = Math.max(0, Math.min(100, value));

  return `${safeValue.toLocaleString(undefined, {
    maximumFractionDigits: 2,
  })}%`;
}

export function clampPercentageBar(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value));
}

export function formatTotalParticipatedLabel(total: number): string {
  if (!Number.isFinite(total) || total < 0) return "0 Challenges Participated";
  const safe = Math.floor(total);
  return safe === 1 ? "1 Challenge Participated" : `${safe} Challenges Participated`;
}

export function formatZeroParticipationLabel(): string {
  return "No challenges participated yet";
}

export function statsHasBreakdownField(stats: unknown): boolean {
  return (
    !!stats &&
    typeof stats === "object" &&
    Object.prototype.hasOwnProperty.call(stats, "challengeParticipationBreakdown")
  );
}

function parseTypeStats(raw: unknown): ChallengeParticipationTypeStats | null {
  if (!raw || typeof raw !== "object") return null;
  const count = Number((raw as { count?: unknown }).count);
  const percentage = Number((raw as { percentage?: unknown }).percentage);
  if (!Number.isFinite(count) || count < 0) return null;
  if (!Number.isFinite(percentage)) return null;
  return {
    count: Math.floor(count),
    percentage,
  };
}

/**
 * Returns a parsed breakdown, or `undefined` when the field is missing/malformed.
 * A valid object with total `0` is kept — that is real zero participation.
 */
export function parseChallengeParticipationBreakdown(
  raw: unknown,
): ChallengeParticipationBreakdown | undefined {
  if (raw == null || typeof raw !== "object") return undefined;

  const total = Number(
    (raw as { totalParticipatedChallenges?: unknown }).totalParticipatedChallenges,
  );
  const byType = (raw as { byType?: unknown }).byType;
  if (!Number.isFinite(total) || total < 0 || !byType || typeof byType !== "object") {
    return undefined;
  }

  const parsed = {} as ChallengeParticipationBreakdown["byType"];
  for (const key of CHALLENGE_PARTICIPATION_KEYS) {
    const row = parseTypeStats((byType as Record<string, unknown>)[key]);
    if (!row) return undefined;
    parsed[key] = row;
  }

  return {
    totalParticipatedChallenges: Math.floor(total),
    byType: parsed,
  };
}

/** Keep the previous result unless the incoming stats object includes the field. */
export function applyIncomingBreakdown(
  incomingStats: unknown,
  previous: ChallengeParticipationBreakdown | undefined,
): ChallengeParticipationBreakdown | undefined {
  if (!statsHasBreakdownField(incomingStats)) return previous;
  return parseChallengeParticipationBreakdown(
    (incomingStats as { challengeParticipationBreakdown?: unknown })
      .challengeParticipationBreakdown,
  );
}

/** `GET /api/profile/me` and `GET /api/profile/public/:username` → `response.data.stats`. */
export function extractBreakdownFromProfileMePayload(
  json: unknown,
): ChallengeParticipationBreakdown | undefined {
  if (!json || typeof json !== "object") return undefined;
  const data = (json as { data?: { stats?: unknown } }).data;
  const stats = data?.stats ?? (json as { stats?: unknown }).stats;
  return parseChallengeParticipationBreakdown(
    stats && typeof stats === "object"
      ? (stats as { challengeParticipationBreakdown?: unknown }).challengeParticipationBreakdown
      : undefined,
  );
}

/** `GET /api/users/:userId/public-profile` → `response.stats`. */
export function extractBreakdownFromPublicUserPayload(
  json: unknown,
): ChallengeParticipationBreakdown | undefined {
  if (!json || typeof json !== "object") return undefined;
  const stats = (json as { stats?: unknown }).stats;
  return parseChallengeParticipationBreakdown(
    stats && typeof stats === "object"
      ? (stats as { challengeParticipationBreakdown?: unknown }).challengeParticipationBreakdown
      : undefined,
  );
}

export function buildChallengeParticipationDisplayRows(
  breakdown: ChallengeParticipationBreakdown,
): ChallengeParticipationDisplayRow[] {
  return CHALLENGE_PARTICIPATION_ROWS.map((meta) => {
    const stats = breakdown.byType[meta.key];
    return {
      ...meta,
      count: stats.count,
      percentage: stats.percentage,
      formattedPercentage: formatPercentage(stats.percentage),
      barWidthPercent: clampPercentageBar(stats.percentage),
    };
  });
}

export function sectionAccessibilityLabel(
  breakdown: ChallengeParticipationBreakdown,
): string {
  if (breakdown.totalParticipatedChallenges === 0) {
    return "Challenge participation breakdown. No challenges participated yet.";
  }
  const total = breakdown.totalParticipatedChallenges;
  const noun = total === 1 ? "challenge" : "challenges";
  return `Challenge participation breakdown. ${total} ${noun} participated.`;
}

export function rowAccessibilityLabel(row: ChallengeParticipationDisplayRow): string {
  const spokenPct = formatPercentage(row.percentage).replace("%", " percent");
  return `${row.a11yName}. ${row.count} participated. ${spokenPct}.`;
}

export function shouldRenderBreakdownSection(opts: {
  loading: boolean;
  breakdown: ChallengeParticipationBreakdown | undefined;
}): "skeleton" | "hide" | "show" {
  if (opts.loading && opts.breakdown === undefined) return "skeleton";
  if (opts.breakdown === undefined) return "hide";
  return "show";
}
