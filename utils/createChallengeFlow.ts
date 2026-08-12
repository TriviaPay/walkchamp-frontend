/**
 * Create Challenge wizard — shared types, drafts, winners, and host payload mapping.
 * Maps the UI model (Free / Coins / USD × Fixed / Unlimited) onto existing host APIs.
 */

import {
  UNLIMITED_GOAL_CHALLENGE_TYPE,
  UNLIMITED_GOAL_DEFAULT_DAILY_STEPS,
  UNLIMITED_GOAL_DURATION_DAYS,
  UNLIMITED_GOAL_ENTRY_AMOUNT_DOLLARS,
  UNLIMITED_GOAL_PLATFORM_FEE_CENTS,
  isValidUnlimitedDailyGoalSteps,
  isValidUnlimitedDurationDays,
  isValidUnlimitedEntryFeeCents,
  type UnlimitedGoalDurationDays,
} from "@/utils/unlimitedGoal";
import {
  getDefaultTargetSteps,
  isValidTargetSteps,
  type TargetStepDuration,
} from "@/utils/targetSteps";
import {
  getDefaultPlayerCount,
  isValidPlayerCount,
} from "@/utils/players";
import { isUnlimitedGoalFrontendEnabled } from "@/config/featureFlags";
import { streakChallengeTitle } from "@/features/unlimited/mappers/unlimitedLiveUiCopy";
import {
  resolveEffectiveChallengeStart,
  resolvePayloadScheduledStart,
  resolveUnlimitedMidnightStart,
  isLocalMidnight,
  calculateChallengeEnd,
} from "@/utils/createChallengeSchedule";

export type RoomVisibility = "public" | "private";
export type EntryTypeUi = "free" | "coins" | "usd";
export type ChallengeFormatUi = "fixed" | "unlimited_goal";
export type CreateStep = 1 | 2 | 3 | 4 | 5;
export const CREATE_CHALLENGE_TOTAL_STEPS = 5 as const;

/** Fixed-player cash entry — API allowlist only ($3, $5, $10, $15, $20, $25). */
export const USD_FIXED_ENTRY_DOLLARS = [3, 5, 10, 15, 20, 25] as const;
export const USD_FIXED_ENTRY_MIN_DOLLARS = USD_FIXED_ENTRY_DOLLARS[0];
export const USD_FIXED_ENTRY_MAX_DOLLARS = USD_FIXED_ENTRY_DOLLARS[USD_FIXED_ENTRY_DOLLARS.length - 1];
export const USD_FIXED_ENTRY_DEFAULT_DOLLARS = USD_FIXED_ENTRY_MIN_DOLLARS;

/** True when value is one of the API-allowed fixed cash tiers. */
export function isValidUsdFixedEntryDollars(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    (USD_FIXED_ENTRY_DOLLARS as readonly number[]).includes(value)
  );
}

/** Snap cached/restored values to the nearest allowed fixed-cash tier. */
export function clampUsdFixedEntryDollars(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return USD_FIXED_ENTRY_DEFAULT_DOLLARS;
  }
  if (isValidUsdFixedEntryDollars(value)) return value;
  let best = USD_FIXED_ENTRY_DEFAULT_DOLLARS;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const tier of USD_FIXED_ENTRY_DOLLARS) {
    const dist = Math.abs(tier - value);
    if (dist < bestDist) {
      best = tier;
      bestDist = dist;
    }
  }
  return best;
}

/** Convert validated fixed-cash dollars to cents for API payloads. */
export function usdFixedEntryDollarsToCents(dollars: number): number {
  const clamped = clampUsdFixedEntryDollars(dollars);
  return clamped * 100;
}

/** Dynamic challenge title for confirm / host surfaces. */
export function formatUsdFixedCashChallengeLabel(dollars: number): string {
  return `$${clampUsdFixedEntryDollars(dollars)} Cash Challenge`;
}

export const COINS_ENTRY_AMOUNTS = [
  500, 1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000, 9000, 10000,
] as const;

export type WinnerSplit = {
  winnerCount: 1 | 2 | 3;
  rows: Array<{ place: 1 | 2 | 3; label: string; percent: number }>;
};

/** Display-only winner split — backend remains authoritative at pay/settle time. */
export function getFixedWinnerSplit(playerCount: number): WinnerSplit {
  if (playerCount <= 2) {
    return {
      winnerCount: 1,
      rows: [{ place: 1, label: "1st Place", percent: 100 }],
    };
  }
  if (playerCount === 3) {
    return {
      winnerCount: 2,
      rows: [
        { place: 1, label: "1st Place", percent: 60 },
        { place: 2, label: "2nd Place", percent: 40 },
      ],
    };
  }
  return {
    winnerCount: 3,
    rows: [
      { place: 1, label: "1st Place", percent: 50 },
      { place: 2, label: "2nd Place", percent: 30 },
      { place: 3, label: "3rd Place", percent: 20 },
    ],
  };
}

export type FixedDraft = {
  maxPlayers: number;
  goalType: TargetStepDuration;
  targetSteps: number;
  coinEntryAmount: number;
  usdAmountDollars: number;
};

export type UnlimitedDraft = {
  entryDollars: number;
  dailyGoalSteps: number;
  durationDays: UnlimitedGoalDurationDays;
};

export type CreateChallengeDraft = {
  visibility: RoomVisibility;
  entryType: EntryTypeUi;
  /** Only meaningful when entryType === "usd". Free/Coins always fixed. */
  usdFormat: ChallengeFormatUi;
  fixed: FixedDraft;
  unlimited: UnlimitedDraft;
  startDate: Date;
  /** Index into TIME_PRESETS_WITH_NOW (0 = Now). */
  startTimeIdx: number;
  /**
   * auto_now: start follows device clock until user picks a future slot.
   * user_selected: preserve explicit date/time; reject when past.
   */
  startMode: "auto_now" | "user_selected";
  trackLayout: string;
  rulesAccepted: boolean;
  unlimitedRulesAccepted: boolean;
};

export function createDefaultDraft(trackLayout = "bg"): CreateChallengeDraft {
  const goalType: TargetStepDuration = "daily";
  const now = new Date();
  const base: CreateChallengeDraft = {
    visibility: "public",
    entryType: "usd",
    usdFormat: isUnlimitedGoalFrontendEnabled() ? "unlimited_goal" : "fixed",
    fixed: {
      maxPlayers: getDefaultPlayerCount(),
      goalType,
      targetSteps: getDefaultTargetSteps(goalType),
      coinEntryAmount: COINS_ENTRY_AMOUNTS[0]!,
      usdAmountDollars: USD_FIXED_ENTRY_DEFAULT_DOLLARS,
    },
    unlimited: {
      entryDollars: UNLIMITED_GOAL_ENTRY_AMOUNT_DOLLARS[0]!,
      dailyGoalSteps: UNLIMITED_GOAL_DEFAULT_DAILY_STEPS,
      durationDays: UNLIMITED_GOAL_DURATION_DAYS[0]!,
    },
    startDate: toLocalCalendarDate(now),
    startTimeIdx: 0,
    startMode: "auto_now",
    trackLayout,
    rulesAccepted: false,
    unlimitedRulesAccepted: false,
  };
  if (base.usdFormat === "unlimited_goal") {
    return applyUnlimitedMidnightSchedule(base, now);
  }
  return base;
}

export function resolveChallengeFormat(draft: CreateChallengeDraft): ChallengeFormatUi {
  if (draft.entryType !== "usd") return "fixed";
  if (
    draft.usdFormat === "unlimited_goal" &&
    isUnlimitedGoalFrontendEnabled()
  ) {
    return "unlimited_goal";
  }
  return "fixed";
}

export function durationDaysFromGoalType(goalType: TargetStepDuration): number {
  if (goalType === "daily") return 1;
  if (goalType === "weekly") return 7;
  return 30;
}

export function goalTypeFromDurationDays(days: number): TargetStepDuration {
  if (days <= 1) return "daily";
  if (days <= 7) return "weekly";
  return "monthly";
}

export function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/** Local calendar day at noon — avoids timezone edge cases shifting the selected day. */
export function toLocalCalendarDate(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12, 0, 0, 0);
}

/** Local calendar day at 12:00:00.000 AM. */
export function toLocalMidnight(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
}

/** Tomorrow's local calendar date (stored at noon for draft stability). */
export function localTomorrowCalendarDate(from: Date = new Date()): Date {
  const d = toLocalCalendarDate(from);
  d.setDate(d.getDate() + 1);
  return d;
}

/** True when `day` is strictly before local calendar today. */
export function isLocalCalendarBeforeDay(day: Date, deviceNow: Date): boolean {
  return toLocalMidnight(day).getTime() < toLocalMidnight(deviceNow).getTime();
}

/** True when `day` is today or earlier (not selectable for unlimited start). */
export function isLocalCalendarTodayOrPast(day: Date, deviceNow: Date): boolean {
  return toLocalMidnight(day).getTime() <= toLocalMidnight(deviceNow).getTime();
}

/**
 * Index of 12:00 AM in TIME_PRESETS_WITH_NOW (after the "Now" preset).
 * Unlimited challenges always use this preset.
 */
export function getUnlimitedMidnightTimeIdx(): number {
  const idx = TIME_PRESETS_WITH_NOW.findIndex(
    (p) => !p.isNow && p.hour === 0 && p.minute === 0,
  );
  return idx >= 0 ? idx : 1;
}

/** Initialize / reset USD Unlimited schedule to tomorrow · 12:00 AM. */
export function applyUnlimitedMidnightSchedule<T extends CreateChallengeDraft>(
  draft: T,
  deviceNow: Date = new Date(),
): T {
  return {
    ...draft,
    startDate: localTomorrowCalendarDate(deviceNow),
    startTimeIdx: getUnlimitedMidnightTimeIdx(),
    startMode: "user_selected",
  };
}

/**
 * True when draft already has a valid unlimited midnight schedule
 * (start date ≥ tomorrow, time locked to midnight, user_selected).
 */
export function isValidUnlimitedMidnightSchedule(
  draft: CreateChallengeDraft,
  deviceNow: Date = new Date(),
): boolean {
  if (draft.startMode !== "user_selected") return false;
  if (draft.startTimeIdx !== getUnlimitedMidnightTimeIdx()) return false;
  if (isLocalCalendarTodayOrPast(draft.startDate, deviceNow)) return false;
  return true;
}

/**
 * Keep a valid unlimited Start Date; only reset when invalid/outdated.
 * Always forces midnight time index without clobbering a valid future date.
 */
export function ensureUnlimitedMidnightSchedule(
  draft: CreateChallengeDraft,
  deviceNow: Date = new Date(),
): CreateChallengeDraft {
  const midnightIdx = getUnlimitedMidnightTimeIdx();
  if (isValidUnlimitedMidnightSchedule(draft, deviceNow)) {
    return {
      ...draft,
      startTimeIdx: midnightIdx,
      startMode: "user_selected",
    };
  }
  // Keep future start date if already ahead of tomorrow; only fix time mode.
  if (!isLocalCalendarTodayOrPast(draft.startDate, deviceNow)) {
    return {
      ...draft,
      startDate: toLocalCalendarDate(draft.startDate),
      startTimeIdx: midnightIdx,
      startMode: "user_selected",
    };
  }
  return applyUnlimitedMidnightSchedule(draft, deviceNow);
}

/**
 * Normalize a Date from `@react-native-community/datetimepicker`.
 * Android Material date pickers often return the chosen Y-M-D at UTC midnight;
 * local getters then shift the day backward west of UTC. Always prefer UTC
 * Y-M-D when they disagree with local, otherwise use local calendar parts.
 */
export function pickerDateToLocalCalendarDay(d: Date): Date {
  const localY = d.getFullYear();
  const localM = d.getMonth();
  const localD = d.getDate();
  const utcY = d.getUTCFullYear();
  const utcM = d.getUTCMonth();
  const utcD = d.getUTCDate();
  if (localY !== utcY || localM !== utcM || localD !== utcD) {
    return new Date(utcY, utcM, utcD, 12, 0, 0, 0);
  }
  return new Date(localY, localM, localD, 12, 0, 0, 0);
}

export type TimePreset = {
  label: string;
  hour: number;
  minute: number;
  isNow?: boolean;
};

export const TIME_PRESETS_WITH_NOW: TimePreset[] = [
  { label: "Now", hour: -1, minute: 0, isNow: true },
  ...Array.from({ length: 48 }, (_, i) => {
    const totalMin = i * 30;
    const hour = Math.floor(totalMin / 60);
    const minute = totalMin % 60;
    const d = new Date();
    d.setHours(hour, minute, 0, 0);
    return {
      label: d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }),
      hour,
      minute,
    };
  }),
];

export const TIME_PRESETS_FUTURE = TIME_PRESETS_WITH_NOW.filter((p) => !p.isNow);

/** null = start immediately (Now). */
export function buildScheduledStartAtFromDate(
  startDate: Date,
  timeIdx: number,
): Date | null {
  const preset = TIME_PRESETS_WITH_NOW[timeIdx];
  if (!preset) return null;
  const today = new Date();
  const isTodayDate = isSameDay(startDate, today);
  if (preset.isNow && isTodayDate) return null;
  const d = new Date(startDate);
  if (preset.isNow) {
    d.setHours(today.getHours(), today.getMinutes(), 0, 0);
  } else {
    d.setHours(preset.hour, preset.minute, 0, 0);
  }
  return d;
}

export function computeEndDate(
  startDate: Date,
  timeIdx: number,
  durationDays: number,
): Date {
  const scheduled = buildScheduledStartAtFromDate(startDate, timeIdx);
  const start = scheduled ?? new Date();
  const end = new Date(start);
  end.setDate(end.getDate() + durationDays);
  return end;
}

export type HostPayloadBuildResult =
  | { ok: true; body: Record<string, unknown>; meta: HostPayloadMeta }
  | { ok: false; error: string };

export type HostPayloadMeta = {
  entryTypeApi: string;
  isUnlimited: boolean;
  isUsd: boolean;
  isCoins: boolean;
  isFree: boolean;
  entryFeeCents: number;
  platformFeeCents: number;
  totalChargeCents: number;
  maxPlayers: number | null;
  durationDays: number;
  targetOrDailySteps: number;
  scheduledStartAt: Date | null;
  endAt: Date;
};

export function buildHostPayload(
  draft: CreateChallengeDraft,
  timezone: string,
  deviceNow: Date = new Date(),
): HostPayloadBuildResult {
  const format = resolveChallengeFormat(draft);
  const isUnlimited = format === "unlimited_goal";
  const schedule = resolvePayloadScheduledStart({
    draft,
    isUnlimited,
    deviceNow,
  });

  if (!schedule.isValid) {
    return {
      ok: false,
      error: schedule.error ?? "Please select a valid start date and time.",
    };
  }

  const scheduledStartAt = schedule.scheduledStartAt;
  const isScheduled = scheduledStartAt !== null;
  const endAt = schedule.endAt;

  if (isUnlimited) {
    if (!isUnlimitedGoalFrontendEnabled()) {
      return { ok: false, error: "Streak Challenge is disabled in this build." };
    }
    if (!isScheduled) {
      return {
        ok: false,
        error: "Streak Challenge needs a start time.",
      };
    }
    const entryFeeCents = draft.unlimited.entryDollars * 100;
    if (!isValidUnlimitedEntryFeeCents(entryFeeCents)) {
      return {
        ok: false,
        error: "Entry fee must be a whole-dollar amount between $10 and $1,000.",
      };
    }
    if (!isValidUnlimitedDailyGoalSteps(draft.unlimited.dailyGoalSteps)) {
      return {
        ok: false,
        error: "Daily goal must be between 3,000 and 20,000 steps in 500-step increments.",
      };
    }
    if (!isValidUnlimitedDurationDays(draft.unlimited.durationDays)) {
      return { ok: false, error: "Choose 7, 10, 30, 60, or 90 days." };
    }
    if (!draft.unlimitedRulesAccepted) {
      return { ok: false, error: "Please accept the Streak Challenge rules to continue." };
    }

    const durationDays = draft.unlimited.durationDays;
    const platformFeeCents = UNLIMITED_GOAL_PLATFORM_FEE_CENTS;
    const title = streakChallengeTitle(draft.unlimited.dailyGoalSteps);
    const body: Record<string, unknown> = {
      visibility: draft.visibility === "private" ? "private" : "public",
      entryFeeCents,
      dailyGoalSteps: draft.unlimited.dailyGoalSteps,
      durationDays,
      startAtIso: scheduledStartAt!.toISOString(),
      challengeTimezone: timezone,
      title,
    };
    return {
      ok: true,
      body,
      meta: {
        entryTypeApi: UNLIMITED_GOAL_CHALLENGE_TYPE,
        isUnlimited: true,
        isUsd: true,
        isCoins: false,
        isFree: false,
        entryFeeCents,
        platformFeeCents,
        totalChargeCents: entryFeeCents + platformFeeCents,
        maxPlayers: null,
        durationDays,
        targetOrDailySteps: draft.unlimited.dailyGoalSteps,
        scheduledStartAt,
        endAt,
      },
    };
  }

  // Fixed (Free / Coins / USD Fixed)
  if (!isValidPlayerCount(draft.fixed.maxPlayers)) {
    return { ok: false, error: "Please select a valid player count between 2 and 10." };
  }
  if (!isValidTargetSteps(draft.fixed.goalType, draft.fixed.targetSteps)) {
    return {
      ok: false,
      error: "Please select a valid target step goal for this challenge duration.",
    };
  }

  // Daily fixed free/coins/cash = classic race: winners or 24h from start (not a calendar "1 day" duration room).
  // Weekly/monthly keep multi-day challengeDurationDays + challengeEndAt.
  const durationDays =
    draft.fixed.goalType === "daily" ? 0 : durationDaysFromGoalType(draft.fixed.goalType);

  if (draft.entryType === "free") {
    const body: Record<string, unknown> = {
      entryType: "free",
      challengeFormat: "fixed",
      maxPlayers: draft.fixed.maxPlayers,
      targetSteps: draft.fixed.targetSteps,
      trackLayout: draft.trackLayout,
      isPrivate: draft.visibility === "private",
      timezone,
      goalType: draft.fixed.goalType,
      challengeDurationDays: durationDays,
      ...(isScheduled ? { scheduledStartAtIso: scheduledStartAt!.toISOString() } : {}),
      ...(durationDays > 0 ? { challengeEndAtIso: endAt.toISOString() } : {}),
      startMode: draft.startMode ?? "auto_now",
    };
    return {
      ok: true,
      body,
      meta: {
        entryTypeApi: "free",
        isUnlimited: false,
        isUsd: false,
        isCoins: false,
        isFree: true,
        entryFeeCents: 0,
        platformFeeCents: 0,
        totalChargeCents: 0,
        maxPlayers: draft.fixed.maxPlayers,
        durationDays,
        targetOrDailySteps: draft.fixed.targetSteps,
        scheduledStartAt,
        endAt,
      },
    };
  }

  if (draft.entryType === "coins") {
    const body: Record<string, unknown> = {
      entryType: "coins_battle",
      challengeFormat: "fixed",
      maxPlayers: draft.fixed.maxPlayers,
      targetSteps: draft.fixed.targetSteps,
      coinEntryAmount: draft.fixed.coinEntryAmount,
      trackLayout: draft.trackLayout,
      isPrivate: draft.visibility === "private",
      timezone,
      goalType: draft.fixed.goalType,
      challengeDurationDays: durationDays,
      ...(isScheduled ? { scheduledStartAtIso: scheduledStartAt!.toISOString() } : {}),
      ...(durationDays > 0 ? { challengeEndAtIso: endAt.toISOString() } : {}),
      startMode: draft.startMode ?? "auto_now",
    };
    return {
      ok: true,
      body,
      meta: {
        entryTypeApi: "coins_battle",
        isUnlimited: false,
        isUsd: false,
        isCoins: true,
        isFree: false,
        entryFeeCents: 0,
        platformFeeCents: 0,
        totalChargeCents: 0,
        maxPlayers: draft.fixed.maxPlayers,
        durationDays,
        targetOrDailySteps: draft.fixed.targetSteps,
        scheduledStartAt,
        endAt,
      },
    };
  }

  // USD Fixed
  const usdAmountDollars = clampUsdFixedEntryDollars(draft.fixed.usdAmountDollars);
  if (!isValidUsdFixedEntryDollars(draft.fixed.usdAmountDollars)) {
    return { ok: false, error: "Select a supported entry amount." };
  }
  const entryFeeCents = usdFixedEntryDollarsToCents(usdAmountDollars);
  if (!draft.rulesAccepted) {
    return { ok: false, error: "Please confirm the challenge rules to continue." };
  }

  const body: Record<string, unknown> = {
    entryType: "paid_usd",
    challengeFormat: "fixed",
    maxPlayers: draft.fixed.maxPlayers,
    maxParticipants: draft.fixed.maxPlayers,
    targetSteps: draft.fixed.targetSteps,
    customEntryAmountCents: entryFeeCents,
    entryFeeCents,
    trackLayout: draft.trackLayout,
    isPrivate: draft.visibility === "private",
    timezone,
    goalType: draft.fixed.goalType,
    challengeDurationDays: durationDays,
    ...(isScheduled ? { scheduledStartAtIso: scheduledStartAt!.toISOString() } : {}),
    ...(durationDays > 0 ? { challengeEndAtIso: endAt.toISOString() } : {}),
    startMode: draft.startMode ?? "auto_now",
  };

  return {
    ok: true,
    body,
    meta: {
      entryTypeApi: "paid_usd",
      isUnlimited: false,
      isUsd: true,
      isCoins: false,
      isFree: false,
      entryFeeCents,
      platformFeeCents: 0,
      totalChargeCents: entryFeeCents,
      maxPlayers: draft.fixed.maxPlayers,
      durationDays,
      targetOrDailySteps: draft.fixed.targetSteps,
      scheduledStartAt,
      endAt,
    },
  };
}

export function canContinueStep(
  step: CreateStep,
  draft: CreateChallengeDraft,
  deviceNow: Date = new Date(),
): boolean {
  return getStepBlockReason(step, draft, deviceNow) == null;
}

/**
 * Dev/diagnostics reason codes — never show raw codes to users.
 * Returns null when the step can continue.
 */
export type StepBlockReason =
  | "missing_entry_type"
  | "unlimited_disabled"
  | "missing_challenge_type"
  | "missing_entry_amount"
  | "invalid_daily_goal"
  | "invalid_target_steps"
  | "invalid_coin_entry"
  | "fixed_players_missing"
  | "invalid_duration"
  | "missing_start"
  | "unlimited_needs_scheduled_start"
  | "past_start_time"
  | "rules_not_accepted"
  | "payload_invalid";

export function getStepBlockReason(
  step: CreateStep,
  draft: CreateChallengeDraft,
  deviceNow: Date = new Date(),
): StepBlockReason | null {
  const format = resolveChallengeFormat(draft);
  const isUnlimited = format === "unlimited_goal";

  if (step === 1) {
    if (
      draft.entryType !== "free" &&
      draft.entryType !== "coins" &&
      draft.entryType !== "usd"
    ) {
      return "missing_entry_type";
    }
    return null;
  }

  if (step === 2) {
    // Challenge type only — Free/Coins are always fixed.
    if (draft.entryType === "usd") {
      if (draft.usdFormat === "unlimited_goal") {
        if (!isUnlimitedGoalFrontendEnabled()) return "unlimited_disabled";
        return null;
      }
      if (draft.usdFormat === "fixed") return null;
      return "missing_challenge_type";
    }
    return null;
  }

  if (step === 3) {
    // Entry + goal
    if (isUnlimited) {
      if (!isValidUnlimitedEntryFeeCents(draft.unlimited.entryDollars * 100)) {
        return "missing_entry_amount";
      }
      if (!isValidUnlimitedDailyGoalSteps(draft.unlimited.dailyGoalSteps)) {
        return "invalid_daily_goal";
      }
      return null;
    }
    if (draft.entryType === "coins") {
      if (!(COINS_ENTRY_AMOUNTS as readonly number[]).includes(draft.fixed.coinEntryAmount)) {
        return "invalid_coin_entry";
      }
    }
    if (draft.entryType === "usd") {
      if (!isValidUsdFixedEntryDollars(draft.fixed.usdAmountDollars)) {
        return "missing_entry_amount";
      }
    }
    if (!isValidTargetSteps(draft.fixed.goalType, draft.fixed.targetSteps)) {
      return "invalid_target_steps";
    }
    return null;
  }

  if (step === 4) {
    // Participants + schedule — ignore rules acceptance (belongs on Step 5)
    if (isUnlimited) {
      return validateUnlimitedScheduleDraft(draft, deviceNow);
    }
    return validateFixedScheduleDraft(draft, deviceNow);
  }

  // Step 5 — full payload including rules (revalidate with live clock)
  const built = buildHostPayload(draft, "UTC", deviceNow);
  if (!built.ok) {
    if (built.error.toLowerCase().includes("rules")) return "rules_not_accepted";
    if (built.error.toLowerCase().includes("scheduled")) return "unlimited_needs_scheduled_start";
    if (built.error.toLowerCase().includes("future") || built.error.toLowerCase().includes("passed")) {
      return "past_start_time";
    }
    if (built.error.toLowerCase().includes("player")) return "fixed_players_missing";
    return "payload_invalid";
  }
  return null;
}

/** Unlimited schedule/participants validation — no playerCount, no rules. */
export function validateUnlimitedScheduleDraft(
  draft: CreateChallengeDraft,
  deviceNow: Date = new Date(),
): StepBlockReason | null {
  if (!isUnlimitedGoalFrontendEnabled()) return "unlimited_disabled";
  if (!isValidUnlimitedEntryFeeCents(draft.unlimited.entryDollars * 100)) {
    return "missing_entry_amount";
  }
  if (!isValidUnlimitedDailyGoalSteps(draft.unlimited.dailyGoalSteps)) {
    return "invalid_daily_goal";
  }
  if (!isValidUnlimitedDurationDays(draft.unlimited.durationDays)) {
    return "invalid_duration";
  }
  const start = resolveUnlimitedMidnightStart({
    startDate: draft.startDate,
    deviceNow,
  });
  if (!start.isValid) return "past_start_time";
  if (isLocalCalendarTodayOrPast(start.effectiveStartAt, deviceNow)) {
    return "past_start_time";
  }
  if (!isLocalMidnight(start.effectiveStartAt)) return "past_start_time";
  const endAt = calculateChallengeEnd({
    startAt: start.effectiveStartAt,
    durationDays: draft.unlimited.durationDays,
  });
  if (!isLocalMidnight(endAt)) return "past_start_time";
  return null;
}

/** Fixed schedule/participants validation — no rules. */
export function validateFixedScheduleDraft(
  draft: CreateChallengeDraft,
  deviceNow: Date = new Date(),
): StepBlockReason | null {
  if (!isValidPlayerCount(draft.fixed.maxPlayers)) return "fixed_players_missing";
  if (!isValidTargetSteps(draft.fixed.goalType, draft.fixed.targetSteps)) {
    return "invalid_target_steps";
  }
  if (draft.entryType === "usd") {
    if (!isValidUsdFixedEntryDollars(draft.fixed.usdAmountDollars)) {
      return "missing_entry_amount";
    }
  }
  if (draft.entryType === "coins") {
    if (!(COINS_ENTRY_AMOUNTS as readonly number[]).includes(draft.fixed.coinEntryAmount)) {
      return "invalid_coin_entry";
    }
  }
  const start = resolveEffectiveChallengeStart({ draft, deviceNow });
  if (!start.isValid) return "past_start_time";
  return null;
}

export function validateUnlimitedChallengeDraft(
  draft: CreateChallengeDraft,
): StepBlockReason | null {
  if (resolveChallengeFormat(draft) !== "unlimited_goal") return "missing_challenge_type";
  const schedule = validateUnlimitedScheduleDraft(draft);
  if (schedule) return schedule;
  if (!draft.unlimitedRulesAccepted) return "rules_not_accepted";
  return null;
}

export function validateFixedChallengeDraft(
  draft: CreateChallengeDraft,
): StepBlockReason | null {
  if (resolveChallengeFormat(draft) === "unlimited_goal") return "missing_challenge_type";
  const schedule = validateFixedScheduleDraft(draft);
  if (schedule) return schedule;
  if (draft.entryType === "usd" && !draft.rulesAccepted) return "rules_not_accepted";
  return null;
}

/** Review model for Unlimited Step 5 — never inferred from Fixed fields. */
export function mapUnlimitedDraftToReviewModel(
  draft: CreateChallengeDraft,
  timezone: string,
  fee?: { platformFeeCents: number; totalDueCents: number } | null,
) {
  const entryFeeCents = draft.unlimited.entryDollars * 100;
  const platformFeeCents = fee?.platformFeeCents ?? UNLIMITED_GOAL_PLATFORM_FEE_CENTS;
  const totalDueCents = fee?.totalDueCents ?? entryFeeCents + platformFeeCents;
  const start = resolveUnlimitedMidnightStart({ startDate: draft.startDate });
  const startAt = start.effectiveStartAt;
  const endAt = calculateChallengeEnd({
    startAt,
    durationDays: draft.unlimited.durationDays,
  });
  return {
    visibility: draft.visibility,
    entryAmountCents: entryFeeCents,
    dailyGoalSteps: draft.unlimited.dailyGoalSteps,
    durationDays: draft.unlimited.durationDays,
    startAt,
    endAt,
    timezone,
    capacityMode: "unlimited" as const,
    platformFeeCents,
    totalDueCents,
    prizeSplitRule: "equal_qualified_split" as const,
  };
}

export function primaryActionLabel(
  draft: CreateChallengeDraft,
  totalDueCents?: number,
): string {
  const format = resolveChallengeFormat(draft);
  if (format === "unlimited_goal") {
    const cents =
      totalDueCents ??
      draft.unlimited.entryDollars * 100 + UNLIMITED_GOAL_PLATFORM_FEE_CENTS;
    return `Create & Pay $${(cents / 100).toFixed(2)}`;
  }
  if (draft.entryType === "free") return "Create Free Challenge";
  if (draft.entryType === "coins") return "Create Coins Battle";
  const dollars = totalDueCents != null ? totalDueCents / 100 : draft.fixed.usdAmountDollars;
  return `Create & Pay $${dollars.toFixed(2)}`;
}

export function footerPrimaryLabel(step: CreateStep, draft: CreateChallengeDraft, totalDueCents?: number): string {
  if (step < 4) return "Continue";
  if (step === 4) return "Review Challenge";
  return primaryActionLabel(draft, totalDueCents);
}

export function inlineRulePreview(draft: CreateChallengeDraft): {
  title: string;
  lines: string[];
} {
  const format = resolveChallengeFormat(draft);
  if (format === "unlimited_goal") {
    return {
      title: "Streak Challenge",
      lines: [
        "No player limit",
        `$${draft.unlimited.entryDollars} entry`,
        `${draft.unlimited.dailyGoalSteps.toLocaleString()} steps every day`,
        `${draft.unlimited.durationDays} days`,
        "Equal split among qualified finishers",
      ],
    };
  }
  if (draft.entryType === "free") {
    return {
      title: "Free Challenge",
      lines: [
        `${draft.fixed.maxPlayers} players`,
        `${draft.fixed.targetSteps.toLocaleString()} target steps`,
        `${durationDaysFromGoalType(draft.fixed.goalType)} day${durationDaysFromGoalType(draft.fixed.goalType) === 1 ? "" : "s"}`,
        "No entry fee",
      ],
    };
  }
  if (draft.entryType === "coins") {
    const split = getFixedWinnerSplit(draft.fixed.maxPlayers);
    return {
      title: "Coins Battle",
      lines: [
        `${draft.fixed.maxPlayers} players`,
        `${draft.fixed.coinEntryAmount.toLocaleString()} coins per player`,
        `${draft.fixed.targetSteps.toLocaleString()} target steps`,
        `Top ${split.winnerCount} winner${split.winnerCount === 1 ? "" : "s"}`,
      ],
    };
  }
  const split = getFixedWinnerSplit(draft.fixed.maxPlayers);
  return {
    title: "Fixed Cash Challenge",
    lines: [
      `${draft.fixed.maxPlayers} players`,
      `$${draft.fixed.usdAmountDollars} entry`,
      `${draft.fixed.targetSteps.toLocaleString()} target steps`,
      `Top ${split.winnerCount} winner${split.winnerCount === 1 ? "" : "s"}`,
    ],
  };
}

