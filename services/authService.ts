import {
  descope,
  isJwtExpired,
  getJwtSecsUntilExpiry,
  getJwtLifetimeSecs,
  JWT_CLOCK_SKEW_SECS,
  SESSION_REFRESH_LEAD_FRACTION,
  getUserIdFromJwt,
  DescopeRestError,
  type JwtResponse,
} from "./descopeClient";
import * as SecureStore from "expo-secure-store";
import * as WebBrowser from "expo-web-browser";
import * as AppleAuthentication from "expo-apple-authentication";
import { Platform } from "react-native";
import { authEvents } from "@/utils/authEvents";
import { timeoutSignal, API_TIMEOUT_MS } from "@/utils/authFetch";

export { getUserIdFromJwt, DescopeRestError as DescopeError };

const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? "";

// ── SecureStore wrapper — falls back to in-memory on web ─────────────────────
const memStore: Record<string, string> = {};
async function secureSet(key: string, value: string) {
  if (Platform.OS === "web") { memStore[key] = value; return; }
  await SecureStore.setItemAsync(key, value);
}
async function secureGet(key: string): Promise<string | null> {
  if (Platform.OS === "web") return memStore[key] ?? null;
  return SecureStore.getItemAsync(key);
}
async function secureDelete(key: string) {
  if (Platform.OS === "web") { delete memStore[key]; return; }
  await SecureStore.deleteItemAsync(key);
}

export const SESSION_KEY = "wc_session";
export const REFRESH_KEY = "wc_refresh";

/**
 * In-memory session mirror — SecureStore remains source of truth on disk.
 * authFetch / high-frequency sync must not hit SecureStore on every call.
 * undefined = not warmed yet; null = explicitly empty after clear/load.
 */
let memSession: string | null | undefined = undefined;
let memRefresh: string | null | undefined = undefined;
let sessionWarmPromise: Promise<{ session: string | null; refresh: string | null }> | null = null;

function setMemorySession(session: string | null, refresh: string | null): void {
  memSession = session;
  memRefresh = refresh;
}

export async function saveSession(sessionToken: string, refreshToken: string) {
  if (!refreshToken?.trim()) {
    if (__DEV__) {
      console.warn(
        "[Auth] saveSession called without refresh JWT — session will expire when access token ends. Check Descope refresh token settings.",
      );
    }
  }
  // Update memory first so concurrent authFetch callers see the new token
  // without waiting for SecureStore I/O.
  setMemorySession(sessionToken, refreshToken?.trim() ? refreshToken : null);
  await Promise.all([
    secureSet(SESSION_KEY, sessionToken),
    refreshToken?.trim() ? secureSet(REFRESH_KEY, refreshToken) : secureDelete(REFRESH_KEY),
  ]);
  if (__DEV__) {
    const mins = Math.round(getJwtSecsUntilExpiry(sessionToken) / 60);
    console.log(`[Auth] session saved — access token ~${mins} min remaining`);
    console.log("[Auth] access token", sessionToken);
    if (refreshToken?.trim()) {
      const refreshDays = getJwtSecsUntilExpiry(refreshToken) / 86400;
      console.log(
        `[Auth] refresh token stored — valid ~${refreshDays >= 1 ? refreshDays.toFixed(1) + " days" : (refreshDays * 24).toFixed(1) + " hours"}`,
      );
    }
  }
  void import("./tokenRefreshScheduler").then((m) =>
    void m.scheduleProactiveTokenRefresh(),
  );
}
export async function clearSession() {
  const { cancelProactiveTokenRefresh } = await import("./tokenRefreshScheduler");
  cancelProactiveTokenRefresh();
  setMemorySession(null, null);
  sessionWarmPromise = null;
  await Promise.all([secureDelete(SESSION_KEY), secureDelete(REFRESH_KEY)]);
}
export async function getStoredSession() {
  // Fast path: warmed memory (including explicit nulls after logout).
  if (memSession !== undefined && memRefresh !== undefined) {
    try {
      const { perf } = require("@/utils/perfLogger") as typeof import("@/utils/perfLogger");
      perf.secureStoreRead("memory");
    } catch {
      /* perf optional */
    }
    return { session: memSession, refresh: memRefresh };
  }

  // Single-flight warm from SecureStore on cold start / first access.
  if (!sessionWarmPromise) {
    sessionWarmPromise = (async () => {
      try {
        const { perf } = require("@/utils/perfLogger") as typeof import("@/utils/perfLogger");
        perf.secureStoreRead("disk");
      } catch {
        /* perf optional */
      }
      const [session, refresh] = await Promise.all([
        secureGet(SESSION_KEY),
        secureGet(REFRESH_KEY),
      ]);
      setMemorySession(session, refresh);
      return { session, refresh };
    })().finally(() => {
      sessionWarmPromise = null;
    });
  }
  return sessionWarmPromise;
}

// ── Errors ───────────────────────────────────────────────────────────────────
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

// ── Signup OTP flow (new architecture) ───────────────────────────────────────
// Step 1 of signup: send OTP to email.
// Uses signUpOrIn so returning users who abandoned onboarding, or users who
// accidentally tap Sign Up, are not blocked with "account already exists".
// Profile state is checked after OTP verification to decide next routing.
export async function sendSignupOtp(email: string): Promise<void> {
  await descope.otp.signUpOrIn.email(email);
}

// Step 2 of signup: verify OTP. Returns session JWT stored only in component
// state — NOT saved to SecureStore until the full signup is done (password set
// + NeonDB profile created).
export async function verifySignupOtp(
  email: string,
  code: string,
): Promise<JwtResponse> {
  return descope.otp.verify.email(email, code);
}

// setPasswordForVerifiedUser is intentionally removed.
// Password setting must go through the backend (POST /api/auth/complete-signup)
// which uses the Descope management key. The frontend cannot call
// /v1/auth/password/set directly — it requires the management key, not just a
// session JWT. Use completeSignup() below instead.

// ── Email / Password (login) ──────────────────────────────────────────────────
// Proxied through our backend so refreshJwt is always in the JSON body.
// Direct Descope REST from React Native can miss refreshJwt when Descope only
// sets it as an HttpOnly cookie — leaving users logged out after ~10 minutes.
export async function signInWithEmail(
  email: string,
  password: string,
): Promise<JwtResponse> {
  const res = await fetch(`${API_BASE}/api/auth/password/signin`, {
    method: "POST",
    signal: timeoutSignal(API_TIMEOUT_MS),
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ loginId: email.trim().toLowerCase(), password }),
  });
  const body = (await res.json().catch(() => ({}))) as JwtResponse & {
    message?: string;
    error?: string;
  };
  if (!res.ok) {
    throw new DescopeRestError(
      body.message ?? body.error ?? "Invalid email or password",
      body.error ?? String(res.status),
      res.status,
    );
  }
  const data = normalizeJwtResponse(body);
  if (!data.refreshJwt?.trim() && __DEV__) {
    console.warn(
      "[Auth] sign-in succeeded but no refresh JWT returned — user will be logged out when the 10-minute session token expires. Check Descope Session Management settings.",
    );
  }
  await saveSession(data.sessionJwt, data.refreshJwt ?? "");
  return data;
}

// Reads the redirect URL from env, or derives it from the web app origin.
function getWebOrigin(): string {
  const webUrl = process.env.EXPO_PUBLIC_WEB_URL ?? "";
  if (webUrl) return webUrl.replace(/\/$/, "");
  if (Platform.OS === "web" && typeof window !== "undefined") {
    return window.location.origin;
  }
  return "";
}

const APP_DEEP_LINK_SCHEME = "globalwalkerleague";

function getResetRedirectUrl(): string {
  if (process.env.EXPO_PUBLIC_PASSWORD_RESET_REDIRECT_URL?.trim()) {
    return process.env.EXPO_PUBLIC_PASSWORD_RESET_REDIRECT_URL.trim();
  }

  // Native: use the live API host as an HTTPS bridge (email → browser → app deep link).
  // Do NOT use EXPO_PUBLIC_WEB_URL here — walkchamp.app may not have DNS yet.
  if (Platform.OS !== "web") {
    const apiBase = (process.env.EXPO_PUBLIC_API_URL ?? "").replace(/\/$/, "");
    if (apiBase) return `${apiBase}/api/auth/reset-password/open`;
    return `${APP_DEEP_LINK_SCHEME}://reset-password`;
  }

  if (typeof window !== "undefined" && window.location?.origin) {
    return `${window.location.origin.replace(/\/$/, "")}/reset-password`;
  }
  const origin = getWebOrigin();
  if (origin) return `${origin}/reset-password`;

  const apiBase = (process.env.EXPO_PUBLIC_API_URL ?? "").replace(/\/$/, "");
  if (apiBase) return `${apiBase}/api/auth/reset-password/open`;
  return `${APP_DEEP_LINK_SCHEME}://reset-password`;
}

export async function sendPasswordResetEmail(email: string): Promise<void> {
  const redirectUrl = getResetRedirectUrl();
  if (!redirectUrl) {
    throw new Error("Password reset redirect URL is not configured.");
  }
  if (__DEV__) console.log("[Auth] password reset redirectUrl:", redirectUrl);
  await descope.password.sendReset(email, redirectUrl);
}

// Complete the password reset entirely via the backend:
//   1. Backend verifies the magic-link token (uses real DESCOPE_PROJECT_ID)
//   2. Backend sets the new password via the Descope management API
// This avoids any EXPO_PUBLIC_ env-var issues that would cause
// "Request project is invalid or missing" errors on the frontend.
export async function completePasswordReset(
  token: string,
  newPassword: string,
): Promise<void> {
  const res = await fetch(`${API_BASE}/api/auth/reset-password/complete`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, newPassword }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
    throw new Error(body.message ?? body.error ?? `HTTP ${res.status}`);
  }
}

// ── OTP Email (legacy / post-signup verification) ────────────────────────────
export async function sendEmailOTP(email: string): Promise<void> {
  await descope.otp.signIn.email(email);
}

export async function verifyEmailOTP(
  email: string,
  code: string,
): Promise<JwtResponse> {
  const data = normalizeJwtResponse(await descope.otp.verify.email(email, code));
  await saveSession(data.sessionJwt, data.refreshJwt ?? "");
  return data;
}

// ── Session ───────────────────────────────────────────────────────────────────
export async function refreshSession(refreshToken: string): Promise<string> {
  const res = await fetch(`${API_BASE}/api/auth/session/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refreshJwt: refreshToken }),
  });
  const body = (await res.json().catch(() => ({}))) as JwtResponse & {
    message?: string;
    error?: string;
  };
  if (!res.ok) {
    throw new DescopeRestError(
      body.message ?? body.error ?? "Session refresh failed",
      body.error ?? String(res.status),
      res.status,
    );
  }
  const data = normalizeJwtResponse(body);
  const newSession = data.sessionJwt;
  // Use the new rotating refresh token returned by Descope; fall back to the
  // existing one only if Descope didn't return a new one (non-rotating config).
  const newRefresh = data.refreshJwt ?? refreshToken;
  await saveSession(newSession, newRefresh);
  if (__DEV__) console.log("[Auth] token storage updated");
  return newSession;
}

/** Normalize Descope auth responses — field names vary by endpoint/version. */
function normalizeJwtResponse(data: JwtResponse): JwtResponse {
  const pickJwt = (value: unknown): string | undefined => {
    if (typeof value === "string" && value.trim()) return value;
    if (value && typeof value === "object" && "jwt" in value) {
      const jwt = (value as { jwt?: unknown }).jwt;
      if (typeof jwt === "string" && jwt.trim()) return jwt;
    }
    return undefined;
  };

  const sessionJwt =
    pickJwt(data.sessionJwt) ??
    pickJwt((data as unknown as Record<string, unknown>).sessionToken) ??
    "";
  const refreshJwt =
    pickJwt(data.refreshJwt) ??
    pickJwt((data as unknown as Record<string, unknown>).refreshSessionJwt) ??
    pickJwt((data as unknown as Record<string, unknown>).refreshToken);

  return { ...data, sessionJwt, refreshJwt };
}

/**
 * Computes the proactive-refresh lead time (seconds) from the token's own
 * iat/exp claims — the values Descope stores in every JWT based on your
 * Project → Session Management settings.
 *
 * Formula: SESSION_REFRESH_LEAD_FRACTION (5 %) of the total token lifetime,
 * floored at JWT_CLOCK_SKEW_SECS so we never refresh less aggressively than
 * the clock-skew guard.
 *
 * Examples (using the Descope defaults shown in the console):
 *   Session Token = 1 day  (86 400 s) → buffer = 4 320 s  (~72 min)
 *   Session Token = 1 hour  (3 600 s) → buffer =   180 s  ( ~3 min)
 *   Session Token = 10 min    (600 s) → buffer =    60 s  (clock-skew floor)
 *
 * No hardcoded duration is needed — changing the Descope console setting
 * automatically changes the `exp`/`iat` gap in every new JWT.
 */
export function getRefreshLeadSecs(token: string): number {
  const lifetime = getJwtLifetimeSecs(token);
  if (lifetime <= 0) return JWT_CLOCK_SKEW_SECS; // malformed token — use floor
  return Math.max(JWT_CLOCK_SKEW_SECS, Math.floor(lifetime * SESSION_REFRESH_LEAD_FRACTION));
}

export function validateToken(token: string): boolean {
  // Refresh proactively when SESSION_REFRESH_LEAD_FRACTION of the token's
  // configured lifetime remains.  The threshold is derived entirely from the
  // JWT's own iat/exp — no hardcoded session durations.
  return !isJwtExpired(token) && getJwtSecsUntilExpiry(token) > getRefreshLeadSecs(token);
}

// ── Unified Refresh Manager ───────────────────────────────────────────────────
// Single concurrency-safe refresh queue used by getValidSession(), authFetch's
// 401-recovery path, and restoreSession (app-launch restore).
//
// Rules:
//   • Only one Descope /auth/refresh request is in flight at any time.
//   • Concurrent callers join the same promise — they receive the same outcome.
//   • Definitive failure (Descope 4xx / no refresh token) → clear SecureStore
//     + emit SESSION_EXPIRED. Caller receives ok:false, definitive:true.
//   • Transient failure (network error / timeout / offline) → keep tokens in
//     SecureStore. Caller receives ok:false, definitive:false. User stays logged
//     in; next authFetch will retry the refresh automatically.

export type RefreshOutcome =
  | { ok: true; token: string }
  | { ok: false; definitive: boolean };

let _refreshInFlight = false;
let _refreshPromise: Promise<RefreshOutcome> | null = null;

export async function refreshSessionSafely(): Promise<RefreshOutcome> {
  if (_refreshInFlight && _refreshPromise) {
    if (__DEV__) console.log("[Auth] refresh joined existing request");
    return _refreshPromise;
  }
  _refreshInFlight = true;
  if (__DEV__) console.log("[Auth] refresh started");
  _refreshPromise = _executeRefresh().finally(() => {
    _refreshInFlight = false;
    _refreshPromise = null;
  });
  return _refreshPromise;
}

async function _executeRefresh(): Promise<RefreshOutcome> {
  try {
    const { refresh } = await getStoredSession();
    if (!refresh?.trim()) {
      if (__DEV__) console.log("[Auth] refresh failed — no refresh token stored");
      await clearSession();
      authEvents.emitSessionExpired();
      return { ok: false, definitive: true };
    }
    // Validate the refresh JWT client-side before hitting Descope.
    // If the stored "refresh" token is actually the short-lived session JWT
    // (a known storage bug symptom), its exp will already be past → we
    // diagnose and bail immediately rather than letting Descope return E011002.
    const refreshSecsLeft = getJwtSecsUntilExpiry(refresh);
    if (__DEV__) {
      const daysLeft = refreshSecsLeft / 86400;
      if (daysLeft < 1) {
        console.log(
          "[Auth] WARNING: stored refresh token expires in",
          (refreshSecsLeft / 3600).toFixed(1),
          "hours — may be session JWT stored as refresh JWT",
        );
      } else {
        console.log("[Auth] refresh token valid for", daysLeft.toFixed(1), "days");
      }
    }
    if (refreshSecsLeft <= 0) {
      // The stored "refresh" token has already expired as a JWT.
      // This is a definitive failure — the user must re-authenticate.
      if (__DEV__) console.log("[Auth] refresh token is expired (exp in the past) — clearing session");
      await clearSession();
      authEvents.emitSessionExpired();
      return { ok: false, definitive: true };
    }

    const token = await refreshSession(refresh);
    if (__DEV__) console.log("[Auth] refresh success");
    authEvents.emitTokenRefreshed(token);
    return { ok: true, token };
  } catch (err) {
    if (err instanceof DescopeRestError) {
      // 5xx = Descope server error / outage — transient, keep session.
      if (err.httpStatus >= 500) {
        if (__DEV__) console.log("[Auth] refresh failed — Descope server error", err.httpStatus, "— keeping session");
        return { ok: false, definitive: false };
      }
      // 429 = rate-limited — transient, keep session.
      if (err.httpStatus === 429) {
        if (__DEV__) console.log("[Auth] refresh rate-limited by Descope — keeping session");
        return { ok: false, definitive: false };
      }
      // 4xx = refresh token invalid or session window expired — definitive.
      // This happens when:
      //   a) the Descope session timeout has been exceeded (user must re-login), OR
      //   b) the refresh token was revoked.
      // The Descope error message tells us which:
      if (__DEV__) console.log(
        "[Auth] refresh definitively rejected by Descope",
        err.httpStatus, err.code,
        // Print the human-readable description so the cause is visible in logs
        "—", err.message,
      );
      await clearSession();
      authEvents.emitSessionExpired();
      return { ok: false, definitive: true };
    }
    // AbortError = our 15 s timeout fired — transient.
    // Network error, DNS failure, etc. — also transient.
    // Preserve tokens — do NOT log the user out.
    if (__DEV__) console.log("[Auth] refresh failed transiently (network/timeout/abort) — keeping session");
    return { ok: false, definitive: false };
  }
}

/**
 * Returns a valid (non-expired) session JWT, auto-refreshing if needed.
 * Returns null when no valid session is available (not logged in or refresh
 * also failed). Uses the unified refreshSessionSafely() so there is only ever
 * one refresh request in flight across the entire app.
 */
export async function getValidSession(): Promise<string | null> {
  const { session, refresh } = await getStoredSession();
  if (!session) return null;
  if (validateToken(session)) return session;
  if (!refresh?.trim()) {
    if (__DEV__) console.log("[Auth] access token expired and no refresh JWT stored");
    await clearSession();
    authEvents.emitSessionExpired();
    return null;
  }
  const outcome = await refreshSessionSafely();
  if (outcome.ok) return outcome.token;
  // Transient failure (offline / timeout) — keep user logged in with stale token.
  // authFetch will retry refresh on the next API call.
  if (!outcome.definitive) {
    if (__DEV__) console.log("[Auth] refresh transiently failed — keeping stale session");
    return session;
  }
  return null;
}

export async function logout(refreshToken: string): Promise<void> {
  await descope.logout(refreshToken).catch(() => {});
  await clearSession();
}

// ── Native Apple Sign-In (iOS only) ──────────────────────────────────────────
// Uses expo-apple-authentication to get an Apple identityToken, then sends it
// to POST /api/auth/apple/native for cryptographic verification + Descope session.
// No nonce round-trip needed — the backend verifies the JWT signature directly.
export async function signInWithAppleNative(): Promise<JwtResponse> {
  if (__DEV__) console.log("[AppleSignIn] started");

  // Step 1: trigger native Apple Sign-In sheet
  let credential: AppleAuthentication.AppleAuthenticationCredential;
  try {
    credential = await AppleAuthentication.signInAsync({
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
    });
    if (__DEV__) console.log("[AppleSignIn] credential received");
  } catch (err: unknown) {
    const code = (err as { code?: string }).code;
    if (code === "ERR_REQUEST_CANCELED") {
      if (__DEV__) console.log("[AppleSignIn] cancelled by user");
      throw new Error("Apple sign-in was cancelled.");
    }
    throw new Error("Apple Sign-In failed. Please try again.");
  }

  const { identityToken, authorizationCode, fullName, email } = credential;
  if (!identityToken) throw new Error("Apple Sign-In failed: no identity token returned.");

  // Build user name from Apple's first-login-only fullName grant
  const name =
    fullName?.givenName || fullName?.familyName
      ? [fullName.givenName, fullName.familyName].filter(Boolean).join(" ")
      : null;

  // Step 2: send Apple credential to backend — backend verifies JWT + creates session
  const res = await fetch(`${API_BASE}/api/auth/apple/native`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      identityToken,
      authorizationCode: authorizationCode ?? undefined,
      user: { name, email: email ?? null },
    }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { message?: string };
    throw new Error(body.message ?? "Unable to sign in with Apple right now. Please try again.");
  }

  const authData = (await res.json()) as JwtResponse;
  await saveSession(authData.sessionJwt, authData.refreshJwt ?? "");
  if (__DEV__) console.log("[AppleSignIn] session stored");
  return authData;
}

// Returns true if native Apple Sign-In is available on this device (iOS 13+)
export async function isAppleSignInAvailable(): Promise<boolean> {
  if (Platform.OS !== "ios") return false;
  try {
    return await AppleAuthentication.isAvailableAsync();
  } catch {
    return false;
  }
}

// ── Social / OAuth login (Google + Apple via Descope) ─────────────────────────
// All OAuth calls are proxied through the backend so DESCOPE_PROJECT_ID is
// never needed in the Expo bundle (avoids "Request project is invalid" errors).
//
// Provider identifiers must match the Descope OAuthProviders enum exactly:
//   google = "google" | apple = "apple"
const SOCIAL_PROVIDERS = {
  google: "google",
  apple: "apple",
} as const;

function getOAuthCallbackUrl(): string {
  if (Platform.OS !== "web") {
    // Native: deep-link scheme — the OS intercepts this and closes the browser.
    return "globalwalkerleague://auth-callback";
  }
  // Web: must be an actual URL on the same origin so the popup can load it.
  const origin = getWebOrigin();
  if (origin) return `${origin}/auth-callback`;
  return `${API_BASE}/auth-callback`;
}

export async function signInWithProvider(
  provider: "google" | "apple",
): Promise<JwtResponse> {
  const redirectUrl = getOAuthCallbackUrl();
  // Use the canonical Descope provider identifier (matches OAuthProviders enum)
  const descopeProvider = SOCIAL_PROVIDERS[provider];
  const providerLabel = provider === "google" ? "Google" : "Apple";

  // Step 1: get the Descope OAuth URL from the backend
  // (DESCOPE_PROJECT_ID stays server-side — never exposed to the bundle)
  if (__DEV__) console.log(`[social-login] starting ${descopeProvider} OAuth, redirectUrl=${redirectUrl}`);
  const startRes = await fetch(`${API_BASE}/api/auth/oauth/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ provider: descopeProvider, redirectUrl }),
  });
  if (!startRes.ok) {
    const body = (await startRes.json().catch(() => ({}))) as { message?: string; error?: string };
    const msg = body.message ?? body.error ?? "";
    if (__DEV__) console.warn(`[social-login] start failed (status=${startRes.status}): ${msg}`);
    // E062202 = "Invalid OAuth provider" — provider not enabled in Descope Console
    throw new Error(`${providerLabel} login is not configured in Descope. Please enable ${providerLabel} provider.`);
  }
  const { url } = (await startRes.json()) as { url: string };
  if (__DEV__) console.log(`[social-login] received OAuth URL, opening browser`);

  // Step 2: open the OAuth URL in the system browser
  // Native: SFAuthenticationSession / Chrome Custom Tab intercepts the deep-link scheme.
  // Web: openAuthSessionAsync monitors for the redirect URL in the popup window;
  //      auth-callback.tsx MUST call WebBrowser.maybeCompleteAuthSession() for this to work.
  const result = await WebBrowser.openAuthSessionAsync(url, redirectUrl);
  if (__DEV__) console.log(`[social-login] browser result type=${result.type}`);

  if (result.type !== "success") {
    if (result.type === "cancel" || result.type === "dismiss") {
      throw new Error(`${providerLabel} sign-in was cancelled.`);
    }
    throw new Error(`Unable to complete ${providerLabel} login. Please try again.`);
  }

  // Step 3: extract the Descope authorization code from the callback URL
  // Descope appends ?code=<authorization-code> after the user authenticates
  const codeMatch = result.url.match(/[?&]code=([^&]+)/);
  if (__DEV__) console.log(`[social-login] callback received, code present=${!!codeMatch}`);
  if (!codeMatch) {
    // Check for error in the callback URL
    const errMatch = result.url.match(/[?&]error=([^&]+)/);
    const errDesc = errMatch ? decodeURIComponent(errMatch[1]) : "no authorization code";
    throw new Error(`${providerLabel} login failed: ${errDesc}.`);
  }
  const code = decodeURIComponent(codeMatch[1]);

  // Step 4: exchange the Descope code for a session JWT via the backend
  // The backend calls client.oauth.exchange(code) and returns { sessionJwt, refreshJwt, user }
  if (__DEV__) console.log(`[social-login] exchanging code with backend`);
  const exchangeRes = await fetch(`${API_BASE}/api/auth/oauth/exchange`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code }),
  });
  if (!exchangeRes.ok) {
    const body = (await exchangeRes.json().catch(() => ({}))) as { message?: string; error?: string };
    const msg = body.message ?? body.error ?? "";
    if (__DEV__) console.warn(`[social-login] exchange failed: ${msg}`);
    throw new Error(`Unable to complete ${providerLabel} login. Please try again.`);
  }
  if (__DEV__) console.log(`[social-login] exchange succeeded`);
  const authData = (await exchangeRes.json()) as JwtResponse;
  await saveSession(authData.sessionJwt, authData.refreshJwt ?? "");
  return authData;
}

// ── Authenticated backend requests ────────────────────────────────────────────
// Always send the real Descope session JWT — NEVER the project ID.
function authHeaders(sessionJwt: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${sessionJwt}`,
  };
}

// ── Complete signup (set password + create NeonDB profile) ────────────────────
// Single backend call that:
//   1. Resolves the user's email from Descope using the management key
//   2. Sets the password in Descope (password NEVER stored in NeonDB)
//   3. Creates the profile row in NeonDB
// Requires the OTP session JWT from the verify step.
export interface CompleteSignupPayload {
  password: string;
  fullName: string;
  username: string;
  dateOfBirth: string;
  country: string;
  countryCode: string;
  countryFlag: string;
  region?: string;
  referredBy?: string;
  avatarColor: string;
  termsAccepted: boolean;
  privacyAccepted: boolean;
  rewardDisclaimerAccepted: boolean;
  marketingOptIn: boolean;
}

export async function completeSignup(
  payload: CompleteSignupPayload,
  sessionJwt: string,
): Promise<DbProfile> {
  const res = await fetch(`${API_BASE}/api/auth/complete-signup`, {
    method: "POST",
    headers: authHeaders(sessionJwt),
    body: JSON.stringify(payload),
  });
  const data = (await res.json()) as { error?: string; profile?: DbProfile };
  if (!res.ok) throw new ApiError(data.error ?? "Failed to complete signup", res.status);
  return data.profile as DbProfile;
}

// ── Profile API ───────────────────────────────────────────────────────────────
export type DbProfile = Record<string, unknown> & {
  id: string;
  email: string;
  account_status?: string;
  accountStatus?: string;
};

export interface CreateProfilePayload {
  descopeUserId: string;
  email: string;
  fullName: string;
  username: string;
  dateOfBirth: string;
  country: string;
  countryCode: string;
  countryFlag: string;
  region?: string;
  referredBy?: string;
  authProvider: string;
  avatarColor: string;
  termsAccepted: boolean;
  privacyAccepted: boolean;
  rewardDisclaimerAccepted: boolean;
  marketingOptIn: boolean;
}

// POST /api/auth/profile — requires Descope session JWT
export async function createProfile(
  payload: CreateProfilePayload,
  sessionJwt: string,
): Promise<DbProfile> {
  const res = await fetch(`${API_BASE}/api/auth/profile`, {
    method: "POST",
    headers: authHeaders(sessionJwt),
    body: JSON.stringify(payload),
  });
  const data = (await res.json()) as { error?: string; profile?: DbProfile };
  if (!res.ok) throw new ApiError(data.error ?? "Failed to create profile", res.status);
  return data.profile as DbProfile;
}

// GET /api/me — returns profile for the JWT owner, or null if no profile
export async function fetchMe(sessionJwt: string): Promise<DbProfile | null> {
  const res = await fetch(`${API_BASE}/api/me`, {
    signal: timeoutSignal(API_TIMEOUT_MS),
    headers: { Authorization: `Bearer ${sessionJwt}` },
  });
  if (res.status === 404) return null;
  const data = (await res.json()) as {
    error?: string;
    profile?: DbProfile;
    profile_completed?: boolean;
  };
  if (!res.ok) throw new ApiError(data.error ?? "Failed to fetch profile", res.status);
  if (data.profile_completed === false && !data.profile) return null;
  return (data.profile as DbProfile) ?? null;
}

// GET /api/auth/profile/:userId — unauthenticated internal lookup
export async function fetchProfile(userId: string): Promise<DbProfile | null> {
  const res = await fetch(`${API_BASE}/api/auth/profile/${userId}`);
  if (res.status === 404) return null;
  const data = (await res.json()) as { error?: string; profile?: DbProfile };
  if (!res.ok) throw new ApiError(data.error ?? "Failed to fetch profile", res.status);
  return data.profile ?? null;
}

export async function checkUsernameAvailable(
  username: string,
): Promise<{ available: boolean; reason?: string }> {
  const res = await fetch(
    `${API_BASE}/api/auth/username-check?username=${encodeURIComponent(username)}`,
  );
  return res.json() as Promise<{ available: boolean; reason?: string }>;
}
