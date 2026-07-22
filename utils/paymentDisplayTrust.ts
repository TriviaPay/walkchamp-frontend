/**
 * Trust backend payment quote totals for display — never recompute locally.
 * UI may adopt this helper later; not wired here.
 */

export type BackendPaymentQuoteAmounts = {
  /** Backend-authoritative total the user pays (dollars). */
  totalPayable?: number | null;
  /** Backend cents form when dollars omitted. */
  totalPayableCents?: number | null;
  entryFee?: number | null;
  entryFeeCents?: number | null;
  paymentProcessingFee?: number | null;
  paymentProcessingFeeCents?: number | null;
  platformServiceFee?: number | null;
  platformServiceFeeCents?: number | null;
  canAfford?: boolean;
  walletBalance?: number | null;
};

export type TrustedPaymentDisplay = {
  totalPayable: number;
  entryFee: number;
  paymentProcessingFee: number;
  platformServiceFee: number;
  canAfford: boolean | undefined;
  walletBalance: number | undefined;
  /** True when total came from backend quote fields (not a local sum). */
  trustedTotal: boolean;
};

function dollarsFrom(
  dollars: number | null | undefined,
  cents: number | null | undefined,
): number | undefined {
  if (typeof dollars === "number" && Number.isFinite(dollars)) return dollars;
  if (typeof cents === "number" && Number.isFinite(cents)) return cents / 100;
  return undefined;
}

/**
 * Select display amounts from a backend payment quote.
 * Prefer `totalPayable` / `totalPayableCents` — do not sum fees client-side.
 */
export function selectTrustedPaymentDisplay(
  quote: BackendPaymentQuoteAmounts | null | undefined,
): TrustedPaymentDisplay | null {
  if (!quote) return null;

  const totalPayable = dollarsFrom(quote.totalPayable, quote.totalPayableCents);
  const entryFee = dollarsFrom(quote.entryFee, quote.entryFeeCents) ?? 0;
  const paymentProcessingFee =
    dollarsFrom(quote.paymentProcessingFee, quote.paymentProcessingFeeCents) ?? 0;
  const platformServiceFee =
    dollarsFrom(quote.platformServiceFee, quote.platformServiceFeeCents) ?? 0;
  const walletBalance = dollarsFrom(quote.walletBalance, undefined);

  if (totalPayable === undefined) {
    // No backend total — refuse to invent one from local arithmetic.
    return {
      totalPayable: 0,
      entryFee,
      paymentProcessingFee,
      platformServiceFee,
      canAfford: quote.canAfford,
      walletBalance,
      trustedTotal: false,
    };
  }

  return {
    totalPayable,
    entryFee,
    paymentProcessingFee,
    platformServiceFee,
    canAfford: quote.canAfford,
    walletBalance,
    trustedTotal: true,
  };
}
