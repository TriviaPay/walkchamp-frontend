/**
 * Match join/host permission gate.
 *
 * Reuses activateStepTracking + stepProviderManager — no new provider logic.
 * Blocks only the match action when steps are not ready; does not navigate away.
 *
 * requireVerified=true for cash/coins/sponsored reward races (existing product rule).
 * Free challenges only need a working step source (verified OR limited sensor).
 */

import { Alert, Linking, Platform } from "react-native";
import { activateStepTracking } from "@/services/stepTrackingStartup";
import { stepProviderManager } from "@/services/steps/stepProviderManager";
import { openNotificationSettings } from "@/services/permissions/notificationGate";

export type MatchPermissionGateResult = {
  allowed: boolean;
  /** True if we already showed UI and should not continue the action. */
  blocked: boolean;
};

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
 * Ensure step-tracking permissions are ready before join/host.
 * Shows a clear alert when missing; optionally requests permissions once.
 */
export async function ensureMatchStepPermissionsReady(options: {
  userId: string;
  username?: string | null;
  /** Reward races need Health Connect / Apple Health (verified). */
  requireVerified?: boolean;
  actionLabel?: string;
}): Promise<MatchPermissionGateResult> {
  const {
    userId,
    username,
    requireVerified = false,
    actionLabel = "join this challenge",
  } = options;

  if (!userId?.trim()) {
    return { allowed: false, blocked: true };
  }

  try {
    await stepProviderManager.initialize().catch(() => null);
    let ready = await stepProviderManager.isTrackingReady().catch(() => false);
    let verified = stepProviderManager.usesVerifiedStepSource();

    if (!ready) {
      const proceed = await new Promise<boolean>((resolve) => {
        Alert.alert(
          "Permissions Required",
          `WalkChamp needs motion and step-tracking access to measure your race progress accurately before you can ${actionLabel}.`,
          [
            { text: "Not Now", style: "cancel", onPress: () => resolve(false) },
            {
              text: "Allow Permissions",
              onPress: () => resolve(true),
            },
          ],
        );
      });

      if (!proceed) {
        if (__DEV__) console.log(`[Permission] matchGate action=${actionLabel} allowed=false reason=user_declined_prompt`);
        return { allowed: false, blocked: true };
      }

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

      if (!ready) {
        const blocked =
          !!result.notificationBlocked ||
          !!result.activityRecognitionBlocked ||
          result.permission === "denied";

        if (blocked) {
          Alert.alert(
            "Permission Disabled",
            "Permission is disabled in your device settings. Open Settings and enable it to continue.",
            [
              { text: "Cancel", style: "cancel" },
              { text: "Open Settings", onPress: () => openAppSettings() },
            ],
          );
        } else {
          Alert.alert(
            "Permissions Required",
            result.message ??
              "Step tracking is not available yet. Complete wearable setup from the Walk or Profile screen, then try again.",
          );
        }
        if (__DEV__) console.log(`[Permission] matchGate action=${actionLabel} allowed=false`);
        return { allowed: false, blocked: true };
      }
    }

    if (requireVerified && !verified) {
      Alert.alert(
        "Verified Step Tracking Required",
        "Limited tracking (phone sensor) cannot be used for cash, coins battles, sponsored rewards, or prize races.\n\nPlease connect Health Connect or Apple Health to continue.",
      );
      if (__DEV__) console.log(`[Permission] matchGate action=${actionLabel} allowed=false reason=not_verified`);
      return { allowed: false, blocked: true };
    }

    if (__DEV__) console.log(`[Permission] matchGate action=${actionLabel} allowed=true`);
    return { allowed: true, blocked: false };
  } catch (e) {
    if (__DEV__) console.log("[Permission] matchGate error", e);
    Alert.alert("Permissions Required", "Unable to verify step tracking. Please try again.");
    return { allowed: false, blocked: true };
  }
}
