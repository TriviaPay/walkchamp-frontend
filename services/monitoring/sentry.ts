/**
 * Sentry crash reporting — initializes once when EXPO_PUBLIC_SENTRY_DSN is set.
 * No-ops safely when the native module or DSN is unavailable (Expo Go / local).
 */

import Constants from "expo-constants";
import { Platform } from "react-native";
import { getAppEnv } from "@/config/env";

type SentryModule = typeof import("@sentry/react-native");

let _sentry: SentryModule | null = null;
let _initialized = false;

function getDsn(): string {
  return (process.env.EXPO_PUBLIC_SENTRY_DSN ?? "").trim();
}

function loadSentry(): SentryModule | null {
  if (_sentry) return _sentry;
  if ((Constants.executionEnvironment as string) === "storeClient") return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    _sentry = require("@sentry/react-native") as SentryModule;
    return _sentry;
  } catch {
    return null;
  }
}

const SENSITIVE_KEY = /(token|password|secret|authorization|cookie|session|cvv|pan|card|otp|kyc)/i;

function scrubBreadcrumb(breadcrumb: { data?: Record<string, unknown> }) {
  if (!breadcrumb.data) return breadcrumb;
  const next = { ...breadcrumb.data };
  for (const key of Object.keys(next)) {
    if (SENSITIVE_KEY.test(key)) {
      next[key] = "[redacted]";
    }
  }
  return { ...breadcrumb, data: next };
}

/** Call once during app bootstrap (before navigation if possible). */
export function initCrashReporting(): void {
  if (_initialized) return;
  const dsn = getDsn();
  if (!dsn) {
    if (__DEV__) console.log("[Sentry] skipped — EXPO_PUBLIC_SENTRY_DSN unset");
    return;
  }
  const Sentry = loadSentry();
  if (!Sentry) {
    if (__DEV__) console.log("[Sentry] skipped — native module unavailable");
    return;
  }

  try {
    _initialized = true;
    Sentry.init({
      dsn,
      enabled: !__DEV__ || process.env.EXPO_PUBLIC_SENTRY_DEBUG === "true",
      environment: getAppEnv(),
      release:
        Constants.expoConfig?.version != null
          ? `walkchamp@${Constants.expoConfig.version}`
          : undefined,
      dist:
        Platform.OS === "android"
          ? String(Constants.expoConfig?.android?.versionCode ?? "")
          : String(Constants.expoConfig?.ios?.buildNumber ?? ""),
      tracesSampleRate: 0.15,
      sendDefaultPii: false,
      beforeBreadcrumb(breadcrumb) {
        return scrubBreadcrumb(breadcrumb as { data?: Record<string, unknown> });
      },
      beforeSend(event) {
        // Never attach Authorization / cookie headers if present.
        if (event.request?.headers) {
          const headers = { ...event.request.headers };
          for (const key of Object.keys(headers)) {
            if (SENSITIVE_KEY.test(key)) {
              headers[key] = "[redacted]";
            }
          }
          event.request.headers = headers;
        }
        return event;
      },
    });
    if (__DEV__) console.log("[Sentry] initialized", getAppEnv());
  } catch (err) {
    _initialized = false;
    console.warn("[Sentry] init failed", err);
  }
}

export function captureException(
  error: unknown,
  context?: Record<string, unknown>,
): void {
  const Sentry = loadSentry();
  if (!_initialized || !Sentry) {
    if (__DEV__) console.warn("[Sentry] capture skipped", error);
    return;
  }
  Sentry.captureException(error, context ? { extra: context } : undefined);
}

export function captureMessage(
  message: string,
  level: "info" | "warning" | "error" = "info",
): void {
  const Sentry = loadSentry();
  if (!_initialized || !Sentry) return;
  Sentry.captureMessage(message, level);
}

/** Set non-sensitive user id after login; clear on logout. */
export function setCrashReportingUser(userId: string | null): void {
  const Sentry = loadSentry();
  if (!_initialized || !Sentry) return;
  if (!userId) {
    Sentry.setUser(null);
    return;
  }
  Sentry.setUser({ id: userId });
}

export function addCrashBreadcrumb(
  message: string,
  category = "app",
  data?: Record<string, unknown>,
): void {
  const Sentry = loadSentry();
  if (!_initialized || !Sentry) return;
  Sentry.addBreadcrumb({
    message,
    category,
    data,
    level: "info",
  });
}

export function isCrashReportingEnabled(): boolean {
  return _initialized && Boolean(getDsn());
}
