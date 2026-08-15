/** Leaderboard memory/disk cache keys — must be user + category + filter scoped. */

export type LeaderboardMainTab = "global" | "regional" | "race" | "coins" | "groups";
export type LeaderboardStepsSubTab = "today" | "week" | "month" | "all_time" | "friends";
export type LeaderboardRaceSubTab = "all" | "free" | "paid_1" | "paid_3" | "paid_5";
export type LeaderboardGroupPeriod = "today" | "all_time";

export function leaderboardMemoryKey(opts: {
  userId?: string | null;
  mainTab: LeaderboardMainTab;
  stepsSubTab?: LeaderboardStepsSubTab;
  raceSubTab?: LeaderboardRaceSubTab;
  groupPeriod?: LeaderboardGroupPeriod;
  countryCode?: string | null;
}): string {
  const uid = String(opts.userId || "anon").trim() || "anon";
  if (opts.mainTab === "race") return `${uid}:race_${opts.raceSubTab ?? "all"}`;
  if (opts.mainTab === "coins") return `${uid}:coins`;
  if (opts.mainTab === "groups") return `${uid}:groups_${opts.groupPeriod ?? "today"}`;
  const period = opts.stepsSubTab ?? "today";
  if (opts.mainTab === "regional") {
    const cc = String(opts.countryCode || "none").trim().toUpperCase() || "NONE";
    return `${uid}:regional_${period}_${cc}`;
  }
  return `${uid}:${opts.mainTab}_${period}`;
}

export function leaderboardDiskKey(
  opts: Parameters<typeof leaderboardMemoryKey>[0],
): string {
  return `lb_${leaderboardMemoryKey(opts)}`;
}
