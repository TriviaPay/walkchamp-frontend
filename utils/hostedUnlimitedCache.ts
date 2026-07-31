/**
 * Persist Unlimited challenges the current user hosts/joins so Next Race /
 * Available / Trending / Live can hydrate when list APIs omit or reshape fields.
 */

import { STORAGE_KEYS, storageGet, storageSet } from "@/utils/storage";
import type { UnlimitedUpcomingRoom } from "@/utils/unlimitedChallengeRooms";

export type HostedUnlimitedSeed = UnlimitedUpcomingRoom & {
  savedAtMs: number;
};

type LeftUnlimitedEntry = {
  roomId: string;
  leftAtMs: number;
};

const LEFT_TTL_MS = 100 * 24 * 60 * 60 * 1000; // ~100 days

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

async function loadLeftEntries(): Promise<LeftUnlimitedEntry[]> {
  const rows =
    (await storageGet<LeftUnlimitedEntry[]>(STORAGE_KEYS.LEFT_UNLIMITED_CHALLENGES)) ?? [];
  const now = Date.now();
  const kept = rows.filter(
    (r) => r?.roomId && typeof r.leftAtMs === "number" && now - r.leftAtMs < LEFT_TTL_MS,
  );
  if (kept.length !== rows.length) {
    await storageSet(STORAGE_KEYS.LEFT_UNLIMITED_CHALLENGES, kept);
  }
  return kept;
}

export async function loadLeftUnlimitedChallengeIds(): Promise<Set<string>> {
  const rows = await loadLeftEntries();
  return new Set(rows.map((r) => r.roomId));
}

export async function markUnlimitedChallengeLeft(roomId: string): Promise<void> {
  if (!roomId) return;
  const prev = await loadLeftEntries();
  const next: LeftUnlimitedEntry[] = [
    { roomId, leftAtMs: Date.now() },
    ...prev.filter((r) => r.roomId !== roomId),
  ].slice(0, 40);
  await storageSet(STORAGE_KEYS.LEFT_UNLIMITED_CHALLENGES, next);
}

async function clearUnlimitedChallengeLeft(roomId: string): Promise<void> {
  const prev = await loadLeftEntries();
  await storageSet(
    STORAGE_KEYS.LEFT_UNLIMITED_CHALLENGES,
    prev.filter((r) => r.roomId !== roomId),
  );
}

export async function loadHostedUnlimitedChallenges(opts?: {
  /** When true, include challenges that already started (for Live hydration). */
  includeStarted?: boolean;
}): Promise<HostedUnlimitedSeed[]> {
  const rows =
    (await storageGet<HostedUnlimitedSeed[]>(STORAGE_KEYS.HOSTED_UNLIMITED_CHALLENGES)) ?? [];
  const now = Date.now();
  const leftIds = await loadLeftUnlimitedChallengeIds();
  const kept = rows.filter(
    (r) => r?.room_id && isStillTrackable(r, now) && !leftIds.has(r.room_id),
  );
  if (kept.length !== rows.length) {
    await storageSet(STORAGE_KEYS.HOSTED_UNLIMITED_CHALLENGES, kept);
  }
  if (opts?.includeStarted) return kept;
  return kept.filter((r) => isFutureStart(r.scheduled_start_at, now));
}

export async function saveHostedUnlimitedChallenge(
  room: UnlimitedUpcomingRoom,
  opts?: {
    /**
     * True only for intentional create/join. Background list hydration must not
     * clear leave marks or resurrect rooms the viewer left.
     */
    resumeAfterLeave?: boolean;
  },
): Promise<void> {
  if (!room.room_id) return;
  const leftIds = await loadLeftUnlimitedChallengeIds();
  if (leftIds.has(room.room_id) && !opts?.resumeAfterLeave) {
    return;
  }
  if (opts?.resumeAfterLeave) {
    await clearUnlimitedChallengeLeft(room.room_id);
  }
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
  await markUnlimitedChallengeLeft(roomId);
  const prev = await loadHostedUnlimitedChallenges({ includeStarted: true });
  await storageSet(
    STORAGE_KEYS.HOSTED_UNLIMITED_CHALLENGES,
    prev.filter((r) => r.room_id !== roomId),
  );
}
