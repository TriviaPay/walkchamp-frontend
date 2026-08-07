/**
 * Instant waiting-room UI — seed participants and room meta before the first poll.
 * Cache keys are scoped by authenticated user so account switches cannot flash "You".
 */

import type { UserProfile } from "@/store/types";
import { screenCache } from "@/utils/screenCache";

export interface WaitingRoomParticipant {
  id: string;
  userId: string;
  username: string;
  country: string | null;
  countryFlag: string | null;
  avatarColor: string | null;
  avatarUrl: string | null;
  avatarVersion: number;
  isHost: boolean;
  isCurrentUser: boolean;
  friendStatus: string;
  friendRequestId: string | null;
  activeTitle: { code: string; title: string } | null;
  currentSteps: number;
}

export interface WaitingRoomLiveMeta {
  currentPlayers: number;
  maxPlayers: number | null;
  status: string;
  targetSteps?: number;
  entryType?: string;
  challengeType?: string;
  entryAmountCents?: number;
  coinEntryAmount?: number;
  coinPrizePool?: number;
  prizePoolCents?: number;
  platformFeeCents?: number;
  dailyGoalSteps?: number;
  durationDays?: number;
  capacityMode?: "finite" | "unlimited";
  isPrivate?: boolean;
  inviteCode?: string | null;
  minimumParticipants?: number;
  canStart?: boolean | null;
  roomExpiresAt?: string | null;
  createdAt?: string | null;
  cancellationReason?: string | null;
}

export interface WaitingRoomCacheEntry {
  participants: WaitingRoomParticipant[];
  liveRoom: WaitingRoomLiveMeta | null;
  ownerUserId: string;
  raceId: string;
  updatedAt: string;
}

/** @deprecated Prefer waitingRoomCacheKey(userId, raceId). Legacy unscoped key. */
export function waitingRoomCacheKeyLegacy(raceId: string): string {
  return `waiting_room_${raceId}`;
}

export function waitingRoomCacheKey(userId: string, raceId: string): string {
  return `waiting_room:${userId}:${raceId}`;
}

export function parseInitialParticipants(
  json?: string,
): WaitingRoomParticipant[] | null {
  if (!json?.trim()) return null;
  try {
    const parsed = JSON.parse(json) as unknown;
    if (!Array.isArray(parsed) || parsed.length === 0) return null;
    return parsed as WaitingRoomParticipant[];
  } catch {
    return null;
  }
}

export function buildSelfParticipant(
  user: UserProfile,
  isHost: boolean,
  participantId?: string,
): WaitingRoomParticipant {
  return {
    id: participantId ?? `local-${user.id}`,
    userId: user.id,
    username: user.username,
    country: user.country ?? null,
    countryFlag: user.countryFlag ?? null,
    avatarColor: user.avatarColor ?? null,
    avatarUrl: user.profileImageUrl ?? null,
    avatarVersion: user.avatarVersion ?? 0,
    isHost,
    isCurrentUser: true,
    friendStatus: "none",
    friendRequestId: null,
    activeTitle: null,
    currentSteps: 0,
  };
}

export function cacheWaitingRoomState(
  userId: string,
  raceId: string,
  entry: Omit<WaitingRoomCacheEntry, "ownerUserId" | "raceId" | "updatedAt"> &
    Partial<Pick<WaitingRoomCacheEntry, "ownerUserId" | "raceId" | "updatedAt">>,
): void {
  if (!userId || !raceId) return;
  const payload: WaitingRoomCacheEntry = {
    participants: entry.participants,
    liveRoom: entry.liveRoom,
    ownerUserId: userId,
    raceId,
    updatedAt: entry.updatedAt ?? new Date().toISOString(),
  };
  void screenCache.set(waitingRoomCacheKey(userId, raceId), payload);
  // Drop legacy unscoped key so Account B cannot read Account A's seed.
  void screenCache.invalidate(waitingRoomCacheKeyLegacy(raceId));
}

export function readWaitingRoomCacheSync(
  userId: string,
  raceId: string,
): WaitingRoomCacheEntry | null {
  if (!userId || !raceId) return null;
  const scoped = screenCache.getSync<WaitingRoomCacheEntry>(
    waitingRoomCacheKey(userId, raceId),
  );
  if (
    scoped &&
    scoped.ownerUserId === userId &&
    scoped.raceId === raceId &&
    Array.isArray(scoped.participants)
  ) {
    return scoped;
  }
  // One-time migrate legacy unscoped cache only if it clearly belongs to this user.
  const legacy = screenCache.getSync<WaitingRoomCacheEntry & { ownerUserId?: string }>(
    waitingRoomCacheKeyLegacy(raceId),
  );
  if (!legacy?.participants?.length) return null;
  const self = legacy.participants.find((p) => p.isCurrentUser || p.userId === userId);
  if (!self || self.userId !== userId) {
    void screenCache.invalidate(waitingRoomCacheKeyLegacy(raceId));
    return null;
  }
  const migrated: WaitingRoomCacheEntry = {
    participants: legacy.participants,
    liveRoom: legacy.liveRoom ?? null,
    ownerUserId: userId,
    raceId,
    updatedAt: legacy.updatedAt ?? new Date().toISOString(),
  };
  void screenCache.set(waitingRoomCacheKey(userId, raceId), migrated);
  void screenCache.invalidate(waitingRoomCacheKeyLegacy(raceId));
  return migrated;
}

/** Navigation params for instant matchmaking render. */
export function buildMatchmakingParams(options: {
  raceId: string;
  isHost: boolean;
  user?: UserProfile | null;
  participants?: WaitingRoomParticipant[];
  initialCurrentPlayers?: number;
  initialEntryType?: string;
  initialTargetSteps?: number;
  initialCoinEntryAmount?: number;
  initialMaxPlayers?: number | null;
  initialIsPrivate?: boolean;
  initialInviteCode?: string;
  initialScheduledStartAt?: string | null;
  initialPrizePoolCents?: number;
  initialDailyGoalSteps?: number;
  initialDurationDays?: number;
  /** Selected race track theme code (e.g. bg, daylightStadium). */
  initialTrackLayout?: string;
}): Record<string, string> {
  const params: Record<string, string> = {
    raceId: options.raceId,
    isHost: options.isHost ? "true" : "false",
  };

  const parts =
    options.participants ??
    (options.user ? [buildSelfParticipant(options.user, options.isHost)] : []);

  if (parts.length > 0) {
    params.initialParticipants = JSON.stringify(parts);
    params.initialCurrentPlayers = String(
      options.initialCurrentPlayers ?? parts.length,
    );
  }

  if (options.initialEntryType) params.initialEntryType = options.initialEntryType;
  if (options.initialTargetSteps != null) {
    params.initialTargetSteps = String(options.initialTargetSteps);
  }
  if (options.initialCoinEntryAmount != null) {
    params.initialCoinEntryAmount = String(options.initialCoinEntryAmount);
  }
  if (options.initialMaxPlayers != null) {
    params.initialMaxPlayers = String(options.initialMaxPlayers);
  }
  if (options.initialMaxPlayers === null) {
    params.initialCapacityMode = "unlimited";
  }
  if (options.initialIsPrivate != null) {
    params.initialIsPrivate = options.initialIsPrivate ? "true" : "false";
  }
  if (options.initialInviteCode) {
    params.initialInviteCode = options.initialInviteCode;
  }
  if (options.initialScheduledStartAt) {
    params.initialScheduledStartAt = options.initialScheduledStartAt;
  }
  if (options.initialPrizePoolCents != null) {
    params.initialPrizePoolCents = String(options.initialPrizePoolCents);
  }
  if (options.initialDailyGoalSteps != null) {
    params.initialDailyGoalSteps = String(options.initialDailyGoalSteps);
  }
  if (options.initialDurationDays != null) {
    params.initialDurationDays = String(options.initialDurationDays);
  }
  if (options.initialTrackLayout?.trim()) {
    params.initialTrackLayout = options.initialTrackLayout.trim();
  }

  return params;
}
