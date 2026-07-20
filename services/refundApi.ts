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
};

export type RaceCancelResponse = {
  success?: boolean;
  refundBatch?: RefundBatch;
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

export function refundMessageFromLeaveBody(body: RaceLeaveResponse): string | null {
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
