/**
 * Protected / prize-race verification policy defaults.
 * Server verificationPolicy is authoritative when present.
 */

export const HYBRID_RECON_ABS_TOLERANCE = 100;

/** Display / local fallback only — backend reconciliationGraceHours wins. */
export const HYBRID_VERIFICATION_GRACE_HOURS = 4;

/** Display / local fallback — backend reviewWindowHours wins. */
export const HYBRID_REVIEW_WINDOW_HOURS = 48;

export const DEFAULT_PROTECTED_RACE_POLICY = {
  protectedRace: true,
  phoneOnly: true,
  integrityRequired: true,
  minimumRaceDurationMinutes: 60,
  maxContinuousOfflineMinutes: 10,
  maxOfflinePercent: 20,
  finalEvidenceUploadGraceMinutes: 15,
  reconciliationGraceHours: HYBRID_VERIFICATION_GRACE_HOURS,
  reviewWindowHours: HYBRID_REVIEW_WINDOW_HOURS,
  /** Sync comparison only — not close-result / payout threshold. */
  hybridReconAbsTolerance: HYBRID_RECON_ABS_TOLERANCE,
} as const;

/** Suggested reconciliation attempt offsets (ms) after race end. Backend schedule wins. */
export const RECONCILIATION_RETRY_OFFSETS_MS = [
  0,
  5 * 60_000,
  15 * 60_000,
  30 * 60_000,
  60 * 60_000,
  2 * 60 * 60_000,
  4 * 60 * 60_000,
] as const;

export type ProtectedRacePolicy = {
  protectedRace: boolean;
  phoneOnly: boolean;
  integrityRequired: boolean;
  minimumRaceDurationMinutes: number;
  maxContinuousOfflineMinutes: number;
  maxOfflinePercent: number;
  finalEvidenceUploadGraceMinutes: number;
  reconciliationGraceHours: number;
  reviewWindowHours: number;
  hybridReconAbsTolerance: number;
};

export function mergeProtectedRacePolicy(
  server?: Partial<ProtectedRacePolicy> | null,
): ProtectedRacePolicy {
  return {
    ...DEFAULT_PROTECTED_RACE_POLICY,
    ...(server ?? {}),
  };
}
