/**
 * Create Challenge schedule — auto_now vs user_selected start resolution.
 * Pure helpers only. Backend timestamps remain authoritative after creation.
 *
 * Duration policy (matches existing computeEndDate):
 * endAt = startAt calendar date + durationDays (local device calendar add).
 */

import {
  TIME_PRESETS_WITH_NOW,
  isLocalCalendarTodayOrPast,
  isSameDay,
  localTomorrowCalendarDate,
  toLocalCalendarDate,
  toLocalMidnight,
} from "@/utils/createChallengeFlow";

export type ChallengeStartMode = "auto_now" | "user_selected";

/** Minimal draft shape — avoids circular runtime dependency on CreateChallengeDraft. */
export type ScheduleDraftLike = {
  startMode?: ChallengeStartMode;
  startDate: Date;
  startTimeIdx: number;
  unlimited: { durationDays: number };
  fixed: { goalType: "daily" | "weekly" | "monthly" };
};

/** No separate backend lead-time config in-app today — document as 0ms. */
export const CHALLENGE_MIN_START_LEAD_MS = 0;

export const CREATE_CHALLENGE_CLOCK_INTERVAL_MS = 30_000;
/** Faster tick on schedule/review so auto_now Start/End stay minute-accurate. */
export const CREATE_CHALLENGE_AUTO_NOW_CLOCK_MS = 1_000;

export type EffectiveChallengeStart = {
  startMode: ChallengeStartMode;
  /** Authoritative local instant used for display + payload. */
  effectiveStartAt: Date;
  /** True when Free/Coins may omit scheduledStartAtIso (start immediately). */
  isImmediateStart: boolean;
  isValid: boolean;
  validationMessage: string | null;
  startDisplayDate: string;
  startDisplayTime: string;
};

export type ChallengeReviewSchedule = {
  startMode: ChallengeStartMode;
  startAtUtc: string;
  startDisplayDate: string;
  startDisplayTime: string;
  endAtUtc: string;
  endDisplayDate: string;
  endDisplayTime: string;
  timezone: string;
  isValid: boolean;
  validationMessage: string | null;
  helperLabel: string;
};

/** Floor to local minute — display and payload share the same minute. */
export function normalizeToLocalMinute(d: Date): Date {
  const out = new Date(d);
  out.setSeconds(0, 0);
  return out;
}

export function formatChallengeTime(d: Date): string {
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

export function formatChallengeDateLabel(d: Date, deviceNow: Date): string {
  if (isSameDay(d, deviceNow)) return "Today";
  const tomorrow = localTomorrowCalendarDate(deviceNow);
  if (isSameDay(d, tomorrow)) return "Tomorrow";
  return d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

/**
 * Duration policy: calendar-day add in local timezone (existing product behavior).
 * Preserves the local clock time on the resulting calendar day.
 */
export function calculateChallengeEnd(params: {
  startAt: Date;
  durationDays: number;
}): Date {
  const end = new Date(params.startAt);
  end.setDate(end.getDate() + params.durationDays);
  return end;
}

/**
 * USD Unlimited Players: start/end always local 12:00 AM.
 * Start date must be tomorrow or later; earlier dates clamp to tomorrow.
 */
export function resolveUnlimitedMidnightStart(params: {
  startDate: Date;
  deviceNow?: Date;
}): EffectiveChallengeStart {
  const deviceNow = normalizeToLocalMinute(params.deviceNow ?? new Date());
  const tomorrow = localTomorrowCalendarDate(deviceNow);
  let day = toLocalCalendarDate(params.startDate);
  if (isLocalCalendarTodayOrPast(day, deviceNow)) {
    day = tomorrow;
  }
  const effectiveStartAt = toLocalMidnight(day);
  return {
    startMode: "user_selected",
    effectiveStartAt,
    isImmediateStart: false,
    isValid: true,
    validationMessage: null,
    startDisplayDate: formatChallengeDateLabel(effectiveStartAt, deviceNow),
    startDisplayTime: "12:00 AM",
  };
}

/** True when a Date is exactly local midnight (00:00:00.000). */
export function isLocalMidnight(d: Date): boolean {
  return (
    d.getHours() === 0 &&
    d.getMinutes() === 0 &&
    d.getSeconds() === 0 &&
    d.getMilliseconds() === 0
  );
}

function resolveUserSelectedStartAt(draft: ScheduleDraftLike, deviceNow: Date): Date | null {
  const preset = TIME_PRESETS_WITH_NOW[draft.startTimeIdx];
  if (!preset) return null;
  const isTodayDate = isSameDay(draft.startDate, deviceNow);
  if (preset.isNow && isTodayDate) return null;
  const d = new Date(draft.startDate);
  if (preset.isNow) {
    d.setHours(deviceNow.getHours(), deviceNow.getMinutes(), 0, 0);
  } else {
    d.setHours(preset.hour, preset.minute, 0, 0);
  }
  return d;
}

export function resolveStartMode(draft: ScheduleDraftLike, deviceNow = new Date()): ChallengeStartMode {
  // Future calendar day always wins — never keep auto_now display when startDate moved ahead.
  if (!isSameDay(draft.startDate, deviceNow)) return "user_selected";
  if (draft.startMode === "user_selected") return "user_selected";
  if (draft.startMode === "auto_now") return "auto_now";
  const preset = TIME_PRESETS_WITH_NOW[draft.startTimeIdx];
  if (preset?.isNow && isSameDay(draft.startDate, deviceNow)) return "auto_now";
  if (draft.startTimeIdx > 0 || !isSameDay(draft.startDate, deviceNow)) {
    return "user_selected";
  }
  return "auto_now";
}

export function resolveEffectiveChallengeStart(params: {
  draft: ScheduleDraftLike;
  deviceNow?: Date;
  minimumLeadTimeMs?: number;
}): EffectiveChallengeStart {
  const deviceNow = normalizeToLocalMinute(params.deviceNow ?? new Date());
  const lead = params.minimumLeadTimeMs ?? CHALLENGE_MIN_START_LEAD_MS;
  const minimumAllowed = new Date(deviceNow.getTime() + lead);
  const startMode = resolveStartMode(params.draft, deviceNow);

  if (startMode === "auto_now") {
    const effectiveStartAt =
      deviceNow.getTime() >= minimumAllowed.getTime() ? deviceNow : minimumAllowed;
    return {
      startMode: "auto_now",
      effectiveStartAt,
      isImmediateStart: true,
      isValid: true,
      validationMessage: null,
      startDisplayDate: formatChallengeDateLabel(effectiveStartAt, deviceNow),
      startDisplayTime: formatChallengeTime(effectiveStartAt),
    };
  }

  const selected = resolveUserSelectedStartAt(params.draft, deviceNow);
  if (selected == null) {
    return resolveEffectiveChallengeStart({
      ...params,
      draft: { ...params.draft, startMode: "auto_now", startTimeIdx: 0 },
    });
  }

  const effectiveStartAt = normalizeToLocalMinute(selected);
  const isPast = effectiveStartAt.getTime() <= deviceNow.getTime();
  const belowLead = effectiveStartAt.getTime() < minimumAllowed.getTime();

  if (isPast || belowLead) {
    return {
      startMode: "user_selected",
      effectiveStartAt,
      isImmediateStart: false,
      isValid: false,
      validationMessage:
        "The selected start time has passed. Choose a new future time.",
      startDisplayDate: formatChallengeDateLabel(effectiveStartAt, deviceNow),
      startDisplayTime: formatChallengeTime(effectiveStartAt),
    };
  }

  return {
    startMode: "user_selected",
    effectiveStartAt,
    isImmediateStart: false,
    isValid: true,
    validationMessage: null,
    startDisplayDate: formatChallengeDateLabel(effectiveStartAt, deviceNow),
    startDisplayTime: formatChallengeTime(effectiveStartAt),
  };
}

export function selectEffectiveChallengeSchedule(params: {
  draft: ScheduleDraftLike;
  durationDays: number;
  timezone: string;
  deviceNow?: Date;
  /** When true, force USD Unlimited midnight calendar-day schedule. */
  isUnlimited?: boolean;
}): ChallengeReviewSchedule {
  const deviceNow = params.deviceNow ?? new Date();
  const start = params.isUnlimited
    ? resolveUnlimitedMidnightStart({
        startDate: params.draft.startDate,
        deviceNow,
      })
    : resolveEffectiveChallengeStart({
        draft: params.draft,
        deviceNow,
      });
  const endAt = calculateChallengeEnd({
    startAt: start.effectiveStartAt,
    durationDays: params.durationDays,
  });

  return {
    startMode: start.startMode,
    startAtUtc: start.effectiveStartAt.toISOString(),
    startDisplayDate: start.startDisplayDate,
    startDisplayTime: start.startDisplayTime,
    endAtUtc: endAt.toISOString(),
    endDisplayDate: formatChallengeDateLabel(endAt, deviceNow),
    endDisplayTime: params.isUnlimited ? "12:00 AM" : formatChallengeTime(endAt),
    timezone: params.timezone,
    isValid: start.isValid,
    validationMessage: start.validationMessage,
    helperLabel: params.isUnlimited
      ? "Challenge begins at 12:00 AM."
      : start.startMode === "auto_now"
        ? "Uses current time until you choose a future start"
        : "Scheduled start",
  };
}

/** Payload start: auto_now Free/Coins/Fixed → null; Unlimited → local midnight. */
export function resolvePayloadScheduledStart(params: {
  draft: ScheduleDraftLike;
  isUnlimited: boolean;
  deviceNow?: Date;
}): { scheduledStartAt: Date | null; endAt: Date; isValid: boolean; error: string | null } {
  const durationDays = params.isUnlimited
    ? params.draft.unlimited.durationDays
    : params.draft.fixed.goalType === "daily"
      ? 1
      : params.draft.fixed.goalType === "weekly"
        ? 7
        : 30;

  if (params.isUnlimited) {
    const resolved = resolveUnlimitedMidnightStart({
      startDate: params.draft.startDate,
      deviceNow: params.deviceNow,
    });
    // Defensive: force local midnight on start/end regardless of draft time idx.
    const scheduledStartAt = toLocalMidnight(resolved.effectiveStartAt);
    const endAt = toLocalMidnight(
      calculateChallengeEnd({
        startAt: scheduledStartAt,
        durationDays,
      }),
    );
    if (!resolved.isValid) {
      return {
        scheduledStartAt: null,
        endAt,
        isValid: false,
        error: resolved.validationMessage,
      };
    }
    return {
      scheduledStartAt,
      endAt,
      isValid: true,
      error: null,
    };
  }

  const resolved = resolveEffectiveChallengeStart({
    draft: params.draft,
    deviceNow: params.deviceNow,
  });

  const endAt = calculateChallengeEnd({
    startAt: resolved.effectiveStartAt,
    durationDays,
  });

  if (!resolved.isValid) {
    return {
      scheduledStartAt: null,
      endAt,
      isValid: false,
      error: resolved.validationMessage,
    };
  }

  if (resolved.startMode === "auto_now" || resolved.isImmediateStart) {
    return {
      scheduledStartAt: null,
      endAt,
      isValid: true,
      error: null,
    };
  }

  return {
    scheduledStartAt: resolved.effectiveStartAt,
    endAt,
    isValid: true,
    error: null,
  };
}

export function applyAutoNowMode<T extends ScheduleDraftLike>(
  draft: T,
  deviceNow = new Date(),
): T {
  return {
    ...draft,
    startMode: "auto_now" as ChallengeStartMode,
    startDate: toLocalCalendarDate(deviceNow),
    startTimeIdx: 0,
  };
}

export function applyUserSelectedStart<T extends ScheduleDraftLike>(
  draft: T,
  startDate: Date,
  startTimeIdx: number,
): T {
  return {
    ...draft,
    startMode: "user_selected" as ChallengeStartMode,
    startDate: toLocalCalendarDate(startDate),
    startTimeIdx,
  };
}
