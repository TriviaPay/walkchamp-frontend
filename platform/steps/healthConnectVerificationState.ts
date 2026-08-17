/**
 * Centralized Health Connect / HealthKit verification-state model.
 *
 * This is a thin composition layer over the EXISTING detection primitives —
 * it does not duplicate writer/provider detection. It exists so callers
 * (notification gating, in-app status text, diagnostics) can ask a single
 * question — "what state is verified health tracking in?" — instead of each
 * re-deriving permission vs. writer-evidence vs. record-count logic.
 *
 * Reused, not reimplemented:
 *  - services/steps/androidHealthConnectService.ts (availability + permission)
 *  - services/steps/healthConnectWriterDetection.ts (writer/provider evidence)
 *  - services/steps/healthConnectWriterDetectionLogic.ts (pure classification)
 */

import { Platform } from "react-native";
import { androidHCService } from "@/services/steps/androidHealthConnectService";
import {
  detectHealthConnectWriterFeed,
  isWriterFeedSufficientlyConfigured,
} from "@/services/steps/healthConnectWriterDetection";
import {
  resolveHealthConnectVerificationStatus,
  describeHealthConnectVerificationStatus,
  isVerifiedHealthAuthoritative,
  type HealthConnectVerificationStatus,
} from "@/services/steps/healthConnectVerificationStateLogic";

export type { HealthConnectVerificationStatus };
export {
  describeHealthConnectVerificationStatus,
  isVerifiedHealthAuthoritative,
  resolveHealthConnectVerificationStatus,
};

export type HealthConnectVerificationState = {
  healthConnectAvailable: boolean;
  readStepsPermissionGranted: boolean;
  setupCompleted: boolean;

  writerEvidenceDetected: boolean;
  /** Preferred writer app is installed (Samsung Health / Google Fit), even if HC has no records yet. */
  writerInstalled: boolean;
  /** Preferred writer package is actually writing into Health Connect. */
  writerConnectedToHealthConnect: boolean;
  preferredWriterLabel: string | null;
  currentDayRecordsFound: boolean;
  currentDayVerifiedSteps: number;

  status: HealthConnectVerificationStatus;
};

const UNSUPPORTED_STATE: HealthConnectVerificationState = {
  healthConnectAvailable: false,
  readStepsPermissionGranted: false,
  setupCompleted: false,
  writerEvidenceDetected: false,
  writerInstalled: false,
  writerConnectedToHealthConnect: false,
  preferredWriterLabel: null,
  currentDayRecordsFound: false,
  currentDayVerifiedSteps: 0,
  status: "unsupported",
};

/**
 * Resolve the current verification state for the active platform.
 *
 * IMPORTANT: `permission_status = connected` (READ_STEPS granted) is never
 * treated as proof that step records exist — `writerEvidenceDetected` and
 * `currentDayRecordsFound` are derived independently from an HC probe.
 * Likewise, `currentDayVerifiedSteps = 0` is never treated as proof that no
 * writer exists — that is `provider_required`, a distinct status from
 * `records_zero` / `sync_delayed` (writer present, nothing recorded yet).
 */
export async function getHealthConnectVerificationState(): Promise<HealthConnectVerificationState> {
  if (Platform.OS === "android") {
    try {
      const init = await androidHCService.initialize();
      const healthConnectAvailable = init.initialized && init.availability === "available";
      if (!healthConnectAvailable) {
        return {
          ...UNSUPPORTED_STATE,
          status:
            init.availability === "not_installed" || init.availability === "needs_update"
              ? "provider_required"
              : "unsupported",
        };
      }

      const permission = await androidHCService.getPermissionStatus();
      const readStepsPermissionGranted = permission === "granted";
      if (!readStepsPermissionGranted) {
        return {
          healthConnectAvailable,
          readStepsPermissionGranted: false,
          setupCompleted: false,
          writerEvidenceDetected: false,
          writerInstalled: false,
          writerConnectedToHealthConnect: false,
          preferredWriterLabel: null,
          currentDayRecordsFound: false,
          currentDayVerifiedSteps: 0,
          status: "permission_required",
        };
      }

      // Reuse the existing writer-detection probe — the single source of
      // truth for "does HC actually have step data from some provider".
      const feed = await detectHealthConnectWriterFeed();
      const writerEvidenceDetected = feed.hasWriterEvidence;
      const currentDayRecordsFound = feed.todaySteps > 0 || feed.hasRecentStepRecords;
      const setupCompleted = isWriterFeedSufficientlyConfigured(feed);
      const status = resolveHealthConnectVerificationStatus({
        writerStatus: feed.status,
        writerEvidenceDetected,
        currentDayRecordsFound,
      });

      const writerInstalled = feed.writerInstalled === true;
      const writerConnectedToHealthConnect = writerEvidenceDetected;

      return {
        healthConnectAvailable,
        readStepsPermissionGranted,
        setupCompleted,
        writerEvidenceDetected,
        writerInstalled,
        writerConnectedToHealthConnect,
        preferredWriterLabel: feed.selectedWriterLabel ?? null,
        currentDayRecordsFound,
        currentDayVerifiedSteps: Math.max(0, feed.todaySteps),
        status,
      };
    } catch {
      return { ...UNSUPPORTED_STATE, status: "error" };
    }
  }

  if (Platform.OS === "ios") {
    try {
      const { stepTracker } = await import("@/services/StepTrackingService");
      const permStatus = await stepTracker.getPermissionStatus();
      const readStepsPermissionGranted = permStatus === "granted";
      if (!readStepsPermissionGranted) {
        return {
          healthConnectAvailable: true,
          readStepsPermissionGranted: false,
          setupCompleted: false,
          writerEvidenceDetected: false,
          writerInstalled: false,
          writerConnectedToHealthConnect: false,
          preferredWriterLabel: "Apple Health",
          currentDayRecordsFound: false,
          currentDayVerifiedSteps: 0,
          status: "permission_required",
        };
      }
      // HealthKit has no separate "writer" concept from the app's perspective —
      // the OS itself is the provider once Motion & Fitness is granted.
      const { iosHealthKitProvider } = await import(
        "@/services/steps/providers/iosHealthKitProvider"
      );
      const today = await iosHealthKitProvider.getTodaySteps().catch(() => null);
      const steps = Math.max(0, today?.steps ?? 0);
      return {
        healthConnectAvailable: true,
        readStepsPermissionGranted: true,
        setupCompleted: true,
        writerEvidenceDetected: true,
        writerInstalled: true,
        writerConnectedToHealthConnect: true,
        preferredWriterLabel: "Apple Health",
        currentDayRecordsFound: steps > 0,
        currentDayVerifiedSteps: steps,
        status: steps > 0 ? "ready" : "records_zero",
      };
    } catch {
      return { ...UNSUPPORTED_STATE, status: "error" };
    }
  }

  return UNSUPPORTED_STATE;
}
