import { createSlice, createAsyncThunk } from "@reduxjs/toolkit";
import { getValidSession } from "@/services/authService";
import { getLocalDateStr } from "@/utils/timezone";

const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? "";

export interface CoinBalance {
  currentBalance: number;
  lifetimeEarned: number;
  lifetimeSpent: number;
  earnedToday: number;
  adsToday?: number;
  adsRemaining?: number;
  maxDailyAdRewards?: number;
}

export interface CoinTransaction {
  id: string;
  amount: number;
  transactionType: string;
  source: string;
  description: string;
  rewardCode: string | null;
  createdAt: string;
}

export interface PurchaseHistoryItem {
  id: string;
  productId: string;
  displayName: string;
  platform: string;
  status: string;
  coinAmount: number | null;
  isMicPass: boolean;
  createdAt: string;
}

export interface PurchaseSummary {
  coinBalance: {
    current: number;
    lifetimeEarned: number;
    lifetimeSpent: number;
    earnedToday: number;
  };
  iap: {
    totalPurchases: number;
    totalCoinsPurchased: number;
    hasMicPass: boolean;
  };
  purchaseHistory: PurchaseHistoryItem[];
}

interface CoinsState {
  balance: CoinBalance | null;
  transactions: CoinTransaction[];
  purchaseSummary: PurchaseSummary | null;
  loading: boolean;
  transactionsLoading: boolean;
  summaryLoading: boolean;
  error: string | null;
}

const initialState: CoinsState = {
  balance: null,
  transactions: [],
  purchaseSummary: null,
  loading: false,
  transactionsLoading: false,
  summaryLoading: false,
  error: null,
};

export const fetchCoinBalance = createAsyncThunk("coins/fetchBalance", async () => {
  const session = await getValidSession();
  if (!session) throw new Error("Not authenticated");
  const res = await fetch(`${API_BASE}/api/coins/balance?localDate=${getLocalDateStr()}`, {
    headers: { Authorization: `Bearer ${session}` },
  });
  if (!res.ok) throw new Error("Failed to fetch coin balance");
  return (await res.json()) as CoinBalance;
});

export const fetchCoinTransactions = createAsyncThunk("coins/fetchTransactions", async () => {
  const session = await getValidSession();
  if (!session) throw new Error("Not authenticated");
  const res = await fetch(`${API_BASE}/api/coins/transactions`, {
    headers: { Authorization: `Bearer ${session}` },
  });
  if (!res.ok) throw new Error("Failed to fetch transactions");
  const json = await res.json();
  return json.transactions as CoinTransaction[];
});

export const fetchPurchaseSummary = createAsyncThunk("coins/fetchPurchaseSummary", async () => {
  const session = await getValidSession();
  if (!session) throw new Error("Not authenticated");
  const res = await fetch(`${API_BASE}/api/purchases/summary?localDate=${getLocalDateStr()}`, {
    headers: { Authorization: `Bearer ${session}` },
  });
  if (!res.ok) throw new Error("Failed to fetch purchase summary");
  const json = await res.json() as {
    success: boolean;
    coin_balance: { current: number; lifetime_earned: number; lifetime_spent: number; earned_today: number };
    iap: { total_purchases: number; total_coins_purchased: number; has_mic_pass: boolean };
    purchase_history: Array<{
      id: string; product_id: string; display_name: string; platform: string;
      status: string; coin_amount: number | null; is_mic_pass: boolean; created_at: string;
    }>;
  };
  return {
    coinBalance: {
      current: json.coin_balance.current,
      lifetimeEarned: json.coin_balance.lifetime_earned,
      lifetimeSpent: json.coin_balance.lifetime_spent,
      earnedToday: json.coin_balance.earned_today,
    },
    iap: {
      totalPurchases: json.iap.total_purchases,
      totalCoinsPurchased: json.iap.total_coins_purchased,
      hasMicPass: json.iap.has_mic_pass,
    },
    purchaseHistory: json.purchase_history.map((r) => ({
      id: r.id,
      productId: r.product_id,
      displayName: r.display_name,
      platform: r.platform,
      status: r.status,
      coinAmount: r.coin_amount,
      isMicPass: r.is_mic_pass,
      createdAt: r.created_at,
    })),
  } satisfies PurchaseSummary;
});

const coinsSlice = createSlice({
  name: "coins",
  initialState,
  reducers: {
    // Set the exact balance from the backend — use this when receiving a Pusher event
    // that includes the authoritative new balance to avoid drift from delta arithmetic.
    setCoinBalance(state, action: { payload: number }) {
      const balance = action.payload;
      if (state.balance) {
        state.balance.currentBalance = balance;
      } else {
        state.balance = { currentBalance: balance, lifetimeEarned: balance, lifetimeSpent: 0, earnedToday: 0 };
      }
      if (state.purchaseSummary) {
        state.purchaseSummary.coinBalance.current = balance;
      }
    },
    addEarnedCoins(state, action: { payload: { amount: number } }) {
      if (state.balance) {
        state.balance.currentBalance += action.payload.amount;
        state.balance.lifetimeEarned += action.payload.amount;
        state.balance.earnedToday += action.payload.amount;
      }
      if (state.purchaseSummary) {
        state.purchaseSummary.coinBalance.current += action.payload.amount;
        state.purchaseSummary.coinBalance.lifetimeEarned += action.payload.amount;
        state.purchaseSummary.coinBalance.earnedToday += action.payload.amount;
      }
    },
    deductSpentCoins(state, action: { payload: { amount: number } }) {
      if (state.balance) {
        state.balance.currentBalance = Math.max(0, state.balance.currentBalance - action.payload.amount);
        state.balance.lifetimeSpent += action.payload.amount;
      }
      if (state.purchaseSummary) {
        state.purchaseSummary.coinBalance.current = Math.max(0, state.purchaseSummary.coinBalance.current - action.payload.amount);
        state.purchaseSummary.coinBalance.lifetimeSpent += action.payload.amount;
      }
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchCoinBalance.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchCoinBalance.fulfilled, (state, action) => {
        state.loading = false;
        state.balance = action.payload;
      })
      .addCase(fetchCoinBalance.rejected, (state, action) => {
        state.loading = false;
        state.error = action.error.message ?? "Failed to load coins";
      })
      .addCase(fetchCoinTransactions.pending, (state) => {
        state.transactionsLoading = true;
      })
      .addCase(fetchCoinTransactions.fulfilled, (state, action) => {
        state.transactionsLoading = false;
        state.transactions = action.payload;
      })
      .addCase(fetchCoinTransactions.rejected, (state) => {
        state.transactionsLoading = false;
      })
      .addCase(fetchPurchaseSummary.pending, (state) => {
        state.summaryLoading = true;
      })
      .addCase(fetchPurchaseSummary.fulfilled, (state, action) => {
        state.summaryLoading = false;
        state.purchaseSummary = action.payload;
        // Keep the simple balance in sync too
        state.balance = {
          currentBalance: action.payload.coinBalance.current,
          lifetimeEarned: action.payload.coinBalance.lifetimeEarned,
          lifetimeSpent: action.payload.coinBalance.lifetimeSpent,
          earnedToday: action.payload.coinBalance.earnedToday,
        };
      })
      .addCase(fetchPurchaseSummary.rejected, (state) => {
        state.summaryLoading = false;
      });
  },
});

export const { setCoinBalance, addEarnedCoins, deductSpentCoins } = coinsSlice.actions;
export default coinsSlice.reducer;
