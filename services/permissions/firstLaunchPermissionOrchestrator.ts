/**
 * First-launch permission orchestrator.
 *
 * Signup + premium onboarding in progress → do not open HC (onboarding owns HC).
 * After onboarding HC step (accepted / skipped / denied) → never auto-open again.
 * Login (home tabs ready) → show Health Connect / Apple Health only if still needed
 * and the user has never been through setup education.
 * Never open over splash/login. Profile remains the manual entry point.
 */

import { AppState, Platform } from "react-native";
import {
  markPermissionEducationShown,
  wasPermissionEducationShown,
} from "@/services/permissions/permissionCoordinator";
import {
  markHomeStepSetupPhaseDone,
  requestHomeStepSetup,
  setHomeStepSetupInProgress,
} from "@/services/permissions/homePermissionFlow";
import { ENABLE_PREMIUM_ONBOARDING } from "@/config/featureFlags";
import {
  getHealthOnboardingChoice,
  getOnboardingStatus,
} from "@/utils/onboardingStorage";

/**
 * True when Android still needs the HC setup wizard (install / update / grant READ).
 * Skip when READ_STEPS is already granted.
 */
async function androidNeedsHealthConnectSetup(): Promise<boolean> {
  if (Platform.OS !== "android") return false;
  try {
    const { getAndroidStepTrackingStatus } = await import(
      "@/services/steps/androidStepTrackingStatus"
    );
    const status = await getAndroidStepTrackingStatus(true);
    if (status.status === "permission_granted") return false;
    return (
      status.status === "provider_update_required" ||
      status.status === "provider_not_installed" ||
      status.status === "available" ||
      status.status === "permission_denied" ||
      status.status === "error" ||
      status.status === "unsupported" ||
      status.status === "expo_go"
    );
  } catch {
    // Transient HC status errors must not force the wizard open.
    return false;
  }
}

async function iosNeedsHealthSetup(): Promise<boolean> {
  if (Platform.OS !== "ios") return false;
  try {
    const { stepProviderManager } = await import(
      "@/services/steps/stepProviderManager"
    );
    await stepProviderManager.initialize();
    // Already granted → never force WearableSetup again after onboarding/login.
    return !(await stepProviderManager.isTrackingReady());
  } catch {
    return false;
  }
}

export async function runFirstLaunchPermissionFlow(options: {
  userId: string;
  username?: string | null;
}): Promise<void> {
  const { userId } = options;
  if (!userId?.trim()) return;

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
      // User already completed the onboarding HC step (connect / maybe later / denied).
      // Never open a second WearableSetupModal on home after Enter Walk Champ.
      if (onboarding === "completed") {
        const healthChoice = await getHealthOnboardingChoice();
        if (healthChoice != null) {
          if (__DEV__) {
            console.log(
              `[Permission] first_launch skipped — onboarding HC already handled (${healthChoice})`,
            );
          }
          await markPermissionEducationShown(userId);
          markHomeStepSetupPhaseDone();
          return;
        }
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

    // Already walked through (or dismissed) setup → never auto-open again.
    const educationShown = await wasPermissionEducationShown(userId);
    if (educationShown) {
      if (__DEV__) {
        console.log(
          "[Permission] first_launch skipped — setup already completed/dismissed",
        );
      }
      markHomeStepSetupPhaseDone();
      return;
    }

    let needsHcSetup = false;
    if (Platform.OS === "android") {
      needsHcSetup = await androidNeedsHealthConnectSetup();
    } else if (Platform.OS === "ios") {
      needsHcSetup = await iosNeedsHealthSetup();
    }

    if (!needsHcSetup) {
      if (__DEV__) {
        console.log("[Permission] first_launch skipped — health already granted");
      }
      await markPermissionEducationShown(userId);
      markHomeStepSetupPhaseDone();
      return;
    }

    if (__DEV__) {
      console.log(
        `[Permission] flowStarted source=login_hc_setup platform=${Platform.OS}`,
      );
    }

    setHomeStepSetupInProgress(true);
    // Queues until splash dismissed + home shell ready — never over splash.
    requestHomeStepSetup();
  } catch (e) {
    if (__DEV__) console.log("[Permission] first_launch error", e);
    markHomeStepSetupPhaseDone();
  }
}
