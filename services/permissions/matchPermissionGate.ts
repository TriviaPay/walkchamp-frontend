/**
 * Match join/host permission gate.
 *
 * All challenges (free + reward) require verified Health Connect / HealthKit.
 * Prefer opening the existing WearableSetupModal via onSetupRequired.
 */

import { Alert, Linking, Platform } from "react-native";
import { activateStepTracking } from "@/services/stepTrackingStartup";
import { stepProviderManager } from "@/services/steps/stepProviderManager";
import { openNotificationSettings } from "@/services/permissions/notificationGate";
import {
  requireVerifiedStepTracking,
  type VerifiedStepProviderResult,
} from "@/services/steps/verifiedStepCapability";
import { isDeviceRaceViewOnlyNow } from "@/services/permissions/permissionCoordinator";

export type MatchPermissionGateResult = {
  allowed: boolean;
  /** True if we already showed UI and should not continue the action. */
  blocked: boolean;
};

export const DEVICE_RACE_VIEW_ONLY_TITLE = "Step tracking required";
export const DEVICE_RACE_VIEW_ONLY_BODY =
  "You can still browse WalkChamp. Enable step tracking from Profile or the health icon on Walk to join or create races.";

export function alertDeviceRaceViewOnly(): void {
  Alert.alert(DEVICE_RACE_VIEW_ONLY_TITLE, DEVICE_RACE_VIEW_ONLY_BODY, [
    { text: "OK" },
  ]);
}

function openAppSettings(): void {
  if (Platform.OS === "android") {
    void openNotificationSettings().catch(() => {
      void Linking.openSettings();
    });
    return;
  }
  void Linking.openSettings();
}

/**
 * Ensure verified step tracking is ready before join/host (including free).
 * Calls onSetupRequired (open WearableSetupModal) when unverified.
 */
export async function ensureMatchStepPermissionsReady(options: {
  userId: string;
  username?: string | null;
  /**
   * @deprecated Always verified for all races. Kept for call-site compatibility.
   */
  requireVerified?: boolean;
  actionLabel?: string;
  /** Open existing WearableSetupModal — preferred over Alert-only UX. */
  onSetupRequired?: (result?: VerifiedStepProviderResult) => void;
}): Promise<MatchPermissionGateResult> {
  const {
    userId,
    username,
    actionLabel = "join this challenge",
    onSetupRequired,
  } = options;

  if (!userId?.trim()) {
    return { allowed: false, blocked: true };
  }

  if (await isDeviceRaceViewOnlyNow()) {
    alertDeviceRaceViewOnly();
    if (__DEV__) console.log(`[Permission] matchGate action=${actionLabel} allowed=false reason=view_only`);
    return { allowed: false, blocked: true };
  }

  try {
    await stepProviderManager.initialize().catch(() => null);
    let ready = await stepProviderManager.isTrackingReady().catch(() => false);
    let verified = stepProviderManager.usesVerifiedStepSource();

    if (!ready || !verified) {
      // Soft-retry activation once (Health Connect / HealthKit only — no sensor).
      if (__DEV__) console.log(`[Permission] requestStarted name=step_tracking source=match_gate`);
      const result = await activateStepTracking({
        userId,
        username: username ?? null,
        requestPermission: true,
      });
      if (__DEV__) {
        console.log(
          `[Permission] requestResult name=step_tracking success=${result.success} provider=${result.providerId ?? "none"}`,
        );
      }

      ready = result.success || (await stepProviderManager.isTrackingReady().catch(() => false));
      verified = stepProviderManager.usesVerifiedStepSource();

      if (!ready || !verified) {
        const blocked =
          !!result.notificationBlocked ||
          !!result.activityRecognitionBlocked ||
          result.permission === "denied";

        if (blocked && !onSetupRequired) {
          Alert.alert(
            "Permission Disabled",
            "Permission is disabled in your device settings. Open Settings and enable it to continue.",
            [
              { text: "Cancel", style: "cancel" },
              { text: "Open Settings", onPress: () => openAppSettings() },
            ],
          );
          if (__DEV__) console.log(`[Permission] matchGate action=${actionLabel} allowed=false`);
          return { allowed: false, blocked: true };
        }

        // Prefer WearableSetupModal for reconnect / install / grant flows.
        let setupHandled = false;
        await requireVerifiedStepTracking({
          action: actionLabel,
          onAllowed: () => {
            setupHandled = true;
          },
          onSetupRequired: (capability) => {
            if (onSetupRequired) {
              onSetupRequired(capability);
            } else {
              Alert.alert(
                "Verified Step Tracking Required",
                Platform.OS === "ios"
                  ? "Connect Apple Health to join or create challenges."
                  : "Connect Health Connect to join or create challenges.",
              );
            }
          },
        });
        if (setupHandled) {
          if (__DEV__) console.log(`[Permission] matchGate action=${actionLabel} allowed=true`);
          return { allowed: true, blocked: false };
        }
        if (__DEV__) console.log(`[Permission] matchGate action=${actionLabel} allowed=false reason=not_verified`);
        return { allowed: false, blocked: true };
      }
    }

    // Final verified gate (covers free + paid).
    let allowed = false;
    await requireVerifiedStepTracking({
      action: actionLabel,
      onAllowed: () => {
        allowed = true;
      },
      onSetupRequired: (capability) => {
        if (onSetupRequired) {
          onSetupRequired(capability);
        } else {
          Alert.alert(
            "Verified Step Tracking Required",
            Platform.OS === "ios"
              ? "Connect Apple Health to join or create challenges."
              : "Connect Health Connect to join or create challenges.",
          );
        }
      },
    });

    if (__DEV__) {
      console.log(
        `[Permission] matchGate action=${actionLabel} allowed=${allowed}`,
      );
    }
    return { allowed, blocked: !allowed };
  } catch (e) {
    if (__DEV__) console.log("[Permission] matchGate error", e);
    if (onSetupRequired) {
      onSetupRequired();
    } else {
      Alert.alert("Permissions Required", "Unable to verify step tracking. Please try again.");
    }
    return { allowed: false, blocked: true };
  }
}
