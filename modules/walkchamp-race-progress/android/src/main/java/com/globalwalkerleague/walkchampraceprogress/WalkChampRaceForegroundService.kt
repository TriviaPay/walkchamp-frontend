package com.globalwalkerleague.walkchampraceprogress

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat

class WalkChampRaceForegroundService : Service() {
  companion object {
    const val CHANNEL_RACE = "walkchamp_race_live"
    const val CHANNEL_STEPS = "walkchamp_steps"
    const val NOTIFICATION_ID_RACE = 91001
    const val NOTIFICATION_ID_WALK = 91002

    const val ACTION_START = "com.globalwalkerleague.walkchampraceprogress.START"
    const val ACTION_UPDATE = "com.globalwalkerleague.walkchampraceprogress.UPDATE"
    const val ACTION_STOP = "com.globalwalkerleague.walkchampraceprogress.STOP"

    const val ACTION_START_WALK = "com.globalwalkerleague.walkchampraceprogress.START_WALK"
    const val ACTION_UPDATE_WALK = "com.globalwalkerleague.walkchampraceprogress.UPDATE_WALK"
    const val ACTION_STOP_WALK = "com.globalwalkerleague.walkchampraceprogress.STOP_WALK"

    const val EXTRA_RACE_ID = "raceId"
    const val EXTRA_BODY = "body"
    const val EXTRA_DEEP_LINK = "deepLink"
    const val EXTRA_TITLE = "title"

    private var raceRunning = false
    private var walkRunning = false
    private var lastRaceNotification: Notification? = null
    private var lastWalkNotification: Notification? = null

    fun ensureChannels(ctx: Context) {
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
      val nm = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
      if (nm.getNotificationChannel(CHANNEL_RACE) == null) {
        nm.createNotificationChannel(
          NotificationChannel(
            CHANNEL_RACE,
            "Walk Champ Live Race",
            NotificationManager.IMPORTANCE_DEFAULT,
          ).apply {
            description = "Shows live race progress while a race is active."
            setSound(null, null)
            enableVibration(false)
          },
        )
      }
      if (nm.getNotificationChannel(CHANNEL_STEPS) == null) {
        nm.createNotificationChannel(
          NotificationChannel(
            CHANNEL_STEPS,
            "Walk Champ Steps",
            NotificationManager.IMPORTANCE_LOW,
          ).apply {
            description = "Shows your daily step count while Walk Champ tracks steps."
            setSound(null, null)
            enableVibration(false)
          },
        )
      }
    }

    fun buildRaceNotification(ctx: Context, raceId: String, body: String, deepLink: String): Notification {
      ensureChannels(ctx)
      val uri = Uri.parse(deepLink.ifBlank { "globalwalkerleague://race/$raceId" })
      val intent = Intent(Intent.ACTION_VIEW, uri).apply {
        flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
        setPackage(ctx.packageName)
      }
      val pending = PendingIntent.getActivity(
        ctx,
        raceId.hashCode(),
        intent,
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
      )
      return NotificationCompat.Builder(ctx, CHANNEL_RACE)
        .setContentTitle("Walk Champ Race")
        .setContentText(body.lines().firstOrNull() ?: body)
        .setStyle(NotificationCompat.BigTextStyle().bigText(body))
        .setSmallIcon(ctx.applicationInfo.icon)
        .setOngoing(true)
        .setOnlyAlertOnce(true)
        .setSilent(true)
        .setContentIntent(pending)
        .build()
    }

    fun buildWalkNotification(ctx: Context, body: String, deepLink: String, title: String): Notification {
      ensureChannels(ctx)
      val uri = Uri.parse(deepLink.ifBlank { "globalwalkerleague://walk" })
      val intent = Intent(Intent.ACTION_VIEW, uri).apply {
        flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
        setPackage(ctx.packageName)
      }
      val pending = PendingIntent.getActivity(
        ctx,
        "walk_steps".hashCode(),
        intent,
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
      )
      return NotificationCompat.Builder(ctx, CHANNEL_STEPS)
        .setContentTitle(title.ifBlank { "Walk Champ" })
        .setContentText(body.lines().firstOrNull() ?: body)
        .setStyle(NotificationCompat.BigTextStyle().bigText(body))
        .setSmallIcon(ctx.applicationInfo.icon)
        .setOngoing(true)
        .setOnlyAlertOnce(true)
        .setSilent(true)
        .setContentIntent(pending)
        .build()
    }
  }

  override fun onBind(intent: Intent?): IBinder? = null

  private fun activeNotification(): Notification? {
    return when {
      raceRunning && lastRaceNotification != null -> lastRaceNotification
      walkRunning && lastWalkNotification != null -> lastWalkNotification
      else -> null
    }
  }

  private fun activeNotificationId(): Int {
    return if (raceRunning) NOTIFICATION_ID_RACE else NOTIFICATION_ID_WALK
  }

  private fun refreshForeground() {
    val notification = activeNotification()
    if (notification != null && (raceRunning || walkRunning)) {
      startForeground(activeNotificationId(), notification)
    } else {
      stopForeground(STOP_FOREGROUND_REMOVE)
      stopSelf()
    }
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    when (intent?.action) {
      ACTION_STOP -> {
        raceRunning = false
        lastRaceNotification = null
        refreshForeground()
        return START_NOT_STICKY
      }
      ACTION_START, ACTION_UPDATE -> {
        val raceId = intent.getStringExtra(EXTRA_RACE_ID) ?: return START_NOT_STICKY
        val body = intent.getStringExtra(EXTRA_BODY) ?: ""
        val deepLink = intent.getStringExtra(EXTRA_DEEP_LINK) ?: "globalwalkerleague://race/$raceId"
        lastRaceNotification = buildRaceNotification(this, raceId, body, deepLink)
        raceRunning = true
        startForeground(NOTIFICATION_ID_RACE, lastRaceNotification!!)
      }
      ACTION_STOP_WALK -> {
        walkRunning = false
        lastWalkNotification = null
        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        nm.cancel(NOTIFICATION_ID_WALK)
        refreshForeground()
        return START_NOT_STICKY
      }
      ACTION_START_WALK, ACTION_UPDATE_WALK -> {
        val body = intent.getStringExtra(EXTRA_BODY) ?: ""
        val deepLink = intent.getStringExtra(EXTRA_DEEP_LINK) ?: "globalwalkerleague://walk"
        val title = intent.getStringExtra(EXTRA_TITLE) ?: "Walk Champ"
        lastWalkNotification = buildWalkNotification(this, body, deepLink, title)
        walkRunning = true
        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (raceRunning && lastRaceNotification != null) {
          nm.notify(NOTIFICATION_ID_WALK, lastWalkNotification!!)
        } else {
          startForeground(NOTIFICATION_ID_WALK, lastWalkNotification!!)
        }
      }
    }
    return START_STICKY
  }
}
