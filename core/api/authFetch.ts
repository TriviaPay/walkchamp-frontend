/**
 * authFetch — production-grade authenticated API client.
 *
 * Features:
 *   • Automatic Bearer token injection via getValidSession()
 *   • Request timeout (default 12 s; override per-call via timeoutMs option)
 *   • AbortSignal propagation: callers can pass their own signal to cancel on
 *     screen unmount; combined with the timeout signal internally
 *   • 401 recovery: refresh token once, retry original request once
 *   • Request queuing: concurrent 401s share one refresh — not N refreshes
 *   • No infinite loop: each request retries at most once after a refresh
 *   • Structured logging behind __DEV__ — zero log overhead in production
 *
 * Logging prefixes:
 *   [API]  — HTTP request lifecycle (started / completed / timeout / cancelled)
 *   [Auth] — token expiry and refresh lifecycle
 */

import { getValidSession, refreshSessionSafely } from "@/services/authService";
import { getApiBase } from "@/utils/apiUrl";
import {
  handleSessionInvalidation,
  parseSessionErrorFromResponse,
} from "@/services/sessionInvalidation";
import { buildSessionRequestHeaders } from "@/services/sessionRequestHeaders";
import { authEvents } from "@/utils/authEvents";
import { logger } from "@/utils/logger";

// ── Timeout constants ─────────────────────────────────────────────────────────
// Centralised here so every caller uses the same defaults.

/** Default timeout for general API calls. */
export const API_TIMEOUT_MS   = 12_000;
/** Step-sync endpoints — shorter because they fire frequently during races. */
export const STEP_SYNC_TIMEOUT =  6_000;
/** Message-send / chat endpoints. */
export const CHAT_TIMEOUT      =  8_000;
/** Fire-and-forget presence endpoints (heartbeat, offline). */
export const PRESENCE_TIMEOUT  =  5_000;

// ── Timeout signal helper ─────────────────────────────────────────────────────

/**
 * Create an AbortSignal that aborts after `ms` milliseconds.
 *
 * Uses AbortSignal.timeout() if available (React Native / Hermes 0.73+).
 * Falls back to a manual AbortController for older runtimes.
 *
 * Also accepts an optional `callerSignal` so both the timeout AND a
 * component-level unmount signal can abort the same request.
 */
export function timeoutSignal(ms: number, callerSignal?: AbortSignal): AbortSignal {
  if (!callerSignal) {
    // Fast path: no need to combine signals
    if (typeof AbortSignal.timeout === "function") {
      return AbortSignal.timeout(ms);
    }
    const ctrl = new AbortController();
    setTimeout(() => ctrl.abort(), ms);
    return ctrl.signal;
  }

  // Combine timeout + caller signal
  const ctrl = new AbortController();
  const timeoutId = setTimeout(() => ctrl.abort(), ms);

  const onCallerAbort = () => {
    clearTimeout(timeoutId);
    ctrl.abort(callerSignal.reason);
  };

  if (callerSignal.aborted) {
    ctrl.abort(callerSignal.reason);
    clearTimeout(timeoutId);
  } else {
    callerSignal.addEventListener("abort", onCallerAbort, { once: true });
    // Clean up the listener once our controller fires (prevents leaking the listener)
    ctrl.signal.addEventListener("abort", () =>
      callerSignal.removeEventListener("abort", onCallerAbort),
    { once: true });
  }

  return ctrl.signal;
}

// ── authFetch options ─────────────────────────────────────────────────────────

export interface AuthFetchOptions extends Omit<RequestInit, "signal"> {
  /**
   * Request timeout in milliseconds. Default: API_TIMEOUT_MS (12 s).
   * Pass 0 to disable the timeout (use only for streaming / long-poll).
   */
  timeoutMs?: number;
  /**
   * Optional external cancellation signal (e.g. from an AbortController tied
   * to a component's useEffect cleanup). Combined with the timeout signal.
   */
  signal?: AbortSignal;
  /**
   * When false, a 401 does not re-POST the original body after refresh.
   * Use for non-idempotent writes (race progress, payments) — caller/outbox retries later.
   * Default: true (existing behavior).
   */
  retryOnUnauthorized?: boolean;
}

// ── Main API client ───────────────────────────────────────────────────────────

export async function authFetch(
  path: string,
  options: AuthFetchOptions = {},
): Promise<Response> {
  const {
    timeoutMs = API_TIMEOUT_MS,
    signal: callerSignal,
    retryOnUnauthorized = true,
    ...fetchOptions
  } = options;

  logger.debug("API", `request started: ${path}`);

  // getValidSession() returns null on both transient (network) and definitive
  // (Descope rejects token) failures. Definitive failures emit SESSION_EXPIRED
  // internally via refreshSessionSafely() — no extra work needed here.
  // Transient failures: user stays logged in; next request retries the refresh.
  const session = await getValidSession().catch(() => null);
  if (!session) {
    logger.debug("Auth", `no session available for ${path}`);
    throw new Error("No session");
  }
  logger.debug("API", `attaching auth for ${path}`);

  // Single-session gate: X-Session-Id + device metadata (backend requireAuth).
  const sessionHeaders = await buildSessionRequestHeaders().catch(
    () => ({} as Record<string, string>),
  );

  const makeRequest = async (token: string): Promise<Response> => {
    // Own controller so we can cancel both timeout and caller signal cleanly.
    const ctrl = new AbortController();

    // Forward the caller's abort signal into our controller.
    let callerCleanup: (() => void) | null = null;
    if (callerSignal) {
      if (callerSignal.aborted) {
        ctrl.abort(callerSignal.reason);
      } else {
        const onCallerAbort = () => ctrl.abort(callerSignal.reason);
        callerSignal.addEventListener("abort", onCallerAbort, { once: true });
        callerCleanup = () => callerSignal.removeEventListener("abort", onCallerAbort);
      }
    }

    // Timeout — always cleared in finally so the timer never outlives the request.
    // Previously this was left running after completion, causing the fetch polyfill
    // (fetch.umd.js) to fire its abort listener on an already-settled promise and
    // throw an uncaught AbortError 12 s later.
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    if (timeoutMs > 0) {
      timeoutId = setTimeout(
        () => ctrl.abort(), // plain abort — DOMException not available in React Native iOS
        timeoutMs,
      );
    }

    try {
      return await fetch(`${getApiBase()}${path}`, {
        ...fetchOptions,
        signal: ctrl.signal,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          ...sessionHeaders,
          ...(fetchOptions.headers ?? {}),
        },
      });
    } finally {
      if (timeoutId !== null) clearTimeout(timeoutId);
      callerCleanup?.();
    }
  };

  let res: Response;
  try {
    res = await makeRequest(session);
  } catch (err) {
    {
      const name = err instanceof Error ? err.name : "UnknownError";
      if (name === "TimeoutError") {
        logger.debug("API", `request timeout: ${path}`);
      } else if (name === "AbortError") {
        logger.debug("API", `request cancelled: ${path}`);
      } else {
        logger.debug("API", `request failed: ${path} err=${name}`);
      }
    }
    throw err;
  }

  logger.debug("API", `request completed: ${path} status=${res.status}`);

  // Machine-readable single-session / revocation errors (401 or 403).
  if (res.status === 401 || res.status === 403) {
    const sessionErr = await parseSessionErrorFromResponse(res);
    if (sessionErr) {
      logger.debug("Auth", `session error code=${sessionErr.reason} path=${path}`);
      // Do not refresh or retry a replaced/revoked session.
      await handleSessionInvalidation(sessionErr);
      authEvents.emitSessionInvalidated(sessionErr);
      return res;
    }
  }

  if (res.status !== 401) return res;

  // ── 401 recovery ──────────────────────────────────────────────────────────
  logger.debug("API", `received 401 for ${path}`);

  // Non-idempotent writers (race progress, payments): refresh is handled by
  // getValidSession on the *next* scheduled sync — do not re-POST this body.
  if (!retryOnUnauthorized) {
    logger.debug("API", `skip 401 retry (non-idempotent): ${path}`);
    return res;
  }

  // refreshSessionSafely() uses the single unified refresh queue — no
  // duplicate in-flight requests. On definitive failure it already cleared
  // the session and emitted SESSION_EXPIRED; just return the 401 response.
  const outcome = await refreshSessionSafely();
  if (!outcome.ok) {
    if (outcome.definitive) logger.debug("Auth", `definitive session expiry for ${path}`);
    else logger.debug("Auth", `transient refresh failure for ${path}`);
    return res;
  }

  logger.debug("API", `retrying after refresh: ${path}`);
  try {
    const retryRes = await makeRequest(outcome.token);
    if (retryRes.ok) logger.debug("API", `retry success: ${path} status=${retryRes.status}`);
    else logger.debug("API", `retry failed: ${path} status=${retryRes.status}`);
    return retryRes;
  } catch (err) {
    logger.debug("API", `retry failed (network): ${path}`);
    throw err;
  }
}
