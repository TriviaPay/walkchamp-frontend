/**
 * Unlimited Daily Goal Challenge (`unlimited_goal`) — shared helpers.
 * Branch only when challengeType/entryType is unlimited_goal so Free / Coins /
 * Cash / Sponsored flows stay untouched.
 */

export const UNLIMITED_GOAL_CHALLENGE_TYPE = "unlimited_goal" as const;

export type UnlimitedGoalDurationDays =
  | 7
  | 10
  | 30
  | 60
  | 90;

/** Supported Unlimited Players challenge lengths (calendar days). */
export const UNLIMITED_GOAL_DURATION_DAYS: readonly UnlimitedGoalDurationDays[] = [
  7, 10, 30, 60, 90,
] as const;

export const UNLIMITED_GOAL_ENTRY_FEE_CENTS_MIN = 1_000; // $10
export const UNLIMITED_GOAL_ENTRY_FEE_CENTS_MAX = 100_000; // $1,000
export const UNLIMITED_GOAL_PLATFORM_FEE_CENTS = 50; // $0.50
export const UNLIMITED_GOAL_DEFAULT_DAILY_STEPS = 10_000;
export const UNLIMITED_GOAL_DAILY_STEPS_MIN = 3_000;
export const UNLIMITED_GOAL_DAILY_STEPS_MAX = 20_000;
export const UNLIMITED_GOAL_DAILY_STEPS_INCREMENT = 500;

/**
 * Discrete whole-dollar entry amounts for Unlimited create/join.
 * $10–$15 by $1, then $5/$10 jumps, then $50 steps to $1,000.
 */
export const UNLIMITED_GOAL_ENTRY_AMOUNT_DOLLARS = [
  10, 11, 12, 13, 14, 15,
  20, 25, 30, 35, 40, 45, 50,
  60, 70, 80, 90, 100,
  150, 200, 250, 300, 350,
  400, 450, 500, 550, 600, 650, 700, 750, 800, 850, 900, 950, 1000,
] as const;

export const UNLIMITED_GOAL_DESCRIPTION =
  "Complete your daily step goal every day. Everyone who completes every required day shares the prize pool equally.";

export type UnlimitedGoalLike = {
  challengeType?: string | null;
  challenge_type?: string | null;
  entryType?: string | null;
  entry_type?: string | null;
  type?: string | null;
  capacityMode?: string | null;
  capacity_mode?: string | null;
  maxParticipants?: number | null;
  max_participants?: number | null;
  maxPlayers?: number | null;
  max_players?: number | null;
};

/** True when the challenge is the Unlimited Daily Goal type. */
export function isUnlimitedGoalChallenge(
  value: UnlimitedGoalLike | string | null | undefined,
): boolean {
  if (value == null) return false;
  if (typeof value === "string") {
    return value === UNLIMITED_GOAL_CHALLENGE_TYPE;
  }
  const type =
    value.challengeType ??
    value.challenge_type ??
    value.entryType ??
    value.entry_type ??
    value.type ??
    null;
  if (type === UNLIMITED_GOAL_CHALLENGE_TYPE) return true;
  const capacity = value.capacityMode ?? value.capacity_mode ?? null;
  if (capacity === "unlimited") return true;
  return false;
}

/** Finite capacity check — unlimited rooms are never "full". */
export function isRoomCapacityFull(params: {
  currentPlayers: number;
  maxPlayers?: number | null;
  availableSlots?: number | null;
  isUnlimited?: boolean;
}): boolean {
  if (params.isUnlimited) return false;
  if (params.maxPlayers == null || !Number.isFinite(params.maxPlayers) || params.maxPlayers <= 0) {
    return false;
  }
  if (typeof params.availableSlots === "number" && Number.isFinite(params.availableSlots)) {
    return params.availableSlots <= 0;
  }
  return params.currentPlayers >= params.maxPlayers;
}

export function formatUnlimitedPlayersLabel(participantCount?: number | null): string {
  if (typeof participantCount === "number" && Number.isFinite(participantCount) && participantCount > 0) {
    return `${participantCount.toLocaleString()} joined · Unlimited players`;
  }
  return "Unlimited players";
}

export function formatPlayerCountDisplay(params: {
  current: number;
  max?: number | null;
  isUnlimited?: boolean;
}): string {
  if (params.isUnlimited) {
    return `${params.current.toLocaleString()} joined`;
  }
  const max = params.max ?? 0;
  return `${params.current}/${max}`;
}

export function isValidUnlimitedEntryDollars(dollars: number): boolean {
  return (UNLIMITED_GOAL_ENTRY_AMOUNT_DOLLARS as readonly number[]).includes(dollars);
}

export function isValidUnlimitedEntryFeeCents(cents: number): boolean {
  if (!Number.isInteger(cents) || cents % 100 !== 0) return false;
  return isValidUnlimitedEntryDollars(cents / 100);
}

export function isValidUnlimitedDailyGoalSteps(steps: number): boolean {
  return (
    Number.isInteger(steps) &&
    steps >= UNLIMITED_GOAL_DAILY_STEPS_MIN &&
    steps <= UNLIMITED_GOAL_DAILY_STEPS_MAX &&
    (steps - UNLIMITED_GOAL_DAILY_STEPS_MIN) % UNLIMITED_GOAL_DAILY_STEPS_INCREMENT === 0
  );
}

export function isValidUnlimitedDurationDays(
  days: number,
): days is UnlimitedGoalDurationDays {
  return (UNLIMITED_GOAL_DURATION_DAYS as readonly number[]).includes(days);
}

/** Client-side fee preview only — backend values remain authoritative at pay time. */
export function previewUnlimitedTotalChargeCents(entryFeeCents: number): {
  entryFeeCents: number;
  platformFeeCents: number;
  totalChargeCents: number;
} {
  const platformFeeCents = UNLIMITED_GOAL_PLATFORM_FEE_CENTS;
  return {
    entryFeeCents,
    platformFeeCents,
    totalChargeCents: entryFeeCents + platformFeeCents,
  };
}

export function getUnlimitedDailyGoalStepOptions(): number[] {
  const options: number[] = [];
  for (
    let s = UNLIMITED_GOAL_DAILY_STEPS_MIN;
    s <= UNLIMITED_GOAL_DAILY_STEPS_MAX;
    s += UNLIMITED_GOAL_DAILY_STEPS_INCREMENT
  ) {
    options.push(s);
  }
  return options;
}

export function formatStepsPerDay(steps: number): string {
  return `${steps.toLocaleString()} steps / day`;
}

export function formatDurationDaysLabel(days: number): string {
  return `${days} day${days === 1 ? "" : "s"}`;
}

export function formatUsdFromCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}
