/**
 * Single entry point for notification permission (push + ongoing FGS).
 * Android 13+: POST_NOTIFICATIONS via PermissionsAndroid (once).
 * iOS: OneSignal system prompt (once).
 */

import { PermissionsAndroid, Platform } from "react-native";
import { storageGet, storageSet, STORAGE_KEYS } from "@/utils/storage";
import { areAppNotificationsEnabled } from "@/services/permissions/androidNotificationAccess";
import { ensureNotificationsForStepTracking, type NotificationGateMode } from "@/services/permissions/notificationGate";
import { pushLog } from "@/services/pushLog";

function isPushFlow(reason: string): boolean {
  return reason !== "step_tracking" && reason !== "ongoing_fgs";
}

export type NotificationPermissionStatus =
  | "granted"
  | "denied"
  | "unavailable"
  | "unknown";

export type NotificationPermissionRequestResult = {
  status: NotificationPermissionStatus;
  requestedNow: boolean;
  reason?: string;
};

let inFlightRequest: Promise<NotificationPermissionRequestResult> | null = null;

function permLog(msg: string, extra?: unknown): void {
  if (!__DEV__) return;
  if (extra !== undefined) {
    console.log(`[NotificationPermission] ${msg}`, extra);
  } else {
    console.log(`[NotificationPermission] ${msg}`);
  }
}

export async function getNotificationPermissionStatus(): Promise<NotificationPermissionStatus> {
  if (Platform.OS === "web") return "unavailable";

  if (Platform.OS === "android") {
    try {
      const appEnabled = await areAppNotificationsEnabled();
      if (!appEnabled) return "denied";
      if (typeof Platform.Version === "number" && Platform.Version < 33) {
        return "granted";
      }
      const granted = await PermissionsAndroid.check(
        PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
      );
      return granted ? "granted" : "denied";
    } catch {
      return "unknown";
    }
  }

  try {
    const { getIOSNotificationPermissionGranted } = await import(
      "@/services/notificationService"
    );
    return (await getIOSNotificationPermissionGranted()) ? "granted" : "denied";
  } catch {
    return "unknown";
  }
}

/**
 * Request system notification permission at most once per install (unless forceRetry).
 * Custom explanation modals must call this only from their primary action — not separately.
 */
export async function requestNotificationPermissionOnce(
  reason: string,
  options?: { forceRetry?: boolean },
): Promise<NotificationPermissionRequestResult> {
  if (inFlightRequest) return inFlightRequest;

  const pending = (async (): Promise<NotificationPermissionRequestResult> => {
    try {
      const current = await getNotificationPermissionStatus();
      const log = isPushFlow(reason) ? pushLog : permLog;
      log(`status checked reason=${reason} status=${current}`);

      if (current === "granted") {
        return { status: "granted", requestedNow: false, reason };
      }

      // Step-tracking uses NOTIFICATION_PERMISSION_ASKED; push uses PUSH_PERMISSION_PROMPTED only.
      if (isPushFlow(reason)) {
        const pushPromptDismissed = await storageGet<boolean>(
          STORAGE_KEYS.PUSH_PERMISSION_PROMPTED,
        );
        if (pushPromptDismissed && !options?.forceRetry) {
          log(`push prompt dismissed — skip reason=${reason}`);
          return { status: current, requestedNow: false, reason };
        }
      } else {
        const alreadyAsked = await storageGet<boolean>(
          STORAGE_KEYS.NOTIFICATION_PERMISSION_ASKED,
        );
        if (alreadyAsked && !options?.forceRetry) {
          permLog(`already asked — skip prompt reason=${reason}`);
          return { status: current, requestedNow: false, reason };
        }
        await storageSet(STORAGE_KEYS.NOTIFICATION_PERMISSION_ASKED, true);
      }

      let granted = false;

      if (Platform.OS === "android") {
        permLog(
          `Android SDK version=${Platform.Version} notification permission required=${Platform.Version >= 33}`,
        );
        const isOngoingOnly =
          reason === "step_tracking" || reason === "ongoing_fgs";
        if (isOngoingOnly) {
          if (typeof Platform.Version === "number" && Platform.Version < 33) {
            granted = await areAppNotificationsEnabled();
          } else {
            const result = await PermissionsAndroid.request(
              PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
            );
            granted = result === PermissionsAndroid.RESULTS.GRANTED;
            permLog(`Android POST_NOTIFICATIONS result=${result}`);
            if (!granted) {
              granted = await areAppNotificationsEnabled();
            }
          }
        } else {
          const { requestAndroidPushNotificationPermission } = await import(
            "@/services/notificationService"
          );
          granted = await requestAndroidPushNotificationPermission();
          pushLog(`Android push permission granted=${granted}`);
        }
      } else if (Platform.OS === "ios") {
        const { requestIOSNotificationPermission } = await import(
          "@/services/notificationService"
        );
        granted = await requestIOSNotificationPermission();
      }

      const status: NotificationPermissionStatus = granted ? "granted" : "denied";
      log(`request complete reason=${reason} status=${status}`);
      return { status, requestedNow: true, reason };
    } catch (error) {
      permLog("request failed", error);
      return { status: "unknown", requestedNow: false, reason };
    }
  })().finally(() => {
    inFlightRequest = null;
  });

  inFlightRequest = pending;
  return pending;
}

/** Check only — never shows a system prompt. */
export async function hasNotificationPermissionGranted(): Promise<boolean> {
  return (await getNotificationPermissionStatus()) === "granted";
}

/**
 * Ensure notifications are enabled before starting ongoing FGS (Android).
 * Uses custom modal + settings when app-level notifications are off (strict mode).
 * Auto mode (legacy / unsupported) never blocks tracking.
 */
export async function ensureNotificationPermissionForOngoingTracking(
  mode: NotificationGateMode = "strict",
): Promise<{
  granted: boolean;
  requestedNow: boolean;
  blockedBySettings?: boolean;
  message?: string;
}> {
  if (Platform.OS !== "android") {
    return { granted: true, requestedNow: false };
  }

  const result = await ensureNotificationsForStepTracking(mode);
  return {
    granted: result.granted,
    requestedNow: result.requestedNow,
    blockedBySettings: result.blockedBySettings,
    message: result.message,
  };
}
