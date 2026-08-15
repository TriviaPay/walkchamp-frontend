/**
 * Run: npx tsx utils/raceNotificationType.test.ts
 */
import assert from "node:assert/strict";
import { resolveRaceNotificationTypeHint } from "./raceNotificationType";

assert.equal(resolveRaceNotificationTypeHint({ type: "free" }), "free");
assert.equal(
  resolveRaceNotificationTypeHint({ entryType: "coins_battle" }),
  "coins_battle",
);
assert.equal(
  resolveRaceNotificationTypeHint({ type: "paid_usd", entryType: "cash" }),
  "cash",
);
assert.equal(
  resolveRaceNotificationTypeHint({ type: "sponsored", isSponsored: true }),
  "sponsored",
);
assert.equal(
  resolveRaceNotificationTypeHint({ unlimited: true }),
  "unlimited_goal",
);
assert.equal(
  resolveRaceNotificationTypeHint({ challengeType: "unlimited_goal" }),
  "unlimited_goal",
);

console.log("raceNotificationType.test.ts: ok");
