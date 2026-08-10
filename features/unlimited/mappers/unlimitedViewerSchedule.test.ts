/**
 * Run: npx tsx utils/unlimitedViewerSchedule.test.ts
 */
import assert from "node:assert/strict";
import {
  addCalendarDaysToKey,
  computeCountdownParts,
  computeUnlimitedViewerSchedule,
  formatCountdownClock,
  formatDateKeyInZone,
  formatDateKeyLabel,
  formatViewerEndLabel,
  formatViewerStartLabel,
  zonedMidnightMsFromDateKey,
} from "./unlimitedViewerSchedule";

// ── INDIA HOST → INDIA PARTICIPANT ──────────────────────────────────────────
// Host picks Aug 9, 2026 12:00 AM Asia/Kolkata → startAtUtc = Aug 8 18:30 UTC.
{
  const startAtUtc = "2026-08-08T18:30:00.000Z";
  const schedule = computeUnlimitedViewerSchedule(
    { startAtUtc, challengeTimezone: "Asia/Kolkata", durationDays: 7, dailyGoalSteps: 10_000 },
    { fallbackTimezone: "Asia/Kolkata", nowMs: new Date("2026-08-01T00:00:00.000Z").getTime() },
  );
  assert.ok(schedule);
  assert.equal(schedule!.startLocalDate, "2026-08-09");
  assert.equal(formatViewerStartLabel(schedule!), "Aug 9, 2026 • 12:00 AM");
  assert.equal(formatViewerEndLabel(schedule!), "Aug 16, 2026 • 12:00 AM");
  assert.equal(schedule!.viewerStatus, "scheduled");
  assert.equal(schedule!.durationDays, 7);
}

// ── INDIA HOST → CHICAGO PARTICIPANT ────────────────────────────────────────
// Must show Aug 9 12:00 AM America/Chicago — NOT "Aug 8 afternoon".
{
  const startAtUtc = "2026-08-08T18:30:00.000Z"; // Aug 9 12:00 AM IST
  const schedule = computeUnlimitedViewerSchedule(
    { startAtUtc, challengeTimezone: "Asia/Kolkata", durationDays: 7, dailyGoalSteps: 10_000 },
    { fallbackTimezone: "America/Chicago", nowMs: new Date("2026-08-01T00:00:00.000Z").getTime() },
  );
  assert.ok(schedule);
  // startLocalDate is derived from the HOST's calendar date, then re-anchored
  // to the viewer's own timezone midnight — never a raw UTC→local conversion.
  assert.equal(schedule!.startLocalDate, "2026-08-09");
  assert.equal(formatViewerStartLabel(schedule!), "Aug 9, 2026 • 12:00 AM");
  assert.notEqual(formatViewerStartLabel(schedule!), "Aug 8, 2026 • 1:30 PM");
  // Confirm the actual instant is midnight America/Chicago on Aug 9, not the raw UTC instant.
  const expectedMs = zonedMidnightMsFromDateKey("2026-08-09", "America/Chicago")!;
  assert.equal(schedule!.viewerStartAtMs, expectedMs);
  assert.notEqual(schedule!.viewerStartAtMs, new Date(startAtUtc).getTime());
}

// ── INDIA HOST → NEW YORK PARTICIPANT ───────────────────────────────────────
{
  const startAtUtc = "2026-08-08T18:30:00.000Z";
  const schedule = computeUnlimitedViewerSchedule(
    { startAtUtc, challengeTimezone: "Asia/Kolkata", durationDays: 10, dailyGoalSteps: 8_000 },
    { fallbackTimezone: "America/New_York", nowMs: new Date("2026-08-01T00:00:00.000Z").getTime() },
  );
  assert.ok(schedule);
  assert.equal(schedule!.startLocalDate, "2026-08-09");
  assert.equal(
    schedule!.viewerStartAtMs,
    zonedMidnightMsFromDateKey("2026-08-09", "America/New_York"),
  );
}

// ── US HOST → INDIA PARTICIPANT ─────────────────────────────────────────────
// Host (Chicago) picks Aug 9 12:00 AM America/Chicago → startAtUtc = Aug 9 05:00 UTC.
{
  const startAtUtc = "2026-08-09T05:00:00.000Z";
  const schedule = computeUnlimitedViewerSchedule(
    { startAtUtc, challengeTimezone: "America/Chicago", durationDays: 7, dailyGoalSteps: 10_000 },
    { fallbackTimezone: "Asia/Kolkata", nowMs: new Date("2026-08-01T00:00:00.000Z").getTime() },
  );
  assert.ok(schedule);
  assert.equal(schedule!.startLocalDate, "2026-08-09");
  assert.equal(
    schedule!.viewerStartAtMs,
    zonedMidnightMsFromDateKey("2026-08-09", "Asia/Kolkata"),
  );
}

// ── STATUS: India viewer active while Chicago viewer still scheduled ───────
{
  const startAtUtc = "2026-08-08T18:30:00.000Z"; // Aug 9 12:00 AM IST
  // A moment after IST midnight but well before Chicago midnight the same civil date.
  const nowMs = new Date("2026-08-08T19:00:00.000Z").getTime();
  const indiaSchedule = computeUnlimitedViewerSchedule(
    { startAtUtc, challengeTimezone: "Asia/Kolkata", durationDays: 7, challengeStatus: "active" },
    { fallbackTimezone: "Asia/Kolkata", nowMs },
  );
  const chicagoSchedule = computeUnlimitedViewerSchedule(
    { startAtUtc, challengeTimezone: "Asia/Kolkata", durationDays: 7, challengeStatus: "active" },
    { fallbackTimezone: "America/Chicago", nowMs },
  );
  assert.ok(indiaSchedule && chicagoSchedule);
  assert.equal(indiaSchedule!.viewerStatus, "active");
  assert.equal(chicagoSchedule!.viewerStatus, "scheduled");
}

// ── DURATION: exactly N UI days for every supported duration ───────────────
for (const durationDays of [7, 10, 30, 60, 90]) {
  const startAtUtc = "2026-08-08T18:30:00.000Z";
  const schedule = computeUnlimitedViewerSchedule(
    { startAtUtc, challengeTimezone: "Asia/Kolkata", durationDays },
    { fallbackTimezone: "Asia/Kolkata", nowMs: new Date("2026-08-01T00:00:00.000Z").getTime() },
  );
  assert.ok(schedule);
  assert.equal(schedule!.durationDays, durationDays);
  const endLocalDate = addCalendarDaysToKey(schedule!.startLocalDate, durationDays);
  assert.equal(schedule!.viewerEndAtMs, zonedMidnightMsFromDateKey(endLocalDate, schedule!.viewerTimezone));
}

// ── MIDNIGHT: only the participant whose locked timezone crossed midnight advances ──
{
  const startAtUtc = "2026-08-08T18:30:00.000Z"; // Aug 9 12:00 AM IST
  // Just after India's Day-2 midnight (Aug 10 00:00 IST = Aug 9 18:30 UTC), before Chicago's.
  const nowMs = new Date("2026-08-09T19:00:00.000Z").getTime();
  const indiaSchedule = computeUnlimitedViewerSchedule(
    { startAtUtc, challengeTimezone: "Asia/Kolkata", durationDays: 7, challengeStatus: "active" },
    { fallbackTimezone: "Asia/Kolkata", nowMs },
  );
  const chicagoSchedule = computeUnlimitedViewerSchedule(
    { startAtUtc, challengeTimezone: "Asia/Kolkata", durationDays: 7, challengeStatus: "active" },
    { fallbackTimezone: "America/Chicago", nowMs },
  );
  assert.ok(indiaSchedule && chicagoSchedule);
  assert.equal(indiaSchedule!.currentDayIndex, 2, "India crossed local midnight into Day 2");
  assert.equal(chicagoSchedule!.currentDayIndex, 1, "Chicago has not reached Day 2 local midnight yet");
}

// ── TRAVEL: device timezone change never alters the locked schedule once the
// backend has returned a locked liveDay.timezone ─────────────────────────────
{
  const startAtUtc = "2026-08-08T18:30:00.000Z";
  const nowMs = new Date("2026-08-10T12:00:00.000Z").getTime();
  // Participant joined from Chicago (locked), backend liveDay reports it —
  // device timezone has since "changed" to New York (simulated travel), but
  // the fallbackTimezone must be ignored because a locked liveDay is present.
  const schedule = computeUnlimitedViewerSchedule(
    { startAtUtc, challengeTimezone: "Asia/Kolkata", durationDays: 7, challengeStatus: "active" },
    {
      fallbackTimezone: "America/New_York", // simulated new device timezone after travel
      liveDay: { timezone: "America/Chicago", dayNumber: 2, localDate: "2026-08-09" },
      nowMs,
    },
  );
  assert.ok(schedule);
  assert.equal(schedule!.viewerTimezone, "America/Chicago");
  assert.equal(schedule!.viewerTimezoneLocked, true);
  assert.equal(
    schedule!.currentDayStartAtMs,
    zonedMidnightMsFromDateKey("2026-08-09", "America/Chicago"),
  );
}

// ── REALTIME: a Day-3 participant's schedule computation does not require or
// get disturbed by another participant's different local date ─────────────
{
  const startAtUtc = "2026-08-08T18:30:00.000Z";
  const nowMs = new Date("2026-08-11T12:00:00.000Z").getTime();
  const day3Schedule = computeUnlimitedViewerSchedule(
    { startAtUtc, challengeTimezone: "Asia/Kolkata", durationDays: 7, challengeStatus: "active" },
    {
      fallbackTimezone: "Asia/Kolkata",
      liveDay: { timezone: "Asia/Kolkata", dayNumber: 3, localDate: "2026-08-11", completedDays: 2 },
      nowMs,
    },
  );
  const day2Schedule = computeUnlimitedViewerSchedule(
    { startAtUtc, challengeTimezone: "Asia/Kolkata", durationDays: 7, challengeStatus: "active" },
    {
      fallbackTimezone: "America/Chicago",
      liveDay: { timezone: "America/Chicago", dayNumber: 2, localDate: "2026-08-10", completedDays: 1 },
      nowMs,
    },
  );
  assert.ok(day3Schedule && day2Schedule);
  assert.equal(day3Schedule!.currentDayIndex, 3);
  assert.equal(day2Schedule!.currentDayIndex, 2);
  assert.equal(day3Schedule!.remainingDaysAfterToday, 4);
  assert.equal(day2Schedule!.remainingDaysAfterToday, 5);
}

// ── qualificationStatus mapping ──────────────────────────────────────────
{
  const startAtUtc = "2026-08-08T18:30:00.000Z";
  const nowMs = new Date("2026-08-11T12:00:00.000Z").getTime();
  const left = computeUnlimitedViewerSchedule(
    { startAtUtc, challengeTimezone: "Asia/Kolkata", durationDays: 7, challengeStatus: "active" },
    { fallbackTimezone: "Asia/Kolkata", liveDay: { qualificationStatus: "left" }, nowMs },
  );
  const disqualified = computeUnlimitedViewerSchedule(
    { startAtUtc, challengeTimezone: "Asia/Kolkata", durationDays: 7, challengeStatus: "active" },
    { fallbackTimezone: "Asia/Kolkata", liveDay: { qualificationStatus: "disqualified" }, nowMs },
  );
  assert.equal(left!.viewerStatus, "left");
  assert.equal(disqualified!.viewerStatus, "failed");
}

// ── DST: countdown against backend timestamps stays correct across a spring-forward ──
{
  // America/Chicago springs forward on 2026-03-08 (2:00 AM → 3:00 AM, 23-hour day).
  const startAtUtc = zonedMidnightMsFromDateKey("2026-03-07", "America/Chicago")!;
  const schedule = computeUnlimitedViewerSchedule(
    { startAtUtc, challengeTimezone: "America/Chicago", durationDays: 7, challengeStatus: "active" },
    { fallbackTimezone: "America/Chicago", nowMs: new Date(startAtUtc).getTime() },
  );
  assert.ok(schedule);
  const day2StartMs = zonedMidnightMsFromDateKey("2026-03-08", "America/Chicago")!;
  const day3StartMs = zonedMidnightMsFromDateKey("2026-03-09", "America/Chicago")!;
  // The DST day is 23 hours, not 24 — a naive +86_400_000 ms/day loop would drift.
  assert.equal(day3StartMs - day2StartMs, 23 * 60 * 60 * 1000);
}

// ── Formatting helpers ──────────────────────────────────────────────────────
assert.equal(formatDateKeyLabel("2026-08-09"), "Aug 9, 2026");
assert.equal(addCalendarDaysToKey("2026-08-09", 7), "2026-08-16");
assert.equal(formatDateKeyInZone(new Date("2026-08-08T18:30:00.000Z"), "Asia/Kolkata"), "2026-08-09");
assert.equal(formatDateKeyInZone(new Date("2026-08-08T18:30:00.000Z"), "America/Chicago"), "2026-08-08");

assert.equal(formatCountdownClock(computeCountdownParts(1000, 0)), "00:00:01");
assert.equal(
  formatCountdownClock(computeCountdownParts(6 * 3_600_000 + 28 * 60_000 + 35_000, 0)),
  "06:28:35",
);
assert.equal(computeCountdownParts(0, 1000).expired, true);

console.log("unlimitedViewerSchedule.test.ts: ok");
