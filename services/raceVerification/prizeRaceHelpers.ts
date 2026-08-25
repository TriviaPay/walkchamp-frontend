/**
 * Platform-aware protected-race helpers. Pure detection lives in prizeRaceDetection.
 */

import { Platform } from "react-native";
import { isIosProtectedRaceEnabled } from "@/config/featureFlags";

export {
  IOS_PROTECTED_UNAVAILABLE_MESSAGE,
  PROTECTED_PREFLIGHT_WAIT_MESSAGE,
  isProtectedClassicDurationOk,
  isProtectedPrizeRace,
  protectedRaceErrorCopy,
} from "./prizeRaceDetection";

export function isProtectedRacePlatformSupported(): boolean {
  if (Platform.OS === "ios") return isIosProtectedRaceEnabled();
  return Platform.OS === "android";
}
