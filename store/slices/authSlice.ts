import { createSlice, createAsyncThunk, PayloadAction } from "@reduxjs/toolkit";
import {
  signInWithEmail,
  fetchMe,
  refreshSessionSafely,
  logout as doLogout,
  getStoredSession,
  clearSession,
  saveSession,
  validateToken,
  DescopeError,
} from "@/services/authService";
import { dbProfileToUserProfile } from "@/utils/profileMapper";
import type { UserProfile } from "@/store/types";
import { storageGet, storageSet, STORAGE_KEYS } from "@/utils/storage";

// ── State ─────────────────────────────────────────────────────────────────────

interface AuthState {
  isAuthenticated: boolean;
  isLoading: boolean;
  isRestoringSession: boolean;
  sessionToken: string | null;
  refreshToken: string | null;
  user: UserProfile | null;
  error: string | null;
}

const initialState: AuthState = {
  isAuthenticated: false,
  isLoading: false,
  isRestoringSession: true,
  sessionToken: null,
  refreshToken: null,
  user: null,
  error: null,
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function descopeErrorMessage(err: DescopeError): string {
  const desc = err.message.toLowerCase();
  if (
    desc.includes("method") ||
    desc.includes("disabled") ||
    desc.includes("not enabled") ||
    desc.includes("not configured")
  ) {
    return "Password login is not yet set up for your account. Please complete signup first.";
  }
  if (desc.includes("not found") || desc.includes("user does not exist")) {
    return "No account found with this email address.";
  }
  if (desc.includes("locked") || desc.includes("suspended")) {
    return "This account has been suspended. Please contact support.";
  }
  if (desc.includes("verify") || desc.includes("unverified")) {
    return "Please verify your email address before signing in.";
  }
  return "Invalid email or password.";
}

// ── Thunks ────────────────────────────────────────────────────────────────────

export const restoreSession = createAsyncThunk(
  "auth/restoreSession",
  async (_, { rejectWithValue }) => {
    if (__DEV__) console.log("[Auth] bootstrap started");

    const { session, refresh } = await getStoredSession();
    if (!session || !refresh?.trim()) {
      if (__DEV__) console.log("[Auth] no stored session");
      return rejectWithValue("no_session");
    }

    if (__DEV__) console.log("[Auth] stored session found");

    // Load cached user profile from AsyncStorage — used as instant fallback
    // when the network is unavailable during restore (prevents logout on offline start).
    const cachedUser = await storageGet<UserProfile>(STORAGE_KEYS.USER);

    let token = session;
    if (!validateToken(session)) {
      if (__DEV__) console.log("[Auth] access token expired — refreshing via unified manager");
      const outcome = await refreshSessionSafely();
      if (outcome.ok) {
        if (__DEV__) console.log("[Auth] refresh success");
        token = outcome.token;
      } else if (outcome.definitive) {
        // Descope definitively rejected the token (4xx) — real auth failure.
        // refreshSessionSafely() already cleared SecureStore + emitted SESSION_EXPIRED.
        if (__DEV__) console.log("[Auth] session definitively expired");
        return rejectWithValue("refresh_failed_definitive");
      } else {
        // Transient failure: network error, offline, DNS failure, etc.
        // DO NOT clear tokens — keep them so the next authFetch can retry.
        // Restore with the expired token + cached profile; authFetch will
        // refresh on the first API call once connectivity resumes.
        if (__DEV__) console.log("[Auth] transient refresh failure — restoring from cache");
        if (!cachedUser) {
          // No cached profile to fall back on — cannot authenticate without one.
          if (__DEV__) console.log("[Auth] no cached profile — cannot restore offline session");
          return rejectWithValue("refresh_failed_transient_no_cache");
        }
        return { sessionToken: token, refreshToken: refresh, user: cachedUser };
      }
    } else {
      if (__DEV__) console.log("[Auth] access token valid");
    }

    // Fetch fresh profile; fall back to cached profile if the API is unreachable.
    try {
      const raw = await fetchMe(token);
      const user = raw ? dbProfileToUserProfile(raw) : cachedUser;
      if (user) {
        void storageSet(STORAGE_KEYS.USER, user);
      }
      if (__DEV__) console.log("[Auth] session restored");
      return { sessionToken: token, refreshToken: refresh, user };
    } catch {
      if (__DEV__) console.log("[Auth] profile fetch failed — using cached profile");
      return { sessionToken: token, refreshToken: refresh, user: cachedUser };
    }
  },
);

export const signIn = createAsyncThunk(
  "auth/signIn",
  async (
    { email, password }: { email: string; password: string },
    { rejectWithValue },
  ) => {
    try {
      const authData = await signInWithEmail(email, password);
      const raw = await fetchMe(authData.sessionJwt);
      const user = raw ? dbProfileToUserProfile(raw) : null;
      return {
        sessionToken: authData.sessionJwt,
        refreshToken: authData.refreshJwt ?? "",
        user,
        rawProfile: raw,
      };
    } catch (err: unknown) {
      if (err instanceof DescopeError) {
        return rejectWithValue(descopeErrorMessage(err));
      }
      return rejectWithValue("Something went wrong. Please try again.");
    }
  },
);

export const signOut = createAsyncThunk(
  "auth/signOut",
  async (_, { rejectWithValue }) => {
    try {
      const { refresh } = await getStoredSession();
      if (refresh) await doLogout(refresh);
      else await clearSession();
    } catch {
      await clearSession();
    }
  },
);

// ── Slice ─────────────────────────────────────────────────────────────────────

const authSlice = createSlice({
  name: "auth",
  initialState,
  reducers: {
  /** Instant hydrate from AsyncStorage while full restore validates the session. */
    hydrateFromCache(
      state,
      action: PayloadAction<{
        user: UserProfile;
        sessionToken: string;
        refreshToken: string;
      }>,
    ) {
      state.sessionToken = action.payload.sessionToken;
      state.refreshToken = action.payload.refreshToken;
      state.user = action.payload.user;
      state.isAuthenticated = true;
      // isRestoringSession stays true until restoreSession settles.
    },
    // Called directly by AuthContext.login() after signup/social login
    loginSuccess(
      state,
      action: PayloadAction<{
        user: UserProfile;
        sessionToken: string;
        refreshToken: string;
      }>,
    ) {
      state.isAuthenticated = true;
      state.isLoading = false;
      state.sessionToken = action.payload.sessionToken;
      state.refreshToken = action.payload.refreshToken;
      state.user = action.payload.user;
      state.error = null;
    },
    updateUser(state, action: PayloadAction<Partial<UserProfile>>) {
      if (state.user) {
        state.user = { ...state.user, ...action.payload };
      }
    },
    clearError(state) {
      state.error = null;
    },
    // Called when authFetch silently refreshes the access token in the background.
    // Keeps the Redux sessionToken in sync with what's stored in SecureStore.
    sessionTokenUpdated(state, action: PayloadAction<string>) {
      state.sessionToken = action.payload;
    },
    refreshTokenUpdated(state, action: PayloadAction<string>) {
      state.refreshToken = action.payload;
    },
    // Synchronous local logout (no API call)
    localLogout(state) {
      state.isAuthenticated = false;
      state.isRestoringSession = false;
      state.isLoading = false;
      state.sessionToken = null;
      state.refreshToken = null;
      state.user = null;
      state.error = null;
    },
  },
  extraReducers: (builder) => {
    builder
      // restoreSession
      .addCase(restoreSession.pending, (state) => {
        state.isRestoringSession = true;
      })
      .addCase(restoreSession.fulfilled, (state, action) => {
        state.isRestoringSession = false;
        state.sessionToken = action.payload.sessionToken;
        state.refreshToken = action.payload.refreshToken;
        state.user = action.payload.user;
        state.isAuthenticated = !!action.payload.user;
      })
      .addCase(restoreSession.rejected, (state) => {
        state.isRestoringSession = false;
        state.isAuthenticated = false;
      })
      // signIn
      .addCase(signIn.pending, (state) => {
        state.isLoading = true;
        state.error = null;
      })
      .addCase(signIn.fulfilled, (state, action) => {
        state.isLoading = false;
        state.sessionToken = action.payload.sessionToken;
        state.refreshToken = action.payload.refreshToken;
        state.user = action.payload.user;
        state.isAuthenticated = true;
        state.error = null;
      })
      .addCase(signIn.rejected, (state, action) => {
        state.isLoading = false;
        state.error = action.payload as string;
      })
      // signOut
      .addCase(signOut.fulfilled, (state) => {
        state.isAuthenticated = false;
        state.sessionToken = null;
        state.refreshToken = null;
        state.user = null;
        state.error = null;
      })
      .addCase(signOut.rejected, (state) => {
        state.isAuthenticated = false;
        state.sessionToken = null;
        state.refreshToken = null;
        state.user = null;
      });
  },
});

export const authActions = authSlice.actions;
export default authSlice.reducer;
