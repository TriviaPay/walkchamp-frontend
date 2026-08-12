/**
 * Centralized step-tracking capability resolver.
 *
 * One shared classification for onboarding, paid-challenge eligibility, and
 * Unlimited verification-status UI. Does not hardcode Samsung Health as mandatory.
 */

import { Platform } from "react-native";
import { FEATURE_FLAGS } from "@/config/featureFlags";
import { hasActivityRecognitionPermission } from "@/services/permissions/activityRecognitionPermissionService";

import {
  resolvePaidChallengeEligibility,
  type PaidChallengeEligibility,
  type StepTrackingCapabilityStatus,
} from "./stepTrackingCapabilityLogic";

export type { PaidChallengeEligibility };
export { resolvePaidChallengeEligibility };

export type StepTrackingCapability = {
  platform: "android" | "ios";

  provisionalTrackingAvailable: boolean;

  verifiedHealthPlatform: "health_connect" | "healthkit" | null;

  verifiedHealthAvailable: boolean;
  verifiedPermissionGranted: boolean;
  verifiedRecordsAvailable: boolean;

  nativeOnDeviceHealthStepsSupported: boolean;

  externalWriterRequired: boolean;
  compatibleWriterDetected: boolean;

  verificationStatus: StepTrackingCapabilityStatus;

  /** Short user-facing message (no internal enums). */
  userMessage: string;
};

function loadPedometer(): {
  isAvailableAsync: () => Promise<boolean>;
} | null {
  try {
    const m = require("expo-sensors") as {
      Pedometer?: { isAvailableAsync: () => Promise<boolean> };
    };
    return m.Pedometer ?? null;
  } catch {
    return null;
  }
}

async function detectProvisionalAvailable(): Promise<boolean> {
  if (!FEATURE_FLAGS.ENABLE_LIVE_RACE_DEVICE_SENSOR) return false;
  if (Platform.OS === "android") {
    const arOk = await hasActivityRecognitionPermission().catch(() => false);
    if (!arOk) return false;
  }
  const ped = loadPedometer();
  if (!ped) return false;
  try {
    return await ped.isAvailableAsync();
  } catch {
    return false;
  }
}

/**
 * Resolve device step-tracking capability. Safe to call often; callers should
 * debounce UI refreshes themselves.
 */
export async function resolveStepTrackingCapability(): Promise<StepTrackingCapability> {
  const platform = Platform.OS === "ios" ? "ios" : "android";
  const provisionalTrackingAvailable = await detectProvisionalAvailable();

  if (platform === "ios") {
    return resolveIosCapability(provisionalTrackingAvailable);
  }
  return resolveAndroidCapability(provisionalTrackingAvailable);
}

async function resolveIosCapability(
  provisionalTrackingAvailable: boolean,
): Promise<StepTrackingCapability> {
  try {
    const { stepProviderManager } = await import(
      "@/services/steps/stepProviderManager"
    );
    const id = stepProviderManager.getActiveProviderId();
    const verifiedHealthAvailable = id === "ios_healthkit" || id != null;

    let permissionGranted = false;
    let recordsAvailable = false;
    try {
      permissionGranted = await stepProviderManager.isTrackingReady();
    } catch {
      permissionGranted = false;
    }
    try {
      const today = await stepProviderManager.getTodaySteps();
      recordsAvailable = !!today && Math.max(0, today.steps ?? 0) > 0;
    } catch {
      recordsAvailable = false;
    }

    let verificationStatus: StepTrackingCapability["verificationStatus"] =
      "unsupported";
    let userMessage =
      "This device cannot provide verified step data required for cash challenges.";

    if (!verifiedHealthAvailable) {
      verificationStatus = "unsupported";
    } else if (!permissionGranted) {
      verificationStatus = "permission_required";
      userMessage = "Allow step access to verify your daily activity.";
    } else if (!recordsAvailable) {
      verificationStatus = "sync_delayed";
      userMessage =
        "Your live steps are updating. Verified steps are still syncing.";
    } else {
      verificationStatus = "ready";
      userMessage =
        "Your device is connected and verified step tracking is active.";
    }

    return {
      platform: "ios",
      provisionalTrackingAvailable,
      verifiedHealthPlatform: verifiedHealthAvailable ? "healthkit" : null,
      verifiedHealthAvailable,
      verifiedPermissionGranted: permissionGranted,
      verifiedRecordsAvailable: recordsAvailable,
      nativeOnDeviceHealthStepsSupported: verifiedHealthAvailable,
      externalWriterRequired: false,
      compatibleWriterDetected: recordsAvailable,
      verificationStatus,
      userMessage,
    };
  } catch {
    return {
      platform: "ios",
      provisionalTrackingAvailable,
      verifiedHealthPlatform: null,
      verifiedHealthAvailable: false,
      verifiedPermissionGranted: false,
      verifiedRecordsAvailable: false,
      nativeOnDeviceHealthStepsSupported: false,
      externalWriterRequired: false,
      compatibleWriterDetected: false,
      verificationStatus: "unsupported",
      userMessage:
        "This device cannot provide verified step data required for cash challenges.",
    };
  }
}

async function resolveAndroidCapability(
  provisionalTrackingAvailable: boolean,
): Promise<StepTrackingCapability> {
  try {
    const { getAndroidStepTrackingStatus } = await import(
      "@/services/steps/androidStepTrackingStatus"
    );
    const { detectHealthConnectWriterFeed } = await import(
      "@/services/steps/healthConnectWriterDetection"
    );
    const { isWriterFeedSufficientlyConfigured } = await import(
      "@/services/steps/healthConnectWriterDetectionLogic"
    );

    const status = await getAndroidStepTrackingStatus(true);
    const hcSupported =
      status.status === "available" ||
      status.status === "permission_granted" ||
      status.status === "permission_denied" ||
      status.status === "provider_update_required" ||
      status.status === "provider_not_installed";

    if (
      !hcSupported ||
      status.status === "unsupported" ||
      status.status === "expo_go" ||
      status.status === "error"
    ) {
      return {
        platform: "android",
        provisionalTrackingAvailable,
        verifiedHealthPlatform: null,
        verifiedHealthAvailable: false,
        verifiedPermissionGranted: false,
        verifiedRecordsAvailable: false,
        nativeOnDeviceHealthStepsSupported: false,
        externalWriterRequired: false,
        compatibleWriterDetected: false,
        verificationStatus: "unsupported",
        userMessage: provisionalTrackingAvailable
          ? "This device does not currently support the verified health integration required for prize-based challenges."
          : "This device cannot provide the step data required for WalkChamp challenges.",
      };
    }

    const permissionGranted =
      status.permission === "granted" || status.permission === "authorized";

    if (!permissionGranted) {
      return {
        platform: "android",
        provisionalTrackingAvailable,
        verifiedHealthPlatform: "health_connect",
        verifiedHealthAvailable: true,
        verifiedPermissionGranted: false,
        verifiedRecordsAvailable: false,
        nativeOnDeviceHealthStepsSupported: true,
        externalWriterRequired: false,
        compatibleWriterDetected: false,
        verificationStatus: "permission_required",
        userMessage: "Allow step access to verify your daily activity.",
      };
    }

    const feed = await detectHealthConnectWriterFeed();
    const writerOk = isWriterFeedSufficientlyConfigured({
      readable: feed.readable,
      status: feed.status,
      hasHistoricalStepRecords: feed.hasHistoricalStepRecords,
      todaySteps: feed.todaySteps,
      dataOrigins: feed.detectedOrigins,
      recordCount: feed.recordCount,
      writerInstalled:
        feed.status === "installed_but_not_connected" ||
        feed.status === "waiting_for_sync" ||
        feed.status === "writer_detected",
    });
    const recordsAvailable =
      feed.todaySteps > 0 ||
      feed.detectedOrigins.length > 0 ||
      feed.hasHistoricalStepRecords ||
      feed.hasWriterEvidence;

    if (writerOk || recordsAvailable) {
      const syncDelayed =
        feed.todaySteps <= 0 &&
        provisionalTrackingAvailable &&
        (feed.status === "waiting_for_sync" || !feed.hasWriterEvidence);
      return {
        platform: "android",
        provisionalTrackingAvailable,
        verifiedHealthPlatform: "health_connect",
        verifiedHealthAvailable: true,
        verifiedPermissionGranted: true,
        verifiedRecordsAvailable: recordsAvailable,
        nativeOnDeviceHealthStepsSupported: true,
        externalWriterRequired: false,
        compatibleWriterDetected: true,
        verificationStatus: syncDelayed ? "sync_delayed" : "ready",
        userMessage: syncDelayed
          ? "Your live steps are updating. Verified steps are still syncing."
          : "Your device is connected and verified step tracking is active.",
      };
    }

    const writerInstalled =
      feed.status === "installed_but_not_connected" ||
      feed.status === "waiting_for_sync";

    return {
      platform: "android",
      provisionalTrackingAvailable,
      verifiedHealthPlatform: "health_connect",
      verifiedHealthAvailable: true,
      verifiedPermissionGranted: true,
      verifiedRecordsAvailable: false,
      nativeOnDeviceHealthStepsSupported: false,
      externalWriterRequired: true,
      compatibleWriterDetected: writerInstalled,
      verificationStatus: writerInstalled
        ? "temporarily_unavailable"
        : "provider_required",
      userMessage: writerInstalled
        ? "Your live steps are updating. Verified steps are still syncing."
        : "Connect a compatible health app so your steps can be verified.",
    };
  } catch {
    return {
      platform: "android",
      provisionalTrackingAvailable,
      verifiedHealthPlatform: null,
      verifiedHealthAvailable: false,
      verifiedPermissionGranted: false,
      verifiedRecordsAvailable: false,
      nativeOnDeviceHealthStepsSupported: false,
      externalWriterRequired: false,
      compatibleWriterDetected: false,
      verificationStatus: "unsupported",
      userMessage:
        "This device cannot provide verified step data required for cash challenges.",
    };
  }
}


