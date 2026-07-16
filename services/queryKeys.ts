/** User-scoped React Query keys for server state (commit to RQ for reads). */

export const walkKeys = {
  all: (userId: string) => ["walkStats", userId] as const,
  today: (userId: string, localDate: string) =>
    ["walkStats", userId, localDate] as const,
  dailyGoal: (userId: string, localDate: string) =>
    ["dailyGoal", userId, localDate] as const,
};

export const stepsKeys = {
  all: (userId: string) => ["todaySteps", userId] as const,
  today: (userId: string, localDate: string) =>
    ["todaySteps", userId, localDate] as const,
  progress: (userId: string, localDate: string) =>
    ["stepProgress", userId, localDate] as const,
  race: (userId: string, raceId: string) =>
    ["raceSteps", userId, raceId] as const,
};

export const profileKeys = {
  me: (userId: string) => ["profile", "me", userId] as const,
};

export const walletKeys = {
  balance: (userId: string) => ["wallet", "balance", userId] as const,
  transactions: (userId: string) => ["wallet", "transactions", userId] as const,
};

export const leaderboardKeys = {
  list: (userId: string, query: string) =>
    ["leaderboard", userId, query] as const,
};

export const sponsoredEventKeys = {
  list: (query = "") => ["sponsoredEvents", query] as const,
};

export const chatKeys = {
  summary: (userId: string) => ["chat", "summary", userId] as const,
};

/** Prefixes used when removing all queries for a user on logout/switch. */
export const USER_STEP_QUERY_PREFIXES = [
  "walkStats",
  "todaySteps",
  "stepProgress",
  "dailyGoal",
  "raceSteps",
  "steps",
  "dailySteps",
  "profile",
  "wallet",
  "leaderboard",
  "chat",
] as const;
