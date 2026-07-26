/**
 * Unit tests for centralized notification visual mapping.
 * Run: npx tsx constants/notificationVisuals.test.ts
 */
import {
  notificationVisualDrawableName,
  resolveNotificationVisualType,
} from "./notificationVisuals";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

assert(resolveNotificationVisualType("friend_request") === "friend", "friend_request");
assert(resolveNotificationVisualType("race_starting_soon") === "upcoming_race", "upcoming");
assert(resolveNotificationVisualType("live_activity_race_update") === "live_race", "live");
assert(resolveNotificationVisualType("sponsored_event_winner") === "winner", "winner");
assert(resolveNotificationVisualType("unknown_xyz") === "default", "unknown");
assert(resolveNotificationVisualType("daily_walk") === "daily_walk", "direct category");
assert(
  notificationVisualDrawableName("winner") === "notification_winner_trophy",
  "winner drawable",
);
assert(
  notificationVisualDrawableName("default") === "notification_default",
  "default drawable",
);

console.log("notificationVisuals.test.ts: all passed");
