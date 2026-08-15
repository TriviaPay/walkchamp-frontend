/**

 * Trending Challenges preview helpers — Available Rooms (all public types).

 *

 * Shows free, coins, cash, and unlimited-goal upcoming rooms.

 * Ranking: soonest start first.

 */



import {

  TRENDING_ARTWORK_KEYS,

  TRENDING_THEME_KEYS,

  type TrendingArtworkKey,

  type TrendingThemeKey,

} from "@/constants/trendingChallengeThemes";
import { resolveRacePlayerCount } from "@/utils/waitingRoomTiming";
import { displayChallengeTitle } from "@/features/unlimited/mappers/unlimitedLiveUiCopy";

export const TRENDING_MAX_CARDS = 20;

export const TRENDING_AUTOPLAY_MS = 5_000;

export const TRENDING_RESUME_AFTER_INTERACTION_MS = 7_000;

export const TRENDING_PREVIEW_CACHE_TTL_MS = 5 * 60 * 1000;

export function trendingPreviewCacheKey(userId?: string | null): string {
  const uid = String(userId || "anon").trim() || "anon";
  return `walk_trending:${uid}`;
}

/** Walk tab must not render blank/skeleton trending cards. */
export function shouldShowTrendingPreview(rows: readonly unknown[] | null | undefined): boolean {
  return Array.isArray(rows) && rows.length > 0;
}



export type TrendingChallengeFormat =

  | "free"

  | "coins"

  | "fixed_cash"

  | "unlimited_goal";



export type TrendingChallenge = {

  id: string;

  title: string;

  challengeFormat: TrendingChallengeFormat;

  prizePoolDisplay: string;

  participantCount: number;

  startsAtUtc: string;

  /** Challenge end time when known (from API or duration). */
  endsAtUtc?: string | null;

  timezone: string;

  themeKey: TrendingThemeKey;

  artworkKey: TrendingArtworkKey;

  canJoin: boolean;

  status: "waiting" | "upcoming";

  typeBadge: string;

  hostUserId?: string | null;

};



/** Minimal room shape from Available Rooms (active + upcoming). */

export type AvailableRoomLike = {

  room_id: string;

  title?: string | null;

  challenge_type?: string | null;

  entry_fee?: number | null;

  coin_entry_amount?: number | null;

  reward_pool?: number | null;

  reward_label?: string | null;

  registered_count?: number | null;

  current_players?: number | null;

  max_players?: number | null;

  scheduled_start_at?: string | null;

  challenge_end_at?: string | null;

  challengeEndAt?: string | null;

  challenge_duration_days?: number | null;

  prizePoolCents?: number | null;

  created_at?: string | null;

  is_private?: boolean | null;

  requires_code?: boolean | null;

  joinable?: boolean | null;

  eligible_to_register?: boolean | null;

  status?: string | null;

  capacity_mode?: string | null;

  race_type?: string | null;

  host_user_id?: string | null;

};



/** Deterministic 32-bit hash — stable across restarts. */

export function stableHash(input: string): number {

  let h = 2166136261;

  for (let i = 0; i < input.length; i++) {

    h ^= input.charCodeAt(i);

    h = Math.imul(h, 16777619);

  }

  return h >>> 0;

}



export function assignTrendingThemeKey(challengeId: string): TrendingThemeKey {

  const idx = stableHash(challengeId) % TRENDING_THEME_KEYS.length;

  return TRENDING_THEME_KEYS[idx]!;

}



export function assignTrendingArtworkKey(challengeId: string): TrendingArtworkKey {

  const idx = stableHash(`${challengeId}:artwork`) % TRENDING_ARTWORK_KEYS.length;

  return TRENDING_ARTWORK_KEYS[idx]!;

}



export function resolveTrendingFormat(room: AvailableRoomLike): TrendingChallengeFormat {

  const t = (room.challenge_type ?? "").toLowerCase();

  if (t === "unlimited_goal" || room.capacity_mode === "unlimited") return "unlimited_goal";

  if (t === "coins" || t === "coins_battle" || (room.coin_entry_amount ?? 0) > 0) return "coins";

  if (t === "free" || (room.entry_fee ?? 0) === 0) return "free";

  return "fixed_cash";

}



/** Cash unlimited + fixed-player cash (legacy helper). */

export function isUnlimitedChallengePreviewFormat(

  format: TrendingChallengeFormat,

): boolean {

  return format === "unlimited_goal" || format === "fixed_cash";

}

/** Walk Trending preview: every public joinable challenge type. */

export function isTrendingPreviewFormat(

  format: TrendingChallengeFormat,

): boolean {

  return (

    format === "unlimited_goal" ||

    format === "fixed_cash" ||

    format === "free" ||

    format === "coins"

  );

}



function formatUsdDollars(amount: number): string {
  const rounded =
    Math.abs(amount - Math.round(amount)) < 0.001
      ? Math.round(amount)
      : Math.round(amount * 100) / 100;
  return `$${rounded.toLocaleString(undefined, {
    minimumFractionDigits: Number.isInteger(rounded) ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}

/**
 * Prize pool display for Trending cards.
 * `reward_pool` and `entry_fee` are dollars (same as Available Rooms).
 * Unlimited API `prizePoolCents` is converted to dollars before mapping.
 */
export function formatTrendingPrizePool(room: AvailableRoomLike): string {
  const format = resolveTrendingFormat(room);

  if (format === "free") return "Free";

  if (format === "coins") {
    const coins = room.coin_entry_amount ?? 0;
    const players = Math.max(room.current_players ?? room.registered_count ?? 0, 1);
    const pool = coins * players;
    return `${pool.toLocaleString()} coins`;
  }

  if (typeof room.reward_pool === "number" && room.reward_pool > 0) {
    return formatUsdDollars(room.reward_pool);
  }

  if (typeof room.prizePoolCents === "number" && room.prizePoolCents > 0) {
    return formatUsdDollars(room.prizePoolCents / 100);
  }

  if (room.reward_label?.trim()) return room.reward_label.trim();

  const entry = room.entry_fee ?? 0;
  const players = Math.max(room.current_players ?? room.registered_count ?? 0, 1);
  if (entry > 0) return formatUsdDollars(entry * players);

  return "Prize pool TBD";
}



export function formatTrendingStartLabel(startsAtUtc: string, now = new Date()): string {
  const d = new Date(startsAtUtc);
  if (Number.isNaN(d.getTime())) return "Soon";
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  if (sameDay) return `Today · ${time}`;
  const date = d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return `${date} · ${time}`;
}

/** Resolve end time from API end stamp or start + duration days. */
export function resolveTrendingEndsAtUtc(room: AvailableRoomLike): string | null {
  const endIso = room.challenge_end_at ?? room.challengeEndAt ?? null;
  if (endIso) {
    const t = new Date(endIso).getTime();
    if (Number.isFinite(t)) return endIso;
  }
  const startIso = room.scheduled_start_at;
  if (!startIso) return null;
  const startMs = new Date(startIso).getTime();
  if (!Number.isFinite(startMs)) return null;
  const days = Math.max(0, Math.floor(room.challenge_duration_days ?? 0));
  if (days <= 0) return null;
  return new Date(startMs + days * 86_400_000).toISOString();
}



/**

 * Public upcoming rooms for Trending preview.

 * Excludes: private, sponsored, ended, past start.

 * Hosted-by-viewer rooms stay eligible so creators see their public challenges.

 */

export function isEligibleTrendingRoom(

  room: AvailableRoomLike,

  nowMs = Date.now(),

  _opts?: { viewerUserId?: string | null },

): boolean {

  if (room.is_private || room.requires_code) return false;

  const type = (room.challenge_type ?? "").toLowerCase();

  if (type === "sponsored" || room.race_type === "sponsored") return false;

  const status = (room.status ?? "").toLowerCase();

  if (

    status === "cancelled" ||

    status === "canceled" ||

    status === "completed" ||

    status === "finished" ||

    status === "ended"

  ) {

    return false;

  }

  const startIso = room.scheduled_start_at;

  if (!startIso) return false;

  const startMs = new Date(startIso).getTime();

  if (!Number.isFinite(startMs) || startMs <= nowMs) return false;

  if (!isTrendingPreviewFormat(resolveTrendingFormat(room))) return false;

  return true;

}



/** Soonest start first; stable room_id tie-break. */

export function rankTrendingRooms(

  rooms: AvailableRoomLike[],

  nowMs = Date.now(),

  opts?: { viewerUserId?: string | null },

): AvailableRoomLike[] {

  const eligible = rooms.filter((r) => isEligibleTrendingRoom(r, nowMs, opts));

  return eligible.sort((a, b) => {

    const sa = new Date(a.scheduled_start_at!).getTime();

    const sb = new Date(b.scheduled_start_at!).getTime();

    if (sa !== sb) return sa - sb;

    return a.room_id.localeCompare(b.room_id);

  });

}



export function mapRoomToTrendingChallenge(

  room: AvailableRoomLike,

  timezone = "UTC",

): TrendingChallenge {

  const format = resolveTrendingFormat(room);

  const typeBadge =

    format === "free"

      ? "Free"

      : format === "coins"

        ? "Coins"

        : format === "unlimited_goal"

          ? "Streak Challenge"

          : "Fixed Cash";

  return {
    id: room.room_id,
    title: displayChallengeTitle(room.title?.trim()) || "Streak Challenge",
    challengeFormat: format,
    prizePoolDisplay: formatTrendingPrizePool(room),
    // Prefer registered_count for scheduled/upcoming (current_players stays 0 until start).
    participantCount: resolveRacePlayerCount(room as Record<string, unknown>),
    startsAtUtc: room.scheduled_start_at!,
    endsAtUtc: resolveTrendingEndsAtUtc(room),
    timezone,
    themeKey: assignTrendingThemeKey(room.room_id),
    artworkKey: assignTrendingArtworkKey(room.room_id),
    canJoin: room.joinable !== false && room.eligible_to_register !== false,
    status: "upcoming",
    typeBadge,
    hostUserId: room.host_user_id ?? null,
  };
}



export function buildTrendingChallengesFromRooms(

  rooms: AvailableRoomLike[],

  opts?: {

    nowMs?: number;

    timezone?: string;

    limit?: number;

    viewerUserId?: string | null;

  },

): TrendingChallenge[] {

  const nowMs = opts?.nowMs ?? Date.now();

  const limit = opts?.limit ?? TRENDING_MAX_CARDS;

  const ranked = rankTrendingRooms(rooms, nowMs, {

    viewerUserId: opts?.viewerUserId,

  }).slice(0, limit);

  return ranked.map((r) => mapRoomToTrendingChallenge(r, opts?.timezone ?? "UTC"));

}



/** Deduplicate by room_id (upcoming + active payloads). */

export function mergeAvailableRoomLists(

  ...lists: Array<AvailableRoomLike[] | null | undefined>

): AvailableRoomLike[] {

  const map = new Map<string, AvailableRoomLike>();

  for (const list of lists) {

    for (const room of list ?? []) {

      if (!room?.room_id) continue;

      const prev = map.get(room.room_id);

      if (!prev) {
        map.set(room.room_id, room);
        continue;
      }

      // Don't let a later payload wipe counts with null/undefined (common when
      // active rooms omit registered_count and send current_players: 0).
      const merged: AvailableRoomLike = { ...prev };
      for (const [key, value] of Object.entries(room) as Array<
        [keyof AvailableRoomLike, AvailableRoomLike[keyof AvailableRoomLike]]
      >) {
        if (value !== undefined && value !== null) {
          (merged as Record<string, unknown>)[key as string] = value;
        }
      }
      map.set(room.room_id, merged);

    }

  }

  return [...map.values()];

}

