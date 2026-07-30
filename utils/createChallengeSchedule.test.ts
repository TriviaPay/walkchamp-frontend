import assert from "node:assert/strict";
import {
  applyAutoNowMode,
  applyUserSelectedStart,
  calculateChallengeEnd,
  normalizeToLocalMinute,
  resolveEffectiveChallengeStart,
  resolvePayloadScheduledStart,
  resolveStartMode,
  selectEffectiveChallengeSchedule,
} from "./createChallengeSchedule";
import {
  applyUnlimitedMidnightSchedule,
  createDefaultDraft,
  TIME_PRESETS_WITH_NOW,
  toLocalCalendarDate,
} from "./createChallengeFlow";

function atLocal(y: number, m: number, d: number, h: number, min: number): Date {
  return new Date(y, m - 1, d, h, min, 0, 0);
}

const noon = atLocal(2026, 7, 28, 12, 10);

function fixedAutoNowDraft() {
  const draft = createDefaultDraft();
  draft.usdFormat = "fixed";
  draft.startMode = "auto_now";
  draft.startTimeIdx = 0;
  draft.startDate = toLocalCalendarDate(noon);
  return draft;
}

// normalize
{
  const n = normalizeToLocalMinute(atLocal(2026, 7, 28, 12, 10,));
  // seconds cleared
  assert.equal(n.getSeconds(), 0);
  assert.equal(n.getMilliseconds(), 0);
}

// auto_now follows device clock
{
  const draft = fixedAutoNowDraft();
  assert.equal(draft.startMode, "auto_now");
  assert.equal(resolveStartMode(draft, noon), "auto_now");
  const a = resolveEffectiveChallengeStart({ draft, deviceNow: noon });
  assert.equal(a.isValid, true);
  assert.equal(a.startMode, "auto_now");
  assert.equal(a.startDisplayTime, "12:10 PM");
  assert.equal(a.startDisplayDate, "Today");

  const later = atLocal(2026, 7, 28, 12, 19);
  const b = resolveEffectiveChallengeStart({ draft, deviceNow: later });
  assert.equal(b.startDisplayTime, "12:19 PM");

  const end = calculateChallengeEnd({ startAt: b.effectiveStartAt, durationDays: 7 });
  assert.equal(end.getMonth(), 7); // August (0-indexed)
  assert.equal(end.getDate(), 4);
  assert.equal(end.getHours(), later.getHours());
  assert.equal(end.getMinutes(), later.getMinutes());
}

// user_selected stays fixed while clock advances
{
  let draft = fixedAutoNowDraft();
  // Find a preset at 12:30
  const idx = TIME_PRESETS_WITH_NOW.findIndex((p) => p.hour === 12 && p.minute === 30 && !p.isNow);
  assert.ok(idx > 0);
  draft = applyUserSelectedStart(draft, noon, idx);
  assert.equal(draft.startMode, "user_selected");

  const at1210 = resolveEffectiveChallengeStart({ draft, deviceNow: noon });
  assert.equal(at1210.isValid, true);
  assert.equal(at1210.startDisplayTime, "12:30 PM");

  const at1220 = resolveEffectiveChallengeStart({
    draft,
    deviceNow: atLocal(2026, 7, 28, 12, 20),
  });
  assert.equal(at1220.isValid, true);
  assert.equal(at1220.startDisplayTime, "12:30 PM");

  // Becomes past
  const at1231 = resolveEffectiveChallengeStart({
    draft,
    deviceNow: atLocal(2026, 7, 28, 12, 31),
  });
  assert.equal(at1231.isValid, false);
  assert.match(at1231.validationMessage ?? "", /passed/i);
}

// Use current time restores auto_now
{
  let draft = fixedAutoNowDraft();
  draft = applyUserSelectedStart(draft, noon, 10);
  draft = applyAutoNowMode(draft, noon);
  assert.equal(draft.startMode, "auto_now");
  assert.equal(draft.startTimeIdx, 0);
  assert.equal(resolveEffectiveChallengeStart({ draft, deviceNow: noon }).startMode, "auto_now");
}

// Review schedule stays live for auto_now
{
  const draft = fixedAutoNowDraft();
  const s1 = selectEffectiveChallengeSchedule({
    draft,
    durationDays: 7,
    timezone: "America/Chicago",
    deviceNow: noon,
    isUnlimited: false,
  });
  assert.equal(s1.startDisplayTime, "12:10 PM");
  assert.equal(s1.endDisplayTime, "12:10 PM");
  assert.match(s1.helperLabel, /current time/i);

  const s2 = selectEffectiveChallengeSchedule({
    draft,
    durationDays: 7,
    timezone: "America/Chicago",
    deviceNow: atLocal(2026, 7, 28, 12, 16),
    isUnlimited: false,
  });
  assert.equal(s2.startDisplayTime, "12:16 PM");
  assert.equal(s2.endDisplayTime, "12:16 PM");
}

// Unlimited payload uses concrete local midnight start (not device clock)
{
  const draft = applyUnlimitedMidnightSchedule(createDefaultDraft(), noon);
  draft.usdFormat = "unlimited_goal";
  const payload = resolvePayloadScheduledStart({
    draft,
    isUnlimited: true,
    deviceNow: noon,
  });
  assert.equal(payload.isValid, true);
  assert.ok(payload.scheduledStartAt);
  assert.equal(payload.scheduledStartAt!.getHours(), 0);
  assert.equal(payload.scheduledStartAt!.getMinutes(), 0);
  // Start is tomorrow relative to noon (Jul 28) → Jul 29
  assert.equal(payload.scheduledStartAt!.getDate(), 29);
}

// Free/Fixed auto_now payload uses immediate (null) start
{
  const draft = fixedAutoNowDraft();
  const payload = resolvePayloadScheduledStart({
    draft,
    isUnlimited: false,
    deviceNow: noon,
  });
  assert.equal(payload.isValid, true);
  assert.equal(payload.scheduledStartAt, null);
}

console.log("createChallengeSchedule.test.ts: ok");
