/**
 * Central Android notification gate for step-tracking foreground service.
 *
 * Android ≤12: no POST_NOTIFICATIONS — only NotificationManagerCompat.areNotificationsEnabled().
 * Android 13+: request POST_NOTIFICATIONS once, then verify app-level toggle.
 * When blocked: custom modal → open system notification settings → re-check on resume.
 */

import { PermissionsAndroid, Platform } from "react-native";
import {
  areAppNotificationsEnabled,
  openAppNotificationSettings,
} from "@/services/permissions/androidNotificationAccess";
import {
  ensureActivityRecognitionPermission,
  hasActivityRecognitionPermission,
} from "@/services/permissions/activityRecognitionPermissionService";
import { stepProviderManager } from "@/services/steps/stepProviderManager";

export const NOTIFICATION_STILL_DISABLED_MESSAGE =
  "Notifications are still turned off. Please enable them to use ongoing step tracking.";

export type NotificationGateResult = {
  granted: boolean;
  requestedNow: boolean;
  blockedBySettings: boolean;
  message?: string;
};

type ModalHost = {
  show: (options: { stillDisabled: boolean }) => void;
  hide: () => void;
};

let modalHost: ModalHost | null = null;
let pendingResolve: ((granted: boolean) => void) | null = null;
let awaitingSettingsReturn = false;

export function registerStepTrackingNotificationModalHost(host: ModalHost): void {
  modalHost = host;
}

export function unregisterStepTrackingNotificationModal(): void {
  if (pendingResolve) {
    pendingResolve(false);
    pendingResolve = null;
  }
  awaitingSettingsReturn = false;
  modalHost = null;
}

function waitForUserViaModal(stillDisabled = false): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    pendingResolve = resolve;
    modalHost?.show({ stillDisabled });
  });
}

export function onStepTrackingNotificationOpenSettings(): void {
  awaitingSettingsReturn = true;
  void openNotificationSettings();
}

export function onStepTrackingNotificationDismiss(): void {
  awaitingSettingsReturn = false;
  modalHost?.hide();
  if (pendingResolve) {
    pendingResolve(false);
    pendingResolve = null;
  }
}

/** Check-only — never shows modal or system prompt. */
export async function checkNotificationStatus(): Promise<boolean> {
  if (Platform.OS !== "android") return true;
  return areAppNotificationsEnabled();
}

/** Alias used by step-tracking startup / FGS service. */
export async function hasOngoingNotificationAccess(): Promise<boolean> {
  return checkNotificationStatus();
}

export async function openNotificationSettings(): Promise<boolean> {
  return openAppNotificationSettings();
}

async function requestPostNotificationsOnApi33(): Promise<boolean> {
  if (Platform.OS !== "android") return false;
  if (typeof Platform.Version !== "number" || Platform.Version < 33) {
    return false;
  }
  try {
    const permission = PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS;
    const alreadyGranted = await PermissionsAndroid.check(permission);
    if (alreadyGranted) return false;
    await PermissionsAndroid.request(permission);
    return true;
  } catch (error) {
    console.log("[NotificationGate] POST_NOTIFICATIONS request failed", error);
    return false;
  }
}

/**
 * Full gate before enabling step tracking.
 * Android ≤12: skips POST_NOTIFICATIONS; proceeds when app notifications are on.
 * Android 13+: requests POST_NOTIFICATIONS if needed, then verifies app toggle.
 */
export async function ensureNotificationsForStepTracking(): Promise<NotificationGateResult> {
  if (Platform.OS !== "android") {
    return { granted: true, requestedNow: false, blockedBySettings: false };
  }

  let requestedNow = false;

  if (typeof Platform.Version === "number" && Platform.Version >= 33) {
    const asked = await requestPostNotificationsOnApi33();
    if (asked) requestedNow = true;
  }

  let enabled = await areAppNotificationsEnabled();
  console.log(
    `[NotificationGate] SDK=${Platform.Version} appNotificationsEnabled=${enabled} requestedPostNoti=${requestedNow}`,
  );

  if (enabled) {
    return { granted: true, requestedNow, blockedBySettings: false };
  }

  if (!modalHost) {
    console.log("[NotificationGate] modal host not mounted — blocking step tracking");
    return {
      granted: false,
      requestedNow,
      blockedBySettings: true,
      message: NOTIFICATION_STILL_DISABLED_MESSAGE,
    };
  }

  const granted = await waitForUserViaModal(false);
  if (granted) {
    return { granted: true, requestedNow, blockedBySettings: false };
  }

  return {
    granted: false,
    requestedNow,
    blockedBySettings: true,
    message: NOTIFICATION_STILL_DISABLED_MESSAGE,
  };
}

/** @deprecated Use ensureNotificationsForStepTracking */
export async function ensureOngoingNotificationAccessForStepTracking(): Promise<NotificationGateResult> {
  return ensureNotificationsForStepTracking();
}

/**
 * On return from notification settings: re-check notifications, activity recognition,
 * and Health Connect / provider availability. Resolves pending enable flow when ready.
 */
export async function handleAppResumeNotificationRecheck(): Promise<void> {
  if (!awaitingSettingsReturn || !pendingResolve) return;

  const notificationsOk = await areAppNotificationsEnabled();
  console.log(
    `[NotificationGate] resume recheck notifications=${notificationsOk} activity=${await hasActivityRecognitionPermission()}`,
  );

  if (!notificationsOk) {
    modalHost?.show({ stillDisabled: true });
    return;
  }

  if (Platform.OS === "android") {
    await ensureActivityRecognitionPermission().catch(() => false);
    await stepProviderManager.initialize(true).catch(() => null);
  }

  awaitingSettingsReturn = false;
  modalHost?.hide();
  pendingResolve(true);
  pendingResolve = null;
}

/** @deprecated Use handleAppResumeNotificationRecheck */
export async function handleAppStateActiveForStepTrackingNotificationGate(): Promise<void> {
  return handleAppResumeNotificationRecheck();
}

export const STEP_TRACKING_NOTIFICATION_STILL_DISABLED_MESSAGE =
  NOTIFICATION_STILL_DISABLED_MESSAGE;
