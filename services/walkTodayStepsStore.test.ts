/**
 * walkTodayStepsStore — isolated high-frequency todaySteps UI subscription.
 * Run: npx tsx services/walkTodayStepsStore.test.ts
 */
import {
  getWalkTodayStepsSnapshot,
  setWalkTodayStepsSnapshot,
  subscribeWalkTodaySteps,
} from "./walkTodayStepsStore";

let notified = 0;
const unsub = subscribeWalkTodaySteps(() => {
  notified += 1;
});

setWalkTodayStepsSnapshot(100);
if (getWalkTodayStepsSnapshot() !== 100) throw new Error("snapshot mismatch");
setWalkTodayStepsSnapshot(100);
if (notified !== 1) throw new Error(`expected 1 notify, got ${notified}`);
setWalkTodayStepsSnapshot(101);
if (notified !== 2) throw new Error(`expected 2 notify, got ${notified}`);
unsub();
setWalkTodayStepsSnapshot(102);
if (notified !== 2) throw new Error("unsub failed");
console.log("walkTodayStepsStore.test.ts OK");
