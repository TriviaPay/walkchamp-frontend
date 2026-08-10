/**
 * Pure Health Connect read diagnostic classification (unit-tested).
 */

export type HealthConnectReadErrorCode =
  | "NOT_INITIALIZED"
  | "PERMISSION_MISSING"
  | "PROVIDER_UNAVAILABLE"
  | "PROVIDER_UPDATE_REQUIRED"
  | "QUERY_FAILED"
  | "INVALID_TIME_RANGE"
  | "NO_RECORDS";

export type HealthConnectAvailabilityStatus =
  | "available"
  | "provider_update_required"
  | "not_installed"
  | "unsupported"
  | "temporary_error"
  | "unknown";

export type HealthConnectReadDiagnostic = {
  success: boolean;
  availability: HealthConnectAvailabilityStatus;
  /** null when permissions cannot be checked (provider not available). */
  permissionGranted: boolean | null;
  canRequestPermissions: boolean;
  aggregateSteps: number | null;
  aggregateExecuted: boolean;
  aggregateFailed: boolean;
  recordCount: number | null;
  recordsExecuted: boolean;
  recordsFailed: boolean;
  recordStepsSum: number;
  dataOrigins: string[];
  latestRecordEndTime?: string;
  /** Best known step total when at least one query succeeded. */
  resolvedSteps: number;
  errorCode?: HealthConnectReadErrorCode;
  nativeErrorName?: string;
  timezone: string;
  localStartIso: string;
  utcStartIso: string;
  endIso: string;
};

export function classifyHealthConnectRead(args: {
  initialized: boolean;
  availability?: HealthConnectAvailabilityStatus;
  permissionGranted: boolean | null;
  canRequestPermissions?: boolean;
  aggregateExecuted: boolean;
  aggregateFailed: boolean;
  aggregateSteps: number | null;
  recordsExecuted: boolean;
  recordsFailed: boolean;
  recordCount: number | null;
  recordStepsSum: number;
  dataOrigins: string[];
  latestRecordEndTime?: string;
  nativeErrorName?: string;
  timezone: string;
  localStartIso: string;
  utcStartIso: string;
  endIso: string;
}): HealthConnectReadDiagnostic {
  const availability = args.availability ?? (args.initialized ? "available" : "unknown");
  const base = {
    availability,
    permissionGranted: args.permissionGranted,
    canRequestPermissions: args.canRequestPermissions ?? availability === "available",
    aggregateSteps: args.aggregateSteps,
    aggregateExecuted: args.aggregateExecuted,
    aggregateFailed: args.aggregateFailed,
    recordCount: args.recordCount,
    recordsExecuted: args.recordsExecuted,
    recordsFailed: args.recordsFailed,
    recordStepsSum: args.recordStepsSum,
    dataOrigins: args.dataOrigins,
    latestRecordEndTime: args.latestRecordEndTime,
    nativeErrorName: args.nativeErrorName,
    timezone: args.timezone,
    localStartIso: args.localStartIso,
    utcStartIso: args.utcStartIso,
    endIso: args.endIso,
  };

  if (availability === "provider_update_required") {
    return {
      ...base,
      success: false,
      permissionGranted: null,
      canRequestPermissions: false,
      aggregateExecuted: false,
      aggregateSteps: null,
      recordsExecuted: false,
      recordCount: null,
      resolvedSteps: 0,
      errorCode: "PROVIDER_UPDATE_REQUIRED",
    };
  }

  if (
    availability === "not_installed" ||
    availability === "unsupported" ||
    availability === "temporary_error"
  ) {
    return {
      ...base,
      success: false,
      permissionGranted: null,
      canRequestPermissions: false,
      aggregateExecuted: false,
      aggregateSteps: null,
      recordsExecuted: false,
      recordCount: null,
      resolvedSteps: 0,
      errorCode: "PROVIDER_UNAVAILABLE",
    };
  }

  if (!args.initialized || availability !== "available") {
    return {
      ...base,
      success: false,
      resolvedSteps: 0,
      errorCode: "NOT_INITIALIZED",
    };
  }
  if (args.permissionGranted !== true) {
    return {
      ...base,
      success: false,
      resolvedSteps: 0,
      errorCode: "PERMISSION_MISSING",
    };
  }

  const bothFailed =
    (args.aggregateFailed || !args.aggregateExecuted) &&
    (args.recordsFailed || !args.recordsExecuted) &&
    (args.aggregateFailed || args.recordsFailed);

  if (bothFailed && (args.aggregateFailed || args.recordsFailed)) {
    return {
      ...base,
      success: false,
      resolvedSteps: 0,
      errorCode: "QUERY_FAILED",
    };
  }

  const resolvedSteps = Math.max(
    0,
    args.aggregateSteps ?? 0,
    Math.floor(args.recordStepsSum),
  );

  const anyQueryOk =
    (args.aggregateExecuted && !args.aggregateFailed) ||
    (args.recordsExecuted && !args.recordsFailed);

  if (!anyQueryOk) {
    return {
      ...base,
      success: false,
      resolvedSteps: 0,
      errorCode: "QUERY_FAILED",
    };
  }

  if (
    resolvedSteps === 0 &&
    (args.recordCount ?? 0) === 0 &&
    args.dataOrigins.length === 0
  ) {
    return {
      ...base,
      success: true,
      resolvedSteps: 0,
      errorCode: "NO_RECORDS",
    };
  }

  return {
    ...base,
    success: true,
    resolvedSteps,
    errorCode: undefined,
  };
}

/** Writer evidence for completing verified setup. */
export function hasHealthConnectWriterEvidence(diag: {
  resolvedSteps: number;
  recordCount: number;
  dataOrigins: string[];
  hasHistoricalStepRecords?: boolean;
}): boolean {
  if (diag.resolvedSteps > 0) return true;
  if ((diag.recordCount ?? 0) > 0) return true;
  if (diag.dataOrigins.length > 0) return true;
  if (diag.hasHistoricalStepRecords) return true;
  return false;
}
