/**
 * Central Android notification gate for step-tracking foreground service and push.
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
import { pushLog } from "@/services/pushLog";

export const NOTIFICATION_STILL_DISABLED_MESSAGE =
  "Notifications are still turned off. Please enable them to use ongoing step tracking.";

export type NotificationGateResult = {
  granted: boolean;
  requestedNow: boolean;
  blockedBySettings: boolean;
  message?: string;
};

export type PushNotificationGateResult = {
  granted: boolean;
  requestedNow: boolean;
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

function getAndroidSdk(): number {
  if (Platform.OS !== "android") return 0;
  return typeof Platform.Version === "number" ? Platform.Version : 0;
}

/** Android 13+ requires runtime POST_NOTIFICATIONS; older devices do not. */
export function androidSupportsPostNotificationsPermission(): boolean {
  return getAndroidSdk() >= 33;
}

/** Check-only — never shows modal or system prompt. */
export async function checkNotificationStatus(): Promise<boolean> {
  if (Platform.OS !== "android") return true;
  const sdk = getAndroidSdk();
  const appEnabled = await areAppNotificationsEnabled();
  if (sdk < 33) {
    return appEnabled;
  }
  try {
    const postGranted = await PermissionsAndroid.check(
      PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
    );
    return postGranted && appEnabled;
  } catch {
    return false;
  }
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
    if (alreadyGranted) {
      pushLog("Android 13+ POST_NOTIFICATIONS already granted");
      return false;
    }
    const result = await PermissionsAndroid.request(permission);
    pushLog(`Android 13+ POST_NOTIFICATIONS result=${result}`);
    return true;
  } catch (error) {
    pushLog("Android 13+ POST_NOTIFICATIONS request failed", error);
    return false;
  }
}

/**
 * Push permission gate — same rules as step-tracking notifications:
 * Android ≤12: no runtime prompt; enabled when app notifications are on.
 * Android 13+: request POST_NOTIFICATIONS once, then verify app toggle.
 */
export async function ensureNotificationsForPush(): Promise<PushNotificationGateResult> {
  if (Platform.OS !== "android") {
    return { granted: true, requestedNow: false };
  }

  const sdk = typeof Platform.Version === "number" ? Platform.Version : 0;
  let requestedNow = false;

  if (sdk >= 33) {
    requestedNow = await requestPostNotificationsOnApi33();
  } else {
    pushLog(`Android≤12 — no POST_NOTIFICATIONS prompt (SDK=${sdk})`);
  }

  const enabled = await areAppNotificationsEnabled();
  pushLog(
    `push gate SDK=${sdk} appNotificationsEnabled=${enabled} requestedPostNoti=${requestedNow}`,
  );

  return { granted: enabled, requestedNow };
}

/**
 * Check-only — never shows a system prompt.
 */
export async function isPushNotificationAccessGranted(): Promise<boolean> {
  if (Platform.OS !== "android") return true;
  if (typeof Platform.Version === "number" && Platform.Version < 33) {
    return areAppNotificationsEnabled();
  }
  try {
    const postGranted = await PermissionsAndroid.check(
      PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
    );
    if (!postGranted) return false;
    return areAppNotificationsEnabled();
  } catch {
    return false;
  }
}

export type NotificationGateMode = "strict" | "auto";

/**
 * Full gate before enabling step tracking.
 *
 * Modes (matches historical platform behavior):
 * - strict — Health Connect / verified Android: ask Allow Notifications (API 33+),
 *   show settings modal if still off; tracking enable fails when denied.
 * - auto — unsupported / legacy sensor / Android ≤12: never block tracking;
 *   still requests POST_NOTIFICATIONS once on API 33+ when useful for FGS.
 */
export async function ensureNotificationsForStepTracking(
  mode: NotificationGateMode = "strict",
): Promise<NotificationGateResult> {
  if (Platform.OS !== "android") {
    return { granted: true, requestedNow: false, blockedBySettings: false };
  }

  const sdk = getAndroidSdk();

  // Android ≤12: no POST_NOTIFICATIONS — notifications auto-enable for step tracking.
  if (sdk < 33) {
    const enabled = await areAppNotificationsEnabled();
    console.log(
      `[NotificationGate] SDK=${sdk} auto-enable path mode=${mode} appNotificationsEnabled=${enabled}`,
    );
    return { granted: true, requestedNow: false, blockedBySettings: false };
  }

  // Android 13+: request POST_NOTIFICATIONS.
  let requestedNow = false;
  const asked = await requestPostNotificationsOnApi33();
  if (asked) requestedNow = true;

  const enabled = await areAppNotificationsEnabled();
  let postGranted = false;
  try {
    postGranted = await PermissionsAndroid.check(
      PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
    );
  } catch {
    postGranted = false;
  }

  console.log(
    `[NotificationGate] SDK=${sdk} mode=${mode} appNotificationsEnabled=${enabled} postGranted=${postGranted} requestedPostNoti=${requestedNow}`,
  );

  if (enabled && postGranted) {
    return { granted: true, requestedNow, blockedBySettings: false };
  }

  // Legacy / unsupported path: never block step tracking on notification denial.
  if (mode === "auto") {
    console.log(
      "[NotificationGate] auto mode — continuing without blocking (polling-only if needed)",
    );
    return {
      granted: true,
      requestedNow,
      blockedBySettings: false,
    };
  }

  // Strict (Health Connect / supported): guide user to enable notifications.
  if (!modalHost) {
    console.log("[NotificationGate] modal host not mounted — blocking verified enable");
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
