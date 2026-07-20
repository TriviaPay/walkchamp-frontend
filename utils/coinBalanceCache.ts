/**
 * Per-user coin balance cache — never show another account's balance.
 */
import { STORAGE_KEYS, storageGet, storageRemove, storageSet } from "@/utils/storage";
import type { CoinBalance } from "@/store/slices/coinsSlice";

type CachedCoinBalance = {
  userId: string;
  balance: CoinBalance;
};

function normalizeBalance(cached: CoinBalance): CoinBalance | null {
  if (!cached || typeof cached.currentBalance !== "number") return null;
  return {
    currentBalance: Math.max(0, Math.floor(cached.currentBalance)),
    lifetimeEarned: Math.max(0, Math.floor(Number(cached.lifetimeEarned) || 0)),
    lifetimeSpent: Math.max(0, Math.floor(Number(cached.lifetimeSpent) || 0)),
    earnedToday: Math.max(0, Math.floor(Number(cached.earnedToday) || 0)),
    adsToday: cached.adsToday,
    adsRemaining: cached.adsRemaining,
    maxDailyAdRewards: cached.maxDailyAdRewards,
  };
}

/** Load cached balance only when it belongs to `userId`. */
export async function loadCachedCoinBalance(userId: string): Promise<CoinBalance | null> {
  if (!userId) return null;
  const raw = await storageGet<CachedCoinBalance | CoinBalance>(STORAGE_KEYS.COIN_BALANCE);
  if (!raw) return null;

  // Legacy unscoped cache — discard (could belong to another account).
  if (!("userId" in raw) || typeof (raw as CachedCoinBalance).userId !== "string") {
    await storageRemove(STORAGE_KEYS.COIN_BALANCE);
    return null;
  }

  const scoped = raw as CachedCoinBalance;
  if (scoped.userId !== userId) return null;
  return normalizeBalance(scoped.balance);
}

export function persistCoinBalance(userId: string, balance: CoinBalance): void {
  if (!userId || !balance) return;
  void storageSet(STORAGE_KEYS.COIN_BALANCE, {
    userId,
    balance,
  } satisfies CachedCoinBalance);
}

export function clearCachedCoinBalance(): void {
  void storageRemove(STORAGE_KEYS.COIN_BALANCE);
}
