/** User-scoped React Query keys for walk/step data. */

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

/** Prefixes used when removing all queries for a user on logout/switch. */
export const USER_STEP_QUERY_PREFIXES = [
  "walkStats",
  "todaySteps",
  "stepProgress",
  "dailyGoal",
  "raceSteps",
  "steps",
  "dailySteps",
] as const;
