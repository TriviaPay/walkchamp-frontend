import { decode } from "base-64";

const PROJECT_ID = process.env.EXPO_PUBLIC_DESCOPE_PROJECT_ID ?? "";

if (!PROJECT_ID) {
  console.warn("[Descope] EXPO_PUBLIC_DESCOPE_PROJECT_ID is not set — auth will not work");
}

export interface JwtResponse {
  sessionJwt: string;
  refreshJwt?: string;
  user?: {
    loginIds?: string[];
    name?: string;
    email?: string;
    phone?: string;
    verifiedEmail?: boolean;
    userId?: string;
  };
}

interface DescopeApiError {
  errorCode: string;
  errorDescription: string;
  errorMessage?: string;
}

// Descope REST API conventions:
// - Public calls (signup/signin/OTP):   Authorization: Bearer {projectId}
//   The project ID is Descope's way of identifying your project for unauthenticated calls.
// - Session-bound calls (password.set, refresh, logout):
//   Authorization: Bearer {sessionJwt}  — real user JWT replaces the project ID.
// 15-second timeout for all Descope API calls.
// Without this, a slow/hung request holds the single-flight refresh lock forever.
const DESCOPE_TIMEOUT_MS = 15_000;

async function descopePost<T>(
  path: string,
  body: unknown,
  sessionJwt?: string,
): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${PROJECT_ID}`,
  };

  // Descope's API requires: Bearer {projectId}{jwt} — the project ID is always
  // prepended to the token (no separator). Without it, Descope cannot route the
  // request to the correct project and returns E011002 "missing required arguments".
  if (sessionJwt) {
    headers["Authorization"] = `Bearer ${PROJECT_ID}${sessionJwt}`;
  }

  const ctrl = new AbortController();
  const timeoutId = setTimeout(() => ctrl.abort(), DESCOPE_TIMEOUT_MS);

  if (__DEV__) console.log("[Descope] →", path, sessionJwt ? "(authed)" : "(public)");

  let res: Response;
  try {
    res = await fetch(`https://api.descope.com${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }

  const data = (await res.json()) as T & {
    errorCode?: string;
    errorDescription?: string;
  };

  if (!res.ok) {
    const err = data as unknown as DescopeApiError;
    if (__DEV__) console.log("[Descope] ✗", path, res.status, err.errorCode, "—", err.errorDescription);
    throw new DescopeRestError(
      err.errorDescription ?? "Descope request failed",
      err.errorCode ?? String(res.status),
      res.status,
    );
  }

  if (__DEV__) console.log("[Descope] ✓", path, res.status);
  return data;
}

export class DescopeRestError extends Error {
  constructor(
    message: string,
    public code: string,
    /** The raw HTTP status code from Descope's API response. */
    public httpStatus: number,
  ) {
    super(message);
    this.name = "DescopeRestError";
  }
}

export const descope = {
  password: {
    // Signup with email + password (creates new Descope user)
    signUp: (loginId: string, password: string) =>
      descopePost<JwtResponse>("/v1/auth/password/signup", { loginId, password }),

    // Sign in with email + password
    signIn: (loginId: string, password: string) =>
      descopePost<JwtResponse>("/v1/auth/password/signin", { loginId, password }),

    // Set password for an OTP-verified user (password stored ONLY in Descope)
    // Requires the session JWT from OTP verification as the auth bearer.
    setForUser: (sessionJwt: string, loginId: string, newPassword: string) =>
      descopePost<Record<string, unknown>>(
        "/v1/auth/password/set",
        { loginId, newPassword },
        sessionJwt,
      ),

    // Send a password reset email. redirectUrl is where Descope links the user
    // (your /reset-password screen). Descope appends ?t=TOKEN&loginId=EMAIL.
    sendReset: (loginId: string, redirectUrl: string) =>
      descopePost<Record<string, never>>("/v1/auth/password/reset", {
        loginId,
        redirectUrl,
      }),

    // Update password for a user. bearerJwt must be the refresh JWT returned
    // by magicLink.verify() — Descope's own SDK (Python/Go/Java) uses the
    // refresh JWT, not the session JWT, for this endpoint.
    update: (loginId: string, newPassword: string, bearerJwt: string) =>
      descopePost<Record<string, never>>(
        "/v1/auth/password/update",
        { loginId, newPassword },
        bearerJwt,
      ),
  },

  // Verify a magic link token (Descope password reset emails send magic-link
  // tokens that must be exchanged for a session JWT before any further calls).
  magicLink: {
    verify: (token: string) =>
      descopePost<JwtResponse>("/v1/auth/magiclink/verify", { token }),
  },

  otp: {
    // Send OTP to new user email during signup
    signUp: {
      email: (loginId: string) =>
        descopePost<Record<string, never>>("/v1/auth/otp/signup/email", { loginId }),
    },
    // Send OTP to existing user email during signin
    signIn: {
      email: (loginId: string) =>
        descopePost<Record<string, never>>("/v1/auth/otp/signin/email", { loginId }),
    },
    // Send OTP to email for either a new or existing user (Descope handles both).
    // Use this for signup so returning users aren't blocked — profile state is
    // checked after OTP verification to decide next routing.
    signUpOrIn: {
      email: (loginId: string) =>
        descopePost<Record<string, never>>("/v1/auth/otp/signup-in/email", { loginId }),
    },
    // Verify OTP for both signup and signin
    verify: {
      email: (loginId: string, code: string) =>
        descopePost<JwtResponse>("/v1/auth/otp/verify/email", { loginId, code }),
    },
  },

  // Refresh session using the long-lived refresh JWT
  refresh: (refreshJwt: string) =>
    descopePost<JwtResponse>("/v1/auth/refresh", {}, refreshJwt),

  // Invalidate the session on Descope's side
  logout: (refreshJwt: string) =>
    descopePost<Record<string, never>>("/v1/auth/logout", {}, refreshJwt),
};

// ── JWT helpers (Hermes-compatible — uses base-64, not atob) ──────────────────

function decodeJwtPayload(token: string): Record<string, unknown> {
  const part = token.split(".")[1];
  if (!part) throw new Error("Invalid JWT");
  // base64url → base64: replace URL-safe chars back to standard base64
  const base64 = part.replace(/-/g, "+").replace(/_/g, "/");
  return JSON.parse(decode(base64)) as Record<string, unknown>;
}

/**
 * Network + clock-skew guard (seconds).
 * A token technically valid for this many more seconds may still be rejected
 * by the server due to clock drift or in-flight latency.  This is a protocol
 * constant, not a business session-duration value.
 */
export const JWT_CLOCK_SKEW_SECS = 60;

/**
 * What fraction of a token's total lifetime to use as the proactive-refresh
 * lead time.  E.g. 0.05 → refresh when 5 % of lifetime remains.
 * Kept here so both descopeClient and authService share one source of truth.
 */
export const SESSION_REFRESH_LEAD_FRACTION = 0.05;

export function isJwtExpired(token: string): boolean {
  try {
    const payload = decodeJwtPayload(token);
    return Date.now() / 1000 + JWT_CLOCK_SKEW_SECS > (payload.exp as number);
  } catch {
    return true;
  }
}

/**
 * Returns how many seconds until the JWT expires (negative = already expired).
 * Returns -Infinity if the token is malformed.
 */
export function getJwtSecsUntilExpiry(token: string): number {
  try {
    const payload = decodeJwtPayload(token);
    return (payload.exp as number) - Date.now() / 1000;
  } catch {
    return -Infinity;
  }
}

/**
 * Returns the total configured lifetime of this JWT in seconds (exp − iat).
 * This reflects whatever session duration is set in the Descope console —
 * no hardcoded value needed.  Returns -Infinity if the token is malformed
 * or missing the iat claim.
 */
export function getJwtLifetimeSecs(token: string): number {
  try {
    const payload = decodeJwtPayload(token);
    const iat = payload.iat as number | undefined;
    const exp = payload.exp as number | undefined;
    if (typeof iat !== "number" || typeof exp !== "number") return -Infinity;
    return exp - iat;
  } catch {
    return -Infinity;
  }
}

export function getUserIdFromJwt(token: string): string {
  try {
    const payload = decodeJwtPayload(token);
    return (payload.sub as string) ?? "";
  } catch {
    return "";
  }
}
