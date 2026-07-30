/**
 * Browse/list Unlimited Challenges for Available Rooms, Next Race, Trending, Live.
 */

import { authFetch } from "@/utils/authFetch";
import { isUnlimitedGoalFrontendEnabled } from "@/config/featureFlags";
import { logger } from "@/utils/logger";
import {
  loadHostedUnlimitedChallenges,
  saveHostedUnlimitedChallenge,
} from "@/utils/hostedUnlimitedCache";
import {
  extractUnlimitedChallengeRows,
  mergeUpcomingRoomsById,
  normalizeUnlimitedChallengeToUpcomingRoom,
  unlimitedUpcomingToRoomLike,
  type UnlimitedUpcomingRoom,
} from "@/utils/unlimitedChallengeRooms";
import {
  isUnlimitedLiveEligible,
  mapUnlimitedUpcomingToLiveRaceFields,
  normalizeUnlimitedLiveStatus,
  type UnlimitedLiveRaceFields,
} from "@/utils/unlimitedLiveRace";
import type { AvailableRoomLike } from "@/utils/trendingChallenges";

/** Browse/waiting list endpoints — `/available` 404s on current API; keep last. */
const LIST_PATHS = [
  "/api/unlimited-challenges?visibility=public",
  "/api/unlimited-challenges",
  "/api/rooms/available?tab=upcoming&challengeType=unlimited_goal",
  "/api/rooms/available?filter=all&sort=newest&limit=50&challengeType=unlimited_goal",
  "/api/unlimited-challenges/available",
] as const;

/**
 * Live tab sources. Default list still returns started Unlimited rows (status may
 * stay "waiting"); classify by startAt/endAt client-side. Status probes are
 * best-effort — many 404 or ignore the param.
 */
const LIVE_LIST_PATHS = [
  "/api/unlimited-challenges",
  "/api/unlimited-challenges?visibility=public",
  "/api/unlimited-challenges?status=active",
  "/api/unlimited-challenges?status=in_progress",
  "/api/unlimited-challenges?status=active&visibility=public",
  "/api/unlimited-challenges?status=completed",
  "/api/unlimited-challenges/active",
  "/api/unlimited-challenges/my-active",
  "/api/unlimited-challenges/mine",
] as const;

function topKeys(data: unknown): string {
  if (Array.isArray(data)) return `array(len=${data.length})`;
  if (data && typeof data === "object") {
    return Object.keys(data as object).slice(0, 12).join(",");
  }
  return typeof data;
}

async function fetchPathRows(path: string): Promise<UnlimitedUpcomingRoom[]> {
  try {
    const res = await authFetch(path);
    if (!res.ok) {
      if (res.status !== 404) {
        logger.debug("UnlimitedList", `${path} status=${res.status}`);
      }
      return [];
    }
    const data: unknown = await res.json().catch(() => null);
    const rows = extractUnlimitedChallengeRows(data);
    const normalized = rows
      .map(normalizeUnlimitedChallengeToUpcomingRoom)
      .filter((r): r is UnlimitedUpcomingRoom => r != null);
    logger.debug(
      "UnlimitedList",
      `${path} keys=${topKeys(data)} raw=${rows.length} normalized=${normalized.length}` +
        (normalized[0]
          ? ` sampleId=${normalized[0].room_id} start=${normalized[0].scheduled_start_at ?? "null"} status=${normalized[0].status} host=${normalized[0].host_user_id || "none"} fee=${normalized[0].entry_fee}`
          : ""),
    );
    return normalized;
  } catch (err) {
    logger.debug(
      "UnlimitedList",
      `${path} failed: ${err instanceof Error ? err.message : "error"}`,
    );
    return [];
  }
}

async function fetchUnlimitedDetailRoom(id: string): Promise<UnlimitedUpcomingRoom | null> {
  try {
    const res = await authFetch(`/api/unlimited-challenges/${id}`);
    if (!res.ok) return null;
    const data: unknown = await res.json().catch(() => null);
    const rows = extractUnlimitedChallengeRows(data);
    const first = rows[0] ?? data;
    return normalizeUnlimitedChallengeToUpcomingRoom(first);
  } catch {
    return null;
  }
}

function startHasPassed(room: UnlimitedUpcomingRoom, nowMs = Date.now()): boolean {
  if (!room.scheduled_start_at) return false;
  const t = new Date(room.scheduled_start_at).getTime();
  return Number.isFinite(t) && t <= nowMs;
}

/**
 * Public/joinable unlimited challenges from dedicated + rooms list endpoints,
 * plus locally hosted seeds so the creator always sees their room.
 */
export async function fetchAvailableUnlimitedChallenges(opts?: {
  viewerUserId?: string | null;
}): Promise<UnlimitedUpcomingRoom[]> {
  if (!isUnlimitedGoalFrontendEnabled()) return [];

  const [batches, hosted] = await Promise.all([
    Promise.all(LIST_PATHS.map((p) => fetchPathRows(p))),
    loadHostedUnlimitedChallenges(),
  ]);

  const fromApi = mergeUpcomingRoomsById(...batches).map((room) => {
    const isViewerHost =
      !!opts?.viewerUserId &&
      !!room.host_user_id &&
      room.host_user_id === opts.viewerUserId;
    if (!isViewerHost) return room;
    return {
      ...room,
      current_user_registered: true,
      eligible_to_register: false,
    };
  });
  const merged = mergeUpcomingRoomsById(hosted, fromApi);

  await Promise.all(
    fromApi.map(async (room) => {
      const isViewerHost =
        !!opts?.viewerUserId &&
        !!room.host_user_id &&
        room.host_user_id === opts.viewerUserId;
      if (room.scheduled_start_at && (room.current_user_registered || isViewerHost)) {
        await saveHostedUnlimitedChallenge({
          ...room,
          current_user_registered: true,
          host_user_id: room.host_user_id || opts?.viewerUserId || "",
        });
      }
    }),
  );

  logger.debug(
    "UnlimitedList",
    `merged api=${fromApi.length} hosted=${hosted.length} total=${merged.length} viewer=${opts?.viewerUserId ? "yes" : "no"}`,
  );
  return merged;
}

export async function fetchAvailableUnlimitedAsRoomLikes(opts?: {
  viewerUserId?: string | null;
}): Promise<AvailableRoomLike[]> {
  const rooms = await fetchAvailableUnlimitedChallenges(opts);
  return rooms.map(unlimitedUpcomingToRoomLike);
}

/**
 * Active + recently finished Unlimited challenges for the Live tab.
 * Uses the default list (still returns started rows) + status probes + detail
 * hydration; classifies by startAt/endAt when API status stays "waiting".
 */
export async function fetchLiveUnlimitedChallenges(opts?: {
  viewerUserId?: string | null;
}): Promise<{ live: UnlimitedLiveRaceFields[]; finished: UnlimitedLiveRaceFields[] }> {
  if (!isUnlimitedGoalFrontendEnabled()) {
    return { live: [], finished: [] };
  }

  const nowMs = Date.now();
  const [batches, hosted] = await Promise.all([
    Promise.all(LIVE_LIST_PATHS.map((p) => fetchPathRows(p))),
    loadHostedUnlimitedChallenges({ includeStarted: true }),
  ]);

  const fromApi = mergeUpcomingRoomsById(...batches);
  const knownIds = new Set(fromApi.map((r) => r.room_id));

  // Detail-hydrate: hosted misses + any list row whose start already passed
  // (list rows often keep stale "waiting" / thin fields).
  const idsNeedingDetail = new Set<string>();
  for (const h of hosted) {
    if (!knownIds.has(h.room_id) || startHasPassed(h, nowMs)) {
      idsNeedingDetail.add(h.room_id);
    }
  }
  for (const room of fromApi) {
    if (startHasPassed(room, nowMs)) idsNeedingDetail.add(room.room_id);
  }

  const detailRooms = (
    await Promise.all([...idsNeedingDetail].map((id) => fetchUnlimitedDetailRoom(id)))
  ).filter((r): r is UnlimitedUpcomingRoom => r != null);

  const merged = mergeUpcomingRoomsById(hosted, fromApi, detailRooms).map((room) => {
    const isViewerHost =
      !!opts?.viewerUserId &&
      !!room.host_user_id &&
      room.host_user_id === opts.viewerUserId;
    if (!isViewerHost && !room.current_user_registered) return room;
    return {
      ...room,
      current_user_registered: true,
      eligible_to_register: false,
      host_user_id: room.host_user_id || opts?.viewerUserId || room.host_user_id,
    };
  });

  await Promise.all(
    merged.map(async (room) => {
      const liveStatus = normalizeUnlimitedLiveStatus(room.status, {
        startAt: room.scheduled_start_at,
        endAt: room.challenge_end_at,
        nowMs,
      });
      if (
        isUnlimitedLiveEligible(liveStatus) &&
        (room.current_user_registered ||
          (!!opts?.viewerUserId && room.host_user_id === opts.viewerUserId))
      ) {
        await saveHostedUnlimitedChallenge({
          ...room,
          status: liveStatus,
          current_user_registered: true,
        });
      }
    }),
  );

  const live: UnlimitedLiveRaceFields[] = [];
  const finished: UnlimitedLiveRaceFields[] = [];
  for (const room of merged) {
    const mapped = mapUnlimitedUpcomingToLiveRaceFields(room, nowMs);
    if (!mapped) continue;
    if (mapped.status === "completed") finished.push(mapped);
    else live.push(mapped);
  }

  logger.debug(
    "UnlimitedList",
    `liveTab live=${live.length} finished=${finished.length} api=${fromApi.length} hosted=${hosted.length} details=${detailRooms.length}` +
      (live[0] ? ` sampleLive=${live[0].id} fee=${live[0].entryAmountCents}` : ""),
  );
  return { live, finished };
}
