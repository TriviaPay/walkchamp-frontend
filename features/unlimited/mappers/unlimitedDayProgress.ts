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

/**
 * Visible "current day" for Challenge Progress / live streak card.
 * If daily-history still has exactly one in_progress day, prefer that over a
 * schedule index that can be one day ahead (timezone / window edge).
 */
export function resolveUnlimitedDisplayDayIndex(
  schedule: UnlimitedViewerSchedule,
  historyRows?: UnlimitedDayRow[] | null,
): number {
  const inProgress = (historyRows ?? []).filter((r) => r.status === "in_progress");
  if (inProgress.length === 1) {
    const n = Math.floor(inProgress[0]!.dayNumber);
    if (n >= 1 && n <= schedule.durationDays) return n;
  }
  return Math.min(schedule.durationDays, Math.max(1, Math.floor(schedule.currentDayIndex || 1)));
}

export function remainingDaysAfterDisplayDay(
  durationDays: number,
  displayDayIndex: number,
): number {
  return Math.max(0, Math.floor(durationDays) - Math.floor(displayDayIndex));
}

/** True when the day cell should show a green tick (passed, or today's goal already met). */
export function isUnlimitedDayCellPassed(
  row: UnlimitedDayRow,
  opts: { isCurrent: boolean; todaySteps: number },
): boolean {
  if (row.status === "passed") return true;
  if (row.status === "failed") return false;
  const goal = row.dailyGoalSteps;
  if (!(opts.isCurrent && goal > 0)) return false;
  const steps =
    typeof row.verifiedSteps === "number" ? row.verifiedSteps : opts.todaySteps;
  return steps >= goal;
}

export function buildUnlimitedDayRows(schedule: UnlimitedViewerSchedule, todaySteps?: number): UnlimitedDayRow[] {
  const rows: UnlimitedDayRow[] = [];
  const disqualified = schedule.viewerStatus === "failed";
  const passedCount = Math.max(0, Math.min(schedule.completedDays, schedule.durationDays));
  const failedCount = Math.max(0, Math.min(schedule.failedDays ?? 0, schedule.durationDays - passedCount));
  for (let day = 1; day <= schedule.durationDays; day += 1) {
    let status: UnlimitedDayStatus;
    if (day <= passedCount) {
      status = "passed";
    } else if (failedCount > 0 && day === passedCount + 1) {
      status = "failed";
    } else if (disqualified && day === passedCount + 1) {
      status = "failed";
    } else if ((disqualified || failedCount > 0) && day > passedCount + 1 && day < schedule.currentDayIndex) {
      status = "upcoming";
    } else if (day === schedule.currentDayIndex && (schedule.viewerStatus === "active" || schedule.viewerStatus === "failed")) {
      status = "in_progress";
    } else if (day < schedule.currentDayIndex) {
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
  passedDays?: number;
  failedDays?: number;
  pendingDays?: number;
  viewerResultsReady?: boolean;
  viewerResultReasonCode?: string | null;
  prizePoolEligibilityStatus?: string | null;
  eligibilityReasonCode?: string | null;
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
        normalizeUnlimitedDayStatus((d as { storedStatus?: string }).storedStatus) ??
        "upcoming";
      const localDate =
        (typeof d.localDate === "string" && d.localDate) ||
        (typeof d.participantLocalDate === "string" && d.participantLocalDate) ||
        (fallback?.schedule
          ? addCalendarDaysToKey(fallback.schedule.startLocalDate, dayNumber - 1)
          : "");
      let verifiedSteps =
        typeof d.verifiedSteps === "number" ? d.verifiedSteps : null;
      // Open day: prefer the live Health Connect total from Walk when it is ahead
      // of a lagging history row. Callers must pass HC/HK todaySteps, not sensor.
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

  if (rows.length === 0) return null;

  const passedHint = typeof payload?.passedDays === "number" ? payload.passedDays : 0;
  const failedHint = typeof payload?.failedDays === "number" ? payload.failedDays : 0;
  if (passedHint > 0 && !rows.some((r) => r.status === "passed")) {
    for (const row of rows) {
      if (row.dayNumber <= passedHint && row.status !== "failed") row.status = "passed";
    }
  }
  if (failedHint > 0 && !rows.some((r) => r.status === "failed")) {
    const failDay = Math.min(rows.length, passedHint + 1);
    const hit = rows.find((r) => r.dayNumber === failDay);
    if (hit && hit.status !== "passed") hit.status = "failed";
  }

  // History may only return days that already started — pad to full challenge length
  // so the Challenge Progress UI can show the total week/duration (Image 1).
  if (fallback?.schedule && fallback.schedule.durationDays > rows.length) {
    return mergeUnlimitedHistoryWithSchedule(rows, fallback.schedule, fallback.todaySteps);
  }
  return rows;
}

/**
 * Overlay verified daily-history onto a full duration skeleton so the modal
 * always shows Day 1…N (not only the partial history window).
 */
export function mergeUnlimitedHistoryWithSchedule(
  historyRows: UnlimitedDayRow[] | null | undefined,
  schedule: UnlimitedViewerSchedule,
  todaySteps?: number,
): UnlimitedDayRow[] {
  const displayDay = resolveUnlimitedDisplayDayIndex(schedule, historyRows);
  const base = buildUnlimitedDayRows(
    { ...schedule, currentDayIndex: displayDay },
    todaySteps,
  );
  if (!historyRows?.length) return base;
  const byDay = new Map(historyRows.map((r) => [r.dayNumber, r]));
  return base.map((row) => {
    const hit = byDay.get(row.dayNumber);
    const isCurrent = row.dayNumber === displayDay;
    if (!hit) {
      return isCurrent && typeof todaySteps === "number"
        ? { ...row, status: "in_progress", verifiedSteps: todaySteps }
        : row;
    }
    if (isCurrent) {
      const verifiedSteps =
        typeof todaySteps === "number"
          ? Math.max(todaySteps, hit.verifiedSteps ?? 0)
          : hit.verifiedSteps;
      return {
        ...row,
        ...hit,
        status: "in_progress",
        localDate: hit.localDate || row.localDate,
        dailyGoalSteps: hit.dailyGoalSteps > 0 ? hit.dailyGoalSteps : row.dailyGoalSteps,
        verifiedSteps,
      };
    }
    // Don't paint today's live steps on a previous day still marked in_progress.
    if (
      (hit.status === "in_progress" || hit.status === "upcoming" || hit.status === "validation_pending") &&
      row.dayNumber < displayDay
    ) {
      const goal = hit.dailyGoalSteps > 0 ? hit.dailyGoalSteps : row.dailyGoalSteps;
      const steps = hit.verifiedSteps;
      let status: UnlimitedDayStatus = "validation_pending";
      if (typeof steps === "number" && goal > 0) {
        status = steps >= goal ? "passed" : "failed";
      } else if (schedule.completedDays > 0 && row.dayNumber <= schedule.completedDays) {
        status = "passed";
      } else if ((schedule.failedDays ?? 0) > 0 && row.dayNumber === schedule.completedDays + 1) {
        status = "failed";
      }
      return {
        ...row,
        ...hit,
        status,
        verifiedSteps: hit.verifiedSteps,
        localDate: hit.localDate || row.localDate,
        dailyGoalSteps: goal,
      };
    }
    return {
      ...row,
      ...hit,
      localDate: hit.localDate || row.localDate,
      dailyGoalSteps: hit.dailyGoalSteps > 0 ? hit.dailyGoalSteps : row.dailyGoalSteps,
      verifiedSteps: hit.verifiedSteps,
    };
  });
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
