/**
 * Centralized session invalidation — single-flight, idempotent.
 * Used for SESSION_REPLACED / SESSION_REVOKED / SESSION_EXPIRED / SESSION_INVALID.
 * UI: professional Modal via sessionNoticeBus (not Alert.alert).
 */

import { clearActiveSessionMeta, getActiveSessionMeta } from "@/services/authSessionMetadata";
import { cancelProactiveTokenRefresh } from "@/services/tokenRefreshScheduler";
import { clearSession } from "@/services/authService";
import { disconnectPusher, unsubscribeAll } from "@/services/realtimeService";
import { clearPendingMatchPermissionAction } from "@/services/permissions/pendingMatchAction";
import { showSessionNotice } from "@/services/sessionNoticeBus";

export type SessionInvalidationReason =
  | "SESSION_REPLACED"
  | "SESSION_REVOKED"
  | "SESSION_EXPIRED"
  | "SESSION_INVALID"
  | "login_on_new_device"
  | "manual_logout"
  | string;

export type SessionInvalidationPayload = {
  reason: SessionInvalidationReason;
  sessionId?: string | null;
  message?: string | null;
};

type InvalidationListener = (payload: SessionInvalidationPayload) => void;

const listeners = new Set<InvalidationListener>();
let inFlight = false;

const REPLACED_REASONS = new Set([
  "SESSION_REPLACED",
  "login_on_new_device",
  "session_replaced",
  "session_invalidated",
]);

export function onSessionInvalidation(cb: InvalidationListener): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function userMessageFor(reason: SessionInvalidationReason, custom?: string | null): string {
  // Product copy for replaced sessions (ignore shorter backend variants).
  if (REPLACED_REASONS.has(reason) || String(reason).toUpperCase() === "SESSION_REPLACED") {
    return "Your account was signed in on another device. Please sign in again.";
  }
  if (custom?.trim()) return custom.trim();
  if (String(reason).toUpperCase() === "SESSION_REVOKED") {
    return "Your session was ended for security. Please sign in again to continue.";
  }
  return "Your login session has expired. Please sign in again to continue.";
}

/**
 * Confirm event targets this device's active session, then notify AuthContext.
 * Does not clear installation ID.
 */
export async function handleSessionInvalidation(
  payload: SessionInvalidationPayload,
): Promise<boolean> {
  if (inFlight) {
    if (__DEV__) console.log("[AuthSession] invalidationHandled=skipped_inflight");
    return false;
  }

  const local = await getActiveSessionMeta();
  if (payload.sessionId && local?.sessionId && payload.sessionId !== local.sessionId) {
    if (__DEV__) {
      console.log("[AuthSession] invalidation ignored — sessionId mismatch (other session)");
    }
    return false;
  }

  inFlight = true;
  try {
    if (__DEV__) {
      console.log(
        `[AuthSession] invalidationReason=${payload.reason} invalidationHandled=true`,
      );
    }

    cancelProactiveTokenRefresh();
    try {
      unsubscribeAll();
    } catch {
      /* ignore */
    }
    try {
      disconnectPusher();
    } catch {
      /* ignore */
    }
    await clearPendingMatchPermissionAction().catch(() => {});
    await clearActiveSessionMeta().catch(() => {});
    await clearSession().catch(() => {});

    const enriched: SessionInvalidationPayload = {
      ...payload,
      message: userMessageFor(payload.reason, payload.message),
    };

    listeners.forEach((cb) => {
      try {
        cb(enriched);
      } catch {
        /* ignore */
      }
    });

    // Professional modal (not native Alert).
    showSessionNotice(enriched);

    return true;
  } finally {
    setTimeout(() => {
      inFlight = false;
    }, 1500);
  }
}

export function isSessionErrorCode(code: string | undefined | null): boolean {
  if (!code) return false;
  const c = code.toUpperCase();
  return (
    c === "SESSION_REPLACED" ||
    c === "SESSION_REVOKED" ||
    c === "SESSION_EXPIRED" ||
    c === "SESSION_INVALID"
  );
}

export async function parseSessionErrorFromResponse(
  res: Response,
): Promise<SessionInvalidationPayload | null> {
  try {
    const clone = res.clone();
    const body = (await clone.json().catch(() => null)) as {
      code?: string;
      error?: string;
      reason?: string;
      sessionId?: string;
      message?: string;
    } | null;
    if (!body) return null;
    const code = (body.code ?? body.error ?? body.reason ?? "").toString();
    if (!isSessionErrorCode(code) && code.toLowerCase() !== "login_on_new_device") {
      const upper = code.toUpperCase();
      if (!isSessionErrorCode(upper)) return null;
    }
    return {
      reason: (body.code ?? body.error ?? body.reason ?? "SESSION_INVALID") as SessionInvalidationReason,
      sessionId: body.sessionId,
      message: body.message,
    };
  } catch {
    return null;
  }
}
