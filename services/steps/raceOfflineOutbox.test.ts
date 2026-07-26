/**
 * Race offline outbox cumulative compaction semantics (mirrors RaceSyncOutbox.kt).
 * Run: npx tsx services/steps/raceOfflineOutbox.test.ts
 */

import assert from "node:assert/strict";

type OutboxItem = {
  userId: string;
  raceId: string;
  raceSteps: number;
  todaySteps: number;
  stepSource: string;
  clientTimestamp: number;
};

/** Latest-value compaction — never replay deltas; reject lower stale totals. */
function compactRaceOutbox(
  existing: OutboxItem | null,
  incoming: OutboxItem,
): OutboxItem {
  if (!existing) return incoming;
  if (existing.userId !== incoming.userId || existing.raceId !== incoming.raceId) {
    return incoming;
  }
  if (existing.raceSteps > incoming.raceSteps) {
    return {
      ...existing,
      todaySteps: Math.max(existing.todaySteps, incoming.todaySteps),
      clientTimestamp: Math.max(existing.clientTimestamp, incoming.clientTimestamp),
      stepSource: incoming.stepSource || existing.stepSource,
    };
  }
  return incoming;
}

function shouldReplayOutbox(params: {
  raceActive: boolean;
  outboxSteps: number;
  lastAcceptedSteps: number;
}): boolean {
  if (!params.raceActive) return false;
  return params.outboxSteps > params.lastAcceptedSteps;
}

{
  const queued = [
    { userId: "u1", raceId: "r1", raceSteps: 1000, todaySteps: 5000, stepSource: "android_step_counter", clientTimestamp: 1 },
    { userId: "u1", raceId: "r1", raceSteps: 1040, todaySteps: 5040, stepSource: "android_step_counter", clientTimestamp: 2 },
    { userId: "u1", raceId: "r1", raceSteps: 1100, todaySteps: 5100, stepSource: "android_step_counter", clientTimestamp: 3 },
  ];
  let state: OutboxItem | null = null;
  for (const item of queued) {
    state = compactRaceOutbox(state, item);
  }
  assert.equal(state?.raceSteps, 1100, "keep highest cumulative");
  assert.equal(state?.stepSource, "android_step_counter");
}

{
  const high = {
    userId: "u1",
    raceId: "r1",
    raceSteps: 1100,
    todaySteps: 5100,
    stepSource: "android_step_counter",
    clientTimestamp: 3,
  };
  const stale = {
    userId: "u1",
    raceId: "r1",
    raceSteps: 1000,
    todaySteps: 5000,
    stepSource: "android_step_counter",
    clientTimestamp: 4,
  };
  const merged = compactRaceOutbox(high, stale);
  assert.equal(merged.raceSteps, 1100, "stale lower rejected");
}

{
  assert.equal(
    shouldReplayOutbox({ raceActive: false, outboxSteps: 1100, lastAcceptedSteps: 900 }),
    false,
    "race-ended replay rejected",
  );
  assert.equal(
    shouldReplayOutbox({ raceActive: true, outboxSteps: 1100, lastAcceptedSteps: 1100 }),
    false,
    "unchanged cumulative skipped",
  );
  assert.equal(
    shouldReplayOutbox({ raceActive: true, outboxSteps: 1100, lastAcceptedSteps: 900 }),
    true,
    "reconnect submits latest cumulative",
  );
}

{
  const ios = compactRaceOutbox(null, {
    userId: "u1",
    raceId: "r1",
    raceSteps: 200,
    todaySteps: 200,
    stepSource: "ios_pedometer",
    clientTimestamp: 1,
  });
  assert.equal(ios.stepSource, "ios_pedometer");
}

console.log("raceOfflineOutbox.test.ts: all passed");
