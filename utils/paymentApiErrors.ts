/**
 * Map backend cash / payment API errors to user-facing copy.
 * Does not change request/response shapes — UX only.
 */

export type PaymentApiErrorBody = {
  error?: string;
  code?: string;
  message?: string;
};

const CODE_MESSAGES: Record<string, string> = {
  CASH_FEATURES_DISABLED:
    "Cash features are currently disabled on the server. Deposits and paid challenges are unavailable.",
  CASH_GEO_BLOCKED:
    "Cash features are not available in your region.",
  REAL_MONEY_NOT_APPROVED:
    "Real-money payments are not approved for this environment yet. Use sandbox/test keys, or ask the team to enable PAYMENTS_LIVE_MODE after legal approval.",
  REAL_MONEY_LEGAL_NOT_APPROVED:
    "Cash challenges are waiting on legal approval. Wallet testing may still be available in sandbox mode.",
  REAL_MONEY_KYC_TAX_NOT_READY:
    "Withdrawals and prize cash-out are unavailable until KYC and tax reporting are ready.",
  PAYMENTS_PROVIDER_NOT_CONFIGURED:
    "Payment provider is not configured on the server. Please try again later.",
  WALLET_CURRENCY_MISMATCH:
    "Your wallet currency does not match this payment method. Contact support if this persists.",
};

export function paymentApiErrorMessage(
  body: PaymentApiErrorBody | null | undefined,
  fallback: string,
): string {
  if (!body || typeof body !== "object") return fallback;
  const code = typeof body.code === "string" ? body.code.trim() : "";
  if (code && CODE_MESSAGES[code]) return CODE_MESSAGES[code];

  const fromError = typeof body.error === "string" ? body.error.trim() : "";
  if (fromError) {
    if (/cash features are disabled/i.test(fromError)) {
      return CODE_MESSAGES.CASH_FEATURES_DISABLED;
    }
    if (/real.?money/i.test(fromError) && /approv/i.test(fromError)) {
      return CODE_MESSAGES.REAL_MONEY_NOT_APPROVED;
    }
    return fromError;
  }

  const fromMessage = typeof body.message === "string" ? body.message.trim() : "";
  return fromMessage || fallback;
}

export async function readPaymentApiError(
  res: Response,
  fallback: string,
): Promise<string> {
  const body = (await res.json().catch(() => ({}))) as PaymentApiErrorBody;
  return paymentApiErrorMessage(body, fallback);
}
