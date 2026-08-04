/**
 * Pure paid-challenge eligibility helpers (no React Native imports).
 */

export type StepTrackingCapabilityStatus =
  | "ready"
  | "permission_required"
  | "provider_required"
  | "unsupported"
  | "temporarily_unavailable"
  | "sync_delayed";

export type PaidChallengeEligibility =
  | "eligible"
  | "setup_required"
  | "temporarily_delayed"
  | "unsupported";

export function resolvePaidChallengeEligibility(cap: {
  verifiedHealthAvailable: boolean;
  verificationStatus: StepTrackingCapabilityStatus;
}): PaidChallengeEligibility {
  if (!cap.verifiedHealthAvailable) return "unsupported";
  if (
    cap.verificationStatus === "permission_required" ||
    cap.verificationStatus === "provider_required"
  ) {
    return "setup_required";
  }
  if (
    cap.verificationStatus === "sync_delayed" ||
    cap.verificationStatus === "temporarily_unavailable"
  ) {
    return "temporarily_delayed";
  }
  if (cap.verificationStatus === "ready") return "eligible";
  return "unsupported";
}
