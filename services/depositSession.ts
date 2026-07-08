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

export function isTerminalDepositStatus(status: string): boolean {
  return TERMINAL.has(status);
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
