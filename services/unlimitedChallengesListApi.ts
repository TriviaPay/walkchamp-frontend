/**
 * Browse/list Unlimited Challenges for Available Rooms, Next Race, Trending, Live.
 */

import { authFetch } from "@/utils/authFetch";
import { isUnlimitedGoalFrontendEnabled } from "@/config/featureFlags";
import { logger } from "@/utils/logger";
import {
  loadHostedUnlimitedChallenges,
  loadLeftUnlimitedChallengeIds,
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

function participantUserIdsFromDetailPayload(
  payload: unknown,
): { found: boolean; ids: string[] } {
  if (!payload || typeof payload !== "object") return { found: false, ids: [] };
  const root = payload as Record<string, unknown>;
  const challenge =
    root.challenge && typeof root.challenge === "object"
      ? (root.challenge as Record<string, unknown>)
      : root;
  const collections = [
    root.participants,
    root.registrations,
    root.members,
    challenge.participants,
    challenge.registrations,
    challenge.members,
  ];
  let found = false;
  const ids: string[] = [];
  for (const c of collections) {
    if (!Array.isArray(c)) continue;
    found = true;
    for (const row of c) {
      if (!row || typeof row !== "object") continue;
      const r = row as Record<string, unknown>;
      const user = r.user && typeof r.user === "object" ? (r.user as Record<string, unknown>) : null;
      const id =
        (typeof r.userId === "string" && r.userId) ||
        (typeof r.user_id === "string" && r.user_id) ||
        (typeof user?.id === "string" && user.id) ||
        (typeof user?.userId === "string" && user.userId) ||
        null;
      if (id) ids.push(id);
    }
  }
  return { found, ids };
}

/**
 * Drop hosted Next Race seeds when detail proves the viewer is no longer a member.
 * Leave-before-leftIds bugs left stale seeds that host heuristics kept resurrecting.
 */
async function reconcileHostedMembership(opts: {
  hosted: UnlimitedUpcomingRoom[];
  viewerUserId?: string | null;
}): Promise<UnlimitedUpcomingRoom[]> {
  const viewerId = opts.viewerUserId;
  if (!viewerId || opts.hosted.length === 0) return opts.hosted;

  const { removeHostedUnlimitedChallenge } = await import("@/utils/hostedUnlimitedCache");
  const kept: UnlimitedUpcomingRoom[] = [];

  await Promise.all(
    opts.hosted.map(async (seed) => {
      try {
        const res = await authFetch(`/api/unlimited-challenges/${seed.room_id}`);
        if (!res.ok) {
          kept.push(seed);
          return;
        }
        const data: unknown = await res.json().catch(() => null);
        const rawRow = (extractUnlimitedChallengeRows(data)[0] ?? data) as
          | Record<string, unknown>
          | null;
        const normalized = normalizeUnlimitedChallengeToUpcomingRoom(rawRow);
        const explicitReg =
          rawRow && typeof rawRow === "object"
            ? (() => {
                const v =
                  rawRow.currentUserRegistered ??
                  rawRow.current_user_registered ??
                  rawRow.isMember ??
                  rawRow.is_member ??
                  rawRow.joined;
                return typeof v === "boolean" ? v : null;
              })()
            : null;
        const partStatus = String(
          (rawRow as Record<string, unknown> | null)?.participationStatus ??
            (rawRow as Record<string, unknown> | null)?.participation_status ??
            "",
        ).toLowerCase();
        const rawLeft =
          partStatus === "left" ||
          partStatus === "withdrawn" ||
          partStatus === "cancelled" ||
          partStatus === "canceled" ||
          partStatus === "refunded";

        if (explicitReg === true && !rawLeft) {
          kept.push({
            ...seed,
            ...(normalized ?? {}),
            room_id: seed.room_id,
            current_user_registered: true,
          } as UnlimitedUpcomingRoom);
          return;
        }
        if (explicitReg === false || rawLeft) {
          await removeHostedUnlimitedChallenge(seed.room_id);
          logger.debug(
            "UnlimitedList",
            `reconcile drop seed id=${seed.room_id} explicitReg=${String(explicitReg)} left=${rawLeft}`,
          );
          return;
        }
        const { found: hasParticipantList, ids: participantIds } =
          participantUserIdsFromDetailPayload(data);
        if (hasParticipantList) {
          if (!participantIds.includes(viewerId)) {
            await removeHostedUnlimitedChallenge(seed.room_id);
            logger.debug(
              "UnlimitedList",
              `reconcile drop left seed id=${seed.room_id} viewer not in participants`,
            );
            return;
          }
          kept.push({ ...seed, current_user_registered: true });
          return;
        }
        // Ambiguous detail — keep seed (create path) until Leave marks leftIds.
        kept.push(seed);
      } catch {
        kept.push(seed);
      }
    }),
  );

  return kept;
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

  const fromApi = mergeUpcomingRoomsById(...batches);
  const leftIds = await loadLeftUnlimitedChallengeIds();
  const hostedActive = await reconcileHostedMembership({
    hosted,
    viewerUserId: opts?.viewerUserId,
  });

  // Membership = explicit API registered OR reconciled hosted seed.
  // Never treat hostUserId alone as registered (Leave keeps creator id on the row).
  const merged = mergeUpcomingRoomsById(hostedActive, fromApi).map((room) => {
    if (leftIds.has(room.room_id)) {
      return {
        ...room,
        current_user_registered: false,
        eligible_to_register: !room.is_private,
      };
    }
    const seed = hostedActive.find((h) => h.room_id === room.room_id);
    const registered =
      room.current_user_registered === true || !!seed?.current_user_registered;
    if (!registered) {
      return {
        ...room,
        current_user_registered: false,
      };
    }
    return {
      ...room,
      current_user_registered: true,
      eligible_to_register: false,
    };
  });

  // Refresh seeds only for rooms already joined (seed or explicit API membership).
  await Promise.all(
    merged.map(async (room) => {
      if (!room.scheduled_start_at || !room.current_user_registered || leftIds.has(room.room_id)) {
        return;
      }
      const hadSeed = hostedActive.some((h) => h.room_id === room.room_id);
      const apiRegistered = fromApi.some(
        (r) => r.room_id === room.room_id && r.current_user_registered,
      );
      if (!hadSeed && !apiRegistered) return;
      await saveHostedUnlimitedChallenge({
        ...room,
        current_user_registered: true,
        host_user_id: room.host_user_id || opts?.viewerUserId || "",
      });
    }),
  );

  logger.debug(
    "UnlimitedList",
    `merged api=${fromApi.length} hosted=${hostedActive.length} left=${leftIds.size} total=${merged.length} viewer=${opts?.viewerUserId ? "yes" : "no"}`,
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
  const leftIds = await loadLeftUnlimitedChallengeIds();
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

  // Membership is explicit only — never hostUserId (Leave keeps creator id).
  const merged = mergeUpcomingRoomsById(hosted, fromApi, detailRooms).map((room) => {
    if (leftIds.has(room.room_id)) {
      return {
        ...room,
        current_user_registered: false,
        eligible_to_register: !room.is_private,
      };
    }
    if (room.current_user_registered !== true) {
      return { ...room, current_user_registered: false };
    }
    return {
      ...room,
      current_user_registered: true,
      eligible_to_register: false,
    };
  });

  await Promise.all(
    merged.map(async (room) => {
      if (!room.current_user_registered || leftIds.has(room.room_id)) return;
      const liveStatus = normalizeUnlimitedLiveStatus(room.status, {
        startAt: room.scheduled_start_at,
        endAt: room.challenge_end_at,
        nowMs,
      });
      if (isUnlimitedLiveEligible(liveStatus)) {
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
