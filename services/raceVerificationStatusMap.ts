/**
 * Pure result-status → UI / Redux mappers (no React Native imports).
 */

export type RaceVerificationStatusApi =
  | "live"
  | "verification_pending"
  | "verification_delayed"
  | "review_required"
  | "verification_rejected"
  | "finalized";

export function verificationStatusToReconciliation(
  status: RaceVerificationStatusApi,
):
  | "not_started"
  | "pending"
  | "verification_delayed"
  | "review_required"
  | "verification_rejected"
  | "finalized" {
  switch (status) {
    case "finalized":
      return "finalized";
    case "review_required":
      return "review_required";
    case "verification_delayed":
      return "verification_delayed";
    case "verification_rejected":
      return "verification_rejected";
    case "live":
    case "verification_pending":
    default:
      return "pending";
  }
}

export function resultStatusDisplayLabel(
  status: RaceVerificationStatusApi,
): string {
  switch (status) {
    case "finalized":
      return "Final result verified";
    case "review_required":
      return "Result under review";
    case "verification_delayed":
      return "Verification taking longer than expected";
    case "verification_rejected":
      return "Result not verified";
    case "live":
    case "verification_pending":
    default:
      return "Verifying your steps";
  }
}
