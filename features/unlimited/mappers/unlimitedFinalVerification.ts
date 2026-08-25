/**
 * Pure Streak / Unlimited final-verification helpers (no React Native).
 * Exact server windows must be forwarded unchanged.
 */

import type {
  UnlimitedDailyHistoryDay,
  UnlimitedDailyHistoryPayload,
  UnlimitedFinalVerificationStatus,
} from "./unlimitedDayProgress";

export type UnlimitedFinalHealthSource = "health_connect" | "healthkit";

export type UnlimitedFinalDayWindow = {
  dayNumber: number;
  intervalStartUtc: string;
  intervalEndUtc: string;
};

export function normalizeUnlimitedFinalVerificationStatus(
  raw: unknown,
): UnlimitedFinalVerificationStatus | null {
  const s = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (s === "pending" || s === "requested" || s === "submitted" || s === "completed") {
    return s;
  }
  return null;
}

export function isUnlimitedFinalVerificationRequested(
  payload: UnlimitedDailyHistoryPayload | null | undefined,
): boolean {
  if (!payload) return false;
  if (payload.finalVerificationRequired === true) return true;
  return normalizeUnlimitedFinalVerificationStatus(payload.finalVerificationStatus) === "requested";
}

function dayNumberOf(day: UnlimitedDailyHistoryDay): number | null {
  const n = typeof day.dayNumber === "number" ? day.dayNumber : day.dayIndex;
  if (typeof n !== "number" || !Number.isFinite(n) || n < 1) return null;
  return Math.floor(n);
}

/**
 * Pick the final-day Health interval from daily-history.
 * Returns the server strings unchanged — never reconstructed local midnight.
 */
export function selectUnlimitedFinalDayWindow(
  payload: UnlimitedDailyHistoryPayload | null | undefined,
): UnlimitedFinalDayWindow | null {
  if (!payload) return null;
  const durationDays =
    typeof payload.durationDays === "number" && payload.durationDays > 0
      ? Math.floor(payload.durationDays)
      : null;
  const days = Array.isArray(payload.days) ? payload.days : [];
  const finalDay =
    (durationDays != null
      ? days.find((d) => dayNumberOf(d) === durationDays)
      : null) ??
    days.reduce<UnlimitedDailyHistoryDay | null>((best, d) => {
      const n = dayNumberOf(d);
      const bn = best ? dayNumberOf(best) : null;
      if (n == null) return best;
      if (bn == null || n > bn) return d;
      return best;
    }, null);

  if (!finalDay) return null;
  const dayNumber = dayNumberOf(finalDay);
  const intervalStartUtc =
    typeof finalDay.windowStartUtc === "string" ? finalDay.windowStartUtc : "";
  const intervalEndUtc =
    typeof finalDay.windowEndUtc === "string" ? finalDay.windowEndUtc : "";
  if (!dayNumber || !intervalStartUtc || !intervalEndUtc) return null;
  return { dayNumber, intervalStartUtc, intervalEndUtc };
}

export function canonicalUnlimitedFinalHealthSource(
  providerId: string | null | undefined,
): UnlimitedFinalHealthSource | null {
  const id = (providerId ?? "").trim().toLowerCase();
  if (
    id === "health_connect" ||
    id === "android_health_connect"
  ) {
    return "health_connect";
  }
  if (id === "healthkit" || id === "ios_healthkit") {
    return "healthkit";
  }
  return null;
}

export type FinalVerificationRetryAction =
  | "submit"
  | "retry"
  | "refetch"
  | "wait"
  | "stop";

export function classifyUnlimitedFinalVerificationError(input: {
  httpStatus?: number | null;
  code?: string | null;
}): FinalVerificationRetryAction {
  const code = (input.code ?? "").trim().toLowerCase();
  const status = input.httpStatus ?? 0;
  if (code === "invalid_measured_at") return "stop";
  if (code === "not_settlement_participant") return "stop";
  if (code === "challenge_not_verifying") return "stop";
  if (code === "challenge_not_found") return "stop";
  if (code === "final_day_missing") return "stop";
  if (code === "not_final_day" || code === "verification_window_mismatch") return "refetch";
  if (
    code === "participant_days_still_open" ||
    code === "verification_before_race_boundary"
  ) {
    return "wait";
  }
  if (status === 0 || status >= 500) return "retry";
  if (status === 409) return "wait";
  return "stop";
}

export function nextUnlimitedFinalVerificationRetryMs(attempt: number): number {
  const n = Math.max(0, Math.floor(attempt));
  return Math.min(30_000 * 2 ** n, 5 * 60_000);
}

export function unlimitedFinalVerificationPendingCopy(
  status: UnlimitedFinalVerificationStatus | string | null | undefined,
): { title: string; subtitle: string } {
  const s = (status ?? "").trim().toLowerCase();
  if (s === "submitted") {
    return {
      title: "Final health data received",
      subtitle: "Verification review in progress",
    };
  }
  return {
    title: "Final Day: Completed",
    subtitle: "Verification: Pending final race settlement",
  };
}
