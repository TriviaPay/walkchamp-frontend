/**
 * Centralized notification visual categories for WalkChamp.
 * Used by JS services; Android/iOS mirror the same names via string keys.
 */

export type NotificationVisualType =
  | "daily_walk"
  | "goal_progress"
  | "goal_completed"
  | "live_race"
  | "upcoming_race"
  | "race_started"
  | "race_finished"
  | "winner"
  | "coins_battle"
  | "cash_challenge"
  | "sponsored_event"
  | "room_invite"
  | "room_cancelled"
  | "friend"
  | "chat"
  | "group"
  | "reward"
  | "wallet"
  | "title_unlocked"
  | "promotion"
  | "default";

/** Map push / event `type` strings → visual category. Unknown → default via resolver. */
export const NOTIFICATION_VISUAL_BY_TYPE: Record<string, NotificationVisualType> = {
  friend_request: "friend",
  friend_request_received: "friend",
  friend_request_accepted: "friend",
  friend_request_rejected: "friend",
  friend_daily_goal_completed: "goal_completed",

  chat_message_received: "chat",

  daily_goal_reminder: "goal_progress",

  walking_group_invite_received: "group",
  walking_group_request_accepted: "group",
  walking_group_request_rejected: "group",
  walking_group_join_request_received: "group",
  group_daily_goal_completed: "goal_completed",
  group_invite: "group",
  group_invite_accepted: "group",

  race_invite: "room_invite",
  race_starting_soon: "upcoming_race",
  race_starting: "race_started",
  race_joined: "live_race",
  race_finished: "race_finished",
  race_verification_pending: "race_finished",
  race_reconciliation_complete: "winner",
  race_won: "winner",
  race_completed: "race_finished",
  room_started: "race_started",
  room_cancelled: "room_cancelled",
  private_room_invitation: "room_invite",
  live_activity_race_update: "live_race",

  coins_battle_joined: "coins_battle",
  promotional_coins_battle: "coins_battle",

  promotional_cash_challenge: "cash_challenge",

  sponsored_event_registered: "sponsored_event",
  sponsored_event_left: "sponsored_event",
  sponsored_event_reminder: "upcoming_race",
  sponsored_event_started: "race_started",
  sponsored_event_winner: "winner",
  sponsored_event_consolation: "reward",
  promotional_sponsored_event: "sponsored_event",

  promotional_rooms_available: "promotion",
  promotional_free_challenge: "promotion",

  reward_ready: "reward",
  withdrawal_approved: "wallet",
  title_unlocked: "title_unlocked",
};

/** Asset filename (under assets/notifications/) for a visual type. */
export const NOTIFICATION_VISUAL_ASSET: Record<NotificationVisualType, string> = {
  daily_walk: "notification_daily_walk.png",
  goal_progress: "notification_goal_progress.png",
  goal_completed: "notification_goal_completed.png",
  live_race: "notification_live_race.png",
  upcoming_race: "notification_upcoming_race.png",
  race_started: "notification_race_started.png",
  race_finished: "notification_race_finished.png",
  winner: "notification_winner_trophy.png",
  coins_battle: "notification_coins_battle.png",
  cash_challenge: "notification_cash_challenge.png",
  sponsored_event: "notification_sponsored_event.png",
  room_invite: "notification_room_invite.png",
  room_cancelled: "notification_room_cancelled.png",
  friend: "notification_friend.png",
  chat: "notification_chat.png",
  group: "notification_group.png",
  reward: "notification_reward.png",
  wallet: "notification_wallet.png",
  title_unlocked: "notification_title_unlocked.png",
  promotion: "notification_promotion.png",
  default: "notification_default.png",
};

export const WALKCHAMP_NOTIFICATION_BRAND_ICON = "assets/icons/WalkChampProgress100.png";

export function resolveNotificationVisualType(
  type: string | null | undefined,
): NotificationVisualType {
  if (!type) return "default";
  const key = type.trim();
  if (key in NOTIFICATION_VISUAL_ASSET) {
    return key as NotificationVisualType;
  }
  return NOTIFICATION_VISUAL_BY_TYPE[key] ?? "default";
}

export function notificationVisualAssetName(
  visual: NotificationVisualType,
): string {
  return NOTIFICATION_VISUAL_ASSET[visual] ?? NOTIFICATION_VISUAL_ASSET.default;
}

/** Android drawable resource name (no extension) for OneSignal / native. */
export function notificationVisualDrawableName(
  visual: NotificationVisualType,
): string {
  const file = notificationVisualAssetName(visual);
  return file.replace(/\.png$/i, "");
}
