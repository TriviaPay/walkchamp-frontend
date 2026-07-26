/**
 * First-launch permission orchestrator.
 *
 * Signup + premium onboarding in progress → do not open HC (onboarding owns the path).
 * Login (home tabs ready) → show Health Connect / Apple Health setup only if still needed.
 * Never open over splash/login, and never open-then-dismiss (confused flash).
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
import { getOnboardingStatus } from "@/utils/onboardingStorage";

/**
 * True when Android still needs the HC setup wizard (install / update / grant READ).
 * Skip only when permission is already granted.
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
    return true;
  }
}

export async function runFirstLaunchPermissionFlow(options: {
  userId: string;
  username?: string | null;
}): Promise<void> {
  const { userId } = options;
  if (!userId?.trim()) return;

  try {
    // Signup → continue onboarding screens; HC setup comes after onboarding.
    if (ENABLE_PREMIUM_ONBOARDING) {
      const onboarding = await getOnboardingStatus();
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

    // Check BEFORE opening — never flash the wizard then hide it.
    const educationShown = await wasPermissionEducationShown(userId);
    let needsHcSetup = Platform.OS === "android";
    if (Platform.OS === "android") {
      needsHcSetup = await androidNeedsHealthConnectSetup();
    } else {
      needsHcSetup = !educationShown;
    }

    if (!needsHcSetup) {
      if (__DEV__) {
        console.log("[Permission] first_launch skipped — HC already set up");
      }
      await markPermissionEducationShown(userId);
      markHomeStepSetupPhaseDone();
      return;
    }

    if (__DEV__) {
      console.log(
        `[Permission] flowStarted source=login_hc_setup platform=${Platform.OS} educationShown=${educationShown}`,
      );
    }

    setHomeStepSetupInProgress(true);
    // Queues until splash/login shell is ready — no overlay on splash.
    requestHomeStepSetup();
  } catch (e) {
    if (__DEV__) console.log("[Permission] first_launch error", e);
    markHomeStepSetupPhaseDone();
  }
}
