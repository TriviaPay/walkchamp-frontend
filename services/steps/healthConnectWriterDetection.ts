/**
 * Classify Health Connect writer / step-feed state for onboarding verify.
 * Does not read Samsung SDK / sensors — HC probe + install detection only.
 */

import { androidHCService } from "@/services/steps/androidHealthConnectService";
import {
  isStepWriterInstalled,
  resolvePreferredStepWriterAsync,
} from "@/services/steps/androidStepWriterApps";
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

    const status = classifyWriterDetection({
      readable: feed.readable,
      todaySteps: feed.steps,
      hasHistoricalStepRecords: feed.hasHistoricalStepRecords,
      dataOrigins: feed.dataOrigins,
      writerInstalled: installed,
    });

    // Soft "waiting" when installed, readable, but empty today and no history yet.
    const resolvedStatus: HealthConnectWriterDetectionStatus =
      status === "installed_but_not_connected" && feed.readable
        ? "waiting_for_sync"
        : status;

    const hasWriterEvidence = hasHealthConnectWriterEvidence({
      resolvedSteps: feed.steps,
      recordCount: feed.recordCount,
      dataOrigins: feed.dataOrigins,
      hasHistoricalStepRecords: feed.hasHistoricalStepRecords,
    });

    return {
      status: resolvedStatus,
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
    writerInstalled: !!result.selectedWriterId,
  });
}
