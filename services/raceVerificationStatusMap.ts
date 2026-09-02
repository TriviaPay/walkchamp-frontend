/**
 * Pure result-status → UI / Redux mappers (no React Native imports).
 */

export type RaceVerificationStatusApi =
  | "live"
  | "verification_pending"
  | "verification_delayed"
  | "review_required"
  | "verification_rejected"
  | "finalized"
  | "close_result_review"
  | "continuity_review"
  | "offline_review"
  | "source_review"
  | "integrity_review"
  | "voided"
  | "disqualified"
  | "reconciling";

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
    case "close_result_review":
    case "continuity_review":
    case "offline_review":
    case "source_review":
    case "integrity_review":
      return "review_required";
    case "verification_delayed":
      return "verification_delayed";
    case "verification_rejected":
    case "voided":
    case "disqualified":
      return "verification_rejected";
    case "reconciling":
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
    case "close_result_review":
      return "This was a very close finish. The final result is under review.";
    case "continuity_review":
      return "We need to review the tracking session before finalizing this result.";
    case "offline_review":
      return "We're reviewing a connectivity gap from this challenge.";
    case "source_review":
      return "We're reviewing the activity source used for this challenge.";
    case "integrity_review":
      return "We couldn't automatically verify this race session.";
    case "review_required":
      return "Result under review; prize frozen";
    case "verification_delayed":
      return "Verification taking longer than expected";
    case "verification_rejected":
      return "Result not verified";
    case "voided":
      return "This challenge was voided. Any applicable entry restoration will be handled automatically.";
    case "disqualified":
      return "This challenge result could not be verified under WalkChamp rules.";
    case "reconciling":
      return "Syncing your final activity";
    case "live":
    case "verification_pending":
    default:
      return "Checking final results";
  }
}

/** Map extended API strings into RaceVerificationStatusApi. */
export function parseRaceVerificationStatus(raw: unknown): RaceVerificationStatusApi {
  const s = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  switch (s) {
    case "live":
    case "verification_pending":
    case "verification_delayed":
    case "review_required":
    case "verification_rejected":
    case "finalized":
    case "close_result_review":
    case "continuity_review":
    case "offline_review":
    case "source_review":
    case "integrity_review":
    case "voided":
    case "disqualified":
    case "reconciling":
      return s;
    default:
      return "verification_pending";
  }
}
