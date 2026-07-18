import { Platform } from "react-native";
import { requireOptionalExpoNativeModule } from "@/utils/expoNativeModule";

export const ANDROID_NOTIFICATION_CHANNELS = {
  STEPS_ONGOING: "walkchamp_steps_ongoing",
  RACE_LIVE: "walkchamp_race_live",
} as const;

type AndroidNotificationNative = {
  areAppNotificationsEnabled?: () => Promise<boolean>;
  openAppNotificationSettings?: () => Promise<boolean>;
  openNotificationChannelSettings?: (channelId: string) => Promise<boolean>;
  openStepNotificationChannelSettings?: () => Promise<boolean>;
  openRaceNotificationChannelSettings?: () => Promise<boolean>;
};

let cachedNative: AndroidNotificationNative | null | undefined;

function getNativeModule(): AndroidNotificationNative | null {
  if (cachedNative !== undefined) return cachedNative;
  cachedNative =
    requireOptionalExpoNativeModule<AndroidNotificationNative>(
      "WalkChampRaceProgress",
    ) ?? null;
  return cachedNative;
}

export function formatWalkOngoingNotificationBody(steps: number): string {
  const safe = Math.max(0, Math.floor(steps));
  // ASCII separator only — avoids mojibake on some Android OEM notification renderers.
  return `Tracking your steps - ${safe.toLocaleString("en-US")} steps today`;
}

/** App-level notification master toggle (Samsung allowNoti, etc.). */
export async function areAppNotificationsEnabled(): Promise<boolean> {
  if (Platform.OS !== "android") return true;
  const native = getNativeModule();
  if (!native?.areAppNotificationsEnabled) {
    console.log("[NotificationAccess] native areAppNotificationsEnabled unavailable");
    return true;
  }
  try {
    return await native.areAppNotificationsEnabled();
  } catch (error) {
    console.log("[NotificationAccess] areAppNotificationsEnabled failed", error);
    return true;
  }
}

export async function openAppNotificationSettings(): Promise<boolean> {
  if (Platform.OS !== "android") return false;
  const native = getNativeModule();
  if (!native?.openAppNotificationSettings) return false;
  try {
    return (await native.openAppNotificationSettings()) === true;
  } catch (error) {
    console.log("[NotificationAccess] openAppNotificationSettings failed", error);
    return false;
  }
}

export async function openNotificationChannelSettings(channelId: string): Promise<boolean> {
  if (Platform.OS !== "android") return false;
  const native = getNativeModule();
  if (!native?.openNotificationChannelSettings) return false;
  try {
    return (await native.openNotificationChannelSettings(channelId)) === true;
  } catch (error) {
    console.log("[NotificationAccess] openNotificationChannelSettings failed", error);
    return false;
  }
}

export async function openStepsOngoingChannelSettings(): Promise<boolean> {
  if (Platform.OS !== "android") return false;
  const native = getNativeModule();
  if (native?.openStepNotificationChannelSettings) {
    try {
      return (await native.openStepNotificationChannelSettings()) === true;
    } catch {
      // fall through to generic channel opener
    }
  }
  return openNotificationChannelSettings(ANDROID_NOTIFICATION_CHANNELS.STEPS_ONGOING);
}

export async function openRaceLiveChannelSettings(): Promise<boolean> {
  if (Platform.OS !== "android") return false;
  const native = getNativeModule();
  if (native?.openRaceNotificationChannelSettings) {
    try {
      return (await native.openRaceNotificationChannelSettings()) === true;
    } catch {
      // fall through to generic channel opener
    }
  }
  return openNotificationChannelSettings(ANDROID_NOTIFICATION_CHANNELS.RACE_LIVE);
}
