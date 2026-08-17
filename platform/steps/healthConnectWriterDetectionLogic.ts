/**
 * Pure classification helpers for Health Connect writer verification (unit-tested).
 */

import {
  originsIncludeWriterPackage,
} from "./healthConnectOrigins";

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
  /**
   * When set (Samsung Health installed), phone-only HC steps do not count as
   * connected. The writer package must appear in Health Connect origins.
   */
  requiredWriterPackageId?: string;
}): HealthConnectWriterDetectionStatus {
  if (!args.readable) return "permission_error";

  const required = args.requiredWriterPackageId?.trim();
  if (required) {
    if (originsIncludeWriterPackage(args.dataOrigins, required)) {
      return "writer_detected";
    }
    return args.writerInstalled
      ? "installed_but_not_connected"
      : "no_writer_detected";
  }

  if (args.todaySteps > 0 || args.dataOrigins.length > 0) {
    return "writer_detected";
  }
  if (args.hasHistoricalStepRecords) {
    return "writer_detected";
  }
  if (args.writerInstalled) {
    return "installed_but_not_connected";
  }
  return "no_writer_detected";
}

export function isWriterFeedSufficientlyConfigured(args: {
  readable: boolean;
  status: HealthConnectWriterDetectionStatus;
  hasHistoricalStepRecords: boolean;
  todaySteps: number;
  dataOrigins?: string[];
  recordCount?: number;
  /** Install alone is not enough — HC must show writer evidence. */
  writerInstalled?: boolean;
  requiredWriterPackageId?: string;
}): boolean {
  if (!args.readable) return false;
  const required = args.requiredWriterPackageId?.trim();
  if (required) {
    return originsIncludeWriterPackage(args.dataOrigins ?? [], required);
  }
  // READ_STEPS + writer install is not complete. Require HC evidence:
  // steps today, historical records, data origins, or explicit writer_detected.
  if (args.status === "writer_detected") return true;
  if (args.hasHistoricalStepRecords) return true;
  if (args.todaySteps > 0) return true;
  if ((args.dataOrigins?.length ?? 0) > 0) return true;
  if ((args.recordCount ?? 0) > 0) return true;
  return false;
}
