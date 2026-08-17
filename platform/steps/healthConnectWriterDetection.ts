/**
 * Classify Health Connect writer / step-feed state for onboarding verify.
 * Does not read Samsung SDK / sensors — HC probe + install detection only.
 */

import { androidHCService } from "@/services/steps/androidHealthConnectService";
import {
  isStepWriterInstalled,
  resolvePreferredStepWriterAsync,
} from "@/services/steps/androidStepWriterApps";
import { originsIncludeWriterPackage } from "./healthConnectOrigins";
import {
  classifyWriterDetection,
  isWriterFeedSufficientlyConfigured as isSufficientPure,
  type HealthConnectWriterDetectionStatus,
} from "@/services/steps/healthConnectWriterDetectionLogic";
import type { HealthConnectReadDiagnostic } from "@/services/steps/healthConnectReadDiagnostic";
import { hasHealthConnectWriterEvidence } from "@/services/steps/healthConnectReadDiagnostic";

export type { HealthConnectWriterDetectionStatus };

export type HealthConnectWriterDetectionResult = {
  status: HealthConnectWriterDetectionStatus;
  selectedWriterId?: string;
  selectedWriterLabel?: string;
  detectedOrigins: string[];
  hasHistoricalStepRecords: boolean;
  hasRecentStepRecords: boolean;
  todaySteps: number;
  recordCount: number;
  latestRecordEndTime?: string;
  recordHint: string;
  readable: boolean;
  hasWriterEvidence: boolean;
  /** Writer APK is on the device (Samsung Health / Google Fit). */
  writerInstalled: boolean;
  /**
   * When Samsung Health is installed, origins must include that package.
   * Phone-only Health Connect steps do not count as Samsung connected.
   */
  requiredWriterPackageId?: string;
  diagnostic?: HealthConnectReadDiagnostic;
};

export { classifyWriterDetection };

/**
 * Full verify probe used by WearableSetup Confirm step.
 */
export async function detectHealthConnectWriterFeed(opts?: {
  writerConfirmedByUser?: boolean;
}): Promise<HealthConnectWriterDetectionResult> {
  try {
    const writer = await resolvePreferredStepWriterAsync();
    const installed =
      (await isStepWriterInstalled(writer)) || !!opts?.writerConfirmedByUser;
    const feed = await androidHCService.probeTodayStepFeed();
    const requiredWriterPackageId =
      writer.kind === "samsung_health" && installed
        ? writer.packageId
        : undefined;

    const status = classifyWriterDetection({
      readable: feed.readable,
      todaySteps: feed.steps,
      hasHistoricalStepRecords: feed.hasHistoricalStepRecords,
      dataOrigins: feed.dataOrigins,
      writerInstalled: installed,
      requiredWriterPackageId,
    });

    const hasWriterEvidence = requiredWriterPackageId
      ? originsIncludeWriterPackage(feed.dataOrigins, requiredWriterPackageId)
      : hasHealthConnectWriterEvidence({
          resolvedSteps: feed.steps,
          recordCount: feed.recordCount,
          dataOrigins: feed.dataOrigins,
          hasHistoricalStepRecords: feed.hasHistoricalStepRecords,
        });

    return {
      status,
      selectedWriterId: writer.kind,
      selectedWriterLabel: writer.label,
      detectedOrigins: feed.dataOrigins,
      hasHistoricalStepRecords: feed.hasHistoricalStepRecords,
      hasRecentStepRecords: feed.steps > 0,
      todaySteps: feed.steps,
      recordCount: feed.recordCount,
      latestRecordEndTime: feed.latestRecordEndTime,
      recordHint: feed.recordHint,
      readable: feed.readable,
      hasWriterEvidence,
      writerInstalled: installed,
      requiredWriterPackageId,
      diagnostic: undefined,
    };
  } catch {
    return {
      status: "temporary_error",
      detectedOrigins: [],
      hasHistoricalStepRecords: false,
      hasRecentStepRecords: false,
      todaySteps: 0,
      recordCount: 0,
      recordHint: "Could not verify Health Connect yet",
      readable: false,
      hasWriterEvidence: false,
      writerInstalled: false,
    };
  }
}

/** Setup may complete only when Health Connect shows writer evidence. */
export function isWriterFeedSufficientlyConfigured(
  result: HealthConnectWriterDetectionResult,
): boolean {
  if (result.hasWriterEvidence) return true;
  return isSufficientPure({
    readable: result.readable,
    status: result.status,
    hasHistoricalStepRecords: result.hasHistoricalStepRecords,
    todaySteps: result.todaySteps,
    dataOrigins: result.detectedOrigins,
    recordCount: result.recordCount,
    writerInstalled: result.writerInstalled,
    requiredWriterPackageId: result.requiredWriterPackageId,
  });
}
