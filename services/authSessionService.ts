/**
 * Register / validate active session with backend (single-device login).
 * Contract matches Walk-Tracker backend:
 *   POST /api/auth/session/register
 *   POST|GET /api/auth/session/status  (body/header sessionId)
 *   POST /api/auth/session/revoke-current
 */

import { getApiBase } from "@/utils/apiUrl";
import { API_TIMEOUT_MS, timeoutSignal } from "@/utils/authFetch";
import { getDeviceSessionMetadata } from "@/services/deviceIdentity";
import {
  clearActiveSessionMeta,
  getActiveSessionMeta,
  saveActiveSessionMeta,
  type ActiveSessionMeta,
} from "@/services/authSessionMetadata";
import { beginSessionLoginGrace, isSessionErrorCode } from "@/services/sessionInvalidation";
import { buildSessionRequestHeaders } from "@/services/sessionRequestHeaders";

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
  createdAt?: string | Date;
  replaced?: boolean;
  code?: string;
  error?: string;
  message?: string;
};

/**
 * After successful login: register this installation as the sole active session.
 * Backend replaces siblings and returns sessionId. Same deviceId re-register is in-place.
 */
export async function registerActiveSession(options: {
  accessToken: string;
  userId: string;
  /** Optional session id from login response */
  sessionIdFromLogin?: string | null;
}): Promise<ActiveSessionMeta | null> {
  const { accessToken, userId, sessionIdFromLogin } = options;
  beginSessionLoginGrace(15_000);
  const device = await getDeviceSessionMetadata();
  const existing = await getActiveSessionMeta().catch(() => null);

  // Account switch: never reuse the previous user's session id as X-Session-Id.
  const sameUser = !!existing?.userId && existing.userId === userId;
  if (existing && !sameUser) {
    await clearActiveSessionMeta().catch(() => {});
  }

  // Prefer known backend session for same-user resume only.
  const resumeSessionId =
    sessionIdFromLogin?.trim() ||
    (sameUser ? existing?.sessionId ?? null : null);

  try {
    const sessionHeaders = await buildSessionRequestHeaders().catch(() => ({}));
    // Strip any stale X-Session-Id that buildSessionRequestHeaders may have
    // still read before clear (race) or from another user.
    const {
      ["X-Session-Id"]: _dropStaleSession,
      ...safeSessionHeaders
    } = sessionHeaders as Record<string, string>;
    void _dropStaleSession;

    const res = await fetch(`${getApiBase()}/api/auth/session/register`, {
      method: "POST",
      signal: timeoutSignal(API_TIMEOUT_MS),
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
        ...safeSessionHeaders,
        // Ensure device id is always present for same-device resume.
        "X-Device-Id": device.deviceId,
        "X-Platform": device.platform,
        "X-App-Version": device.appVersion,
        ...(device.buildNumber ? { "X-Build-Number": device.buildNumber } : {}),
        ...(resumeSessionId ? { "X-Session-Id": resumeSessionId } : {}),
      },
      body: JSON.stringify({
        deviceId: device.deviceId,
        platform: device.platform,
        appVersion: device.appVersion,
        buildNumber: device.buildNumber,
        deviceModel: device.deviceModel,
        osName: device.osName,
        osVersion: device.osVersion,
        androidApiLevel: device.androidApiLevel,
        ...(resumeSessionId ? { sessionId: resumeSessionId } : {}),
      }),
    });

    if (res.status === 404 || res.status === 501) {
      // No register endpoint — omit fake session id so authFetch never sends it.
      await clearActiveSessionMeta().catch(() => {});
      if (__DEV__) {
        console.log("[AuthSession] register endpoint missing — meta cleared");
      }
      return null;
    }

    const body = (await res.json().catch(() => ({}))) as RegisterResponse;

    if (!res.ok) {
      // Do NOT call handleSessionInvalidation on the registering device —
      // that caused first-login self-logout + "other device" modal.
      // Do NOT store a client UUID as X-Session-Id (causes SESSION_INVALID self-kick).
      if (__DEV__) {
        console.log(
          `[AuthSession] register HTTP ${res.status} code=${body.code ?? body.error ?? "n/a"} — soft-fail no provisional id`,
        );
      }
      await clearActiveSessionMeta().catch(() => {});
      return null;
    }

    const sessionId = (body.sessionId ?? resumeSessionId ?? createUuid()).toString();
    const gen = body.sessionGeneration ?? body.generation;
    const createdAt =
      body.createdAt != null
        ? typeof body.createdAt === "string"
          ? body.createdAt
          : new Date(body.createdAt).toISOString()
        : new Date().toISOString();
    const meta: ActiveSessionMeta = {
      sessionId,
      userId,
      sessionGeneration: gen != null ? String(gen) : undefined,
      createdAt,
    };
    await saveActiveSessionMeta(meta);
    if (__DEV__) {
      console.log(
        `[AuthSession] registered replaced=${body.replaced === true} (ids redacted)`,
      );
    }
    return meta;
  } catch (e) {
    if (__DEV__) console.log("[AuthSession] register failed (network)", e);
    await clearActiveSessionMeta().catch(() => {});
    return null;
  }
}

export type SessionStatusResult =
  | { active: true }
  | { active: false; reason: string; sessionId?: string; message?: string }
  | { active: "unknown" };

/**
 * Validate current session on startup / resume.
 * Backend expects sessionId (body or X-Session-Id) — deviceId alone is monitor-mode only.
 */
export async function validateActiveSession(accessToken: string): Promise<SessionStatusResult> {
  try {
    const meta = await getActiveSessionMeta();
    const device = await getDeviceSessionMetadata();
    const sessionHeaders = await buildSessionRequestHeaders().catch(() => ({}));

    if (!meta?.sessionId) {
      // No stored backend session yet — do not invent a false logout in monitor mode.
      return { active: "unknown" };
    }

    const res = await fetch(`${getApiBase()}/api/auth/session/status`, {
      method: "POST",
      signal: timeoutSignal(API_TIMEOUT_MS),
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
        ...sessionHeaders,
        "X-Session-Id": meta.sessionId,
        "X-Device-Id": device.deviceId,
        "X-Platform": device.platform,
        "X-App-Version": device.appVersion,
        ...(device.buildNumber ? { "X-Build-Number": device.buildNumber } : {}),
      },
      body: JSON.stringify({
        sessionId: meta.sessionId,
        deviceId: device.deviceId,
      }),
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
      sessionRequired?: boolean;
    };

    if (res.status === 401 || res.status === 403) {
      const reason = body.code ?? body.error ?? body.reason ?? "SESSION_INVALID";
      return {
        active: false,
        reason: String(reason),
        sessionId: body.sessionId ?? meta.sessionId,
        message: body.message,
      };
    }

    if (!res.ok) return { active: "unknown" };

    // Monitor mode / no enforced session — treat as unknown, not inactive.
    if (body.code === "SESSION_NOT_PRESENT" && body.sessionRequired === false) {
      return { active: "unknown" };
    }

    const ok =
      body.active !== false && body.valid !== false && !isSessionErrorCode(body.code);
    if (!ok) {
      return {
        active: false,
        reason: String(body.code ?? body.reason ?? "SESSION_REPLACED"),
        sessionId: body.sessionId ?? meta.sessionId,
        message: body.message,
      };
    }
    return { active: true };
  } catch {
    return { active: "unknown" };
  }
}

/** Best-effort logout of the current backend session row. */
export async function revokeCurrentSession(
  accessToken?: string | null,
  sessionIdOverride?: string | null,
): Promise<void> {
  try {
    const meta = await getActiveSessionMeta();
    const sessionId = sessionIdOverride?.trim() || meta?.sessionId;
    if (!sessionId) {
      await clearActiveSessionMeta();
      return;
    }
    const token = accessToken?.trim();
    if (!token) {
      await clearActiveSessionMeta();
      return;
    }
    const sessionHeaders = await buildSessionRequestHeaders().catch(() => ({}));
    await fetch(`${getApiBase()}/api/auth/session/revoke-current`, {
      method: "POST",
      signal: timeoutSignal(API_TIMEOUT_MS),
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        ...sessionHeaders,
        "X-Session-Id": sessionId,
      },
      body: JSON.stringify({ sessionId }),
    }).catch(() => {});
  } finally {
    await clearActiveSessionMeta().catch(() => {});
  }
}

export async function clearSessionRegistration(): Promise<void> {
  await clearActiveSessionMeta();
}
