/**
 * Unit tests for centralized notification visual mapping.
 * Run: npx tsx constants/notificationVisuals.test.ts
 */
import {
  notificationVisualDrawableName,
  ongoingWalkNotificationVisual,
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
assert(
  ongoingWalkNotificationVisual(210, 10_000) === "goal_completed",
  "ongoing daily walk uses goal-completed art",
);
assert(
  ongoingWalkNotificationVisual(10_000, 10_000) === "winner",
  "ongoing goal complete uses trophy art",
);
assert(
  notificationVisualDrawableName(ongoingWalkNotificationVisual(50, 100)) ===
    "notification_goal_completed",
  "ongoing daily walk drawable",
);
assert(
  notificationVisualDrawableName(ongoingWalkNotificationVisual(100, 100)) ===
    "notification_winner_trophy",
  "ongoing goal complete drawable",
);

console.log("notificationVisuals.test.ts: all passed");
