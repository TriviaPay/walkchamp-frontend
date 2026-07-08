import type { WalletTransaction, WalletTransactionType } from "@/utils/mockData";

/** Map backend wallet transaction `type` + optional raw ledger field to UI type. */
export function mapLedgerTypeToUi(
  apiType: string,
  rawLedgerType?: string,
): { uiType: WalletTransactionType; ledgerType?: string } {
  const ledger = rawLedgerType?.trim() || apiType;

  const direct: Record<string, WalletTransactionType> = {
    deposit: "deposit",
    deposit_credit: "deposit",
    reward: "reward",
    prize: "prize",
    prize_credit: "prize",
    withdrawal: "withdrawal",
    referral: "referral",
    bonus: "bonus",
    refund: "refund",
    race_entry_refund: "refund",
    reversal: "reversal",
    reversal_debit: "reversal",
    chargeback_debit: "reversal",
    race_entry: "challenge_entry",
    challenge_entry: "challenge_entry",
    challenge_entry_debit: "challenge_entry",
    race_entry_wallet_debit: "challenge_entry",
    manual_adjustment: "deposit",
    race_entry_payment: "challenge_entry",
    race_prize_paid: "prize",
    race_prize_approved: "prize",
    race_prize_pending: "prize",
    sponsored_reward: "reward",
    promo_discount: "bonus",
    referral_credit: "referral",
  };

  const uiType = direct[ledger] ?? direct[apiType] ?? "bonus";
  const isTypedLedger = Boolean(rawLedgerType && rawLedgerType !== apiType);
  return {
    uiType,
    ledgerType: isTypedLedger ? rawLedgerType : ledger !== apiType ? ledger : undefined,
  };
}

export function formatRelativeDate(isoOrDate: string | Date): string {
  const date = typeof isoOrDate === "string" ? new Date(isoOrDate) : isoOrDate;
  const now = Date.now();
  const diffMs = now - date.getTime();
  const diffDays = Math.floor(diffMs / 86400000);
  if (diffDays === 0) {
    const diffHrs = Math.floor(diffMs / 3600000);
    return diffHrs > 0 ? `${diffHrs}h ago` : "Just now";
  }
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays} days ago`;
  return `${Math.floor(diffDays / 7)} week${Math.floor(diffDays / 7) > 1 ? "s" : ""} ago`;
}

export function ledgerTypeLabel(ledgerType?: string): string | null {
  if (!ledgerType) return null;
  const labels: Record<string, string> = {
    deposit_credit: "Deposit",
    challenge_entry_debit: "Challenge entry",
    race_entry_wallet_debit: "Challenge entry",
    prize_credit: "Prize",
    race_prize_paid: "Prize",
    reversal_debit: "Reversal",
    chargeback_debit: "Chargeback",
    race_entry_refund: "Refund",
  };
  return labels[ledgerType] ?? null;
}
