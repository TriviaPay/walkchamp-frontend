/**
 * Pure merge/progress semantics for Live Race participants.
 * Monotonic while race is active; frozen when completed.
 *
 * Unlimited Challenge: merges are day-aware. A new challengeDayKey replaces
 * yesterday's currentSteps (including zero). Same-day remains monotonic.
 */

import { stepEngineLog } from "@/utils/stepAccuracy";

export type RaceParticipantLike = {
  id: string;
  userId: string;
  currentSteps: number;
  rank?: number | null;
  /** Unlimited: YYYY-MM-DD in locked challenge/participant timezone. */
  challengeDayKey?: string | null;
  totalChallengeSteps?: number | null;
  /** ISO timestamp of last applied progress (poll or realtime). */
  progressUpdatedAt?: string | null;
  /** Temporary row from a progress event before membership hydrate. */
  temporaryFromRealtime?: boolean;
  username?: string;
  status?: string | null;
  countryFlag?: string | null;
  avatarColor?: string | null;
  isHost?: boolean;
};

export type ParticipantProgressEvent = {
  participantId?: string;
  userId?: string;
  steps: number;
  rank?: number;
  challengeDayKey?: string | null;
  localDate?: string | null;
  updatedAt?: string | null;
};

export type LeaderboardStandingLike = {
  participantId?: string;
  id?: string;
  userId?: string;
  steps?: number;
  currentSteps?: number;
  rank?: number;
  username?: string;
  updatedAt?: string | null;
  challengeDayKey?: string | null;
};

export type MergeParticipantsOptions = {
  raceCompleted?: boolean;
  /** When true, apply day-key aware merge (Unlimited). Classic races omit this. */
  dayAware?: boolean;
};

export function mergeMonotonicParticipantSteps(
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
    // New challenge day replaces prior day (allows zero).
    return next;
  }
  if (
    opts?.dayAware &&
    opts.incomingDayKey &&
    !opts.existingDayKey
  ) {
    return next;
  }
  if (raceCompleted) return prev > 0 ? prev : next;
  return Math.max(prev, next);
}

function parseUpdatedAtMs(value?: string | null): number | null {
  if (!value) return null;
  const t = Date.parse(value);
  return Number.isFinite(t) ? t : null;
}

/**
 * True when incoming should win over existing based on updatedAt.
 * Missing timestamps fall through to monotonic step merge.
 */
export function isIncomingProgressNewer(
  existingUpdatedAt?: string | null,
  incomingUpdatedAt?: string | null,
): boolean | null {
  const a = parseUpdatedAtMs(existingUpdatedAt);
  const b = parseUpdatedAtMs(incomingUpdatedAt);
  if (a == null || b == null) return null;
  if (b > a) return true;
  if (b < a) return false;
  return null;
}

/**
 * Merge a fresh participant roster into the previous one without wiping live steps.
 * Same monotonic rule as normal Live Race polls / Pusher progress.
 * With dayAware + challengeDayKey, a new day may reset currentSteps to 0.
 * Temporary realtime-only rows are dropped if absent from the authoritative roster.
 */
export function mergeParticipantsPreservingSteps<T extends RaceParticipantLike>(
  previous: T[],
  incoming: T[],
  options?: MergeParticipantsOptions,
): T[] {
  const raceCompleted = options?.raceCompleted === true;
  const dayAware = options?.dayAware === true;
  if (!Array.isArray(incoming) || incoming.length === 0) {
    return previous.length > 0 ? previous : incoming;
  }
  const prevByUser = new Map<string, T>();
  const prevById = new Map<string, T>();
  for (const p of previous) {
    if (p.userId) prevByUser.set(p.userId, p);
    if (p.id) prevById.set(p.id, p);
  }
  const seen = new Set<string>();
  const merged: T[] = incoming.map((p) => {
    const key = p.userId || p.id;
    if (key) seen.add(key);
    if (p.id) seen.add(p.id);
    const prev =
      (p.userId ? prevByUser.get(p.userId) : undefined) ??
      (p.id ? prevById.get(p.id) : undefined);
    if (!prev) return { ...p, temporaryFromRealtime: false };
    const nextDayKey = p.challengeDayKey ?? null;
    const prevDayKey = prev.challengeDayKey ?? null;
    const newer = isIncomingProgressNewer(prev.progressUpdatedAt, p.progressUpdatedAt);
    let currentSteps: number;
    if (newer === false) {
      currentSteps = prev.currentSteps;
    } else if (newer === true) {
      currentSteps = mergeMonotonicParticipantSteps(
        0,
        p.currentSteps,
        raceCompleted,
        {
          dayAware,
          existingDayKey: prevDayKey,
          incomingDayKey: nextDayKey,
        },
      );
      // Same-day newer poll replaces with incoming (still non-negative).
      if (!dayAware || !nextDayKey || nextDayKey === prevDayKey) {
        currentSteps = Math.max(0, Math.floor(p.currentSteps));
      }
    } else {
      currentSteps = mergeMonotonicParticipantSteps(
        prev.currentSteps,
        p.currentSteps,
        raceCompleted,
        {
          dayAware,
          existingDayKey: prevDayKey,
          incomingDayKey: nextDayKey,
        },
      );
    }
    return {
      ...prev,
      ...p,
      currentSteps,
      challengeDayKey: nextDayKey ?? prevDayKey,
      totalChallengeSteps:
        typeof p.totalChallengeSteps === "number"
          ? p.totalChallengeSteps
          : prev.totalChallengeSteps,
      rank: p.rank ?? prev.rank,
      progressUpdatedAt:
        newer === false
          ? prev.progressUpdatedAt ?? null
          : p.progressUpdatedAt ?? prev.progressUpdatedAt ?? null,
      temporaryFromRealtime: false,
    };
  });
  // Keep prior walkers missing from this poll (Pusher / partial Unlimited enrichment),
  // except temporary realtime stubs that never appeared in membership.
  for (const p of previous) {
    const key = p.userId || p.id;
    if (!key || seen.has(key) || (p.id && seen.has(p.id))) continue;
    if (p.temporaryFromRealtime) continue;
    merged.push(p);
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
    dayAware?: boolean;
    /** Active challenge day — drop events from a different day. */
    expectedChallengeDayKey?: string | null;
    /** Allow temporary upsert before membership hydrate. Default true. */
    allowTemporaryUpsert?: boolean;
  },
): { next: T[]; changed: boolean } {
  const raceCompleted = options.raceCompleted === true;
  const dayAware = options.dayAware === true;
  const target = Math.max(1, options.targetSteps ?? 10_000);
  const uid = event.userId ?? event.participantId ?? "";
  if (!uid || typeof event.steps !== "number") {
    return { next: participants, changed: false };
  }

  const eventDayKey = event.challengeDayKey ?? event.localDate ?? null;
  if (
    dayAware &&
    options.expectedChallengeDayKey &&
    eventDayKey &&
    eventDayKey !== options.expectedChallengeDayKey
  ) {
    stepEngineLog(
      "Realtime",
      `ignoredCrossDayEvent=true userId=${uid} eventDay=${eventDayKey} expected=${options.expectedChallengeDayKey}`,
    );
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

    const newer = isIncomingProgressNewer(p.progressUpdatedAt, event.updatedAt);
    if (newer === false) {
      return p;
    }

    const isMe = !!options.currentUserId && p.userId === options.currentUserId;
    let merged = mergeMonotonicParticipantSteps(
      p.currentSteps,
      event.steps,
      raceCompleted,
      {
        dayAware,
        existingDayKey: p.challengeDayKey,
        incomingDayKey: eventDayKey ?? p.challengeDayKey,
      },
    );
    if (newer === true && (!dayAware || !eventDayKey || eventDayKey === p.challengeDayKey)) {
      merged = Math.max(0, Math.floor(event.steps));
    }
    if (isMe) merged = Math.min(target, merged);
    const newRank = event.rank ?? p.rank;
    const newDayKey = eventDayKey ?? p.challengeDayKey ?? null;
    const newUpdatedAt = event.updatedAt ?? p.progressUpdatedAt ?? null;
    if (
      merged === p.currentSteps &&
      newRank === p.rank &&
      newDayKey === p.challengeDayKey &&
      newUpdatedAt === p.progressUpdatedAt
    ) {
      return p;
    }
    changed = true;
    stepEngineLog(
      "Realtime",
      `appliedToNormalizedState=true userId=${p.userId} steps=${merged} raceCompleted=${raceCompleted} dayKey=${newDayKey ?? "n/a"}`,
    );
    return {
      ...p,
      currentSteps: merged,
      rank: newRank,
      challengeDayKey: newDayKey,
      progressUpdatedAt: newUpdatedAt,
    };
  });

  // Upsert unknown remote walkers so progress events aren't dropped before hydrate.
  const allowUpsert = options.allowTemporaryUpsert !== false;
  if (!matched && allowUpsert && (event.userId || event.participantId)) {
    const steps = Math.max(0, Math.floor(event.steps));
    const userId = event.userId ?? event.participantId!;
    changed = true;
    next.push({
      id: event.participantId ?? userId,
      userId,
      currentSteps: Math.min(target, steps),
      rank: event.rank ?? null,
      challengeDayKey: eventDayKey,
      progressUpdatedAt: event.updatedAt ?? null,
      temporaryFromRealtime: true,
      status: "active",
      username: "Walker",
      countryFlag: null,
      avatarColor: "#00E676",
      isHost: false,
    } as T);
    stepEngineLog(
      "Realtime",
      `upsertedMissingParticipant=true userId=${userId} steps=${steps}`,
    );
  }

  return { next: changed ? next : participants, changed };
}

/**
 * Enrich roster from a bounded leaderboard snapshot without removing members
 * outside the top-N bound.
 */
export function applyLeaderboardSnapshot<T extends RaceParticipantLike>(
  participants: T[],
  standings: LeaderboardStandingLike[] | null | undefined,
  options: {
    currentUserId?: string | null;
    targetSteps?: number;
    raceCompleted?: boolean;
    dayAware?: boolean;
    expectedChallengeDayKey?: string | null;
  } = {},
): { next: T[]; changed: boolean } {
  if (!Array.isArray(standings) || standings.length === 0) {
    return { next: participants, changed: false };
  }
  let next = participants;
  let anyChanged = false;
  for (const row of standings) {
    const steps =
      typeof row.steps === "number"
        ? row.steps
        : typeof row.currentSteps === "number"
          ? row.currentSteps
          : null;
    if (steps == null) continue;
    const userId = row.userId;
    const participantId = row.participantId ?? row.id;
    if (!userId && !participantId) continue;
    const { next: applied, changed } = applyParticipantProgressEvent(
      next,
      {
        participantId: participantId ?? undefined,
        userId: userId ?? undefined,
        steps,
        rank: row.rank,
        updatedAt: row.updatedAt,
        challengeDayKey: row.challengeDayKey,
      },
      {
        ...options,
        // Leaderboard top-N must not invent permanent membership.
        allowTemporaryUpsert: false,
      },
    );
    if (changed) {
      anyChanged = true;
      next = applied;
    }
  }
  return { next: anyChanged ? next : participants, changed: anyChanged };
}
