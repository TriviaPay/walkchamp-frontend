/**
 * Protected-race permission gate — additive to matchPermissionGate.
 */

import type { VerifiedStepProviderResult } from "@/services/steps/verifiedStepCapability";
import { isProtectedRaceVerificationEnabled } from "@/config/featureFlags";
import {
  prepareProtectedRace,
  isProtectedPrizeRace,
} from "@/services/raceVerification/raceVerificationService";
import type { PrizeRaceReadiness } from "@/services/raceVerification/raceVerificationTypes";

export type PrizeRacePermissionGateResult = {
  allowed: boolean;
  blocked: boolean;
  readiness: PrizeRaceReadiness | null;
  skipped: boolean;
};

export async function ensurePrizeRaceReadiness(options: {
  userId: string;
  raceId: string;
  challengeType?: string | null;
  entryType?: string | null;
  entryFeeCents?: number | null;
  entryFee?: number | null;
  protectedRace?: boolean | null;
  isSponsored?: boolean | null;
  durationMinutes?: number | null;
  onSetupRequired?: (result?: VerifiedStepProviderResult) => void;
}): Promise<PrizeRacePermissionGateResult> {
  if (!isProtectedRaceVerificationEnabled()) {
    return { allowed: true, blocked: false, readiness: null, skipped: true };
  }

  if (
    options.protectedRace !== true &&
    !isProtectedPrizeRace({
      protectedRace: options.protectedRace,
      challengeType: options.challengeType,
      entryType: options.entryType,
      entryFeeCents: options.entryFeeCents,
      entryFee: options.entryFee,
      isSponsored: options.isSponsored,
    })
  ) {
    return { allowed: true, blocked: false, readiness: null, skipped: true };
  }

  const result = await prepareProtectedRace({
    raceId: options.raceId,
    userId: options.userId,
    challengeType: options.challengeType,
    entryType: options.entryType,
    entryFeeCents: options.entryFeeCents,
    entryFee: options.entryFee,
    protectedRace: options.protectedRace,
    isSponsored: options.isSponsored,
    durationMinutes: options.durationMinutes,
  });

  if (result.ok === false && result.skipped) {
    return { allowed: true, blocked: false, readiness: null, skipped: true };
  }

  const readiness = result.ok ? result.readiness : result.readiness;
  if (readiness.eligible) {
    return { allowed: true, blocked: false, readiness, skipped: false };
  }

  options.onSetupRequired?.();
  return { allowed: false, blocked: true, readiness, skipped: false };
}
