/**
 * Permission coordinator — device-specific status + education keys.
 * OS APIs remain the source of truth; local flags only track education/attempts.
 */

import { Platform } from "react-native";
import { getInstallationId } from "@/services/deviceIdentity";
import { getDeviceCapabilitySnapshot } from "@/services/permissions/deviceCapability";
import { getNotificationPermissionStatus } from "@/services/permissions/notificationPermissionService";
import { STORAGE_KEYS, storageGet, storageSet } from "@/utils/storage";
import { stepProviderManager } from "@/services/steps/stepProviderManager";

export type PermissionStatus =
  | "not_requested"
  | "granted"
  | "denied"
  | "blocked"
  | "limited"
  | "restricted"
  | "unsupported";

export type PermissionSlot = {
  required: boolean;
  supported: boolean;
  status: PermissionStatus;
  canAskAgain: boolean;
};

export type DevicePermissionState = {
  installationId: string;
  platform: "android" | "ios" | "web";
  osVersion: string;
  androidApiLevel?: number;
  stepProvider: string;
  notifications: PermissionSlot;
  activityRecognition: PermissionSlot;
  healthConnectSteps: PermissionSlot;
  motionFitness: PermissionSlot;
  location: PermissionSlot;
  microphone: PermissionSlot;
  missingRequiredPermissions: string[];
  allRequiredGranted: boolean;
};

function educationKey(userId: string, installationId: string): string {
  return `${STORAGE_KEYS.FIRST_PERMISSION_FLOW}:${userId}:${installationId}`;
}

export async function wasPermissionEducationShown(
  userId: string,
): Promise<boolean> {
  const installationId = await getInstallationId();
  const v = await storageGet<boolean>(educationKey(userId, installationId));
  if (v) return true;
  // Migrate legacy per-user key (pre-installation scoping) once.
  const legacy = await storageGet<boolean>(
    `${STORAGE_KEYS.FIRST_PERMISSION_FLOW}:${userId}`,
  );
  if (legacy) {
    await storageSet(educationKey(userId, installationId), true);
    return true;
  }
  return false;
}

export async function markPermissionEducationShown(userId: string): Promise<void> {
  const installationId = await getInstallationId();
  await storageSet(educationKey(userId, installationId), true);
}

function mapNotifStatus(s: string): PermissionStatus {
  if (s === "granted") return "granted";
  if (s === "denied") return "denied";
  if (s === "unavailable") return "unsupported";
  return "not_requested";
}

export async function getDevicePermissionState(): Promise<DevicePermissionState> {
  const snap = await getDeviceCapabilitySnapshot();
  const notifStatus = mapNotifStatus(await getNotificationPermissionStatus());

  const notifSupported = snap.notificationRuntimePermissionSupported || Platform.OS === "android";
  // Notifications are recommended; match eligibility uses step tracking (existing product rule).
  const notifications: PermissionSlot = {
    required: false,
    supported: notifSupported,
    status:
      Platform.OS === "android" && !snap.notificationRuntimePermissionSupported
        ? notifStatus === "granted"
          ? "granted"
          : "denied"
        : notifStatus,
    canAskAgain: notifStatus !== "granted" && snap.notificationRuntimePermissionSupported,
  };

  let activityRecognition: PermissionSlot = {
    required: snap.activityRecognitionSupported && snap.platform === "android",
    supported: snap.activityRecognitionSupported,
    status: snap.activityRecognitionSupported ? "not_requested" : "unsupported",
    canAskAgain: snap.activityRecognitionSupported,
  };

  let healthConnectSteps: PermissionSlot = {
    required: snap.stepProvider === "health_connect",
    supported: snap.healthConnectStatus === "available",
    status:
      snap.healthConnectStatus === "available"
        ? "not_requested"
        : "unsupported",
    canAskAgain: snap.healthConnectStatus === "available",
  };

  let motionFitness: PermissionSlot = {
    required: snap.platform === "ios",
    supported: snap.motionPermissionSupported,
    status: snap.motionPermissionSupported ? "not_requested" : "unsupported",
    canAskAgain: snap.motionPermissionSupported,
  };

  try {
    await stepProviderManager.initialize().catch(() => null);
    const ready = await stepProviderManager.isTrackingReady().catch(() => false);
    const perm = await stepProviderManager
      .getActiveProvider()
      ?.getPermissionStatus()
      .catch(() => "unknown");

    if (ready || perm === "granted") {
      if (snap.platform === "android") {
        activityRecognition = { ...activityRecognition, status: "granted", canAskAgain: false };
        if (snap.stepProvider === "health_connect") {
          healthConnectSteps = { ...healthConnectSteps, status: "granted", canAskAgain: false };
        }
      } else {
        motionFitness = { ...motionFitness, status: "granted", canAskAgain: false };
      }
    } else if (perm === "denied") {
      if (snap.platform === "android") {
        activityRecognition = { ...activityRecognition, status: "denied" };
        if (snap.stepProvider === "health_connect") {
          healthConnectSteps = { ...healthConnectSteps, status: "denied" };
        }
      } else {
        motionFitness = { ...motionFitness, status: "denied" };
      }
    }
  } catch {
    /* keep defaults */
  }

  const location: PermissionSlot = {
    required: false,
    supported: false,
    status: "unsupported",
    canAskAgain: false,
  };
  const microphone: PermissionSlot = {
    required: false,
    supported: false,
    status: "unsupported",
    canAskAgain: false,
  };

  const missing: string[] = [];
  if (activityRecognition.required && activityRecognition.status !== "granted") {
    missing.push("activity_recognition");
  }
  if (healthConnectSteps.required && healthConnectSteps.status !== "granted") {
    missing.push("health_connect_steps");
  }
  if (motionFitness.required && motionFitness.status !== "granted") {
    missing.push("motion_fitness");
  }

  const state: DevicePermissionState = {
    installationId: snap.installationId,
    platform: snap.platform,
    osVersion: snap.osVersion,
    androidApiLevel: snap.androidApiLevel,
    stepProvider: snap.stepProvider,
    notifications,
    activityRecognition,
    healthConnectSteps,
    motionFitness,
    location,
    microphone,
    missingRequiredPermissions: missing,
    allRequiredGranted: missing.length === 0,
  };

  if (__DEV__) {
    console.log(
      `[Permission] name=notifications status=${notifications.status} name=activity_recognition status=${activityRecognition.status} name=health_connect_steps status=${healthConnectSteps.status} name=motion_fitness status=${motionFitness.status} allRequiredGranted=${state.allRequiredGranted}`,
    );
  }

  return state;
}
