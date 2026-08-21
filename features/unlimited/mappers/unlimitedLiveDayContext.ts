/**
 * Pure helpers for Unlimited live step tracking — day key / timezone selection,
 * viewer-day gating, walk-sync pause policy, and self-step merge.
 *
 * Prefer participant-locked fields over host/race-level challengeDayKey.
 * Run tests: npx tsx utils/unlimitedLiveDayContext.test.ts
 */

export type UnlimitedLiveDaySource = {
  /** Viewer's locked day key from roster / live progress (preferred). */
  participantChallengeDayKey?: string | null;
  /** Viewer's locked timezone (preferred). */
  participantTimezone?: string | null;
  /** Challenge-level day key from detail payload (often host-centric). */
  raceChallengeDayKey?: string | null;
  /** Challenge/host timezone fallback. */
  raceChallengeTimezone?: string | null;
  /** Device timezone fallback. */
  deviceTimezone?: string | null;
  /** Optional calendar key from formatChallengeDayKey(now, tz). */
  formattedDeviceDayKey?: string | null;
};

export type UnlimitedLiveDayContext = {
  challengeDayKey: string;
  timezone: string;
  source: "participant" | "race" | "device";
};

/**
 * Resolve the day key + timezone Unlimited provisional uploads / live context must use.
 * Participant fields win — host race.challengeDayKey causes WRONG_CHALLENGE_DAY on BE.
 */
export function resolveUnlimitedLiveDayContext(
  input: UnlimitedLiveDaySource,
): UnlimitedLiveDayContext | null {
  const participantDay = trimStr(input.participantChallengeDayKey);
  const participantTz = trimStr(input.participantTimezone);
  const raceDay = trimStr(input.raceChallengeDayKey);
  const raceTz = trimStr(input.raceChallengeTimezone);
  const deviceTz = trimStr(input.deviceTimezone);
  const formatted = trimStr(input.formattedDeviceDayKey);

  const timezone = participantTz || raceTz || deviceTz || "";
  if (participantDay) {
    return {
      challengeDayKey: participantDay,
      timezone: timezone || "UTC",
      source: "participant",
    };
  }
  if (raceDay) {
    return {
      challengeDayKey: raceDay,
      timezone: timezone || "UTC",
      source: "race",
    };
  }
  if (formatted) {
    return {
      challengeDayKey: formatted,
      timezone: timezone || "UTC",
      source: "device",
    };
  }
  return null;
}

/**
 * Walk POST /api/walk/steps must stay ON during classic live races and Unlimited.
 * Race progress uses a separate endpoint; daily walk / streak share today's total.
 */
export function shouldPauseWalkBackendSync(_params: {
  classicLiveRaceActive: boolean;
  unlimitedDailyModeActive: boolean;
}): boolean {
  return false;
}

/** Before viewer's local midnight, paint 0 — never ambient HC "today" as challenge progress. */
export function resolveUnlimitedViewerDisplaySteps(params: {
  viewerStatus: string | null | undefined;
  displayedLiveSteps: number;
}): number {
  const status = (params.viewerStatus ?? "").trim().toLowerCase();
  if (status === "scheduled") return 0;
  return Math.max(0, Math.floor(params.displayedLiveSteps));
}

/**
 * Self roster merge for Unlimited Live Detail hydrate.
 * When the viewer day has not started, never blend local HC into the batch.
 */
export function mergeUnlimitedSelfHydrateSteps(params: {
  viewerDayStarted: boolean;
  localDailySteps: number;
  serverTodaySteps: number;
}): number {
  if (!params.viewerDayStarted) return 0;
  return Math.max(
    0,
    Math.floor(Math.max(params.localDailySteps, params.serverTodaySteps)),
  );
}

/** Classic my-active rows only — Unlimited must never restore into RaceContext. */
export function isClassicLiveRaceRowForRestore(row: {
  id?: string | null;
  status?: string | null;
  entryType?: string | null;
  challengeType?: string | null;
  capacityMode?: string | null;
}): boolean {
  const entry = String(row.entryType ?? "").toLowerCase();
  const challenge = String(row.challengeType ?? "").toLowerCase();
  const capacity = String(row.capacityMode ?? "").toLowerCase();
  if (entry === "unlimited_goal" || challenge === "unlimited_goal" || capacity === "unlimited") {
    return false;
  }
  return !!(row?.id && row.status === "in_progress");
}

/**
 * Should native FGS POST /api/races/:id/progress?
 * Unlimited uses walk steps + live-progress — classic progress must be skipped.
 */
export function shouldNativeSyncClassicRaceProgress(params: {
  unlimitedDailyMode?: boolean | null;
  isUnlimitedChallengeIdBlocked?: boolean;
}): boolean {
  if (params.unlimitedDailyMode === true) return false;
  if (params.isUnlimitedChallengeIdBlocked === true) return false;
  return true;
}

function trimStr(v: string | null | undefined): string {
  return typeof v === "string" ? v.trim() : "";
}
