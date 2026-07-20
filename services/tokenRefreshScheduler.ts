/**
 * Proactive session refresh timer.
 *
 * Intentionally does NOT import authService — avoids circular module init
 * that left scheduleProactiveTokenRefresh undefined at runtime in AuthContext.
 */

import {
  getJwtSecsUntilExpiry,
  getJwtLifetimeSecs,
  JWT_CLOCK_SKEW_SECS,
  SESSION_REFRESH_LEAD_FRACTION,
} from "./descopeClient";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

const SESSION_KEY = "wc_session";
const REFRESH_KEY = "wc_refresh";

const memStore: Record<string, string> = {};

async function secureGet(key: string): Promise<string | null> {
  if (Platform.OS === "web") return memStore[key] ?? null;
  return SecureStore.getItemAsync(key);
}

async function readStoredSession(): Promise<{
  session: string | null;
  refresh: string | null;
}> {
  const [session, refresh] = await Promise.all([
    secureGet(SESSION_KEY),
    secureGet(REFRESH_KEY),
  ]);
  return { session, refresh };
}

function getRefreshLeadSecs(token: string): number {
  const lifetime = getJwtLifetimeSecs(token);
  if (lifetime <= 0) return JWT_CLOCK_SKEW_SECS;
  return Math.max(
    JWT_CLOCK_SKEW_SECS,
    Math.floor(lifetime * SESSION_REFRESH_LEAD_FRACTION),
  );
}

let _proactiveRefreshTimer: ReturnType<typeof setTimeout> | null = null;
const PROACTIVE_REFRESH_RETRY_MS = 30_000;

export function cancelProactiveTokenRefresh(): void {
  if (_proactiveRefreshTimer !== null) {
    clearTimeout(_proactiveRefreshTimer);
    _proactiveRefreshTimer = null;
  }
}

export async function scheduleProactiveTokenRefresh(): Promise<void> {
  cancelProactiveTokenRefresh();

  const { session, refresh } = await readStoredSession();
  if (!session || !refresh?.trim()) return;

  const secsUntilRefresh =
    getJwtSecsUntilExpiry(session) - getRefreshLeadSecs(session);
  const delayMs = Math.max(1_000, secsUntilRefresh * 1000);

  if (__DEV__) {
    console.log(
      `[Auth] proactive refresh scheduled in ${Math.round(delayMs / 1000)}s`,
    );
  }

  _proactiveRefreshTimer = setTimeout(() => {
    _proactiveRefreshTimer = null;
    void import("./authService").then(({ refreshSessionSafely }) =>
      refreshSessionSafely().then((outcome) => {
        if (outcome.ok) {
          void scheduleProactiveTokenRefresh();
          return;
        }
        if (!outcome.definitive) {
          _proactiveRefreshTimer = setTimeout(() => {
            void scheduleProactiveTokenRefresh();
          }, PROACTIVE_REFRESH_RETRY_MS);
        }
      }),
    );
  }, delayMs);
}
