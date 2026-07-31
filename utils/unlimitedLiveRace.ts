/**
 * Map Unlimited Challenge rows/detail into Live-tab / live-detail shapes.
 */

import { UNLIMITED_GOAL_CHALLENGE_TYPE } from "@/utils/unlimitedGoal";
import type { UnlimitedUpcomingRoom } from "@/utils/unlimitedChallengeRooms";
import { mapUnlimitedDetailToWaitingRoom } from "@/utils/unlimitedWaitingRoom";

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

const LIVE_STATUSES = new Set([
  "active",
  "in_progress",
  "running",
  "started",
  "live",
]);
const FINISHED_STATUSES = new Set([
  "completed",
  "finished",
  "ended",
  "closed",
  "cancelled",
  "canceled",
]);
const WAITING_STATUSES = new Set([
  "waiting",
  "scheduled",
  "open",
  "registration",
  "pending",
]);

/** Normalize API status → Live tab status (`in_progress` | `completed` | other).
 * Prefer schedule windows over stale waiting/scheduled labels — backend may keep
 * listing active Unlimited rows as "waiting" after startAtUtc.
 */
export function normalizeUnlimitedLiveStatus(
  status: string | null | undefined,
  opts?: { startAt?: string | null; endAt?: string | null; nowMs?: number },
): "in_progress" | "completed" | "waiting" | string {
  const raw = (status ?? "").trim().toLowerCase();
  if (FINISHED_STATUSES.has(raw)) return "completed";
  if (LIVE_STATUSES.has(raw)) return "in_progress";

  const now = opts?.nowMs ?? Date.now();
  const startMs = opts?.startAt ? new Date(opts.startAt).getTime() : NaN;
  const endMs = opts?.endAt ? new Date(opts.endAt).getTime() : NaN;

  if (Number.isFinite(endMs) && endMs <= now) return "completed";
  if (Number.isFinite(startMs) && startMs <= now) {
    if (!Number.isFinite(endMs) || endMs > now) return "in_progress";
  }

  if (WAITING_STATUSES.has(raw)) return "waiting";
  return raw || "waiting";
}

export function isUnlimitedLiveEligible(status: string): boolean {
  return status === "in_progress" || status === "completed";
}

/** Cash badge label for Live cards (matches $1/$3 style). */
export function unlimitedEntryTypeLabel(entryFeeDollars: number): string {
  if (entryFeeDollars > 0 && Number.isInteger(entryFeeDollars)) {
    return `$${entryFeeDollars}`;
  }
  if (entryFeeDollars > 0) {
    return `$${entryFeeDollars.toFixed(2)}`;
  }
  return "USD Entry";
}

export type UnlimitedLiveRaceFields = {
  id: string;
  title: string;
  type: "paid";
  entryType: string;
  playerCount: number;
  maxPlayers: number;
  targetSteps: number;
  status: string;
  prizePool: number;
  prizePoolCents: number;
  entryAmountCents: number;
  coinEntryAmount: number;
  spectatorCount: number;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  players: [];
  trackLayout: string;
  reactionCounts: Record<string, never>;
  elapsedSeconds: number;
  challengeEndAt: string | null;
  challengeDurationDays: number;
  hostUserId: string | null;
  currentUserParticipating: boolean;
  challengeType: typeof UNLIMITED_GOAL_CHALLENGE_TYPE;
  capacityMode: "unlimited";
};

export function mapUnlimitedUpcomingToLiveRaceFields(
  room: UnlimitedUpcomingRoom,
  nowMs = Date.now(),
): UnlimitedLiveRaceFields | null {
  const status = normalizeUnlimitedLiveStatus(room.status, {
    startAt: room.scheduled_start_at,
    endAt: room.challenge_end_at,
    nowMs,
  });
  if (!isUnlimitedLiveEligible(status)) return null;

  const entryCents = Math.round((room.entry_fee ?? 0) * 100);
  const prizeDollars =
    typeof room.reward_pool === "number" && room.reward_pool > 0
      ? room.reward_pool
      : room.entry_fee > 0
        ? room.entry_fee * Math.max(1, room.registered_count)
        : 0;
  const prizeCents = Math.round(prizeDollars * 100);
  const startedAt =
    status === "in_progress" || status === "completed"
      ? room.scheduled_start_at
      : null;
  const completedAt =
    status === "completed" ? room.challenge_end_at : null;

  const elapsed =
    startedAt != null
      ? Math.max(
          0,
          Math.floor(
            ((completedAt ? new Date(completedAt).getTime() : nowMs) -
              new Date(startedAt).getTime()) /
              1000,
          ),
        )
      : 0;

  return {
    id: room.room_id,
    title: room.title,
    type: "paid",
    entryType: unlimitedEntryTypeLabel(room.entry_fee),
    playerCount: Math.max(1, room.registered_count ?? 1),
    maxPlayers: 0,
    targetSteps: room.target_steps,
    status,
    prizePool: prizeDollars,
    prizePoolCents: prizeCents,
    entryAmountCents: entryCents,
    coinEntryAmount: 0,
    spectatorCount: 0,
    startedAt,
    completedAt,
    createdAt: room.scheduled_start_at ?? new Date(nowMs).toISOString(),
    players: [],
    trackLayout: room.selected_track_theme_id || "bg",
    reactionCounts: {},
    elapsedSeconds: elapsed,
    challengeEndAt: room.challenge_end_at,
    challengeDurationDays: room.challenge_duration_days ?? 0,
    hostUserId: room.host_user_id || null,
    currentUserParticipating: !!room.current_user_registered,
    challengeType: UNLIMITED_GOAL_CHALLENGE_TYPE,
    capacityMode: "unlimited",
  };
}

export type UnlimitedLiveDetailMapped = {
  race: {
    id: string;
    title: string;
    status: string;
    type: string;
    entryType: string;
    entryAmountCents: number;
    entryAmountDollars: number;
    targetSteps: number;
    currentPlayers: number;
    maxPlayers: number | null;
    startedAt: string | null;
    completedAt: string | null;
    scheduledStartAt: string | null;
    creatorId: string;
    prizePool: number;
    prizeTiers: number[];
    spectatorCount: number;
    capacityMode: "unlimited";
    challengeType: typeof UNLIMITED_GOAL_CHALLENGE_TYPE;
    trackLayout: string;
    challengeEndAt: string | null;
    challengeDurationDays: number | null;
    prizePoolCents: number;
    hasExplicitPlayerCount?: boolean;
  };
  participants: Array<{
    id: string;
    userId: string;
    currentSteps: number;
    status: string | null;
    rank: number | null;
    username: string;
    countryFlag: string | null;
    avatarColor: string | null;
    avatarUrl?: string | null;
    avatarVersion?: number | null;
    isHost: boolean;
  }>;
};

function mapParticipant(raw: unknown, index: number): UnlimitedLiveDetailMapped["participants"][number] | null {
  const obj = asRecord(raw);
  if (!obj) return null;
  const user =
    asRecord(pick(obj, "user", "profile", "member", "registrant", "walker", "athlete")) ??
    {};
  const userId =
    asString(
      pick(
        obj,
        "userId",
        "user_id",
        "memberUserId",
        "member_user_id",
        "uid",
        "participantUserId",
        "participant_user_id",
      ),
    ) ??
    asString(pick(user, "id", "userId", "user_id")) ??
    // Some list rows use top-level `id` as the user id.
    asString(pick(obj, "id"));
  if (!userId) return null;
  const username =
    asString(
      pick(obj, "displayName", "display_name", "fullName", "full_name", "username", "name", "handle"),
    ) ??
    asString(
      pick(user, "displayName", "display_name", "fullName", "full_name", "username", "name", "handle"),
    ) ??
    "Walker";
  const statusRaw = asString(
    pick(obj, "status", "participantStatus", "participant_status", "registrationStatus"),
  );
  return {
    id:
      asString(pick(obj, "participantId", "participant_id", "registrationId", "registration_id")) ??
      asString(pick(obj, "id")) ??
      `${userId}:${index}`,
    userId,
    currentSteps:
      asNumber(
        pick(
          obj,
          "currentSteps",
          "current_steps",
          "steps",
          "todaySteps",
          "today_steps",
          "raceSteps",
          "race_steps",
          "stepCount",
          "step_count",
        ),
      ) ?? 0,
    // Default active so preview rows without status aren't filtered out of Live Race.
    status: statusRaw ?? "active",
    rank: asNumber(pick(obj, "rank", "displayRank", "display_rank", "position")),
    username,
    countryFlag:
      asString(pick(obj, "countryFlag", "country_flag")) ??
      asString(pick(user, "countryFlag", "country_flag")),
    avatarColor:
      asString(pick(obj, "avatarColor", "avatar_color")) ??
      asString(pick(user, "avatarColor", "avatar_color")) ??
      "#00E676",
    avatarUrl:
      asString(pick(obj, "avatarUrl", "avatar_url")) ??
      asString(pick(user, "avatarUrl", "avatar_url")),
    avatarVersion:
      asNumber(pick(obj, "avatarVersion", "avatar_version")) ??
      asNumber(pick(user, "avatarVersion", "avatar_version")),
    isHost:
      asString(pick(obj, "role", "membershipRole", "membership_role"))?.toLowerCase() ===
        "host" || pick(obj, "isHost", "is_host") === true,
  };
}

/** Merge extra participant rows (e.g. from /api/races/:id) into an Unlimited mapped list. */
export function mergeUnlimitedLiveParticipants(
  primary: UnlimitedLiveDetailMapped["participants"],
  extra: unknown[],
): UnlimitedLiveDetailMapped["participants"] {
  const byUser = new Map<string, UnlimitedLiveDetailMapped["participants"][number]>();
  primary.forEach((p, i) => {
    if (p.userId) byUser.set(p.userId, p);
    else byUser.set(p.id || `p:${i}`, p);
  });
  extra.forEach((row, i) => {
    const mapped = mapParticipant(row, primary.length + i);
    if (!mapped) return;
    const prev = byUser.get(mapped.userId);
    if (!prev) {
      byUser.set(mapped.userId, mapped);
      return;
    }
    byUser.set(mapped.userId, {
      ...prev,
      ...mapped,
      currentSteps: Math.max(prev.currentSteps, mapped.currentSteps),
      username: mapped.username !== "Walker" ? mapped.username : prev.username,
      isHost: prev.isHost || mapped.isHost,
    });
  });
  return [...byUser.values()];
}

/** Map GET /api/unlimited-challenges/:id → live-detail race + participants. */
export function mapUnlimitedDetailToLiveDetail(
  payload: unknown,
): UnlimitedLiveDetailMapped | null {
  const waiting = mapUnlimitedDetailToWaitingRoom(payload);
  if (!waiting) return null;

  const root = asRecord(payload);
  const challenge =
    (root && asRecord(pick(root, "challenge", "unlimitedChallenge", "data"))) ??
    root ??
    {};

  const endAt = asString(
    pick(
      challenge,
      "challengeEndAtUtc",
      "challenge_end_at_utc",
      "challengeEndAt",
      "challenge_end_at",
      "endAtUtc",
      "end_at_utc",
    ),
  );
  const startAt =
    waiting.race.startedAt ??
    waiting.race.scheduledStartAt ??
    asString(pick(challenge, "startAtUtc", "start_at_utc", "startedAt", "started_at"));

  const status = normalizeUnlimitedLiveStatus(waiting.race.status, {
    startAt,
    endAt,
  });

  const entryCents = waiting.race.entryAmountCents ?? 0;
  // Prefer explicit challenge.participantCount — never inflate from a duplicated list.
  const participantCount = waiting.race.hasExplicitPlayerCount
    ? Math.max(waiting.race.currentPlayers, 1)
    : Math.max(waiting.race.currentPlayers, waiting.participants.length, 1);
  const apiPrize =
    asNumber(pick(challenge, "prizePoolCents", "prize_pool_cents", "currentPrizePoolCents")) ??
    0;
  const prizeCents =
    apiPrize > 0 ? apiPrize : entryCents > 0 ? entryCents * participantCount : 0;
  const prizeDollars = prizeCents / 100;

  const title =
    asString(pick(challenge, "title", "name")) ??
    `Unlimited · ${waiting.race.targetSteps.toLocaleString()} steps/day`;

  const hostUserId =
    asString(pick(challenge, "hostUserId", "host_user_id")) ?? "";

  let participants = waiting.participants
    .map((p, i) => mapParticipant(p, i))
    .filter((p): p is NonNullable<typeof p> => p != null);

  // Ensure host appears if participants empty.
  if (participants.length === 0 && hostUserId) {
    participants = [
      {
        id: hostUserId,
        userId: hostUserId,
        currentSteps: 0,
        status: "active",
        rank: 1,
        username: asString(pick(challenge, "hostUsername", "host_username")) ?? "Host",
        countryFlag: null,
        avatarColor: "#00E676",
        isHost: true,
      },
    ];
  }

  return {
    race: {
      id: waiting.race.id,
      title,
      status,
      type: "paid",
      entryType: UNLIMITED_GOAL_CHALLENGE_TYPE,
      entryAmountCents: entryCents,
      entryAmountDollars: entryCents / 100,
      targetSteps: waiting.race.targetSteps,
      currentPlayers: waiting.race.hasExplicitPlayerCount
        ? participantCount
        : Math.max(participantCount, participants.length, 1),
      maxPlayers: null,
      startedAt: status === "waiting" ? null : startAt,
      completedAt: status === "completed" ? endAt : null,
      scheduledStartAt: waiting.race.scheduledStartAt,
      creatorId: hostUserId,
      prizePool: prizeDollars,
      prizeTiers: [],
      spectatorCount: 0,
      capacityMode: "unlimited",
      challengeType: UNLIMITED_GOAL_CHALLENGE_TYPE,
      trackLayout: "bg",
      challengeEndAt: endAt,
      challengeDurationDays: asNumber(
        pick(challenge, "durationDays", "duration_days", "challengeDurationDays"),
      ),
      prizePoolCents: prizeCents,
      hasExplicitPlayerCount: !!waiting.race.hasExplicitPlayerCount,
    },
    participants,
  };
}
