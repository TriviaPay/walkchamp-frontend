/**
 * Pure classification helpers for Health Connect writer verification (unit-tested).
 *
 * Samsung Health is not required for verified phone steps. Unfiltered HC
 * aggregate is the authority. Empty aggregate after READ_STEPS is waiting_for_sync
 * (READY_NO_DATA), not a missing-writer error.
 */

export type HealthConnectWriterDetectionStatus =
  | "writer_detected"
  | "installed_but_not_connected"
  | "no_writer_detected"
  | "waiting_for_sync"
  | "permission_error"
  | "temporary_error";

export function classifyWriterDetection(args: {
  readable: boolean;
  todaySteps: number;
  hasHistoricalStepRecords: boolean;
  dataOrigins: string[];
  writerInstalled: boolean;
  /** Ignored — verified totals must not require a specific writer package. */
  requiredWriterPackageId?: string;
}): HealthConnectWriterDetectionStatus {
  if (!args.readable) return "permission_error";

  if (args.todaySteps > 0 || args.hasHistoricalStepRecords) {
    return "writer_detected";
  }
  if ((args.dataOrigins?.length ?? 0) > 0) {
    return "writer_detected";
  }
  // READ_STEPS granted, Health Connect has no rows yet.
  return "waiting_for_sync";
}

export function isWriterFeedSufficientlyConfigured(args: {
  readable: boolean;
  status: HealthConnectWriterDetectionStatus;
  hasHistoricalStepRecords: boolean;
  todaySteps: number;
  dataOrigins?: string[];
  recordCount?: number;
  writerInstalled?: boolean;
  requiredWriterPackageId?: string;
}): boolean {
  void args.requiredWriterPackageId;
  void args.writerInstalled;
  void args.dataOrigins;
  void args.recordCount;
  void args.hasHistoricalStepRecords;
  void args.todaySteps;
  void args.status;
  return args.readable === true;
}
