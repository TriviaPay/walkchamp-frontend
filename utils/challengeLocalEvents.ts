/**
 * Cross-screen local events (Waiting Room leave → Walk Next Race cleanup).
 */

import { DeviceEventEmitter } from "react-native";

export const CHALLENGE_LEFT_EVENT = "walkchamp:challenge_left";
/** Force Walk challenge chips to refetch without waiting for the poll interval. */
export const CHALLENGE_STATUSES_REFRESH_EVENT = "walkchamp:challenge_statuses_refresh";

/** Covers the leave-API race so Walk My Race does not rehydrate a just-forfeited card. */
const RECENTLY_LEFT_TTL_MS = 5 * 60 * 1000;
const recentlyLeftRaceIds = new Map<string, number>();

export function markChallengeLeftLocally(raceId: string): void {
  if (!raceId) return;
  recentlyLeftRaceIds.set(raceId, Date.now());
}

export function isRecentlyLeftRaceId(raceId: string): boolean {
  const at = recentlyLeftRaceIds.get(raceId);
  if (!at) return false;
  if (Date.now() - at > RECENTLY_LEFT_TTL_MS) {
    recentlyLeftRaceIds.delete(raceId);
    return false;
  }
  return true;
}

export function clearRecentlyLeftRaceId(raceId: string): void {
  if (!raceId) return;
  recentlyLeftRaceIds.delete(raceId);
}

export function emitChallengeLeft(raceId: string): void {
  if (!raceId) return;
  markChallengeLeftLocally(raceId);
  // Persist Unlimited leave so Next Race / hosted seeds cannot resurrect the card.
  void import("@/utils/hostedUnlimitedCache")
    .then(({ removeHostedUnlimitedChallenge }) => removeHostedUnlimitedChallenge(raceId))
    .catch(() => {});
  DeviceEventEmitter.emit(CHALLENGE_LEFT_EVENT, { raceId });
}

export function emitChallengeStatusesRefresh(reason?: string): void {
  DeviceEventEmitter.emit(CHALLENGE_STATUSES_REFRESH_EVENT, { reason });
}
