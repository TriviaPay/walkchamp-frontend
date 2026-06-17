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
import { getApiBase } from "./apiUrl";

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
}

// ── Main API client ───────────────────────────────────────────────────────────

export async function authFetch(
  path: string,
  options: AuthFetchOptions = {},
): Promise<Response> {
  const { timeoutMs = API_TIMEOUT_MS, signal: callerSignal, ...fetchOptions } = options;

  if (__DEV__) console.log("[API] request started:", path);

  // getValidSession() returns null on both transient (network) and definitive
  // (Descope rejects token) failures. Definitive failures emit SESSION_EXPIRED
  // internally via refreshSessionSafely() — no extra work needed here.
  // Transient failures: user stays logged in; next request retries the refresh.
  const session = await getValidSession().catch(() => null);
  if (!session) {
    if (__DEV__) console.log("[Auth] no session available for", path);
    throw new Error("No session");
  }
  if (__DEV__) console.log("[API] attaching token for", path);

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
    if (__DEV__) {
      const name = err instanceof Error ? err.name : "UnknownError";
      if (name === "TimeoutError") {
        console.log("[API] request timeout:", path);
      } else if (name === "AbortError") {
        console.log("[API] request cancelled:", path);
      } else {
        console.log("[API] request failed:", path, err);
      }
    }
    throw err;
  }

  if (__DEV__) console.log("[API] request completed:", path, res.status);

  if (res.status !== 401) return res;

  // ── 401 recovery ──────────────────────────────────────────────────────────
  if (__DEV__) console.log("[API] received 401 for", path);

  // refreshSessionSafely() uses the single unified refresh queue — no
  // duplicate in-flight requests. On definitive failure it already cleared
  // the session and emitted SESSION_EXPIRED; just return the 401 response.
  const outcome = await refreshSessionSafely();
  if (!outcome.ok) {
    if (__DEV__) {
      if (outcome.definitive) console.log("[Auth] definitive session expiry for", path);
      else console.log("[Auth] transient refresh failure for", path);
    }
    return res;
  }

  if (__DEV__) console.log("[API] retrying after refresh:", path);
  try {
    const retryRes = await makeRequest(outcome.token);
    if (__DEV__) {
      if (retryRes.ok) console.log("[API] retry success:", path, retryRes.status);
      else             console.log("[API] retry failed:", path, retryRes.status);
    }
    return retryRes;
  } catch (err) {
    if (__DEV__) console.log("[API] retry failed (network):", path, err);
    throw err;
  }
}
