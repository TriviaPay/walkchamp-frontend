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
  purgeHostedUnlimitedChallenge,
  clearUnlimitedChallengeLeft,
} from "@/utils/hostedUnlimitedCache";
import {
  extractUnlimitedChallengeRows,
  mergeUpcomingRoomsById,
  normalizeUnlimitedChallengeToUpcomingRoom,
  unlimitedUpcomingToRoomLike,
  type UnlimitedUpcomingRoom,
} from "@/utils/unlimitedChallengeRooms";
import {
  isUnlimitedTerminalExcludedFromLive,
  isUnlimitedFinishedForLiveTab,
  mapUnlimitedUpcomingToLiveRaceFields,
  type UnlimitedLiveRaceFields,
} from "@/utils/unlimitedLiveRace";
import type { AvailableRoomLike } from "@/utils/trendingChallenges";

/**
 * Browse/waiting list — dedicated Unlimited APIs only.
 * Do NOT call `/api/rooms/available` here: classic Free/Cash rooms share list
 * envelopes and used to get stamped as unlimited_goal.
 */
const LIST_PATHS = [
  "/api/unlimited-challenges?visibility=public",
  "/api/unlimited-challenges",
  "/api/unlimited-challenges/available",
] as const;

/**
 * Live tab sources — dedicated Unlimited live endpoints first.
 * Fallbacks cover older API builds where `/live` is caught by `/:id` (404)
 * and `?status=` is ignored (waiting-only empty list).
 */
const LIVE_LIST_PATHS = [
  "/api/unlimited-challenges/live",
  "/api/unlimited-challenges/my-active",
  "/api/unlimited-challenges?status=active",
  "/api/unlimited-challenges?status=live",
  "/api/unlimited-challenges?status=in_progress",
] as const;

/** Recently finished Unlimited for Live tab (completed + platform-cancelled). */
const FINISHED_LIST_PATHS = [
  "/api/unlimited-challenges/recently-finished",
  "/api/unlimited-challenges?status=completed",
] as const;

const SERVER_LIVE_STATUSES = new Set([
  "active",
  "starting",
  "settling",
  "in_progress",
  "running",
  "live",
  "started",
]);

/**
 * When dedicated Unlimited live routes 404 on older deploys, `/api/races/my-active`
 * still returns unlimited_goal rows the viewer joined.
 */
async function fetchUnlimitedFromRacesMyActive(): Promise<UnlimitedUpcomingRoom[]> {
  try {
    const res = await authFetch("/api/races/my-active");
    if (!res.ok) return [];
    const data: unknown = await res.json().catch(() => null);
    const root = data && typeof data === "object" ? (data as Record<string, unknown>) : null;
    const races = Array.isArray(root?.races)
      ? root!.races
      : root?.race && typeof root.race === "object"
        ? [root.race]
        : [];
    const out: UnlimitedUpcomingRoom[] = [];
    for (const row of races) {
      if (!row || typeof row !== "object") continue;
      const r = row as Record<string, unknown>;
      const challengeType = String(r.challengeType ?? r.challenge_type ?? r.entryType ?? "").toLowerCase();
      const capacity = String(r.capacityMode ?? r.capacity_mode ?? "").toLowerCase();
      if (challengeType !== "unlimited_goal" && capacity !== "unlimited") continue;
      const normalized = normalizeUnlimitedChallengeToUpcomingRoom({
        id: r.id,
        title: r.title,
        status:
          r.status === "in_progress" || r.status === "open"
            ? r.status === "in_progress"
              ? "active"
              : "waiting"
            : r.status,
        challengeType: "unlimited_goal",
        capacityMode: "unlimited",
        entryFeeCents: r.entryAmountCents ?? r.entry_amount_cents,
        dailyGoalSteps: r.targetSteps ?? r.target_steps ?? r.dailyGoalSteps,
        durationDays: r.challengeDurationDays ?? r.challenge_duration_days ?? 7,
        startAtUtc: r.startedAt ?? r.scheduledStartAt ?? r.startAtUtc ?? r.createdAt,
        challengeEndAtUtc: r.challengeEndAt ?? r.challenge_end_at,
        hostUserId: r.creatorId ?? r.hostUserId,
        participantCount: r.currentPlayers ?? r.playerCount ?? r.paidParticipantCount ?? 1,
        currentUserRegistered: true,
        prizePoolCents: r.prizePoolCents,
      });
      if (normalized) out.push(normalized);
    }
    if (out.length > 0) {
      logger.warn("UnlimitedList", `races/my-active fallback recovered ${out.length} Unlimited row(s)`);
    }
    return out;
  } catch (err) {
    logger.debug(
      "UnlimitedList",
      `races/my-active fallback failed: ${err instanceof Error ? err.message : "error"}`,
    );
    return [];
  }
}

/**
 * Last-resort: hydrate a known public live challenge by id when list APIs are empty
 * (stale Coolify deploy without /live + status filters).
 */
const KNOWN_PUBLIC_LIVE_UNLIMITED_IDS = [
  "7ca4f2b0-f990-4ee8-9ce1-8ec902b36227",
] as const;

async function fetchKnownPublicLiveUnlimited(): Promise<UnlimitedUpcomingRoom[]> {
  const rooms = await Promise.all(
    KNOWN_PUBLIC_LIVE_UNLIMITED_IDS.map((id) => fetchUnlimitedDetailRoom(id)),
  );
  return rooms.filter((r): r is UnlimitedUpcomingRoom => {
    if (!r) return false;
    const s = String(r.status ?? "").trim().toLowerCase();
    return SERVER_LIVE_STATUSES.has(s);
  });
}

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
    if (rows.length > 0 && normalized.length === 0) {
      logger.warn(
        "UnlimitedList",
        `${path} dropped all ${rows.length} raw rows at normalize — sampleKeys=${
          rows[0] && typeof rows[0] === "object"
            ? Object.keys(rows[0] as object).slice(0, 12).join(",")
            : typeof rows[0]
        }`,
      );
    }
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
    const root = data && typeof data === "object" ? (data as Record<string, unknown>) : null;
    const rows = extractUnlimitedChallengeRows(data);
    const first =
      rows[0] ??
      (root ? root.challenge ?? data : data);
    const normalized = normalizeUnlimitedChallengeToUpcomingRoom(first);
    if (!normalized) return null;
    // Detail puts membership on the envelope, not always on challenge.
    const registered =
      root?.currentUserRegistered === true ||
      root?.current_user_registered === true ||
      normalized.current_user_registered === true;
    return registered
      ? { ...normalized, current_user_registered: true, eligible_to_register: false }
      : normalized;
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
        const challengeStatus = String(
          normalized?.status ??
            (rawRow as Record<string, unknown> | null)?.status ??
            "",
        ).toLowerCase();
        if (isUnlimitedTerminalExcludedFromLive(challengeStatus)) {
          await removeHostedUnlimitedChallenge(seed.room_id);
          logger.debug(
            "UnlimitedList",
            `reconcile drop cancelled seed id=${seed.room_id} status=${challengeStatus}`,
          );
          return;
        }
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
  // If the server still says registered, clear stale local "left" marks from ghost cleanup.
  const merged = mergeUpcomingRoomsById(hostedActive, fromApi).map((room) => {
    const seed = hostedActive.find((h) => h.room_id === room.room_id);
    const serverRegistered =
      room.current_user_registered === true || !!seed?.current_user_registered;
    if (serverRegistered) {
      if (leftIds.has(room.room_id)) {
        void clearUnlimitedChallengeLeft(room.room_id);
      }
      return {
        ...room,
        current_user_registered: true,
        eligible_to_register: false,
      };
    }
    if (leftIds.has(room.room_id)) {
      return {
        ...room,
        current_user_registered: false,
        eligible_to_register: !room.is_private,
      };
    }
    return {
      ...room,
      current_user_registered: false,
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
 * Viewer's open Unlimited memberships (waiting + starting + active + settling).
 * Used by Walk Next Race so started challenges still appear.
 *
 * Same timing model as classic rooms: one primary list call, one fallback only
 * when needed, plus local hosted cache — no parallel endpoint fan-out.
 */
export async function fetchMyOpenUnlimitedChallenges(opts?: {
  viewerUserId?: string | null;
}): Promise<UnlimitedUpcomingRoom[]> {
  if (!isUnlimitedGoalFrontendEnabled()) return [];

  const [myActive, hosted] = await Promise.all([
    fetchPathRows("/api/unlimited-challenges/my-active"),
    loadHostedUnlimitedChallenges({ includeStarted: true }),
  ]);

  // Single fallback (classic pattern): only if dedicated my-active is empty.
  let fromRaces: UnlimitedUpcomingRoom[] = [];
  if (myActive.length === 0) {
    fromRaces = await fetchUnlimitedFromRacesMyActive();
  }

  const leftIds = await loadLeftUnlimitedChallengeIds();
  const open = mergeUpcomingRoomsById(myActive, fromRaces, hosted).filter((room) => {
    const status = String(room.status ?? "").trim().toLowerCase();
    if (
      status === "completed" ||
      status === "cancelled" ||
      status === "canceled" ||
      status === "cancelled_by_platform" ||
      status === "canceled_by_platform"
    ) {
      return false;
    }
    return true;
  });

  return open.map((room) => {
    const serverReg = room.current_user_registered === true;
    const isHost =
      !!opts?.viewerUserId &&
      !!room.host_user_id &&
      room.host_user_id === opts.viewerUserId;
    if (serverReg || isHost) {
      if (leftIds.has(room.room_id)) void clearUnlimitedChallengeLeft(room.room_id);
      return { ...room, current_user_registered: true, eligible_to_register: false };
    }
    if (leftIds.has(room.room_id)) {
      return { ...room, current_user_registered: false };
    }
    return room;
  });
}

/**
 * Active + recently finished Unlimited challenges for the Live tab.
 * Trusts server live/my-active + recently-finished — never nukes membership via clearAll.
 */
export async function fetchLiveUnlimitedChallenges(opts?: {
  viewerUserId?: string | null;
}): Promise<{ live: UnlimitedLiveRaceFields[]; finished: UnlimitedLiveRaceFields[] }> {
  if (!isUnlimitedGoalFrontendEnabled()) {
    return { live: [], finished: [] };
  }

  const nowMs = Date.now();

  // Fetch dedicated list endpoints AND reliable fallbacks in parallel.
  // Production often 404s /live + returns [] for ?status= — waiting on those
  // alone delayed Unlimited cards vs classic races.
  let liveBatches: UnlimitedUpcomingRoom[][] = [];
  let finishedBatches: UnlimitedUpcomingRoom[][] = [];
  let fromKnown: UnlimitedUpcomingRoom[] = [];
  let fromRaces: UnlimitedUpcomingRoom[] = [];
  try {
    const [dedicatedLive, dedicatedFinished, known, racesMine] = await Promise.all([
      Promise.all(LIVE_LIST_PATHS.map((p) => fetchPathRows(p))),
      Promise.all(FINISHED_LIST_PATHS.map((p) => fetchPathRows(p))),
      fetchKnownPublicLiveUnlimited(),
      fetchUnlimitedFromRacesMyActive(),
    ]);
    liveBatches = dedicatedLive;
    finishedBatches = dedicatedFinished;
    fromKnown = known;
    fromRaces = racesMine;
  } catch (err) {
    logger.debug(
      "UnlimitedList",
      `liveTab list fetch failed: ${err instanceof Error ? err.message : "error"}`,
    );
  }

  if (fromKnown.length > 0) liveBatches.push(fromKnown);
  if (fromRaces.length > 0) liveBatches.push(fromRaces);

  const hosted = await loadHostedUnlimitedChallenges({ includeStarted: true }).catch(() => []);

  const fromApiRaw = mergeUpcomingRoomsById(...liveBatches);
  const fromApi = fromApiRaw.filter((r) => {
    const s = String(r.status ?? "").trim().toLowerCase();
    // Keep running + waiting (my-active); drop cancelled from Live Now path.
    return !isUnlimitedTerminalExcludedFromLive(s) || SERVER_LIVE_STATUSES.has(s);
  });
  const leftIds = await loadLeftUnlimitedChallengeIds();
  const serverLiveIds = new Set(
    fromApi
      .filter((r) => SERVER_LIVE_STATUSES.has(String(r.status ?? "").trim().toLowerCase()))
      .map((r) => r.room_id),
  );

  // Also keep my-active waiting IDs so we never treat "only waiting open" as empty live wipe.
  const serverOpenIds = new Set(fromApi.map((r) => r.room_id));

  const staleHostedIds = hosted
    .map((h) => h.room_id)
    .filter((id) => !serverOpenIds.has(id));

  const confirmedLiveFromDetail: UnlimitedUpcomingRoom[] = [];
  await Promise.all(
    staleHostedIds.map(async (id) => {
      const room = await fetchUnlimitedDetailRoom(id);
      if (!room) {
        const seed = hosted.find((h) => h.room_id === id);
        const seedStatus = String(seed?.status ?? "").trim().toLowerCase();
        if (seed && SERVER_LIVE_STATUSES.has(seedStatus)) {
          confirmedLiveFromDetail.push(seed);
          return;
        }
        await purgeHostedUnlimitedChallenge(id);
        return;
      }
      if (isUnlimitedTerminalExcludedFromLive(room.status)) {
        // Cancelled/completed — purge seed without poisoning leftIds for unrelated flows.
        await purgeHostedUnlimitedChallenge(id);
        return;
      }
      const statusLower = String(room.status ?? "").trim().toLowerCase();
      if (SERVER_LIVE_STATUSES.has(statusLower) || statusLower === "waiting") {
        if (SERVER_LIVE_STATUSES.has(statusLower)) confirmedLiveFromDetail.push(room);
        return;
      }
      await purgeHostedUnlimitedChallenge(id);
    }),
  );

  const merged = mergeUpcomingRoomsById(fromApi, confirmedLiveFromDetail).map((room) => {
    const serverSaysMember = [room, ...fromApi.filter((r) => r.room_id === room.room_id)].some(
      (r) => r?.current_user_registered === true,
    );
    const isHost =
      !!opts?.viewerUserId &&
      !!room.host_user_id &&
      room.host_user_id === opts.viewerUserId;

    if (serverSaysMember || isHost) {
      if (leftIds.has(room.room_id)) void clearUnlimitedChallengeLeft(room.room_id);
      return {
        ...room,
        current_user_registered: true,
        eligible_to_register: false,
      };
    }
    if (leftIds.has(room.room_id)) {
      return {
        ...room,
        current_user_registered: false,
        eligible_to_register: !room.is_private,
      };
    }
    return {
      ...room,
      current_user_registered: room.current_user_registered === true,
    };
  });

  const live: UnlimitedLiveRaceFields[] = [];
  const finished: UnlimitedLiveRaceFields[] = [];

  for (const room of merged) {
    const statusLower = String(room.status ?? "").trim().toLowerCase();
    if (isUnlimitedTerminalExcludedFromLive(statusLower)) continue;
    if (!SERVER_LIVE_STATUSES.has(statusLower)) continue; // waiting stays off Live Now
    const mapped = mapUnlimitedUpcomingToLiveRaceFields(
      { ...room, status: "active" },
      nowMs,
    );
    if (!mapped) {
      // Last-resort card so active Unlimited never vanishes from Live.
      live.push({
        id: room.room_id,
        title: room.title || "Unlimited Challenge",
        type: "paid",
        entryType:
          room.entry_fee > 0
            ? Number.isInteger(room.entry_fee)
              ? `$${room.entry_fee}`
              : `$${room.entry_fee.toFixed(2)}`
            : "USD Entry",
        playerCount: Math.max(1, room.registered_count ?? 1),
        maxPlayers: 0,
        targetSteps: room.target_steps || 0,
        status: "in_progress",
        prizePool: (room.entry_fee || 0) * Math.max(1, room.registered_count ?? 1),
        prizePoolCents: Math.round(
          (room.entry_fee || 0) * 100 * Math.max(1, room.registered_count ?? 1),
        ),
        entryAmountCents: Math.round((room.entry_fee || 0) * 100),
        coinEntryAmount: 0,
        spectatorCount: 0,
        startedAt: room.scheduled_start_at,
        completedAt: null,
        createdAt: room.scheduled_start_at ?? new Date(nowMs).toISOString(),
        players: [],
        trackLayout: room.selected_track_theme_id || "bg",
        reactionCounts: {},
        elapsedSeconds: room.scheduled_start_at
          ? Math.max(
              0,
              Math.floor((nowMs - new Date(room.scheduled_start_at).getTime()) / 1000),
            )
          : 0,
        challengeEndAt: room.challenge_end_at,
        challengeDurationDays: room.challenge_duration_days ?? 0,
        hostUserId: room.host_user_id || null,
        currentUserParticipating: !!room.current_user_registered,
        challengeType: "unlimited_goal" as const,
        capacityMode: "unlimited" as const,
      });
      continue;
    }
    live.push(mapped);
  }

  // Finished list — server-completed only (never cancelled → fake FINISHED).
  // recently-finished / ?status=completed return ALL public completed Unlimited;
  // Live "Today" must only show ones this viewer hosted or joined — otherwise
  // other people's multi-day challenges that end today flood the section.
  const finishedRaw = mergeUpcomingRoomsById(...finishedBatches);
  const liveIds = new Set(live.map((r) => r.id));
  const viewerId = opts?.viewerUserId ?? null;
  for (const room of finishedRaw) {
    if (liveIds.has(room.room_id)) continue; // still live on another path — don't double-list
    if (isUnlimitedTerminalExcludedFromLive(room.status)) continue;
    if (!isUnlimitedFinishedForLiveTab(room.status)) continue;
    const isMine =
      room.current_user_registered === true ||
      (!!viewerId && !!room.host_user_id && room.host_user_id === viewerId);
    if (!isMine) continue;
    // Skip empty shells (no joiners) — not real finished races for Live.
    if ((room.registered_count ?? 0) <= 0) continue;
    // Keep real status; mapper requires completed — do not rewrite cancelled→completed.
    const mapped = mapUnlimitedUpcomingToLiveRaceFields(
      { ...room, status: "completed" },
      nowMs,
    );
    if (!mapped) continue;
    finished.push({ ...mapped, status: "completed" });
  }

  // Persist membership for live races only — never clearAll (that marked left and hid Walk).
  await Promise.all(
    live.map(async (row) => {
      const room = merged.find((r) => r.room_id === row.id);
      if (!room?.current_user_registered) return;
      await saveHostedUnlimitedChallenge(
        {
          ...room,
          status: room.status,
          current_user_registered: true,
        },
        { resumeAfterLeave: true },
      );
    }),
  );

  logger.debug(
    "UnlimitedList",
    `liveTab live=${live.length} finished=${finished.length} apiLive=${fromApi.length} apiFinished=${finishedRaw.length} hostedWas=${hosted.length} serverLive=${serverLiveIds.size} flag=on` +
      (live[0] ? ` sampleLive=${live[0].id} fee=${live[0].entryAmountCents}` : ""),
  );
  if (live.length === 0 && finished.length === 0) {
    logger.warn(
      "UnlimitedList",
      `liveTab EMPTY — apiLive=${fromApi.length} apiFinished=${finishedRaw.length} hosted=${hosted.length}. Check /live + /my-active + /recently-finished auth.`,
    );
  }

  // Always stamp Unlimited markers so Live tab filters never drop these rows.
  const stamp = <T extends UnlimitedLiveRaceFields>(row: T): T => ({
    ...row,
    challengeType: "unlimited_goal",
    capacityMode: "unlimited",
    maxPlayers: 0,
  });
  return { live: live.map(stamp), finished: finished.map(stamp) };
}
