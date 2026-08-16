/**
 * Client helpers for account deletion. Backend still owns purge/settlement.
 */

export const DELETE_ACCOUNT_WARNING =
  "This closes your WalkChamp account and signs you out. Withdraw any cash balance first. Payment, security, and legal records may be kept as required by law.";

export function deleteAccountBalanceBlockMessage(opts: {
  walletBalance: number;
  pendingBalance: number;
}): string | null {
  const available = Number(opts.walletBalance) || 0;
  const pending = Number(opts.pendingBalance) || 0;
  if (available > 0.009 || pending > 0.009) {
    return "Withdraw your cash balance and wait for pending transactions to finish before deleting your account.";
  }
  return null;
}

export function messageForDeleteAccountResponse(
  status: number,
  body?: { error?: string; code?: string } | null,
): string {
  if (status === 409) {
    return (
      body?.error ??
      "You still have a cash balance, pending withdrawal, or an active paid challenge. Resolve that first, then try again."
    );
  }
  return body?.error ?? "Failed to delete account. Please contact support.";
}
