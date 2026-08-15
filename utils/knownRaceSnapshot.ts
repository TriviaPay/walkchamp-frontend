/**
 * Instant Walk / My Race fields from already-loaded Live Detail cache.
 * No network — the live race screen already wrote challengeEndAt + prize.
 */

import { screenCache } from "@/core/cache/screenCache";
import { liveRaceDetailCacheKey } from "@/utils/warmLiveRaceDetail";
import { store } from "@/store";

export type KnownRaceSnapshot = {
  raceId: string;
  startedAt: string | null;
  challengeEndAt: string | null;
  timeLeftSeconds: number | null;
  prizePoolCents: number | null;
  entryAmountCents: number | null;
  coinEntryAmount: number | null;
  targetSteps: number | null;
  currentPlayers: number | null;
  maxPlayers: number | null;
  challengeType: string | null;
  entryType: string | null;
  capacityMode?: string | null;
  challengeDurationDays: number | null;
};

function toIso(value: unknown): string | null {
  if (value == null || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    const ms = value < 1e12 ? value * 1000 : value;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  if (typeof value === "string") {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  return null;
}

/** End/prize are absolute — do not drop them after the default 5m screenCache TTL. */
const KNOWN_RACE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

function readCachedRace(
  raceId: string,
  userId?: string | null,
): Record<string, unknown> | null {
  const scoped = screenCache.getSync<{ race?: Record<string, unknown> }>(
    liveRaceDetailCacheKey(raceId, userId),
    KNOWN_RACE_MAX_AGE_MS,
  )?.race;
  if (scoped) return scoped;
  return (
    screenCache.getSync<{ race?: Record<string, unknown> }>(
      liveRaceDetailCacheKey(raceId),
      KNOWN_RACE_MAX_AGE_MS,
    )?.race ?? null
  );
}

export function readKnownRaceSnapshot(
  raceId?: string | null,
  userId?: string | null,
): KnownRaceSnapshot | null {
  const id = String(raceId ?? "").trim();
  if (!id) return null;

  const race = readCachedRace(id, userId);
  const rp = store.getState().raceProgress;
  const reduxMatch = rp.activeRaceId === id;

  const challengeEndAt =
    toIso(race?.challengeEndAt) ??
    toIso(race?.challenge_end_at) ??
    toIso(race?.endsAt) ??
    toIso(race?.challengeEndAtMs) ??
    (reduxMatch ? rp.challengeEndAt : null);

  const prizePoolCents =
    typeof race?.prizePoolCents === "number" && race.prizePoolCents > 0
      ? Math.round(race.prizePoolCents)
      : typeof race?.prizePool === "number" && race.prizePool > 0
        ? Math.round(race.prizePool > 500 ? race.prizePool : race.prizePool * 100)
        : null;

  if (!race && !reduxMatch) return null;

  return {
    raceId: id,
    startedAt:
      toIso(race?.startedAt) ??
      toIso(race?.started_at) ??
      toIso(race?.scheduledStartAt) ??
      (reduxMatch ? rp.raceStartTime : null),
    challengeEndAt,
    timeLeftSeconds:
      typeof race?.timeLeftSeconds === "number"
        ? race.timeLeftSeconds
        : reduxMatch
          ? rp.timeLeftSeconds
          : null,
    prizePoolCents,
    entryAmountCents:
      typeof race?.entryAmountCents === "number" ? race.entryAmountCents : null,
    coinEntryAmount:
      typeof race?.coinEntryAmount === "number" ? race.coinEntryAmount : null,
    targetSteps:
      typeof race?.targetSteps === "number"
        ? race.targetSteps
        : reduxMatch
          ? rp.goalSteps
          : null,
    currentPlayers:
      typeof race?.currentPlayers === "number"
        ? race.currentPlayers
        : reduxMatch
          ? rp.totalParticipants
          : null,
    maxPlayers: typeof race?.maxPlayers === "number" ? race.maxPlayers : null,
    challengeType:
      typeof race?.challengeType === "string"
        ? race.challengeType
        : typeof race?.type === "string"
          ? race.type
          : reduxMatch
            ? rp.activeRaceType
            : null,
    entryType: typeof race?.entryType === "string" ? race.entryType : null,
    capacityMode:
      typeof race?.capacityMode === "string"
        ? race.capacityMode
        : typeof race?.capacity_mode === "string"
          ? race.capacity_mode
          : null,
    challengeDurationDays:
      typeof race?.challengeDurationDays === "number" && race.challengeDurationDays > 0
        ? Math.floor(race.challengeDurationDays)
        : typeof race?.durationDays === "number" && race.durationDays > 0
          ? Math.floor(race.durationDays)
          : null,
  };
}

export function readKnownRaceEndAt(
  raceId?: string | null,
  userId?: string | null,
): string | null {
  return readKnownRaceSnapshot(raceId, userId)?.challengeEndAt ?? null;
}
