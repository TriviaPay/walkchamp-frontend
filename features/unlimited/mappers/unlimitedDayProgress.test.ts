/**
 * Run: npx tsx utils/unlimitedDayProgress.test.ts
 */
import assert from "node:assert/strict";
import {
  buildUnlimitedDayRows,
  buildUnlimitedDaySummary,
  buildUnlimitedDayWeekSections,
  dayRowsFromDailyHistory,
  isUnlimitedDayCellPassed,
  mergeUnlimitedHistoryWithSchedule,
  remainingDaysAfterDisplayDay,
  resolveUnlimitedDisplayDayIndex,
} from "./unlimitedDayProgress";
import { computeUnlimitedViewerSchedule, type UnlimitedViewerSchedule } from "./unlimitedViewerSchedule";

function scheduleFor(opts: {
  durationDays: number;
  currentDayIndex: number;
  completedDays: number;
  viewerStatus?: "scheduled" | "active" | "completed" | "failed" | "left";
}): UnlimitedViewerSchedule {
  const startAtUtc = "2026-08-08T18:30:00.000Z";
  const schedule = computeUnlimitedViewerSchedule(
    {
      startAtUtc,
      challengeTimezone: "Asia/Kolkata",
      durationDays: opts.durationDays,
      challengeStatus: opts.viewerStatus === "failed" ? "active" : opts.viewerStatus,
    },
    {
      fallbackTimezone: "Asia/Kolkata",
      liveDay: {
        timezone: "Asia/Kolkata",
        dayNumber: opts.currentDayIndex,
        localDate: "2026-08-09",
        completedDays: opts.completedDays,
        qualificationStatus: opts.viewerStatus === "failed" ? "disqualified" : undefined,
      },
      nowMs: new Date(startAtUtc).getTime(),
    },
  );
  assert.ok(schedule);
  return schedule!;
}

// ── DURATION UI: exactly N day rows for every supported duration (spec §9) ───
for (const durationDays of [7, 10, 30, 60, 90]) {
  const schedule = scheduleFor({ durationDays, currentDayIndex: 3, completedDays: 2 });
  const rows = buildUnlimitedDayRows(schedule);
  assert.equal(rows.length, durationDays, `expected exactly ${durationDays} day rows`);
  assert.equal(rows[0]!.dayNumber, 1);
  assert.equal(rows[durationDays - 1]!.dayNumber, durationDays);
  // Each row's localDate must be a distinct, sequential calendar date.
  assert.equal(rows[0]!.localDate, "2026-08-09");
  assert.equal(rows[1]!.localDate, "2026-08-10");
}

// ── STATUS: passed / in_progress / upcoming (eligible participant) ────────────
{
  const schedule = scheduleFor({ durationDays: 7, currentDayIndex: 3, completedDays: 2 });
  const rows = buildUnlimitedDayRows(schedule, 8420);
  assert.equal(rows[0]!.status, "passed");
  assert.equal(rows[1]!.status, "passed");
  assert.equal(rows[2]!.status, "in_progress");
  assert.equal(rows[2]!.verifiedSteps, 8420, "in-progress day carries live verified steps");
  assert.equal(rows[3]!.status, "upcoming");
  assert.equal(rows[3]!.verifiedSteps, null, "upcoming days never show an invented step count");
  assert.equal(rows[6]!.status, "upcoming");
  // Never mark a future day "failed" — only disqualified participants get "failed" rows.
  assert.ok(rows.slice(3).every((r) => r.status !== "failed"));
}

// ── STATUS: disqualified participant shows exactly one "failed" day ──────────
{
  const schedule = scheduleFor({
    durationDays: 7,
    currentDayIndex: 4,
    completedDays: 2,
    viewerStatus: "failed",
  });
  const rows = buildUnlimitedDayRows(schedule);
  assert.equal(rows[0]!.status, "passed");
  assert.equal(rows[1]!.status, "passed");
  assert.equal(rows[2]!.status, "failed");
  // Missed-day users stay in the race: current day stays in progress.
  assert.equal(rows[3]!.status, "in_progress");
  assert.ok(rows.slice(4).every((r) => r.status === "upcoming"));
}

// ── STATUS: validation_pending for a finalized day the aggregate hasn't caught up to ──
{
  // currentDayIndex=5 but completedDays only reflects 2 passed days — days 3-4
  // have ended in the viewer's timezone but the backend hasn't rolled them into
  // completedDays yet (still finalizing).
  const schedule = scheduleFor({ durationDays: 7, currentDayIndex: 5, completedDays: 2 });
  const rows = buildUnlimitedDayRows(schedule);
  assert.equal(rows[2]!.status, "validation_pending");
  assert.equal(rows[3]!.status, "validation_pending");
  assert.equal(rows[4]!.status, "in_progress");
}

// ── DAILY PROGRESS SUMMARY (spec §14) ─────────────────────────────────────────
{
  const schedule = scheduleFor({ durationDays: 30, currentDayIndex: 25, completedDays: 22 });
  // Simulate 2 finalized-failed days landing at day 23/24 via a disqualified fixture instead:
  const failedSchedule = scheduleFor({
    durationDays: 30,
    currentDayIndex: 25,
    completedDays: 22,
    viewerStatus: "failed",
  });
  const rows = buildUnlimitedDayRows(failedSchedule);
  const summary = buildUnlimitedDaySummary(rows);
  assert.equal(summary.durationDays, 30);
  assert.equal(summary.passedCount, 22);
  assert.equal(summary.failedCount, 1);
  assert.equal(summary.completedCount, 23);
  assert.equal(summary.remainingCount, 7);

  // During-challenge (no failures yet): Completed 5/7, Passed 5, Failed 0, Remaining 2.
  const activeSchedule = scheduleFor({ durationDays: 7, currentDayIndex: 6, completedDays: 5 });
  const activeRows = buildUnlimitedDayRows(activeSchedule);
  const activeSummary = buildUnlimitedDaySummary(activeRows);
  assert.equal(activeSummary.passedCount, 5);
  assert.equal(activeSummary.failedCount, 0);
  assert.equal(activeSummary.completedCount, 5);
  assert.equal(activeSummary.remainingCount, 2);
  void schedule;
}

// ── LONG-DURATION GROUPING (spec §13) ─────────────────────────────────────────
{
  // 7/10-day challenges stay a single ungrouped section.
  for (const durationDays of [7, 10]) {
    const schedule = scheduleFor({ durationDays, currentDayIndex: 3, completedDays: 2 });
    const rows = buildUnlimitedDayRows(schedule);
    const sections = buildUnlimitedDayWeekSections(rows);
    assert.equal(sections.length, 1);
    assert.equal(sections[0]!.title, null);
    assert.equal(sections[0]!.data.length, durationDays);
  }

  // 30-day challenge groups into 5 week sections of 7 (last one shorter is N/A here: 30/7=4 full + 1 of 2).
  {
    const schedule = scheduleFor({ durationDays: 30, currentDayIndex: 3, completedDays: 2 });
    const rows = buildUnlimitedDayRows(schedule);
    const sections = buildUnlimitedDayWeekSections(rows);
    assert.equal(sections.length, 5);
    assert.equal(sections[0]!.title, "Week 1 • Days 1-7");
    assert.equal(sections[4]!.title, "Week 5 • Days 29-30");
    assert.equal(sections.reduce((n, s) => n + s.data.length, 0), 30);
  }

  // 90-day challenge renders efficiently: exactly 13 week sections, all 90 rows present.
  {
    const schedule = scheduleFor({ durationDays: 90, currentDayIndex: 3, completedDays: 2 });
    const rows = buildUnlimitedDayRows(schedule);
    const sections = buildUnlimitedDayWeekSections(rows);
    assert.equal(sections.length, 13);
    assert.equal(sections.reduce((n, s) => n + s.data.length, 0), 90);
  }
}

// ── Partial history pads to full duration (Challenge Progress Image 1) ────────
{
  const schedule = scheduleFor({ durationDays: 7, currentDayIndex: 2, completedDays: 1 });
  const partial = dayRowsFromDailyHistory(
    {
      durationDays: 7,
      dailyGoalSteps: 10_000,
      days: [
        { dayNumber: 1, dayStatus: "passed", verifiedSteps: 10_231 },
        { dayNumber: 2, dayStatus: "in_progress", verifiedSteps: 100 },
      ],
    },
    { schedule, todaySteps: 8420 },
  );
  assert.ok(partial);
  assert.equal(partial!.length, 7, "partial history must expand to full challenge length");
  assert.equal(partial![0]!.verifiedSteps, 10_231);
  assert.equal(partial![1]!.verifiedSteps, 8420, "live todaySteps wins on in_progress");
  assert.equal(partial![2]!.status, "upcoming");
  assert.equal(partial![6]!.dayNumber, 7);

  const merged = mergeUnlimitedHistoryWithSchedule(partial!.slice(0, 2), schedule, 8420);
  assert.equal(merged.length, 7);
  assert.equal(merged[1]!.verifiedSteps, 8420);
}

// Schedule index ahead of history in_progress → display the live history day.
{
  const schedule = scheduleFor({ durationDays: 7, currentDayIndex: 2, completedDays: 0 });
  const history = [
    { dayNumber: 1, localDate: "2026-08-09", status: "in_progress" as const, dailyGoalSteps: 10_000, verifiedSteps: 132 },
    { dayNumber: 2, localDate: "2026-08-10", status: "upcoming" as const, dailyGoalSteps: 10_000, verifiedSteps: null },
  ];
  assert.equal(resolveUnlimitedDisplayDayIndex(schedule, history), 1);
  assert.equal(remainingDaysAfterDisplayDay(7, 1), 6);
  const merged = mergeUnlimitedHistoryWithSchedule(history, schedule, 132);
  assert.equal(merged[0]!.status, "in_progress");
  assert.equal(merged[0]!.verifiedSteps, 132);
  assert.equal(merged[1]!.status, "upcoming");
}

// Past days still marked in_progress with met goal → passed (not Pending).
{
  const schedule = scheduleFor({ durationDays: 7, currentDayIndex: 7, completedDays: 6 });
  const history = Array.from({ length: 7 }, (_, i) => ({
    dayNumber: i + 1,
    localDate: `2026-08-${String(9 + i).padStart(2, "0")}`,
    status: "in_progress" as const,
    dailyGoalSteps: 100,
    verifiedSteps: i === 6 ? 40 : 100,
  }));
  const merged = mergeUnlimitedHistoryWithSchedule(history, schedule, 40);
  assert.equal(merged[0]!.status, "passed");
  assert.equal(merged[5]!.status, "passed");
  assert.equal(merged[6]!.status, "in_progress");
}

// Current day with goal already met still stays in_progress in data, but the
// Challenge Progress cell shows a tick (not a live ring).
{
  const schedule = scheduleFor({ durationDays: 7, currentDayIndex: 1, completedDays: 0 });
  const rows = buildUnlimitedDayRows(schedule, 210);
  assert.equal(rows[0]!.status, "in_progress");
  assert.equal(rows[0]!.verifiedSteps, 210);
  rows[0]!.dailyGoalSteps = 100;
  assert.equal(isUnlimitedDayCellPassed(rows[0]!, { isCurrent: true, todaySteps: 210 }), true);
  assert.equal(isUnlimitedDayCellPassed(rows[1]!, { isCurrent: false, todaySteps: 210 }), false);
  const failedRow = { ...rows[0]!, status: "failed" as const, verifiedSteps: 40 };
  assert.equal(isUnlimitedDayCellPassed(failedRow, { isCurrent: true, todaySteps: 40 }), false);
}

console.log("unlimitedDayProgress.test.ts: ok");
