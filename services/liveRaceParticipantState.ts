/**
 * Normalized Live Race participant step merge — single source for all UI sections.
 * Monotonic while race is active; frozen when completed.
 */

import { stepEngineLog } from "@/utils/stepAccuracy";

export type RaceParticipantLike = {
  id: string;
  userId: string;
  currentSteps: number;
  rank?: number | null;
};

export type ParticipantProgressEvent = {
  participantId?: string;
  userId?: string;
  steps: number;
  rank?: number;
};

export function mergeMonotonicParticipantSteps(
  existing: number,
  incoming: number,
  raceCompleted: boolean,
): number {
  const prev = Math.max(0, Math.floor(existing));
  const next = Math.max(0, Math.floor(incoming));
  if (raceCompleted) return prev > 0 ? prev : next;
  return Math.max(prev, next);
}

/**
 * Merge a fresh participant roster into the previous one without wiping live steps.
 * Same monotonic rule as normal Live Race polls / Pusher progress.
 */
export function mergeParticipantsPreservingSteps<T extends RaceParticipantLike>(
  previous: T[],
  incoming: T[],
  options?: { raceCompleted?: boolean },
): T[] {
  const raceCompleted = options?.raceCompleted === true;
  if (!Array.isArray(incoming) || incoming.length === 0) {
    return previous.length > 0 ? previous : incoming;
  }
  const prevByUser = new Map<string, T>();
  for (const p of previous) {
    if (p.userId) prevByUser.set(p.userId, p);
  }
  const seen = new Set<string>();
  const merged: T[] = incoming.map((p) => {
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
  // Keep anyone we only knew from Pusher who hasn't appeared in the new roster yet.
  for (const p of previous) {
    const key = p.userId || p.id;
    if (!key || seen.has(key)) continue;
    if ((p.currentSteps ?? 0) > 0) merged.push(p);
  }
  return merged;
}

export function applyParticipantProgressEvent<T extends RaceParticipantLike>(
  participants: T[],
  event: ParticipantProgressEvent,
  options: {
    currentUserId?: string | null;
    targetSteps?: number;
    raceCompleted?: boolean;
  },
): { next: T[]; changed: boolean } {
  const raceCompleted = options.raceCompleted === true;
  const target = Math.max(1, options.targetSteps ?? 10_000);
  const uid = event.userId ?? event.participantId ?? "";
  if (!uid || typeof event.steps !== "number") {
    return { next: participants, changed: false };
  }

  let changed = false;
  let matched = false;
  const next = participants.map((p) => {
    const match =
      (event.participantId && p.id === event.participantId) ||
      (event.userId && p.userId === event.userId);
    if (!match) return p;
    matched = true;

    const isMe = !!options.currentUserId && p.userId === options.currentUserId;
    let merged = mergeMonotonicParticipantSteps(p.currentSteps, event.steps, raceCompleted);
    if (isMe) merged = Math.min(target, merged);
    const newRank = event.rank ?? p.rank;
    if (merged === p.currentSteps && newRank === p.rank) return p;
    changed = true;
    stepEngineLog(
      "Realtime",
      `appliedToNormalizedState=true userId=${p.userId} steps=${merged} raceCompleted=${raceCompleted}`,
    );
    return { ...p, currentSteps: merged, rank: newRank };
  });

  // Upsert unknown remote walkers (same as Live tab) so Unlimited progress events aren't dropped.
  if (!matched && event.userId) {
    const steps = Math.max(0, Math.floor(event.steps));
    changed = true;
    next.push({
      id: event.participantId ?? event.userId,
      userId: event.userId,
      currentSteps: Math.min(target, steps),
      rank: event.rank ?? null,
      status: "active",
      username: "Walker",
      countryFlag: null,
      avatarColor: "#00E676",
      isHost: false,
    } as T);
    stepEngineLog(
      "Realtime",
      `upsertedMissingParticipant=true userId=${event.userId} steps=${steps}`,
    );
  }

  return { next: changed ? next : participants, changed };
}
