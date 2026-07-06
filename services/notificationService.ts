import { PermissionsAndroid, Platform } from "react-native";
import Constants from "expo-constants";
import { getValidSession } from "./authService";
import { storageGet, storageSet, STORAGE_KEYS } from "@/utils/storage";
import { resolveNotificationRoute } from "@/utils/deepLinkUtils";
import {
  hasNotificationPermissionGranted,
  requestNotificationPermissionOnce,
} from "@/services/permissions/notificationPermissionService";
import {
  ensureNotificationsForPush,
  isPushNotificationAccessGranted,
} from "@/services/permissions/notificationGate";
import { pushLog } from "@/services/pushLog";

/**
 * In Expo Go, TurboModuleRegistry.getEnforcing() throws an Invariant Violation
 * at the native layer — before JavaScript try/catch can intercept it.
 * Skipping the import() entirely in Expo Go is the only safe guard.
 */
const IS_EXPO_GO = (Constants.executionEnvironment as string) === "storeClient";

const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? "";

// ── OneSignal v5 type interface ───────────────────────────────────────────────
interface PushSubscription {
  id: string | undefined | null;
  token: string | undefined | null;
  optedIn: boolean;
  optIn: () => Promise<void>;
  optOut: () => Promise<void>;
  getIdAsync?: () => Promise<string | null>;
  getOptedInAsync?: () => Promise<boolean>;
  addEventListener: (event: "change", handler: (event: { current: PushSubscription }) => void) => void;
  removeEventListener: (event: "change", handler: (event: { current: PushSubscription }) => void) => void;
}

interface NotificationClickEvent {
  notification: {
    additionalData?: Record<string, unknown>;
    title?: string;
    body?: string;
    launchURL?: string;
    launchUrl?: string;
  };
}

interface ForegroundWillDisplayEvent {
  notification: {
    additionalData?: Record<string, unknown>;
    title?: string;
    body?: string;
    display: () => void;
  };
  preventDefault: () => void;
}

type NotifEventHandler = (e: NotificationClickEvent | ForegroundWillDisplayEvent) => void;
type SubscriptionChangeHandler = (event: { current: PushSubscription }) => void;

interface OneSignalV5 {
  initialize: (appId: string) => void;
  login: (externalId: string) => Promise<void>;
  logout: () => Promise<void>;
  Notifications: {
    requestPermission: (fallbackToSettings?: boolean) => Promise<boolean>;
    getPermissionAsync: () => Promise<boolean>;
    addEventListener: (event: "click" | "foregroundWillDisplay", handler: NotifEventHandler) => void;
    removeEventListener: (event: "click" | "foregroundWillDisplay", handler: NotifEventHandler) => void;
  };
  User: {
    pushSubscription: PushSubscription;
  };
}

async function getOneSignal(): Promise<OneSignalV5 | null> {
  if (Platform.OS === "web") return null;
  if (IS_EXPO_GO) return null;
  try {
    const mod = await import("react-native-onesignal");
    const sdk = ((mod as Record<string, unknown>).OneSignal ?? mod.default ?? mod) as OneSignalV5;
    // Validate that the native module actually linked — in Expo Go the JS
    // module loads but .Notifications / .User are undefined.
    if (!sdk?.Notifications?.addEventListener) return null;
    return sdk;
  } catch {
    return null;
  }
}

let _initialized = false;
let _initPromise: Promise<OneSignalV5 | null> | null = null;
let _foregroundHandlerCleanup: (() => void) | null = null;
let _subscriptionListenerCleanup: (() => void) | null = null;
let _registrationRetryTimer: ReturnType<typeof setTimeout> | null = null;
let _loggedInUserId: string | null = null;

/** Resolve subscription id via async native API (sync `.id` is often stale). */
async function resolvePushSubscriptionId(
  OneSignal: OneSignalV5,
): Promise<string | null> {
  try {
    const sub = OneSignal.User.pushSubscription;
    if (typeof sub.getIdAsync === "function") {
      const id = await sub.getIdAsync();
      if (id) return id;
    }
    return sub.id ?? null;
  } catch (error) {
    pushLog("resolvePushSubscriptionId failed", error);
    return null;
  }
}

/** Poll until OneSignal assigns a push subscription id (FCM/APNS can lag). */
async function waitForPushSubscriptionId(
  OneSignal: OneSignalV5,
  maxMs = 15000,
): Promise<string | null> {
  const started = Date.now();
  while (Date.now() - started < maxMs) {
    const id = await resolvePushSubscriptionId(OneSignal);
    if (id) {
      pushLog(`subscription id ready id=${id}`);
      return id;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  pushLog(`subscription id pending after ${maxMs}ms`);
  return null;
}

function schedulePushRegistrationRetry(): void {
  if (_registrationRetryTimer) return;
  _registrationRetryTimer = setTimeout(() => {
    _registrationRetryTimer = null;
    pushLog("retrying device registration");
    void ensurePushRegistration();
  }, 3000);
}

export async function ensureOneSignalInitialized(): Promise<OneSignalV5 | null> {
  if (_initPromise) return _initPromise;

  _initPromise = (async () => {
    const appId = process.env.EXPO_PUBLIC_ONESIGNAL_APP_ID;
    if (!appId || Platform.OS === "web") return null;

    const OneSignal = await getOneSignal();
    if (!OneSignal) return null;

    if (!_initialized) {
      try {
        OneSignal.initialize(appId);
        _initialized = true;
        pushLog("OneSignal initialized");
        // Native initWithContext completes asynchronously after the JS call returns.
        await new Promise((resolve) => setTimeout(resolve, 100));
        void setupPushSubscriptionListener();
      } catch (error) {
        pushLog("initialize failed", error);
        return null;
      }
    }
    return OneSignal;
  })();

  return _initPromise;
}

/** Re-register device when OneSignal subscription id becomes available or changes. */
async function setupPushSubscriptionListener(): Promise<void> {
  if (_subscriptionListenerCleanup || Platform.OS === "web") return;

  const OneSignal = await getOneSignal();
  if (!OneSignal?.User?.pushSubscription?.addEventListener) return;

  const onChange: SubscriptionChangeHandler = (event) => {
    const subId = event.current?.id;
    if (!subId) return;
    pushLog(`push subscription changed id=${subId}`);
    void registerDeviceWithBackend();
  };

  try {
    OneSignal.User.pushSubscription.addEventListener("change", onChange);
    _subscriptionListenerCleanup = () => {
      OneSignal.User.pushSubscription.removeEventListener("change", onChange);
    };
  } catch (error) {
    pushLog("subscription listener setup failed", error);
  }
}

// ── Initialize OneSignal and associate authenticated user ─────────────────────
export async function initOneSignal(userId: string): Promise<void> {
  const OneSignal = await ensureOneSignalInitialized();
  if (!OneSignal || !userId) return;

  try {
    await OneSignal.login(userId);
    _loggedInUserId = userId;
    pushLog(`OneSignal login userId=${userId}`);
    const subId = await resolvePushSubscriptionId(OneSignal);
    pushLog(`push subscription id=${subId ?? "pending"}`);
  } catch (error) {
    pushLog("login failed", error);
  }
}

// ── iOS-only helpers (called from notificationPermissionService) ─────────────
export async function getIOSNotificationPermissionGranted(): Promise<boolean> {
  if (Platform.OS !== "ios") return false;
  const OneSignal = await ensureOneSignalInitialized();
  if (!OneSignal) return false;
  try {
    return await OneSignal.Notifications.getPermissionAsync();
  } catch {
    return false;
  }
}

export async function requestIOSNotificationPermission(): Promise<boolean> {
  if (Platform.OS !== "ios") return false;
  const OneSignal = await ensureOneSignalInitialized();
  if (!OneSignal) return false;
  try {
    const granted = await OneSignal.Notifications.requestPermission(true);
    pushLog(`iOS permission requested result=${granted}`);
    return granted;
  } catch (error) {
    pushLog("iOS permission request failed", error);
    return false;
  }
}

/**
 * Android push permission — same gate as step tracking:
 * Android ≤12: no system prompt; enabled when app notifications are on.
 * Android 13+: POST_NOTIFICATIONS system dialog, then OneSignal opt-in.
 */
export async function requestAndroidPushNotificationPermission(): Promise<boolean> {
  if (Platform.OS !== "android") return false;

  const OneSignal = await ensureOneSignalInitialized();
  if (!OneSignal) {
    pushLog("OneSignal unavailable — treating push as optional");
    return true;
  }

  try {
    await new Promise((resolve) => setTimeout(resolve, 250));

    const gate = await ensureNotificationsForPush();
    if (!gate.granted) {
      pushLog("Android push denied — app notifications off or POST_NOTIFICATIONS denied");
      return false;
    }

    const sdk = typeof Platform.Version === "number" ? Platform.Version : 0;
    if (sdk < 33) {
      pushLog("Android≤12 push enabled — skipping OneSignal requestPermission");
      return true;
    }

    const existing = await OneSignal.Notifications.getPermissionAsync();
    if (existing) return true;

    const granted = await OneSignal.Notifications.requestPermission(false);
    pushLog(`Android 13+ OneSignal requestPermission result=${granted}`);
    return granted;
  } catch (error) {
    pushLog("Android push permission request failed", error);
    return false;
  }
}

/** Opt into push subscription after permission is granted — avoids native crash on optIn alone. */
export async function registerPushAfterPermissionGranted(): Promise<void> {
  if (Platform.OS === "web") return;

  const OneSignal = await ensureOneSignalInitialized();
  if (!OneSignal) return;

  try {
    await new Promise((resolve) => setTimeout(resolve, 200));

    if (Platform.OS === "android") {
      const permitted = await isPushNotificationAccessGranted();
      if (!permitted) {
        pushLog("Android push opt-in skipped — notification access not granted");
        return;
      }
    } else if (Platform.OS === "ios") {
      const permitted = await OneSignal.Notifications.getPermissionAsync();
      if (!permitted) return;
    }

    await OneSignal.User.pushSubscription.optIn();
    pushLog("push subscription opted in");
    const subId = await waitForPushSubscriptionId(OneSignal, 8000);
    if (!subId) {
      schedulePushRegistrationRetry();
    }
  } catch (error) {
    pushLog("registerPushAfterPermissionGranted failed", error);
  }
}

async function setupForegroundHandlerDeferred(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 300));
  if (_foregroundHandlerCleanup) return;
  try {
    _foregroundHandlerCleanup = await setupForegroundHandler();
  } catch (error) {
    pushLog("foreground handler setup failed", error);
  }
}

// ── Request push notification permission ──────────────────────────────────────
// Returns true if permission was granted, false if denied or unavailable
export async function requestNotificationPermission(): Promise<boolean> {
  if (Platform.OS === "web") return false;
  const result = await requestNotificationPermissionOnce("settings", { forceRetry: true });
  pushLog(`permission requested result=${result.status} requestedNow=${result.requestedNow}`);
  return result.status === "granted";
}

// ── Check current permission without prompting ────────────────────────────────
export async function hasNotificationPermission(): Promise<boolean> {
  if (Platform.OS === "web") return false;
  const granted = await hasNotificationPermissionGranted();
  pushLog(`permission status checked granted=${granted}`);
  return granted;
}

/** Dev-only push registration snapshot (no secrets). */
export async function getPushRegistrationDebugInfo(): Promise<{
  permissionGranted: boolean;
  pushSubscriptionId: string | null;
  optedIn: boolean;
  externalIdSet: boolean;
} | null> {
  if (!__DEV__) return null;
  const OneSignal = await ensureOneSignalInitialized();
  if (!OneSignal) return null;
  try {
    const permissionGranted = await OneSignal.Notifications.getPermissionAsync();
    const subId = await resolvePushSubscriptionId(OneSignal);
    let optedIn = OneSignal.User.pushSubscription.optedIn;
    if (typeof OneSignal.User.pushSubscription.getOptedInAsync === "function") {
      optedIn = await OneSignal.User.pushSubscription.getOptedInAsync();
    }
    return {
      permissionGranted,
      pushSubscriptionId: subId,
      optedIn,
      externalIdSet: !!_loggedInUserId,
    };
  } catch {
    return null;
  }
}

/**
 * Post-login push setup: init SDK, login external ID, check permission,
 * register device when already granted, or signal that UI should prompt once.
 */
export async function runPostLoginPushSetup(userId: string): Promise<{
  permissionGranted: boolean;
  shouldShowPrompt: boolean;
}> {
  if (!userId || Platform.OS === "web") {
    return { permissionGranted: false, shouldShowPrompt: false };
  }

  pushLog("post-login setup started");
  pushLog(`platform=${Platform.OS}`);
  await initOneSignal(userId);

  const sdk =
    Platform.OS === "android" && typeof Platform.Version === "number"
      ? Platform.Version
      : 0;
  if (Platform.OS === "android") {
    pushLog(`androidApiLevel=${sdk}`);
  }

  let granted = await hasNotificationPermissionGranted();
  pushLog(`permissionStatus=${granted ? "granted" : "denied"}`);
  const pushPromptDismissed = await storageGet<boolean>(STORAGE_KEYS.PUSH_PERMISSION_PROMPTED);

  // Android 13+: always request POST_NOTIFICATIONS when not granted (independent of step-tracking flags).
  if (Platform.OS === "android" && sdk >= 33) {
    try {
      const postGranted = await PermissionsAndroid.check(
        PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
      );
      pushLog(`POST_NOTIFICATIONS granted=${postGranted}`);
      if (!postGranted) {
        pushLog("shouldRequestPermission=true (Android 13+ POST_NOTIFICATIONS)");
        granted = await requestAndroidPushNotificationPermission();
        pushLog(`requestPermission result=${granted}`);
        if (granted) {
          await storageSet(STORAGE_KEYS.PUSH_PERMISSION_PROMPTED, true);
        }
      } else {
        granted = true;
      }
    } catch (error) {
      pushLog("POST_NOTIFICATIONS check failed", error);
    }
  } else if (Platform.OS === "android" && sdk < 33) {
    granted = await isPushNotificationAccessGranted();
    pushLog(`appNotificationsEnabled=${granted}`);
  }

  if (granted) {
    try {
      if (Platform.OS === "android") {
        await registerPushAfterPermissionGranted();
      } else {
        await optInNotifications();
      }
      const registered = await ensurePushRegistration();
      pushLog(`token registration success=${registered}`);
      void setupForegroundHandlerDeferred();
      if (__DEV__) {
        const debug = await getPushRegistrationDebugInfo();
        if (debug) pushLog("registration debug", debug);
      }
    } catch (error) {
      pushLog("post-login register failed", error);
    }
    return { permissionGranted: true, shouldShowPrompt: false };
  }

  if (!pushPromptDismissed) {
    pushLog("permission not granted — will show prompt");
    return { permissionGranted: false, shouldShowPrompt: true };
  }

  pushLog("permission denied but app continues");
  return { permissionGranted: false, shouldShowPrompt: false };
}

/** Called when user accepts the in-app push permission prompt. */
export async function completePushPermissionPrompt(): Promise<boolean> {
  const result = await requestNotificationPermissionOnce("onboarding", { forceRetry: true });
  const granted = result.status === "granted";
  await storageSet(STORAGE_KEYS.PUSH_PERMISSION_PROMPTED, true);
  if (granted) {
    try {
      if (Platform.OS === "android") {
        await registerPushAfterPermissionGranted();
      } else {
        await optInNotifications();
      }
      const registered = await ensurePushRegistration();
      pushLog(`token registration success=${registered}`);
      void setupForegroundHandlerDeferred();
    } catch (error) {
      pushLog("register after prompt failed", error);
    }
  } else {
    pushLog("permission denied but app continues");
  }
  return granted;
}

/** User dismissed the prompt — do not block the app. */
export async function dismissPushPermissionPrompt(): Promise<void> {
  await storageSet(STORAGE_KEYS.PUSH_PERMISSION_PROMPTED, true);
  await storageSet(STORAGE_KEYS.NOTIFICATION_PERMISSION_ASKED, true);
  pushLog("permission prompt dismissed");
}

/** Wait for subscription id then register with backend. Returns true when registered. */
export async function ensurePushRegistration(): Promise<boolean> {
  if (Platform.OS === "web") return false;
  const OneSignal = await ensureOneSignalInitialized();
  if (!OneSignal) {
    pushLog("skipped reason=OneSignal unavailable");
    return false;
  }

  const subscriptionId =
    (await resolvePushSubscriptionId(OneSignal)) ??
    (await waitForPushSubscriptionId(OneSignal, 12000));

  if (!subscriptionId) {
    pushLog("token registration skipped — subscription id pending");
    schedulePushRegistrationRetry();
    return false;
  }

  pushLog(`registering token userId=${_loggedInUserId ?? "unknown"} subscriptionId=${subscriptionId}`);
  await registerDeviceWithBackend(subscriptionId);
  return true;
}

// ── Register this device with our backend ─────────────────────────────────────
export async function registerDeviceWithBackend(subscriptionId?: string): Promise<void> {
  if (Platform.OS === "web") return;
  const OneSignal = await ensureOneSignalInitialized();
  if (!OneSignal) return;

  try {
    const resolvedId =
      subscriptionId ?? (await resolvePushSubscriptionId(OneSignal));
    if (!resolvedId) {
      pushLog("device register skipped — no subscription id yet");
      schedulePushRegistrationRetry();
      return;
    }

    const session = await getValidSession();
    if (!session) return;

    const res = await fetch(`${API_BASE}/api/push/register-device`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session}`,
      },
      body: JSON.stringify({
        onesignalSubscriptionId: resolvedId,
        devicePlatform: Platform.OS,
        appVersion: "1.0.0",
      }),
    });
    if (res.ok) {
      pushLog("device registered with backend");
    } else {
      pushLog(`device register failed status=${res.status}`);
    }
  } catch (error) {
    pushLog("device register error", error);
  }
}

// ── Opt device out of push (user disabled notifications) ─────────────────────
export async function optOutNotifications(): Promise<void> {
  if (Platform.OS === "web") return;
  const OneSignal = await ensureOneSignalInitialized();
  if (!OneSignal) return;
  try {
    await OneSignal.User.pushSubscription.optOut();
  } catch {
    // Ignore
  }
}

// ── Opt device back in (user re-enabled notifications) ───────────────────────
export async function optInNotifications(): Promise<void> {
  if (Platform.OS === "web") return;
  const OneSignal = await ensureOneSignalInitialized();
  if (!OneSignal) return;
  try {
    await OneSignal.User.pushSubscription.optIn();
  } catch {
    // Ignore
  }
}

// ── Disassociate user from device on logout ───────────────────────────────────
export async function logoutOneSignal(): Promise<void> {
  if (Platform.OS === "web" || !_initialized) return;
  const OneSignal = await ensureOneSignalInitialized();
  if (!OneSignal) return;
  try {
    await OneSignal.logout();
    _loggedInUserId = null;
    pushLog("logged out");
  } catch (error) {
    pushLog("logout failed", error);
  }
}

// ── Notification preferences from backend ────────────────────────────────────
export async function getNotificationPreferences(): Promise<boolean> {
  try {
    const session = await getValidSession();
    if (!session) return true;
    const res = await fetch(`${API_BASE}/api/me/notification-preferences`, {
      headers: { Authorization: `Bearer ${session}` },
    });
    if (!res.ok) return true;
    const data = (await res.json()) as { push_notifications_enabled?: boolean };
    return data.push_notifications_enabled ?? true;
  } catch {
    return true;
  }
}

export async function setNotificationPreferences(enabled: boolean): Promise<boolean> {
  try {
    const session = await getValidSession();
    if (!session) return enabled;
    const res = await fetch(`${API_BASE}/api/me/notification-preferences`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session}` },
      body: JSON.stringify({ push_notifications_enabled: enabled }),
    });
    if (!res.ok) return enabled;
    const data = (await res.json()) as { push_notifications_enabled?: boolean };
    return data.push_notifications_enabled ?? enabled;
  } catch {
    return enabled;
  }
}

/** Resolve push/deep-link payload to an expo-router path. */
export function routeFromPushPayload(
  data: Record<string, unknown>,
  launchUrl?: string,
): string | null {
  return resolveNotificationRoute(data, launchUrl);
}

// ── Set up notification click handler (routes taps to correct screen) ─────────
export async function setupNotificationClickHandler(
  navigate: (route: string) => void,
): Promise<() => void> {
  if (Platform.OS === "web") return () => {};
  const OneSignal = await ensureOneSignalInitialized();
  if (!OneSignal) return () => {};

  const handleClick: NotifEventHandler = (event) => {
    const clickEvent = event as NotificationClickEvent;
    const notif = clickEvent.notification;
    const rawData = notif.additionalData ?? {};
    // OneSignal v5 may nest custom data; flatten one level if needed
    const data = (
      typeof rawData === "object" &&
      rawData !== null &&
      "custom" in rawData &&
      typeof (rawData as { custom?: unknown }).custom === "object"
        ? { ...(rawData as Record<string, unknown>), ...((rawData as { custom: Record<string, unknown> }).custom) }
        : rawData
    ) as Record<string, unknown>;
    const launchUrl = notif.launchURL ?? notif.launchUrl;
    const route = resolveNotificationRoute(data, launchUrl);
    if (route) {
      pushLog(`notification click route=${route} type=${String(data.type ?? "unknown")}`);
      navigate(route);
      return;
    }
    pushLog("notification click — no route resolved", data);
  };

  OneSignal.Notifications.addEventListener("click", handleClick);
  return () => OneSignal.Notifications.removeEventListener("click", handleClick);
}

// ── Foreground notification handler ──────────────────────────────────────────
export async function setupForegroundHandler(): Promise<() => void> {
  if (Platform.OS === "web") return () => {};
  if (_foregroundHandlerCleanup) return _foregroundHandlerCleanup;

  const OneSignal = await ensureOneSignalInitialized();
  if (!OneSignal) return () => {};

  const handleForeground: NotifEventHandler = (event) => {
    const fgEvent = event as ForegroundWillDisplayEvent;
    const rawData = fgEvent.notification.additionalData ?? {};
    const data = (
      typeof rawData === "object" &&
      rawData !== null &&
      "custom" in rawData &&
      typeof (rawData as { custom?: unknown }).custom === "object"
        ? { ...(rawData as Record<string, unknown>), ...((rawData as { custom: Record<string, unknown> }).custom) }
        : rawData
    ) as Record<string, unknown>;
    const type = String(data.type ?? "unknown");
    const title = fgEvent.notification.title ?? "";
    pushLog(`foreground received type=${type} title=${title}`);
    // OneSignal v5: preventDefault + display() required to show system banner while app is open.
    fgEvent.preventDefault();
    fgEvent.notification.display();
  };

  OneSignal.Notifications.addEventListener("foregroundWillDisplay", handleForeground);
  const cleanup = () => OneSignal.Notifications.removeEventListener("foregroundWillDisplay", handleForeground);
  _foregroundHandlerCleanup = cleanup;
  pushLog("foreground handler registered");
  return cleanup;
}

// ── In-app notification helpers (unchanged) ───────────────────────────────────
export async function fetchNotifications(): Promise<
  Array<{ id: string; type: string; title: string; body: string; isRead: boolean; createdAt: string }>
> {
  try {
    const session = await getValidSession();
    if (!session) return [];
    const res = await fetch(`${API_BASE}/api/notifications`, {
      headers: { Authorization: `Bearer ${session}` },
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { notifications?: unknown[] };
    return (data.notifications ?? []) as ReturnType<typeof fetchNotifications> extends Promise<infer T>
      ? T
      : never;
  } catch {
    return [];
  }
}

export async function markNotificationRead(id: string): Promise<void> {
  const session = await getValidSession();
  if (!session) return;
  await fetch(`${API_BASE}/api/notifications/${id}/read`, {
    method: "POST",
    headers: { Authorization: `Bearer ${session}` },
  }).catch(() => {});
}

// ── Legacy compat shims ───────────────────────────────────────────────────────
/** @deprecated — use initOneSignal(userId) then registerDeviceWithBackend() */
export async function registerDevice(): Promise<void> {
  return registerDeviceWithBackend();
}

/** @deprecated — use logoutOneSignal() */
export async function unregisterDevice(): Promise<void> {
  return logoutOneSignal();
}
