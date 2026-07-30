/**
 * Persist Unlimited challenges the current user hosts/joins so Next Race /
 * Available / Trending / Live can hydrate when list APIs omit or reshape fields.
 */

import { STORAGE_KEYS, storageGet, storageSet } from "@/utils/storage";
import type { UnlimitedUpcomingRoom } from "@/utils/unlimitedChallengeRooms";

export type HostedUnlimitedSeed = UnlimitedUpcomingRoom & {
  savedAtMs: number;
};

function isFutureStart(iso: string | null | undefined, nowMs = Date.now()): boolean {
  if (!iso) return true;
  const t = new Date(iso).getTime();
  return !Number.isFinite(t) || t > nowMs;
}

/** Keep until a short grace after challenge end (for Live finished + detail). */
function isStillTrackable(room: HostedUnlimitedSeed, nowMs = Date.now()): boolean {
  if (room.challenge_end_at) {
    const end = new Date(room.challenge_end_at).getTime();
    if (Number.isFinite(end)) {
      return end + 2 * 24 * 60 * 60 * 1000 > nowMs;
    }
  }
  const startMs = room.scheduled_start_at
    ? new Date(room.scheduled_start_at).getTime()
    : room.savedAtMs;
  const base = Number.isFinite(startMs) ? startMs : room.savedAtMs;
  const durationDays =
    typeof room.challenge_duration_days === "number" && room.challenge_duration_days > 0
      ? room.challenge_duration_days
      : 30;
  return base + (durationDays + 2) * 24 * 60 * 60 * 1000 > nowMs;
}

export async function loadHostedUnlimitedChallenges(opts?: {
  /** When true, include challenges that already started (for Live hydration). */
  includeStarted?: boolean;
}): Promise<HostedUnlimitedSeed[]> {
  const rows =
    (await storageGet<HostedUnlimitedSeed[]>(STORAGE_KEYS.HOSTED_UNLIMITED_CHALLENGES)) ?? [];
  const now = Date.now();
  const kept = rows.filter((r) => r?.room_id && isStillTrackable(r, now));
  if (kept.length !== rows.length) {
    await storageSet(STORAGE_KEYS.HOSTED_UNLIMITED_CHALLENGES, kept);
  }
  if (opts?.includeStarted) return kept;
  return kept.filter((r) => isFutureStart(r.scheduled_start_at, now));
}

export async function saveHostedUnlimitedChallenge(
  room: UnlimitedUpcomingRoom,
): Promise<void> {
  const prev = await loadHostedUnlimitedChallenges({ includeStarted: true });
  const next: HostedUnlimitedSeed = {
    ...room,
    capacity_mode: "unlimited",
    current_user_registered: true,
    eligible_to_register: false,
    savedAtMs: Date.now(),
  };
  const merged = [next, ...prev.filter((r) => r.room_id !== next.room_id)].slice(0, 20);
  await storageSet(STORAGE_KEYS.HOSTED_UNLIMITED_CHALLENGES, merged);
}

export async function removeHostedUnlimitedChallenge(roomId: string): Promise<void> {
  const prev = await loadHostedUnlimitedChallenges({ includeStarted: true });
  await storageSet(
    STORAGE_KEYS.HOSTED_UNLIMITED_CHALLENGES,
    prev.filter((r) => r.room_id !== roomId),
  );
}
