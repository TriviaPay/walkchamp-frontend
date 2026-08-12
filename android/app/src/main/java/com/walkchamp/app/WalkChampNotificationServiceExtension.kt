package com.walkchamp.app

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.util.Log
import androidx.annotation.Keep
import androidx.core.app.NotificationCompat
import com.globalwalkerleague.walkchampraceprogress.NotificationVisualType
import com.globalwalkerleague.walkchampraceprogress.NotificationVisuals
import com.globalwalkerleague.walkchampraceprogress.WalkChampNotificationViews
import com.onesignal.notifications.INotificationReceivedEvent
import com.onesignal.notifications.INotificationServiceExtension
import org.json.JSONObject

/**
 * OneSignal Android presentation only:
 * - Small icon: monochrome walker (status bar)
 * - Large icon: WalkChamp brand only when the system does not already show
 *   the default app icon in the notification header (pre-N / unsupported)
 * - Big picture: notification-type illustration (notification_friend, …)
 */
@Keep
class WalkChampNotificationServiceExtension : INotificationServiceExtension {
  override fun onNotificationReceived(event: INotificationReceivedEvent) {
    try {
      val notification = event.notification
      val context = event.context
      val visual = resolveVisual(notification.additionalData)

      val showBrandLargeIcon =
        !WalkChampNotificationViews.deviceShowsDefaultNotificationAppIcon()
      val brandBitmap =
        if (showBrandLargeIcon) {
          decodeDrawable(context, "notification_walkchamp_brand")
            ?: decodeDrawable(context, "notification_default")
        } else {
          null
        }
      val typeBitmap = decodeDrawable(context, drawableName(visual))
        ?: decodeDrawable(context, "notification_default")

      val smallIconId = resolveDrawableId(context, "ic_stat_onesignal_default")
        .takeIf { it != 0 }
        ?: resolveDrawableId(context, "ic_walkchamp_notification")

      notification.setExtender { builder ->
        if (smallIconId != 0) {
          builder.setSmallIcon(smallIconId)
        }
        if (brandBitmap != null) {
          builder.setLargeIcon(brandBitmap)
        }
        builder.setColor(ACCENT_ARGB)

        // Type illustration as expanded rich image when server did not send one.
        if (notification.bigPicture.isNullOrBlank() && typeBitmap != null) {
          val pictureStyle = NotificationCompat.BigPictureStyle().bigPicture(typeBitmap)
          // Avoid a second brand mark when the system header already shows the app icon.
          if (brandBitmap != null) {
            pictureStyle.bigLargeIcon(brandBitmap)
          } else {
            pictureStyle.bigLargeIcon(null as android.graphics.Bitmap?)
          }
          builder.setStyle(pictureStyle)
        }
        builder
      }
      Log.d(
        TAG,
        "applied visual=$visual brandLarge=$showBrandLargeIcon typePicture=${drawableName(visual)}",
      )
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
    private const val ACCENT_ARGB = 0xFF00B4FF.toInt()
  }
}
