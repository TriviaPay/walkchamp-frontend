/**
 * Android OneSignal rich-notification visual helpers.
 * Backend / OneSignal dashboard should send drawable resource names (not Expo paths).
 *
 * Example additionalData:
 * {
 *   "notificationType": "race_starting_soon",
 *   "visualType": "upcoming_race"
 * }
 *
 * Example Android fields (OneSignal REST) — optional when the app extension is installed:
 * large_icon: "notification_walkchamp_brand"
 * big_picture: "notification_upcoming_race"  // or https URL
 * small_icon: "ic_stat_onesignal_default" (monochrome; app default if omitted)
 *
 * Client-side Android: WalkChampNotificationServiceExtension
 *   brand → large icon, type illustration → big picture.
 * Client-side iOS NSE: attaches type illustration as rich media.
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
  /** WalkChamp brand drawable (large icon). */
  large_icon: string;
  /** Type-specific illustration drawable (big picture). */
  big_picture_drawable: string;
  /** Never send Expo asset paths as Android resource names. */
  brandAssetPathForDocsOnly: string;
} {
  const visualType = resolveNotificationVisualType(
    input.visualType ?? input.type ?? "default",
  );
  return {
    visualType,
    large_icon: ANDROID_ONESIGNAL_BRAND_LARGE_ICON,
    big_picture_drawable: notificationVisualDrawableName(visualType),
    brandAssetPathForDocsOnly: WALKCHAMP_NOTIFICATION_BRAND_ICON,
  };
}
