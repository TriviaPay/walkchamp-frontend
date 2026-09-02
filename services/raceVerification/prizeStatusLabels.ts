/**
 * Map backend adjudication / result-status → prizeVerification UI copy.
 * Frontend never invents refund / DQ / payout outcomes.
 */

import type {
  BackendPrizeAdjudicationStatus,
  PrizeVerificationStatus,
} from "./raceVerificationTypes";

export function normalizeAdjudicationStatus(
  raw: unknown,
): BackendPrizeAdjudicationStatus {
  if (typeof raw !== "string" || !raw.trim()) {
    return "PENDING_VERIFICATION";
  }
  return raw.trim().toUpperCase().replace(/-/g, "_");
}

export function adjudicationToPrizeStatus(
  raw: unknown,
): PrizeVerificationStatus {
  const s = normalizeAdjudicationStatus(raw);
  switch (s) {
    case "VERIFIED_CLEAR_RESULT":
      return "verified_clear_result";
    case "CLOSE_RESULT_REVIEW":
      return "close_result_review";
    case "CONTINUITY_REVIEW":
      return "continuity_review";
    case "OFFLINE_REVIEW":
      return "offline_review";
    case "SOURCE_REVIEW":
      return "source_review";
    case "INTEGRITY_REVIEW":
      return "integrity_review";
    case "REVIEW_REQUIRED":
      return "review_required";
    case "VOIDED":
      return "voided";
    case "DISQUALIFIED":
    case "VERIFICATION_REJECTED":
      return "disqualified";
    case "FINALIZED":
      return "finalized";
    case "RECONCILING":
      return "reconciling";
    case "EVIDENCE_SUBMITTED":
      return "evidence_submitted";
    case "PENDING_VERIFICATION":
    case "RESULT_PENDING_VERIFICATION":
    case "VERIFICATION_PENDING":
    case "AWAITING_VERIFICATION":
    default:
      return "result_pending_verification";
  }
}

export function prizeStatusDisplayLabel(
  status: PrizeVerificationStatus,
  opts?: { settlementStatus?: string | null },
): string {
  const settlement = (opts?.settlementStatus ?? "").toLowerCase();
  switch (status) {
    case "result_pending_verification":
      return "Finalizing your verified steps";
    case "reconciling":
      return "Verifying results";
    case "evidence_submitted":
      return "Evidence received; waiting for verification";
    case "verified_clear_result":
    case "finalized":
      if (settlement && settlement !== "paid") {
        return "Result verified; settling prize";
      }
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
    case "voided":
      return "This challenge was voided. Any applicable entry restoration will be handled automatically.";
    case "disqualified":
      return "Result rejected. Contact support if you want to dispute this.";
    case "ready":
      return "Device verified";
    case "preflight":
      return "Verification setup required";
    case "live":
      return "Live challenge in progress";
    case "idle":
    default:
      return "";
  }
}

/** True when UI must not show definitive win/loss / payout. */
export function isPrizeOutcomePending(
  status: PrizeVerificationStatus,
  settlementStatus?: string | null,
): boolean {
  if (status === "finalized" || status === "verified_clear_result") {
    if (settlementStatus && settlementStatus.toLowerCase() !== "paid") {
      return true;
    }
    return false;
  }
  return true;
}

export const PRIZE_PHONE_ONLY_DISCLOSURE =
  "Keep your registered phone with you for the entire verified challenge. Wearable-only steps are not eligible for this challenge.";

export const PRIZE_TRACKER_NOT_READY_MESSAGE =
  "Your step tracker isn't ready for verified challenges.";

export const PRIZE_MIN_DURATION_MESSAGE =
  "Verified prize challenges must run for at least 60 minutes.";
