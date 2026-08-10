/**
 * Normalize Unlimited Challenge API rows into Available Rooms shapes.
 * Host create uses /api/unlimited-challenges/host; browse may use a dedicated
 * list endpoint and/or rooms/available with challengeType=unlimited_goal.
 */

import { UNLIMITED_GOAL_CHALLENGE_TYPE } from "@/utils/unlimitedGoal";
import type { AvailableRoomLike } from "@/utils/trendingChallenges";

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function pickRaw(obj: Record<string, unknown>, ...keys: string[]): unknown {
  for (const key of keys) {
    if (obj[key] !== undefined && obj[key] !== null) return obj[key];
  }
  return undefined;
}

function asString(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();
  return null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return null;
}

function asBool(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  return null;
}

function centsToDollars(cents: number | null): number | null {
  if (cents == null) return null;
  return cents / 100;
}

/**
 * True only for Unlimited Daily Goal rows — never Free / Coins / Cash race rooms.
 * Classic `/rooms/available` often shares id + visibility + scheduled_start_at;
 * those must NOT be stamped as unlimited_goal.
 *
 * Prefer Unlimited-specific fields (`challengeType`, `capacityMode`, `dailyGoalSteps`)
 * before looking at `entryType` — Live cards use entryType "$45" as a cash label.
 */
function isUnlimitedGoalRawRow(obj: Record<string, unknown>): boolean {
  const challengeType = String(
    pickRaw(obj, "challengeType", "challenge_type") ?? "",
  )
    .trim()
    .toLowerCase();
  if (challengeType === UNLIMITED_GOAL_CHALLENGE_TYPE) return true;

  const capacity = String(pickRaw(obj, "capacityMode", "capacity_mode") ?? "")
    .trim()
    .toLowerCase();
  if (capacity === "unlimited") return true;

  // Dedicated Unlimited API rows always include dailyGoalSteps (classic uses targetSteps).
  if (pickRaw(obj, "dailyGoalSteps", "daily_goal_steps") != null) return true;

  // serializeChallenge always has durationDays + entryFeeCents together.
  if (
    pickRaw(obj, "durationDays", "duration_days") != null &&
    pickRaw(obj, "entryFeeCents", "entry_fee_cents") != null
  ) {
    return true;
  }

  const entryType = String(pickRaw(obj, "entryType", "entry_type") ?? "")
    .trim()
    .toLowerCase();
  if (entryType === UNLIMITED_GOAL_CHALLENGE_TYPE) return true;

  return false;
}

function looksLikeChallengeRow(value: unknown): boolean {
  const obj = asRecord(value);
  if (!obj) return false;
  const id = pickRaw(
    obj,
    "room_id",
    "roomId",
    "id",
    "challengeId",
    "challenge_id",
    "unlimitedChallengeId",
  );
  if (id == null) return false;
  return isUnlimitedGoalRawRow(obj);
}

const LIST_ARRAY_KEYS = [
  "challenges",
  "unlimitedChallenges",
  "unlimited_challenges",
  "rooms",
  "items",
  "data",
  "results",
  "content",
  "records",
  "rows",
] as const;

/** Pull challenges/rooms array from common envelope shapes. */
export function extractUnlimitedChallengeRows(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  const obj = asRecord(payload);
  if (!obj) return [];

  if (looksLikeChallengeRow(obj)) return [obj];

  // Detail envelope: { challenge: {...}, players: [...] }
  for (const key of ["challenge", "unlimitedChallenge", "unlimited_challenge", "room"] as const) {
    const nested = asRecord(obj[key]);
    if (nested && looksLikeChallengeRow(nested)) return [nested];
  }

  for (const key of LIST_ARRAY_KEYS) {
    const v = obj[key];
    if (Array.isArray(v)) {
      const onlyUnlimited = v.filter(looksLikeChallengeRow);
      if (onlyUnlimited.length > 0) return onlyUnlimited;
      continue;
    }
    const nested = asRecord(v);
    if (nested) {
      if (looksLikeChallengeRow(nested)) return [nested];
      for (const inner of LIST_ARRAY_KEYS) {
        if (Array.isArray(nested[inner])) {
          const onlyUnlimited = (nested[inner] as unknown[]).filter(looksLikeChallengeRow);
          if (onlyUnlimited.length > 0) return onlyUnlimited;
        }
      }
      // data: { challenge: {...} }
      for (const inner of ["challenge", "unlimitedChallenge", "room"] as const) {
        const deep = asRecord(nested[inner]);
        if (deep && looksLikeChallengeRow(deep)) return [deep];
      }
    }
  }

  // One-level scan for arrays of challenge-shaped objects.
  // Skip participants/players — those look like rows with `id` but are not challenges.
  for (const [key, value] of Object.entries(obj)) {
    if (
      key === "players" ||
      key === "participants" ||
      key === "members" ||
      key === "registrations" ||
      key === "leaderboard"
    ) {
      continue;
    }
    if (!Array.isArray(value) || value.length === 0) continue;
    const onlyUnlimited = value.filter(looksLikeChallengeRow);
    if (onlyUnlimited.length > 0) return onlyUnlimited;
  }

  return [];
}

export type UnlimitedUpcomingRoom = {
  room_id: string;
  status: string;
  challenge_type: string;
  entry_fee: number;
  coin_entry_amount: number;
  title: string;
  target_steps: number;
  max_players: number;
  registered_count: number;
  scheduled_start_at: string | null;
  challenge_duration_days: number;
  challenge_end_at: string | null;
  selected_track_theme_id: string;
  theme_name: string;
  is_private: boolean;
  requires_code: boolean;
  host_user_id: string;
  host_username: string;
  host_avatar_color: string;
  host_avatar_url: string | null;
  host_country_flag: string | null;
  current_user_registered: boolean;
  eligible_to_register: boolean;
  capacity_mode: "unlimited";
  platform_fee_cents?: number | null;
  total_charge_cents?: number | null;
  reward_pool?: number | null;
  /** Host/challenge IANA timezone `scheduled_start_at` was anchored to (see serializeChallenge). */
  challenge_timezone?: string | null;
  /** Raw backend settlement bookkeeping — see utils/unlimitedResults.ts resolveUnlimitedResultStatus. */
  settlement_status?: string | null;
  qualified_participant_count?: number | null;
};

/**
 * Map a raw unlimited challenge / room row into the Upcoming Rooms card shape.
 */
export function normalizeUnlimitedChallengeToUpcomingRoom(
  raw: unknown,
): UnlimitedUpcomingRoom | null {
  const obj = asRecord(raw);
  if (!obj) return null;
  // Do not stamp Free/classic race rooms as Unlimited.
  if (!isUnlimitedGoalRawRow(obj)) return null;

  const host = asRecord(pickRaw(obj, "host", "hostSummary", "host_summary")) ?? {};

  const id = asString(
    pickRaw(
      obj,
      "room_id",
      "roomId",
      "id",
      "challengeId",
      "challenge_id",
      "unlimitedChallengeId",
    ),
  );
  if (!id) return null;

  const entryFeeCents =
    asNumber(
      pickRaw(obj, "entryFeeCents", "entry_fee_cents", "entryAmountCents", "entry_amount_cents"),
    ) ??
    (() => {
      const dollars = asNumber(pickRaw(obj, "entry_fee", "entryFee"));
      return dollars != null && dollars < 1000 ? Math.round(dollars * 100) : dollars;
    })();

  const entryFeeDollars =
    centsToDollars(entryFeeCents) ??
    asNumber(pickRaw(obj, "entry_fee", "entryFee")) ??
    0;

  const visibility = asString(pickRaw(obj, "visibility"))?.toLowerCase() ?? null;
  const isPrivate =
    asBool(pickRaw(obj, "is_private", "isPrivate")) ??
    visibility === "private" ??
    false;

  const startAt = asString(
    pickRaw(
      obj,
      "scheduled_start_at",
      "scheduledStartAt",
      "startAtIso",
      "start_at_iso",
      "startAtUtc",
      "start_at_utc",
      "startsAtUtc",
      "starts_at_utc",
      "startAt",
      "startsAt",
      "registrationOpensAtUtc",
    ),
  );

  const endAt = asString(
    pickRaw(
      obj,
      "challenge_end_at",
      "challengeEndAt",
      "challengeEndAtIso",
      "challengeEndAtUtc",
      "challenge_end_at_utc",
      "endAtIso",
      "end_at_iso",
      "endAtUtc",
      "end_at_utc",
      "endsAtUtc",
      "ends_at_utc",
    ),
  );

  const dailyGoal =
    asNumber(
      pickRaw(obj, "dailyGoalSteps", "daily_goal_steps", "target_steps", "targetSteps"),
    ) ?? 0;

  const durationDays =
    asNumber(
      pickRaw(
        obj,
        "durationDays",
        "duration_days",
        "challenge_duration_days",
        "challengeDurationDays",
      ),
    ) ?? 0;

  const participantCount =
    asNumber(
      pickRaw(
        obj,
        "registered_count",
        "registeredCount",
        "current_players",
        "currentPlayers",
        "participantCount",
        "participant_count",
        "joinedCount",
        "joined_count",
      ),
    ) ?? 1;

  // Prefer authoritative prizePoolCents; fall back to entry × joined (not platform fee).
  const apiPrizePoolCents = asNumber(
    pickRaw(obj, "prizePoolCents", "prize_pool_cents", "currentPrizePoolCents"),
  );
  const derivedPrizePoolCents =
    entryFeeCents != null && entryFeeCents > 0
      ? entryFeeCents * Math.max(1, participantCount)
      : null;
  const prizePoolCents =
    apiPrizePoolCents != null && apiPrizePoolCents > 0
      ? apiPrizePoolCents
      : derivedPrizePoolCents;
  // Available Rooms / Trending treat reward_pool as dollars.
  const rewardPoolDollars =
    prizePoolCents != null && prizePoolCents > 0
      ? prizePoolCents / 100
      : asNumber(pickRaw(obj, "reward_pool", "rewardPool")) ??
        (entryFeeDollars > 0 ? entryFeeDollars * Math.max(1, participantCount) : null);

  const hostUserId =
    asString(pickRaw(obj, "host_user_id", "hostUserId")) ??
    asString(pickRaw(host, "id", "userId", "user_id")) ??
    "";

  const hostUsername =
    asString(pickRaw(obj, "host_username", "hostUsername")) ??
    asString(pickRaw(host, "username", "name", "displayName")) ??
    "Host";

  const memberExplicit = asBool(
    pickRaw(
      obj,
      "current_user_registered",
      "currentUserRegistered",
      "isMember",
      "is_member",
      "joined",
    ),
  );
  const participationStatus = asString(
    pickRaw(
      obj,
      "participationStatus",
      "participation_status",
      "currentUserParticipantStatus",
      "current_user_participant_status",
      "memberStatus",
      "member_status",
    ),
  )?.toLowerCase();
  const hasLeft =
    participationStatus === "left" ||
    participationStatus === "withdrawn" ||
    participationStatus === "cancelled" ||
    participationStatus === "canceled" ||
    participationStatus === "refunded";

  // Membership must be explicit (or left). Do NOT infer from isHost / hostUserId —
  // creator id remains after Leave and would keep Next Race cards stuck.
  const member = hasLeft ? false : memberExplicit === true;

  const eligible =
    asBool(
      pickRaw(
        obj,
        "eligible_to_register",
        "eligibleToRegister",
        "joinable",
        "canJoin",
        "can_join",
      ),
    ) ??
    (!isPrivate && !member);

  const title =
    asString(pickRaw(obj, "title", "name")) ??
    `Streak · ${dailyGoal > 0 ? dailyGoal.toLocaleString() : "—"} steps/day`;

  const status =
    asString(pickRaw(obj, "status", "room_status", "roomStatus")) ?? "scheduled";

  return {
    room_id: id,
    status,
    challenge_type: UNLIMITED_GOAL_CHALLENGE_TYPE,
    entry_fee: entryFeeDollars,
    coin_entry_amount: 0,
    title,
    target_steps: dailyGoal,
    max_players: 0,
    registered_count: participantCount,
    scheduled_start_at: startAt,
    challenge_duration_days: durationDays,
    challenge_timezone: asString(
      pickRaw(obj, "challengeTimezone", "challenge_timezone", "timezone"),
    ),
    challenge_end_at: endAt,
    selected_track_theme_id: asString(pickRaw(obj, "selected_track_theme_id", "trackLayout")) ?? "bg",
    theme_name: asString(pickRaw(obj, "theme_name", "themeName")) ?? "Unlimited",
    is_private: !!isPrivate,
    requires_code:
      asBool(pickRaw(obj, "requires_code", "requiresCode")) ?? !!isPrivate,
    host_user_id: hostUserId,
    host_username: hostUsername,
    host_avatar_color:
      asString(pickRaw(obj, "host_avatar_color", "hostAvatarColor")) ??
      asString(pickRaw(host, "avatarColor", "avatar_color")) ??
      "#00E676",
    host_avatar_url:
      asString(pickRaw(obj, "host_avatar_url", "hostAvatarUrl")) ??
      asString(pickRaw(host, "avatarUrl", "avatar_url")),
    host_country_flag:
      asString(pickRaw(obj, "host_country_flag", "hostCountryFlag")) ??
      asString(pickRaw(host, "countryFlag", "country_flag")),
    current_user_registered: member,
    eligible_to_register: eligible && !member,
    capacity_mode: "unlimited",
    platform_fee_cents: asNumber(pickRaw(obj, "platformFeeCents", "platform_fee_cents")),
    total_charge_cents: asNumber(pickRaw(obj, "totalChargeCents", "total_charge_cents")),
    reward_pool: rewardPoolDollars,
    settlement_status: asString(pickRaw(obj, "settlementStatus", "settlement_status")),
    qualified_participant_count: asNumber(
      pickRaw(obj, "qualifiedParticipantCount", "qualified_participant_count"),
    ),
  };
}

export function unlimitedUpcomingToRoomLike(
  room: UnlimitedUpcomingRoom,
): AvailableRoomLike {
  const players = Math.max(1, room.registered_count ?? 1);
  const rewardPool =
    typeof room.reward_pool === "number" && room.reward_pool > 0
      ? room.reward_pool
      : room.entry_fee > 0
        ? room.entry_fee * players
        : null;
  return {
    room_id: room.room_id,
    title: room.title,
    challenge_type: room.challenge_type,
    entry_fee: room.entry_fee,
    coin_entry_amount: room.coin_entry_amount,
    reward_pool: rewardPool,
    registered_count: room.registered_count,
    current_players: room.registered_count,
    max_players: null,
    scheduled_start_at: room.scheduled_start_at,
    challenge_end_at: room.challenge_end_at,
    challenge_duration_days: room.challenge_duration_days,
    is_private: room.is_private,
    requires_code: room.requires_code,
    joinable: room.eligible_to_register,
    eligible_to_register: room.eligible_to_register,
    status: room.status,
    capacity_mode: "unlimited",
    host_user_id: room.host_user_id,
  };
}

export function mergeUpcomingRoomsById<T extends { room_id: string; current_user_registered?: boolean }>(
  ...lists: Array<T[] | null | undefined>
): T[] {
  const map = new Map<string, T>();
  for (const list of lists) {
    for (const room of list ?? []) {
      if (!room?.room_id) continue;
      const prev = map.get(room.room_id);
      if (!prev) {
        map.set(room.room_id, room);
        continue;
      }
      const merged = { ...prev, ...room } as T;
      // Never let a later row clear membership once we've seen registered=true.
      if (prev.current_user_registered === true || room.current_user_registered === true) {
        merged.current_user_registered = true;
      }
      map.set(room.room_id, merged);
    }
  }
  return [...map.values()];
}
