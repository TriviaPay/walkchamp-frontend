import { createSlice, PayloadAction } from "@reduxjs/toolkit";

export interface WalletTransaction {
  id: string;
  type: "reward" | "withdrawal" | "entry_fee" | "refund";
  amount: number;
  description: string;
  date: string;
  status: "pending" | "completed" | "failed";
}

interface WalletState {
  availableBalance: number;
  pendingBalance: number;
  withdrawableBalance: number;
  totalEarned: number;
  transactions: WalletTransaction[];
  loading: boolean;
  error: string | null;
}

const initialState: WalletState = {
  availableBalance: 0,
  pendingBalance: 0,
  withdrawableBalance: 0,
  totalEarned: 0,
  transactions: [],
  loading: false,
  error: null,
};

const walletSlice = createSlice({
  name: "wallet",
  initialState,
  reducers: {
    setBalances(
      state,
      action: PayloadAction<{
        available: number;
        pending: number;
        withdrawable: number;
        totalEarned: number;
      }>,
    ) {
      state.availableBalance = action.payload.available;
      state.pendingBalance = action.payload.pending;
      state.withdrawableBalance = action.payload.withdrawable;
      state.totalEarned = action.payload.totalEarned;
    },
    setTransactions(state, action: PayloadAction<WalletTransaction[]>) {
      state.transactions = action.payload;
    },
    addTransaction(state, action: PayloadAction<WalletTransaction>) {
      state.transactions.unshift(action.payload);
    },
    deductBalance(state, action: PayloadAction<number>) {
      state.availableBalance = Math.max(0, state.availableBalance - action.payload);
    },
    addBalance(state, action: PayloadAction<number>) {
      state.availableBalance += action.payload;
      state.totalEarned += action.payload;
    },
    setLoading(state, action: PayloadAction<boolean>) {
      state.loading = action.payload;
    },
    setError(state, action: PayloadAction<string | null>) {
      state.error = action.payload;
    },
  },
});

export const walletActions = walletSlice.actions;
export default walletSlice.reducer;
