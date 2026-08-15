package com.walkchamp.app

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.util.Log
import androidx.annotation.Keep
import androidx.core.app.NotificationCompat
import com.globalwalkerleague.walkchampraceprogress.NotificationVisualType
import com.globalwalkerleague.walkchampraceprogress.NotificationVisuals
import com.onesignal.notifications.INotificationReceivedEvent
import com.onesignal.notifications.INotificationServiceExtension
import org.json.JSONObject

/**
 * OneSignal Android presentation only:
 * - Small icon: monochrome walker (status bar) — unchanged
 * - Large icon (right end): type illustration (race / friend / chat / …)
 *   Never the launcher / app icon. Same pattern as Daily Walk + Live Race.
 * - No BigPictureStyle — type art as an expanded full-bleed image looks huge.
 */
@Keep
class WalkChampNotificationServiceExtension : INotificationServiceExtension {
  override fun onNotificationReceived(event: INotificationReceivedEvent) {
    try {
      val notification = event.notification
      val context = event.context
      val visual = resolveVisual(notification.additionalData)
      val typeBitmap =
        BitmapFactory.decodeResource(context.resources, NotificationVisuals.resolveDrawable(visual))
          ?: decodeDrawable(context, "notification_default")

      val smallIconId = resolveDrawableId(context, "ic_stat_onesignal_default")
        .takeIf { it != 0 }
        ?: resolveDrawableId(context, "ic_walkchamp_notification")

      notification.setExtender { builder ->
        if (smallIconId != 0) {
          builder.setSmallIcon(smallIconId)
        }
        if (typeBitmap != null) {
          builder.setLargeIcon(typeBitmap)
        }
        // Per-category accent (gold for rewards, green for cash/walk, purple for
        // races, blue for social) instead of one flat color for every type.
        builder.setColor(NotificationVisuals.accentColorArgb(visual))
        val body = notification.body
        if (!body.isNullOrBlank()) {
          builder.setStyle(NotificationCompat.BigTextStyle().bigText(body))
        }
        builder
      }
      Log.d(TAG, "applied visual=$visual largeIcon=${drawableName(visual)}")
    } catch (e: Exception) {
      Log.w(TAG, "failed to apply notification visual: ${e.message}")
    }
  }

  private fun resolveVisual(data: JSONObject?): NotificationVisualType {
    if (data == null) return NotificationVisualType.DEFAULT
    val visualType = data.optString("visualType", "").ifBlank {
      data.optString("visual_type", "")
    }
    if (visualType.isNotBlank()) return NotificationVisuals.fromKey(visualType)

    val type = data.optString("type", "").ifBlank {
      data.optString("notificationType", "").ifBlank {
        data.optString("notification_type", "")
      }
    }
    return NotificationVisuals.fromKey(type)
  }

  private fun decodeDrawable(context: Context, name: String): Bitmap? {
    val id = resolveDrawableId(context, name)
    if (id == 0) return null
    return BitmapFactory.decodeResource(context.resources, id)
  }

  private fun resolveDrawableId(context: Context, name: String): Int {
    return context.resources.getIdentifier(name, "drawable", context.packageName)
  }

  private fun drawableName(visual: NotificationVisualType): String {
    return when (visual) {
      NotificationVisualType.DAILY_WALK -> "notification_daily_walk"
      NotificationVisualType.GOAL_PROGRESS -> "notification_goal_progress"
      NotificationVisualType.GOAL_COMPLETED -> "notification_goal_completed"
      NotificationVisualType.LIVE_RACE -> "notification_live_race"
      NotificationVisualType.UPCOMING_RACE -> "notification_upcoming_race"
      NotificationVisualType.RACE_STARTED -> "notification_race_started"
      NotificationVisualType.RACE_FINISHED -> "notification_race_finished"
      NotificationVisualType.WINNER -> "notification_winner_trophy"
      NotificationVisualType.COINS_BATTLE -> "notification_coins_battle"
      NotificationVisualType.CASH_CHALLENGE -> "notification_cash_challenge"
      NotificationVisualType.SPONSORED_EVENT -> "notification_sponsored_event"
      NotificationVisualType.ROOM_INVITE -> "notification_room_invite"
      NotificationVisualType.ROOM_CANCELLED -> "notification_room_cancelled"
      NotificationVisualType.FRIEND -> "notification_friend"
      NotificationVisualType.CHAT -> "notification_chat"
      NotificationVisualType.GROUP -> "notification_group"
      NotificationVisualType.REWARD -> "notification_reward"
      NotificationVisualType.WALLET -> "notification_wallet"
      NotificationVisualType.TITLE_UNLOCKED -> "notification_title_unlocked"
      NotificationVisualType.PROMOTION -> "notification_promotion"
      NotificationVisualType.DEFAULT -> "notification_default"
    }
  }

  companion object {
    private const val TAG = "WalkChampOSNotif"
  }
}
