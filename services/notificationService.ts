import { Platform } from "react-native";
import Constants from "expo-constants";
import { getValidSession } from "./authService";

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
}

interface NotificationClickEvent {
  notification: {
    additionalData?: Record<string, unknown>;
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

// ── Initialize OneSignal and associate authenticated user ─────────────────────
export async function initOneSignal(userId: string): Promise<void> {
  const appId = process.env.EXPO_PUBLIC_ONESIGNAL_APP_ID;
  if (!appId || Platform.OS === "web") return;

  const OneSignal = await getOneSignal();
  if (!OneSignal) return;

  try {
    if (!_initialized) {
      OneSignal.initialize(appId);
      _initialized = true;
    }
    await OneSignal.login(userId);
  } catch {
    // Never crash on notification setup
  }
}

// ── Request push notification permission ──────────────────────────────────────
// Returns true if permission was granted, false if denied or unavailable
export async function requestNotificationPermission(): Promise<boolean> {
  if (Platform.OS === "web") return false;
  const OneSignal = await getOneSignal();
  if (!OneSignal) return false;
  try {
    return await OneSignal.Notifications.requestPermission(true);
  } catch {
    return false;
  }
}

// ── Check current permission without prompting ────────────────────────────────
export async function hasNotificationPermission(): Promise<boolean> {
  if (Platform.OS === "web") return false;
  const OneSignal = await getOneSignal();
  if (!OneSignal) return false;
  try {
    return await OneSignal.Notifications.getPermissionAsync();
  } catch {
    return false;
  }
}

// ── Register this device with our backend ─────────────────────────────────────
export async function registerDeviceWithBackend(): Promise<void> {
  if (Platform.OS === "web") return;
  const OneSignal = await getOneSignal();
  if (!OneSignal) return;

  try {
    const subscriptionId = OneSignal.User.pushSubscription.id;
    if (!subscriptionId) return;

    const session = await getValidSession();
    if (!session) return;

    await fetch(`${API_BASE}/api/push/register-device`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session}`,
      },
      body: JSON.stringify({
        onesignalSubscriptionId: subscriptionId,
        devicePlatform: Platform.OS,
        appVersion: "1.0.0",
      }),
    });
  } catch {
    // Best-effort registration
  }
}

// ── Opt device out of push (user disabled notifications) ─────────────────────
export async function optOutNotifications(): Promise<void> {
  if (Platform.OS === "web") return;
  const OneSignal = await getOneSignal();
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
  const OneSignal = await getOneSignal();
  if (!OneSignal) return;
  try {
    await OneSignal.User.pushSubscription.optIn();
  } catch {
    // Ignore
  }
}

// ── Disassociate user from device on logout ───────────────────────────────────
export async function logoutOneSignal(): Promise<void> {
  if (Platform.OS === "web") return;
  const OneSignal = await getOneSignal();
  if (!OneSignal) return;
  try {
    await OneSignal.logout();
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

// ── Set up notification click handler (routes taps to correct screen) ─────────
export async function setupNotificationClickHandler(
  navigate: (route: string) => void,
): Promise<() => void> {
  if (Platform.OS === "web") return () => {};
  const OneSignal = await getOneSignal();
  if (!OneSignal) return () => {};

  const handleClick: NotifEventHandler = (event) => {
    const data = (event as NotificationClickEvent).notification.additionalData as
      | Record<string, string>
      | undefined;
    if (!data?.type) return;

    const { type, room_id, event_id } = data;

    switch (type) {
      case "race_invite":
      case "race_starting":
      case "race_joined":
      case "coins_battle_joined":
        navigate(room_id ? `/race/${room_id}` : "/(tabs)/walk");
        break;
      case "race_finished":
        navigate(room_id ? `/race/${room_id}` : "/(tabs)/walk");
        break;
      case "reward_ready":
      case "withdrawal_approved":
        navigate("/(tabs)/wallet");
        break;
      case "friend_request":
      case "friend_request_accepted":
        navigate("/(tabs)/chat");
        break;
      case "group_invite":
        navigate("/(tabs)/walk");
        break;
      case "sponsored_event_reminder":
        navigate(event_id ? `/sponsored-event/${event_id}` : "/(tabs)/walk");
        break;
      default:
        navigate("/(tabs)/walk");
    }
  };

  OneSignal.Notifications.addEventListener("click", handleClick);
  return () => OneSignal.Notifications.removeEventListener("click", handleClick);
}

// ── Foreground notification handler ──────────────────────────────────────────
export async function setupForegroundHandler(): Promise<() => void> {
  if (Platform.OS === "web") return () => {};
  const OneSignal = await getOneSignal();
  if (!OneSignal) return () => {};

  const handleForeground: NotifEventHandler = (event) => {
    // Show the banner even in foreground — Pusher handles live race UI updates
    // but push is still useful for out-of-context messages (e.g. friend request
    // while user is on the Leaderboard screen)
    (event as ForegroundWillDisplayEvent).notification.display();
  };

  OneSignal.Notifications.addEventListener("foregroundWillDisplay", handleForeground);
  return () => OneSignal.Notifications.removeEventListener("foregroundWillDisplay", handleForeground);
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
