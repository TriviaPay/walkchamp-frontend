/**
 * Map Unlimited Challenge detail API → waiting-room race/participant shapes.
 */

import {
  extractUnlimitedChallengeRows,
  normalizeUnlimitedChallengeToUpcomingRoom,
} from "@/utils/unlimitedChallengeRooms";
import { UNLIMITED_GOAL_CHALLENGE_TYPE } from "@/utils/unlimitedGoal";
import { resolveMinimumParticipants } from "@/utils/waitingRoomTiming";

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function pick(obj: Record<string, unknown>, ...keys: string[]): unknown {
  for (const key of keys) {
    if (obj[key] !== undefined && obj[key] !== null) return obj[key];
  }
  return undefined;
}

function asString(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return null;
}

/** Pull a participant array from common API shapes (array or { data|items|results }). */
function asParticipantList(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  const rec = asRecord(value);
  if (!rec) return [];
  for (const key of ["data", "items", "results", "players", "participants", "registrations", "members"]) {
    const nested = rec[key];
    if (Array.isArray(nested)) return nested;
  }
  return [];
}

export function pickChallengeRecord(
  root: Record<string, unknown>,
): Record<string, unknown> {
  for (const key of ["challenge", "unlimitedChallenge", "unlimited_challenge"]) {
    const rec = asRecord(root[key]);
    if (!rec) continue;
    if (asString(pick(rec, "id", "challengeId", "challenge_id", "room_id"))) return rec;
  }
  const data = asRecord(root.data);
  if (data) {
    const nested = asRecord(pick(data, "challenge", "unlimitedChallenge"));
    if (nested && asString(pick(nested, "id", "challengeId", "challenge_id"))) {
      return nested;
    }
    if (asString(pick(data, "id", "challengeId", "challenge_id"))) return data;
  }
  if (asString(pick(root, "id", "challengeId", "challenge_id", "room_id"))) return root;
  return asRecord(pick(root, "challenge")) ?? root;
}

export function collectRosterFromEnvelope(root: Record<string, unknown>): unknown[] {
  const challenge = pickChallengeRecord(root);
  const data = asRecord(root.data);
  let best: unknown[] = [];
  for (const src of [root, challenge, data, asRecord(data?.challenge)]) {
    if (!src) continue;
    const players = asParticipantList(src.players);
    const parts = asParticipantList(src.participants);
    const roster = players.length >= parts.length ? players : parts;
    if (roster.length > best.length) best = roster;
  }
  return best;
}

const COUNT_KEYS = [
  "registered_count",
  "registeredCount",
  "current_players",
  "currentPlayers",
  "participantCount",
  "participant_count",
  "joinedCount",
  "joined_count",
  "playersJoined",
  "players_joined",
  "totalParticipants",
  "total_participants",
  "totalRegistered",
  "total_registered",
  "totalRegistrations",
  "total_registrations",
  "registrationCount",
  "registration_count",
  "memberCount",
  "member_count",
  "activeCount",
  "active_count",
  "numParticipants",
  "num_participants",
] as const;

function collectCountFromRecord(obj: Record<string, unknown>): number {
  let max = 0;
  for (const key of COUNT_KEYS) {
    const n = asNumber(obj[key]);
    if (n != null && n > max) max = Math.floor(n);
  }
  return max;
}

/** Walk common nested envelopes for a join count (stats/meta/counts/…). */
function collectNestedCounts(obj: Record<string, unknown>): number {
  let max = collectCountFromRecord(obj);
  for (const key of [
    "stats",
    "meta",
    "counts",
    "summary",
    "registration",
    "registrations",
    "metrics",
  ]) {
    const nested = asRecord(obj[key]);
    if (nested) max = Math.max(max, collectCountFromRecord(nested));
  }
  return max;
}

function deriveCountFromPrizePool(obj: Record<string, unknown>): number {
  const entryCents =
    asNumber(
      pick(obj, "entryFeeCents", "entry_fee_cents", "entryAmountCents", "entry_amount_cents"),
    ) ??
    (() => {
      const dollars = asNumber(pick(obj, "entry_fee", "entryFee"));
      if (dollars == null) return null;
      return dollars > 0 && dollars < 1000 ? Math.round(dollars * 100) : Math.round(dollars);
    })();
  const prizeCents = asNumber(
    pick(
      obj,
      "prizePoolCents",
      "prize_pool_cents",
      "currentPrizePoolCents",
      "current_prize_pool_cents",
    ),
  );
  if (
    entryCents != null &&
    entryCents > 0 &&
    prizeCents != null &&
    prizeCents >= entryCents
  ) {
    return Math.floor(prizeCents / entryCents);
  }
  return 0;
}

function participantRowKey(row: unknown): string | null {
  const obj = asRecord(row);
  if (!obj) return null;
  const user = asRecord(pick(obj, "user", "profile", "member")) ?? {};
  return (
    asString(pick(obj, "userId", "user_id", "memberUserId", "member_user_id")) ??
    asString(pick(user, "id", "userId", "user_id")) ??
    asString(pick(obj, "participantId", "participant_id", "id"))
  );
}

/** Deduplicate API player rows — detail returns the same list as both `players` and `participants`. */
function dedupeParticipantRows(rows: unknown[]): unknown[] {
  const byKey = new Map<string, unknown>();
  const noKey: unknown[] = [];
  for (const row of rows) {
    const key = participantRowKey(row);
    if (!key) {
      noKey.push(row);
      continue;
    }
    if (!byKey.has(key)) byKey.set(key, row);
  }
  return [...byKey.values(), ...noKey];
}

function resolveParticipantCount(
  challenge: Record<string, unknown>,
  root: Record<string, unknown>,
  listLength: number,
): { count: number; hasExplicit: boolean } {
  const explicitField = (obj: Record<string, unknown>): number | null => {
    const raw = obj.participantCount ?? obj.participant_count;
    return typeof raw === "number" && Number.isFinite(raw) ? Math.max(0, Math.floor(raw)) : null;
  };
  const explicitChallenge = explicitField(challenge);
  const explicitRoot = explicitField(root);

  // Prefer challenge.participantCount (authoritative) over list length / prize math.
  const fromExplicit = Math.max(
    collectNestedCounts(challenge),
    collectNestedCounts(root),
  );
  if (fromExplicit > 0) {
    return { count: Math.max(fromExplicit, listLength), hasExplicit: true };
  }

  // Detail sends participantCount: 0 when players[] is empty. Do NOT invent
  // joiners from prizePool / entryFee ($2000 / $1000 = "2 joined").
  if (explicitChallenge === 0 || explicitRoot === 0) {
    return { count: listLength, hasExplicit: true };
  }

  const fromPrize = Math.max(
    deriveCountFromPrizePool(challenge),
    deriveCountFromPrizePool(root),
  );

  const listRow =
    normalizeUnlimitedChallengeToUpcomingRoom(
      extractUnlimitedChallengeRows(root)[0] ?? challenge,
    ) ?? normalizeUnlimitedChallengeToUpcomingRoom(challenge);
  const fromListNormalizer = listRow?.registered_count ?? 0;

  const count = Math.max(fromPrize, fromListNormalizer, listLength, 1);
  return {
    count,
    hasExplicit: fromPrize > 0 || fromListNormalizer > Math.max(listLength, 0),
  };
}

export type UnlimitedWaitingRoomMapped = {
  race: {
    id: string;
    currentPlayers: number;
    maxPlayers: number | null;
    status: string;
    targetSteps: number;
    entryType: string;
    entryAmountCents: number;
    coinEntryAmount: number;
    coinPrizePool: number;
    isPrivate: boolean;
    inviteCode: string | null;
    minimumParticipants: number;
    canStart: boolean | null;
    roomExpiresAt: string | null;
    createdAt: string | null;
    cancellationReason: string | null;
    scheduledStartAt: string | null;
    challengeType: string;
    capacityMode: "unlimited";
    startedAt: string | null;
    hostUserId: string | null;
    /** True when a dedicated count field (or prize-derived count) was found. */
    hasExplicitPlayerCount?: boolean;
    /** Host/challenge IANA timezone `startAtUtc` was anchored to (see serializeChallenge). */
    challengeTimezone: string | null;
    durationDays: number | null;
    dailyGoalSteps: number | null;
  };
  participants: unknown[];
};

/** Normalize GET /api/unlimited-challenges/:id (or list row) into waiting-room poll shape. */
export function mapUnlimitedDetailToWaitingRoom(
  payload: unknown,
): UnlimitedWaitingRoomMapped | null {
  const root = asRecord(payload);
  if (!root) return null;

  const challenge = pickChallengeRecord(root);

  const id = asString(
    pick(challenge, "id", "challengeId", "challenge_id", "room_id", "roomId"),
  );
  if (!id) return null;

  const entryFeeCents =
    asNumber(
      pick(challenge, "entryFeeCents", "entry_fee_cents", "entryAmountCents"),
    ) ?? 0;

  const visibility = asString(pick(challenge, "visibility"))?.toLowerCase();
  const isPrivate =
    (typeof pick(challenge, "isPrivate", "is_private") === "boolean"
      ? (pick(challenge, "isPrivate", "is_private") as boolean)
      : null) ??
    visibility === "private";

  const startAt = asString(
    pick(
      challenge,
      "startAtUtc",
      "start_at_utc",
      "startAtIso",
      "scheduledStartAt",
      "scheduled_start_at",
    ),
  );

  // Prefer the real membership roster (`players`) — never a 1-row preview/leaderboard
  // slice when the detail payload already has the full list.
  const envelopeRoster = collectRosterFromEnvelope(root);
  const fromPlayers = asParticipantList(root.players);
  const fromParticipants = asParticipantList(root.participants);
  const primaryRoster =
    envelopeRoster.length >= Math.max(fromPlayers.length, fromParticipants.length)
      ? envelopeRoster
      : fromPlayers.length >= fromParticipants.length
        ? fromPlayers
        : fromParticipants;
  const extraKeys = [
    "registrations",
    "registeredParticipants",
    "registered_participants",
    "members",
    "leaderboard",
    "standings",
    "rankings",
    "liveLeaderboard",
    "live_leaderboard",
    "entries",
  ] as const;
  const rawParticipants: unknown[] = [...primaryRoster];
  if (primaryRoster.length < 2) {
    for (const source of [root, challenge]) {
      for (const key of extraKeys) {
        rawParticipants.push(...asParticipantList(source[key]));
      }
    }
  }
  const participants = dedupeParticipantRows(rawParticipants);

  const { count: participantCount, hasExplicit: hasExplicitPlayerCount } =
    resolveParticipantCount(challenge, root, participants.length);

  return {
    race: {
      id,
      currentPlayers: participantCount,
      maxPlayers: null,
      status: asString(pick(challenge, "status", "room_status")) ?? "waiting",
      targetSteps:
        asNumber(
          pick(challenge, "dailyGoalSteps", "daily_goal_steps", "targetSteps", "target_steps"),
        ) ?? 0,
      entryType: UNLIMITED_GOAL_CHALLENGE_TYPE,
      entryAmountCents: entryFeeCents,
      coinEntryAmount: 0,
      coinPrizePool: 0,
      isPrivate: !!isPrivate,
      inviteCode: asString(pick(challenge, "inviteCode", "invite_code")),
      minimumParticipants: resolveMinimumParticipants(
        asNumber(
          pick(
            challenge,
            "minimumParticipants",
            "minimum_participants",
            "minParticipants",
            "min_players",
          ),
        ) ?? undefined,
      ),
      canStart:
        typeof pick(challenge, "canStart", "can_start") === "boolean"
          ? (pick(challenge, "canStart", "can_start") as boolean)
          : null,
      roomExpiresAt: asString(
        pick(challenge, "registrationClosesAtUtc", "registration_closes_at_utc"),
      ),
      createdAt: asString(pick(challenge, "createdAt", "created_at")),
      cancellationReason: asString(
        pick(challenge, "cancellationReason", "cancellation_reason"),
      ),
      scheduledStartAt: startAt,
      challengeType: UNLIMITED_GOAL_CHALLENGE_TYPE,
      capacityMode: "unlimited",
      startedAt: asString(pick(challenge, "startedAt", "started_at")),
      hostUserId: asString(
        pick(challenge, "hostUserId", "host_user_id", "creatorId", "creator_id"),
      ),
      hasExplicitPlayerCount,
      challengeTimezone: asString(
        pick(challenge, "challengeTimezone", "challenge_timezone", "timezone"),
      ),
      durationDays: asNumber(pick(challenge, "durationDays", "duration_days")),
      dailyGoalSteps: asNumber(
        pick(challenge, "dailyGoalSteps", "daily_goal_steps", "targetSteps", "target_steps"),
      ),
    },
    participants,
  };
}
