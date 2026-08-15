/**
 * Upcoming Challenges data — reuses Available Rooms endpoints.
 *
 * Sorted by soonest start date; top 20 public joinable rooms.
 * Past races drop off on focus refresh.
 */

import { authFetch } from "@/utils/authFetch";
import { getDeviceTimezone } from "@/utils/timezone";
import { isWalkTrendingChallengesMockEnabled } from "@/config/featureFlags";
import { getTrendingChallengeMocks } from "@/constants/trendingChallengeMockData";
import { fetchAvailableUnlimitedAsRoomLikes } from "@/services/unlimitedChallengesListApi";
import {
  assignTrendingArtworkKey,
  assignTrendingThemeKey,
  buildTrendingChallengesFromRooms,
  mergeAvailableRoomLists,
  TRENDING_MAX_CARDS,
  type AvailableRoomLike,
  type TrendingChallenge,
} from "@/utils/trendingChallenges";

type RoomsPayload = { rooms?: AvailableRoomLike[] };

async function fetchJsonRooms(path: string): Promise<AvailableRoomLike[]> {
  try {
    const res = await authFetch(path);
    if (!res.ok) return [];
    const data = (await res.json()) as RoomsPayload;
    return data.rooms ?? [];
  } catch {
    return [];
  }
}

function ensureStableTheme(c: TrendingChallenge): TrendingChallenge {
  return {
    ...c,
    themeKey: c.themeKey ?? assignTrendingThemeKey(c.id),
    artworkKey: c.artworkKey ?? assignTrendingArtworkKey(c.id),
  };
}

/**
 * Total joinable challenges on Available Challenges (active + upcoming, deduped).
 * Used by Walk "View All" live count — not limited to cash Unlimited Challenge cards.
 */
export async function fetchAvailableChallengeCount(opts?: {
  viewerUserId?: string | null;
}): Promise<number> {
  const [upcoming, active, unlimited] = await Promise.all([
    fetchJsonRooms("/api/rooms/available?tab=upcoming"),
    fetchJsonRooms("/api/rooms/available?filter=all&sort=newest&limit=30"),
    fetchAvailableUnlimitedAsRoomLikes(opts),
  ]);
  return mergeAvailableRoomLists(upcoming, active, unlimited).length;
}

/**
 * Load available (joinable) upcoming challenges from Available Rooms.
 * Excludes rooms hosted by the current viewer.
 */
export async function fetchTrendingChallenges(opts?: {
  viewerUserId?: string | null;
}): Promise<TrendingChallenge[]> {
  if (isWalkTrendingChallengesMockEnabled()) {
    return getTrendingChallengeMocks(getDeviceTimezone()).slice(0, TRENDING_MAX_CARDS);
  }

  // Prefer the same upcoming tab Available Rooms uses (scheduled public rooms),
  // plus Unlimited Challenges from the dedicated list endpoints.
  const [upcoming, active, unlimited] = await Promise.all([
    fetchJsonRooms("/api/rooms/available?tab=upcoming"),
    fetchJsonRooms("/api/rooms/available?filter=all&sort=newest&limit=50"),
    fetchAvailableUnlimitedAsRoomLikes({ viewerUserId: opts?.viewerUserId }),
  ]);
  const merged = mergeAvailableRoomLists(upcoming, active, unlimited);
  const rows = buildTrendingChallengesFromRooms(merged, {
    timezone: getDeviceTimezone(),
    limit: TRENDING_MAX_CARDS,
    viewerUserId: opts?.viewerUserId,
  }).map(ensureStableTheme);
  if (
    rows.length === 0 &&
    upcoming.length === 0 &&
    active.length === 0 &&
    unlimited.length === 0
  ) {
    throw new Error("Unable to load available challenges.");
  }
  return rows;
}
