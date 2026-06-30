/**
 * Ordered, crash-safe step tracking enablement for fresh install / first enable.
 */

import { Platform } from "react-native";
import { stepProviderManager } from "@/services/steps/stepProviderManager";
import type { StepProviderId } from "@/services/steps/stepProviderTypes";
import { setStepProgressUser } from "@/services/stepProgressCoordinator";
import { ensureNotificationPermissionForOngoingTracking } from "@/services/permissions/notificationPermissionService";
import type { PermissionStatus } from "@/services/StepTrackingService";

export type StepTrackingEnableResult = {
  success: boolean;
  permission: PermissionStatus;
  providerId: StepProviderId | null;
  ongoingNotificationEnabled: boolean;
  message?: string;
};

export async function activateStepTracking(options: {
  userId: string;
  username?: string | null;
  /** Request HC / HealthKit / sensor permission if not yet granted. */
  requestPermission?: boolean;
  /** Skip HC and use legacy TYPE_STEP_COUNTER only. */
  limitedSensorOnly?: boolean;
}): Promise<StepTrackingEnableResult> {
  const {
    userId,
    username,
    requestPermission = true,
    limitedSensorOnly = false,
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

    let ongoingNotificationEnabled = true;
    if (Platform.OS === "android") {
      const perm = await ensureNotificationPermissionForOngoingTracking();
      ongoingNotificationEnabled = perm.granted;
      console.log(
        `[Steps] notification permission for FGS granted=${ongoingNotificationEnabled} requestedNow=${perm.requestedNow}`,
      );
      if (!ongoingNotificationEnabled) {
        console.log(
          "[Steps] notification permission not granted — ongoing notification will not start",
        );
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
          ongoingNotificationEnabled,
          message: "Limited sensor mode is Android only.",
        };
      }
      const ok = await stepProviderManager.switchToLegacyFallback("user_enabled");
      if (!ok) {
        return {
          success: false,
          permission: "unavailable",
          providerId: null,
          ongoingNotificationEnabled,
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
          ongoingNotificationEnabled,
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
          ongoingNotificationEnabled,
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
}
