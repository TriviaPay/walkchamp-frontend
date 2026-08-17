/**
 * Pure decision-table tests for resolveHealthConnectVerificationStatus.
 * Run: npx tsx services/steps/healthConnectVerificationState.test.ts
 */
import assert from "node:assert/strict";
import { resolveHealthConnectVerificationStatus, isVerifiedHealthAuthoritative } from "./healthConnectVerificationStateLogic";

// Permission not granted → permission_required, regardless of writer evidence.
assert.equal(
  resolveHealthConnectVerificationStatus({
    writerStatus: "permission_error",
    writerEvidenceDetected: false,
    currentDayRecordsFound: false,
  }),
  "permission_required",
);

// Permission granted, no writer evidence at all → provider_required.
// (permission_status = connected must never be treated as proof records exist.)
assert.equal(
  resolveHealthConnectVerificationStatus({
    writerStatus: "no_writer_detected",
    writerEvidenceDetected: false,
    currentDayRecordsFound: false,
  }),
  "provider_required",
);

// Writer evidence present + today's records found → ready.
assert.equal(
  resolveHealthConnectVerificationStatus({
    writerStatus: "writer_detected",
    writerEvidenceDetected: true,
    currentDayRecordsFound: true,
  }),
  "ready",
);

// Writer evidence present (historical records exist) but zero today, still
// waiting on first sync of the day → sync_delayed, NOT provider_required.
// (records = 0 must never be treated as automatic proof no writer exists.)
assert.equal(
  resolveHealthConnectVerificationStatus({
    writerStatus: "waiting_for_sync",
    writerEvidenceDetected: true,
    currentDayRecordsFound: false,
  }),
  "sync_delayed",
);

// Writer evidence present, zero today, no explicit "waiting" signal → records_zero.
assert.equal(
  resolveHealthConnectVerificationStatus({
    writerStatus: "installed_but_not_connected",
    writerEvidenceDetected: true,
    currentDayRecordsFound: false,
  }),
  "records_zero",
);

// Transient probe failure → error (never silently reported as provider_required).
assert.equal(
  resolveHealthConnectVerificationStatus({
    writerStatus: "temporary_error",
    writerEvidenceDetected: false,
    currentDayRecordsFound: false,
  }),
  "error",
);

// Writer app installed but not writing into Health Connect → provider_required.
assert.equal(
  resolveHealthConnectVerificationStatus({
    writerStatus: "installed_but_not_connected",
    writerEvidenceDetected: false,
    currentDayRecordsFound: false,
  }),
  "provider_required",
);
assert.equal(isVerifiedHealthAuthoritative("ready"), true);
assert.equal(isVerifiedHealthAuthoritative("records_zero"), true);
assert.equal(isVerifiedHealthAuthoritative("sync_delayed"), true);
assert.equal(isVerifiedHealthAuthoritative("provider_required"), false);
assert.equal(isVerifiedHealthAuthoritative("unsupported"), false);
assert.equal(isVerifiedHealthAuthoritative("permission_required"), false);

console.log("healthConnectVerificationState.test.ts: ok");
