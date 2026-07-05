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

export function formatUsd(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export function formatUsdFromDollars(dollars: number): string {
  return `$${dollars.toFixed(2)}`;
}
