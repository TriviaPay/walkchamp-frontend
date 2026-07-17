/**
 * First-launch permission orchestrator.
 *
 * Runs once per user+installation after auth + app startup are ready.
 * Reuses activateStepTracking (notifications → AR → HC/sensor/iOS) —
 * does NOT change provider selection, unsupported-device logic, or push flow.
 *
 * Push notifications remain owned by PushPermissionPrompt / runPostLoginPushSetup.
 */

import { AppState, Platform } from "react-native";
import { waitForAppStartupReady } from "@/services/appStartup";
import { activateStepTracking } from "@/services/stepTrackingStartup";
import { stepProviderManager } from "@/services/steps/stepProviderManager";
import { getDeviceCapabilitySnapshot } from "@/services/permissions/deviceCapability";
import {
  getDevicePermissionState,
  markPermissionEducationShown,
  wasPermissionEducationShown,
} from "@/services/permissions/permissionCoordinator";

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForForeground(): Promise<void> {
  if (AppState.currentState === "active") return;
  await new Promise<void>((resolve) => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        sub.remove();
        resolve();
      }
    });
  });
}

/**
 * Attempt the first-launch step/motion permission sequence for this user
 * on this installation. Safe to call multiple times.
 *
 * Subsequent logins on the same installation: re-check OS status; only request
 * missing permissions that can still be prompted — never treat another device's
 * grants as truth.
 */
export async function runFirstLaunchPermissionFlow(options: {
  userId: string;
  username?: string | null;
}): Promise<void> {
  const { userId, username } = options;
  if (!userId?.trim()) return;

  try {
    const snap = await getDeviceCapabilitySnapshot();
    const educationShown = await wasPermissionEducationShown(userId);

    await waitForAppStartupReady();
    await waitForForeground();
    await delay(Platform.OS === "ios" ? 1800 : 1200);
    if (AppState.currentState !== "active") return;

    // Always re-check native / provider readiness (never trust cached "granted").
    const permState = await getDevicePermissionState();
    const ready = await stepProviderManager.isTrackingReady().catch(() => false);

    if (__DEV__) {
      console.log(
        `[Permission] firstLoginOnInstallation=${!educationShown} provider=${snap.stepProvider} androidApiLevel=${snap.androidApiLevel ?? "n/a"} notificationRuntimeSupported=${snap.notificationRuntimePermissionSupported} allRequiredGranted=${permState.allRequiredGranted} trackingReady=${ready}`,
      );
    }

    if (ready && permState.allRequiredGranted) {
      if (__DEV__) console.log("[Permission] first_launch skipped — already tracking-ready");
      await markPermissionEducationShown(userId);
      return;
    }

    // Subsequent login: if education already shown and nothing requestable, skip prompts.
    if (educationShown && ready) {
      await markPermissionEducationShown(userId);
      return;
    }

    if (__DEV__) {
      console.log(
        `[Permission] flowStarted source=first_launch platform=${Platform.OS} userId=${userId.slice(0, 8)}…`,
      );
    }

    const result = await activateStepTracking({
      userId,
      username: username ?? null,
      requestPermission: true,
    });

    if (__DEV__) {
      console.log(
        `[Permission] first_launch done success=${result.success} provider=${result.providerId ?? "none"} permission=${result.permission}`,
      );
    }

    await markPermissionEducationShown(userId);
  } catch (e) {
    if (__DEV__) console.log("[Permission] first_launch error", e);
    await markPermissionEducationShown(userId).catch(() => {});
  }
}
