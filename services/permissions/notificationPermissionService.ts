/**
 * Single entry point for notification permission (push + ongoing FGS).
 * Android 13+: POST_NOTIFICATIONS via PermissionsAndroid (once).
 * iOS: OneSignal system prompt (once).
 */

import { PermissionsAndroid, Platform } from "react-native";
import { storageGet, storageSet, STORAGE_KEYS } from "@/utils/storage";

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
  if (extra !== undefined) {
    console.log(`[NotificationPermission] ${msg}`, extra);
  } else {
    console.log(`[NotificationPermission] ${msg}`);
  }
}

export async function getNotificationPermissionStatus(): Promise<NotificationPermissionStatus> {
  if (Platform.OS === "web") return "unavailable";

  if (Platform.OS === "android") {
    if (typeof Platform.Version === "number" && Platform.Version < 33) {
      return "granted";
    }
    try {
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

  inFlightRequest = (async () => {
    try {
      const current = await getNotificationPermissionStatus();
      permLog(`status checked reason=${reason} status=${current}`);

      if (current === "granted") {
        return { status: "granted", requestedNow: false, reason };
      }

      const alreadyAsked = await storageGet<boolean>(
        STORAGE_KEYS.NOTIFICATION_PERMISSION_ASKED,
      );
      if (alreadyAsked && !options?.forceRetry) {
        permLog(`already asked — skip prompt reason=${reason}`);
        return { status: current, requestedNow: false, reason };
      }

      await storageSet(STORAGE_KEYS.NOTIFICATION_PERMISSION_ASKED, true);
      await storageSet(STORAGE_KEYS.PUSH_PERMISSION_PROMPTED, true);

      let granted = false;

      if (Platform.OS === "android") {
        if (typeof Platform.Version === "number" && Platform.Version < 33) {
          granted = true;
        } else {
          const result = await PermissionsAndroid.request(
            PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
          );
          granted = result === PermissionsAndroid.RESULTS.GRANTED;
          permLog(`Android POST_NOTIFICATIONS result=${result}`);
        }
      } else if (Platform.OS === "ios") {
        const { requestIOSNotificationPermission } = await import(
          "@/services/notificationService"
        );
        granted = await requestIOSNotificationPermission();
      }

      const status: NotificationPermissionStatus = granted ? "granted" : "denied";
      permLog(`request complete reason=${reason} status=${status}`);
      return { status, requestedNow: true, reason };
    } catch (error) {
      permLog("request failed", error);
      return { status: "unknown", requestedNow: false, reason };
    }
  })().finally(() => {
    inFlightRequest = null;
  });

  return inFlightRequest;
}

/** Check only — never shows a system prompt. */
export async function hasNotificationPermissionGranted(): Promise<boolean> {
  return (await getNotificationPermissionStatus()) === "granted";
}

/**
 * Ensure POST_NOTIFICATIONS is granted before starting ongoing FGS (Android 13+).
 * Uses centralized once-flow — does not duplicate raw permission dialogs elsewhere.
 */
export async function ensureNotificationPermissionForOngoingTracking(): Promise<{
  granted: boolean;
  requestedNow: boolean;
}> {
  if (Platform.OS !== "android") {
    return { granted: true, requestedNow: false };
  }
  if (typeof Platform.Version === "number" && Platform.Version < 33) {
    return { granted: true, requestedNow: false };
  }

  const current = await getNotificationPermissionStatus();
  if (current === "granted") {
    return { granted: true, requestedNow: false };
  }

  const result = await requestNotificationPermissionOnce("step_tracking");
  return {
    granted: result.status === "granted",
    requestedNow: result.requestedNow,
  };
}
