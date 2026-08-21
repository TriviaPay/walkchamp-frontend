import assert from "node:assert/strict";
import {
  isLocalTodayRangeStart,
  nextCachedTodaySteps,
  shouldRereadHealthConnectToday,
} from "./hcTodayCachePolicy";
import {
  classifyWriterDetection,
  isWriterFeedSufficientlyConfigured,
} from "./healthConnectWriterDetectionLogic";
import {
  normalizeHealthConnectOrigins,
  originsIncludeWriterPackage,
} from "./healthConnectOrigins";

function midnightToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

{
  const mid = midnightToday();
  const now = new Date();
  assert.equal(isLocalTodayRangeStart(mid, now), true);
  const raceStart = new Date(now.getTime() - 30 * 60_000);
  assert.equal(isLocalTodayRangeStart(raceStart, now), false);
}

{
  const mid = midnightToday();
  const now = new Date();
  assert.equal(
    nextCachedTodaySteps({
      previousCache: 400,
      rangeStart: mid,
      rangeEnd: now,
      steps: 0,
    }),
    400,
  );
  assert.equal(
    nextCachedTodaySteps({
      previousCache: 400,
      rangeStart: mid,
      rangeEnd: now,
      steps: 555,
    }),
    555,
  );
  assert.equal(
    nextCachedTodaySteps({
      previousCache: 8000,
      rangeStart: mid,
      rangeEnd: now,
      steps: 10,
    }),
    8000,
    "lagging HC remainder must not overwrite a higher midnight→now total",
  );
}

{
  assert.equal(
    classifyWriterDetection({
      readable: true,
      todaySteps: 100,
      hasHistoricalStepRecords: false,
      dataOrigins: ["com.sec.android.app.shealth"],
      writerInstalled: true,
    }),
    "writer_detected",
  );
  assert.equal(
    classifyWriterDetection({
      readable: true,
      todaySteps: 0,
      hasHistoricalStepRecords: true,
      dataOrigins: [],
      writerInstalled: true,
    }),
    "writer_detected",
  );
  assert.equal(
    classifyWriterDetection({
      readable: true,
      todaySteps: 0,
      hasHistoricalStepRecords: false,
      dataOrigins: [],
      writerInstalled: true,
    }),
    "waiting_for_sync",
  );
  assert.equal(
    classifyWriterDetection({
      readable: false,
      todaySteps: 0,
      hasHistoricalStepRecords: false,
      dataOrigins: [],
      writerInstalled: true,
    }),
    "permission_error",
  );
}

{
  assert.equal(
    isWriterFeedSufficientlyConfigured({
      readable: true,
      status: "waiting_for_sync",
      hasHistoricalStepRecords: false,
      todaySteps: 0,
      writerInstalled: true,
    }),
    true,
  );
  assert.equal(
    isWriterFeedSufficientlyConfigured({
      readable: true,
      status: "installed_but_not_connected",
      hasHistoricalStepRecords: false,
      todaySteps: 0,
      writerInstalled: true,
    }),
    true,
  );
  assert.equal(
    isWriterFeedSufficientlyConfigured({
      readable: true,
      status: "writer_detected",
      hasHistoricalStepRecords: false,
      todaySteps: 100,
      dataOrigins: ["com.sec.android.app.shealth"],
      writerInstalled: true,
    }),
    true,
  );
  assert.equal(
    isWriterFeedSufficientlyConfigured({
      readable: false,
      status: "permission_error",
      hasHistoricalStepRecords: false,
      todaySteps: 0,
      writerInstalled: true,
    }),
    false,
  );
}

{
  assert.equal(
    classifyWriterDetection({
      readable: true,
      todaySteps: 3563,
      hasHistoricalStepRecords: true,
      dataOrigins: ["android"],
      writerInstalled: true,
      requiredWriterPackageId: "com.sec.android.app.shealth",
    }),
    "writer_detected",
  );
  assert.equal(
    classifyWriterDetection({
      readable: true,
      todaySteps: 18496,
      hasHistoricalStepRecords: true,
      dataOrigins: ["com.sec.android.app.shealth"],
      writerInstalled: true,
      requiredWriterPackageId: "com.sec.android.app.shealth",
    }),
    "writer_detected",
  );
  assert.equal(
    isWriterFeedSufficientlyConfigured({
      readable: true,
      status: "installed_but_not_connected",
      hasHistoricalStepRecords: true,
      todaySteps: 3563,
      dataOrigins: ["android"],
      writerInstalled: true,
      requiredWriterPackageId: "com.sec.android.app.shealth",
    }),
    true,
  );
  assert.equal(
    isWriterFeedSufficientlyConfigured({
      readable: true,
      status: "writer_detected",
      hasHistoricalStepRecords: true,
      todaySteps: 18496,
      dataOrigins: ["com.sec.android.app.shealth"],
      writerInstalled: true,
      requiredWriterPackageId: "com.sec.android.app.shealth",
    }),
    true,
  );
}

{
  assert.deepEqual(
    normalizeHealthConnectOrigins([
      "com.sec.android.app.shealth",
      { packageName: "android" },
      { metadata: { dataOrigin: { packageName: "com.google.android.gms" } } },
    ]),
    [
      "com.sec.android.app.shealth",
      "android",
      "com.google.android.gms",
    ],
  );
  assert.equal(
    originsIncludeWriterPackage(
      ["android", "com.sec.android.app.shealth"],
      "com.sec.android.app.shealth",
    ),
    true,
  );
  assert.equal(
    originsIncludeWriterPackage(["shealth"], "com.sec.android.app.shealth"),
    true,
  );
  assert.equal(
    originsIncludeWriterPackage(["android"], "com.sec.android.app.shealth"),
    false,
  );
}

{
  const now = 1_000_000;
  assert.equal(
    shouldRereadHealthConnectToday({
      lastReadAtMs: 0,
      lastSteps: 0,
      nowMs: now,
      steadyIntervalMs: 30_000,
      emptyRetryMs: 2_500,
      catchUpUntilMs: now + 90_000,
    }),
    true,
    "first HC read is immediate",
  );
  assert.equal(
    shouldRereadHealthConnectToday({
      lastReadAtMs: now - 2_000,
      lastSteps: 0,
      nowMs: now,
      steadyIntervalMs: 30_000,
      emptyRetryMs: 2_500,
      catchUpUntilMs: now + 90_000,
    }),
    false,
    "empty catch-up waits 2.5s",
  );
  assert.equal(
    shouldRereadHealthConnectToday({
      lastReadAtMs: now - 2_500,
      lastSteps: 0,
      nowMs: now,
      steadyIntervalMs: 30_000,
      emptyRetryMs: 2_500,
      catchUpUntilMs: now + 90_000,
    }),
    true,
    "reinstall/empty HC retries every 2.5s during catch-up",
  );
  assert.equal(
    shouldRereadHealthConnectToday({
      lastReadAtMs: now - 2_500,
      lastSteps: 0,
      nowMs: now,
      steadyIntervalMs: 30_000,
      emptyRetryMs: 2_500,
      catchUpUntilMs: now - 1,
    }),
    false,
    "after catch-up window, empty HC uses the 30s interval",
  );
  assert.equal(
    shouldRereadHealthConnectToday({
      lastReadAtMs: now - 10_000,
      lastSteps: 8000,
      nowMs: now,
      steadyIntervalMs: 30_000,
      emptyRetryMs: 2_500,
      catchUpUntilMs: now + 90_000,
    }),
    false,
    "once HC has today's total, keep the 30s interval",
  );
  assert.equal(
    shouldRereadHealthConnectToday({
      lastReadAtMs: now - 2_500,
      lastSteps: 10,
      nowMs: now,
      steadyIntervalMs: 30_000,
      emptyRetryMs: 2_500,
      catchUpUntilMs: now + 90_000,
      catchUpBelowSteps: 50,
    }),
    true,
    "reinstall remainder (10) keeps fast HC retries until the full day total lands",
  );
}

console.log("hcTodayCachePolicy + writerDetection tests passed");
