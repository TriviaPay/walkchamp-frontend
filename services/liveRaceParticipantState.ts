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
  const next = participants.map((p) => {
    const match =
      (event.participantId && p.id === event.participantId) ||
      (event.userId && p.userId === event.userId);
    if (!match) return p;

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

  return { next: changed ? next : participants, changed };
}
