import { createSlice, createAsyncThunk } from "@reduxjs/toolkit";
import { getStoredSession } from "@/services/authService";
import type { TrackThemeImageSet } from "@/utils/trackThemeMedia";

const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? "";

export interface TrackTheme {
  code: string;
  name: string;
  priceCoins: number;
  isDefault: boolean;
  owned: boolean;
  locked: boolean;
  isEquipped: boolean;
  canPurchase: boolean;
  coinsNeeded: number;
  assetKey: string | null;
  sortOrder: number;
  /** Remote R2 variants when configured; null during local-only rollout. */
  imageSet?: TrackThemeImageSet | null;
  /** Alias to imageSet.preview when R2 is configured. */
  imageUrl?: string | null;
  assetVersion?: number;
  width?: number;
  height?: number;
}

export interface TrackThemesResponse {
  themes: TrackTheme[];
  coinBalance: number;
  /** Persisted user selection from backend (preferred). */
  selectedThemeCode?: string | null;
  /** Global fallback when user has no saved selection. */
  defaultThemeCode?: string | null;
}

interface TrackThemesState {
  themes: TrackTheme[];
  coinBalance: number;
  selectedThemeCode: string;
  defaultThemeCode: string;
  loading: boolean;
  purchaseLoading: string | null; // theme code being purchased
  error: string | null;
  purchaseError: string | null;
}

const initialState: TrackThemesState = {
  themes: [],
  coinBalance: 0,
  selectedThemeCode: "bg",
  defaultThemeCode: "bg",
  loading: false,
  purchaseLoading: null,
  error: null,
  purchaseError: null,
};

/**
 * Auto-select order for race/host UI:
 * 1) selectedThemeCode from GET /api/track-themes
 * 2) defaultThemeCode from the same response
 * 3) equipped theme (older backends)
 * 4) "bg"
 */
export function resolveSelectedThemeCode(payload: TrackThemesResponse): string {
  const selected = String(payload.selectedThemeCode ?? "").trim();
  if (selected) return selected;
  const fallback = String(payload.defaultThemeCode ?? "").trim();
  if (fallback) return fallback;
  const equipped = payload.themes?.find((t) => t.isEquipped)?.code?.trim();
  if (equipped) return equipped;
  return "bg";
}

export const fetchTrackThemes = createAsyncThunk("trackThemes/fetch", async () => {
  const { session } = await getStoredSession();
  if (!session) throw new Error("Not authenticated");
  const res = await fetch(`${API_BASE}/api/track-themes`, {
    headers: { Authorization: `Bearer ${session}` },
  });
  if (!res.ok) throw new Error("Failed to fetch themes");
  return (await res.json()) as TrackThemesResponse;
});

export const purchaseTrackTheme = createAsyncThunk(
  "trackThemes/purchase",
  async (themeCode: string, { rejectWithValue }) => {
    const { session } = await getStoredSession();
    if (!session) return rejectWithValue("Not authenticated");
    const res = await fetch(`${API_BASE}/api/track-themes/${themeCode}/purchase`, {
      method: "POST",
      headers: { Authorization: `Bearer ${session}`, "Content-Type": "application/json" },
    });
    const json = await res.json();
    if (!res.ok)
      return rejectWithValue(
        json.message ?? "Purchase failed",
      );
    return json as { success: boolean; coinBalance: number; theme: TrackTheme };
  },
);

export const equipTrackTheme = createAsyncThunk(
  "trackThemes/equip",
  async (themeCode: string, { rejectWithValue }) => {
    const { session } = await getStoredSession();
    if (!session) return rejectWithValue("Not authenticated");
    const res = await fetch(`${API_BASE}/api/track-themes/${themeCode}/equip`, {
      method: "POST",
      headers: { Authorization: `Bearer ${session}`, "Content-Type": "application/json" },
    });
    if (!res.ok) return rejectWithValue("Failed to equip theme");
    const json = (await res.json().catch(() => null)) as
      | { success?: boolean; equippedCode?: string }
      | null;
    return (json?.equippedCode ?? themeCode).trim() || themeCode;
  },
);

const trackThemesSlice = createSlice({
  name: "trackThemes",
  initialState,
  reducers: {
    selectRaceTheme(state, action: { payload: string }) {
      state.selectedThemeCode = action.payload;
    },
    clearPurchaseError(state) {
      state.purchaseError = null;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchTrackThemes.pending, (state) => {
        state.loading = true;
        state.error = null;
      })
      .addCase(fetchTrackThemes.fulfilled, (state, action) => {
        state.loading = false;
        state.themes = action.payload.themes ?? [];
        state.coinBalance = action.payload.coinBalance ?? 0;
        const defaultCode =
          String(action.payload.defaultThemeCode ?? "").trim() || "bg";
        state.defaultThemeCode = defaultCode;
        state.selectedThemeCode = resolveSelectedThemeCode(action.payload);
      })
      .addCase(fetchTrackThemes.rejected, (state, action) => {
        state.loading = false;
        state.error = action.error.message ?? "Failed";
      })
      .addCase(purchaseTrackTheme.pending, (state, action) => {
        state.purchaseLoading = action.meta.arg;
        state.purchaseError = null;
      })
      .addCase(purchaseTrackTheme.fulfilled, (state, action) => {
        state.purchaseLoading = null;
        state.coinBalance = action.payload.coinBalance;
        const idx = state.themes.findIndex((t) => t.code === action.payload.theme.code);
        if (idx !== -1) {
          state.themes[idx] = action.payload.theme;
        }
      })
      .addCase(purchaseTrackTheme.rejected, (state, action) => {
        state.purchaseLoading = null;
        state.purchaseError = (action.payload as string) ?? "Purchase failed";
      })
      .addCase(equipTrackTheme.fulfilled, (state, action) => {
        state.selectedThemeCode = action.payload;
        state.themes = state.themes.map((t) => ({
          ...t,
          isEquipped: t.code === action.payload,
        }));
      });
  },
});

export const { selectRaceTheme, clearPurchaseError } = trackThemesSlice.actions;
export default trackThemesSlice.reducer;
