/**
 * Ordered, crash-safe step tracking enablement for fresh install / first enable.
 *
 * Android order (matches git): notifications → activity recognition → step source.
 * Notifications are requested but never block step polling (same as WalkContext cold start).
 * iOS: HealthKit only.
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

  const pending = (async (): Promise<StepTrackingEnableResult> => {
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

      let notificationBlocked = false;
      let notificationMessage: string | undefined;

      // Ask for notifications (Android 13+ prompts; ≤12 auto). Never abort step enable —
      // cold start already polls without FGS when notifications are off.
      if (Platform.OS === "android" && !skipOngoingNotificationPermission) {
        const notifMode = limitedSensorOnly ? "auto" : "strict";
        const notif = await ensureNotificationPermissionForOngoingTracking(notifMode);
        console.log(
          `[Steps] notification gate mode=${notifMode} granted=${notif.granted} requestedNow=${notif.requestedNow} blockedBySettings=${notif.blockedBySettings ?? false}`,
        );
        if (!notif.granted) {
          notificationBlocked = true;
          notificationMessage = notif.message;
          console.log(
            "[Steps] notifications unavailable — continuing with polling-only tracking",
          );
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
            notificationBlocked,
            message: result.message,
          };
        }
      } else {
        await stepProviderManager.initialize(true);
        const status = await stepProviderManager.refreshStatus();
        permission = status.permission as PermissionStatus;
        providerId = status.providerId;
        console.log(
          `[Steps] existing permission=${permission} provider=${providerId ?? "none"}`,
        );
        if (permission !== "granted") {
          return {
            success: false,
            permission,
            providerId,
            ongoingNotificationEnabled: false,
            notificationBlocked,
          };
        }
      }

      let ongoingNotificationEnabled = Platform.OS !== "android";
      if (Platform.OS === "android" && !skipOngoingNotificationPermission) {
        ongoingNotificationEnabled = await hasOngoingNotificationAccess();
        console.log(
          `[Steps] final notification access for FGS enabled=${ongoingNotificationEnabled}`,
        );
        if (!ongoingNotificationEnabled) {
          notificationBlocked = true;
          notificationMessage =
            notificationMessage ??
            "Notifications are still turned off. Steps still track; enable notifications for the ongoing tracker.";
        }
      }

      await stepProviderManager.initialize(true);
      await stepProviderManager.getTodaySteps().catch(() => null);

      console.log(
        `[Steps] tracking activated successfully provider=${providerId ?? "none"} fgs=${ongoingNotificationEnabled}`,
      );
      return {
        success: true,
        permission: "granted",
        providerId,
        ongoingNotificationEnabled,
        notificationBlocked: notificationBlocked || undefined,
        message: notificationBlocked ? notificationMessage : undefined,
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

  activateInFlight = pending;
  return pending;
}
