/**
 * Headers the backend single-session gate expects on authenticated requests.
 * deviceId is informational only — never treated as auth.
 */

import { getActiveSessionMeta } from "@/services/authSessionMetadata";
import { getDeviceSessionMetadata } from "@/services/deviceIdentity";

export type SessionRequestHeaders = Record<string, string>;

/**
 * Build X-Session-Id + device metadata headers for /api calls.
 * Safe to call before session meta exists (omits X-Session-Id).
 */
export async function buildSessionRequestHeaders(): Promise<SessionRequestHeaders> {
  const headers: SessionRequestHeaders = {};
  try {
    const device = await getDeviceSessionMetadata();
    headers["X-Device-Id"] = device.deviceId;
    headers["X-Platform"] = device.platform;
    headers["X-App-Version"] = device.appVersion;
    if (device.buildNumber) headers["X-Build-Number"] = device.buildNumber;
  } catch {
    /* optional */
  }
  try {
    const meta = await getActiveSessionMeta();
    if (meta?.sessionId) headers["X-Session-Id"] = meta.sessionId;
  } catch {
    /* optional */
  }
  return headers;
}
