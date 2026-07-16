import { authFetch } from "@/utils/authFetch";
import {
  DEPOSIT_PENDING_MAX_AGE_MS,
  DEPOSIT_POLL_INTERVAL_MS,
  PAYMENT_API_PATHS,
} from "@/config/paymentsConfig";
import { storageGet, storageRemove, storageSet, STORAGE_KEYS } from "@/utils/storage";

export type DepositTerminalStatus = "succeeded" | "failed" | "cancelled";
export type DepositPollStatus =
  | DepositTerminalStatus
  | "processing"
  | "pending"
  | "requires_review"
  | "settlement_error"
  | "expired";

export type PendingDepositSession = {
  transactionId: string;
  provider: "stripe" | "razorpay";
  startedAt: string;
};

export type PaymentResultStatus = "success" | "failed" | "cancelled" | "verification_failed";

export type PaymentResultPayload = {
  status: PaymentResultStatus;
  transactionId: string;
  resolvedAt: string;
};

const TERMINAL = new Set<string>([
  "succeeded",
  "failed",
  "cancelled",
  "expired",
  "requires_review",
  "settlement_error",
]);

/** Statuses that mean checkout polling can stop and show a final UI result. */
const POLL_COMPLETE = new Set<string>(["succeeded", "failed", "cancelled", "expired"]);

export function isTerminalDepositStatus(status: string): boolean {
  return TERMINAL.has(status);
}

export function isPollCompleteDepositStatus(status: string): boolean {
  return POLL_COMPLETE.has(status);
}

export async function savePendingDeposit(session: PendingDepositSession): Promise<void> {
  await storageSet(STORAGE_KEYS.PENDING_DEPOSIT, session);
}

export async function getPendingDeposit(): Promise<PendingDepositSession | null> {
  const row = await storageGet<PendingDepositSession>(STORAGE_KEYS.PENDING_DEPOSIT);
  if (!row?.transactionId) return null;

  const startedAt = Date.parse(row.startedAt);
  if (!Number.isFinite(startedAt) || Date.now() - startedAt > DEPOSIT_PENDING_MAX_AGE_MS) {
    await clearPendingDeposit();
    return null;
  }
  return row;
}

export async function clearPendingDeposit(): Promise<void> {
  await storageRemove(STORAGE_KEYS.PENDING_DEPOSIT);
}

export async function savePaymentResult(payload: PaymentResultPayload): Promise<void> {
  await storageSet(STORAGE_KEYS.PAYMENT_RESULT, payload);
}

export async function consumePaymentResult(): Promise<PaymentResultPayload | null> {
  const row = await storageGet<PaymentResultPayload>(STORAGE_KEYS.PAYMENT_RESULT);
  if (!row) return null;
  await storageRemove(STORAGE_KEYS.PAYMENT_RESULT);
  return row;
}

/** Read stored payment result without removing (for resume routing). */
export async function peekPaymentResult(): Promise<PaymentResultPayload | null> {
  return storageGet<PaymentResultPayload>(STORAGE_KEYS.PAYMENT_RESULT);
}

export async function fetchDepositStatus(transactionId: string): Promise<DepositPollStatus> {
  const res = await authFetch(PAYMENT_API_PATHS.depositStatus(transactionId));
  if (!res.ok) return "pending";
  const data = (await res.json()) as { transaction: { status: string } };
  return (data.transaction?.status ?? "pending") as DepositPollStatus;
}

export function depositStatusToUiResult(status: DepositPollStatus): PaymentResultStatus | null {
  if (status === "succeeded") return "success";
  if (status === "cancelled") return "cancelled";
  if (status === "failed" || status === "expired") return "failed";
  if (status === "requires_review" || status === "settlement_error") return "verification_failed";
  return null;
}

function urlStatusToUiResult(status: string | null | undefined): PaymentResultStatus | null {
  if (!status) return null;
  if (status === "success" || status === "succeeded") return "success";
  if (status === "cancelled") return "cancelled";
  // processing/pending — URL is ahead of DB; always confirm via API before showing UI
  if (status === "processing" || status === "pending") return null;
  if (status === "requires_review" || status === "settlement_error") return "verification_failed";
  if (status === "failed" || status === "expired") return "failed";
  return null;
}

/** Extract transaction id from any payment return URL without trusting status query params. */
export function extractPaymentTransactionId(raw: string): string | null {
  try {
    const trimmed = raw.trim();
    if (!trimmed) return null;

    let params: URLSearchParams;
    if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
      const url = new URL(trimmed);
      const path = url.pathname.replace(/\/+$/, "") || "/";
      const isPaymentPath =
        path.endsWith("/payment-complete") || path.endsWith("/api/wallet/deposit/done");
      if (!isPaymentPath) return null;
      params = url.searchParams;
    } else {
      const withoutScheme = trimmed.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "");
      const qIdx = withoutScheme.indexOf("?");
      const pathPart = qIdx >= 0 ? withoutScheme.slice(0, qIdx) : withoutScheme;
      const isPaymentPath =
        pathPart.includes("payment-complete") || pathPart.includes("wallet/deposit/done");
      if (!isPaymentPath) return null;
      params = new URLSearchParams(qIdx >= 0 ? withoutScheme.slice(qIdx + 1) : "");
    }

    return params.get("transaction_id") ?? params.get("transactionId");
  } catch {
    return null;
  }
}

/** Resolve modal UI from backend deposit status (source of truth). */
export async function resolveDepositUiFromTransaction(
  transactionId: string,
): Promise<PaymentResultStatus | null> {
  const status = await fetchDepositStatus(transactionId);
  return depositStatusToUiResult(status);
}

/** Parse payment return URL (deep link, universal link, or done page). */
export function parsePaymentReturnUrl(raw: string): PaymentResultPayload | null {
  try {
    const trimmed = raw.trim();
    if (!trimmed) return null;

    let params: URLSearchParams;
    let isPaymentPath = false;

    if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
      const url = new URL(trimmed);
      const path = url.pathname.replace(/\/+$/, "") || "/";
      isPaymentPath =
        path.endsWith("/payment-complete") || path.endsWith("/api/wallet/deposit/done");
      if (!isPaymentPath) return null;
      params = url.searchParams;
    } else {
      const withoutScheme = trimmed.replace(/^[a-z][a-z0-9+.-]*:\/\//i, "");
      const qIdx = withoutScheme.indexOf("?");
      const pathPart = qIdx >= 0 ? withoutScheme.slice(0, qIdx) : withoutScheme;
      isPaymentPath =
        pathPart.includes("payment-complete") || pathPart.includes("wallet/deposit/done");
      if (!isPaymentPath) return null;
      params = new URLSearchParams(qIdx >= 0 ? withoutScheme.slice(qIdx + 1) : "");
    }

    const transactionId = params.get("transaction_id") ?? params.get("transactionId");
    if (!transactionId) return null;

    const ui = urlStatusToUiResult(params.get("status"));
    if (!ui) return null;

    return {
      status: ui,
      transactionId,
      resolvedAt: new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

/** Save payment result from return URL — returns true if this was a payment URL. */
export async function ingestPaymentReturnUrl(raw: string): Promise<boolean> {
  const transactionId = extractPaymentTransactionId(raw);
  if (!transactionId) return false;

  const ui = await resolveDepositUiFromTransaction(transactionId);
  if (!ui) return true;

  await clearPendingDeposit();
  await savePaymentResult({
    status: ui,
    transactionId,
    resolvedAt: new Date().toISOString(),
  });
  return true;
}

/** Poll until terminal status or timeout. Used while browser checkout is open. */
export async function pollDepositUntilTerminal(
  transactionId: string,
  opts?: { intervalMs?: number; maxWaitMs?: number; onTick?: (status: DepositPollStatus) => void },
): Promise<DepositPollStatus> {
  const intervalMs = opts?.intervalMs ?? DEPOSIT_POLL_INTERVAL_MS;
  const maxWaitMs = opts?.maxWaitMs ?? 10 * 60 * 1000;
  const started = Date.now();

  while (Date.now() - started < maxWaitMs) {
    const status = await fetchDepositStatus(transactionId);
    opts?.onTick?.(status);
    if (isTerminalDepositStatus(status)) return status;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return "processing";
}

/** On app resume: poll pending deposit once; persist UI result if terminal. */
export async function resolvePendingDepositOnResume(): Promise<PaymentResultPayload | null> {
  const pending = await getPendingDeposit();
  if (!pending) return null;

  const status = await fetchDepositStatus(pending.transactionId);
  const ui = depositStatusToUiResult(status);
  if (!ui) return null;

  await clearPendingDeposit();
  const payload: PaymentResultPayload = {
    status: ui,
    transactionId: pending.transactionId,
    resolvedAt: new Date().toISOString(),
  };
  await savePaymentResult(payload);
  return payload;
}
