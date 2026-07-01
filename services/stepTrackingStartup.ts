/**
 * Ordered, crash-safe step tracking enablement for fresh install / first enable.
 *
 * Android order: notifications → activity recognition → step source (HC / sensor).
 */

import { Platform } from "react-native";
import { stepProviderManager } from "@/services/steps/stepProviderManager";
import type { StepProviderId } from "@/services/steps/stepProviderTypes";
import { setStepProgressUser } from "@/services/stepProgressCoordinator";
import { ensureNotificationPermissionForOngoingTracking } from "@/services/permissions/notificationPermissionService";
import { hasOngoingNotificationAccess } from "@/services/permissions/notificationGate";
import {
  ensureActivityRecognitionPermission,
  getActivityRecognitionDeniedMessage,
} from "@/services/permissions/activityRecognitionPermissionService";
import type { PermissionStatus } from "@/services/StepTrackingService";

export type StepTrackingEnableResult = {
  success: boolean;
  permission: PermissionStatus;
  providerId: StepProviderId | null;
  ongoingNotificationEnabled: boolean;
  notificationBlocked?: boolean;
  activityRecognitionBlocked?: boolean;
  message?: string;
};

let activateInFlight: Promise<StepTrackingEnableResult> | null = null;

export async function activateStepTracking(options: {
  userId: string;
  username?: string | null;
  /** Request HC / HealthKit / sensor permission if not yet granted. */
  requestPermission?: boolean;
  /** Skip HC and use legacy TYPE_STEP_COUNTER only. */
  limitedSensorOnly?: boolean;
  /** Skip ongoing-notification permission during setup (e.g. wearable wizard). */
  skipOngoingNotificationPermission?: boolean;
}): Promise<StepTrackingEnableResult> {
  if (activateInFlight) {
    console.log("[Steps] enable skipped — already in flight");
    return activateInFlight;
  }

  activateInFlight = (async () => {
    const {
      userId,
      username,
      requestPermission = true,
      limitedSensorOnly = false,
      skipOngoingNotificationPermission = false,
    } = options;

    if (!userId?.trim()) {
      console.log("[Steps] failed to enable — missing userId");
      return {
        success: false,
        permission: "unavailable",
        providerId: null,
        ongoingNotificationEnabled: false,
        message: "Sign in to enable step tracking.",
      };
    }

    try {
      console.log("[Steps] enable requested");
      setStepProgressUser(userId, username ?? null);

      if (Platform.OS === "android" && !skipOngoingNotificationPermission) {
        const notif = await ensureNotificationPermissionForOngoingTracking();
        console.log(
          `[Steps] notification gate granted=${notif.granted} requestedNow=${notif.requestedNow} blockedBySettings=${notif.blockedBySettings ?? false}`,
        );
        if (!notif.granted) {
          const status = await stepProviderManager.refreshStatus();
          return {
            success: false,
            permission: status.permission as PermissionStatus,
            providerId: status.providerId,
            ongoingNotificationEnabled: false,
            notificationBlocked: true,
            message: notif.message,
          };
        }
      }

      if (Platform.OS === "android") {
        const activityGranted = await ensureActivityRecognitionPermission();
        console.log(`[Steps] activity recognition granted=${activityGranted}`);
        if (!activityGranted) {
          const status = await stepProviderManager.refreshStatus();
          return {
            success: false,
            permission: status.permission as PermissionStatus,
            providerId: status.providerId,
            ongoingNotificationEnabled: false,
            activityRecognitionBlocked: true,
            message: getActivityRecognitionDeniedMessage(),
          };
        }
      }

      let permission: PermissionStatus = "unavailable";
      let providerId: StepProviderId | null = null;

      if (limitedSensorOnly) {
        if (Platform.OS !== "android") {
          return {
            success: false,
            permission: "unavailable",
            providerId: null,
            ongoingNotificationEnabled: false,
            message: "Limited sensor mode is Android only.",
          };
        }
        const ok = await stepProviderManager.switchToLegacyFallback("user_enabled");
        if (!ok) {
          return {
            success: false,
            permission: "unavailable",
            providerId: null,
            ongoingNotificationEnabled: false,
            message: "Phone step sensor is not available on this device.",
          };
        }
        permission = "granted";
        providerId = "android_legacy_sensor";
      } else if (requestPermission) {
        const result = await stepProviderManager.requestStepPermission();
        permission = result.status as PermissionStatus;
        providerId = result.providerId;
        console.log(
          `[Steps] step permission result=${permission} provider=${providerId ?? "none"}`,
        );
        if (permission !== "granted") {
          return {
            success: false,
            permission,
            providerId,
            ongoingNotificationEnabled: false,
            message: result.message,
          };
        }
      } else {
        await stepProviderManager.initialize(true);
        const status = await stepProviderManager.refreshStatus();
        permission = status.permission as PermissionStatus;
        providerId = status.providerId;
        if (permission !== "granted") {
          return {
            success: false,
            permission,
            providerId,
            ongoingNotificationEnabled: false,
          };
        }
      }

      let ongoingNotificationEnabled = true;
      if (Platform.OS === "android" && !skipOngoingNotificationPermission) {
        ongoingNotificationEnabled = await hasOngoingNotificationAccess();
        console.log(
          `[Steps] final notification access for FGS enabled=${ongoingNotificationEnabled}`,
        );
        if (!ongoingNotificationEnabled) {
          return {
            success: false,
            permission: "granted",
            providerId,
            ongoingNotificationEnabled: false,
            notificationBlocked: true,
            message:
              "Notifications are still turned off. Please enable them to use ongoing step tracking.",
          };
        }
      }

      await stepProviderManager.initialize(true);
      await stepProviderManager.getTodaySteps().catch(() => null);

      console.log("[Steps] tracking activated successfully");
      return {
        success: true,
        permission: "granted",
        providerId,
        ongoingNotificationEnabled,
      };
    } catch (error) {
      console.log("[Steps] failed to enable step tracking", error);
      return {
        success: false,
        permission: "unavailable",
        providerId: null,
        ongoingNotificationEnabled: false,
        message: error instanceof Error ? error.message : "Step tracking failed.",
      };
    }
  })().finally(() => {
    activateInFlight = null;
  });

  return activateInFlight;
}
