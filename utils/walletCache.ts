/**
 * Per-user cash wallet cache — never show another account's wallet on switch.
 */
import { STORAGE_KEYS, storageGet, storageRemove, storageSet } from "@/utils/storage";
import type { WalletTransaction } from "@/utils/mockData";

type CachedWallet = {
  userId: string;
  balance: number;
};

type CachedTransactions = {
  userId: string;
  transactions: WalletTransaction[];
};

export async function loadCachedWalletBalance(userId: string): Promise<number | null> {
  if (!userId) return null;
  const raw = await storageGet<CachedWallet | number>(STORAGE_KEYS.WALLET);
  if (raw == null) return null;

  if (typeof raw === "number") {
    // Legacy unscoped — discard.
    await storageRemove(STORAGE_KEYS.WALLET);
    return null;
  }
  if (raw.userId !== userId || typeof raw.balance !== "number") return null;
  return raw.balance;
}

export function persistWalletBalance(userId: string, balance: number): void {
  if (!userId) return;
  void storageSet(STORAGE_KEYS.WALLET, { userId, balance } satisfies CachedWallet);
}

export async function loadCachedWalletTransactions(
  userId: string,
): Promise<WalletTransaction[] | null> {
  if (!userId) return null;
  const raw = await storageGet<CachedTransactions | WalletTransaction[]>(STORAGE_KEYS.TRANSACTIONS);
  if (!raw) return null;

  if (Array.isArray(raw)) {
    await storageRemove(STORAGE_KEYS.TRANSACTIONS);
    return null;
  }
  if (raw.userId !== userId || !Array.isArray(raw.transactions)) return null;
  return raw.transactions;
}

export function persistWalletTransactions(
  userId: string,
  transactions: WalletTransaction[],
): void {
  if (!userId) return;
  void storageSet(STORAGE_KEYS.TRANSACTIONS, {
    userId,
    transactions,
  } satisfies CachedTransactions);
}

export function clearCachedWallet(): void {
  void storageRemove(STORAGE_KEYS.WALLET);
  void storageRemove(STORAGE_KEYS.TRANSACTIONS);
}
