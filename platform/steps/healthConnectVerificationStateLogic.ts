/**
 * Pure status-decision logic for the Health Connect / HealthKit verification
 * model (no RN / native imports — safe for plain `tsx` unit tests).
 * See healthConnectVerificationState.ts for the I/O composition layer.
 */

export type HealthConnectVerificationStatus =
  | "ready"
  | "permission_required"
  | "provider_required"
  | "records_zero"
  | "sync_delayed"
  | "unsupported"
  | "error";

/**
 * Pure status decision — no I/O, unit-testable in isolation. Mirrors the
 * precedence rules from the writer-detection audit: permission errors first,
 * then writer evidence (provider_required when absent), then whether
 * today's window actually has records (ready) vs. not yet (records_zero /
 * sync_delayed — writer present, nothing recorded today).
 */
export function resolveHealthConnectVerificationStatus(args: {
  writerStatus:
    | "writer_detected"
    | "installed_but_not_connected"
    | "no_writer_detected"
    | "waiting_for_sync"
    | "permission_error"
    | "temporary_error";
  writerEvidenceDetected: boolean;
  currentDayRecordsFound: boolean;
}): HealthConnectVerificationStatus {
  if (args.writerStatus === "permission_error") return "permission_required";
  if (args.writerStatus === "temporary_error") return "error";
  if (!args.writerEvidenceDetected) return "provider_required";
  if (args.currentDayRecordsFound) return "ready";
  if (args.writerStatus === "waiting_for_sync") return "sync_delayed";
  return "records_zero";
}

/**
 * True when Health Connect / HealthKit is the verified daily authority.
 * Writer present (including today=0 / sync delay) stays verified.
 * Missing writer, missing permission, or unsupported HC must not be treated
 * as a verified empty day.
 */
export function isVerifiedHealthAuthoritative(
  status: HealthConnectVerificationStatus,
): boolean {
  return (
    status === "ready" ||
    status === "records_zero" ||
    status === "sync_delayed"
  );
}

/** User-facing copy for a verification status — smallest existing status treatment. */
export function describeHealthConnectVerificationStatus(
  status: HealthConnectVerificationStatus,
): string {
  switch (status) {
    case "ready":
      return "Health Connect is connected and verified steps are updating.";
    case "records_zero":
    case "sync_delayed":
      return "Health Connect is connected, but no verified steps have been recorded today.";
    case "provider_required":
      return "Connect a compatible health app so your daily steps can be verified.";
    case "permission_required":
      return "Grant step access to Health Connect to enable verified tracking.";
    case "unsupported":
      return "This device currently cannot provide verified step data required for prize challenges.";
    case "error":
    default:
      return "Verification setup required.";
  }
}
