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
import { clearActiveSessionMeta, getActiveSessionMeta } from "@/services/authSessionMetadata";
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
        const { getWarmedCachedUser } = await import("@/services/startupWarmup");
        const cachedUser =
          (await getWarmedCachedUser()) ??
          (await storageGet<UserProfile>(STORAGE_KEYS.USER));
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
      const { beginSessionLoginGrace } = await import(
        "@/services/sessionInvalidation"
      );
      beginSessionLoginGrace(15_000);
      // Drop previous account's session id before any authenticated API call
      // so we never send a foreign X-Session-Id as the new user.
      await clearActiveSessionMeta().catch(() => {});
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
      // Don't block the login UI on step bind / session register — grace window
      // already protects against self-kick until meta is written.
      void bindStepSessionToUser(profile.id);
      void registerActiveSession({
        accessToken: sessionJwt,
        userId: profile.id,
      }).catch(() => {
        /* soft-fail — register clears meta instead of storing a fake id */
      });
      // Brief gate so router.replace() can queue before index evaluates auth.
      authTimerRef.current = setTimeout(() => setIsAuthenticating(false), 100);
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

    // Capture refresh before wiping memory so Descope logout can still revoke.
    const priorSession = await getStoredSession().catch(() => ({
      session: null as string | null,
      refresh: null as string | null,
    }));

    // Stop authenticated API traffic as the old user immediately.
    try {
      const { invalidateMemorySession } = require(
        "@/services/authService",
      ) as typeof import("@/services/authService");
      invalidateMemorySession();
    } catch {
      /* ignore */
    }
    try {
      const { setWalkBackendSyncPaused } = require(
        "@/services/walkSyncCoordinator",
      ) as typeof import("@/services/walkSyncCoordinator");
      setWalkBackendSyncPaused(false);
    } catch {
      /* ignore */
    }
    try {
      const { clearUnlimitedClassicProgressBlocks } = require(
        "@/services/unlimitedRaceProgressGuard",
      ) as typeof import("@/services/unlimitedRaceProgressGuard");
      clearUnlimitedClassicProgressBlocks();
    } catch {
      /* ignore */
    }

    setCrashReportingUser(null);
    cancelProactiveTokenRefresh();
    stepPollingService.stopPolling("logout");
    raceStepSyncService.cancelPending();
    // Clear in-memory screen cache so the next user never sees stale data.
    screenCache.clearAll();
    try {
      const { clearHydrationMarks } = require(
        "@/services/loginHydration",
      ) as typeof import("@/services/loginHydration");
      clearHydrationMarks();
    } catch {
      /* ignore */
    }
    try {
      const { clearStartupWarmup } = require(
        "@/services/startupWarmup",
      ) as typeof import("@/services/startupWarmup");
      clearStartupWarmup();
    } catch {
      /* ignore */
    }
    try {
      const { resetSplashWarmup } = require(
        "@/services/startupSplashWarmup",
      ) as typeof import("@/services/startupSplashWarmup");
      resetSplashWarmup();
    } catch {
      /* ignore */
    }
    // Clear in-memory permission *sequencing* only — never revoke OS grants.
    // Soft reset: drop in-progress wizard flags without forcing WearableSetup again.
    // First-launch orchestrator re-queries the OS and skips when already granted.
    try {
      const { resetHomePermissionFlowSoft } = require(
        "@/services/permissions/homePermissionFlow",
      ) as typeof import("@/services/permissions/homePermissionFlow");
      resetHomePermissionFlowSoft();
    } catch {
      try {
        const { resetHomePermissionFlow } = require(
          "@/services/permissions/homePermissionFlow",
        ) as typeof import("@/services/permissions/homePermissionFlow");
        resetHomePermissionFlow();
      } catch {
        /* optional */
      }
    }
    try {
      void import("@/utils/hostedUnlimitedCache")
        .then((m) => m.wipeHostedUnlimitedCacheForAccountSwitch())
        .catch(() => {});
    } catch {
      /* optional */
    }
    try {
      unsubscribeAll();
      disconnectPusher();
    } catch {
      /* ignore */
    }
    void clearPendingMatchPermissionAction().catch(() => {});
    // Capture then clear local session meta immediately so a fast re-login cannot
    // attach this device's old X-Session-Id to the next account.
    const priorMeta = await getActiveSessionMeta().catch(() => null);
    await clearActiveSessionMeta().catch(() => {});
    // Best-effort backend revoke (use captured token + session id).
    void (async () => {
      try {
        const { revokeCurrentSession } = await import("@/services/authSessionService");
        await revokeCurrentSession(priorSession.session, priorMeta?.sessionId);
      } catch {
        /* meta already cleared above */
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
    Promise.resolve()
      .then(() =>
        priorSession.refresh
          ? authLogout(priorSession.refresh)
          : clearSession(),
      )
      .catch(() => clearSession())
      .finally(() => {
        if (__DEV__) console.log("[Auth] logout completed");
      });
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
          const { isSessionLoginGraceActive } = await import(
            "@/services/sessionInvalidation"
          );
          if (isSessionLoginGraceActive()) return;
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
