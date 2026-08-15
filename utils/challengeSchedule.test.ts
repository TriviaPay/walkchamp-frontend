import assert from "node:assert/strict";
import {
  CLASSIC_RACE_DURATION_MS,
  SPONSORED_RACE_DURATION_MS,
  resolveRaceWindowEndAt,
} from "./challengeSchedule";

// Classic free race: started 12:40 PM 13 Aug → ends 12:40 PM 14 Aug.
{
  const started = new Date(2026, 7, 13, 12, 40, 0, 0);
  const end = resolveRaceWindowEndAt({
    startedAt: started.toISOString(),
    challengeDurationDays: 0,
  });
  assert.ok(end);
  assert.equal(end!.getTime() - started.getTime(), CLASSIC_RACE_DURATION_MS);
  assert.equal(end!.getFullYear(), 2026);
  assert.equal(end!.getMonth(), 7);
  assert.equal(end!.getDate(), 14);
  assert.equal(end!.getHours(), 12);
  assert.equal(end!.getMinutes(), 40);
}

// Ignore invented now+remaining that is not the 24h window.
{
  const started = new Date(2026, 7, 13, 12, 40, 0, 0);
  const fake = new Date(started.getTime() + 2 * 60 * 60 * 1000).toISOString();
  const end = resolveRaceWindowEndAt({
    startedAt: started.toISOString(),
    challengeEndAt: fake,
    challengeDurationDays: 0,
  });
  assert.ok(end);
  assert.equal(end!.getTime(), started.getTime() + CLASSIC_RACE_DURATION_MS);
}

// Trust API end when it is the 24h window.
{
  const started = new Date(2026, 7, 13, 12, 40, 0, 0);
  const api = new Date(started.getTime() + CLASSIC_RACE_DURATION_MS).toISOString();
  const end = resolveRaceWindowEndAt({
    startedAt: started.toISOString(),
    challengeEndAt: api,
    challengeDurationDays: 0,
  });
  assert.ok(end);
  assert.equal(end!.toISOString(), api);
}

// Sponsored = start + 3h.
{
  const started = new Date(2026, 7, 13, 12, 40, 0, 0);
  const end = resolveRaceWindowEndAt({
    startedAt: started.toISOString(),
    isSponsored: true,
  });
  assert.ok(end);
  assert.equal(end!.getTime() - started.getTime(), SPONSORED_RACE_DURATION_MS);
  assert.equal(end!.getHours(), 15);
  assert.equal(end!.getMinutes(), 40);
  assert.equal(end!.getDate(), 13);
}

// Multi-day uses duration days.
{
  const started = new Date(2026, 7, 13, 12, 40, 0, 0);
  const end = resolveRaceWindowEndAt({
    startedAt: started.toISOString(),
    challengeDurationDays: 7,
  });
  assert.ok(end);
  assert.equal(end!.getDate(), 20);
  assert.equal(end!.getHours(), 12);
  assert.equal(end!.getMinutes(), 40);
}

// Streak / unlimited: start + duration days, not a single 24h day.
{
  const started = new Date(2026, 7, 16, 0, 0, 0, 0);
  const end = resolveRaceWindowEndAt({
    startedAt: started.toISOString(),
    challengeDurationDays: 7,
    isUnlimited: true,
  });
  assert.ok(end);
  assert.equal(end!.getTime() - started.getTime(), 7 * CLASSIC_RACE_DURATION_MS);
  assert.equal(end!.getDate(), 23);
}

// Streak ignores a 1-day API window when duration is 7.
{
  const started = new Date(2026, 7, 16, 0, 0, 0, 0);
  const dayEnd = new Date(started.getTime() + CLASSIC_RACE_DURATION_MS).toISOString();
  const end = resolveRaceWindowEndAt({
    startedAt: started.toISOString(),
    challengeEndAt: dayEnd,
    challengeDurationDays: 7,
    isUnlimited: true,
  });
  assert.ok(end);
  assert.equal(end!.getDate(), 23);
}

console.log("challengeSchedule.test.ts ok");
