import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import { type LeaderboardUser, type WalletTransaction } from "@/utils/mockData";
import { STORAGE_KEYS, storageGet, storageSet } from "@/utils/storage";
import { getValidSession } from "@/services/authService";
import { timeoutSignal, API_TIMEOUT_MS } from "@/utils/authFetch";
import { getDeviceTimezone, getLocalDateStr, getLocalWeekStart, getLocalMonthStart } from "@/utils/timezone";
import { dynamicIconService } from "@/services/dynamicIconService";

const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? "";

interface WalletData {
  availableBalance: number;
  pendingBalance: number;
  withdrawableBalance: number;
  totalEarned: number;
  currency: string;
}

interface AppContextType {
  leaderboard: LeaderboardUser[];
  userRank: number;
  walletBalance: number;
  pendingBalance: number;
  walletCurrency: string;
  transactions: WalletTransaction[];
  requestWithdrawal: (amount: number, method: string, payoutDetails?: Record<string, string>) => Promise<void>;
  addReward: (amount: number, description: string) => void;
  refreshWallet: () => Promise<void>;
  refreshLeaderboard: (period?: string, scope?: string, countryCode?: string) => Promise<void>;
  walletLoading: boolean;
  leaderboardLoading: boolean;
}

const AppContext = createContext<AppContextType | null>(null);

async function apiFetch<T>(path: string): Promise<T | null> {
  const session = await getValidSession();
  if (!session) return null;
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      signal: timeoutSignal(API_TIMEOUT_MS),
      headers: { Authorization: `Bearer ${session}` },
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

async function apiPost<T>(path: string, body: unknown): Promise<T | null> {
  const session = await getValidSession();
  if (!session) return null;
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      method: "POST",
      signal: timeoutSignal(API_TIMEOUT_MS),
      headers: {
        Authorization: `Bearer ${session}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(err.error ?? `Request failed: ${res.status}`);
    }
    return (await res.json()) as T;
  } catch (e) {
    throw e;
  }
}

function mapApiTransaction(tx: Record<string, unknown>): WalletTransaction {
  const typeMap: Record<string, WalletTransaction["type"]> = {
    reward: "reward",
    prize: "reward",
    withdrawal: "withdrawal",
    referral: "referral",
    race_entry: "withdrawal",
    bonus: "bonus",
    manual_adjustment: "deposit",
    deposit: "deposit",
  };
  const date = typeof tx.date === "string" ? new Date(tx.date) : new Date();
  const now = Date.now();
  const diffMs = now - date.getTime();
  const diffDays = Math.floor(diffMs / 86400000);
  let dateStr = "Just now";
  if (diffDays === 0) {
    const diffHrs = Math.floor(diffMs / 3600000);
    dateStr = diffHrs > 0 ? `${diffHrs}h ago` : "Just now";
  } else if (diffDays === 1) {
    dateStr = "Yesterday";
  } else if (diffDays < 7) {
    dateStr = `${diffDays} days ago`;
  } else {
    dateStr = `${Math.floor(diffDays / 7)} week${Math.floor(diffDays / 7) > 1 ? "s" : ""} ago`;
  }

  return {
    id: String(tx.id ?? ""),
    type: typeMap[String(tx.type ?? "")] ?? "bonus",
    amount: Number(tx.amount ?? 0),
    description: String(tx.description ?? ""),
    date: dateStr,
    status: (tx.status as WalletTransaction["status"]) ?? "completed",
  };
}

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [walletBalance, setWalletBalance] = useState(0);
  const [pendingBalance, setPendingBalance] = useState(0);
  const [walletCurrency, setWalletCurrency] = useState("USD");
  const [transactions, setTransactions] = useState<WalletTransaction[]>([]);
  const [leaderboard, setLeaderboard] = useState<LeaderboardUser[]>([]);
  const [userRank, setUserRank] = useState(9999);
  const [walletLoading, setWalletLoading] = useState(false);
  const [leaderboardLoading, setLeaderboardLoading] = useState(false);

  const refreshWallet = useCallback(async () => {
    setWalletLoading(true);
    try {
      const data = await apiFetch<{ wallet: WalletData }>("/api/wallet");
      if (data?.wallet) {
        setWalletBalance(data.wallet.availableBalance);
        setPendingBalance(data.wallet.pendingBalance);
        if (data.wallet.currency) setWalletCurrency(data.wallet.currency.toUpperCase());
        storageSet(STORAGE_KEYS.WALLET, data.wallet.availableBalance);
      }

      const [txData, depositData] = await Promise.all([
        apiFetch<{ transactions: Array<Record<string, unknown>> }>("/api/wallet/transactions"),
        apiFetch<{ deposits: Array<Record<string, unknown>> }>("/api/wallet/deposit/list"),
      ]);

      const walletTxs = txData?.transactions?.map(mapApiTransaction) ?? [];

      const depositTxs: WalletTransaction[] = (depositData?.deposits ?? []).map((d) => {
        const createdAt = typeof d.createdAt === "string" ? new Date(d.createdAt) : new Date();
        const now = Date.now();
        const diffMs = now - createdAt.getTime();
        const diffDays = Math.floor(diffMs / 86400000);
        let dateStr = "Just now";
        if (diffDays === 0) {
          const diffHrs = Math.floor(diffMs / 3600000);
          dateStr = diffHrs > 0 ? `${diffHrs}h ago` : "Just now";
        } else if (diffDays === 1) {
          dateStr = "Yesterday";
        } else if (diffDays < 7) {
          dateStr = `${diffDays} days ago`;
        } else {
          dateStr = `${Math.floor(diffDays / 7)} week${Math.floor(diffDays / 7) > 1 ? "s" : ""} ago`;
        }

        const status = String(d.status ?? "pending");
        const txStatus: WalletTransaction["status"] =
          status === "succeeded" ? "completed" :
          status === "failed" || status === "cancelled" ? "rejected" :
          "pending";

        const provider = String(d.provider ?? "stripe");
        const currency = String(d.currency ?? "USD");
        const creditCents = Number(d.walletCreditCents ?? 0);
        const amountMinor = Number(d.amountMinorUnits ?? 0);
        const displayAmount =
          creditCents > 0 ? creditCents / 100 :
          currency === "INR" ? (amountMinor / 100) * 1.2 / 100 :
          amountMinor / 100;

        const providerLabel = provider === "razorpay" ? "Razorpay" : "Stripe";
        const currencySymbol = currency === "INR" ? "₹" : "$";
        const rawAmount = amountMinor / 100;
        const description = `Deposit via ${providerLabel} (${currencySymbol}${rawAmount % 1 === 0 ? rawAmount.toFixed(0) : rawAmount.toFixed(2)})`;

        return {
          id: `dep-${String(d.id)}`,
          type: "deposit" as const,
          amount: txStatus === "completed" ? displayAmount : 0,
          description,
          date: dateStr,
          status: txStatus,
        };
      });

      const allTxs = [...walletTxs, ...depositTxs].sort((a, b) => {
        const order = { "Just now": 0, "Yesterday": 1 };
        const aScore = order[a.date as keyof typeof order] ?? 2;
        const bScore = order[b.date as keyof typeof order] ?? 2;
        return aScore - bScore;
      });

      if (allTxs.length > 0 || walletTxs.length > 0) {
        setTransactions(allTxs);
        storageSet(STORAGE_KEYS.TRANSACTIONS, allTxs);
      }
    } catch {
      const cached = await storageGet<number>(STORAGE_KEYS.WALLET);
      if (cached !== null) setWalletBalance(cached);
      const cachedTxs = await storageGet<WalletTransaction[]>(STORAGE_KEYS.TRANSACTIONS);
      if (cachedTxs) setTransactions(cachedTxs);
    } finally {
      setWalletLoading(false);
    }
  }, []);

  const refreshLeaderboard = useCallback(async (
    period = "all_time",
    scope = "global",
    countryCode?: string,
  ) => {
    setLeaderboardLoading(true);
    try {
      const params = new URLSearchParams({ period, scope });
      if (scope === "regional" && countryCode) params.set("countryCode", countryCode);
      // Include local date boundaries so the server computes the period in
      // the user's calendar day rather than the server's UTC date.
      params.set("localDate", getLocalDateStr());
      if (period === "week") params.set("weekStart", getLocalWeekStart());
      if (period === "month") params.set("monthStart", getLocalMonthStart());
      const data = await apiFetch<{ leaderboard: LeaderboardUser[]; userRank: number }>(
        `/api/leaderboard?${params.toString()}`,
      );
      if (data) {
        setLeaderboard(data.leaderboard ?? []);
        setUserRank(data.userRank ?? 9999);
      }
    } catch {
      // Keep existing data on error
    } finally {
      setLeaderboardLoading(false);
    }
  }, []);

  useEffect(() => {
    const load = async () => {
      const cached = await storageGet<number>(STORAGE_KEYS.WALLET);
      if (cached !== null) setWalletBalance(cached);
      const cachedTxs = await storageGet<WalletTransaction[]>(STORAGE_KEYS.TRANSACTIONS);
      if (cachedTxs) setTransactions(cachedTxs);

      // Sync device timezone to the user's backend preferences so the server
      // can use the correct IANA timezone for future computations.
      // Fire-and-forget: timezone sync must never delay the main load.
      getValidSession().then((session) => {
        if (!session) return;
        fetch(`${API_BASE}/api/user/preferences`, {
          method: "PATCH",
          signal: timeoutSignal(API_TIMEOUT_MS),
          headers: {
            Authorization: `Bearer ${session}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ timezone: getDeviceTimezone() }),
        }).catch(() => {}); // ignore errors — non-critical background sync
      }).catch(() => {});

      await Promise.all([refreshWallet(), refreshLeaderboard()]);

      // Refresh dynamic app icon on every app load / foreground.
      // Fire-and-forget — must never delay the main load or throw.
      dynamicIconService.checkAndUpdate().catch(() => {});
    };
    load();
  }, [refreshWallet, refreshLeaderboard]);

  const requestWithdrawal = useCallback(async (
    amount: number,
    method: string,
    payoutDetails: Record<string, string> = {},
  ) => {
    const payoutMethodMap: Record<string, string> = {
      "PayPal": "paypal",
      "Bank Transfer": "bank_transfer",
      "UPI (India)": "upi",
      "Gift Card": "gift_card",
    };

    await apiPost("/api/wallet/withdraw", {
      amount,
      payoutMethod: payoutMethodMap[method] ?? method.toLowerCase().replace(/\s+/g, "_"),
      payoutDetails: payoutDetails.email
        ? payoutDetails
        : { note: `${method} withdrawal requested` },
    });

    await refreshWallet();
  }, [refreshWallet]);

  const addReward = useCallback((amount: number, description: string) => {
    const newBalance = walletBalance + amount;
    setWalletBalance(newBalance);
    storageSet(STORAGE_KEYS.WALLET, newBalance);

    const tx: WalletTransaction = {
      id: Date.now().toString(),
      type: "reward",
      amount,
      description,
      date: "Just now",
      status: "completed",
    };
    setTransactions((prev) => {
      const updated = [tx, ...prev];
      storageSet(STORAGE_KEYS.TRANSACTIONS, updated);
      return updated;
    });
  }, [walletBalance]);

  return (
    <AppContext.Provider
      value={{
        leaderboard,
        userRank,
        walletBalance,
        pendingBalance,
        walletCurrency,
        transactions,
        requestWithdrawal,
        addReward,
        refreshWallet,
        refreshLeaderboard,
        walletLoading,
        leaderboardLoading,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}

export function useApp(): AppContextType {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used within AppProvider");
  return ctx;
}
