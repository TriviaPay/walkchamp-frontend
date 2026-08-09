/**
 * Per-day status derivation + daily-history helpers for the Unlimited Daily
 * Goal Challenge "Daily Progress" modal and Results screen. Pure logic (no
 * React Native imports) so it can be unit tested directly with `npx tsx`.
 *
 * Prefer GET /unlimited-challenges/:id/daily-history when available — that
 * returns verifiedSteps + dayStatus for every day. Otherwise fall back to
 * aggregate schedule fields (completedDays / viewerStatus) with live steps
 * only on the current day.
 */
import {
  addCalendarDaysToKey,
  type UnlimitedViewerSchedule,
} from "./unlimitedViewerSchedule";

/** Spec §10 — the official Unlimited per-day status model. */
export type UnlimitedDayStatus =
  | "upcoming"
  | "in_progress"
  | "validation_pending"
  | "passed"
  | "failed";

export interface UnlimitedDayRow {
  dayNumber: number;
  /** Calendar date in the participant's locked challenge timezone ("YYYY-MM-DD"). */
  localDate: string;
  status: UnlimitedDayStatus;
  dailyGoalSteps: number;
  /** Populated from daily-history when available; otherwise only the current day. */
  verifiedSteps: number | null;
}

const DAY_STATUSES = new Set<UnlimitedDayStatus>([
  "upcoming",
  "in_progress",
  "validation_pending",
  "passed",
  "failed",
]);

export function normalizeUnlimitedDayStatus(raw: unknown): UnlimitedDayStatus | null {
  const s = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (DAY_STATUSES.has(s as UnlimitedDayStatus)) return s as UnlimitedDayStatus;
  if (s === "pending_verification") return "validation_pending";
  if (s === "pending") return "upcoming";
  return null;
}

export function buildUnlimitedDayRows(schedule: UnlimitedViewerSchedule, todaySteps?: number): UnlimitedDayRow[] {
  const rows: UnlimitedDayRow[] = [];
  const disqualified = schedule.viewerStatus === "failed";
  const passedCount = Math.max(0, Math.min(schedule.completedDays, schedule.durationDays));
  for (let day = 1; day <= schedule.durationDays; day += 1) {
    let status: UnlimitedDayStatus;
    if (day <= passedCount) {
      status = "passed";
    } else if (disqualified && day === passedCount + 1) {
      status = "failed";
    } else if (disqualified && day > passedCount + 1) {
      status = "upcoming";
    } else if (day === schedule.currentDayIndex && schedule.viewerStatus === "active") {
      status = "in_progress";
    } else if (day < schedule.currentDayIndex) {
      // Finalized day the backend hasn't rolled into `completedDays` yet.
      status = "validation_pending";
    } else {
      status = "upcoming";
    }
    rows.push({
      dayNumber: day,
      localDate: addCalendarDaysToKey(schedule.startLocalDate, day - 1),
      status,
      dailyGoalSteps: schedule.dailyGoalSteps,
      verifiedSteps: status === "in_progress" && typeof todaySteps === "number" ? todaySteps : null,
    });
  }
  return rows;
}

/** One day from GET /unlimited-challenges/:id/daily-history. */
export type UnlimitedDailyHistoryDay = {
  dayNumber?: number;
  dayIndex?: number;
  localDate?: string;
  participantLocalDate?: string;
  dayStatus?: string;
  status?: string;
  dailyGoalSteps?: number;
  goalSteps?: number;
  verifiedSteps?: number | null;
};

export type UnlimitedDailyHistoryPayload = {
  durationDays?: number;
  dailyGoalSteps?: number;
  startLocalDate?: string;
  days?: UnlimitedDailyHistoryDay[];
};

/** Map backend daily-history payload → day rows (authoritative verified steps). */
export function dayRowsFromDailyHistory(
  payload: UnlimitedDailyHistoryPayload | null | undefined,
  fallback?: { schedule?: UnlimitedViewerSchedule | null; todaySteps?: number },
): UnlimitedDayRow[] | null {
  const days = Array.isArray(payload?.days) ? payload!.days! : null;
  if (!days || days.length === 0) return null;

  const goalDefault =
    (typeof payload?.dailyGoalSteps === "number" ? payload.dailyGoalSteps : null) ??
    fallback?.schedule?.dailyGoalSteps ??
    0;

  const rows: UnlimitedDayRow[] = days
    .map((d) => {
      const dayNumber = typeof d.dayNumber === "number" ? d.dayNumber : d.dayIndex;
      if (typeof dayNumber !== "number" || dayNumber < 1) return null;
      const status =
        normalizeUnlimitedDayStatus(d.dayStatus) ??
        normalizeUnlimitedDayStatus(d.status) ??
        "upcoming";
      const localDate =
        (typeof d.localDate === "string" && d.localDate) ||
        (typeof d.participantLocalDate === "string" && d.participantLocalDate) ||
        (fallback?.schedule
          ? addCalendarDaysToKey(fallback.schedule.startLocalDate, dayNumber - 1)
          : "");
      let verifiedSteps =
        typeof d.verifiedSteps === "number" ? d.verifiedSteps : null;
      // Keep live sensor total on the open day when history hasn't finalized yet.
      if (
        status === "in_progress" &&
        typeof fallback?.todaySteps === "number" &&
        (verifiedSteps == null || fallback.todaySteps > verifiedSteps)
      ) {
        verifiedSteps = fallback.todaySteps;
      }
      return {
        dayNumber,
        localDate,
        status,
        dailyGoalSteps:
          (typeof d.dailyGoalSteps === "number" ? d.dailyGoalSteps : null) ??
          (typeof d.goalSteps === "number" ? d.goalSteps : null) ??
          goalDefault,
        verifiedSteps,
      } satisfies UnlimitedDayRow;
    })
    .filter((r): r is UnlimitedDayRow => r != null)
    .sort((a, b) => a.dayNumber - b.dayNumber);

  return rows.length > 0 ? rows : null;
}

// ── Daily Progress Summary (spec §14) ─────────────────────────────────────────

export interface UnlimitedDaySummary {
  durationDays: number;
  /** Days concluded either way (passed + failed) — NOT the same as "today's index". */
  completedCount: number;
  passedCount: number;
  failedCount: number;
  remainingCount: number;
}

export function buildUnlimitedDaySummary(rows: UnlimitedDayRow[]): UnlimitedDaySummary {
  let passedCount = 0;
  let failedCount = 0;
  for (const row of rows) {
    if (row.status === "passed") passedCount += 1;
    else if (row.status === "failed") failedCount += 1;
  }
  const completedCount = passedCount + failedCount;
  return {
    durationDays: rows.length,
    completedCount,
    passedCount,
    failedCount,
    remainingCount: Math.max(0, rows.length - completedCount),
  };
}

// ── Long-duration grouping (spec §13) ─────────────────────────────────────────

export interface UnlimitedDayWeekSection {
  /** null for short challenges that don't need a "Week N" header. */
  title: string | null;
  data: UnlimitedDayRow[];
}

/** Groups day rows into "Week N • Days A-B" sections once a challenge is long
 * enough (>10 days) that a flat list becomes hard to scan; short challenges
 * (7/10 days) stay a single ungrouped section. */
export function buildUnlimitedDayWeekSections(rows: UnlimitedDayRow[]): UnlimitedDayWeekSection[] {
  if (rows.length <= 10) {
    return [{ title: null, data: rows }];
  }
  const sections: UnlimitedDayWeekSection[] = [];
  for (let i = 0; i < rows.length; i += 7) {
    const chunk = rows.slice(i, i + 7);
    const weekNumber = i / 7 + 1;
    const first = chunk[0]?.dayNumber ?? i + 1;
    const last = chunk[chunk.length - 1]?.dayNumber ?? first;
    sections.push({ title: `Week ${weekNumber} • Days ${first}-${last}`, data: chunk });
  }
  return sections;
}
