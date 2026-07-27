/**
 * Submit Health Connect / HealthKit race-window totals to POST /verify.
 * Wraps local raceHealthVerification readings — does not change live UI.
 */

import { Platform } from "react-native";
import {
  postRaceVerify,
  type RaceVerifySource,
} from "@/services/raceVerificationApi";
import { clampRaceSessionId } from "@/services/steps/liveRaceSessionId";
import { logger } from "@/utils/logger";

export function canonicalRaceVerifySource(): RaceVerifySource {
  return Platform.OS === "ios" ? "healthkit" : "health_connect";
}

export async function submitRaceVerifiedTotal(args: {
  raceId: string;
  verifiedCumulativeSteps: number;
  measuredAtUtc?: string;
  intervalStartUtc?: string;
  intervalEndUtc?: string;
  clientLiveCumulativeSteps?: number;
  verificationSessionId?: string | null;
}): Promise<void> {
  const steps = Math.max(0, Math.floor(args.verifiedCumulativeSteps));
  if (!args.raceId || steps < 0) return;

  const result = await postRaceVerify(args.raceId, {
    verifiedCumulativeSteps: steps,
    source: canonicalRaceVerifySource(),
    measuredAtUtc: args.measuredAtUtc ?? new Date().toISOString(),
    intervalStartUtc: args.intervalStartUtc,
    intervalEndUtc: args.intervalEndUtc,
    clientLiveCumulativeSteps: args.clientLiveCumulativeSteps,
    verificationSessionId: clampRaceSessionId(args.verificationSessionId ?? undefined),
  });

  if (!result.ok && "featureEnabled" in result && result.featureEnabled === false) {
    return; // soft-skip
  }

  if (__DEV__) {
    if (result.ok && "accepted" in result) {
      logger.debug(
        "RaceVerify",
        `submit raceId=${args.raceId} steps=${steps} accepted=${result.accepted} reason=${"reason" in result ? result.reason ?? "" : ""}`,
      );
    } else if (!result.ok) {
      logger.debug(
        "RaceVerify",
        `submit raceId=${args.raceId} status=${result.status} reason=${result.reason ?? ""}`,
      );
    }
  }
}
