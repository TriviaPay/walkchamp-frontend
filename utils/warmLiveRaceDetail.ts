/**
 * Warm Live Detail L1 cache before navigation so the destination paints instantly.
 * Sync shell (primeSync) never awaits network. Optional background prefetch fills
 * the full roster so Live Detail does not flash "only me" then load others late.
 */

import { screenCache } from "@/core/cache/screenCache";
import { isTrackLayoutId } from "@/constants/trackLayouts";
import {
  waitingRoomCacheKey,
  waitingRoomCacheKeyLegacy,
  type WaitingRoomCacheEntry,
} from "@/utils/waitingRoomSeed";

export type WarmLiveRaceDetailInput = {
  raceId: string;
  userId?: string | null;
  username?: string | null;
  title?: string | null;
  status?: string | null;
  entryType?: string | null;
  challengeType?: string | null;
  capacityMode?: string | null;
  targetSteps?: number | null;
  maxPlayers?: number | null;
  currentPlayers?: number | null;
  startedAt?: string | null;
  challengeEndAt?: string | null;
  completedAt?: string | null;
  trackLayout?: string | null;
  challengeDurationDays?: number | null;
  entryAmountCents?: number | null;
  prizePool?: number | null;
  /**
   * Skip overwrite only when mem already has a useful multi-player roster.
   * A single "You" stub must never block a richer seed/prefetch.
   */
  preferExistingRoster?: boolean;
};

type LiveDetailCacheShape = {
  race?: Record<string, unknown> & {
    trackLayout?: string;
    id?: string;
    currentPlayers?: number;
  };
  participants?: Array<Record<string, unknown>>;
};

export function liveRaceDetailCacheKey(
  raceId: string,
  userId?: string | null,
): string {
  return `live-race-detail:v1:${userId || "anon"}:${raceId}`;
}

function rosterIsUseful(
  participants: unknown[] | undefined,
  currentPlayers?: number | null,
): boolean {
  const n = participants?.length ?? 0;
  if (n >= 2) return true;
  if (
    typeof currentPlayers === "number" &&
    currentPlayers > 1 &&
    n >= currentPlayers
  ) {
    return true;
  }
  return false;
}

function readWaitingRoomRoster(
  raceId: string,
  userId?: string | null,
): WaitingRoomCacheEntry | null {
  if (!raceId) return null;
  if (userId) {
    const scoped = screenCache.getSync<WaitingRoomCacheEntry>(
      waitingRoomCacheKey(userId, raceId),
    );
    if (scoped?.participants?.length) return scoped;
  }
  return (
    screenCache.getSync<WaitingRoomCacheEntry>(
      waitingRoomCacheKeyLegacy(raceId),
    ) ?? null
  );
}

function participantsFromWaitingRoom(
  entry: WaitingRoomCacheEntry,
): Array<Record<string, unknown>> {
  return entry.participants.map((p, i) => ({
    id: p.userId || p.id || `p-${i}`,
    userId: p.userId,
    currentSteps: Math.max(0, p.currentSteps ?? 0),
    status: "active",
    rank: i + 1,
    username: p.isCurrentUser ? "You" : p.username,
    countryFlag: p.countryFlag ?? null,
    avatarColor: p.avatarColor ?? "#00E676",
    avatarUrl: p.avatarUrl ?? null,
    isHost: !!p.isHost,
  }));
}

/**
 * Seed in-memory Live Detail shell from known card/challenge fields.
 * Prefer Waiting Room roster when available so all players paint immediately.
 */
export function warmLiveRaceDetailNavigation(
  input: WarmLiveRaceDetailInput,
): {
  id: string;
  trackLayout?: string;
  challengeType?: string;
  capacityMode?: string;
  title?: string;
  targetSteps?: string;
  durationDays?: string;
} {
  const raceId = String(input.raceId || "").trim();
  const userId = input.userId ?? null;
  const cacheKey = liveRaceDetailCacheKey(raceId, userId);
  const existing = screenCache.getSync<LiveDetailCacheShape>(cacheKey);

  const unlimited =
    input.capacityMode === "unlimited" ||
    input.challengeType === "unlimited_goal" ||
    input.entryType === "unlimited_goal";

  const cachedLayout = existing?.race?.trackLayout;
  const layout =
    (isTrackLayoutId(input.trackLayout) ? input.trackLayout : null) ||
    (isTrackLayoutId(cachedLayout) ? cachedLayout : null) ||
    undefined;

  const existingUseful = rosterIsUseful(
    existing?.participants,
    existing?.race?.currentPlayers ?? input.currentPlayers,
  );

  const shouldSeed =
    !!userId &&
    !!raceId &&
    !(input.preferExistingRoster !== false && existingUseful);

  if (shouldSeed) {
    const waiting = readWaitingRoomRoster(raceId, userId);
    const fromWaiting =
      waiting?.participants?.length && waiting.participants.length > 0
        ? participantsFromWaitingRoom(waiting)
        : null;

    const target =
      typeof input.targetSteps === "number" && input.targetSteps > 0
        ? input.targetSteps
        : unlimited
          ? 10_000
          : 1_000;
    const entryType =
      input.entryType ||
      input.challengeType ||
      (unlimited ? "unlimited_goal" : "free");

    const selfOnly = userId
      ? [
          {
            id: userId,
            userId,
            currentSteps: 0,
            status: "active",
            rank: 1,
            username: input.username?.trim() || "You",
            countryFlag: null,
            avatarColor: "#00E676",
            avatarUrl: null,
            isHost: false,
          },
        ]
      : [];

    // Prefer multi-player waiting-room roster over a lone self stub.
    const participants =
      fromWaiting && fromWaiting.length > 0 ? fromWaiting : selfOnly;

    const currentPlayers = Math.max(
      1,
      input.currentPlayers ?? 0,
      waiting?.liveRoom?.currentPlayers ?? 0,
      participants.length,
    );

    screenCache.primeSync(cacheKey, {
      race: {
        id: raceId,
        title:
          (input.title && String(input.title).trim()) ||
          (unlimited ? "Streak Challenge" : "Live Race"),
        status: input.status || "in_progress",
        entryType,
        entryAmountCents: input.entryAmountCents ?? 0,
        entryAmountDollars: (input.entryAmountCents ?? 0) / 100,
        targetSteps: target,
        currentPlayers,
        maxPlayers: unlimited ? null : (input.maxPlayers ?? 10),
        startedAt: input.startedAt ?? existing?.race?.startedAt ?? new Date().toISOString(),
        challengeEndAt:
          input.challengeEndAt ??
          (typeof existing?.race?.challengeEndAt === "string"
            ? existing.race.challengeEndAt
            : null),
        completedAt: input.completedAt ?? null,
        creatorId:
          (typeof existing?.race?.creatorId === "string" && existing.race.creatorId) || "",
        prizePool: input.prizePool ?? 0,
        prizeTiers: [],
        spectatorCount: 0,
        capacityMode: input.capacityMode ?? (unlimited ? "unlimited" : null),
        challengeType:
          input.challengeType ?? (unlimited ? "unlimited_goal" : null),
        trackLayout: layout || "bg",
        challengeDurationDays:
          typeof input.challengeDurationDays === "number" &&
          input.challengeDurationDays > 0
            ? input.challengeDurationDays
            : typeof existing?.race?.challengeDurationDays === "number" &&
                existing.race.challengeDurationDays > 0
              ? existing.race.challengeDurationDays
              : null,
      },
      participants,
    });
  }

  const params: {
    id: string;
    trackLayout?: string;
    challengeType?: string;
    capacityMode?: string;
    title?: string;
    targetSteps?: string;
    durationDays?: string;
  } = { id: raceId };

  if (layout) params.trackLayout = layout;
  if (unlimited || input.challengeType === "unlimited_goal") {
    params.challengeType = "unlimited_goal";
    params.capacityMode = "unlimited";
  } else if (input.challengeType) {
    params.challengeType = input.challengeType;
  }
  if (input.title) params.title = String(input.title);
  if (typeof input.targetSteps === "number" && input.targetSteps > 0) {
    params.targetSteps = String(input.targetSteps);
  }
  if (
    typeof input.challengeDurationDays === "number" &&
    input.challengeDurationDays > 0
  ) {
    params.durationDays = String(input.challengeDurationDays);
  }

  return params;
}

const prefetchInFlight = new Set<string>();

/**
 * Background GET that primes full roster into L1 before/while Live Detail mounts.
 * Safe for onPressIn — never blocks navigation.
 */
export function prefetchLiveRaceDetailRoster(opts: {
  raceId: string;
  userId?: string | null;
  unlimited?: boolean;
}): void {
  const raceId = String(opts.raceId || "").trim();
  const userId = opts.userId ?? null;
  if (!raceId || !userId) return;

  const cacheKey = liveRaceDetailCacheKey(raceId, userId);
  const existing = screenCache.getSync<LiveDetailCacheShape>(cacheKey);
  const existingCount = existing?.participants?.length ?? 0;
  const expected = Number(existing?.race?.currentPlayers ?? 0) || 0;
  // Skip only when we already have a substantial roster (first leaderboard page
  // or full expected count). A 2–5 player card strip must not skip prefetch.
  if (
    existingCount >= 50 ||
    (expected > 1 && existingCount >= expected) ||
    (!opts.unlimited && rosterIsUseful(existing?.participants, expected))
  ) {
    return;
  }

  const flightKey = `${userId}:${raceId}`;
  if (prefetchInFlight.has(flightKey)) return;
  prefetchInFlight.add(flightKey);

  void (async () => {
    try {
      const { authFetch } = await import("@/utils/authFetch");
      if (opts.unlimited) {
        const { mapUnlimitedDetailToLiveDetail } = await import("@/utils/unlimitedLiveRace");

        const detailRes = await authFetch(`/api/unlimited-challenges/${raceId}`);
        if (!detailRes.ok) return;
        const mapped = mapUnlimitedDetailToLiveDetail(
          await detailRes.json().catch(() => null),
        );
        if (!mapped) return;

        // Don't clobber a richer roster that arrived while we were fetching.
        const latest = screenCache.getSync<LiveDetailCacheShape>(cacheKey);
        if (
          rosterIsUseful(latest?.participants, latest?.race?.currentPlayers) &&
          (latest?.participants?.length ?? 0) >=
            (mapped.participants?.length ?? 0)
        ) {
          return;
        }

        screenCache.primeSync(cacheKey, {
          race: {
            ...mapped.race,
            status: mapped.race.status || "in_progress",
          },
          participants: mapped.participants,
        });
        return;
      }

      const res = await authFetch(`/api/races/${raceId}`);
      if (!res.ok) return;
      const data = (await res.json()) as {
        race?: Record<string, unknown>;
        participants?: unknown[];
      };
      if (!data?.race) return;
      const parts = Array.isArray(data.participants) ? data.participants : [];
      const latest = screenCache.getSync<LiveDetailCacheShape>(cacheKey);
      if (
        rosterIsUseful(latest?.participants, latest?.race?.currentPlayers) &&
        (latest?.participants?.length ?? 0) >= parts.length
      ) {
        return;
      }
      screenCache.primeSync(cacheKey, {
        race: data.race,
        participants: parts,
      });
    } catch {
      /* best-effort */
    } finally {
      prefetchInFlight.delete(flightKey);
    }
  })();
}
