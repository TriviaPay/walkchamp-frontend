import assert from "node:assert/strict";
import {
  classifyHealthConnectRead,
  hasHealthConnectWriterEvidence,
} from "./healthConnectReadDiagnostic";

const baseTime = {
  timezone: "Asia/Kolkata",
  localStartIso: "2026-07-25T00:00:00.000+05:30",
  utcStartIso: "2026-07-24T18:30:00.000Z",
  endIso: "2026-07-25T16:30:00.000Z",
};

{
  const d = classifyHealthConnectRead({
    initialized: false,
    availability: "provider_update_required",
    permissionGranted: null,
    canRequestPermissions: false,
    aggregateExecuted: false,
    aggregateFailed: false,
    aggregateSteps: null,
    recordsExecuted: false,
    recordsFailed: false,
    recordCount: null,
    recordStepsSum: 0,
    dataOrigins: [],
    ...baseTime,
  });
  assert.equal(d.errorCode, "PROVIDER_UPDATE_REQUIRED");
  assert.equal(d.permissionGranted, null);
  assert.equal(d.aggregateExecuted, false);
  assert.equal(d.aggregateSteps, null);
  assert.equal(d.recordCount, null);
  assert.notEqual(d.availability, "available");
}

{
  const d = classifyHealthConnectRead({
    initialized: true,
    availability: "available",
    permissionGranted: false,
    aggregateExecuted: false,
    aggregateFailed: false,
    aggregateSteps: null,
    recordsExecuted: false,
    recordsFailed: false,
    recordCount: null,
    recordStepsSum: 0,
    dataOrigins: [],
    ...baseTime,
  });
  assert.equal(d.errorCode, "PERMISSION_MISSING");
  assert.equal(d.success, false);
}

{
  const d = classifyHealthConnectRead({
    initialized: true,
    availability: "available",
    permissionGranted: true,
    aggregateExecuted: true,
    aggregateFailed: false,
    aggregateSteps: 0,
    recordsExecuted: true,
    recordsFailed: false,
    recordCount: 0,
    recordStepsSum: 0,
    dataOrigins: [],
    ...baseTime,
  });
  assert.equal(d.errorCode, "NO_RECORDS");
  assert.equal(d.success, true);
}

{
  assert.equal(
    hasHealthConnectWriterEvidence({
      resolvedSteps: 0,
      recordCount: 0,
      dataOrigins: [],
    }),
    false,
  );
  assert.equal(
    hasHealthConnectWriterEvidence({
      resolvedSteps: 0,
      recordCount: null as unknown as number,
      dataOrigins: ["com.sec.android.app.shealth"],
    }),
    true,
  );
}

console.log("healthConnectReadDiagnostic tests passed");
