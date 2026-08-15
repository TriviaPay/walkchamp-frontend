/**
 * Multi-day challenge end-time helpers (7-day / 30-day races).
 * Prefer API `challengeEndAt` / `timeLeftSeconds`; fall back to startedAt + duration;
 * last resort: infer duration from typical goal sizes (70k ≈ weekly).
 *
 * Display:
 *   "6 days left • Ends on 28 May 2025, 08:00 PM"
 *   On the last day (< 24h): "12 hr left • Ends on …"
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const MIN_MS = 60 * 1000;
/** Backend `FIXED_RACE_MAX_DURATION_MS` — classic free/coins/cash. */
export const CLASSIC_RACE_DURATION_MS = DAY_MS;
/** Backend sponsored live window. */
export const SPONSORED_RACE_DURATION_MS = 3 * HOUR_MS;

function parseDate(value: string | Date | null | undefined): Date | null {
  if (value == null || value === "") return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

export type ChallengeScheduleFields = {
  challengeEndAt?: string | Date | null;
  challengeDurationDays?: number | null;
  startedAt?: string | Date | null;
  /** Used only when API omits duration/end — e.g. 70_000 → 7 days. */
  targetSteps?: number | null;
  /** Preferred when backend sends live countdown (seconds). */
  timeLeftSeconds?: number | null;
  /** Optional precomputed fields from API (snake or camel). */
  daysLeft?: number | null;
  hoursLeft?: number | null;
  timeLeftLabel?: string | null;
  remainingLabel?: string | null;
};

function inferDurationDaysFromGoal(targetSteps: number | null | undefined): number {
  const steps = Math.max(0, Math.floor(Number(targetSteps) || 0));
  if (steps >= 200_000) return 30;
  if (steps >= 50_000) return 7;
  return 0;
}

/**
 * Absolute race end for Walk / My Race clocks.
 * Matches Backend `races.ts`: sponsored = start+3h; multi-day = API / start+days;
 * classic free/coins/cash = start+24h (same clock time next day).
 * Never invent from a frozen `now + timeLeftSeconds` snapshot.
 */
export function resolveRaceWindowEndAt(opts: {
  challengeEndAt?: string | Date | null;
  challengeDurationDays?: number | null;
  startedAt?: string | Date | null;
  scheduledStartAt?: string | Date | null;
  isSponsored?: boolean;
  isUnlimited?: boolean;
}): Date | null {
  const start = parseDate(opts.startedAt) ?? parseDate(opts.scheduledStartAt);
  const startMs = start?.getTime() ?? null;
  const apiEnd = parseDate(opts.challengeEndAt);
  const days = Math.max(0, Math.floor(Number(opts.challengeDurationDays) || 0));

  if (opts.isUnlimited) {
    if (apiEnd && startMs != null) {
      const afterStart = apiEnd.getTime() - startMs;
      // Real multi-day API end.
      if (afterStart > 28 * HOUR_MS) return apiEnd;
      // 24h-looking end is a daily window — prefer API durationDays when present.
      if (days > 1) return new Date(startMs + days * DAY_MS);
      return apiEnd;
    }
    if (apiEnd) return apiEnd;
    if (days > 1 && startMs != null) {
      return new Date(startMs + days * DAY_MS);
    }
    return null;
  }

  if (opts.isSponsored) {
    if (startMs == null) return apiEnd;
    return new Date(startMs + SPONSORED_RACE_DURATION_MS);
  }

  if (days > 1) {
    if (apiEnd) return apiEnd;
    if (startMs == null) return null;
    return new Date(startMs + days * DAY_MS);
  }

  // Classic fixed race: 24h from start. Ignore drifting/invented API ends that
  // are not that window (e.g. Date.now() + leftover countdown).
  if (startMs == null) return apiEnd;
  const classicEnd = new Date(startMs + CLASSIC_RACE_DURATION_MS);
  if (apiEnd) {
    const afterStart = apiEnd.getTime() - startMs;
    if (
      afterStart >= 20 * HOUR_MS &&
      afterStart <= 28 * HOUR_MS
    ) {
      return apiEnd;
    }
  }
  return classicEnd;
}

export function resolveChallengeEndAt(
  race: ChallengeScheduleFields | null | undefined,
): Date | null {
  if (!race) return null;

  if (race.challengeEndAt) {
    const end = new Date(race.challengeEndAt);
    if (!Number.isNaN(end.getTime())) return end;
  }

  let days = Math.max(0, Math.floor(Number(race.challengeDurationDays) || 0));
  const inferred = inferDurationDaysFromGoal(race.targetSteps);
  if (days < 2 && inferred >= 2) days = inferred;
  if (days <= 0) return null;

  const startRaw = race.startedAt;
  if (!startRaw) return null;
  const start = new Date(startRaw);
  if (Number.isNaN(start.getTime())) return null;
  return new Date(start.getTime() + days * DAY_MS);
}

function resolveMsLeft(
  race: ChallengeScheduleFields | null | undefined,
  endAt: Date | null,
  nowMs: number,
): number | null {
  const fromApi = Number(race?.timeLeftSeconds);
  if (Number.isFinite(fromApi) && fromApi >= 0) {
    return fromApi * 1000;
  }
  if (!endAt) return null;
  return endAt.getTime() - nowMs;
}

/** "6 days left" | "12 hr left" | "45 min left" | "Challenge ended" */
export function formatRemainingLeftText(msLeft: number): string {
  if (msLeft <= 0) return "Challenge ended";

  // Last day: show hours (or minutes if under 1 hour).
  if (msLeft < DAY_MS) {
    if (msLeft < HOUR_MS) {
      const mins = Math.max(1, Math.ceil(msLeft / MIN_MS));
      return mins === 1 ? "1 min left" : `${mins} min left`;
    }
    const hours = Math.max(1, Math.ceil(msLeft / HOUR_MS));
    return hours === 1 ? "1 hr left" : `${hours} hr left`;
  }

  const daysLeft = Math.max(1, Math.ceil(msLeft / DAY_MS));
  return daysLeft === 1 ? "1 day left" : `${daysLeft} days left`;
}

export function formatEndsOnText(endAt: Date): string {
  return endAt.toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
}

/**
 * e.g. "6 days left • Ends on 28 May 2025, 08:00 PM"
 * Last day: "12 hr left • Ends on 28 May 2025, 08:00 PM"
 */
export function formatChallengeDaysLeftLabel(
  endAt: Date,
  nowMs = Date.now(),
  race?: ChallengeScheduleFields | null,
): string {
  const msLeft = resolveMsLeft(race ?? null, endAt, nowMs);
  if (msLeft == null) return "Challenge ended";

  const apiLeft =
    (typeof race?.timeLeftLabel === "string" && race.timeLeftLabel.trim()) ||
    (typeof race?.remainingLabel === "string" && race.remainingLabel.trim()) ||
    null;

  let leftText = apiLeft;
  if (!leftText) {
    // Prefer explicit days/hours from API when present.
    const apiDays = Number(race?.daysLeft);
    const apiHours = Number(race?.hoursLeft);
    if (Number.isFinite(apiDays) && apiDays >= 2) {
      leftText = `${Math.floor(apiDays)} days left`;
    } else if (Number.isFinite(apiDays) && apiDays === 1 && Number.isFinite(apiHours) && apiHours < 24) {
      leftText =
        apiHours <= 0
          ? formatRemainingLeftText(msLeft)
          : apiHours === 1
            ? "1 hr left"
            : `${Math.ceil(apiHours)} hr left`;
    } else if (Number.isFinite(apiDays) && apiDays === 1 && !(Number.isFinite(apiHours) && apiHours < 24)) {
      // "1 day left" only when still a full calendar-ish day remaining via API
      leftText = msLeft < DAY_MS ? formatRemainingLeftText(msLeft) : "1 day left";
    } else if (Number.isFinite(apiHours) && apiHours >= 0 && msLeft < DAY_MS) {
      leftText =
        apiHours < 1
          ? formatRemainingLeftText(msLeft)
          : apiHours === 1
            ? "1 hr left"
            : `${Math.ceil(apiHours)} hr left`;
    } else {
      leftText = formatRemainingLeftText(msLeft);
    }
  }

  if (leftText === "Challenge ended") return leftText;
  return `${leftText} • Ends on ${formatEndsOnText(endAt)}`;
}

/**
 * Label for multi-day challenges. Returns null for short/goal-only races.
 */
export function getChallengeDaysLeftLabel(
  race: ChallengeScheduleFields | null | undefined,
  nowMs = Date.now(),
): string | null {
  const end = resolveChallengeEndAt(race);
  if (!end) return null;

  const storedDays = Math.max(0, Math.floor(Number(race?.challengeDurationDays) || 0));
  const inferred = inferDurationDaysFromGoal(race?.targetSteps);
  const durationDays = storedDays >= 2 ? storedDays : inferred >= 2 ? inferred : storedDays;
  const hasExplicitEnd = !!race?.challengeEndAt;
  const msLeft = resolveMsLeft(race, end, nowMs) ?? end.getTime() - nowMs;

  // Multi-day challenges, or any race with an explicit end still in the future.
  if (durationDays >= 2 || (hasExplicitEnd && msLeft > 0) || (Number(race?.timeLeftSeconds) > 0)) {
    return formatChallengeDaysLeftLabel(end, nowMs, race);
  }
  return null;
}
