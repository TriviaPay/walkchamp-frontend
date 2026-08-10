import assert from "node:assert/strict";
import {
  isLocalTodayRangeStart,
  nextCachedTodaySteps,
} from "./hcTodayCachePolicy";
import {
  classifyWriterDetection,
  isWriterFeedSufficientlyConfigured,
} from "./healthConnectWriterDetectionLogic";

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
      previousCache: 555,
      rangeStart: new Date(now.getTime() - 10 * 60_000),
      rangeEnd: now,
      steps: 12,
    }),
    555,
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
    "installed_but_not_connected",
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
    false,
  );
  assert.equal(
    isWriterFeedSufficientlyConfigured({
      readable: true,
      status: "installed_but_not_connected",
      hasHistoricalStepRecords: false,
      todaySteps: 0,
      writerInstalled: true,
    }),
    false,
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

console.log("hcTodayCachePolicy + writerDetection tests passed");
