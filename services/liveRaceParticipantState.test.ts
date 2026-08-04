/**
 * Pure merge/progress semantics (no RN imports).
 * Mirrors services/liveRaceParticipantState.ts — kept inline so tsx can run without RN.
 * Run: npx tsx services/liveRaceParticipantState.test.ts
 */
import assert from "node:assert/strict";

function mergeMonotonicParticipantSteps(
  existing: number,
  incoming: number,
  raceCompleted: boolean,
  opts?: {
    existingDayKey?: string | null;
    incomingDayKey?: string | null;
    dayAware?: boolean;
  },
): number {
  const prev = Math.max(0, Math.floor(existing));
  const next = Math.max(0, Math.floor(incoming));
  if (
    opts?.dayAware &&
    opts.incomingDayKey &&
    opts.existingDayKey &&
    opts.incomingDayKey !== opts.existingDayKey
  ) {
    return next;
  }
  if (opts?.dayAware && opts.incomingDayKey && !opts.existingDayKey) {
    return next;
  }
  if (raceCompleted) return prev > 0 ? prev : next;
  return Math.max(prev, next);
}

function isIncomingProgressNewer(
  existingUpdatedAt?: string | null,
  incomingUpdatedAt?: string | null,
): boolean | null {
  if (!existingUpdatedAt || !incomingUpdatedAt) return null;
  const a = Date.parse(existingUpdatedAt);
  const b = Date.parse(incomingUpdatedAt);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  if (b > a) return true;
  if (b < a) return false;
  return null;
}

type P = {
  id: string;
  userId: string;
  currentSteps: number;
  rank?: number | null;
  challengeDayKey?: string | null;
  progressUpdatedAt?: string | null;
  temporaryFromRealtime?: boolean;
};

function mergeParticipantsPreservingSteps(
  previous: P[],
  incoming: P[],
  options?: { raceCompleted?: boolean; dayAware?: boolean },
): P[] {
  const raceCompleted = options?.raceCompleted === true;
  const dayAware = options?.dayAware === true;
  if (!Array.isArray(incoming) || incoming.length === 0) {
    return previous.length > 0 ? previous : incoming;
  }
  const prevByUser = new Map<string, P>();
  for (const p of previous) {
    if (p.userId) prevByUser.set(p.userId, p);
  }
  const seen = new Set<string>();
  const merged: P[] = incoming.map((p) => {
    const key = p.userId || p.id;
    if (key) seen.add(key);
    const prev = p.userId ? prevByUser.get(p.userId) : undefined;
    if (!prev) return { ...p, temporaryFromRealtime: false };
    const nextDayKey = p.challengeDayKey ?? null;
    const prevDayKey = prev.challengeDayKey ?? null;
    const newer = isIncomingProgressNewer(prev.progressUpdatedAt, p.progressUpdatedAt);
    let currentSteps: number;
    if (newer === false) {
      currentSteps = prev.currentSteps;
    } else if (newer === true) {
      currentSteps = Math.max(0, Math.floor(p.currentSteps));
      if (dayAware && nextDayKey && prevDayKey && nextDayKey !== prevDayKey) {
        currentSteps = mergeMonotonicParticipantSteps(0, p.currentSteps, raceCompleted, {
          dayAware,
          existingDayKey: prevDayKey,
          incomingDayKey: nextDayKey,
        });
      }
    } else {
      currentSteps = mergeMonotonicParticipantSteps(
        prev.currentSteps,
        p.currentSteps,
        raceCompleted,
        { dayAware, existingDayKey: prevDayKey, incomingDayKey: nextDayKey },
      );
    }
    return {
      ...prev,
      ...p,
      currentSteps,
      challengeDayKey: nextDayKey ?? prevDayKey,
      temporaryFromRealtime: false,
      rank: p.rank ?? prev.rank,
    };
  });
  for (const p of previous) {
    const key = p.userId || p.id;
    if (!key || seen.has(key)) continue;
    if (p.temporaryFromRealtime) continue;
    merged.push(p);
  }
  return merged;
}

function applyParticipantProgressEvent(
  participants: P[],
  event: {
    participantId?: string;
    userId?: string;
    steps: number;
    rank?: number;
    updatedAt?: string | null;
  },
  options?: { allowTemporaryUpsert?: boolean },
): { next: P[]; changed: boolean } {
  let matched = false;
  let changed = false;
  const next = participants.map((p) => {
    const match =
      (event.participantId && p.id === event.participantId) ||
      (event.userId && p.userId === event.userId);
    if (!match) return p;
    matched = true;
    const newer = isIncomingProgressNewer(p.progressUpdatedAt, event.updatedAt);
    if (newer === false) return p;
    const merged = mergeMonotonicParticipantSteps(p.currentSteps, event.steps, false);
    if (merged === p.currentSteps && (event.rank ?? p.rank) === p.rank) return p;
    changed = true;
    return {
      ...p,
      currentSteps: merged,
      rank: event.rank ?? p.rank,
      progressUpdatedAt: event.updatedAt ?? p.progressUpdatedAt,
    };
  });
  if (!matched && options?.allowTemporaryUpsert !== false && (event.userId || event.participantId)) {
    const userId = event.userId ?? event.participantId!;
    changed = true;
    next.push({
      id: event.participantId ?? userId,
      userId,
      currentSteps: event.steps,
      temporaryFromRealtime: true,
    });
  }
  return { next: changed ? next : participants, changed };
}

function applyLeaderboardSnapshot(
  participants: P[],
  standings: Array<{ userId?: string; participantId?: string; steps?: number; rank?: number }>,
): { next: P[]; changed: boolean } {
  let next = participants;
  let any = false;
  for (const row of standings) {
    if (typeof row.steps !== "number") continue;
    const applied = applyParticipantProgressEvent(
      next,
      {
        userId: row.userId,
        participantId: row.participantId,
        steps: row.steps,
        rank: row.rank,
      },
      { allowTemporaryUpsert: false },
    );
    if (applied.changed) {
      any = true;
      next = applied.next;
    }
  }
  return { next: any ? next : participants, changed: any };
}

const prev: P[] = [
  { id: "1", userId: "a", currentSteps: 500, rank: 1, challengeDayKey: "2026-08-03" },
  { id: "2", userId: "b", currentSteps: 200, rank: 2, challengeDayKey: "2026-08-03" },
];
const polled: P[] = [
  { id: "1", userId: "a", currentSteps: 0, rank: 1, challengeDayKey: "2026-08-03" },
  { id: "2", userId: "b", currentSteps: 0, rank: 2, challengeDayKey: "2026-08-03" },
  { id: "3", userId: "c", currentSteps: 50, rank: 3, challengeDayKey: "2026-08-03" },
];
const merged = mergeParticipantsPreservingSteps(prev, polled);
assert.equal(merged.find((p) => p.userId === "a")!.currentSteps, 500);
assert.equal(merged.find((p) => p.userId === "b")!.currentSteps, 200);
assert.equal(merged.find((p) => p.userId === "c")!.currentSteps, 50);

assert.equal(
  mergeParticipantsPreservingSteps(prev, [
    { id: "1", userId: "a", currentSteps: 800, rank: 1, challengeDayKey: "2026-08-03" },
  ]).find((p) => p.userId === "a")!.currentSteps,
  800,
);

const keepZero = mergeParticipantsPreservingSteps(
  [{ id: "1", userId: "a", currentSteps: 0, rank: 1 }],
  [{ id: "2", userId: "b", currentSteps: 10, rank: 1 }],
);
assert.equal(keepZero.length, 2);

assert.equal(
  mergeMonotonicParticipantSteps(100, 50, false, {
    dayAware: true,
    existingDayKey: "2026-08-04",
    incomingDayKey: "2026-08-04",
  }),
  100,
);

assert.equal(
  mergeMonotonicParticipantSteps(500, 0, false, {
    dayAware: true,
    existingDayKey: "2026-08-03",
    incomingDayKey: "2026-08-04",
  }),
  0,
);

const dayRollover = mergeParticipantsPreservingSteps(
  [{ id: "1", userId: "a", currentSteps: 900, rank: 1, challengeDayKey: "2026-08-03" }],
  [{ id: "1", userId: "a", currentSteps: 0, rank: 1, challengeDayKey: "2026-08-04" }],
  { dayAware: true },
);
assert.equal(dayRollover.find((p) => p.userId === "a")!.currentSteps, 0);
assert.equal(dayRollover.find((p) => p.userId === "a")!.challengeDayKey, "2026-08-04");

const upserted = applyParticipantProgressEvent(
  [{ id: "1", userId: "a", currentSteps: 10, rank: 1 }],
  { userId: "b", participantId: "p-b", steps: 42 },
  { allowTemporaryUpsert: true },
);
assert.equal(upserted.next.length, 2);
assert.equal(upserted.next.find((p) => p.userId === "b")?.temporaryFromRealtime, true);

const reconciled = mergeParticipantsPreservingSteps(upserted.next, [
  { id: "1", userId: "a", currentSteps: 10, rank: 1 },
]);
assert.equal(reconciled.find((p) => p.userId === "b"), undefined);

const boardApplied = applyLeaderboardSnapshot(
  [
    { id: "1", userId: "a", currentSteps: 100, rank: 1 },
    { id: "2", userId: "b", currentSteps: 90, rank: 2 },
    { id: "3", userId: "c", currentSteps: 80, rank: 3 },
  ],
  [
    { userId: "a", participantId: "1", steps: 150, rank: 1 },
    { userId: "b", participantId: "2", steps: 120, rank: 2 },
  ],
);
assert.equal(boardApplied.next.length, 3);
assert.equal(boardApplied.next.find((p) => p.userId === "a")!.currentSteps, 150);
assert.equal(boardApplied.next.find((p) => p.userId === "c")!.currentSteps, 80);

const stale = applyParticipantProgressEvent(
  [{ id: "1", userId: "a", currentSteps: 200, progressUpdatedAt: "2026-08-04T12:00:00.000Z" }],
  {
    userId: "a",
    participantId: "1",
    steps: 50,
    updatedAt: "2026-08-04T11:00:00.000Z",
  },
);
assert.equal(stale.next[0]!.currentSteps, 200);

// Regression: a 101-participant Unlimited roster (1 real host + 100 dummy
// bots, matching the confirmed production case) must survive merge + a
// bounded (top-20) leaderboard realtime payload without losing any rows.
{
  const roster: P[] = Array.from({ length: 101 }, (_, i) => ({
    id: `p${i}`,
    userId: `u${i}`,
    currentSteps: 101 - i,
    rank: i + 1,
    challengeDayKey: "2026-08-04",
  }));
  assert.equal(roster.length, 101);

  const idSet = new Set(roster.map((p) => `${p.userId}:${p.id}`));
  assert.equal(idSet.size, 101, "no duplicate participant keys in fixture");

  // Poll-refresh merge (full 101-row snapshot) must preserve all 101.
  const rePolled = mergeParticipantsPreservingSteps(roster, roster, { dayAware: true });
  assert.equal(rePolled.length, 101);

  // A top-20 leaderboard realtime payload (backend broadcast cap) must not
  // remove the other 81 rows from the merged roster.
  const top20Snapshot = roster.slice(0, 20).map((p) => ({
    userId: p.userId,
    participantId: p.id,
    steps: p.currentSteps + 5,
    rank: p.rank,
  }));
  const afterLeaderboard = applyLeaderboardSnapshot(roster, top20Snapshot);
  assert.equal(afterLeaderboard.next.length, 101, "leaderboard payload must not truncate roster");
  assert.equal(
    afterLeaderboard.next.find((p) => p.userId === "u100")!.currentSteps,
    1,
    "row outside the payload window is untouched, not dropped",
  );
  assert.equal(
    afterLeaderboard.next.find((p) => p.userId === "u0")!.currentSteps,
    106,
    "row inside the payload window is updated",
  );
}

console.log("liveRaceParticipantState.test.ts: ok");
