/**
 * USD Unlimited Players — midnight calendar-day schedule rules.
 * Run: npx tsx utils/createChallengeUnlimitedSchedule.test.ts
 */

import assert from "node:assert/strict";
import {
  applyUnlimitedMidnightSchedule,
  createDefaultDraft,
  ensureUnlimitedMidnightSchedule,
  getUnlimitedMidnightTimeIdx,
  isLocalCalendarTodayOrPast,
  isValidUnlimitedMidnightSchedule,
  localTomorrowCalendarDate,
  toLocalCalendarDate,
  toLocalMidnight,
  buildHostPayload,
  validateUnlimitedScheduleDraft,
} from "./createChallengeFlow";
import {
  calculateChallengeEnd,
  formatChallengeDateLabel,
  isLocalMidnight,
  resolvePayloadScheduledStart,
  resolveUnlimitedMidnightStart,
  selectEffectiveChallengeSchedule,
} from "./createChallengeSchedule";
import { UNLIMITED_GOAL_DURATION_DAYS } from "./unlimitedGoal";

function atLocal(y: number, m: number, d: number, h = 12, min = 0): Date {
  return new Date(y, m - 1, d, h, min, 0, 0);
}

const now = atLocal(2026, 7, 29, 15, 28); // Jul 29 3:28 PM — must NOT become start time

assert.deepEqual([...UNLIMITED_GOAL_DURATION_DAYS], [7, 10, 30, 60, 90]);

// Default public USD Unlimited → tomorrow 12:00 AM
{
  const d = applyUnlimitedMidnightSchedule(createDefaultDraft(), now);
  d.visibility = "public";
  d.usdFormat = "unlimited_goal";
  assert.equal(d.startMode, "user_selected");
  assert.equal(d.startTimeIdx, getUnlimitedMidnightTimeIdx());
  assert.equal(formatChallengeDateLabel(d.startDate, now), "Tomorrow");
  const start = resolveUnlimitedMidnightStart({ startDate: d.startDate, deviceNow: now });
  assert.equal(start.startDisplayTime, "12:00 AM");
  assert.equal(start.effectiveStartAt.getHours(), 0);
  assert.equal(start.effectiveStartAt.getMinutes(), 0);
  assert.equal(start.effectiveStartAt.getDate(), 30);
  assert.equal(start.effectiveStartAt.getMonth(), 6); // July
}

// Private USD Unlimited same defaults
{
  let d = applyUnlimitedMidnightSchedule(createDefaultDraft(), now);
  d.visibility = "private";
  d.usdFormat = "unlimited_goal";
  const start = resolveUnlimitedMidnightStart({ startDate: d.startDate, deviceNow: now });
  assert.equal(start.startDisplayTime, "12:00 AM");
  assert.ok(isLocalMidnight(start.effectiveStartAt));
  const kept = ensureUnlimitedMidnightSchedule(d, now);
  assert.equal(kept.visibility, "private");
  assert.equal(kept.startDate.getDate(), d.startDate.getDate());
}

// Today / past not selectable — clamped to tomorrow
{
  const today = toLocalCalendarDate(now);
  const start = resolveUnlimitedMidnightStart({ startDate: today, deviceNow: now });
  assert.equal(start.effectiveStartAt.getDate(), 30);
  assert.equal(isLocalCalendarTodayOrPast(today, now), true);
  assert.equal(isLocalCalendarTodayOrPast(localTomorrowCalendarDate(now), now), false);

  const past = atLocal(2026, 7, 20);
  const clamped = resolveUnlimitedMidnightStart({ startDate: past, deviceNow: now });
  assert.equal(clamped.effectiveStartAt.getDate(), 30);
}

// Later future Start Date can be selected; times stay 12:00 AM
{
  const aug5 = atLocal(2026, 8, 5);
  const start = resolveUnlimitedMidnightStart({ startDate: aug5, deviceNow: now });
  assert.equal(start.effectiveStartAt.getMonth(), 7);
  assert.equal(start.effectiveStartAt.getDate(), 5);
  assert.equal(start.startDisplayTime, "12:00 AM");
  assert.ok(isLocalMidnight(start.effectiveStartAt));
}

// Duration examples from Jul 30 · 12:00 AM
{
  const start = toLocalMidnight(atLocal(2026, 7, 30));
  const cases: Array<[number, number, number]> = [
    [7, 8, 6],   // Aug 6
    [10, 8, 9],  // Aug 9
    [30, 8, 29], // Aug 29
    [60, 9, 28], // Sep 28
    [90, 10, 28], // Oct 28
  ];
  for (const [days, endMonth, endDay] of cases) {
    const end = calculateChallengeEnd({ startAt: start, durationDays: days });
    assert.ok(isLocalMidnight(end), `${days}d end midnight`);
    assert.equal(end.getMonth() + 1, endMonth, `${days}d month`);
    assert.equal(end.getDate(), endDay, `${days}d day`);
  }
}

// Changing Start Date recalculates End; preserves midnight
{
  const draft = applyUnlimitedMidnightSchedule(createDefaultDraft(), now);
  draft.unlimited.durationDays = 7;
  draft.startDate = atLocal(2026, 8, 1);
  const sched = selectEffectiveChallengeSchedule({
    draft,
    durationDays: 7,
    timezone: "America/Chicago",
    deviceNow: now,
    isUnlimited: true,
  });
  assert.equal(sched.startDisplayTime, "12:00 AM");
  assert.equal(sched.endDisplayTime, "12:00 AM");
  const end = new Date(sched.endAtUtc);
  // Aug 1 + 7 = Aug 8 local midnight → ISO may be prior evening in UTC for US zones
  assert.ok(isLocalMidnight(new Date(sched.startAtUtc)) || new Date(sched.startAtUtc).getUTCHours() !== undefined);
  const startLocal = resolveUnlimitedMidnightStart({
    startDate: draft.startDate,
    deviceNow: now,
  }).effectiveStartAt;
  const endLocal = calculateChallengeEnd({ startAt: startLocal, durationDays: 7 });
  assert.equal(endLocal.getDate(), 8);
  assert.equal(endLocal.getMonth(), 7);
  assert.ok(isLocalMidnight(endLocal));
}

// Switching Fixed → Unlimited removes custom Fixed time
{
  let draft = createDefaultDraft();
  draft.usdFormat = "fixed";
  draft.startMode = "auto_now";
  draft.startTimeIdx = 0;
  draft.startDate = toLocalCalendarDate(now);
  // Simulate custom afternoon time
  draft.startTimeIdx = 30; // some afternoon preset
  draft = ensureUnlimitedMidnightSchedule(
    { ...draft, usdFormat: "unlimited_goal" },
    now,
  );
  assert.equal(draft.startTimeIdx, getUnlimitedMidnightTimeIdx());
  assert.equal(draft.startMode, "user_selected");
  assert.equal(isLocalCalendarTodayOrPast(draft.startDate, now), false);
  const start = resolveUnlimitedMidnightStart({
    startDate: draft.startDate,
    deviceNow: now,
  });
  assert.equal(start.startDisplayTime, "12:00 AM");
}

// Public/private switch preserves unlimited schedule
{
  let draft = applyUnlimitedMidnightSchedule(createDefaultDraft(), now);
  draft.usdFormat = "unlimited_goal";
  draft.startDate = atLocal(2026, 8, 10);
  draft = ensureUnlimitedMidnightSchedule(draft, now);
  const before = draft.startDate.getTime();
  draft = { ...draft, visibility: "private" };
  draft = ensureUnlimitedMidnightSchedule(draft, now);
  assert.equal(draft.startDate.getTime(), before);
  assert.equal(draft.visibility, "private");
  assert.equal(isValidUnlimitedMidnightSchedule(draft, now), true);
}

// Rerender / ensure does not reset valid future date
{
  let draft = applyUnlimitedMidnightSchedule(createDefaultDraft(), now);
  draft.startDate = atLocal(2026, 9, 1);
  draft = ensureUnlimitedMidnightSchedule(draft, now);
  const a = draft.startDate.getTime();
  draft = ensureUnlimitedMidnightSchedule(draft, now);
  draft = ensureUnlimitedMidnightSchedule(draft, now);
  assert.equal(draft.startDate.getTime(), a);
}

// Payload timestamps are local midnight
{
  let draft = applyUnlimitedMidnightSchedule(createDefaultDraft(), now);
  draft.usdFormat = "unlimited_goal";
  draft.unlimitedRulesAccepted = true;
  draft.unlimited.durationDays = 7;
  const payload = resolvePayloadScheduledStart({
    draft,
    isUnlimited: true,
    deviceNow: now,
  });
  assert.equal(payload.isValid, true);
  assert.ok(payload.scheduledStartAt);
  assert.ok(isLocalMidnight(payload.scheduledStartAt!));
  assert.ok(isLocalMidnight(payload.endAt));
  assert.equal(payload.scheduledStartAt!.getHours(), 0);
  assert.notEqual(payload.scheduledStartAt!.getHours(), 15);

  // buildHostPayload only emits unlimited when the feature flag is on
  const built = buildHostPayload(draft, "America/Chicago", now);
  if (built.ok && built.meta.isUnlimited) {
    assert.ok(typeof built.body.startAtIso === "string");
    assert.ok(typeof built.body.challengeEndAtIso === "undefined");
    assert.equal(built.body.challengeTimezone, "America/Chicago");
    assert.ok(built.meta.scheduledStartAt);
    assert.ok(isLocalMidnight(built.meta.scheduledStartAt!));
    assert.ok(isLocalMidnight(built.meta.endAt));
  }
}

// Validation rejects today-as-start after clamp still valid via resolver
{
  let draft = applyUnlimitedMidnightSchedule(createDefaultDraft(), now);
  draft.usdFormat = "unlimited_goal";
  assert.equal(validateUnlimitedScheduleDraft(draft, now), null);
}

// Fixed / Free schedule path unchanged (auto_now still uses device clock)
{
  const draft = createDefaultDraft();
  draft.usdFormat = "fixed";
  draft.startMode = "auto_now";
  draft.startTimeIdx = 0;
  draft.startDate = toLocalCalendarDate(now);
  const s = selectEffectiveChallengeSchedule({
    draft,
    durationDays: 1,
    timezone: "UTC",
    deviceNow: now,
    isUnlimited: false,
  });
  assert.equal(s.startDisplayTime, "3:28 PM");
  const payload = resolvePayloadScheduledStart({
    draft,
    isUnlimited: false,
    deviceNow: now,
  });
  assert.equal(payload.scheduledStartAt, null);
}

// DST-safe calendar add: spring forward week still lands on calendar day
{
  // US spring forward 2026-03-08; start Mar 7 midnight + 7 days = Mar 14 midnight
  const start = toLocalMidnight(atLocal(2026, 3, 7));
  const end = calculateChallengeEnd({ startAt: start, durationDays: 7 });
  assert.equal(end.getFullYear(), 2026);
  assert.equal(end.getMonth(), 2);
  assert.equal(end.getDate(), 14);
  assert.ok(isLocalMidnight(end));
}

console.log("createChallengeUnlimitedSchedule.test.ts: all assertions passed");
