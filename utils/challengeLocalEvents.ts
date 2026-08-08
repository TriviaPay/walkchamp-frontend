/**
 * Cross-screen local events (Waiting Room leave → Walk Next Race cleanup).
 */

import { DeviceEventEmitter } from "react-native";

export const CHALLENGE_LEFT_EVENT = "walkchamp:challenge_left";
/** Force Walk challenge chips to refetch without waiting for the poll interval. */
export const CHALLENGE_STATUSES_REFRESH_EVENT = "walkchamp:challenge_statuses_refresh";

export function emitChallengeLeft(raceId: string): void {
  if (!raceId) return;
  DeviceEventEmitter.emit(CHALLENGE_LEFT_EVENT, { raceId });
}

export function emitChallengeStatusesRefresh(reason?: string): void {
  DeviceEventEmitter.emit(CHALLENGE_STATUSES_REFRESH_EVENT, { reason });
}
