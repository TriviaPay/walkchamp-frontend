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
  "starting",
  "settling",
]);
const FINISHED_STATUSES = new Set([
  "completed",
  "finished",
  "ended",
  "closed",
  "cancelled",
  "canceled",
  "cancelled_by_platform",
  "canceled_by_platform",
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
 *
 * When `requireServerLive` is true (Live tab), never promote waiting→live via
 * schedule alone — that resurrects cancelled challenges from device cache.
 */
export function normalizeUnlimitedLiveStatus(
  status: string | null | undefined,
  opts?: {
    startAt?: string | null;
    endAt?: string | null;
    nowMs?: number;
    /** Live tab: only trust explicit live/finished server statuses. */
    requireServerLive?: boolean;
  },
): "in_progress" | "completed" | "waiting" | string {
  const raw = (status ?? "").trim().toLowerCase();
  if (FINISHED_STATUSES.has(raw)) return "completed";
  if (LIVE_STATUSES.has(raw)) return "in_progress";

  if (opts?.requireServerLive) {
    if (WAITING_STATUSES.has(raw)) return "waiting";
    return raw || "waiting";
  }

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

/** Terminal statuses that should never appear as Live Now cards. */
export function isUnlimitedTerminalExcludedFromLive(status: string | null | undefined): boolean {
  const raw = (status ?? "").trim().toLowerCase();
  return (
    raw === "cancelled" ||
    raw === "canceled" ||
    raw === "cancelled_by_platform" ||
    raw === "canceled_by_platform"
  );
}

/** Ended challenges eligible for Live "Recently Finished".
 *  Only true completions — cancelled / platform-cancelled must not appear as FINISHED. */
export function isUnlimitedFinishedForLiveTab(status: string | null | undefined): boolean {
  const raw = (status ?? "").trim().toLowerCase();
  if (isUnlimitedTerminalExcludedFromLive(raw)) return false;
  return (
    raw === "completed" ||
    raw === "finished" ||
    raw === "ended" ||
    raw === "closed"
  );
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
  if (isUnlimitedTerminalExcludedFromLive(room.status)) return null;

  const status = normalizeUnlimitedLiveStatus(room.status, {
    startAt: room.scheduled_start_at,
    endAt: room.challenge_end_at,
    nowMs,
    // Live cards must not resurrect cancelled/waiting seeds via schedule windows.
    requireServerLive: true,
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
    challengeTimezone?: string | null;
    challengeDayKey?: string | null;
    /** Raw backend challenge.status (waiting|starting|active|settling|completed|cancelled_by_platform) —
     * unlike `status` above, this is never collapsed into "in_progress"/"completed"/"waiting", so
     * callers can tell "settling" (settlement running) apart from "active" (see utils/unlimitedResults.ts). */
    rawStatus?: string | null;
    /** Raw backend challenge.settlementStatus (pending|in_progress|completed|manual_review|rolled_over|refunded). */
    settlementStatus?: string | null;
    /** Backend challenge.resultsStatus — branch UI on this, not global status. */
    resultsStatus?: string | null;
    registeredParticipantCount?: number | null;
    participantsFinishedCount?: number | null;
    participantsPendingCount?: number | null;
    qualifiedParticipantCount?: number | null;
    /** Viewer's own prize-pool eligibility from detail/my-active (pending|eligible|not_eligible). */
    prizePoolEligibilityStatus?: string | null;
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
    totalChallengeSteps?: number | null;
    challengeDayKey?: string | null;
    completedDays?: number | null;
    /** Locked participant timezone for this player's active day window (backend-authoritative). */
    timezone?: string | null;
    /** 1-based active day number for this player (backend-authoritative). */
    dayNumber?: number | null;
    qualificationStatus?: string | null;
    dailyGoalSteps?: number | null;
    prizePoolEligibilityStatus?: string | null;
    /** Display-only: steps at day open (HC midnight baseline). */
    raceStartBaselineSteps?: number | null;
    /** Display-only: challenge-day progress (usually today's total). */
    challengeDaySteps?: number | null;
  }>;
};

function mapParticipant(raw: unknown, index: number): UnlimitedLiveDetailMapped["participants"][number] | null {
  const obj = asRecord(raw);
  if (!obj) return null;
  const user =
    asRecord(pick(obj, "user", "profile", "member", "registrant", "walker", "athlete")) ??
    {};
  // Prefer explicit userId fields; fall back to row id (Waiting Room does the same)
  // so Unlimited detail rows that only expose `id` still appear on Live Race.
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
    asString(pick(obj, "participantId", "participant_id", "id"));
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
  const progress = asRecord(pick(obj, "progress", "stats", "liveProgress", "live_progress")) ?? {};
  // currentSteps = challenge-day progress only. Never fall back to totalChallengeSteps.
  const currentSteps = Math.max(
    asNumber(
      pick(
        obj,
        "currentSteps",
        "current_steps",
        "todaySteps",
        "today_steps",
      ),
    ) ?? 0,
    asNumber(
      pick(
        progress,
        "currentSteps",
        "current_steps",
        "todaySteps",
        "today_steps",
      ),
    ) ?? 0,
  );
  const totalChallengeSteps = asNumber(
    pick(obj, "totalChallengeSteps", "total_challenge_steps"),
  );
  const challengeDayKey =
    asString(pick(obj, "challengeDayKey", "challenge_day_key", "localDate", "local_date")) ??
    null;
  const completedDays = asNumber(pick(obj, "completedDays", "completed_days"));
  // Backend-authoritative locked-timezone / active-day fields — only populated
  // once this player has a live day window (loadChallengePlayers in
  // Backend/src/lib/unlimitedLiveProgress.ts). Used to build the viewer schedule
  // without ever guessing or converting from the host's timezone.
  const timezone = asString(pick(obj, "timezone"));
  const dayNumber = asNumber(pick(obj, "dayNumber", "day_number"));
  const qualificationStatus = asString(pick(obj, "qualificationStatus", "qualification_status"));
  const dailyGoalSteps = asNumber(pick(obj, "dailyGoalSteps", "daily_goal_steps"));
  const prizePoolEligibilityStatus = asString(
    pick(obj, "prizePoolEligibilityStatus", "prize_pool_eligibility_status"),
  );
  const raceStartBaselineSteps = asNumber(
    pick(obj, "raceStartBaselineSteps", "race_start_baseline_steps", "startBaselineSteps", "start_baseline_steps"),
  );
  const challengeDaySteps = asNumber(
    pick(obj, "challengeDaySteps", "challenge_day_steps"),
  );
  return {
    id:
      asString(pick(obj, "participantId", "participant_id", "registrationId", "registration_id")) ??
      asString(pick(obj, "id")) ??
      `${userId}:${index}`,
    userId,
    currentSteps,
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
    ...(totalChallengeSteps != null ? { totalChallengeSteps } : {}),
    ...(challengeDayKey ? { challengeDayKey } : {}),
    ...(completedDays != null ? { completedDays } : {}),
    ...(timezone ? { timezone } : {}),
    ...(dayNumber != null ? { dayNumber } : {}),
    ...(qualificationStatus ? { qualificationStatus } : {}),
    ...(dailyGoalSteps != null ? { dailyGoalSteps } : {}),
    ...(prizePoolEligibilityStatus ? { prizePoolEligibilityStatus } : {}),
    ...(raceStartBaselineSteps != null ? { raceStartBaselineSteps } : {}),
    ...(challengeDaySteps != null ? { challengeDaySteps } : {}),
  };
}

/** Seed dummy usernames from Backend/scripts (`du` + 12 hex). */
function isSeedDummyUsername(name: string | null | undefined): boolean {
  return !!name && /^du[a-f0-9]{12}$/i.test(name.trim());
}

/** Prefer a human-readable label over seed `du…` codes when merging rosters. */
function preferLiveDisplayUsername(primary: string, overlay: string): string {
  if (!overlay || overlay === "Walker") return primary || overlay || "Walker";
  if (!primary || primary === "Walker") return overlay;
  if (isSeedDummyUsername(overlay) && !isSeedDummyUsername(primary)) return primary;
  if (isSeedDummyUsername(primary) && !isSeedDummyUsername(overlay)) return overlay;
  // Detail roster is authoritative for names when enriching from leaderboard.
  return primary;
}

/** Merge extra participant rows into an Unlimited mapped list.
 * Leaderboard may enrich rank / totalChallengeSteps / completedDays / challengeDayKey,
 * but must NOT overwrite today's currentSteps with a multi-day total.
 */
export function mergeUnlimitedLiveParticipants(
  primary: UnlimitedLiveDetailMapped["participants"],
  extra: unknown[],
  opts?: { preferPrimaryCurrentSteps?: boolean },
): UnlimitedLiveDetailMapped["participants"] {
  const preferPrimaryCurrentSteps = opts?.preferPrimaryCurrentSteps !== false;
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
    const sameDay =
      !prev.challengeDayKey ||
      !mapped.challengeDayKey ||
      prev.challengeDayKey === mapped.challengeDayKey;
    // Prefer detail (primary) currentSteps when overlaying leaderboard enrichment.
    const currentSteps = preferPrimaryCurrentSteps
      ? prev.currentSteps
      : sameDay
        ? Math.max(prev.currentSteps, mapped.currentSteps)
        : mapped.currentSteps;
    byUser.set(mapped.userId, {
      ...prev,
      ...mapped,
      currentSteps,
      totalChallengeSteps:
        mapped.totalChallengeSteps ?? prev.totalChallengeSteps ?? null,
      challengeDayKey: mapped.challengeDayKey ?? prev.challengeDayKey ?? null,
      completedDays: mapped.completedDays ?? prev.completedDays ?? null,
      timezone: mapped.timezone ?? prev.timezone ?? null,
      dayNumber: mapped.dayNumber ?? prev.dayNumber ?? null,
      qualificationStatus: mapped.qualificationStatus ?? prev.qualificationStatus ?? null,
      dailyGoalSteps: mapped.dailyGoalSteps ?? prev.dailyGoalSteps ?? null,
      // Keep "Dummy User 00012" / real usernames — do not let leaderboard `du…` codes win.
      username: preferLiveDisplayUsername(prev.username, mapped.username),
      isHost: prev.isHost || mapped.isHost,
      rank: mapped.rank ?? prev.rank,
    });
  });
  return [...byUser.values()];
}

/**
 * Overlay classic `/api/races/:id` live fields onto Unlimited detail.
 * Status/startedAt only — do NOT merge classic race participant steps into Unlimited
 * daily currentSteps (classic progress is a different write path).
 */
export function overlayClassicRaceOnUnlimitedDetail(
  unlimited: UnlimitedLiveDetailMapped,
  racePayload: unknown,
): UnlimitedLiveDetailMapped {
  const root = asRecord(racePayload);
  if (!root) return unlimited;

  const raceRec =
    asRecord(pick(root, "race", "data")) ??
    (typeof pick(root, "status") === "string" ? root : null);

  // Keep Unlimited roster as-is — classic race participants are not Unlimited daily progress.
  const participants = unlimited.participants;

  if (!raceRec) {
    return { ...unlimited, participants };
  }

  const apiStatus = asString(pick(raceRec, "status", "raceStatus", "race_status"));
  const startedAt =
    asString(pick(raceRec, "startedAt", "started_at", "startAt", "start_at")) ??
    unlimited.race.startedAt;
  const completedAt =
    asString(pick(raceRec, "completedAt", "completed_at")) ??
    unlimited.race.completedAt;

  let status = unlimited.race.status;
  if (apiStatus) {
    const normalized = normalizeUnlimitedLiveStatus(apiStatus, {
      startAt: startedAt ?? unlimited.race.scheduledStartAt,
      endAt: completedAt ?? unlimited.race.challengeEndAt,
      requireServerLive: true,
    });
    // Prefer classic race live/completed when Unlimited detail is still "waiting".
    if (
      normalized === "in_progress" ||
      normalized === "completed" ||
      status === "waiting" ||
      !status
    ) {
      status = normalized;
    }
  }

  const currentPlayers =
    asNumber(
      pick(raceRec, "currentPlayers", "current_players", "playerCount", "player_count"),
    ) ?? unlimited.race.currentPlayers;

  return {
    race: {
      ...unlimited.race,
      status,
      startedAt:
        status === "waiting"
          ? unlimited.race.startedAt
          : startedAt ?? unlimited.race.startedAt ?? unlimited.race.scheduledStartAt,
      completedAt: status === "completed" ? completedAt ?? unlimited.race.completedAt : null,
      currentPlayers: Math.max(currentPlayers ?? 0, participants.length, 1),
    },
    participants,
  };
}

/** Force a mapped Unlimited race into in_progress when the client is already tracking it. */
export function coerceUnlimitedRaceInProgress(
  race: UnlimitedLiveDetailMapped["race"],
  opts?: { forceLive?: boolean; nowMs?: number },
): UnlimitedLiveDetailMapped["race"] {
  if (race.status === "completed") return race;
  if (opts?.forceLive) {
    return {
      ...race,
      status: "in_progress",
      startedAt:
        race.startedAt ??
        race.scheduledStartAt ??
        new Date(opts.nowMs ?? Date.now()).toISOString(),
    };
  }
  const status = normalizeUnlimitedLiveStatus(race.status, {
    startAt: race.startedAt ?? race.scheduledStartAt,
    endAt: race.challengeEndAt,
    nowMs: opts?.nowMs,
    requireServerLive: true,
  });
  if (status === race.status) return race;
  return {
    ...race,
    status,
    startedAt:
      status === "waiting"
        ? null
        : race.startedAt ?? race.scheduledStartAt ?? new Date(opts?.nowMs ?? Date.now()).toISOString(),
  };
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

  // Trust server status for detail — do not invent FINISHED from endAt alone
  // (that produced 0-step "Race Finished" screens for still-open challenges).
  const status = normalizeUnlimitedLiveStatus(waiting.race.status, {
    startAt,
    endAt,
    requireServerLive: true,
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
    `Streak · ${waiting.race.targetSteps.toLocaleString()} steps/day`;

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
      challengeTimezone: asString(
        pick(challenge, "challengeTimezone", "challenge_timezone", "timezone"),
      ),
      challengeDayKey:
        asString(pick(challenge, "challengeDayKey", "challenge_day_key")) ??
        asString(pick(root ?? {}, "challengeDayKey", "challenge_day_key")),
      rawStatus: waiting.race.status,
      settlementStatus: asString(pick(challenge, "settlementStatus", "settlement_status")),
      resultsStatus:
        asString(pick(challenge, "resultsStatus", "results_status")) ??
        asString(pick(root ?? {}, "resultsStatus", "results_status")),
      registeredParticipantCount:
        asNumber(pick(challenge, "registeredParticipantCount", "registered_participant_count")) ??
        asNumber(pick(root ?? {}, "registeredParticipantCount", "registered_participant_count")),
      participantsFinishedCount:
        asNumber(pick(challenge, "participantsFinishedCount", "participants_finished_count")) ??
        asNumber(pick(root ?? {}, "participantsFinishedCount", "participants_finished_count")),
      participantsPendingCount:
        asNumber(pick(challenge, "participantsPendingCount", "participants_pending_count")) ??
        asNumber(pick(root ?? {}, "participantsPendingCount", "participants_pending_count")),
      qualifiedParticipantCount: asNumber(
        pick(challenge, "qualifiedParticipantCount", "qualified_participant_count"),
      ),
      prizePoolEligibilityStatus:
        asString(pick(challenge, "prizePoolEligibilityStatus", "prize_pool_eligibility_status")) ??
        asString(pick(root ?? {}, "prizePoolEligibilityStatus", "prize_pool_eligibility_status")),
    },
    participants,
  };
}
