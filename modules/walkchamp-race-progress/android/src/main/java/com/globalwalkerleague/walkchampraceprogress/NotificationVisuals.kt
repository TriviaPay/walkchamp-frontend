package com.globalwalkerleague.walkchampraceprogress

import androidx.annotation.DrawableRes

/**
 * Centralized notification visual categories — mirrors
 * `constants/notificationVisuals.ts`. Display-only; never affects step/race math.
 */
enum class NotificationVisualType {
  DAILY_WALK,
  GOAL_PROGRESS,
  GOAL_COMPLETED,
  LIVE_RACE,
  UPCOMING_RACE,
  RACE_STARTED,
  RACE_FINISHED,
  WINNER,
  COINS_BATTLE,
  CASH_CHALLENGE,
  SPONSORED_EVENT,
  ROOM_INVITE,
  ROOM_CANCELLED,
  FRIEND,
  CHAT,
  GROUP,
  REWARD,
  WALLET,
  TITLE_UNLOCKED,
  PROMOTION,
  DEFAULT,
}

object NotificationVisuals {
  private val BY_TYPE: Map<String, NotificationVisualType> = mapOf(
    "friend_request" to NotificationVisualType.FRIEND,
    "friend_request_received" to NotificationVisualType.FRIEND,
    "friend_request_accepted" to NotificationVisualType.FRIEND,
    "friend_request_rejected" to NotificationVisualType.FRIEND,
    "friend_daily_goal_completed" to NotificationVisualType.GOAL_COMPLETED,
    "chat_message_received" to NotificationVisualType.CHAT,
    "global_chat_message" to NotificationVisualType.CHAT,
    "global_chat_message_received" to NotificationVisualType.CHAT,
    "global_chat" to NotificationVisualType.CHAT,
    "chat_global" to NotificationVisualType.CHAT,
    "daily_goal_reminder" to NotificationVisualType.GOAL_PROGRESS,
    "walking_group_invite_received" to NotificationVisualType.GROUP,
    "walking_group_request_accepted" to NotificationVisualType.GROUP,
    "walking_group_request_rejected" to NotificationVisualType.GROUP,
    "walking_group_join_request_received" to NotificationVisualType.GROUP,
    "group_daily_goal_completed" to NotificationVisualType.GOAL_COMPLETED,
    "group_invite" to NotificationVisualType.GROUP,
    "group_invite_accepted" to NotificationVisualType.GROUP,
    "race_invite" to NotificationVisualType.ROOM_INVITE,
    "race_starting_soon" to NotificationVisualType.UPCOMING_RACE,
    "race_starting" to NotificationVisualType.RACE_STARTED,
    "race_started" to NotificationVisualType.RACE_STARTED,
    "race_joined" to NotificationVisualType.LIVE_RACE,
    "race_finished" to NotificationVisualType.RACE_FINISHED,
    "race_verification_pending" to NotificationVisualType.RACE_FINISHED,
    "race_reconciliation_complete" to NotificationVisualType.WINNER,
    "race_won" to NotificationVisualType.WINNER,
    "race_completed" to NotificationVisualType.RACE_FINISHED,
    "room_started" to NotificationVisualType.RACE_STARTED,
    "room_cancelled" to NotificationVisualType.ROOM_CANCELLED,
    "private_room_invitation" to NotificationVisualType.ROOM_INVITE,
    "live_activity_race_update" to NotificationVisualType.LIVE_RACE,
    "coins_battle_joined" to NotificationVisualType.COINS_BATTLE,
    "promotional_coins_battle" to NotificationVisualType.COINS_BATTLE,
    "promotional_cash_challenge" to NotificationVisualType.CASH_CHALLENGE,
    "sponsored_event_registered" to NotificationVisualType.SPONSORED_EVENT,
    "sponsored_event_left" to NotificationVisualType.SPONSORED_EVENT,
    "sponsored_event_reminder" to NotificationVisualType.UPCOMING_RACE,
    "sponsored_event_started" to NotificationVisualType.RACE_STARTED,
    "sponsored_event_winner" to NotificationVisualType.WINNER,
    "sponsored_event_consolation" to NotificationVisualType.REWARD,
    "promotional_sponsored_event" to NotificationVisualType.SPONSORED_EVENT,
    "promotional_rooms_available" to NotificationVisualType.PROMOTION,
    "promotional_free_challenge" to NotificationVisualType.PROMOTION,
    "reward_ready" to NotificationVisualType.REWARD,
    "withdrawal_approved" to NotificationVisualType.WALLET,
    "title_unlocked" to NotificationVisualType.TITLE_UNLOCKED,
  )

  fun fromKey(raw: String?): NotificationVisualType {
    if (raw.isNullOrBlank()) return NotificationVisualType.DEFAULT
    val key = raw.trim().lowercase()
    BY_TYPE[key]?.let { return it }
    // Accept visual category keys directly (e.g. "upcoming_race", "friend").
    val normalized = key.replace('-', '_')
    return try {
      NotificationVisualType.valueOf(normalized.uppercase())
    } catch (_: Exception) {
      NotificationVisualType.DEFAULT
    }
  }

  fun forOngoingRace(isSponsored: Boolean, raceTypeHint: String? = null): NotificationVisualType {
    val hint = raceTypeHint?.trim()?.lowercase().orEmpty()
    when {
      hint.contains("coin") -> return NotificationVisualType.COINS_BATTLE
      hint.contains("cash") -> return NotificationVisualType.CASH_CHALLENGE
      hint.contains("sponsor") || isSponsored -> return NotificationVisualType.SPONSORED_EVENT
      hint.contains("upcoming") || hint.contains("wait") -> return NotificationVisualType.UPCOMING_RACE
      hint.contains("finish") || hint.contains("result") -> return NotificationVisualType.RACE_FINISHED
      hint.contains("win") -> return NotificationVisualType.WINNER
    }
    return if (isSponsored) NotificationVisualType.SPONSORED_EVENT else NotificationVisualType.LIVE_RACE
  }

  fun raceTypeLabel(
    isSponsored: Boolean,
    raceTypeHint: String? = null,
    unlimitedDailyMode: Boolean = false,
  ): String {
    if (unlimitedDailyMode) return "Streak Challenge"
    val hint = raceTypeHint?.trim()?.lowercase().orEmpty()
    when {
      hint.contains("coin") || hint == "coins_battle" -> return "Coins Battle"
      hint.contains("cash") || hint.contains("paid") -> return "Cash Race"
      hint.contains("sponsor") || hint == "sponsored_event" -> return "Sponsored Race"
      hint.contains("unlimited") || hint.contains("streak") -> return "Streak Challenge"
      hint.contains("free") || hint == "quick" -> return "Free Race"
    }
    return if (isSponsored) "Sponsored Race" else "Free Race"
  }

  /** Shrink label under the LIVE badge so longer names stay on one line. */
  fun raceTypeLabelTextSizeSp(label: String): Float {
    val len = label.trim().length
    return when {
      len <= 9 -> 9f
      len <= 12 -> 8f
      else -> 7f
    }
  }

  /**
   * Accent color (system tint on the small icon / title) matched to the same
   * category colors used in-app (Live Challenges badges, banners), instead of
   * one flat blue for every notification type.
   */
  fun accentColorArgb(visualType: NotificationVisualType): Int {
    return when (visualType) {
      NotificationVisualType.SPONSORED_EVENT,
      NotificationVisualType.WINNER,
      NotificationVisualType.REWARD,
      NotificationVisualType.WALLET,
      NotificationVisualType.TITLE_UNLOCKED -> 0xFFF5C518.toInt() // gold
      NotificationVisualType.COINS_BATTLE,
      NotificationVisualType.PROMOTION -> 0xFFF59E0B.toInt() // amber
      NotificationVisualType.CASH_CHALLENGE,
      NotificationVisualType.DAILY_WALK,
      NotificationVisualType.GOAL_PROGRESS,
      NotificationVisualType.GOAL_COMPLETED -> 0xFF22C55E.toInt() // WalkChamp green
      NotificationVisualType.LIVE_RACE,
      NotificationVisualType.UPCOMING_RACE,
      NotificationVisualType.RACE_STARTED,
      NotificationVisualType.RACE_FINISHED,
      NotificationVisualType.ROOM_INVITE,
      NotificationVisualType.ROOM_CANCELLED -> 0xFF7C3AED.toInt() // race purple
      NotificationVisualType.FRIEND,
      NotificationVisualType.CHAT,
      NotificationVisualType.GROUP -> 0xFF0EA5E9.toInt() // social blue
      NotificationVisualType.DEFAULT -> 0xFF00B4FF.toInt()
    }
  }

  @DrawableRes
  fun resolveDrawable(visualType: NotificationVisualType): Int {
    return when (visualType) {
      NotificationVisualType.DAILY_WALK -> R.drawable.notification_daily_walk
      NotificationVisualType.GOAL_PROGRESS -> R.drawable.notification_goal_progress
      NotificationVisualType.GOAL_COMPLETED -> R.drawable.notification_goal_completed
      NotificationVisualType.LIVE_RACE -> R.drawable.notification_live_race
      NotificationVisualType.UPCOMING_RACE -> R.drawable.notification_upcoming_race
      NotificationVisualType.RACE_STARTED -> R.drawable.notification_race_started
      NotificationVisualType.RACE_FINISHED -> R.drawable.notification_race_finished
      NotificationVisualType.WINNER -> R.drawable.notification_winner_trophy
      NotificationVisualType.COINS_BATTLE -> R.drawable.notification_coins_battle
      NotificationVisualType.CASH_CHALLENGE -> R.drawable.notification_cash_challenge
      NotificationVisualType.SPONSORED_EVENT -> R.drawable.notification_sponsored_event
      NotificationVisualType.ROOM_INVITE -> R.drawable.notification_room_invite
      NotificationVisualType.ROOM_CANCELLED -> R.drawable.notification_room_cancelled
      NotificationVisualType.FRIEND -> R.drawable.notification_friend
      NotificationVisualType.CHAT -> R.drawable.notification_chat
      NotificationVisualType.GROUP -> R.drawable.notification_group
      NotificationVisualType.REWARD -> R.drawable.notification_reward
      NotificationVisualType.WALLET -> R.drawable.notification_wallet
      NotificationVisualType.TITLE_UNLOCKED -> R.drawable.notification_title_unlocked
      NotificationVisualType.PROMOTION -> R.drawable.notification_promotion
      NotificationVisualType.DEFAULT -> R.drawable.notification_default
    }
  }

  fun clampPercent(steps: Int, goal: Int): Int {
    if (goal <= 0) return 0
    return ((steps.toLong() * 100L) / goal.toLong()).toInt().coerceIn(0, 100)
  }

  fun remainingSteps(steps: Int, goal: Int): Int {
    return (goal - steps).coerceAtLeast(0)
  }

  /**
   * Ongoing Daily Walk tray art only. In progress → goal-completed PNG.
   * Goal met → winner trophy. Does not change OneSignal type mapping.
   */
  fun ongoingWalkVisualType(steps: Int, goal: Int): NotificationVisualType {
    return if (goal > 0 && steps >= goal) NotificationVisualType.WINNER
    else NotificationVisualType.GOAL_COMPLETED
  }

  fun formatSteps(value: Int): String {
    return String.format(java.util.Locale.US, "%,d", value.coerceAtLeast(0))
  }

  fun formatTimeLeft(seconds: Int): String {
    val s = seconds.coerceAtLeast(0)
    if (s <= 0) return "Open"
    val h = s / 3600
    val m = (s % 3600) / 60
    return when {
      h > 0 -> "Ends in ${h}h ${m}m"
      m > 0 -> "Ends in ${m}m"
      else -> "Ends in ${s}s"
    }
  }
}

/** Visible daily-walk tray fields — compare before re-notify. */
data class WalkNotificationDisplayState(
  val steps: Int,
  val goal: Int,
  val percentage: Int,
  val remainingSteps: Int,
  val isTracking: Boolean,
  val visualType: NotificationVisualType = NotificationVisualType.DAILY_WALK,
)

/** Visible race tray fields — compare before re-notify. */
data class RaceNotificationDisplayState(
  val raceId: String,
  val raceTypeLabel: String,
  val steps: Int,
  val goal: Int,
  val percentage: Int,
  val rank: Int,
  val participantCount: Int,
  val remainingTimeBucket: String,
  val raceStatus: String,
  val visualType: NotificationVisualType,
)
