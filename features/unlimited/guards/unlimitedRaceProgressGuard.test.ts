/**
 * Run: npx tsx services/unlimitedRaceProgressGuard.test.ts
 */
import assert from "node:assert/strict";
import {
  clearUnlimitedClassicProgressBlocks,
  isUnlimitedClassicProgressBlocked,
  registerUnlimitedClassicProgressBlock,
  unregisterUnlimitedClassicProgressBlock,
} from "./unlimitedRaceProgressGuard";

clearUnlimitedClassicProgressBlocks();
assert.equal(isUnlimitedClassicProgressBlocked("chal-1"), false);

registerUnlimitedClassicProgressBlock("chal-1", {
  challengeDayKey: "2026-08-04",
  timezone: "Asia/Kolkata",
});
assert.equal(isUnlimitedClassicProgressBlocked("chal-1"), true);
assert.equal(isUnlimitedClassicProgressBlocked("classic-race"), false);

unregisterUnlimitedClassicProgressBlock("chal-1");
assert.equal(isUnlimitedClassicProgressBlocked("chal-1"), false);

console.log("unlimitedRaceProgressGuard.test.ts: ok");
