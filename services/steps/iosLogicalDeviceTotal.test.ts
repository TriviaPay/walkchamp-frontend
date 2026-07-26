import assert from "node:assert/strict";

/** Pure monotonic merge used by iOS logical totals. */
function mergeLogicalTotal(previous: number, incoming: number): number {
  return Math.max(0, Math.floor(previous), Math.floor(incoming));
}

function applySessionProgress(
  logicalTotal: number,
  sessionStartLogical: number,
  sessionSteps: number,
): number {
  return Math.max(
    logicalTotal,
    sessionStartLogical + Math.max(0, Math.floor(sessionSteps)),
  );
}

assert.equal(mergeLogicalTotal(100, 50), 100);
assert.equal(mergeLogicalTotal(100, 150), 150);
assert.equal(mergeLogicalTotal(-1, 10), 10);
assert.equal(applySessionProgress(100, 100, 25), 125);
assert.equal(applySessionProgress(130, 100, 25), 130);
assert.equal(applySessionProgress(100, 100, -5), 100);

console.log("iosLogicalDeviceTotal tests passed");
