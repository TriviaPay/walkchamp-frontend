import { authFetch } from "@/utils/authFetch";

export type CashChallengePaymentQuote = {
  entryFee: number;
  entryFeeCents: number;
  numberOfPlayers: number;
  entryPool: number;
  entryPoolCents: number;
  prizePool: number;
  prizePoolCents: number;
  rewardSplit: Array<{
    rank: number;
    label: string;
    percentage: number;
    amount: number;
    amountCents: number;
  }>;
  taxAmount?: number;
  paymentProcessingFee: number;
  paymentProcessingFeeCents: number;
  platformServiceFee: number;
  platformServiceFeeCents: number;
  totalPayable: number;
  totalPayableCents: number;
  walletRefundAmount: number;
  walletRefundAmountCents: number;
  refundDestination: "wallet";
  walletBalance: number;
  walletBalanceCents: number;
  canAfford: boolean;
  currency: "usd";
  paymentProvider: string;
};

export async function fetchCashChallengePaymentQuote(params: {
  entryFeeCents: number;
  numberOfPlayers: number;
  countryCode?: string;
}): Promise<CashChallengePaymentQuote> {
  const qs = new URLSearchParams({
    entryFeeCents: String(params.entryFeeCents),
    numberOfPlayers: String(params.numberOfPlayers),
  });
  if (params.countryCode) qs.set("countryCode", params.countryCode);
  const res = await authFetch(`/api/races/cash-challenge/payment-quote?${qs.toString()}`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? "Could not load payment quote.");
  }
  return res.json() as Promise<CashChallengePaymentQuote>;
}

export function formatUsd(cents: number | null | undefined): string {
  const n = typeof cents === "number" && Number.isFinite(cents) ? cents : 0;
  return `$${(n / 100).toFixed(2)}`;
}

export function formatUsdFromDollars(dollars: number | null | undefined): string {
  const n = typeof dollars === "number" && Number.isFinite(dollars) ? dollars : 0;
  return `$${n.toFixed(2)}`;
}

/** Refund modal breakdown — API may omit walletRefundAmount; entry fee is refunded to wallet. */
export function refundBreakdownFromQuote(quote: CashChallengePaymentQuote) {
  const entryFee =
    typeof quote.entryFee === "number"
      ? quote.entryFee
      : (quote.entryFeeCents ?? 0) / 100;
  const paymentProcessingFee =
    typeof quote.paymentProcessingFee === "number"
      ? quote.paymentProcessingFee
      : (quote.paymentProcessingFeeCents ?? 0) / 100;
  const platformServiceFee =
    typeof quote.platformServiceFee === "number"
      ? quote.platformServiceFee
      : (quote.platformServiceFeeCents ?? 0) / 100;
  const totalPayable =
    typeof quote.totalPayable === "number"
      ? quote.totalPayable
      : (quote.totalPayableCents ?? 0) / 100;
  const walletRefundAmount =
    typeof quote.walletRefundAmount === "number"
      ? quote.walletRefundAmount
      : typeof quote.walletRefundAmountCents === "number"
        ? quote.walletRefundAmountCents / 100
        : entryFee;

  return {
    amountPaid: totalPayable > 0 ? totalPayable : entryFee,
    entryFee,
    paymentProcessingFee,
    platformServiceFee,
    walletRefundAmount,
  };
}
