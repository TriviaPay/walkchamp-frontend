/**
 * Run: npx tsx utils/waitingRoomSeed.test.ts
 */
import assert from "node:assert/strict";
import {
  waitingRoomCacheKey,
  waitingRoomCacheKeyLegacy,
} from "./waitingRoomSeed";

assert.equal(waitingRoomCacheKey("user-a", "race-1"), "waiting_room:user-a:race-1");
assert.notEqual(
  waitingRoomCacheKey("user-a", "race-1"),
  waitingRoomCacheKey("user-b", "race-1"),
);
assert.equal(waitingRoomCacheKeyLegacy("race-1"), "waiting_room_race-1");

console.log("waitingRoomSeed.test.ts: ok");
