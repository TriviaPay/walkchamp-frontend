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

/** Ignore self-kicks while this device is finishing login / session register. */
let loginGraceUntil = 0;

const REPLACED_REASONS = new Set([
  "SESSION_REPLACED",
  "login_on_new_device",
  "LOGIN_ON_NEW_DEVICE",
  "session_replaced",
]);

export function beginSessionLoginGrace(ms = 15_000): void {
  loginGraceUntil = Date.now() + ms;
  if (__DEV__) console.log(`[AuthSession] login grace started ms=${ms}`);
}

export function endSessionLoginGrace(): void {
  loginGraceUntil = 0;
}

export function isSessionLoginGraceActive(): boolean {
  return Date.now() < loginGraceUntil;
}

export function onSessionInvalidation(cb: InvalidationListener): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function isReplacedReason(reason: SessionInvalidationReason): boolean {
  const r = String(reason);
  const upper = r.toUpperCase();
  return (
    REPLACED_REASONS.has(r) ||
    REPLACED_REASONS.has(upper) ||
    upper === "SESSION_REPLACED" ||
    upper === "LOGIN_ON_NEW_DEVICE"
  );
}

function userMessageFor(reason: SessionInvalidationReason, custom?: string | null): string {
  if (isReplacedReason(reason)) {
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

  // First sign-in / account-switch race: never kick the device that just logged in.
  // Stale X-Session-Id from the previous account often returns SESSION_INVALID —
  // that must not sign out the current device.
  if (isSessionLoginGraceActive()) {
    if (__DEV__) {
      console.log(
        `[AuthSession] invalidation ignored — login grace reason=${payload.reason}`,
      );
    }
    return false;
  }

  const local = await getActiveSessionMeta();

  // No local session yet (still registering) — do not treat as other-device kick.
  if (!local?.sessionId) {
    if (__DEV__) {
      console.log("[AuthSession] invalidation ignored — no local session meta");
    }
    return false;
  }

  // Only invalidate when the event targets OUR session id.
  if (payload.sessionId && payload.sessionId !== local.sessionId) {
    if (__DEV__) {
      console.log("[AuthSession] invalidation ignored — sessionId mismatch (other session)");
    }
    return false;
  }

  // Backend often omits sessionId on SESSION_REVOKED / EXPIRED / INVALID rejects.
  // Treat missing sessionId as targeting the local session for those codes too
  // (same as SESSION_REPLACED). Login grace above still blocks self-kick races.
  if (!payload.sessionId) {
    const reason = String(payload.reason).toUpperCase();
    const treatAsLocal =
      isReplacedReason(payload.reason) ||
      reason === "SESSION_REVOKED" ||
      reason === "SESSION_EXPIRED" ||
      reason === "SESSION_INVALID";
    if (!treatAsLocal) {
      if (__DEV__) {
        console.log(
          `[AuthSession] invalidation ignored — ${payload.reason} without sessionId`,
        );
      }
      return false;
    }
    payload = { ...payload, sessionId: local.sessionId };
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
