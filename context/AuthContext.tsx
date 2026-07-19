import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { AppState, AppStateStatus, Platform } from "react-native";
import { useDispatch, useSelector } from "react-redux";
import { store } from "@/store";
import type { AppDispatch, RootState } from "@/store";
import {
  authActions,
  restoreSession,
} from "@/store/slices/authSlice";
import {
  saveSession,
  clearSession,
  getStoredSession,
  getValidSession,
  fetchMe,
  logout as authLogout,
} from "@/services/authService";
import {
  cancelProactiveTokenRefresh,
  scheduleProactiveTokenRefresh,
} from "@/services/tokenRefreshScheduler";
import { dbProfileToUserProfile } from "@/utils/profileMapper";
import type { UserProfile } from "@/store/types";
import { prefetchProfileAvatar } from "@/services/mediaApi";
import { authEvents } from "@/utils/authEvents";
import { screenCache } from "@/utils/screenCache";
import { activeChallengeSync } from "@/services/activeChallengeSync";
import { storageGet, storageSet, storageRemove, STORAGE_KEYS } from "@/utils/storage";
import { perf } from "@/utils/perfLogger";
import { apiFetchAllowed, markApiFetched } from "@/utils/apiRequestCoordinator";
import { dynamicIconService } from "@/services/dynamicIconService";
import { waitForAppStartupReady } from "@/services/appStartup";
import { stepPollingService } from "@/services/StepPollingService";
import { clearStepSessionForLogout, bindStepSessionToUser } from "@/services/stepProgressCoordinator";
import { raceStepSyncService } from "@/services/RaceStepSyncService";
import { setCrashReportingUser } from "@/services/monitoring/sentry";
import { registerActiveSession, validateActiveSession } from "@/services/authSessionService";
import { clearActiveSessionMeta } from "@/services/authSessionMetadata";
import {
  handleSessionInvalidation,
  onSessionInvalidation,
} from "@/services/sessionInvalidation";
import { disconnectPusher, unsubscribeAll } from "@/services/realtimeService";
import { clearPendingMatchPermissionAction } from "@/services/permissions/pendingMatchAction";
import NetInfo from "@react-native-community/netinfo";

export type { UserProfile };

// ── Context interface (unchanged — all existing screens keep working) ─────────

interface AuthContextType {
  user: UserProfile | null;
  sessionToken: string | null;
  loading: boolean;
  login: (user: UserProfile, sessionJwt: string, refreshJwt: string) => Promise<void>;
  logout: () => Promise<void>;
  updateUser: (updates: Partial<UserProfile>) => Promise<void>;
  refreshUserProfile: () => Promise<void>;
  /** True while login() is completing — prevents index.tsx routing races */
  isAuthenticating: boolean;
}

const AuthContext = createContext<AuthContextType | null>(null);

// ── Provider — thin bridge to Redux ──────────────────────────────────────────
// All state lives in the Redux store. This provider just exposes the familiar
// useAuth() hook so that every existing screen continues to work without changes.

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const dispatch = useDispatch<AppDispatch>();

  const user = useSelector((s: RootState) => s.auth.user);
  const sessionToken = useSelector((s: RootState) => s.auth.sessionToken);
  const isRestoringSession = useSelector((s: RootState) => s.auth.isRestoringSession);

  useEffect(() => {
    setCrashReportingUser(user?.id ?? null);
  }, [user?.id]);

  // Held true while login() is completing — gates index.tsx from evaluating
  // routing conditions before the caller's router.replace() has fired.
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const authTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Restore session: hydrate cached profile instantly, then validate in background.
  const authRestoreStartRef = useRef(Date.now());
  useEffect(() => {
    void (async () => {
      const { session, refresh } = await getStoredSession();
      if (session && refresh?.trim()) {
        const cachedUser = await storageGet<UserProfile>(STORAGE_KEYS.USER);
        if (cachedUser) {
          perf.cacheHit("auth_user");
          dispatch(
            authActions.hydrateFromCache({
              user: cachedUser,
              sessionToken: session,
              refreshToken: refresh,
            }),
          );
          if (cachedUser.id && cachedUser.profileImageUrl) {
            prefetchProfileAvatar(cachedUser.id, cachedUser.avatarVersion ?? 0);
          }
        } else {
          perf.cacheMiss("auth_user");
        }
      }
      await dispatch(restoreSession());
      perf.authRestore(Date.now() - authRestoreStartRef.current);
    })();
  }, [dispatch]);

  // Called after signup / social login — state goes directly into Redux
  const login = useCallback(
    async (profile: UserProfile, sessionJwt: string, refreshJwt: string) => {
      if (authTimerRef.current) clearTimeout(authTimerRef.current);
      setIsAuthenticating(true);
      await saveSession(sessionJwt, refreshJwt);
      // Persist profile so restoreSession can use it as an offline fallback on
      // next cold start (prevents logout when the API is unreachable at launch).
      void storageSet(STORAGE_KEYS.USER, profile);
      dispatch(
        authActions.loginSuccess({
          user: profile,
          sessionToken: sessionJwt,
          refreshToken: refreshJwt,
        }),
      );
      if (profile.id && profile.profileImageUrl) {
        prefetchProfileAvatar(profile.id, profile.avatarVersion ?? 0);
      }
      await bindStepSessionToUser(profile.id);
      // Register this installation as the active session (backend revokes siblings when ready).
      void registerActiveSession({
        accessToken: sessionJwt,
        userId: profile.id,
      }).catch(() => {});
      // Give the caller's router.replace() time to be queued before
      // releasing the gate — prevents index.tsx from racing ahead.
      authTimerRef.current = setTimeout(() => setIsAuthenticating(false), 500);
      void waitForAppStartupReady().then(() => {
        dynamicIconService
          .checkAndUpdate({
            userId: profile.id,
            allowApiFetch: Platform.OS === "android",
          })
          .catch(() => {});
      });
    },
    [dispatch],
  );

  const logout = useCallback(async () => {
    if (__DEV__) console.log("[Auth] logout started");
    const userId = user?.id;
    setCrashReportingUser(null);
    cancelProactiveTokenRefresh();
    stepPollingService.stopPolling("logout");
    raceStepSyncService.cancelPending();
    // Clear in-memory screen cache so the next user never sees stale data.
    screenCache.clearAll();
    try {
      unsubscribeAll();
      disconnectPusher();
    } catch {
      /* ignore */
    }
    void clearPendingMatchPermissionAction().catch(() => {});
    // Best-effort backend revoke before clearing local session meta.
    void (async () => {
      try {
        const token = await getStoredSession().then((s) => s.session).catch(() => null);
        const { revokeCurrentSession } = await import("@/services/authSessionService");
        await revokeCurrentSession(token);
      } catch {
        await clearActiveSessionMeta().catch(() => {});
      }
    })();
    activeChallengeSync.clear();
    // Optimistic logout: wipe Redux immediately so the TabLayout Redirect fires
    // right away — the user sees the login screen without any intermediate flash.
    // Native step cleanup + Descope API continue in the background.
    dispatch(authActions.localLogout());
    void clearStepSessionForLogout(userId).catch(() => {});
    void storageRemove(STORAGE_KEYS.USER);
    void storageRemove(STORAGE_KEYS.COIN_BALANCE);
    void storageRemove(STORAGE_KEYS.WALLET);
    void storageRemove(STORAGE_KEYS.TRANSACTIONS);
    dynamicIconService.onLogout().catch(() => {});
    getStoredSession()
      .then(({ refresh }) => (refresh ? authLogout(refresh) : clearSession()))
      .catch(() => clearSession())
      .finally(() => { if (__DEV__) console.log("[Auth] logout completed"); });
  }, [dispatch, user?.id]);

  const updateUser = useCallback(
    async (updates: Partial<UserProfile>) => {
      dispatch(authActions.updateUser(updates));
      const merged = store.getState().auth.user;
      if (merged) {
        void storageSet(STORAGE_KEYS.USER, merged);
      }
    },
    [dispatch],
  );

  // Uses getValidSession() so an expired access token is silently refreshed
  // before fetching the profile — covers foreground/background transitions
  // where the stored token may have expired since last use.
  const refreshUserProfile = useCallback(async () => {
    try {
      const session = await getValidSession();
      if (!session) return;
      const raw = await fetchMe(session);
      if (raw) {
        const mapped = dbProfileToUserProfile(raw);
        dispatch(authActions.updateUser(mapped));
        if (mapped.id && mapped.profileImageUrl) {
          prefetchProfileAvatar(mapped.id, mapped.avatarVersion ?? 0);
        }
      }
    } catch {}
  }, [dispatch]);

  // After session restore completes, schedule proactive token refresh.
  // restoreSession already fetches a fresh profile — skip duplicate refreshUserProfile here.
  const didPostRestoreRef = useRef(false);
  useEffect(() => {
    if (!isRestoringSession) {
      if (!didPostRestoreRef.current) {
        didPostRestoreRef.current = true;
        if (sessionToken) {
          void scheduleProactiveTokenRefresh();
          // Re-bind active session metadata after cold start (backend status when available).
          const uid = store.getState().auth.user?.id;
          if (uid) {
            void registerActiveSession({
              accessToken: sessionToken,
              userId: uid,
            }).catch(() => {});
          }
        }
      }
    } else {
      didPostRestoreRef.current = false;
    }
  }, [isRestoringSession, sessionToken]);

  // When the app comes back to foreground, sync the current user's profile so
  // stale avatarVersion / profileImageUrl values are never displayed.
  // Also revalidate single-active-session status when online (deduped).
  const sessionValidateInFlight = useRef(false);
  const lastSessionValidateAt = useRef(0);
  useEffect(() => {
    const revalidateSession = async () => {
      if (sessionValidateInFlight.current) return;
      if (!store.getState().auth.isAuthenticated) return;
      const now = Date.now();
      if (now - lastSessionValidateAt.current < 15_000) return;
      const net = await NetInfo.fetch().catch(() => null);
      if (net && net.isConnected === false) return;
      sessionValidateInFlight.current = true;
      lastSessionValidateAt.current = now;
      try {
        const token = await getValidSession().catch(() => null);
        if (!token) return;
        const status = await validateActiveSession(token);
        if (status.active === false) {
          await handleSessionInvalidation({
            reason: status.reason,
            sessionId: status.sessionId,
            message: status.message,
          });
        }
      } finally {
        sessionValidateInFlight.current = false;
      }
    };

    const handleAppStateChange = (nextState: AppStateStatus) => {
      if (nextState === "active") {
        void revalidateSession();
        if (!apiFetchAllowed("auth_profile_foreground", 60_000)) {
          perf.apiSkipped("profile_foreground_throttled");
          return;
        }
        markApiFetched("auth_profile_foreground");
        void getValidSession()
          .then(() => refreshUserProfile())
          .catch(() => {});
      }
    };
    const sub = AppState.addEventListener("change", handleAppStateChange);
    const netSub = NetInfo.addEventListener((state) => {
      if (state.isConnected && AppState.currentState === "active") {
        void revalidateSession();
      }
    });
    return () => {
      sub.remove();
      netSub();
    };
  }, [refreshUserProfile]);

  // ── Auth event bus subscriptions ─────────────────────────────────────────
  // authFetch emits SESSION_EXPIRED when both the access token and refresh
  // token are unrecoverable (network error, Descope rejects the refresh, etc.).
  // Calling logout() here wipes the Redux auth state immediately, which causes
  // the Tab layout's Redirect guard to fire and send the user to the login screen.
  //
  // authFetch also emits TOKEN_REFRESHED when it silently exchanges an expired
  // access token for a new one. We sync that new token into Redux so that any
  // code reading sessionToken from context stays accurate.
  useEffect(() => {
    const offExpired = authEvents.onSessionExpired(() => {
      if (__DEV__) console.log("[Auth] session expired event received — forcing logout");
      cancelProactiveTokenRefresh();
      stepPollingService.stopPolling("session_expired");
      raceStepSyncService.cancelPending();
      logout();
      // Professional modal (not Alert) — same host as session-replaced.
      void import("@/services/sessionNoticeBus").then(({ showSessionNotice }) => {
        showSessionNotice({
          reason: "SESSION_EXPIRED",
          message:
            "Your login session has expired. Please sign in again to continue.",
        });
      });
    });
    const offInvalidated = onSessionInvalidation(() => {
      if (__DEV__) console.log("[Auth] session invalidated — forcing logout");
      cancelProactiveTokenRefresh();
      stepPollingService.stopPolling("session_invalidated");
      raceStepSyncService.cancelPending();
      // Modal already shown by handleSessionInvalidation via sessionNoticeBus
      void logout();
    });
    const offRefreshed = authEvents.onTokenRefreshed(async (newToken) => {
      if (__DEV__) console.log("[Auth] token refreshed event received — updating Redux");
      dispatch(authActions.sessionTokenUpdated(newToken));
      const { refresh } = await getStoredSession();
      if (refresh) {
        dispatch(authActions.refreshTokenUpdated(refresh));
      }
      void scheduleProactiveTokenRefresh();
    });
    return () => {
      offExpired();
      offInvalidated();
      offRefreshed();
    };
  }, [logout, dispatch]);

  // Clean up the timer when the provider unmounts
  useEffect(() => {
    return () => {
      if (authTimerRef.current) clearTimeout(authTimerRef.current);
    };
  }, []);

  const value = useMemo(
    () => ({
      user,
      sessionToken,
      loading: isRestoringSession,
      login,
      logout,
      updateUser,
      refreshUserProfile,
      isAuthenticating,
    }),
    [user, sessionToken, isRestoringSession, login, logout, updateUser, refreshUserProfile, isAuthenticating],
  );

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextType {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
