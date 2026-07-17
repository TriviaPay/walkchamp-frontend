/**
 * Register / validate active session with backend (single-device login).
 * Safe no-ops when endpoints are not deployed yet (404/501).
 */

import { getApiBase } from "@/utils/apiUrl";
import { API_TIMEOUT_MS, timeoutSignal } from "@/utils/authFetch";
import { getDeviceSessionMetadata } from "@/services/deviceIdentity";
import {
  clearActiveSessionMeta,
  saveActiveSessionMeta,
  type ActiveSessionMeta,
} from "@/services/authSessionMetadata";
import { handleSessionInvalidation, isSessionErrorCode } from "@/services/sessionInvalidation";

function createUuid(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

type RegisterResponse = {
  sessionId?: string;
  sessionGeneration?: string | number;
  generation?: string | number;
  createdAt?: string;
  code?: string;
  error?: string;
  message?: string;
};

/**
 * After successful login: register this installation as the sole active session.
 * Backend should revoke siblings and return sessionId.
 */
export async function registerActiveSession(options: {
  accessToken: string;
  userId: string;
  /** Optional session id from login response */
  sessionIdFromLogin?: string | null;
}): Promise<ActiveSessionMeta | null> {
  const { accessToken, userId, sessionIdFromLogin } = options;
  const device = await getDeviceSessionMetadata();

  // Local fallback id until backend returns authoritative sessionId.
  const provisionalId = sessionIdFromLogin?.trim() || createUuid();

  try {
    const res = await fetch(`${getApiBase()}/api/auth/session/register`, {
      method: "POST",
      signal: timeoutSignal(API_TIMEOUT_MS),
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        ...device,
        clientSessionId: provisionalId,
      }),
    });

    if (res.status === 404 || res.status === 501) {
      // Backend not ready — store provisional so Pusher/API can still match later.
      const meta: ActiveSessionMeta = {
        sessionId: provisionalId,
        userId,
        createdAt: new Date().toISOString(),
      };
      await saveActiveSessionMeta(meta);
      if (__DEV__) {
        console.log("[AuthSession] register endpoint missing — provisional session stored");
      }
      return meta;
    }

    const body = (await res.json().catch(() => ({}))) as RegisterResponse;

    if (!res.ok) {
      if (isSessionErrorCode(body.code ?? body.error)) {
        await handleSessionInvalidation({
          reason: (body.code ?? body.error ?? "SESSION_INVALID") as string,
          message: body.message,
        });
        return null;
      }
      // Soft-fail: still store provisional so local invalidation works when backend arrives.
      const meta: ActiveSessionMeta = {
        sessionId: provisionalId,
        userId,
        createdAt: new Date().toISOString(),
      };
      await saveActiveSessionMeta(meta);
      return meta;
    }

    const sessionId = (body.sessionId ?? provisionalId).toString();
    const gen = body.sessionGeneration ?? body.generation;
    const meta: ActiveSessionMeta = {
      sessionId,
      userId,
      sessionGeneration: gen != null ? String(gen) : undefined,
      createdAt: body.createdAt ?? new Date().toISOString(),
    };
    await saveActiveSessionMeta(meta);
    return meta;
  } catch (e) {
    if (__DEV__) console.log("[AuthSession] register failed (network)", e);
    const meta: ActiveSessionMeta = {
      sessionId: provisionalId,
      userId,
      createdAt: new Date().toISOString(),
    };
    await saveActiveSessionMeta(meta);
    return meta;
  }
}

export type SessionStatusResult =
  | { active: true }
  | { active: false; reason: string; sessionId?: string; message?: string }
  | { active: "unknown" };

/** Validate current session on startup / resume. */
export async function validateActiveSession(accessToken: string): Promise<SessionStatusResult> {
  try {
    const device = await getDeviceSessionMetadata();
    const res = await fetch(`${getApiBase()}/api/auth/session/status`, {
      method: "POST",
      signal: timeoutSignal(API_TIMEOUT_MS),
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ deviceId: device.deviceId }),
    });

    if (res.status === 404 || res.status === 501) {
      return { active: "unknown" };
    }

    const body = (await res.json().catch(() => ({}))) as {
      active?: boolean;
      valid?: boolean;
      code?: string;
      error?: string;
      reason?: string;
      sessionId?: string;
      message?: string;
    };

    if (res.status === 401 || res.status === 403) {
      const reason = body.code ?? body.error ?? body.reason ?? "SESSION_INVALID";
      return {
        active: false,
        reason: String(reason),
        sessionId: body.sessionId,
        message: body.message,
      };
    }

    if (!res.ok) return { active: "unknown" };

    const ok = body.active !== false && body.valid !== false && !isSessionErrorCode(body.code);
    if (!ok) {
      return {
        active: false,
        reason: String(body.code ?? body.reason ?? "SESSION_REPLACED"),
        sessionId: body.sessionId,
        message: body.message,
      };
    }
    return { active: true };
  } catch {
    return { active: "unknown" };
  }
}

export async function clearSessionRegistration(): Promise<void> {
  await clearActiveSessionMeta();
}
