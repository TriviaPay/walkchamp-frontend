/**
 * Classify Health Connect feed for onboarding verify.
 * Unfiltered aggregate is the authority. Samsung / Fit / Garmin are optional
 * contributors into Health Connect — never required to complete setup.
 */

import { androidHCService } from "@/services/steps/androidHealthConnectService";
import {
  classifyWriterDetection,
  isWriterFeedSufficientlyConfigured as isSufficientPure,
  type HealthConnectWriterDetectionStatus,
} from "@/services/steps/healthConnectWriterDetectionLogic";
import type { HealthConnectReadDiagnostic } from "@/services/steps/healthConnectReadDiagnostic";

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
  writerInstalled: boolean;
  requiredWriterPackageId?: string;
  diagnostic?: HealthConnectReadDiagnostic;
};

export { classifyWriterDetection };

/**
 * Probe today's unfiltered Health Connect aggregate.
 */
export async function detectHealthConnectWriterFeed(): Promise<HealthConnectWriterDetectionResult> {
  try {
    const feed = await androidHCService.probeTodayStepFeed();

    const status = classifyWriterDetection({
      readable: feed.readable,
      todaySteps: feed.steps,
      hasHistoricalStepRecords: feed.hasHistoricalStepRecords,
      dataOrigins: feed.dataOrigins,
      writerInstalled: false,
    });

    const hasWriterEvidence =
      feed.steps > 0 ||
      feed.hasHistoricalStepRecords ||
      feed.dataOrigins.length > 0;

    return {
      status,
      detectedOrigins: feed.dataOrigins,
      hasHistoricalStepRecords: feed.hasHistoricalStepRecords,
      hasRecentStepRecords: feed.steps > 0,
      todaySteps: feed.steps,
      recordCount: feed.recordCount,
      latestRecordEndTime: feed.latestRecordEndTime,
      recordHint: feed.recordHint,
      readable: feed.readable,
      hasWriterEvidence,
      writerInstalled: false,
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

/** Setup may complete when Health Connect Read Steps is granted. */
export function isWriterFeedSufficientlyConfigured(
  result: HealthConnectWriterDetectionResult,
): boolean {
  return isSufficientPure({
    readable: result.readable,
    status: result.status,
    hasHistoricalStepRecords: result.hasHistoricalStepRecords,
    todaySteps: result.todaySteps,
  });
}
