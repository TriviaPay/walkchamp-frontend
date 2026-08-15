/**
 * Android OneSignal rich-notification visual helpers.
 * Backend / OneSignal dashboard should send drawable resource names (not Expo paths).
 *
 * Right-side large icon = type illustration (notification_race_started, notification_chat, …).
 * Never the launcher / app icon. Do not send big_picture for these assets — that makes them huge.
 *
 * Example additionalData:
 * {
 *   "notificationType": "race_started",
 *   "visualType": "race_started"
 * }
 *
 * Example Android fields (OneSignal REST):
 * large_icon: "notification_race_started"
 * small_icon: "ic_stat_onesignal_default"
 *
 * Client-side Android: WalkChampNotificationServiceExtension sets large icon from visualType.
 * Client-side iOS NSE: attaches type illustration as rich media thumbnail.
 */
import {
  notificationVisualDrawableName,
  resolveNotificationVisualType,
  type NotificationVisualType,
  WALKCHAMP_NOTIFICATION_BRAND_ICON,
} from "@/constants/notificationVisuals";

export const ANDROID_ONESIGNAL_BRAND_LARGE_ICON = "notification_walkchamp_brand";
export const ANDROID_ONESIGNAL_SMALL_ICON = "ic_stat_onesignal_default";

export function androidOneSignalVisualPayload(input: {
  type?: string | null;
  visualType?: string | null;
}): {
  visualType: NotificationVisualType;
  /** Type-specific illustration (right-side large icon). */
  large_icon: string;
  /** @deprecated Type art must not be used as big_picture (renders huge). */
  big_picture_drawable: string;
  /** Never send Expo asset paths as Android resource names. */
  brandAssetPathForDocsOnly: string;
} {
  const visualType = resolveNotificationVisualType(
    input.visualType ?? input.type ?? "default",
  );
  const typeDrawable = notificationVisualDrawableName(visualType);
  return {
    visualType,
    large_icon: typeDrawable,
    big_picture_drawable: typeDrawable,
    brandAssetPathForDocsOnly: WALKCHAMP_NOTIFICATION_BRAND_ICON,
  };
}
