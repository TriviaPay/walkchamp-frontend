import {
  previewUnlimitedTotalChargeCents,
  UNLIMITED_GOAL_PLATFORM_FEE_CENTS,
} from "@/utils/unlimitedGoal";

export type UnlimitedGoalPaymentQuote = {
  entryFeeCents: number;
  platformFeeCents: number;
  totalChargeCents: number;
  currency: "usd";
  /** When backend returns wallet balance / affordability. */
  walletBalanceCents?: number;
  canAfford?: boolean;
};

/**
 * Local payment preview for Unlimited create UI.
 * Create/pay uses POST /api/unlimited-challenges/host — no separate quote endpoint.
 * Authoritative debit amount is `challenge.totalChargeCents` on the host response.
 */
export function previewUnlimitedGoalPaymentQuote(params: {
  entryFeeCents: number;
}): UnlimitedGoalPaymentQuote {
  const preview = previewUnlimitedTotalChargeCents(params.entryFeeCents);
  return {
    entryFeeCents: preview.entryFeeCents,
    platformFeeCents: preview.platformFeeCents,
    totalChargeCents: preview.totalChargeCents,
    currency: "usd",
  };
}

/** @deprecated Prefer previewUnlimitedGoalPaymentQuote — no network quote for unlimited. */
export async function fetchUnlimitedGoalPaymentQuote(params: {
  entryFeeCents: number;
}): Promise<UnlimitedGoalPaymentQuote> {
  return previewUnlimitedGoalPaymentQuote(params);
}

export { UNLIMITED_GOAL_PLATFORM_FEE_CENTS };
