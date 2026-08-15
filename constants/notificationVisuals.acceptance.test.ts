/**
 * Extra acceptance checks for notification visual mapping (spec Part 1 / 12).
 * Run: npx tsx constants/notificationVisuals.acceptance.test.ts
 */
import {
  NOTIFICATION_VISUAL_ASSET,
  NOTIFICATION_VISUAL_BY_TYPE,
  notificationVisualDrawableName,
  resolveNotificationVisualType,
  type NotificationVisualType,
} from "./notificationVisuals";
import { androidOneSignalVisualPayload } from "../utils/androidOneSignalNotificationVisuals";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const REQUIRED_ASSETS: NotificationVisualType[] = [
  "daily_walk",
  "goal_progress",
  "goal_completed",
  "live_race",
  "upcoming_race",
  "race_started",
  "race_finished",
  "winner",
  "coins_battle",
  "cash_challenge",
  "sponsored_event",
  "room_invite",
  "room_cancelled",
  "friend",
  "chat",
  "group",
  "reward",
  "wallet",
  "title_unlocked",
  "promotion",
  "default",
];

for (const visual of REQUIRED_ASSETS) {
  assert(!!NOTIFICATION_VISUAL_ASSET[visual], `missing asset map for ${visual}`);
  assert(
    notificationVisualDrawableName(visual).startsWith("notification_"),
    `drawable name for ${visual}`,
  );
}

for (const [type, visual] of Object.entries(NOTIFICATION_VISUAL_BY_TYPE)) {
  assert(
    resolveNotificationVisualType(type) === visual,
    `${type} should map to ${visual}`,
  );
}

assert(resolveNotificationVisualType("unknown_xyz") === "default", "unknown → default");
assert(resolveNotificationVisualType(null) === "default", "null → default");

const friend = androidOneSignalVisualPayload({ type: "friend_request" });
assert(friend.large_icon === "notification_friend", "Android large = type icon (right)");
assert(friend.visualType === "friend", "friend visual");

const raceStarted = androidOneSignalVisualPayload({ type: "race_started" });
assert(raceStarted.large_icon === "notification_race_started", "race started large = type");
assert(raceStarted.visualType === "race_started", "race started visual");

const globalChat = androidOneSignalVisualPayload({ type: "global_chat_message" });
assert(globalChat.large_icon === "notification_chat", "global chat large = chat");
assert(globalChat.visualType === "chat", "global chat visual");

const upcoming = androidOneSignalVisualPayload({ type: "race_starting_soon" });
assert(upcoming.visualType === "upcoming_race", "upcoming visual");
assert(
  upcoming.big_picture_drawable === "notification_upcoming_race",
  "upcoming picture",
);

console.log("notificationVisuals.acceptance.test.ts: all passed");
