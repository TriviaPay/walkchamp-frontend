/**
 * Pure merge/progress semantics (no RN imports).
 * Run: npx tsx services/liveRaceParticipantState.test.ts
 */
import assert from "node:assert/strict";

function mergeMonotonicParticipantSteps(
  existing: number,
  incoming: number,
  raceCompleted: boolean,
): number {
  const prev = Math.max(0, Math.floor(existing));
  const next = Math.max(0, Math.floor(incoming));
  if (raceCompleted) return prev > 0 ? prev : next;
  return Math.max(prev, next);
}

type P = { id: string; userId: string; currentSteps: number; rank?: number | null };

function mergeParticipantsPreservingSteps(
  previous: P[],
  incoming: P[],
  options?: { raceCompleted?: boolean },
): P[] {
  const raceCompleted = options?.raceCompleted === true;
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
    if (!prev) return p;
    return {
      ...prev,
      ...p,
      currentSteps: mergeMonotonicParticipantSteps(
        prev.currentSteps,
        p.currentSteps,
        raceCompleted,
      ),
      rank: p.rank ?? prev.rank,
    };
  });
  for (const p of previous) {
    const key = p.userId || p.id;
    if (!key || seen.has(key)) continue;
    if ((p.currentSteps ?? 0) > 0) merged.push(p);
  }
  return merged;
}

const prev: P[] = [
  { id: "1", userId: "a", currentSteps: 500, rank: 1 },
  { id: "2", userId: "b", currentSteps: 200, rank: 2 },
];
const polled: P[] = [
  { id: "1", userId: "a", currentSteps: 0, rank: 1 },
  { id: "2", userId: "b", currentSteps: 0, rank: 2 },
  { id: "3", userId: "c", currentSteps: 50, rank: 3 },
];
const merged = mergeParticipantsPreservingSteps(prev, polled);
assert.equal(merged.find((p) => p.userId === "a")!.currentSteps, 500);
assert.equal(merged.find((p) => p.userId === "b")!.currentSteps, 200);
assert.equal(merged.find((p) => p.userId === "c")!.currentSteps, 50);

assert.equal(
  mergeParticipantsPreservingSteps(prev, [
    { id: "1", userId: "a", currentSteps: 800, rank: 1 },
  ]).find((p) => p.userId === "a")!.currentSteps,
  800,
);

console.log("liveRaceParticipantState.test.ts: ok");
