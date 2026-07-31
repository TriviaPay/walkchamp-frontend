/**
 * Cross-screen local events (Waiting Room leave → Walk Next Race cleanup).
 */

import { DeviceEventEmitter } from "react-native";

export const CHALLENGE_LEFT_EVENT = "walkchamp:challenge_left";

export function emitChallengeLeft(raceId: string): void {
  if (!raceId) return;
  DeviceEventEmitter.emit(CHALLENGE_LEFT_EVENT, { raceId });
}
