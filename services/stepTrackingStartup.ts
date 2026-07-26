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

let activateChain: Promise<void> = Promise.resolve();

export async function activateStepTracking(options: {
  userId: string;
  username?: string | null;
  /** Request HC / HealthKit / sensor permission if not yet granted. */
  requestPermission?: boolean;
  /** Skip HC and use legacy TYPE_STEP_COUNTER only. */
  limitedSensorOnly?: boolean;
  /** Skip ongoing-notification permission during setup (e.g. wearable wizard). */
  skipOngoingNotificationPermission?: boolean;
  /**
   * First HC / HealthKit setup — request notifications + activity recognition
   * ("allow all") regardless of prior Profile preference. Preference is then
   * saved from the OS result; later changes use the Profile toggle only.
   */
  firstSetupAllowAll?: boolean;
}): Promise<StepTrackingEnableResult> {
  // Serialize enables: wait for prior attempt, then always run this request.
  // Returning a shared in-flight promise broke "Enable Step Tracking" after a
  // failed first-launch attempt (user received the stale failure).
  const run = async (): Promise<StepTrackingEnableResult> => {
    const {
      userId,
      username,
      requestPermission = true,
      limitedSensorOnly = false,
      skipOngoingNotificationPermission = false,
      firstSetupAllowAll = false,
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
      console.log(
        `[Steps] enable requested firstSetupAllowAll=${firstSetupAllowAll}`,
      );
      setStepProgressUser(userId, username ?? null);

      let notificationBlocked = false;
      let notificationMessage: string | undefined;

      // Profile toggle preference — ignored during firstSetupAllowAll.
      let userWantsNotifications = true;
      if (!firstSetupAllowAll) {
        try {
          const { getNotificationPreferences } = await import(
            "@/services/notificationService"
          );
          userWantsNotifications = await getNotificationPreferences();
        } catch {
          userWantsNotifications = true;
        }
      }

      const shouldAskNotifications =
        Platform.OS === "android" &&
        !skipOngoingNotificationPermission &&
        (firstSetupAllowAll || userWantsNotifications);

      if (shouldAskNotifications) {
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
        // Persist choice so Profile toggle + future enables stay in sync.
        try {
          const { setNotificationPreferences } = await import(
            "@/services/notificationService"
          );
          await setNotificationPreferences(!!notif.granted);
          const { STORAGE_KEYS, storageSet } = await import("@/utils/storage");
          await storageSet(STORAGE_KEYS.PUSH_PERMISSION_PROMPTED, true);
        } catch {
          /* ignore */
        }
      } else if (!userWantsNotifications) {
        console.log(
          "[Steps] notifications skipped — user preference is off (Profile toggle)",
        );
      }

      if (Platform.OS === "android") {
        const { FEATURE_FLAGS } = await import("@/config/featureFlags");
        const hybrid = FEATURE_FLAGS.ENABLE_LIVE_RACE_DEVICE_SENSOR === true;
        const { hasActivityRecognitionPermission } = await import(
          "@/services/permissions/activityRecognitionPermissionService"
        );

        if (limitedSensorOnly) {
          // Phone-sensor daily path needs ACTIVITY_RECOGNITION.
          const activityGranted = await ensureActivityRecognitionPermission();
          console.log(
            `[Steps] activity recognition granted=${activityGranted} limitedSensor=true`,
          );
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
        } else if (firstSetupAllowAll) {
          // First HC setup "allow all": ask Physical activity once here (after Done),
          // never during Enable Step Tracking. Do not fail HC if user denies —
          // verified steps still work; FGS/live race may be limited.
          const already = await hasActivityRecognitionPermission();
          if (already) {
            console.log(
              "[Steps] activity recognition alreadyGranted=true firstSetupAllowAll=true",
            );
          } else {
            const activityGranted = await ensureActivityRecognitionPermission();
            console.log(
              `[Steps] activity recognition granted=${activityGranted} firstSetupAllowAll=true`,
            );
          }
        } else if (hybrid) {
          // Later enables: never re-prompt AR (Profile/Walk must not loop the modal).
          const already = await hasActivityRecognitionPermission();
          console.log(
            `[Steps] activity recognition alreadyGranted=${already} hybrid=true (no re-prompt)`,
          );
        } else {
          // Non-hybrid legacy: request once if missing.
          const activityGranted = await ensureActivityRecognitionPermission();
          console.log(
            `[Steps] activity recognition granted=${activityGranted} hybrid=false`,
          );
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
      }

      let permission: PermissionStatus = "unavailable";
      let providerId: StepProviderId | null = null;

      if (limitedSensorOnly) {
        const { FEATURE_FLAGS } = await import("@/config/featureFlags");
        if (FEATURE_FLAGS.ENABLE_LIVE_RACE_DEVICE_SENSOR) {
          return {
            success: false,
            permission: "unavailable",
            providerId: null,
            ongoingNotificationEnabled: false,
            message:
              "Health Connect is required for verified daily tracking. Phone sensors are used for live races only.",
          };
        }
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
      if (Platform.OS === "android") {
        if (!firstSetupAllowAll && !userWantsNotifications) {
          ongoingNotificationEnabled = false;
        } else if (!skipOngoingNotificationPermission || firstSetupAllowAll) {
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
        } else {
          ongoingNotificationEnabled = await hasOngoingNotificationAccess();
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
  };

  const resultPromise = activateChain.then(run, run);
  activateChain = resultPromise.then(
    () => undefined,
    () => undefined,
  );
  return resultPromise;
}
