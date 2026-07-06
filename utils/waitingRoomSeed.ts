/**
 * Instant waiting-room UI — seed participants and room meta before the first poll.
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
  maxPlayers: number;
  status: string;
  targetSteps?: number;
  entryType?: string;
  entryAmountCents?: number;
  coinEntryAmount?: number;
  coinPrizePool?: number;
  isPrivate?: boolean;
  inviteCode?: string | null;
}

export interface WaitingRoomCacheEntry {
  participants: WaitingRoomParticipant[];
  liveRoom: WaitingRoomLiveMeta | null;
}

export function waitingRoomCacheKey(raceId: string): string {
  return `waiting_room_${raceId}`;
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
  raceId: string,
  entry: WaitingRoomCacheEntry,
): void {
  void screenCache.set(waitingRoomCacheKey(raceId), entry);
}

export function readWaitingRoomCacheSync(
  raceId: string,
): WaitingRoomCacheEntry | null {
  return screenCache.getSync<WaitingRoomCacheEntry>(waitingRoomCacheKey(raceId));
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
  initialMaxPlayers?: number;
  initialIsPrivate?: boolean;
  initialInviteCode?: string;
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
  if (options.initialIsPrivate != null) {
    params.initialIsPrivate = options.initialIsPrivate ? "true" : "false";
  }
  if (options.initialInviteCode) {
    params.initialInviteCode = options.initialInviteCode;
  }

  return params;
}
