import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { AppState, InteractionManager, Platform, type AppStateStatus } from "react-native";
import { type LeaderboardUser, type WalletTransaction } from "@/utils/mockData";
import { formatRelativeDate, mapLedgerTypeToUi } from "@/utils/walletLedger";
import {
  clearCachedWallet,
  loadCachedWalletBalance,
  loadCachedWalletTransactions,
  persistWalletBalance,
  persistWalletTransactions,
} from "@/utils/walletCache";
import { getValidSession } from "@/services/authService";
import { timeoutSignal, API_TIMEOUT_MS } from "@/utils/authFetch";
import { getDeviceTimezone, getLocalDateStr, getLocalWeekStart, getLocalMonthStart } from "@/utils/timezone";
import { dynamicIconService } from "@/services/dynamicIconService";
import { waitForAppStartupReady } from "@/services/appStartup";
import { runCoalesced, apiFetchAllowed, markApiFetched } from "@/utils/apiRequestCoordinator";
import { screenCache } from "@/utils/screenCache";
import { perf } from "@/utils/perfLogger";
import { useAuth } from "@/context/AuthContext";

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
  refreshWallet: (opts?: { silent?: boolean }) => Promise<void>;
  refreshLeaderboard: (
    period?: string,
    scope?: string,
    countryCode?: string,
    opts?: { silent?: boolean },
  ) => Promise<void>;
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
  const apiType = String(tx.type ?? "");
  const rawLedger =
    typeof tx.ledgerType === "string"
      ? tx.ledgerType
      : typeof tx.transactionType === "string"
        ? tx.transactionType
        : undefined;
  const { uiType, ledgerType } = mapLedgerTypeToUi(apiType, rawLedger);
  const dateIso = typeof tx.date === "string" ? tx.date : new Date().toISOString();
  const statusRaw = String(tx.status ?? "completed");
  const status: WalletTransaction["status"] =
    statusRaw === "completed" || statusRaw === "pending" || statusRaw === "rejected"
      ? statusRaw
      : statusRaw === "failed" || statusRaw === "cancelled"
        ? "rejected"
        : "completed";

  return {
    id: String(tx.id ?? ""),
    type: uiType,
    amount: Number(tx.amount ?? 0),
    description: String(tx.description ?? ""),
    date: formatRelativeDate(dateIso),
    status,
    ledgerType,
  };
}

export function AppProvider({ children }: { children: React.ReactNode }) {
  const { user, loading: authLoading, sessionToken } = useAuth();
  const hasWalletCacheRef = useRef(false);
  const hasLeaderboardCacheRef = useRef(false);
  const walletUserIdRef = useRef<string | null>(null);

  const [walletBalance, setWalletBalance] = useState(0);
  const [pendingBalance, setPendingBalance] = useState(0);
  const [walletCurrency, setWalletCurrency] = useState("USD");
  const [transactions, setTransactions] = useState<WalletTransaction[]>([]);
  const [leaderboard, setLeaderboard] = useState<LeaderboardUser[]>([]);
  const [userRank, setUserRank] = useState(9999);
  const [walletLoading, setWalletLoading] = useState(false);
  const [leaderboardLoading, setLeaderboardLoading] = useState(false);

  const refreshWallet = useCallback(async (opts?: { silent?: boolean }) => {
    const uid = user?.id;
    const silent = opts?.silent === true || hasWalletCacheRef.current;
    if (!silent) setWalletLoading(true);
    try {
      await runCoalesced("wallet_refresh", async () => {
        const data = await apiFetch<{ wallet: WalletData }>("/api/wallet");
        if (data?.wallet) {
          setWalletBalance(data.wallet.availableBalance);
          setPendingBalance(data.wallet.pendingBalance);
          if (data.wallet.currency) setWalletCurrency(data.wallet.currency.toUpperCase());
          if (uid) persistWalletBalance(uid, data.wallet.availableBalance);
          hasWalletCacheRef.current = true;
        }

        const [txData, depositData] = await Promise.all([
          apiFetch<{ transactions: Array<Record<string, unknown>> }>("/api/wallet/transactions"),
          apiFetch<{ deposits: Array<Record<string, unknown>> }>("/api/wallet/deposit/list"),
        ]);

        const walletTxs = txData?.transactions?.map(mapApiTransaction) ?? [];
        const ledgerDepositIds = new Set(
          walletTxs
            .filter((t) => t.type === "deposit")
            .map((t) => t.id),
        );

        // In-flight deposits only — ledger rows are source of truth once credited (Phase C).
        const inFlightDeposits: WalletTransaction[] = (depositData?.deposits ?? [])
          .filter((d) => {
            const status = String(d.status ?? "pending");
            return status === "pending" || status === "processing";
          })
          .filter((d) => !ledgerDepositIds.has(String(d.id)))
          .map((d) => {
            const createdAt = typeof d.createdAt === "string" ? d.createdAt : new Date().toISOString();
            const status = String(d.status ?? "pending");
            const provider = String(d.provider ?? "stripe");
            const currency = String(d.currency ?? "USD");
            const amountMinor = Number(d.amountMinorUnits ?? 0);
            const rawAmount = amountMinor / 100;
            const providerLabel = provider === "razorpay" ? "Razorpay" : "Stripe";
            const currencySymbol = currency === "INR" ? "₹" : "$";
            const amountLabel =
              rawAmount % 1 === 0 ? rawAmount.toFixed(0) : rawAmount.toFixed(2);

            return {
              id: `dep-pending-${String(d.id)}`,
              type: "deposit" as const,
              amount: 0,
              description: `Deposit via ${providerLabel} (${currencySymbol}${amountLabel}) — verifying`,
              date: formatRelativeDate(createdAt),
              status: "pending" as const,
              ledgerType: "deposit_pending",
            };
          });

        const allTxs = [...walletTxs, ...inFlightDeposits];

        if (allTxs.length > 0 || walletTxs.length > 0) {
          setTransactions(allTxs);
          if (uid) persistWalletTransactions(uid, allTxs);
        }
      });
    } catch {
      if (uid) {
        const cached = await loadCachedWalletBalance(uid);
        if (cached !== null) setWalletBalance(cached);
        const cachedTxs = await loadCachedWalletTransactions(uid);
        if (cachedTxs) setTransactions(cachedTxs);
      }
    } finally {
      setWalletLoading(false);
    }
  }, [user?.id]);

  const refreshLeaderboard = useCallback(async (
    period = "all_time",
    scope = "global",
    countryCode?: string,
    opts?: { silent?: boolean },
  ) => {
    const silent = opts?.silent === true || hasLeaderboardCacheRef.current;
    if (!silent) setLeaderboardLoading(true);
    const cacheKey = `app_lb_${period}_${scope}_${countryCode ?? "none"}`;
    try {
      await runCoalesced(`leaderboard_${cacheKey}`, async () => {
        const params = new URLSearchParams({ period, scope });
        if (scope === "regional" && countryCode) params.set("countryCode", countryCode);
        params.set("localDate", getLocalDateStr());
        if (period === "week") params.set("weekStart", getLocalWeekStart());
        if (period === "month") params.set("monthStart", getLocalMonthStart());
        const data = await apiFetch<{ leaderboard: LeaderboardUser[]; userRank: number }>(
          `/api/leaderboard?${params.toString()}`,
        );
        if (data) {
          setLeaderboard(data.leaderboard ?? []);
          setUserRank(data.userRank ?? 9999);
          hasLeaderboardCacheRef.current = true;
          void screenCache.set(cacheKey, {
            leaderboard: data.leaderboard ?? [],
            userRank: data.userRank ?? 9999,
          });
        }
      });
    } catch {
      // Keep existing data on error
    } finally {
      setLeaderboardLoading(false);
    }
  }, []);

  useEffect(() => {
    if (authLoading) return;

    const uid = user?.id ?? null;
    const prev = walletUserIdRef.current;

    // Account switch / logout — never leave previous user's wallet on screen.
    if (prev && prev !== uid) {
      setWalletBalance(0);
      setPendingBalance(0);
      setTransactions([]);
      setLeaderboard([]);
      setUserRank(9999);
      hasWalletCacheRef.current = false;
      hasLeaderboardCacheRef.current = false;
    }
    walletUserIdRef.current = uid;

    if (!sessionToken || !uid) {
      if (prev && !uid) clearCachedWallet();
      return;
    }

    const load = async () => {
      const cachedWallet = await loadCachedWalletBalance(uid);
      if (cachedWallet !== null) {
        setWalletBalance(cachedWallet);
        hasWalletCacheRef.current = true;
        perf.cacheHit("wallet_balance");
      } else {
        setWalletBalance(0);
        hasWalletCacheRef.current = false;
        perf.cacheMiss("wallet_balance");
      }
      const cachedTxs = await loadCachedWalletTransactions(uid);
      if (cachedTxs) setTransactions(cachedTxs);
      else setTransactions([]);

      const lbCacheKey = `app_lb_all_time_global_none`;
      const cachedLb = screenCache.getSync<{ leaderboard: LeaderboardUser[]; userRank: number }>(lbCacheKey)
        ?? await screenCache.get<{ leaderboard: LeaderboardUser[]; userRank: number }>(lbCacheKey);
      if (cachedLb) {
        setLeaderboard(cachedLb.leaderboard);
        setUserRank(cachedLb.userRank);
        hasLeaderboardCacheRef.current = true;
        perf.cacheHit(lbCacheKey);
      }

      // Timezone sync is fire-and-forget — must never delay wallet/rank display.
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
        }).catch(() => {});
      }).catch(() => {});

      // Wallet is shown on Walk tab — fetch immediately in background.
      void refreshWallet({ silent: hasWalletCacheRef.current });

      // Leaderboard rank is non-critical for first paint — defer after interactions.
      InteractionManager.runAfterInteractions(() => {
        if (!apiFetchAllowed("app_leaderboard_rank", 60_000)) {
          perf.apiSkipped("leaderboard_throttled");
          return;
        }
        markApiFetched("app_leaderboard_rank");
        void refreshLeaderboard("all_time", "global", undefined, {
          silent: hasLeaderboardCacheRef.current,
        });
      });

      void waitForAppStartupReady().then(() => {
        setTimeout(() => {
          dynamicIconService
            .checkAndUpdate({ allowApiFetch: true })
            .catch(() => {});
        }, __DEV__ ? 3000 : 8000);
      });
    };
    void load();
  }, [authLoading, sessionToken, user?.id, refreshWallet, refreshLeaderboard]);

  useEffect(() => {
    const onChange = (state: AppStateStatus) => {
      if (state === "active" && Platform.OS !== "android") {
        void waitForAppStartupReady().then(() => {
          setTimeout(() => {
            dynamicIconService.checkAndUpdate({ allowApiFetch: true }).catch(() => {});
          }, 1500);
        });
      }
    };
    const sub = AppState.addEventListener("change", onChange);
    return () => sub.remove();
  }, []);

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
    if (user?.id) persistWalletBalance(user.id, newBalance);

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
      if (user?.id) persistWalletTransactions(user.id, updated);
      return updated;
    });
  }, [walletBalance, user?.id]);

  const value = useMemo(
    () => ({
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
    }),
    [
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
    ],
  );

  return (
    <AppContext.Provider value={value}>
      {children}
    </AppContext.Provider>
  );
}

export function useApp(): AppContextType {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used within AppProvider");
  return ctx;
}
