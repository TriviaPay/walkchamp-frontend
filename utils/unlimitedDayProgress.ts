/**
 * Per-day status derivation + daily-history helpers for the Unlimited Daily
 * Goal Challenge "Daily Progress" modal and Results screen. Pure logic (no
 * React Native imports) so it can be unit tested directly with `npx tsx`.
 *
 * Per-day historical step totals (e.g. "Day 1 · 10,231") are NOT currently
 * exposed by any frontend-reachable endpoint — GET /unlimited-challenges/:id
 * and .../leaderboard only return an aggregate `completedDays` count plus the
 * viewer's CURRENT day row (see Backend/src/lib/unlimitedLiveProgress.ts).
 * `verifiedSteps` is therefore only populated for the viewer's current day
 * (from live health-sync data the caller already has); historical rows carry
 * a `status` derived from backend-authoritative aggregates only — never a
 * frontend-invented step count or pass/fail guess for a specific past day.
 * See the "Backend follow-up" note in the implementation report for the
 * per-day history endpoint this would unlock.
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
  /** Only populated for the viewer's current day (live verified steps). Historical days have no exposed per-day total. */
  verifiedSteps: number | null;
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
