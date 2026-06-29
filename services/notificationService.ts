import { Platform, PermissionsAndroid } from "react-native";
import Constants from "expo-constants";
import { getValidSession } from "./authService";
import { resolveNotificationRoute } from "@/utils/deepLinkUtils";

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
  addEventListener: (event: "change", handler: (event: PushSubscriptionChangedState) => void) => void;
  removeEventListener: (event: "change", handler: (event: PushSubscriptionChangedState) => void) => void;
}

interface PushSubscriptionChangedState {
  previous: { id?: string; optedIn: boolean };
  current: { id?: string; optedIn: boolean };
}

interface NotificationClickEvent {
  result?: { url?: string };
  notification: {
    additionalData?: Record<string, unknown>;
    launchURL?: string;
    title?: string;
    body?: string;
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

interface OneSignalV5 {
  initialize: (appId: string) => void;
  login: (externalId: string) => void;
  logout: () => void;
  Notifications: {
    requestPermission: (fallbackToSettings?: boolean) => Promise<boolean>;
    getPermissionAsync: () => Promise<boolean>;
    canRequestPermission: () => Promise<boolean>;
    addEventListener: (
      event: "click" | "foregroundWillDisplay" | "permissionChange",
      handler: NotifEventHandler | ((granted: boolean) => void),
    ) => void;
    removeEventListener: (
      event: "click" | "foregroundWillDisplay" | "permissionChange",
      handler: NotifEventHandler | ((granted: boolean) => void),
    ) => void;
  };
  User: {
    pushSubscription: PushSubscription;
    addTags: (tags: Record<string, string>) => void;
  };
}

export type OneSignalUserInfo = {
  id: string;
  username?: string;
  country?: string;
};

async function getOneSignal(): Promise<OneSignalV5 | null> {
  if (Platform.OS === "web") return null;
  if (IS_EXPO_GO) return null;
  try {
    const mod = await import("react-native-onesignal");
    const sdk = ((mod as Record<string, unknown>).OneSignal ?? mod.default ?? mod) as OneSignalV5;
    if (!sdk?.Notifications?.addEventListener) return null;
    return sdk;
  } catch {
    return null;
  }
}

let _initialized = false;
let _initPromise: Promise<OneSignalV5 | null> | null = null;
let _loggedInUserId: string | null = null;
let _pendingDeepLink: string | null = null;
let _foregroundCleanup: (() => void) | null = null;
let _subscriptionCleanup: (() => void) | null = null;

export function getPendingDeepLink(): string | null {
  return _pendingDeepLink;
}

export function clearPendingDeepLink(): void {
  _pendingDeepLink = null;
}

export function setPendingDeepLink(route: string): void {
  _pendingDeepLink = route;
}

export async function ensureOneSignalInitialized(): Promise<OneSignalV5 | null> {
  if (_initPromise) return _initPromise;

  _initPromise = (async () => {
    const appId = process.env.EXPO_PUBLIC_ONESIGNAL_APP_ID;
    if (!appId || Platform.OS === "web") return null;

    const OneSignal = await getOneSignal();
    if (!OneSignal) return null;

    if (!_initialized) {
      OneSignal.initialize(appId);
      _initialized = true;
      if (__DEV__) console.log("[OneSignal] initialization complete");
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return OneSignal;
  })();

  return _initPromise;
}

async function requestAndroidNotificationPermission(): Promise<boolean> {
  if (Platform.OS !== "android" || Platform.Version < 33) return true;
  try {
    const result = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
    );
    return result === PermissionsAndroid.RESULTS.GRANTED;
  } catch {
    return false;
  }
}

// ── Initialize OneSignal and associate authenticated user ─────────────────────
export async function initOneSignal(user: OneSignalUserInfo): Promise<void> {
  if (!user?.id) return;
  const OneSignal = await ensureOneSignalInitialized();
  if (!OneSignal) return;

  try {
    if (_loggedInUserId !== user.id) {
      OneSignal.login(user.id);
      _loggedInUserId = user.id;
      if (__DEV__) console.log("[OneSignal] login", user.id);
    }

    OneSignal.User.addTags({
      user_id: user.id,
      username: user.username ?? "",
      platform: Platform.OS,
      country: user.country ?? "",
      push_registered: "true",
    });
  } catch {
    // Never crash on notification setup
  }
}

// ── Request push notification permission ──────────────────────────────────────
export async function requestNotificationPermission(): Promise<boolean> {
  if (Platform.OS === "web") return false;
  const OneSignal = await ensureOneSignalInitialized();
  if (!OneSignal) return false;
  try {
    if (Platform.OS === "android") {
      await requestAndroidNotificationPermission();
    }
    const granted = await OneSignal.Notifications.requestPermission(true);
    if (__DEV__) console.log("[OneSignal] permission status", granted);
    return granted;
  } catch {
    return false;
  }
}

// ── Check current permission without prompting ────────────────────────────────
export async function hasNotificationPermission(): Promise<boolean> {
  if (Platform.OS === "web") return false;
  const OneSignal = await ensureOneSignalInitialized();
  if (!OneSignal) return false;
  try {
    return await OneSignal.Notifications.getPermissionAsync();
  } catch {
    return false;
  }
}

// ── Prompt permission once after login when prefs allow (non-spammy) ─────────
let _permissionPromptedForUser: string | null = null;

export async function ensurePushPermissionIfNeeded(userId: string, prefsEnabled: boolean): Promise<void> {
  if (!prefsEnabled || !userId) return;
  if (_permissionPromptedForUser === userId) return;

  const OneSignal = await ensureOneSignalInitialized();
  if (!OneSignal) return;

  try {
    const hasPermission = await OneSignal.Notifications.getPermissionAsync();
    if (hasPermission) {
      _permissionPromptedForUser = userId;
      return;
    }
    const canRequest = await OneSignal.Notifications.canRequestPermission();
    if (!canRequest) {
      _permissionPromptedForUser = userId;
      return;
    }
    _permissionPromptedForUser = userId;
    await requestNotificationPermission();
  } catch {
    // Permission denied must not crash
  }
}

// ── Register this device with our backend ─────────────────────────────────────
export async function registerDeviceWithBackend(): Promise<void> {
  if (Platform.OS === "web") return;
  const OneSignal = await ensureOneSignalInitialized();
  if (!OneSignal) return;

  try {
    const subscriptionId = OneSignal.User.pushSubscription.id;
    if (!subscriptionId) return;

    const session = await getValidSession();
    if (!session) return;

    const appVersion = Constants.expoConfig?.version ?? "1.0.1";

    await fetch(`${API_BASE}/api/push/register-device`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session}`,
      },
      body: JSON.stringify({
        onesignalSubscriptionId: subscriptionId,
        devicePlatform: Platform.OS,
        appVersion,
      }),
    });
  } catch {
    // Best-effort registration
  }
}

async function setupSubscriptionChangeListener(): Promise<() => void> {
  const OneSignal = await ensureOneSignalInitialized();
  if (!OneSignal) return () => {};

  const onChange = (event: PushSubscriptionChangedState) => {
    if (event.current.id) {
      void registerDeviceWithBackend();
    }
  };

  OneSignal.User.pushSubscription.addEventListener("change", onChange);
  return () => OneSignal.User.pushSubscription.removeEventListener("change", onChange);
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
    OneSignal.logout();
    _loggedInUserId = null;
    _permissionPromptedForUser = null;
    _foregroundCleanup?.();
    _foregroundCleanup = null;
    _subscriptionCleanup?.();
    _subscriptionCleanup = null;
  } catch {
    // Ignore
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

function handleNotificationOpen(
  data: Record<string, unknown>,
  launchUrl: string | undefined,
  navigate: (route: string) => void,
  isAuthenticated: boolean,
): void {
  const route = resolveNotificationRoute(data, launchUrl);
  if (!route) return;

  if (__DEV__) {
    console.log("[OneSignal] notification opened", { type: data.type, route });
  }

  if (!isAuthenticated) {
    setPendingDeepLink(route);
    return;
  }

  navigate(route);
}

// ── Set up notification click handler (routes taps to correct screen) ─────────
export async function setupNotificationClickHandler(
  navigate: (route: string) => void,
  isAuthenticated: () => boolean,
): Promise<() => void> {
  if (Platform.OS === "web") return () => {};
  const OneSignal = await ensureOneSignalInitialized();
  if (!OneSignal) return () => {};

  const handleClick: NotifEventHandler = (event) => {
    const clickEvent = event as NotificationClickEvent;
    const data = (clickEvent.notification.additionalData ?? {}) as Record<string, unknown>;
    const launchUrl = clickEvent.result?.url ?? clickEvent.notification.launchURL;
    handleNotificationOpen(data, launchUrl, navigate, isAuthenticated());
  };

  OneSignal.Notifications.addEventListener("click", handleClick);
  return () => OneSignal.Notifications.removeEventListener("click", handleClick);
}

// ── Foreground notification handler ──────────────────────────────────────────
export async function setupForegroundHandler(
  getCurrentRoute?: () => string | undefined,
): Promise<() => void> {
  if (Platform.OS === "web") return () => {};
  const OneSignal = await ensureOneSignalInitialized();
  if (!OneSignal) return () => {};

  const handleForeground: NotifEventHandler = (event) => {
    const fgEvent = event as ForegroundWillDisplayEvent;
    const data = (fgEvent.notification.additionalData ?? {}) as Record<string, unknown>;
    const route = resolveNotificationRoute(data);
    const currentRoute = getCurrentRoute?.() ?? "";

    if (__DEV__) {
      console.log("[OneSignal] notification received foreground", { type: data.type, route });
    }

    // Skip banner when user is already on the target screen
    if (route && currentRoute && currentRoute.includes(route.split("?")[0])) {
      return;
    }

    fgEvent.notification.display();
  };

  OneSignal.Notifications.addEventListener("foregroundWillDisplay", handleForeground);
  return () => OneSignal.Notifications.removeEventListener("foregroundWillDisplay", handleForeground);
}

export async function setupPushSubscriptionListener(): Promise<() => void> {
  _subscriptionCleanup?.();
  _subscriptionCleanup = await setupSubscriptionChangeListener();
  return _subscriptionCleanup;
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
/** @deprecated — use initOneSignal(user) then registerDeviceWithBackend() */
export async function registerDevice(): Promise<void> {
  return registerDeviceWithBackend();
}

/** @deprecated — use logoutOneSignal() */
export async function unregisterDevice(): Promise<void> {
  return logoutOneSignal();
}
