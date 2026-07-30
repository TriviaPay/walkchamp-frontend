/**
 * Canonical refund records from race leave/cancel and payment refund-request.
 * Backend is source of truth; these helpers normalize API responses for UI.
 */

export type RefundRecord = {
  id: string;
  status: string;
  succeededCashCents: number;
  succeededCoinAmount: number;
  requestedCashCents?: number;
  message?: string;
};

export type RefundBreakdown = {
  refund?: RefundRecord;
  message?: string;
  /** @deprecated legacy leave response */
  walletRefundAmount?: number;
  entryFee?: number;
};

export type RefundBatch = {
  id: string;
  status: string;
  totalItems: number;
  succeededItems: number;
  failedItems: number;
};

export type RaceLeaveResponse = {
  success?: boolean;
  refundBreakdown?: RefundBreakdown;
  /** Authoritative USD leave fields (Fixed + Unlimited). */
  participationStatus?: string;
  prizeEligible?: boolean;
  refundEligible?: boolean;
  refundIssued?: boolean;
  /** Cents refunded (0 post-start). */
  refundAmount?: number;
  refundStatus?: string;
  activeChallengeReleased?: boolean;
  challengeStatus?: string;
  challengeContinues?: boolean;
  raceContinues?: boolean;
  participant_status?: string;
  message?: string;
  error?: string;
  code?: string;
};

/** Alias for cash leave response parsing. */
export type CashChallengeLeaveResponse = RaceLeaveResponse;

export type RaceCancelResponse = {
  success?: boolean;
  refundBatch?: RefundBatch;
  error?: string;
  code?: string;
};

export function getRefundCashDollars(refund?: RefundRecord | null): number {
  if (!refund) return 0;
  return (refund.succeededCashCents ?? 0) / 100;
}

export function getRefundBreakdownCashDollars(breakdown?: RefundBreakdown | null): number {
  if (!breakdown) return 0;
  if (typeof breakdown.walletRefundAmount === "number") {
    return breakdown.walletRefundAmount;
  }
  return getRefundCashDollars(breakdown.refund);
}

export function isRefundPending(breakdown?: RefundBreakdown | null): boolean {
  if (!breakdown) return false;
  if (breakdown.message?.toLowerCase().includes("pending")) return true;
  const status = breakdown.refund?.status;
  return status === "requested" || status === "approved" || status === "queued" || status === "processing";
}

export function formatRefundAlertMessage(opts: {
  cashDollars?: number;
  coinAmount?: number;
  pending?: boolean;
}): string | null {
  const cashDollars = opts.cashDollars ?? 0;
  const coinAmount = opts.coinAmount ?? 0;
  const pending = opts.pending ?? false;

  if (cashDollars > 0) {
    return pending
      ? `Your $${cashDollars.toFixed(2)} refund has been requested and is pending review.`
      : `$${cashDollars.toFixed(2)} has been added to your wallet.`;
  }
  if (coinAmount > 0) {
    return pending
      ? `Your ${coinAmount.toLocaleString()} coin refund has been requested and is pending review.`
      : `${coinAmount.toLocaleString()} coins have been refunded to your wallet.`;
  }
  return null;
}

export function formatCashLeaveSuccessMessage(body: CashChallengeLeaveResponse): string {
  if (typeof body.message === "string" && body.message.trim().length > 0) {
    const trimmed = body.message.trim();
    // Prefer backend message when it already describes leave/refund outcome.
    if (/left|refund|wallet|fee/i.test(trimmed)) return trimmed;
  }

  const cents =
    typeof body.refundAmount === "number" && Number.isFinite(body.refundAmount)
      ? body.refundAmount
      : null;
  const dollarsFromAmount = cents != null ? cents / 100 : null;
  const dollarsFromBreakdown = getRefundBreakdownCashDollars(body.refundBreakdown);
  const dollars =
    dollarsFromAmount != null && dollarsFromAmount > 0
      ? dollarsFromAmount
      : dollarsFromBreakdown > 0
        ? dollarsFromBreakdown
        : 0;

  const pending =
    body.refundEligible === true && body.refundIssued === false
      ? true
      : isRefundPending(body.refundBreakdown) ||
        body.refundStatus === "pending" ||
        body.refundStatus === "requested" ||
        body.refundStatus === "processing" ||
        body.refundStatus === "queued";

  if (body.refundEligible === false || (body.refundIssued === false && dollars <= 0 && !pending)) {
    return "Challenge left. No refund was issued.";
  }

  if (pending && dollars > 0) {
    return `Challenge left. Your $${dollars.toFixed(2)} refund is being processed.`;
  }
  if (pending) {
    return "Challenge left. Your refund is being processed.";
  }

  if (dollars > 0) {
    const feesNote =
      body.refundBreakdown?.message &&
      /fee|processing|service/i.test(body.refundBreakdown.message)
        ? ` ${body.refundBreakdown.message}`
        : "";
    if (feesNote) {
      return `Challenge left. The refundable entry fee was returned.${feesNote.startsWith(" ") ? feesNote : ` ${feesNote}`}`;
    }
    return `Challenge left. $${dollars.toFixed(2)} was refunded to your wallet.`;
  }

  if (body.refundEligible === true) {
    return "Challenge left. Your refund is being processed.";
  }

  return "Challenge left.";
}

export function refundMessageFromLeaveBody(body: RaceLeaveResponse): string | null {
  // Prefer new authoritative cash leave fields when present.
  if (
    body.refundEligible != null ||
    body.refundIssued != null ||
    typeof body.refundAmount === "number" ||
    body.participationStatus === "left"
  ) {
    return formatCashLeaveSuccessMessage(body);
  }
  const breakdown = body.refundBreakdown;
  if (!breakdown) return null;
  return formatRefundAlertMessage({
    cashDollars: getRefundBreakdownCashDollars(breakdown),
    coinAmount: breakdown.refund?.succeededCoinAmount ?? 0,
    pending: isRefundPending(breakdown),
  });
}

export function refundMessageFromCancelBody(body: RaceCancelResponse): string | null {
  const batch = body.refundBatch;
  if (!batch || batch.totalItems === 0) return null;
  if (batch.failedItems > 0 && batch.succeededItems === 0) {
    return "Room cancelled. Refund processing may take a moment — check your wallet shortly.";
  }
  return "Room cancelled. Entry fees are being refunded to participants.";
}
