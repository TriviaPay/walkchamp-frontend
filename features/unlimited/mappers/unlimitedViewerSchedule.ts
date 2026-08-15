/**
 * Unlimited Daily Goal Challenge — per-participant ("viewer") schedule.
 *
 * PRODUCT RULE: the host picks a CALENDAR DATE (e.g. "Aug 9, 2026"). Every
 * participant's challenge begins at 12:00 AM on THAT SAME CALENDAR DATE in
 * THEIR OWN locked IANA timezone — never a single UTC instant converted into
 * each participant's local clock (that would show "Aug 8 afternoon" in
 * Chicago for an India host's midnight).
 *
 * Backend today does not return a `viewerStartAt` / `viewerStatus` field on
 * the challenge object itself (see Backend/src/routes/unlimitedChallenge.ts
 * `serializeChallenge`). It DOES already:
 *   - anchor the challenge start (`startAtUtc`) to local midnight of a
 *     calendar date in the HOST's `challengeTimezone`
 *     (Backend/src/lib/challengeDayWindow.ts `validateUnlimitedSchedule`)
 *   - materialize per-participant day windows keyed by each participant's own
 *     LOCKED `participantTimezone` once the challenge activates
 *     (Backend/src/lib/unlimitedChallengeJobs.ts + challengeDayWindow.ts
 *     `buildDayWindows`)
 *   - surface that per-participant window as `timezone` / `dayNumber` /
 *     `localDate` / `dailyGoalSteps` / `qualificationStatus` on each player
 *     row returned by GET /api/unlimited-challenges/:id and .../leaderboard
 *     (Backend/src/lib/unlimitedLiveProgress.ts `loadChallengePlayers`)
 *
 * This module turns those EXISTING fields into the "viewer schedule" the
 * product spec describes:
 *   - Before the challenge activates (no per-day row exists yet), it computes
 *     the same "calendar date at local midnight" rule directly, using the
 *     participant's own resolved timezone (their device's IANA zone — the
 *     same value that becomes their locked `participantTimezone` on
 *     host/join).
 *   - Once a live day row is available for the viewer, it prefers those
 *     backend-authoritative `timezone` / `dayNumber` / `localDate` /
 *     `qualificationStatus` fields over any client computation.
 *
 * No backend change. No invented data — every input is either returned by an
 * existing endpoint or a deterministic computation (a fixed calendar date's
 * midnight in a known IANA zone), never a guess.
 */

export type UnlimitedViewerStatus =
  | "scheduled"
  | "active"
  | "completed"
  | "failed"
  | "left";

export interface UnlimitedChallengeScheduleInput {
  /** Challenge's own start instant (host's local midnight in challengeTimezone). */
  startAtUtc: string | number | null | undefined;
  /** Host/challenge timezone the start was created in (IANA). */
  challengeTimezone: string | null | undefined;
  durationDays: number | null | undefined;
  dailyGoalSteps?: number | null;
  /** Backend challenge.status: waiting|starting|active|settling|completed|cancelled_by_platform. */
  challengeStatus?: string | null;
  /** GET /unlimited-challenges/:id and my-active `viewer` block (authoritative). */
  viewerStartAt?: string | null;
  viewerEndAt?: string | null;
  viewerStatus?: string | null;
  viewerTimezone?: string | null;
  currentDayStartAt?: string | null;
  currentDayEndAt?: string | null;
  currentDayIndex?: number | null;
  currentDayLocalDate?: string | null;
  completedDays?: number | null;
  passedDays?: number | null;
  failedDays?: number | null;
}

export interface UnlimitedViewerLiveDay {
  /** Participant's own LOCKED timezone — only populated once their day window is live. */
  timezone?: string | null;
  dayNumber?: number | null;
  localDate?: string | null;
  dailyGoalSteps?: number | null;
  qualificationStatus?: string | null;
  completedDays?: number | null;
  passedDays?: number | null;
  failedDays?: number | null;
}

export interface UnlimitedViewerSchedule {
  /** "YYYY-MM-DD" — the calendar date the host picked. */
  startLocalDate: string;
  /** Best-known IANA timezone for this viewer. */
  viewerTimezone: string;
  /** True when `viewerTimezone` came from a backend-locked live-day row, not a device guess. */
  viewerTimezoneLocked: boolean;
  /** Local midnight of `startLocalDate` in `viewerTimezone` (ms epoch). */
  viewerStartAtMs: number;
  /** Local midnight of (`startLocalDate` + durationDays) in `viewerTimezone` (ms epoch). */
  viewerEndAtMs: number;
  viewerStatus: UnlimitedViewerStatus;
  durationDays: number;
  /** 1-based; clamped to [1, durationDays]. */
  currentDayIndex: number;
  currentDayLocalDate: string;
  currentDayStartAtMs: number;
  currentDayEndAtMs: number;
  /** durationDays - currentDayIndex, never negative. */
  remainingDaysAfterToday: number;
  dailyGoalSteps: number;
  completedDays: number;
  failedDays: number;
}

// ── IANA-safe zoned-midnight math (frontend port of Backend/src/lib/challengeDayWindow.ts) ──

/** True if `tz` is a valid IANA timezone accepted by Intl. */
export function isValidIanaTimezone(tz: string | null | undefined): tz is string {
  if (!tz) return false;
  try {
    // eslint-disable-next-line no-new
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

interface LocalParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function localPartsInZone(instant: Date, tz: string): LocalParts {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const p = Object.fromEntries(dtf.formatToParts(instant).map((part) => [part.type, part.value]));
  const hour = Number(p.hour) === 24 ? 0 : Number(p.hour);
  return {
    year: Number(p.year),
    month: Number(p.month),
    day: Number(p.day),
    hour,
    minute: Number(p.minute),
    second: Number(p.second),
  };
}

function tzOffsetMs(instant: Date, tz: string): number {
  const lp = localPartsInZone(instant, tz);
  const asUtc = Date.UTC(lp.year, lp.month - 1, lp.day, lp.hour, lp.minute, lp.second);
  return asUtc - instant.getTime();
}

/**
 * The UTC instant (ms) of local midnight (00:00:00) on the given local calendar
 * date in `tz`. Double-corrects the offset so DST-transition days resolve
 * correctly. Mirrors Backend/src/lib/challengeDayWindow.ts `zonedMidnightToUtc`.
 */
export function zonedMidnightToUtcMs(year: number, month: number, day: number, tz: string): number {
  const naive = Date.UTC(year, month - 1, day, 0, 0, 0);
  let utc = naive - tzOffsetMs(new Date(naive), tz);
  utc = naive - tzOffsetMs(new Date(utc), tz);
  return utc;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** Format an instant as YYYY-MM-DD in an IANA timezone (DST-safe). */
export function formatDateKeyInZone(instant: Date | number, tz: string): string | null {
  const date = instant instanceof Date ? instant : new Date(instant);
  if (Number.isNaN(date.getTime())) return null;
  if (!isValidIanaTimezone(tz)) return null;
  const p = localPartsInZone(date, tz);
  return `${p.year}-${pad2(p.month)}-${pad2(p.day)}`;
}

function parseDateKey(key: string): { year: number; month: number; day: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!m) return null;
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
}

/** Local midnight (ms epoch) of a "YYYY-MM-DD" calendar date in `tz`. */
export function zonedMidnightMsFromDateKey(dateKey: string, tz: string): number | null {
  const p = parseDateKey(dateKey);
  if (!p || !isValidIanaTimezone(tz)) return null;
  return zonedMidnightToUtcMs(p.year, p.month, p.day, tz);
}

/** Add `n` calendar days to a "YYYY-MM-DD" key (pure calendar arithmetic, DST-safe). */
export function addCalendarDaysToKey(dateKey: string, n: number): string {
  const p = parseDateKey(dateKey);
  if (!p) return dateKey;
  const d = new Date(Date.UTC(p.year, p.month - 1, p.day));
  d.setUTCDate(d.getUTCDate() + n);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

/** Civil-date ordinal (days since epoch) — lets us diff calendar dates without DST-unsafe ms division. */
function civilOrdinalFromKey(dateKey: string): number | null {
  const p = parseDateKey(dateKey);
  if (!p) return null;
  return Math.floor(Date.UTC(p.year, p.month - 1, p.day) / 86_400_000);
}

// ── Viewer schedule computation ───────────────────────────────────────────────

function resolveViewerStatus(params: {
  challengeStatus: string | null | undefined;
  qualificationStatus: string | null | undefined;
  nowMs: number;
  viewerStartAtMs: number;
  viewerEndAtMs: number;
}): UnlimitedViewerStatus {
  const q = (params.qualificationStatus ?? "").trim().toLowerCase();
  if (q === "left") return "left";
  if (q === "disqualified") return "failed";

  const cs = (params.challengeStatus ?? "").trim().toLowerCase();
  if (cs === "completed") return "completed";
  if (cs === "cancelled_by_platform" || cs === "cancelled" || cs === "canceled") {
    return "completed";
  }

  if (params.nowMs < params.viewerStartAtMs) return "scheduled";
  if (params.nowMs >= params.viewerEndAtMs) return "completed";
  return "active";
}

/**
 * Compute the viewer-personalized schedule for an Unlimited Daily Goal Challenge.
 * Returns null when required inputs (durationDays / startAtUtc) are missing —
 * callers should treat that as "not enough data yet", never invent a schedule.
 */
export function computeUnlimitedViewerSchedule(
  challenge: UnlimitedChallengeScheduleInput,
  opts: {
    /** Backend-authoritative per-day fields for the current viewer, when available. */
    liveDay?: UnlimitedViewerLiveDay | null;
    /** Fallback timezone (device) used ONLY before the participant's day window is live. */
    fallbackTimezone: string;
    nowMs?: number;
  },
): UnlimitedViewerSchedule | null {
  const durationDays =
    Number(challenge.durationDays) > 0 ? Math.floor(Number(challenge.durationDays)) : 0;
  if (!durationDays) return null;

  const challengeTz = isValidIanaTimezone(challenge.challengeTimezone)
    ? challenge.challengeTimezone
    : "UTC";
  const startAtMs =
    challenge.startAtUtc != null ? new Date(challenge.startAtUtc).getTime() : NaN;
  if (!Number.isFinite(startAtMs)) return null;

  const startLocalDate = formatDateKeyInZone(startAtMs, challengeTz);
  if (!startLocalDate) return null;

  const nowMs = opts.nowMs ?? Date.now();
  const dailyGoalSteps = Math.max(
    0,
    Math.floor(Number(opts.liveDay?.dailyGoalSteps ?? challenge.dailyGoalSteps ?? 0)),
  );

  const viewerTimezoneRaw = isValidIanaTimezone(challenge.viewerTimezone)
    ? challenge.viewerTimezone
    : isValidIanaTimezone(opts.liveDay?.timezone)
    ? (opts.liveDay!.timezone as string)
    : null;
  const viewerTimezone =
    viewerTimezoneRaw ?? (isValidIanaTimezone(opts.fallbackTimezone) ? opts.fallbackTimezone : "UTC");
  const viewerTimezoneLocked = !!viewerTimezoneRaw;

  const apiStartMs =
    challenge.viewerStartAt != null ? new Date(challenge.viewerStartAt).getTime() : NaN;
  const apiEndMs =
    challenge.viewerEndAt != null ? new Date(challenge.viewerEndAt).getTime() : NaN;
  const viewerStartAtMs = Number.isFinite(apiStartMs)
    ? apiStartMs
    : zonedMidnightMsFromDateKey(startLocalDate, viewerTimezone) ?? startAtMs;
  const endLocalDate = addCalendarDaysToKey(startLocalDate, durationDays);
  const viewerEndAtMs = Number.isFinite(apiEndMs)
    ? apiEndMs
    : zonedMidnightMsFromDateKey(endLocalDate, viewerTimezone) ?? viewerStartAtMs;

  let currentDayIndex: number;
  let currentDayLocalDate: string;
  if (
    challenge.currentDayIndex != null &&
    challenge.currentDayLocalDate
  ) {
    currentDayIndex = Math.min(durationDays, Math.max(1, Math.floor(challenge.currentDayIndex)));
    currentDayLocalDate = challenge.currentDayLocalDate;
  } else if (opts.liveDay?.dayNumber != null && opts.liveDay.localDate) {
    currentDayIndex = Math.min(durationDays, Math.max(1, Math.floor(opts.liveDay.dayNumber)));
    currentDayLocalDate = opts.liveDay.localDate;
  } else if (nowMs < viewerStartAtMs) {
    currentDayIndex = 1;
    currentDayLocalDate = startLocalDate;
  } else if (nowMs >= viewerEndAtMs) {
    currentDayIndex = durationDays;
    currentDayLocalDate = addCalendarDaysToKey(startLocalDate, durationDays - 1);
  } else {
    // Mid-challenge fallback for the brief gap before a live-day row is fetched:
    // count elapsed civil days between startLocalDate and "today" in viewerTimezone.
    const todayKey = formatDateKeyInZone(nowMs, viewerTimezone) ?? startLocalDate;
    const startOrd = civilOrdinalFromKey(startLocalDate) ?? 0;
    const todayOrd = civilOrdinalFromKey(todayKey) ?? startOrd;
    currentDayIndex = Math.min(durationDays, Math.max(1, todayOrd - startOrd + 1));
    currentDayLocalDate = addCalendarDaysToKey(startLocalDate, currentDayIndex - 1);
  }

  const apiDayStart =
    challenge.currentDayStartAt != null ? new Date(challenge.currentDayStartAt).getTime() : NaN;
  const apiDayEnd =
    challenge.currentDayEndAt != null ? new Date(challenge.currentDayEndAt).getTime() : NaN;
  const currentDayStartAtMs = Number.isFinite(apiDayStart)
    ? apiDayStart
    : zonedMidnightMsFromDateKey(currentDayLocalDate, viewerTimezone) ?? viewerStartAtMs;
  const currentDayEndAtMs = Number.isFinite(apiDayEnd)
    ? apiDayEnd
    : zonedMidnightMsFromDateKey(addCalendarDaysToKey(currentDayLocalDate, 1), viewerTimezone) ??
      currentDayStartAtMs;
  const remainingDaysAfterToday = Math.max(0, durationDays - currentDayIndex);

  const apiStatus = (challenge.viewerStatus ?? "").trim().toLowerCase();
  const viewerStatus: UnlimitedViewerStatus =
    apiStatus === "scheduled" ||
    apiStatus === "active" ||
    apiStatus === "completed" ||
    apiStatus === "failed" ||
    apiStatus === "left"
      ? apiStatus
      : resolveViewerStatus({
          challengeStatus: challenge.challengeStatus,
          qualificationStatus: opts.liveDay?.qualificationStatus,
          nowMs,
          viewerStartAtMs,
          viewerEndAtMs,
        });

  return {
    startLocalDate,
    viewerTimezone,
    viewerTimezoneLocked,
    viewerStartAtMs,
    viewerEndAtMs,
    viewerStatus,
    durationDays,
    currentDayIndex,
    currentDayLocalDate,
    currentDayStartAtMs,
    currentDayEndAtMs,
    remainingDaysAfterToday,
    dailyGoalSteps,
    completedDays: Math.max(
      0,
      Math.floor(
        Number(
          opts.liveDay?.completedDays ??
            challenge.completedDays ??
            challenge.passedDays ??
            0,
        ),
      ),
    ),
    failedDays: Math.max(
      0,
      Math.floor(Number(opts.liveDay?.failedDays ?? challenge.failedDays ?? 0)),
    ),
  };
}

// ── Display formatting ────────────────────────────────────────────────────────

const MONTH_ABBR = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/** "2026-08-09" → "Aug 9, 2026" (calendar-date only — never routed through a Date/timezone conversion). */
export function formatDateKeyLabel(dateKey: string): string {
  const p = parseDateKey(dateKey);
  if (!p) return dateKey;
  return `${MONTH_ABBR[p.month - 1]} ${p.day}, ${p.year}`;
}

/** "Aug 9, 2026 • 12:00 AM" — the viewer's own local midnight start, calendar-date based. */
export function formatViewerStartLabel(schedule: Pick<UnlimitedViewerSchedule, "startLocalDate">): string {
  return `${formatDateKeyLabel(schedule.startLocalDate)} • 12:00 AM`;
}

/** "Aug 16, 2026 • 12:00 AM" — viewer's own local midnight end (start + durationDays). */
export function formatViewerEndLabel(
  schedule: Pick<UnlimitedViewerSchedule, "startLocalDate" | "durationDays">,
): string {
  const endLocalDate = addCalendarDaysToKey(schedule.startLocalDate, schedule.durationDays);
  return `${formatDateKeyLabel(endLocalDate)} • 12:00 AM`;
}

export const UNLIMITED_LOCAL_MIDNIGHT_NOTE =
  "Starts at midnight in each participant's local challenge timezone.";

export interface CountdownParts {
  h: number;
  m: number;
  s: number;
  totalMs: number;
  expired: boolean;
}

/** ms remaining until `targetMs` broken into H/M/S — shared by waiting room + current-day countdowns. */
export function computeCountdownParts(targetMs: number, nowMs: number = Date.now()): CountdownParts {
  const diff = targetMs - nowMs;
  if (diff <= 0) return { h: 0, m: 0, s: 0, totalMs: 0, expired: true };
  const h = Math.floor(diff / 3_600_000);
  const m = Math.floor((diff % 3_600_000) / 60_000);
  const s = Math.floor((diff % 60_000) / 1_000);
  return { h, m, s, totalMs: diff, expired: false };
}

/** "06:28:35" (HH:MM:SS, zero-padded, hours uncapped for multi-day-safe display). */
export function formatCountdownClock(parts: CountdownParts): string {
  if (parts.expired) return "00:00:00";
  return `${pad2(parts.h)}:${pad2(parts.m)}:${pad2(parts.s)}`;
}
