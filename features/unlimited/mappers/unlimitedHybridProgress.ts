/**
 * Unlimited dual-lane progress helpers.
 *
 * Verified  = Health Connect / HealthKit (display + qualification + settlement)
 * Provisional = TYPE_STEP_COUNTER / CMPedometer (live UX only while HC is still 0)
 *
 * Displayed live = Health Connect when it has today's total. Never add sensor on top.
 */

export type UnlimitedVerificationStatus =
  | "verified"
  | "syncing"
  | "verification_delayed"
  | "unavailable";

export type UnlimitedProgressSource =
  | "verified"
  | "provisional"
  | "mixed"
  | "unavailable";

export type UnlimitedDailyProgress = {
  challengeId: string;
  userId: string;
  challengeDayKey: string;
  timezone: string;

  verifiedTodaySteps: number;
  verificationSource: "health_connect" | "healthkit" | null;
  verifiedUpdatedAtUtc: string | null;

  provisionalTodaySteps: number;
  provisionalSource: "android_step_counter" | "ios_pedometer" | null;
  provisionalSessionId: string | null;
  provisionalSequence: number;
  provisionalUpdatedAtUtc: string | null;

  displayedLiveSteps: number;
  progressSource: UnlimitedProgressSource;
  verificationStatus: UnlimitedVerificationStatus;
};

/** Display / realtime value only — never prize authority. */
export function resolveUnlimitedDisplayedLiveSteps(
  verifiedTodaySteps: number,
  provisionalTodaySteps: number | null | undefined,
): number {
  const verified = Math.max(0, Math.floor(verifiedTodaySteps));
  const provisional =
    provisionalTodaySteps == null
      ? 0
      : Math.max(0, Math.floor(provisionalTodaySteps));
  // Same source of truth as Walk: Health Connect / HealthKit when it has a total.
  if (verified > 0) return verified;
  return provisional;
}

export function resolveUnlimitedProgressSource(
  verifiedTodaySteps: number,
  provisionalTodaySteps: number | null | undefined,
): UnlimitedProgressSource {
  const verified = Math.max(0, Math.floor(verifiedTodaySteps));
  const provisional =
    provisionalTodaySteps == null
      ? 0
      : Math.max(0, Math.floor(provisionalTodaySteps));
  if (verified <= 0 && provisional <= 0) return "unavailable";
  if (verified > 0) return "verified";
  return "provisional";
}

export function resolveUnlimitedVerificationStatus(params: {
  verifiedTodaySteps: number;
  provisionalTodaySteps: number | null | undefined;
  verifiedHealthAvailable?: boolean;
  verifiedPermissionGranted?: boolean;
}): UnlimitedVerificationStatus {
  const verified = Math.max(0, Math.floor(params.verifiedTodaySteps));
  const provisional =
    params.provisionalTodaySteps == null
      ? 0
      : Math.max(0, Math.floor(params.provisionalTodaySteps));

  if (params.verifiedHealthAvailable === false) return "unavailable";
  if (params.verifiedPermissionGranted === false) return "unavailable";
  if (verified > 0) return "verified";
  if (provisional > 0) return "verification_delayed";
  return "syncing";
}

/**
 * Build local Unlimited dual-lane progress from Redux walk lanes.
 * Does not use raceSteps or totalChallengeSteps.
 */
export function buildLocalUnlimitedDailyProgress(params: {
  challengeId: string;
  userId: string;
  challengeDayKey: string;
  timezone: string;
  verifiedTodaySteps: number;
  provisionalTodaySteps: number | null | undefined;
  verificationSource?: "health_connect" | "healthkit" | null;
  provisionalSource?: "android_step_counter" | "ios_pedometer" | null;
  verifiedUpdatedAtUtc?: string | null;
  provisionalUpdatedAtUtc?: string | null;
  provisionalSessionId?: string | null;
  provisionalSequence?: number;
  verifiedHealthAvailable?: boolean;
  verifiedPermissionGranted?: boolean;
}): UnlimitedDailyProgress {
  const verified = Math.max(0, Math.floor(params.verifiedTodaySteps));
  const provisional =
    params.provisionalTodaySteps == null
      ? 0
      : Math.max(0, Math.floor(params.provisionalTodaySteps));
  const displayedLiveSteps = resolveUnlimitedDisplayedLiveSteps(verified, provisional);
  return {
    challengeId: params.challengeId,
    userId: params.userId,
    challengeDayKey: params.challengeDayKey,
    timezone: params.timezone,
    verifiedTodaySteps: verified,
    verificationSource: params.verificationSource ?? null,
    verifiedUpdatedAtUtc: params.verifiedUpdatedAtUtc ?? null,
    provisionalTodaySteps: provisional,
    provisionalSource: params.provisionalSource ?? null,
    provisionalSessionId: params.provisionalSessionId ?? null,
    provisionalSequence: params.provisionalSequence ?? 0,
    provisionalUpdatedAtUtc: params.provisionalUpdatedAtUtc ?? null,
    displayedLiveSteps,
    progressSource: resolveUnlimitedProgressSource(verified, provisional),
    verificationStatus: resolveUnlimitedVerificationStatus({
      verifiedTodaySteps: verified,
      provisionalTodaySteps: provisional,
      verifiedHealthAvailable: params.verifiedHealthAvailable,
      verifiedPermissionGranted: params.verifiedPermissionGranted,
    }),
  };
}

/** Prefer displayedLiveSteps from realtime when present; never use totalChallengeSteps. */
export function pickUnlimitedRealtimeDisplaySteps(data: {
  displayedLiveSteps?: number;
  provisionalTodaySteps?: number;
  verifiedTodaySteps?: number;
  currentSteps?: number;
  todaySteps?: number;
  steps?: number;
}): number | null {
  const verified =
    typeof data.verifiedTodaySteps === "number" ? data.verifiedTodaySteps : 0;
  if (verified > 0) return Math.floor(verified);
  const candidates = [
    data.displayedLiveSteps,
    data.currentSteps,
    data.todaySteps,
    data.steps,
  ];
  for (const c of candidates) {
    if (typeof c === "number" && Number.isFinite(c) && c >= 0) {
      return Math.floor(c);
    }
  }
  const provisional =
    typeof data.provisionalTodaySteps === "number"
      ? data.provisionalTodaySteps
      : null;
  if (verified > 0 || (provisional != null && provisional > 0)) {
    return resolveUnlimitedDisplayedLiveSteps(verified, provisional);
  }
  return null;
}
