/**
 * Streak Challenge participant timezone change API.
 * POST /api/unlimited-challenges/:id/timezone
 */
import { authFetch } from "@/utils/authFetch";
import { getDeviceTimezone } from "@/utils/timezone";

export type UnlimitedTimezoneChangeResult = {
  success: true;
  challengeId?: string;
  participantId?: string;
  previousTimezone: string;
  newTimezone: string;
  confirmedAt: string;
  effectiveChallengeDay: number;
  appliesToChallenge: boolean;
  finalDayTimezoneLocked: boolean;
  currentChallengeDay: number | null;
  currentDayTimezone: string;
  currentDayEndAtUtc: string | null;
  participantStartAtUtc: string;
  participantEndAtUtc: string;
};

export type UnlimitedTimezoneChangeError = {
  ok: false;
  httpStatus: number;
  code?: string;
  error?: string;
};

export function deviceIanaTimezone(): string {
  return getDeviceTimezone();
}

/** Body fragment to include on unlimited join/register. */
export function unlimitedJoinTimezoneBody(
  extra?: Record<string, unknown>,
): Record<string, unknown> {
  return {
    ...(extra ?? {}),
    timezone: deviceIanaTimezone(),
  };
}

export async function postUnlimitedTimezoneChange(
  challengeId: string,
  timezone: string = deviceIanaTimezone(),
): Promise<
  | { ok: true; result: UnlimitedTimezoneChangeResult }
  | UnlimitedTimezoneChangeError
> {
  try {
    const res = await authFetch(`/api/unlimited-challenges/${challengeId}/timezone`, {
      method: "POST",
      body: JSON.stringify({ timezone }),
      retryOnUnauthorized: false,
    });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      return {
        ok: false,
        httpStatus: res.status,
        code: typeof json.code === "string" ? json.code : undefined,
        error:
          typeof json.error === "string"
            ? json.error
            : typeof json.message === "string"
              ? json.message
              : "Could not update timezone.",
      };
    }
    return {
      ok: true,
      result: {
        success: true,
        challengeId: typeof json.challengeId === "string" ? json.challengeId : challengeId,
        participantId:
          typeof json.participantId === "string" ? json.participantId : undefined,
        previousTimezone: String(json.previousTimezone ?? ""),
        newTimezone: String(json.newTimezone ?? timezone),
        confirmedAt: String(json.confirmedAt ?? new Date().toISOString()),
        effectiveChallengeDay: Number(json.effectiveChallengeDay) || 0,
        appliesToChallenge: json.appliesToChallenge === true,
        finalDayTimezoneLocked: json.finalDayTimezoneLocked === true,
        currentChallengeDay:
          typeof json.currentChallengeDay === "number" ? json.currentChallengeDay : null,
        currentDayTimezone: String(json.currentDayTimezone ?? ""),
        currentDayEndAtUtc:
          typeof json.currentDayEndAtUtc === "string" ? json.currentDayEndAtUtc : null,
        participantStartAtUtc: String(json.participantStartAtUtc ?? ""),
        participantEndAtUtc: String(json.participantEndAtUtc ?? ""),
      },
    };
  } catch {
    return { ok: false, httpStatus: 0, error: "Network error. Please try again." };
  }
}

export function timezoneChangeErrorMessage(
  code: string | undefined,
  fallback?: string,
): string {
  switch (code) {
    case "invalid_timezone":
      return "That timezone is not valid. Use a full IANA name like America/Chicago.";
    case "challenge_not_active":
      return "Timezone can only be changed while the challenge is active.";
    case "challenge_not_found":
      return "Challenge not found.";
    case "not_participant":
      return "You are not a participant in this challenge.";
    case "incomplete_schedule":
      return "Your challenge schedule is not ready yet. Try again shortly.";
    case "day_already_started":
      return "A new challenge day already started. Refresh and try again.";
    default:
      return fallback || "Could not update timezone.";
  }
}
