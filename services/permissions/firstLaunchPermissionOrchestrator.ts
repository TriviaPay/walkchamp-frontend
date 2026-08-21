/**
 * First-launch permission orchestrator.
 *
 * OS Health Connect / HealthKit access is per install (device), not per account.
 * Login on another account reuses the existing grant and must not re-open setup.
 * Uninstall clears OS grants + local flags, so a reinstall may ask again.
 *
 * Signup onboarding in progress → do not open home HC (onboarding owns it).
 * Never open over splash/login. Profile remains the manual entry point.
 */

import { AppState, Platform } from "react-native";
import {
  getDeviceStepSetupRecord,
  markDeviceStepSetupCompleted,
  markPermissionEducationShown,
  osStepAccessGranted,
} from "@/services/permissions/permissionCoordinator";
import {
  markHomeStepSetupPhaseDone,
  requestHomeStepAccess,
  requestHomeStepSetup,
  setHomeStepSetupInProgress,
} from "@/services/permissions/homePermissionFlow";
import { ENABLE_PREMIUM_ONBOARDING } from "@/config/featureFlags";
import { getOnboardingStatus } from "@/utils/onboardingStorage";
import { decideStepSetupPrompt } from "@/services/steps/stepSetupPromptDecision";

let firstLaunchRunning = false;

async function healthConnectMissingOrNeedsUpdate(): Promise<boolean> {
  if (Platform.OS !== "android") return false;
  try {
    const { getAndroidStepTrackingStatus } = await import(
      "@/services/steps/androidStepTrackingStatus"
    );
    const status = await getAndroidStepTrackingStatus(true);
    return (
      status.status === "provider_update_required"
    );
  } catch {
    return false;
  }
}

async function silentReuseDeviceStepAccess(
  userId: string,
  username?: string | null,
): Promise<void> {
  await markPermissionEducationShown(userId);
  await markDeviceStepSetupCompleted();
  markHomeStepSetupPhaseDone();
  try {
    const { stepProviderManager } = await import(
      "@/services/steps/stepProviderManager"
    );
    stepProviderManager.invalidateStatusCache();
    await stepProviderManager.initialize(true);
    const { activateStepTracking } = await import(
      "@/services/stepTrackingStartup"
    );
    await activateStepTracking({
      userId,
      username: username ?? null,
      requestPermission: false,
      skipOngoingNotificationPermission: true,
      firstSetupAllowAll: false,
    });
    void import("@/services/raceProgressNotificationService")
      .then((m) => m.raceProgressNotificationService.flushPendingStart())
      .catch(() => {});
  } catch {
    /* WalkContext init still picks up the OS grant */
  }
}

export async function runFirstLaunchPermissionFlow(options: {
  userId: string;
  username?: string | null;
}): Promise<void> {
  const { userId, username } = options;
  if (!userId?.trim()) return;
  if (firstLaunchRunning) return;
  firstLaunchRunning = true;

  try {
    if (ENABLE_PREMIUM_ONBOARDING) {
      const onboarding = await getOnboardingStatus();
      // Signup path — onboarding screens own HC; do not open home wizard yet.
      if (onboarding === "in_progress") {
        if (__DEV__) {
          console.log(
            "[Permission] first_launch deferred — signup onboarding in progress",
          );
        }
        markHomeStepSetupPhaseDone();
        return;
      }
    }

    if (AppState.currentState !== "active") {
      await new Promise<void>((resolve) => {
        const sub = AppState.addEventListener("change", (state) => {
          if (state === "active") {
            sub.remove();
            resolve();
          }
        });
      });
    }

    const osGranted = await osStepAccessGranted();
    const rec = await getDeviceStepSetupRecord();
    const hcMissing = await healthConnectMissingOrNeedsUpdate();
    const decision = decideStepSetupPrompt({
      osStepAccessGranted: osGranted,
      deviceSetupCompleted: rec.completed,
      healthConnectMissingOrNeedsUpdate: hcMissing,
      laterCount: rec.laterCount,
      snoozeUntilMs: rec.snoozeUntilMs,
      nowMs: Date.now(),
    });

    if (__DEV__) {
      console.log(
        `[Permission] first_launch decision=${decision} osGranted=${osGranted} deviceDone=${rec.completed} laterCount=${rec.laterCount} snoozeUntil=${rec.snoozeUntilMs} hcMissing=${hcMissing}`,
      );
    }

    if (decision === "skip_silent") {
      if (osGranted) {
        await silentReuseDeviceStepAccess(userId, username);
      } else {
        await markPermissionEducationShown(userId);
        markHomeStepSetupPhaseDone();
      }
      return;
    }

    if (decision === "grant_only") {
      setHomeStepSetupInProgress(true);
      requestHomeStepAccess({
        verificationStatus: "permission_required",
        healthConnectAvailable: true,
        readStepsPermissionGranted: false,
      });
      return;
    }

    setHomeStepSetupInProgress(true);
    requestHomeStepSetup();
  } catch (e) {
    if (__DEV__) console.log("[Permission] first_launch error", e);
    markHomeStepSetupPhaseDone();
  } finally {
    firstLaunchRunning = false;
  }
}
