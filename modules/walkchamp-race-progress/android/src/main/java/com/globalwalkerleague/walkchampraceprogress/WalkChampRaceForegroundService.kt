package com.globalwalkerleague.walkchampraceprogress

import android.app.AlarmManager
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.content.pm.ApplicationInfo
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.os.IBinder
import android.os.PowerManager
import android.os.SystemClock
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import androidx.core.content.PermissionChecker

class WalkChampRaceForegroundService : Service() {
  companion object {
    const val CHANNEL_RACE = "walkchamp_race_live"
    const val CHANNEL_STEPS = "walkchamp_steps_ongoing"
    const val NOTIFICATION_ID_RACE = 1001
    /** Second concurrent race (e.g. sponsored while free is FGS) — notify-only, not FGS. */
    const val NOTIFICATION_ID_RACE_PARALLEL = 1002
    const val NOTIFICATION_ID_WALK = 91002

    const val ACTION_START = "com.globalwalkerleague.walkchampraceprogress.START"
    const val ACTION_UPDATE = "com.globalwalkerleague.walkchampraceprogress.UPDATE"
    const val ACTION_STOP = "com.globalwalkerleague.walkchampraceprogress.STOP"
    const val ACTION_RESTORE = "com.globalwalkerleague.walkchampraceprogress.RESTORE"
    /** Upsert a second ongoing race notification without replacing the FGS race. */
    const val ACTION_UPSERT_PARALLEL_RACE =
      "com.globalwalkerleague.walkchampraceprogress.UPSERT_PARALLEL_RACE"
    const val ACTION_STOP_PARALLEL_RACE =
      "com.globalwalkerleague.walkchampraceprogress.STOP_PARALLEL_RACE"

    const val ACTION_START_WALK = "com.globalwalkerleague.walkchampraceprogress.START_WALK"
    const val ACTION_UPDATE_WALK = "com.globalwalkerleague.walkchampraceprogress.UPDATE_WALK"
    const val ACTION_STOP_WALK = "com.globalwalkerleague.walkchampraceprogress.STOP_WALK"
    /** Sent after race ends: switch foreground notification to daily-steps mode. */
    const val ACTION_SWITCH_TO_WALK = "com.globalwalkerleague.walkchampraceprogress.SWITCH_TO_WALK"
    const val ACTION_FLUSH_RACE_SYNC = "com.globalwalkerleague.walkchampraceprogress.FLUSH_RACE_SYNC"
    const val ACTION_CLEAR_USER_SESSION = "com.globalwalkerleague.walkchampraceprogress.CLEAR_USER_SESSION"
    const val ACTION_MIDNIGHT_RESET = "com.globalwalkerleague.walkchampraceprogress.MIDNIGHT_RESET"
    /** Periodic poke so OEM doze cannot silently stall closed-app step delivery. */
    const val ACTION_SENSOR_WATCHDOG = "com.globalwalkerleague.walkchampraceprogress.SENSOR_WATCHDOG"
    /** JS AppState→background/closed handoff — native owns step delivery from here. */
    const val ACTION_ENSURE_BACKGROUND =
      "com.globalwalkerleague.walkchampraceprogress.ENSURE_BACKGROUND"

    const val EXTRA_RACE_ID = "raceId"
    const val EXTRA_BODY = "body"
    const val EXTRA_DEEP_LINK = "deepLink"
    const val EXTRA_TITLE = "title"
    const val EXTRA_STATE_JSON = "stateJson"
    const val EXTRA_STEP_SOURCE = "stepSource"
    const val EXTRA_TODAY_STEPS = "todaySteps"
    /** Display-only daily goal for RemoteViews progress — does not affect step math. */
    const val EXTRA_DAILY_GOAL = "dailyGoal"

    private const val TAG = "WalkChampFGS"

    fun formatWalkNotificationBody(steps: Int, provisional: Boolean = false): String {
      val formatted = String.format("%,d", steps.coerceAtLeast(0))
      return if (provisional) {
        "Tracking your steps - $formatted steps today - Live estimate"
      } else {
        "Tracking your steps - $formatted steps today"
      }
    }
    private const val NOTIFICATION_TICK_MS = 3_000L
    /** Race progress backend sync â€” latest value only, not every sensor tick. */
    private const val BACKEND_SYNC_MS = 15_000L
    private const val RACE_SYNC_MIN_INTERVAL_MS = 10_000L
    private const val RACE_SYNC_MIN_STEP_DELTA = 3
    /** How often to sync daily walk steps to the backend when backgrounded. */
    private const val WALK_BACKEND_SYNC_MS = 30_000L
    /** Interactive refresh cadence while the screen is on. */
    private const val WALK_STEP_REFRESH_MS = 3_000L
    /** Faster poll while screen is off — OEM step batching is most aggressive then. */
    private const val WALK_STEP_REFRESH_SCREEN_OFF_MS = 1_500L
    private const val SENSOR_WATCHDOG_MS = 15_000L
    /** Bumped so legacy getService PendingIntents are superseded by getForegroundService. */
    private const val SENSOR_WATCHDOG_REQUEST_CODE = 99102
    private const val SENSOR_WATCHDOG_LEGACY_REQUEST_CODE = 99101
    private const val DEFERRED_RESTORE_REQUEST_CODE = 99103
    private const val DEFERRED_RESTORE_MS = 2_000L
    /** Poll for local-midnight rollover while FGS is alive (phone idle at 12:00 AM). */
    private const val MIDNIGHT_CHECK_MS = 60_000L
    private val SYNC_BACKOFF_STEPS = longArrayOf(5_000L, 10_000L, 30_000L, 60_000L)

    private var walkRunning = false
    private var lastWalkNotification: Notification? = null

    /** Launcher/adaptive icons are invalid for status bar â€” use module drawable. */
    private fun notificationSmallIcon(ctx: Context): Int {
      val iconId = R.drawable.ic_walkchamp_notification
      return try {
        if (androidx.core.content.ContextCompat.getDrawable(ctx, iconId) == null) {
          Log.w(TAG, "[WalkChampFGS] invalid notification icon resId=$iconId")
          android.R.drawable.stat_sys_download
        } else {
          iconId
        }
      } catch (e: Exception) {
        Log.w(TAG, "[WalkChampFGS] invalid notification icon error=${e.message}")
        android.R.drawable.stat_sys_download
      }
    }

    private fun logPostNotificationsGranted(ctx: Context) {
      if (Build.VERSION.SDK_INT < 33) {
        Log.d(TAG, "[WalkChampFGS] permission POST_NOTIFICATIONS granted=true (pre-33)")
        return
      }
      val granted =
        PermissionChecker.checkSelfPermission(
          ctx,
          android.Manifest.permission.POST_NOTIFICATIONS,
        ) == PermissionChecker.PERMISSION_GRANTED
      Log.d(TAG, "[WalkChampFGS] permission POST_NOTIFICATIONS granted=$granted")
    }

    fun ensureChannels(ctx: Context) {
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
      val nm = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
      if (nm.getNotificationChannel(CHANNEL_RACE) == null) {
        nm.createNotificationChannel(
          NotificationChannel(
            CHANNEL_RACE,
            "Live Race",
            NotificationManager.IMPORTANCE_DEFAULT,
          ).apply {
            description = "Shows Live Race progress while a race is active."
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
            setShowBadge(false)
          },
        )
      }
      Log.d(TAG, "[WalkChampFGS] createNotificationChannel success channelId=$CHANNEL_RACE,$CHANNEL_STEPS")
    }

    fun buildRaceNotification(ctx: Context, state: RaceNotificationState): Notification {
      val anchored = state.ensureChronometerAnchors()
      return buildRaceNotification(
        ctx,
        anchored.raceId,
        anchored.toNotificationBody(),
        anchored.deepLink(),
        anchored.raceStartTimeMs,
        anchored.challengeEndAtMs,
        anchored.isSponsored,
        anchored,
      )
    }

    fun buildRaceNotification(
      ctx: Context,
      raceId: String,
      body: String,
      deepLink: String,
      raceStartTimeMs: Long = 0L,
      challengeEndAtMs: Long = 0L,
      isSponsored: Boolean = false,
      state: RaceNotificationState? = null,
      forceLegacy: Boolean = false,
    ): Notification {
      ensureChannels(ctx)
      val uri = Uri.parse(deepLink.ifBlank { "walkchamp://race/$raceId" })
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
      val title = if (isSponsored) "Sponsored Event" else "Live Race"
      val builder = NotificationCompat.Builder(ctx, CHANNEL_RACE)
        .setContentTitle(title)
        .setContentText(body)
        .setSmallIcon(notificationSmallIcon(ctx))
        .setOngoing(true)
        .setOnlyAlertOnce(true)
        .setSilent(true)
        .setCategory(NotificationCompat.CATEGORY_SERVICE)
        .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
        .setPriority(NotificationCompat.PRIORITY_LOW)
        .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
        .setContentIntent(pending)
        // No ticking when/chronometer in the shade (OEM skins may keep an old
        // chronometer until the notification is cancelled + re-posted).
        .setShowWhen(false)
        .setUsesChronometer(false)
        .setChronometerCountDown(false)
        .setWhen(0L)

      if (!forceLegacy && state != null) {
        try {
          val usedCustom = WalkChampNotificationViews.applyRaceCustomViews(ctx, builder, state)
          if (!usedCustom) {
            builder
              .setContentTitle(title)
              .setContentText(body)
              .setStyle(NotificationCompat.BigTextStyle().bigText(body))
          }
        } catch (e: Exception) {
          Log.w(TAG, "Custom race notification rendering failed — legacy content kept: ${e.message}")
          builder
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(NotificationCompat.BigTextStyle().bigText(body))
        }
      }

      Log.d(
        TAG,
        "[OngoingNotification] trackingType=race title=$title chronometerEnabled=false raceId=$raceId",
      )
      return builder.build()
    }

    fun buildWalkNotification(
      ctx: Context,
      body: String,
      deepLink: String,
      title: String,
      trackingStartedAtMs: Long = 0L,
      todaySteps: Int = -1,
      dailyGoal: Int = 0,
      forceLegacy: Boolean = false,
    ): Notification {
      ensureChannels(ctx)
      val uri = Uri.parse(deepLink.ifBlank { "walkchamp://walk" })
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
      val builder = NotificationCompat.Builder(ctx, CHANNEL_STEPS)
        .setContentTitle(title.ifBlank { "Walk Champ" })
        .setContentText(body.lines().firstOrNull() ?: body)
        .setSmallIcon(notificationSmallIcon(ctx))
        .setOngoing(true)
        .setOnlyAlertOnce(true)
        .setSilent(true)
        .setCategory(NotificationCompat.CATEGORY_SERVICE)
        .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
        .setPriority(NotificationCompat.PRIORITY_LOW)
        .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
        .setContentIntent(pending)
        // No chronometer on daily step tray notification.
        .setShowWhen(false)
        .setUsesChronometer(false)
        .setChronometerCountDown(false)
        .setWhen(0L)

      var usedCustom = false
      if (!forceLegacy) {
        val stepsForUi =
          if (todaySteps >= 0) todaySteps
          else Regex("([\\d,]+)").find(body)?.groupValues?.getOrNull(1)
            ?.replace(",", "")?.toIntOrNull() ?: 0
        val goalForUi = if (dailyGoal > 0) dailyGoal else 10_000
        try {
          usedCustom = WalkChampNotificationViews.applyWalkCustomViews(
            ctx,
            builder,
            stepsForUi,
            goalForUi,
            title.ifBlank { "Walk Champ" },
          )
        } catch (e: Exception) {
          Log.w(TAG, "Custom walk notification rendering failed — legacy content kept: ${e.message}")
        }
      }
      // BigTextStyle only for legacy text notifications — it duplicates the title on Samsung.
      if (!usedCustom) {
        builder.setStyle(NotificationCompat.BigTextStyle().bigText(body))
      }

      Log.d(
        TAG,
        "[OngoingNotification] trackingType=daily chronometerEnabled=false title=${title.ifBlank { "Walk Champ" }}",
      )

      return builder.build().also {
        Log.d(TAG, "[WalkChampFGS] notification built channelId=$CHANNEL_STEPS")
      }
    }
  }

  private var raceState: RaceNotificationState? = null
  /** Second concurrent race shown as a separate ongoing notification (not FGS). */
  private var parallelRaceState: RaceNotificationState? = null
  private var workerThread: HandlerThread? = null
  private var workerHandler: Handler? = null
  private var wakeLock: PowerManager.WakeLock? = null
  private var syncBackoffIndex = 0
  private var lastBackendSyncMs = 0L
  private var lastNotificationTickMs = 0L
  private var lastWalkBackendSyncMs = 0L
  private var lastSyncedRaceSteps = -1
  private var sensorEngine: NativeStepSensorEngine? = null
  private var foregroundWalkPromoted = false
  private var foregroundRacePromoted = false
  /** Skip tray re-notify when visible fields are unchanged. */
  private var lastWalkDisplayState: WalkNotificationDisplayState? = null
  private var lastRaceDisplayState: RaceNotificationDisplayState? = null
  private var lastParallelRaceDisplayState: RaceNotificationDisplayState? = null
  /** Sensor deltas for advancing the parallel (sponsored/companion) race tray. */
  private var lastNativeTodayStepsForDelta = -1
  private var lastNativeRaceStepsForDelta = -1
  /** Prevents overlapping blocking counter samples from stalling the worker thread. */
  private var hardwareSampleInFlight = false

  private val notificationTickRunnable = object : Runnable {
    override fun run() {
      val state = raceState ?: return
      if (!isActiveRace(state)) return
      ensureWakeLock()
      val forceSample = !isScreenInteractive()
      // Screen-off / app-killed OEM backup — force a counter sample every tick.
      try {
        pollHardwareSafe(forceSample)
      } catch (e: Exception) {
        Log.w(TAG, "[WalkChampFGS] race pollHardwareNow failed: ${e.message}")
      }
      tickRace(raceState ?: state, syncBackend = false)
      workerHandler?.postDelayed(this, walkRefreshDelayMs().coerceAtLeast(NOTIFICATION_TICK_MS))
    }
  }

  private val walkBackendSyncRunnable = object : Runnable {
    override fun run() {
      if (!walkRunning) return
      val activeRace = raceState
      if (activeRace != null && isActiveRace(activeRace)) {
        // Race sync handles progress while race is active.
        workerHandler?.postDelayed(this, WALK_BACKEND_SYNC_MS)
        return
      }
      tickWalkBackendSync()
      workerHandler?.postDelayed(this, WALK_BACKEND_SYNC_MS)
    }
  }

  /** Native tick — keeps walk/race trays fresh while app is backgrounded/closed/locked. */
  private val walkStepRefreshRunnable = object : Runnable {
    override fun run() {
      // Run for walk AND live race — JS is suspended in background/closed.
      if (!isTrackingActive()) return
      try {
        ensureWakeLock()
        val forceSample = !isScreenInteractive()
        // When the app is fully closed + screen locked, OEM sensor batching often
        // stops event callbacks. Force a hardware sample so trays keep advancing
        // without JS / Health Connect.
        pollHardwareSafe(forceSample)
        sensorEngine?.currentState()?.let { handleNativeStepStateUpdate(it) }
        val activeRace = raceState
        if (activeRace == null || !isActiveRace(activeRace)) {
          // No-op when RN is dead; still useful while minimized (JS can refresh HC).
          WalkChampStepStateEmitter.emitWalkStepRefreshRequest()
        }
        Log.d(TAG, "[WalkChampFGS] stepRefresh tick forceSample=$forceSample")
      } catch (e: Exception) {
        Log.w(TAG, "[WalkChampFGS] walkStepRefresh tick failed", e)
      }
      workerHandler?.postDelayed(this, walkRefreshDelayMs())
    }
  }

  private fun pollHardwareSafe(forceSample: Boolean) {
    if (hardwareSampleInFlight) {
      // Still flush/restart lightly without blocking.
      try {
        ensureSensorEngine().pollHardwareNow(forceSample = false)
      } catch (_: Exception) {
      }
      return
    }
    hardwareSampleInFlight = true
    try {
      ensureSensorEngine().pollHardwareNow(forceSample = forceSample)
    } finally {
      hardwareSampleInFlight = false
    }
  }

  private fun isScreenInteractive(): Boolean {
    val pm = getSystemService(Context.POWER_SERVICE) as? PowerManager
    return pm?.isInteractive != false
  }

  private fun walkRefreshDelayMs(): Long {
    return if (isScreenInteractive()) WALK_STEP_REFRESH_MS else WALK_STEP_REFRESH_SCREEN_OFF_MS
  }

  private val midnightCheckRunnable = object : Runnable {
    override fun run() {
      checkMidnightRollover()
      if (isTrackingActive()) {
        workerHandler?.postDelayed(this, MIDNIGHT_CHECK_MS)
      }
    }
  }

  private val backendSyncRunnable = object : Runnable {
    override fun run() {
      try {
        if (raceState == null) {
          val loaded = RaceNotificationState.load(this@WalkChampRaceForegroundService)
          if (loaded != null && isActiveRace(loaded)) {
            raceState = loaded.withComputedTimeLeft()
            startSensorTrackingIfNeeded()
          }
        }
        val state = raceState
        if (state != null && isActiveRace(state)) {
          performLiveRaceBackendSync(force = false)
        } else {
          processRaceSyncOutboxIfReady()
        }
      } finally {
        workerHandler?.postDelayed(this, BACKEND_SYNC_MS)
      }
    }
  }

  private fun notificationManager(): NotificationManager =
    getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

  /**
   * Android 14+/15 health-type FGS requires ACTIVITY_RECOGNITION (or body/high-rate sensors)
   * at promote time in addition to FOREGROUND_SERVICE_HEALTH in the manifest.
   */
  private fun hasHealthForegroundPrerequisite(): Boolean {
    if (Build.VERSION.SDK_INT < 29) return true
    val arGranted =
      PermissionChecker.checkSelfPermission(
        this,
        android.Manifest.permission.ACTIVITY_RECOGNITION,
      ) == PermissionChecker.PERMISSION_GRANTED
    if (!arGranted) {
      Log.w(
        TAG,
        "[WalkChampFGS] ACTIVITY_RECOGNITION not granted â€” cannot start health FGS (targetSdk 35)",
      )
    }
    return arGranted
  }

  /**
   * Typed health startForeground on API 34+; untyped on older APIs.
   *
   * IMPORTANT: After Context.startForegroundService(), this MUST attempt Service.startForeground()
   * (or the process crashes with ForegroundServiceDidNotStartInTimeException). Never early-return
   * with notify-only when a foreground start may be pending.
   */
  private fun startHealthForegroundService(notificationId: Int, notification: Notification): Boolean {
    if (!hasHealthForegroundPrerequisite()) {
      Log.w(
        TAG,
        "[WalkChampFGS] ACTIVITY_RECOGNITION missing - still attempting startForeground to satisfy FGS contract",
      )
    }
    fun promote(n: Notification): Boolean {
      if (Build.VERSION.SDK_INT >= 34) {
        startForeground(
          notificationId,
          n,
          ServiceInfo.FOREGROUND_SERVICE_TYPE_HEALTH,
        )
      } else {
        startForeground(notificationId, n)
      }
      return true
    }
    return try {
      promote(notification)
    } catch (e: SecurityException) {
      Log.e(TAG, "[WalkChampFGS] startForeground SecurityException: ${e.message}")
      try {
        notificationManager().notify(notificationId, notification)
      } catch (_: Exception) {
      }
      false
    } catch (e: Exception) {
      Log.e(TAG, "[WalkChampFGS] startForeground failed — trying legacy: ${e.message}")
      val legacy = rebuildLegacyNotification(notificationId)
      if (legacy != null) {
        return try {
          promote(legacy)
        } catch (e2: Exception) {
          Log.e(TAG, "[WalkChampFGS] legacy startForeground failed: ${e2.message}")
          try {
            notificationManager().notify(notificationId, legacy)
          } catch (_: Exception) {
          }
          false
        }
      }
      try {
        notificationManager().notify(notificationId, notification)
      } catch (_: Exception) {
      }
      false
    }
  }

  /**
   * Promote walk FGS immediately â€” must run on main thread before any slow work.
   */
  private fun promoteWalkForegroundNow(notification: Notification) {
    ensureChannels(this)
    Log.d(TAG, "[WalkChampFGS] createNotificationChannel success")
    Log.d(TAG, "[WalkChampFGS] notification built")
    if (Build.VERSION.SDK_INT >= 33) {
      val granted =
        PermissionChecker.checkSelfPermission(
          this,
          android.Manifest.permission.POST_NOTIFICATIONS,
        ) == PermissionChecker.PERMISSION_GRANTED
      if (!granted) {
        Log.w(TAG, "[WalkChampFGS] notification permission denied")
      }
    }
    Log.d(TAG, "[WalkChampFGS] calling startForeground")
    val promoted = startHealthForegroundService(NOTIFICATION_ID_WALK, notification)
    foregroundWalkPromoted = promoted
    if (promoted) {
      Log.d(TAG, "[WalkChampFGS] startForeground called notificationId=$NOTIFICATION_ID_WALK")
      Log.d(TAG, "[WalkChampFGS] service running mode=total_steps")
    } else {
      onForegroundPromoteFailed(NOTIFICATION_ID_WALK, notification, "walk")
    }
  }

  private fun promoteRaceForegroundNow(notification: Notification) {
    ensureChannels(this)
    Log.d(TAG, "[WalkChampFGS] createNotificationChannel success")
    Log.d(TAG, "[WalkChampFGS] notification built")
    Log.d(TAG, "[WalkChampFGS] calling startForeground")
    val promoted = startHealthForegroundService(NOTIFICATION_ID_RACE, notification)
    foregroundRacePromoted = promoted
    if (promoted) {
      Log.d(TAG, "[WalkChampFGS] startForeground called notificationId=$NOTIFICATION_ID_RACE")
      Log.d(TAG, "[WalkChampFGS] service running mode=live_race")
    } else {
      onForegroundPromoteFailed(NOTIFICATION_ID_RACE, notification, "race")
    }
  }

  /**
   * When typed health FGS cannot promote: keep notify + sticky loops if we were started
   * via plain startService (no AR). Only stopSelf when startForegroundService likely
   * started us — otherwise closed-app tracking dies permanently.
   */
  private fun onForegroundPromoteFailed(
    notificationId: Int,
    notification: Notification,
    mode: String,
  ) {
    Log.w(TAG, "[WalkChampFGS] $mode FGS not promoted")
    try {
      notificationManager().notify(notificationId, notification)
    } catch (_: Exception) {
    }
    scheduleSensorWatchdog()
    scheduleDeferredRestore()
    if (!hasHealthForegroundPrerequisite()) {
      // Module used startService (not startForegroundService) — keep process alive.
      Log.w(TAG, "[WalkChampFGS] AR missing — notify-only sticky keep-alive (no stopSelf)")
      return
    }
    // startForegroundService requires startForeground or stopSelf within the OS timeout.
    Log.w(TAG, "[WalkChampFGS] schedule deferred restore then stopSelf")
    try {
      stopForeground(STOP_FOREGROUND_REMOVE)
    } catch (_: Exception) {
    }
    stopSelf()
  }

  private fun buildWalkNotificationFromIntent(intent: Intent): Notification {
    val deepLink = intent.getStringExtra(EXTRA_DEEP_LINK) ?: "walkchamp://walk"
    val title = intent.getStringExtra(EXTRA_TITLE) ?: "Walk Champ"
    val todayStepsExtra = intent.getIntExtra(EXTRA_TODAY_STEPS, -1)
    val bodyFromIntent = intent.getStringExtra(EXTRA_BODY) ?: ""
    val parsedSteps =
      if (todayStepsExtra >= 0) todayStepsExtra else parseStepsFromWalkBody(bodyFromIntent)
    val body =
      bodyFromIntent.takeIf { it.isNotBlank() }
        ?: formatWalkNotificationBody(parsedSteps)
    return buildCurrentWalkNotification(body, deepLink, title)
  }

  private fun completeStartWalkWork(intent: Intent, isStart: Boolean) {
    val deepLink = intent.getStringExtra(EXTRA_DEEP_LINK) ?: "walkchamp://walk"
    val title = intent.getStringExtra(EXTRA_TITLE) ?: "Walk Champ"
    val stepSource = intent.getStringExtra(EXTRA_STEP_SOURCE) ?: "health_connect"
    val todayStepsExtra = intent.getIntExtra(EXTRA_TODAY_STEPS, -1)
    val bodyFromIntent = intent.getStringExtra(EXTRA_BODY) ?: ""
    val parsedSteps =
      if (todayStepsExtra >= 0) todayStepsExtra else parseStepsFromWalkBody(bodyFromIntent)
    val body =
      bodyFromIntent.takeIf { it.isNotBlank() }
        ?: formatWalkNotificationBody(parsedSteps)
    val userId = intent.getStringExtra("userId")
    val apiBaseUrl = intent.getStringExtra("apiBaseUrl")
    val authToken = intent.getStringExtra("authToken")
    val dailyGoalExtra = intent.getIntExtra(EXTRA_DAILY_GOAL, -1)
    val dailyGoal = if (dailyGoalExtra > 0) dailyGoalExtra else null

    persistWalkState(
      body,
      deepLink,
      title,
      parsedSteps,
      null,
      stepSource,
      userId,
      apiBaseUrl,
      authToken,
      dailyGoal,
    )

    val engine = ensureSensorEngine()
    val raceActive = raceState != null && isActiveRace(raceState!!)
    // Never overwrite race_live mode when a live/sponsored race owns the FGS slot —
    // still seed the daily baseline so walk tray + parallel races keep advancing.
    val mode = if (raceActive) "race_live" else "daily_steps"
    engine.updateMetadata(userId, mode, stepSource)
    if (isStart) {
      engine.setPendingKnownTodaySteps(parsedSteps.coerceAtLeast(0))
      engine.seedDailyBaselineFromKnownSteps(parsedSteps.coerceAtLeast(0), stepSource = stepSource)
    } else {
      // UPDATE while already tracking: raise floor only — never full re-seed.
      engine.ensureDailyFloor(parsedSteps.coerceAtLeast(0), stepSource)
    }
    startSensorTrackingIfNeeded()
    startWalkLoopsIfNeeded()
    scheduleSensorWatchdog()
    // Immediately sample so background handoff doesn't wait for the next tick.
    try {
      engine.pollHardwareNow(forceSample = !isScreenInteractive())
    } catch (_: Exception) {
    }
    Log.d(TAG, "[StepFGS] stepUpdate todaySteps=$parsedSteps source=$stepSource sensor=always_on raceActive=$raceActive")
  }

  /**
   * Promote to foreground when allowed (app in foreground / valid FGS start).
   * Falls back to a regular ongoing notification when Android blocks background FGS.
   */
  private fun safeStartForeground(notificationId: Int, notification: Notification): Boolean {
    if (Build.VERSION.SDK_INT >= 33) {
      val granted =
        PermissionChecker.checkSelfPermission(
          this,
          android.Manifest.permission.POST_NOTIFICATIONS,
        ) == PermissionChecker.PERMISSION_GRANTED
      if (!granted) {
        Log.w(TAG, "[WalkChampFGS] notification permission denied")
      }
    }
    return try {
      ensureChannels(this)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        val channelId =
          if (notificationId == NOTIFICATION_ID_RACE) CHANNEL_RACE else CHANNEL_STEPS
        if (notificationManager().getNotificationChannel(channelId) == null) {
          Log.w(TAG, "[WalkChampFGS] channel missing channelId=$channelId")
        }
      }
      val ok = startHealthForegroundService(notificationId, notification)
      if (!ok) {
        Log.w(TAG, "[WalkChampFGS] start failed â€” health FGS prerequisites or SecurityException")
        return false
      }
      val mode =
        if (notificationId == NOTIFICATION_ID_RACE) "live_race" else "total_steps"
      Log.d(TAG, "[WalkChampFGS] startForeground called notificationId=$notificationId")
      Log.d(TAG, "[WalkChampFGS] service running mode=$mode")
      Log.d(TAG, "[WalkChampFGS] notification built successfully")
      Log.d(TAG, "[StepFGS] startForeground called notificationId=$notificationId")
      true
    } catch (e: Exception) {
      Log.w(TAG, "[WalkChampFGS] start failed error=${e.message}")
      try {
        notificationManager().notify(notificationId, notification)
      } catch (_: Exception) {
      }
      false
    }
  }

  private fun postOngoingNotification(notificationId: Int, notification: Notification) {
    try {
      notificationManager().notify(notificationId, notification)
    } catch (e: Exception) {
      // Custom RemoteViews often fail only at notify() time (binder / OEM). Fall back to legacy.
      Log.w(TAG, "[RaceService] notify failed — retrying legacy: ${e.message}")
      try {
        val legacy = rebuildLegacyNotification(notificationId)
        if (legacy != null) {
          notificationManager().notify(notificationId, legacy)
          Log.d(TAG, "[RaceService] legacy notify succeeded id=$notificationId")
        }
      } catch (e2: Exception) {
        Log.w(TAG, "[RaceService] legacy notify also failed: ${e2.message}")
      }
    }
  }

  /** Rebuild text-only notification when custom RemoteViews are rejected at post time. */
  private fun rebuildLegacyNotification(notificationId: Int): Notification? {
    return when (notificationId) {
      NOTIFICATION_ID_WALK -> {
        val body = prefs().getString("walk_body", null) ?: formatWalkNotificationBody(0)
        val deepLink = prefs().getString("walk_deep_link", "walkchamp://walk") ?: "walkchamp://walk"
        val title = prefs().getString("walk_title", "Walk Champ") ?: "Walk Champ"
        buildWalkNotification(
          this,
          body,
          deepLink,
          title,
          getWalkTrackingStartedAt(),
          todaySteps = -1,
          dailyGoal = 0,
          forceLegacy = true,
        )
      }
      NOTIFICATION_ID_RACE -> {
        val state = raceState ?: return null
        buildRaceNotification(
          this,
          state.raceId,
          state.toNotificationBody(),
          state.deepLink(),
          state.raceStartTimeMs,
          state.challengeEndAtMs,
          state.isSponsored,
          state = null,
          forceLegacy = true,
        )
      }
      NOTIFICATION_ID_RACE_PARALLEL -> {
        val state = parallelRaceState ?: return null
        buildRaceNotification(
          this,
          state.raceId,
          state.toNotificationBody(),
          state.deepLink(),
          state.raceStartTimeMs,
          state.challengeEndAtMs,
          state.isSponsored,
          state = null,
          forceLegacy = true,
        )
      }
      else -> null
    }
  }

  override fun onBind(intent: Intent?): IBinder? = null

  private fun isActiveRace(state: RaceNotificationState): Boolean {
    val status = state.raceStatus.lowercase()
    return status != "completed" && status != "cancelled" && status != "quit" && status != "finished"
  }

  private fun ensureWorker() {
    if (workerThread?.isAlive == true) return
    workerThread = HandlerThread("WalkChampRaceFGS").also { it.start() }
    workerHandler = Handler(workerThread!!.looper)
  }

  private fun acquireWakeLock() {
    if (wakeLock?.isHeld == true) return
    val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
    wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "WalkChamp:RaceFGS").apply {
      setReferenceCounted(false)
      // Long enough for a fixed race / daily walk session; renewed on every tick.
      acquire(24 * 60 * 60 * 1000L)
    }
  }

  /** Re-acquire if the previous wake lock timed out while the FGS is still tracking. */
  private fun ensureWakeLock() {
    if (wakeLock?.isHeld == true) return
    acquireWakeLock()
  }

  private fun releaseWakeLock() {
    try {
      if (wakeLock?.isHeld == true) wakeLock?.release()
    } catch (_: Exception) {
    }
    wakeLock = null
  }

  private fun startRaceLoops() {
    ensureWorker()
    workerHandler?.removeCallbacks(notificationTickRunnable)
    workerHandler?.removeCallbacks(backendSyncRunnable)
    workerHandler?.post(notificationTickRunnable)
    workerHandler?.postDelayed(backendSyncRunnable, BACKEND_SYNC_MS)
    // Always run the hardware poll loop for live races (JS is dead in BG/closed).
    startWalkStepRefreshLoop()
    if (walkRunning) {
      startWalkBackendSyncLoop()
    }
    startMidnightCheckLoop()
    startSensorTrackingIfNeeded()
    scheduleSensorWatchdog()
    acquireWakeLock()
  }

  private fun startWalkBackendSyncLoop() {
    ensureWorker()
    workerHandler?.removeCallbacks(walkBackendSyncRunnable)
    workerHandler?.postDelayed(walkBackendSyncRunnable, WALK_BACKEND_SYNC_MS)
    startMidnightCheckLoop()
    startSensorTrackingIfNeeded()
    scheduleSensorWatchdog()
    Log.d(TAG, "[StepFGS] startForeground mode=daily_steps sensor=event-driven")
    acquireWakeLock()
  }

  private fun sensorWatchdogPendingIntent(): PendingIntent {
    val intent = Intent(this, WalkChampRaceForegroundService::class.java).apply {
      action = ACTION_SENSOR_WATCHDOG
    }
    val flags = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    // getForegroundService survives process death on Android 8+; getService often cannot.
    return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      PendingIntent.getForegroundService(this, SENSOR_WATCHDOG_REQUEST_CODE, intent, flags)
    } else {
      PendingIntent.getService(this, SENSOR_WATCHDOG_REQUEST_CODE, intent, flags)
    }
  }

  private fun deferredRestorePendingIntent(): PendingIntent {
    val intent = Intent(this, WalkChampRaceForegroundService::class.java).apply {
      action = ACTION_RESTORE
    }
    val flags = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      PendingIntent.getForegroundService(this, DEFERRED_RESTORE_REQUEST_CODE, intent, flags)
    } else {
      PendingIntent.getService(this, DEFERRED_RESTORE_REQUEST_CODE, intent, flags)
    }
  }

  /** AlarmManager resurrection when promote fails or the process is swiped away. */
  private fun scheduleDeferredRestore() {
    if (!shouldKeepServiceAlive()) return
    try {
      val am = getSystemService(Context.ALARM_SERVICE) as AlarmManager
      val pi = deferredRestorePendingIntent()
      val triggerAt = SystemClock.elapsedRealtime() + DEFERRED_RESTORE_MS
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
        am.setAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP, triggerAt, pi)
      } else {
        am.set(AlarmManager.ELAPSED_REALTIME_WAKEUP, triggerAt, pi)
      }
      Log.d(TAG, "[WalkChampFGS] deferredRestore scheduled in=${DEFERRED_RESTORE_MS}ms")
    } catch (e: Exception) {
      Log.w(TAG, "[WalkChampFGS] deferredRestore schedule failed: ${e.message}")
    }
  }

  /** Re-arm a doze-safe alarm so closed/locked tracking cannot stall indefinitely. */
  private fun scheduleSensorWatchdog() {
    if (!shouldKeepServiceAlive() && !isTrackingActive()) {
      cancelSensorWatchdog()
      return
    }
    try {
      val am = getSystemService(Context.ALARM_SERVICE) as AlarmManager
      val pi = sensorWatchdogPendingIntent()
      val triggerAt = SystemClock.elapsedRealtime() + SENSOR_WATCHDOG_MS
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
        am.setAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP, triggerAt, pi)
      } else {
        am.set(AlarmManager.ELAPSED_REALTIME_WAKEUP, triggerAt, pi)
      }
      Log.d(TAG, "[WalkChampFGS] sensorWatchdog scheduled in=${SENSOR_WATCHDOG_MS}ms")
    } catch (e: Exception) {
      Log.w(TAG, "[WalkChampFGS] sensorWatchdog schedule failed: ${e.message}")
    }
  }

  private fun cancelSensorWatchdog() {
    try {
      val am = getSystemService(Context.ALARM_SERVICE) as AlarmManager
      am.cancel(sensorWatchdogPendingIntent())
      // Cancel legacy getService PI from older APKs.
      val legacy = Intent(this, WalkChampRaceForegroundService::class.java).apply {
        action = ACTION_SENSOR_WATCHDOG
      }
      val flags = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
      am.cancel(PendingIntent.getService(this, SENSOR_WATCHDOG_LEGACY_REQUEST_CODE, legacy, flags))
    } catch (_: Exception) {
    }
  }

  private fun runSensorWatchdog() {
    if (!shouldKeepServiceAlive() && !isTrackingActive()) {
      cancelSensorWatchdog()
      return
    }
    ensureWakeLock()
    ensureWorker()
    startSensorTrackingIfNeeded()
    startWalkStepRefreshLoop()
    try {
      pollHardwareSafe(forceSample = true)
      sensorEngine?.currentState()?.let { handleNativeStepStateUpdate(it) }
    } catch (e: Exception) {
      Log.w(TAG, "[WalkChampFGS] sensorWatchdog poll failed: ${e.message}")
    }
    scheduleSensorWatchdog()
  }

  /**
   * Called when JS AppState goes background/inactive or the task is removed.
   * Native owns continuous walk + race step delivery from this point.
   */
  private fun ensureBackgroundTracking() {
    ensureWorker()
    ensureWakeLock()
    val storedRace = RaceNotificationState.load(this)
    if (raceState == null && storedRace != null && isActiveRace(storedRace)) {
      restoreRaceFromStorage(promoteForeground = true)
    }
    val walkWanted = walkRunning || prefs().getBoolean("walk_active", false)
    if (walkWanted) {
      if (!walkRunning) {
        restoreWalkFromStorage(promoteForeground = raceState == null || !isActiveRace(raceState!!))
      } else {
        walkRunning = true
        startWalkLoopsIfNeeded()
      }
    }
    if (raceState != null && isActiveRace(raceState!!)) {
      startRaceLoops()
      publishRaceNotification()
    }
    startSensorTrackingIfNeeded()
    startWalkStepRefreshLoop()
    scheduleSensorWatchdog()
    try {
      pollHardwareSafe(forceSample = true)
      sensorEngine?.currentState()?.let { handleNativeStepStateUpdate(it) }
    } catch (e: Exception) {
      Log.w(TAG, "[WalkChampFGS] ensureBackground poll failed: ${e.message}")
    }
    Log.d(
      TAG,
      "[WalkChampFGS] ensureBackgroundTracking walk=$walkRunning race=${raceState?.raceId ?: "none"}",
    )
  }

  private fun startMidnightCheckLoop() {
    ensureWorker()
    workerHandler?.removeCallbacks(midnightCheckRunnable)
    workerHandler?.post(midnightCheckRunnable)
  }

  private fun stopMidnightCheckLoop() {
    workerHandler?.removeCallbacks(midnightCheckRunnable)
  }

  private fun startWalkLoopsIfNeeded() {
    startWalkBackendSyncLoop()
    startWalkStepRefreshLoop()
  }

  private fun startWalkStepRefreshLoop() {
    ensureWorker()
    workerHandler?.removeCallbacks(walkStepRefreshRunnable)
    workerHandler?.post(walkStepRefreshRunnable)
    Log.d(TAG, "[WalkChampFGS] running=true walkStepRefreshLoop started")
  }

  private fun stopWalkStepRefreshLoop() {
    workerHandler?.removeCallbacks(walkStepRefreshRunnable)
  }

  private fun stopRaceLoops() {
    workerHandler?.removeCallbacks(notificationTickRunnable)
    workerHandler?.removeCallbacks(backendSyncRunnable)
    workerHandler?.removeCallbacks(walkBackendSyncRunnable)
    stopWalkStepRefreshLoop()
    stopMidnightCheckLoop()
    stopSensorTrackingIfIdle()
    if (raceState == null && !walkRunning) {
      cancelSensorWatchdog()
      releaseWakeLock()
    }
  }

  private fun stopAllLoops() {
    workerHandler?.removeCallbacks(notificationTickRunnable)
    workerHandler?.removeCallbacks(backendSyncRunnable)
    workerHandler?.removeCallbacks(walkBackendSyncRunnable)
    stopWalkStepRefreshLoop()
    stopMidnightCheckLoop()
    cancelSensorWatchdog()
    sensorEngine?.stop()
    releaseWakeLock()
  }

  private fun ensureSensorEngine(): NativeStepSensorEngine {
    if (sensorEngine == null) {
      sensorEngine = NativeStepSensorEngine(applicationContext) { state ->
        val handler = workerHandler
        if (handler != null) {
          handler.post { handleNativeStepStateUpdate(state) }
        } else {
          handleNativeStepStateUpdate(state)
        }
      }
    }
    return sensorEngine!!
  }

  private fun isTrackingActive(): Boolean {
    val race = raceState
    if (walkRunning || (race != null && isActiveRace(race))) return true
    // After process death, in-memory flags are false until restore — prefs keep us alive.
    if (prefs().getBoolean("walk_active", false)) return true
    val stored = RaceNotificationState.load(this)
    return stored != null && isActiveRace(stored)
  }

  private fun startSensorTrackingIfNeeded() {
    if (!isTrackingActive()) return
    Log.d(TAG, "[WalkChampFGS] starting native step engine (Health Connect via JS only)")
    val engine = ensureSensorEngine()
    // Re-register on every ensure — OEM batching often pauses listeners after background.
    engine.restart()
  }

  private fun stopSensorTrackingIfIdle() {
    if (isTrackingActive()) return
    sensorEngine?.stop()
  }

  private fun getActiveUserId(): String? {
    raceState?.userId?.takeIf { it.isNotBlank() }?.let { return it }
    prefs().getString("walk_user_id", null)?.takeIf { it.isNotBlank() }?.let { return it }
    return NativeStepState.getCurrentUserId(this)
  }

  private fun isStepUpdateForCurrentUser(userId: String?): Boolean {
    if (userId.isNullOrBlank()) return true
    val current = getActiveUserId() ?: return true
    if (userId != current) {
      Log.w(TAG, "[StepStore] ignored update for previous user")
      return false
    }
    return true
  }

  private fun enqueueRaceBackendSync(force: Boolean = false) {
    if (raceState == null || !isActiveRace(raceState!!)) return
    ensureWorker()
    workerHandler?.post { performLiveRaceBackendSync(force) }
  }

  private fun persistRaceSyncCredentials(state: RaceNotificationState) {
    if (state.userId.isBlank()) return
    if (state.apiBaseUrl.isNotBlank() && state.authToken.isNotBlank()) {
      RaceSyncCredentials.persist(this, state.userId, state.apiBaseUrl, state.authToken)
    }
  }

  private fun resolveTodayStepsForSync(): Int {
    val native = sensorEngine?.currentState() ?: NativeStepState.load(this)
    return native?.todaySteps?.coerceAtLeast(0)
      ?: parseStepsFromWalkBody(prefs().getString("walk_body", "") ?: "")
  }

  private fun shouldSyncRaceProgress(state: RaceNotificationState, force: Boolean): Boolean {
    if (force) return true
    val now = System.currentTimeMillis()
    val lastSync = lastBackendSyncMs
    val lastSteps = lastSyncedRaceSteps.coerceAtLeast(0)
    val enoughTimePassed = now - lastSync >= RACE_SYNC_MIN_INTERVAL_MS
    val stepsChanged = state.raceSteps > lastSteps
    val should = stepsChanged && enoughTimePassed
    Log.d(
      TAG,
      "[LiveRaceSync] shouldSync=$should raceSteps=${state.raceSteps} lastSynced=$lastSteps enoughTime=$enoughTimePassed",
    )
    return should
  }

  private fun queueRaceSyncOutbox(state: RaceNotificationState, todaySteps: Int, retryCount: Int = 0) {
    if (state.userId.isBlank() || state.raceId.isBlank()) return
    val item = RaceSyncOutboxItem(
      userId = state.userId,
      raceId = state.raceId,
      raceSteps = state.raceSteps,
      todaySteps = todaySteps,
      stepSource = "android_step_counter",
      clientTimestamp = System.currentTimeMillis(),
      retryCount = retryCount,
      nextRetryAt = System.currentTimeMillis() + SYNC_BACKOFF_STEPS[retryCount.coerceAtMost(SYNC_BACKOFF_STEPS.lastIndex)],
    )
    RaceSyncOutboxItem.save(this, item)
    Log.d(TAG, "[LiveRaceSync] outbox replaced latestSteps=${state.raceSteps} raceId=${state.raceId}")
  }

  private fun processRaceSyncOutboxIfReady(force: Boolean = false): Boolean {
    val state = raceState ?: RaceNotificationState.load(this) ?: return false
    if (!isActiveRace(state)) return false
    val outbox = RaceSyncOutboxItem.load(this, state.userId, state.raceId) ?: return false
    val now = System.currentTimeMillis()
    if (!force && outbox.nextRetryAt > now) return false
    val merged = mergeNativeRaceStepsIntoState(
      state.copy(raceSteps = maxOf(state.raceSteps, outbox.raceSteps)),
    )
    return performLiveRaceBackendSync(force = true, stateOverride = merged)
  }

  private fun performLiveRaceBackendSync(
    force: Boolean,
    stateOverride: RaceNotificationState? = null,
  ): Boolean {
    var state = stateOverride ?: raceState ?: return false
    if (!isActiveRace(state)) return false

    state = mergeNativeRaceStepsIntoState(state).withComputedTimeLeft()
    if (state.raceSteps != raceState?.raceSteps || state.timeLeftSeconds != raceState?.timeLeftSeconds) {
      raceState = state
      RaceNotificationState.save(this, state)
    }

    if (!shouldSyncRaceProgress(state, force)) {
      return false
    }

    val creds = RaceSyncCredentials.resolve(this, state, prefs())
    if (creds == null) {
      queueRaceSyncOutbox(state, resolveTodayStepsForSync())
      Log.w(TAG, "[LiveRaceSync] skipped noAuthToken queued=true raceId=${state.raceId}")
      return false
    }

    val (apiBaseUrl, authToken) = creds
    persistRaceSyncCredentials(state.copy(apiBaseUrl = apiBaseUrl, authToken = authToken))

    val todaySteps = resolveTodayStepsForSync()
    val syncSource = "android_step_counter"
    val now = System.currentTimeMillis()
    lastBackendSyncMs = now

    val response = RaceBackgroundSync.syncProgress(
      state.copy(stepSource = syncSource),
      apiBaseUrl = apiBaseUrl,
      authToken = authToken,
      todaySteps = todaySteps,
    )

    if (response == null) {
      queueRaceSyncOutbox(state, todaySteps, syncBackoffIndex)
      scheduleSyncRetry()
      return false
    }

    if (!response.ok) {
      queueRaceSyncOutbox(state, todaySteps, syncBackoffIndex)
      if (response.httpCode == 401) {
        Log.w(TAG, "[LiveRaceSync] failed queued retry reason=401_unauthorized")
      }
      scheduleSyncRetry()
      return false
    }

    syncBackoffIndex = 0
    lastSyncedRaceSteps = state.raceSteps
    RaceSyncOutboxItem.clear(this, state.userId, state.raceId)

    val updated = state.copy(
      rank = response.rank ?: state.rank,
      totalParticipants = response.totalParticipants ?: state.totalParticipants,
      goalSteps = response.goalSteps ?: state.goalSteps,
      timeLeftSeconds = response.timeLeftSeconds ?: state.timeLeftSeconds,
      username = response.username ?: state.username,
      raceStatus = response.raceStatus ?: state.raceStatus,
      lastUpdatedAt = System.currentTimeMillis(),
      apiBaseUrl = apiBaseUrl,
      authToken = authToken,
    )
    raceState = updated
    RaceNotificationState.save(this, updated)
    publishRaceNotification()
    persistRaceNativeMode(updated)
    val existing = NativeStepState.load(this)
    if (existing != null) {
      NativeStepState.save(this, existing.copy(lastBackendSyncedAt = now))
    }

    Log.d(
      TAG,
      "[LiveRaceSync] success syncedSteps=${state.raceSteps} raceId=${state.raceId}",
    )

    val endStatus = response.raceStatus?.lowercase()
    if (endStatus == "completed" || endStatus == "cancelled") {
      stopRace("backend_$endStatus")
    }
    return true
  }

  private fun mergeNativeRaceStepsIntoState(state: RaceNotificationState): RaceNotificationState {
    // Always merge ahead sensor race steps into the live notification while FGS is alive.
    // JS/HC stay canonical when the app is open; hardware fills open/background/closed gaps.
    val native = sensorEngine?.currentState() ?: return state
    if (native.activeRaceId != state.raceId || native.raceSteps < 0) return state
    if (native.raceSteps <= state.raceSteps) return state
    return state.copy(
      raceSteps = native.raceSteps,
      lastUpdatedAt = maxOf(state.lastUpdatedAt, native.updatedAt),
    )
  }

  private fun handleNativeStepStateUpdate(state: NativeStepState) {
    if (!isStepUpdateForCurrentUser(state.userId)) return
    // Renew while walking so the partial wake lock never silently expires mid-session.
    ensureWakeLock()
    val activeRace = raceState
    val raceActive = activeRace != null && isActiveRace(activeRace)

    val todayDelta =
      if (lastNativeTodayStepsForDelta >= 0) {
        (state.todaySteps - lastNativeTodayStepsForDelta).coerceAtLeast(0)
      } else {
        0
      }
    val raceDelta =
      if (lastNativeRaceStepsForDelta >= 0) {
        (state.raceSteps - lastNativeRaceStepsForDelta).coerceAtLeast(0)
      } else {
        0
      }
    lastNativeTodayStepsForDelta = state.todaySteps
    lastNativeRaceStepsForDelta = state.raceSteps.coerceAtLeast(0)

    if (raceActive && state.activeRaceId == activeRace!!.raceId && state.raceSteps >= 0) {
      // Live race ongoing notification: sensor advances steps in open / background / closed
      // (same keep-alive path as daily walk). Monotonic max avoids HC/JS regressions.
      val updated = activeRace.copy(
        raceSteps = maxOf(activeRace.raceSteps, state.raceSteps),
        rank = if (state.rank > 0) state.rank else activeRace.rank,
        totalParticipants = if (state.totalParticipants > 0) state.totalParticipants else activeRace.totalParticipants,
        // Keep the race room's targetSteps — never let a stale sensor/daily goal overwrite it.
        goalSteps = if (activeRace.goalSteps > 0) activeRace.goalSteps else state.goalSteps,
        timeLeftSeconds = if (state.timeLeftSeconds > 0) state.timeLeftSeconds else activeRace.timeLeftSeconds,
        lastUpdatedAt = state.updatedAt,
      ).withComputedTimeLeft()
      val stepsChanged = updated.raceSteps != raceState?.raceSteps
      val metaChanged =
        updated.rank != raceState?.rank ||
          updated.timeLeftSeconds != raceState?.timeLeftSeconds
      if (stepsChanged || metaChanged) {
        raceState = updated
        RaceNotificationState.save(this, updated)
        publishRaceNotification()
        Log.d(
          TAG,
          "[RaceNotification] update source=canonical raceSteps=${updated.raceSteps} rank=${updated.rank}",
        )
      }
      if (stepsChanged) {
        persistRaceNativeMode(updated)
        enqueueRaceBackendSync(force = false)
        val goal = updated.goalSteps
        if (goal > 0 && updated.raceSteps >= goal) {
          enqueueRaceBackendSync(force = true)
        }
      }
    }

    // Sponsored/companion tray (1002): advance from the same hardware deltas while JS is suspended.
    val walked = maxOf(todayDelta, raceDelta)
    if (walked > 0) {
      advanceParallelRaceBySensorSteps(walked, state.updatedAt)
    }

    // Daily walk tray must keep updating even when a live race owns startForeground.
    if (walkRunning) {
      applyWalkNotificationFromNativeState(state)
    }
  }

  private fun advanceParallelRaceBySensorSteps(delta: Int, updatedAt: Long) {
    val parallel = parallelRaceState ?: return
    if (!isActiveRace(parallel) || delta <= 0) return
    val updated = parallel.copy(
      raceSteps = parallel.raceSteps + delta,
      lastUpdatedAt = updatedAt,
    ).withComputedTimeLeft()
    parallelRaceState = updated
    RaceNotificationState.saveParallel(this, updated)
    val display = raceDisplayState(updated)
    if (display == lastParallelRaceDisplayState) return
    lastParallelRaceDisplayState = display
    ensureChannels(this)
    try {
      notificationManager().notify(NOTIFICATION_ID_RACE_PARALLEL, buildRaceNotification(this, updated))
    } catch (e: Exception) {
      Log.w(TAG, "[RaceNotification] parallel notify failed: ${e.message}")
    }
    Log.d(
      TAG,
      "[RaceNotification] parallel sensor delta=$delta raceSteps=${updated.raceSteps} sponsored=${updated.isSponsored}",
    )
  }

  private fun applyWalkNotificationFromNativeState(state: NativeStepState) {
    val verified = RaceNotificationState.isVerifiedStepSource(state.stepSource)
    if (!verified && !state.sensorSupported) {
      Log.w(TAG, "[UnsupportedDevice] step sensor unavailable â€” keeping last known value")
      return
    }
    // Native sensor tray updates are provisional estimates until HC verifies.
    updateWalkNotificationToSteps(state.todaySteps, state.stepSource, provisional = true)
    Log.d(
      TAG,
      "[NotificationBG] notifyUpdated id=$NOTIFICATION_ID_WALK steps=${state.todaySteps} source=${state.stepSource}",
    )
    syncNativeStepState(state)
  }

  /** Never regress the ongoing walk notification within the same local day. */
  private fun monotonicWalkSteps(incoming: Int): Int {
    val today = NativeStepState.localDateString()
    val fromPrefs = parseStepsFromWalkBody(prefs().getString("walk_body", "") ?: "")
    val fromEngine = sensorEngine?.currentState()?.takeIf { it.localDate == today }?.todaySteps ?: 0
    return maxOf(incoming.coerceAtLeast(0), fromPrefs, fromEngine)
  }

  private fun updateWalkNotificationToSteps(
    steps: Int,
    stepSource: String? = null,
    provisional: Boolean = false,
  ) {
    val safeSteps = monotonicWalkSteps(steps)
    val body = formatWalkNotificationBody(safeSteps, provisional)
    val deepLink = prefs().getString("walk_deep_link", "walkchamp://walk") ?: "walkchamp://walk"
    val title = prefs().getString("walk_title", "Walk Champ") ?: "Walk Champ"
    val source = stepSource ?: prefs().getString("walk_step_source", "health_connect") ?: "health_connect"
    val goal = prefs().getInt("walk_daily_goal", 10_000).coerceAtLeast(1)
    val display = WalkNotificationDisplayState(
      steps = safeSteps,
      goal = goal,
      percentage = NotificationVisuals.clampPercent(safeSteps, goal),
      remainingSteps = NotificationVisuals.remainingSteps(safeSteps, goal),
      isTracking = true,
      visualType = if (NotificationVisuals.clampPercent(safeSteps, goal) >= 100) {
        NotificationVisualType.GOAL_COMPLETED
      } else {
        NotificationVisualType.DAILY_WALK
      },
    )
    if (display == lastWalkDisplayState && lastWalkNotification != null) {
      Log.d(TAG, "[WalkChampFGS] skip notify — walk display state unchanged steps=$safeSteps")
      return
    }
    lastWalkNotification = buildCurrentWalkNotification(body, deepLink, title, safeSteps, goal)
    lastWalkDisplayState = display
    val raceOwnsForeground = raceState != null && isActiveRace(raceState!!)
    if (raceOwnsForeground) {
      // Live/sponsored race owns startForeground — walk tray is companion notify-only.
      // Never steal the FGS slot or background sensor delivery dies with the race.
      postOngoingNotification(NOTIFICATION_ID_WALK, lastWalkNotification!!)
    } else {
      safeStartForeground(NOTIFICATION_ID_WALK, lastWalkNotification!!)
      postOngoingNotification(NOTIFICATION_ID_WALK, lastWalkNotification!!)
    }
    Log.d(
      TAG,
      "[WalkChampFGS] notificationUpdated id=$NOTIFICATION_ID_WALK steps=$safeSteps raceOwnsFg=$raceOwnsForeground",
    )
    Log.d(TAG, "[WalkChampFGS] notification update todaySteps=$safeSteps")
    Log.d(TAG, "[WalkChampFGS] notificationManager.notify id=$NOTIFICATION_ID_WALK")
    persistWalkState(body, deepLink, title, safeSteps, null, source)
  }

  /**
   * Reset daily step counters when the local calendar day changes.
   * Runs on a timer so midnight rollover works even if the phone is idle.
   */
  private fun checkMidnightRollover(): Boolean {
    val today = NativeStepState.localDateString()
    var rolled = false

    val engine = sensorEngine
    if (engine != null) {
      if (engine.checkAndRollDailyDay()) rolled = true
    } else {
      val loaded = NativeStepState.load(this)
      if (loaded != null && loaded.localDate != today) {
        val total = loaded.sensorTotal.takeIf { it > 0f }
        NativeStepState.save(
          this,
          loaded.copy(
            localDate = today,
            dailyBaseline = total ?: loaded.dailyBaseline,
            todaySteps = 0,
            updatedAt = System.currentTimeMillis(),
          ),
        )
        rolled = true
      }
    }

    val p = prefs()
    val walkDate = p.getString("walk_local_date", null)
    val raceActive = raceState != null && isActiveRace(raceState!!)
    val walkNotificationActive =
      walkRunning || p.getBoolean("walk_active", false) || lastWalkNotification != null
    val needsWalkReset =
      rolled || (walkDate != null && walkDate != today)

    if (walkNotificationActive && !raceActive && needsWalkReset) {
      val native = sensorEngine?.currentState() ?: NativeStepState.load(this)
      val steps = native?.takeIf { it.localDate == today }?.todaySteps ?: 0
      updateWalkNotificationToSteps(steps)
      p.edit().putString("walk_local_date", today).apply()
      rolled = true
      Log.d(TAG, "[StepFGS] midnight rollover walk notification reset steps=$steps")
    }

    if (!isTrackingActive()) return rolled
    return rolled
  }

  private fun syncNativeStepState(state: NativeStepState) {
    val userId = prefs().getString("walk_user_id", null)
    NativeStepState.save(
      this,
      state.copy(
        userId = userId,
        notificationMode = if (raceState != null && isActiveRace(raceState!!)) "race_live" else "daily_steps",
      ),
    )
  }

  private fun usesDeviceSensor(stepSource: String): Boolean {
    return when (stepSource.lowercase()) {
      "sensor", "android_step_counter", "limited_sensor", "android_legacy_sensor" -> true
      else -> false
    }
  }

  private fun applyRaceState(incoming: RaceNotificationState, allowReset: Boolean = false) {
    if (!allowReset && !isStepUpdateForCurrentUser(incoming.userId)) return
    val previousRaceId = raceState?.raceId
    var merged = raceState?.mergeIncoming(incoming, allowReset) ?: incoming
    if (RaceNotificationState.isVerifiedStepSource(merged.stepSource)) {
      merged = merged.copy(sensorCounterBaseline = 0L, raceStepsAtSensorBaseline = 0)
    }
    raceState = merged.withComputedTimeLeft()
    RaceNotificationState.save(this, raceState)
    persistRaceSyncCredentials(raceState!!)
    persistRaceNativeMode(raceState!!)

    if (allowReset) {
      Log.d(TAG, "[RaceNotification] switch mode=daily_steps -> race_live raceId=${merged.raceId}")
      publishRaceNotification()
      Log.d(TAG, "[WalkChampFGS] service running mode=live_race")
      val isNewRace = !previousRaceId.isNullOrBlank() && previousRaceId != merged.raceId
      if (isNewRace) {
        lastSyncedRaceSteps = -1
        syncBackoffIndex = 0
        lastBackendSyncMs = 0L
      }
      val engine = ensureSensorEngine()
      // Active live race always arms TYPE_STEP_COUNTER so the race notification
      // keeps updating when the app is backgrounded or closed (HC has no native stream).
      engine.updateMetadata(merged.userId, "race_live", "health_connect")
      if (isNewRace || merged.raceSteps <= 0) {
        engine.startRace(merged.raceId)
        merged = merged.copy(
          raceSteps = 0,
          sensorCounterBaseline = 0L,
          raceStepsAtSensorBaseline = 0,
          lastUpdatedAt = System.currentTimeMillis(),
        )
      } else {
        engine.resumeRace(merged.raceId, merged.raceSteps)
      }
      raceState = merged.withComputedTimeLeft()
      RaceNotificationState.save(this, raceState)
      persistRaceNativeMode(raceState!!)
    } else {
      ensureSensorEngine().mergeJsRaceUpdate(
        merged.raceSteps,
        merged.rank,
        merged.totalParticipants,
        merged.goalSteps,
        merged.timeLeftSeconds,
        merged.username,
        merged.stepSource,
      )
      raceState = merged.withComputedTimeLeft()
      publishRaceNotification()
    }
    startSensorTrackingIfNeeded()
  }

  private fun parseStepsFromWalkBody(body: String): Int {
    val match = Regex("([\\d,]+)").find(body) ?: return 0
    return match.groupValues[1].replace(",", "").toIntOrNull() ?: 0
  }

  /**
   * Syncs the current daily step total to the backend when walk tracking is active
   * and the app is backgrounded.  Runs every [WALK_BACKEND_SYNC_MS] on the worker thread.
   */
  private fun tickWalkBackendSync() {
    val p = prefs()
    val userId = p.getString("walk_user_id", null)
    val apiBaseUrl = p.getString("walk_api_base_url", null)
    val authToken = p.getString("walk_auth_token", null)
    if (userId.isNullOrBlank() || apiBaseUrl.isNullOrBlank() || authToken.isNullOrBlank()) return

    val nativeState = sensorEngine?.currentState() ?: NativeStepState.load(this)
    val todaySteps = nativeState?.todaySteps
      ?: parseStepsFromWalkBody(p.getString("walk_body", "") ?: "")
    val stepSource = nativeState?.stepSource
      ?: p.getString("walk_step_source", "health_connect")
      ?: "health_connect"

    if (stepSource == "unsupported" || (nativeState != null && !nativeState.sensorSupported)) return

    // Verified daily only — never POST TYPE_STEP_COUNTER display as Health Connect.
    if (!RaceNotificationState.isVerifiedStepSource(stepSource) || usesDeviceSensor(stepSource)) {
      Log.d(TAG, "[StepFGS] backendSync walk skipped provisional source=$stepSource")
      return
    }

    val now = System.currentTimeMillis()
    if (now - lastWalkBackendSyncMs < WALK_BACKEND_SYNC_MS - 1_000L) return
    lastWalkBackendSyncMs = now

    val localDate = WalkStepBackgroundSync.localDateString()
    Log.d(TAG, "[StepFGS] backendSync walk attempt todaySteps=$todaySteps date=$localDate source=$stepSource")
    val result = WalkStepBackgroundSync.syncDailySteps(
      userId = userId,
      todaySteps = todaySteps,
      stepSource = stepSource,
      apiBaseUrl = apiBaseUrl,
      authToken = authToken,
      localDate = localDate,
    )
    if (result.ok && nativeState != null) {
      NativeStepState.save(
        this,
        nativeState.copy(lastBackendSyncedAt = now),
      )
    }
  }

  /**
   * Re-post the daily-steps ongoing notification after race foreground promotion.
   * Android allows one FGS slot (race) plus a separate notify() for walk steps.
   */
  private fun ensureWalkNotificationVisible() {
    val walkActive = walkRunning || prefs().getBoolean("walk_active", false)
    if (!walkActive) return

    val notification = lastWalkNotification ?: run {
      val p = prefs()
      if (!p.getBoolean("walk_active", false)) return
      val body = p.getString("walk_body", null) ?: return
      val deepLink = p.getString("walk_deep_link", "walkchamp://walk") ?: "walkchamp://walk"
      val title = p.getString("walk_title", "Walk Champ") ?: "Walk Champ"
      buildCurrentWalkNotification(body, deepLink, title)
    }
    lastWalkNotification = notification
    walkRunning = true
    postOngoingNotification(NOTIFICATION_ID_WALK, notification)
    Log.d(TAG, "[StepFGS] ensureWalkNotificationVisible id=$NOTIFICATION_ID_WALK")
  }

  private fun publishRaceNotification() {
    val state = raceState ?: return
    val anchored = state.ensureChronometerAnchors()
    if (anchored != state) {
      raceState = anchored
      RaceNotificationState.save(this, anchored)
    }
    val display = raceDisplayState(anchored)
    if (display == lastRaceDisplayState) {
      Log.d(TAG, "[RaceNotification] skip notify — display state unchanged raceId=${anchored.raceId}")
      return
    }
    val body = anchored.toNotificationBody()
    val notification = buildRaceNotification(this, anchored)
    lastRaceDisplayState = display
    safeStartForeground(NOTIFICATION_ID_RACE, notification)
    postOngoingNotification(NOTIFICATION_ID_RACE, notification)
    ensureWalkNotificationVisible()
    persistRaceNativeMode(anchored)
    Log.d(TAG, "[RaceNotification] content=\"$body\"")
    Log.d(TAG, "[RaceNotification] update source=canonical raceSteps=${anchored.raceSteps}")
    Log.d(
      TAG,
      "[OngoingNotification] action=update trackingType=race notificationId=$NOTIFICATION_ID_RACE startAt=${anchored.raceStartTimeMs} endAt=${anchored.challengeEndAtMs}",
    )
  }

  private fun raceDisplayState(state: RaceNotificationState): RaceNotificationDisplayState {
    val goal = state.goalSteps.coerceAtLeast(0)
    val steps = state.raceSteps.coerceAtLeast(0)
    val visual = NotificationVisuals.forOngoingRace(state.isSponsored)
    return RaceNotificationDisplayState(
      raceId = state.raceId,
      raceTypeLabel = NotificationVisuals.raceTypeLabel(state.isSponsored),
      steps = steps,
      goal = goal,
      percentage = NotificationVisuals.clampPercent(steps, if (goal > 0) goal else 1),
      rank = state.rank,
      participantCount = state.totalParticipants,
      remainingTimeBucket = NotificationVisuals.formatTimeLeft(state.timeLeftSeconds),
      raceStatus = state.raceStatus,
      visualType = visual,
    )
  }

  private fun persistRaceNativeMode(state: RaceNotificationState) {
    val engineState = sensorEngine?.currentState()
    val existing = NativeStepState.load(this)
    val engineMatchesRace = engineState?.activeRaceId == state.raceId
    val raceStepSource = if (isActiveRace(state)) "android_step_counter" else state.stepSource
    NativeStepState.save(
      this,
      NativeStepState(
        userId = state.userId.ifBlank { existing?.userId },
        sensorTotal = (if (engineMatchesRace) engineState?.sensorTotal else null)
          ?: existing?.sensorTotal
          ?: 0f,
        dailyBaseline = existing?.dailyBaseline,
        raceBaseline = if (engineMatchesRace) engineState?.raceBaseline else null,
        todaySteps = existing?.todaySteps ?: 0,
        raceSteps = if (engineMatchesRace) engineState?.raceSteps ?: 0 else state.raceSteps.coerceAtLeast(0),
        activeRaceId = state.raceId,
        notificationMode = "race_live",
        stepSource = if (usesDeviceSensor(raceStepSource) || isActiveRace(state)) {
          "android_step_counter"
        } else {
          raceStepSource
        },
        localDate = existing?.localDate ?: NativeStepState.localDateString(),
        sensorSupported = existing?.sensorSupported ?: true,
        updatedAt = System.currentTimeMillis(),
        lastBackendSyncedAt = existing?.lastBackendSyncedAt,
        rank = state.rank,
        totalParticipants = state.totalParticipants,
        goalSteps = state.goalSteps,
        timeLeftSeconds = state.timeLeftSeconds,
        username = state.username,
        raceStatus = state.raceStatus,
      ),
    )
    Log.d(TAG, "[StepFGS] persisted native state updatedAt=${System.currentTimeMillis()} mode=race_live")
  }

  private fun tickRace(state: RaceNotificationState, syncBackend: Boolean) {
    val now = System.currentTimeMillis()
    var refreshed = mergeNativeRaceStepsIntoState(state).withComputedTimeLeft(now)
    if (
      refreshed.raceSteps != raceState?.raceSteps ||
        refreshed.timeLeftSeconds != raceState?.timeLeftSeconds
    ) {
      raceState = refreshed
      RaceNotificationState.save(this, refreshed)
      publishRaceNotification()
    }

    if (!syncBackend) return
    performLiveRaceBackendSync(force = false)
  }

  private fun scheduleSyncRetry() {
    val delay = SYNC_BACKOFF_STEPS[syncBackoffIndex.coerceAtMost(SYNC_BACKOFF_STEPS.lastIndex)]
    syncBackoffIndex = (syncBackoffIndex + 1).coerceAtMost(SYNC_BACKOFF_STEPS.lastIndex)
    Log.w(TAG, "[LiveRaceSync] failed retryIn=${delay / 1000}s")
    workerHandler?.postDelayed({ performLiveRaceBackendSync(force = true) }, delay)
  }

  private fun stopRace(reason: String) {
    Log.d(TAG, "[RaceService] stop reason=$reason")
    stopRaceLoops()
    raceState = null
    RaceNotificationState.save(this, null)
    val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    nm.cancel(NOTIFICATION_ID_RACE)
    refreshForegroundAfterRaceStop()
  }

  private fun cancelParallelRaceNotification() {
    parallelRaceState = null
    lastParallelRaceDisplayState = null
    RaceNotificationState.saveParallel(this, null)
    try {
      notificationManager().cancel(NOTIFICATION_ID_RACE_PARALLEL)
    } catch (_: Exception) {
    }
    Log.d(TAG, "[RaceNotification] parallel stopped id=$NOTIFICATION_ID_RACE_PARALLEL")
  }

  private fun clearSessionForUser(userId: String) {
    if (userId.isBlank()) return
    Log.d(TAG, "[Logout] clearing active step session userId=$userId")
    stopRaceLoops()
    raceState = null
    cancelParallelRaceNotification()
    RaceNotificationState.clearForUser(this, userId)
    RaceNotificationState.save(this, null)
    notificationManager().cancel(NOTIFICATION_ID_RACE)
    // Always clear walk FGS state on logout so restore cannot re-launch startForegroundService
    // after AuthSwitch (user=none) without ACTIVITY_RECOGNITION / within the FGS timeout.
    walkRunning = false
    foregroundWalkPromoted = false
    foregroundRacePromoted = false
    lastWalkNotification = null
    lastNativeTodayStepsForDelta = -1
    lastNativeRaceStepsForDelta = -1
    clearWalkState()
    notificationManager().cancel(NOTIFICATION_ID_WALK)
    NativeStepState.clearForUser(this, userId)
    NativeStepState.save(this, null)
    RaceSyncCredentials.clearForUser(this, userId)
    RaceSyncOutboxItem.clearForUser(this, userId)
    sensorEngine?.stop()
    sensorEngine = null
    stopSensorTrackingIfIdle()
    // Force stop — never deliverRestoreIntent during logout (that path uses startForegroundService).
    try {
      stopForeground(STOP_FOREGROUND_REMOVE)
    } catch (_: Exception) {
    }
    stopSelf()
  }

  /**
   * Stop race notification and immediately switch to daily-steps notification.
   * Called on race finish/quit/cancel. Logout uses [clearSessionForUser] instead.
   */
  private fun stopRaceAndSwitchToDailySteps(reason: String, todaySteps: Int) {
    if (reason == "logout") {
      clearSessionForUser(getActiveUserId() ?: prefs().getString("walk_user_id", "") ?: "")
      return
    }
    performLiveRaceBackendSync(force = true)
    Log.d(TAG, "[RaceNotification] switch mode=race_live -> daily_steps reason=$reason")
    ensureSensorEngine().endRace(todaySteps.coerceAtLeast(0))
    stopRaceLoops()
    raceState = null
    lastRaceDisplayState = null
    RaceNotificationState.save(this, null)
    val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    nm.cancel(NOTIFICATION_ID_RACE)

    if (todaySteps > 0 || walkRunning) {
      switchToDailyStepsNotification(todaySteps)
    } else {
      Log.d(TAG, "[NotificationMode] switch race_live -> none reason=$reason")
      refreshForegroundAfterRaceStop()
    }
  }

  /**
   * Show (or update) the daily-steps foreground notification.
   * Replaces the race notification as the active foreground notification.
   */
  private fun switchToDailyStepsNotification(todaySteps: Int) {
    val steps = todaySteps.coerceAtLeast(0)
    val body = formatWalkNotificationBody(steps)
    val notification = buildCurrentWalkNotification(body, "walkchamp://walk", "Walk Champ")
    lastWalkNotification = notification
    walkRunning = true
    Log.d(TAG, "[NotificationMode] switch -> daily_steps todaySteps=$steps")
    Log.d(TAG, "[DailyStepsNotification] update todaySteps=$steps")
    safeStartForeground(NOTIFICATION_ID_WALK, notification)
    postOngoingNotification(NOTIFICATION_ID_WALK, notification)
    val walkSource =
      prefs().getString("walk_step_source", null)
        ?: sensorEngine?.currentState()?.stepSource
        ?: "android_step_counter"
    persistWalkState(body, "walkchamp://walk", "Walk Champ", steps, null, walkSource)
    startWalkLoopsIfNeeded()
  }

  private fun refreshForegroundAfterRaceStop() {
    if (shouldKeepServiceAlive()) {
      Log.d(TAG, "[RaceNotification] keepAlive appClosed=true â€” skip stopSelf")
      deliverRestoreIntent()
      return
    }
    if (walkRunning && lastWalkNotification != null) {
      safeStartForeground(NOTIFICATION_ID_WALK, lastWalkNotification!!)
      return
    }
    stopForeground(STOP_FOREGROUND_REMOVE)
    stopSelf()
  }

  private fun shouldKeepServiceAlive(): Boolean {
    val storedRace = RaceNotificationState.load(this)
    if (raceState != null && isActiveRace(raceState!!)) return true
    if (storedRace != null && isActiveRace(storedRace)) return true
    val parallel = parallelRaceState ?: RaceNotificationState.loadParallel(this)
    if (parallel != null && isActiveRace(parallel)) return true
    val native = NativeStepState.load(this)
    if (
      native != null &&
      native.notificationMode == "race_live" &&
      !native.activeRaceId.isNullOrBlank()
    ) {
      return true
    }
    if (walkRunning || prefs().getBoolean("walk_active", false)) return true
    return false
  }

  private fun restoreWalkFromStorage(promoteForeground: Boolean = true): Boolean {
    val p = prefs()
    if (!p.getBoolean("walk_active", false)) return false
    checkMidnightRollover()
    val body = p.getString("walk_body", null) ?: return false
    val deepLink = p.getString("walk_deep_link", "walkchamp://walk") ?: "walkchamp://walk"
    val title = p.getString("walk_title", "Walk Champ") ?: "Walk Champ"
    // Default to verified Health Connect — never flip restore to provisional sensor
    // source or native walk backend sync will skip while the app is closed.
    val stepSource = p.getString("walk_step_source", "health_connect") ?: "health_connect"
    val userId = p.getString("walk_user_id", null)
    val parsedSteps = parseStepsFromWalkBody(body)
    lastWalkNotification = buildCurrentWalkNotification(body, deepLink, title)
    walkRunning = true
    if (promoteForeground) {
      safeStartForeground(NOTIFICATION_ID_WALK, lastWalkNotification!!)
    }
    postOngoingNotification(NOTIFICATION_ID_WALK, lastWalkNotification!!)
    // Re-arm hardware sensor so notification keeps updating after swipe-away / process death.
    // Use ensureDailyFloor — never full re-seed (that freezes counts after ~hundreds of steps).
    val engine = ensureSensorEngine()
    engine.updateMetadata(userId, "daily_steps", stepSource)
    engine.ensureDailyFloor(parsedSteps.coerceAtLeast(0), stepSource)
    startSensorTrackingIfNeeded()
    Log.d(TAG, "[RaceService] restored walk notification from storage promoteFg=$promoteForeground source=$stepSource")
    startWalkLoopsIfNeeded()
    scheduleSensorWatchdog()
    try {
      engine.pollHardwareNow()
    } catch (_: Exception) {
    }
    return true
  }

  private fun deliverRestoreIntent() {
    val restart = Intent(applicationContext, WalkChampRaceForegroundService::class.java).apply {
      action = ACTION_RESTORE
    }
    val canHealthFgs = hasHealthForegroundPrerequisite()
    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && canHealthFgs) {
        ContextCompat.startForegroundService(applicationContext, restart)
      } else {
        // Missing AR: still revive via startService + AlarmManager so sensor loops return.
        if (!canHealthFgs) {
          Log.w(
            TAG,
            "[RaceNotification] ACTIVITY_RECOGNITION missing — restore via startService + alarm",
          )
        }
        applicationContext.startService(restart)
      }
      scheduleDeferredRestore()
      scheduleSensorWatchdog()
      Log.d(TAG, "[RaceNotification] keepAlive appClosed=true restore scheduled")
    } catch (e: Exception) {
      Log.w(TAG, "[RaceService] restore foreground service failed: ${e.message}")
      try {
        applicationContext.startService(restart)
      } catch (_: Exception) {
      }
      scheduleDeferredRestore()
      scheduleSensorWatchdog()
    }
  }

  private fun restoreRaceFromStorage(promoteForeground: Boolean = true): Boolean {
    val loaded = RaceNotificationState.load(this) ?: return false
    if (!isActiveRace(loaded)) return false
    raceState = loaded.withComputedTimeLeft()
    if (promoteForeground) {
      publishRaceNotification()
    } else {
      val notification = buildRaceNotification(this, raceState!!)
      postOngoingNotification(NOTIFICATION_ID_RACE, notification)
    }
    if (usesDeviceSensor(loaded.stepSource) || isActiveRace(loaded)) {
      val engine = ensureSensorEngine()
      engine.updateMetadata(loaded.userId, "race_live", "health_connect")
      val engineState = engine.currentState()
      when {
        engineState.activeRaceId == loaded.raceId && engineState.raceBaseline != null -> engine.start()
        loaded.raceSteps <= 0 -> engine.startRace(loaded.raceId)
        else -> engine.resumeRace(loaded.raceId, loaded.raceSteps)
      }
    }
    startRaceLoops()
    persistRaceSyncCredentials(raceState!!)
    Log.d(TAG, "[RaceService] restored raceId=${loaded.raceId} from storage promoteFg=$promoteForeground")
    return true
  }

  override fun onCreate() {
    super.onCreate()
    Log.d(TAG, "[WalkChampFGS] onCreate buildType=${if ((applicationInfo.flags and ApplicationInfo.FLAG_DEBUGGABLE) != 0) "debug" else "release"} sdk=${Build.VERSION.SDK_INT}")
    ensureChannels(this)
    Log.d(TAG, "[WalkChampFGS] createNotificationChannel success")
    logPostNotificationsGranted(this)
    ensureWorker()
    Log.d(TAG, "[StepFGS] service onCreate")
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val action = intent?.action
    Log.d(TAG, "[WalkChampFGS] onStartCommand action=$action")
    Log.d(TAG, "[RaceService] onStartCommand action=$action START_STICKY")

    if (action == null || action == ACTION_RESTORE) {
      ensureWorker()
      val hasWalk = prefs().getBoolean("walk_active", false)
      val storedRace = RaceNotificationState.load(this)
      val storedParallel = RaceNotificationState.loadParallel(this)
      val hasRace = (raceState != null && isActiveRace(raceState!!)) ||
        (storedRace != null && isActiveRace(storedRace)) ||
        (parallelRaceState != null && isActiveRace(parallelRaceState!!)) ||
        (storedParallel != null && isActiveRace(storedParallel))
      if (!hasWalk && !hasRace) {
        // startForegroundService(RESTORE) still requires startForeground within the OS timeout,
        // even when logout already cleared walk/race state.
        Log.w(TAG, "[WalkChampFGS] RESTORE with nothing to keep alive - promote then stop")
        val placeholder = buildCurrentWalkNotification(
          formatWalkNotificationBody(0),
          "walkchamp://walk",
          "Walk Champ",
        )
        startHealthForegroundService(NOTIFICATION_ID_WALK, placeholder)
        try {
          stopForeground(STOP_FOREGROUND_REMOVE)
        } catch (_: Exception) {
        }
        notificationManager().cancel(NOTIFICATION_ID_WALK)
        stopSelf()
        return START_NOT_STICKY
      }
      if (!foregroundWalkPromoted && hasWalk) {
        val body = prefs().getString("walk_body", null)
        if (!body.isNullOrBlank()) {
          val notification = buildCurrentWalkNotification(
            body,
            prefs().getString("walk_deep_link", "walkchamp://walk") ?: "walkchamp://walk",
            prefs().getString("walk_title", "Walk Champ") ?: "Walk Champ",
          )
          lastWalkNotification = notification
          walkRunning = true
          promoteWalkForegroundNow(notification)
        }
      }
      workerHandler?.post {
        if (raceState == null) restoreRaceFromStorage(promoteForeground = !foregroundRacePromoted)
        if (parallelRaceState == null) {
          val storedParallel = RaceNotificationState.loadParallel(this)
          if (storedParallel != null && isActiveRace(storedParallel) &&
            raceState?.raceId != storedParallel.raceId
          ) {
            parallelRaceState = storedParallel.withComputedTimeLeft()
            lastParallelRaceDisplayState = null
            ensureChannels(this)
            try {
              notificationManager().notify(
                NOTIFICATION_ID_RACE_PARALLEL,
                buildRaceNotification(this, parallelRaceState!!),
              )
            } catch (_: Exception) {
            }
            Log.d(
              TAG,
              "[RaceNotification] restored parallel raceId=${storedParallel.raceId}",
            )
          }
        }
        val walkWanted = walkRunning || prefs().getBoolean("walk_active", false)
        if (raceState == null && !walkRunning) {
          restoreWalkFromStorage(promoteForeground = !foregroundWalkPromoted)
        }
        // Re-arm daily sensor baseline even when a race owns the FGS slot.
        if (walkWanted || walkRunning) {
          val p = prefs()
          if (p.getBoolean("walk_active", false)) {
            walkRunning = true
            val stepSource = p.getString("walk_step_source", "health_connect") ?: "health_connect"
            val userId = p.getString("walk_user_id", null)
            val body = p.getString("walk_body", "") ?: ""
            val parsedSteps = parseStepsFromWalkBody(body)
            val engine = ensureSensorEngine()
            val raceActive = raceState != null && isActiveRace(raceState!!)
            engine.updateMetadata(
              userId,
              if (raceActive) "race_live" else "daily_steps",
              stepSource,
            )
            // Raise floor only — do not re-seed baseline on every RESTORE.
            engine.ensureDailyFloor(parsedSteps.coerceAtLeast(0), stepSource)
            startWalkLoopsIfNeeded()
          }
        }
        raceState?.let {
          if (!foregroundRacePromoted) publishRaceNotification()
          startRaceLoops()
        }
        startSensorTrackingIfNeeded()
        scheduleSensorWatchdog()
        // Immediate poll after restore so closed/locked devices don't wait for a sensor event.
        try {
          ensureSensorEngine().pollHardwareNow()
        } catch (_: Exception) {
        }
      }
      return START_STICKY
    }

    when (action) {
      ACTION_FLUSH_RACE_SYNC -> {
        val trackingActive = shouldKeepServiceAlive()
        ensureWorker()
        workerHandler?.post {
          try {
            Log.d(TAG, "[AppResume] flushing race sync outbox")
            processRaceSyncOutboxIfReady(force = true)
            performLiveRaceBackendSync(force = true)
          } finally {
            if (!shouldKeepServiceAlive()) {
              stopSelf()
            }
          }
        }
        return if (trackingActive) START_STICKY else START_NOT_STICKY
      }
      ACTION_MIDNIGHT_RESET -> {
        ensureWorker()
        workerHandler?.post {
          Log.d(TAG, "[StepFGS] midnight reset requested from JS")
          checkMidnightRollover()
        }
        return START_STICKY
      }
      ACTION_SENSOR_WATCHDOG -> {
        // Doze-safe heartbeat: keep TYPE_STEP_COUNTER / detector delivering while app is closed.
        if (!shouldKeepServiceAlive()) {
          cancelSensorWatchdog()
          return START_NOT_STICKY
        }
        ensureWorker()
        // Promote if needed so Android does not kill a non-foreground restart.
        if (!foregroundWalkPromoted && !foregroundRacePromoted) {
          val storedRace = RaceNotificationState.load(this)
          if (storedRace != null && isActiveRace(storedRace)) {
            restoreRaceFromStorage(promoteForeground = true)
          } else if (prefs().getBoolean("walk_active", false)) {
            restoreWalkFromStorage(promoteForeground = true)
          }
        }
        workerHandler?.post { runSensorWatchdog() }
        return START_STICKY
      }
      ACTION_ENSURE_BACKGROUND -> {
        ensureWorker()
        if (!shouldKeepServiceAlive() &&
          !prefs().getBoolean("walk_active", false) &&
          RaceNotificationState.load(this) == null
        ) {
          return START_NOT_STICKY
        }
        // Promote first so startForeground deadline is met if we were revived.
        if (!foregroundWalkPromoted && !foregroundRacePromoted) {
          val storedRace = RaceNotificationState.load(this)
          if (storedRace != null && isActiveRace(storedRace)) {
            restoreRaceFromStorage(promoteForeground = true)
          } else if (prefs().getBoolean("walk_active", false)) {
            restoreWalkFromStorage(promoteForeground = true)
          }
        }
        workerHandler?.post { ensureBackgroundTracking() }
        return START_STICKY
      }
      ACTION_CLEAR_USER_SESSION -> {
        val userId = intent.getStringExtra("userId") ?: getActiveUserId() ?: ""
        clearSessionForUser(userId)
        return START_NOT_STICKY
      }
      ACTION_STOP -> {
        val raceId = intent.getStringExtra(EXTRA_RACE_ID)
        // Stopping the parallel (secondary) race must not tear down the FGS race.
        if (raceId != null && parallelRaceState?.raceId == raceId && raceState?.raceId != raceId) {
          cancelParallelRaceNotification()
          return START_STICKY
        }
        if (raceId == null || raceState?.raceId == raceId || raceState == null) {
          val reason = intent.getStringExtra("reason") ?: "race_stopped"
          val todaySteps = intent.getIntExtra("todaySteps", 0)
          stopRaceAndSwitchToDailySteps(reason, todaySteps)
        }
        // Walk daily FGS often continues after race stop — keep sticky restart.
        return if (shouldKeepServiceAlive()) START_STICKY else START_NOT_STICKY
      }
      ACTION_UPSERT_PARALLEL_RACE -> {
        val incoming = parseStateFromIntent(intent) ?: return START_STICKY
        // Never duplicate the FGS race as a parallel tray entry.
        if (raceState?.raceId == incoming.raceId) {
          Log.d(TAG, "[RaceNotification] skip parallel — same as FGS raceId=${incoming.raceId}")
          return START_STICKY
        }
        parallelRaceState = incoming.withComputedTimeLeft()
        RaceNotificationState.saveParallel(this, parallelRaceState)
        val display = raceDisplayState(parallelRaceState!!)
        if (display == lastParallelRaceDisplayState) {
          Log.d(TAG, "[RaceNotification] skip parallel notify — display unchanged")
          return START_STICKY
        }
        val notification = buildRaceNotification(this, parallelRaceState!!)
        lastParallelRaceDisplayState = display
        ensureChannels(this)
        notificationManager().notify(NOTIFICATION_ID_RACE_PARALLEL, notification)
        Log.d(
          TAG,
          "[RaceNotification] parallel upsert raceId=${incoming.raceId} id=$NOTIFICATION_ID_RACE_PARALLEL",
        )
        return START_STICKY
      }
      ACTION_STOP_PARALLEL_RACE -> {
        val raceId = intent.getStringExtra(EXTRA_RACE_ID)
        if (raceId == null || parallelRaceState?.raceId == raceId || parallelRaceState == null) {
          cancelParallelRaceNotification()
        }
        return START_STICKY
      }
      ACTION_SWITCH_TO_WALK -> {
        val todaySteps = intent.getIntExtra("todaySteps", 0)
        switchToDailyStepsNotification(todaySteps)
        return START_STICKY
      }
      ACTION_START, ACTION_UPDATE -> {
        val incoming = parseStateFromIntent(intent) ?: return START_STICKY
        val allowReset = action == ACTION_START
        if (action == ACTION_START) {
          Log.d(TAG, "[RaceService] start raceId=${incoming.raceId}")
          // Promoting a race that was shown as parallel — drop the duplicate tray entry.
          if (parallelRaceState?.raceId == incoming.raceId) {
            cancelParallelRaceNotification()
          }
          syncBackoffIndex = 0
          lastBackendSyncMs = 0L
          lastSyncedRaceSteps = -1
          val prev = raceState
          var next = incoming.withComputedTimeLeft()
          // JS rejoin often omits challengeEndAt — keep end anchors for countdown.
          // Title type is NOT sticky from an unrelated prior race: prefer explicit next.isSponsored.
          if (prev != null && prev.raceId == next.raceId) {
            next = next.copy(
              isSponsored = next.isSponsored || prev.isSponsored,
              challengeEndAtMs = when {
                next.challengeEndAtMs > 0L -> next.challengeEndAtMs
                next.isSponsored -> prev.challengeEndAtMs
                else -> 0L
              },
              raceStartTimeMs = when {
                next.raceStartTimeMs > 0L -> next.raceStartTimeMs
                else -> prev.raceStartTimeMs
              },
              goalSteps = if (next.goalSteps > 0) next.goalSteps else prev.goalSteps,
            )
          }
          raceState = next
          // Cancel+repost clears sticky chronometer UI left by older builds.
          notificationManager().cancel(NOTIFICATION_ID_RACE)
          val notification = buildRaceNotification(this, raceState!!)
          promoteRaceForegroundNow(notification)
          postOngoingNotification(NOTIFICATION_ID_RACE, notification)
        }
        ensureWorker()
        workerHandler?.post {
          // Use merged `next` when START so sponsored/end anchors aren't wiped by raw incoming.
          val toApply =
            if (action == ACTION_START) (raceState ?: incoming) else incoming
          applyRaceState(toApply, allowReset)
          startRaceLoops()
        }
      }
      ACTION_STOP_WALK -> {
        walkRunning = false
        foregroundWalkPromoted = false
        lastWalkNotification = null
        clearWalkState()
        stopWalkStepRefreshLoop()
        stopSensorTrackingIfIdle()
        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        nm.cancel(NOTIFICATION_ID_WALK)
        if (raceState != null && isActiveRace(raceState!!)) {
          publishRaceNotification()
          scheduleSensorWatchdog()
        } else {
          cancelSensorWatchdog()
          NativeStepState.save(this, null)
          refreshForegroundAfterRaceStop()
        }
        return START_STICKY
      }
      ACTION_START_WALK, ACTION_UPDATE_WALK -> {
        val todayStepsExtra = intent.getIntExtra(EXTRA_TODAY_STEPS, -1)
        val bodyFromIntent = intent.getStringExtra(EXTRA_BODY) ?: ""
        val parsedSteps =
          if (todayStepsExtra >= 0) todayStepsExtra else parseStepsFromWalkBody(bodyFromIntent)
        val safeSteps = monotonicWalkSteps(parsedSteps)
        val deepLink = intent.getStringExtra(EXTRA_DEEP_LINK) ?: "walkchamp://walk"
        val title = intent.getStringExtra(EXTRA_TITLE) ?: "Walk Champ"
        val body = formatWalkNotificationBody(safeSteps)
        val dailyGoalExtra = intent.getIntExtra(EXTRA_DAILY_GOAL, -1)
        if (dailyGoalExtra > 0) {
          prefs().edit().putInt("walk_daily_goal", dailyGoalExtra).apply()
        }
        val goal = prefs().getInt("walk_daily_goal", 10_000).coerceAtLeast(1)
        val display = WalkNotificationDisplayState(
          steps = safeSteps,
          goal = goal,
          percentage = NotificationVisuals.clampPercent(safeSteps, goal),
          remainingSteps = NotificationVisuals.remainingSteps(safeSteps, goal),
          isTracking = true,
          visualType = if (NotificationVisuals.clampPercent(safeSteps, goal) >= 100) {
            NotificationVisualType.GOAL_COMPLETED
          } else {
            NotificationVisualType.DAILY_WALK
          },
        )
        if (
          action == ACTION_UPDATE_WALK &&
          display == lastWalkDisplayState &&
          lastWalkNotification != null
        ) {
          Log.d(TAG, "[WalkChampFGS] skip UPDATE_WALK notify — display unchanged steps=$safeSteps")
          // Still re-arm sensor/loops so background/closed tracking stays alive.
          walkRunning = true
          ensureWorker()
          intent.putExtra(EXTRA_TODAY_STEPS, safeSteps)
          intent.putExtra(EXTRA_BODY, body)
          workerHandler?.post {
            completeStartWalkWork(intent, isStart = false)
          }
          return START_STICKY
        }
        val notification = buildCurrentWalkNotification(body, deepLink, title, safeSteps, goal)
        lastWalkNotification = notification
        lastWalkDisplayState = display
        walkRunning = true
        // Persist keep-alive BEFORE promote — kill during start must still restore.
        val stepSource =
          intent.getStringExtra(EXTRA_STEP_SOURCE) ?: "health_connect"
        persistWalkState(
          body,
          deepLink,
          title,
          safeSteps,
          null,
          stepSource,
          intent.getStringExtra("userId"),
          intent.getStringExtra("apiBaseUrl"),
          intent.getStringExtra("authToken"),
          if (dailyGoalExtra > 0) dailyGoalExtra else null,
        )
        val nm = notificationManager()
        if (action == ACTION_START_WALK) {
          // Clear sticky chronometer left by older APKs before re-posting.
          nm.cancel(NOTIFICATION_ID_WALK)
        }
        if (raceState != null && isActiveRace(raceState!!)) {
          nm.notify(NOTIFICATION_ID_WALK, notification)
        } else if (action == ACTION_START_WALK) {
          promoteWalkForegroundNow(notification)
          nm.notify(NOTIFICATION_ID_WALK, notification)
        } else {
          if (foregroundWalkPromoted) {
            promoteWalkForegroundNow(notification)
          } else {
            val ok = safeStartForeground(NOTIFICATION_ID_WALK, notification)
            foregroundWalkPromoted = ok
            if (!ok) {
              scheduleDeferredRestore()
              scheduleSensorWatchdog()
            }
          }
          nm.notify(NOTIFICATION_ID_WALK, notification)
        }
        ensureWorker()
        intent.putExtra(EXTRA_TODAY_STEPS, safeSteps)
        intent.putExtra(EXTRA_BODY, body)
        workerHandler?.post {
          completeStartWalkWork(intent, isStart = action == ACTION_START_WALK)
        }
      }
    }
    return START_STICKY
  }

  private fun parseStateFromIntent(intent: Intent): RaceNotificationState? {
    val json = intent.getStringExtra(EXTRA_STATE_JSON)
    if (!json.isNullOrBlank()) {
      return try {
        val map = org.json.JSONObject(json)
        val payload = mutableMapOf<String, Any?>()
        map.keys().forEach { key -> payload[key] = map.get(key) }
        RaceNotificationState.fromPayload(payload)
      } catch (_: Exception) {
        null
      }
    }
    val raceId = intent.getStringExtra(EXTRA_RACE_ID) ?: return null
    val body = intent.getStringExtra(EXTRA_BODY) ?: ""
    return RaceNotificationState(
      raceId = raceId,
      userId = "",
      username = body.lineSequence().firstOrNull()?.substringBefore(":")?.ifBlank { "Runner" } ?: "Runner",
      raceSteps = Regex("(\\d+) steps").find(body)?.groupValues?.getOrNull(1)?.toIntOrNull() ?: 0,
      rank = Regex("Rank #(\\d+)").find(body)?.groupValues?.getOrNull(1)?.toIntOrNull() ?: 1,
      totalParticipants = Regex("of (\\d+)").find(body)?.groupValues?.getOrNull(1)?.toIntOrNull() ?: 1,
      goalSteps = Regex("Goal: (\\d+)").find(body)?.groupValues?.getOrNull(1)?.toIntOrNull() ?: 0,
      timeLeftSeconds = 0,
      raceStatus = "in_progress",
      raceStartTimeMs = 0L,
      challengeEndAtMs = 0L,
      lastUpdatedAt = System.currentTimeMillis(),
      apiBaseUrl = "",
      authToken = "",
      stepSource = "health_connect",
    )
  }

  override fun onTaskRemoved(rootIntent: Intent?) {
    val storedRace = RaceNotificationState.load(this)
    val hasActiveRace =
      (raceState != null && isActiveRace(raceState!!)) ||
        (storedRace != null && isActiveRace(storedRace))
    val keepAlive = shouldKeepServiceAlive()
    Log.d(TAG, "[RaceNotification] onTaskRemoved activeRace=$hasActiveRace keepAlive=$keepAlive")
    if (keepAlive) {
      // Flush keep-alive flags before the process may be killed.
      try {
        prefs().edit().putBoolean("walk_active", walkRunning || prefs().getBoolean("walk_active", false)).commit()
      } catch (_: Exception) {
      }
      ensureBackgroundTracking()
      scheduleSensorWatchdog()
      scheduleDeferredRestore()
      deliverRestoreIntent()
      // Do not call super — default implementation stops the service.
      return
    }
    super.onTaskRemoved(rootIntent)
  }

  override fun onDestroy() {
    Log.d(TAG, "[WalkChampFGS] onDestroy")
    val keepAlive = shouldKeepServiceAlive()
    if (keepAlive) {
      Log.d(TAG, "[RaceService] onDestroy keepAlive=true - scheduling restore")
      deliverRestoreIntent()
    } else {
      stopAllLoops()
      workerThread?.quitSafely()
      workerThread = null
      workerHandler = null
    }
    super.onDestroy()
  }

  // â”€â”€ Walk notification prefs (legacy) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  private fun prefs() = getSharedPreferences("walkchamp_race_fgs_walk", MODE_PRIVATE)

  /** Fixed daily-walk session start â€” set once, restored after service recreation. */
  private fun ensureWalkTrackingStartedAt(): Long {
    val existing = prefs().getLong("walk_tracking_started_at", 0L)
    if (existing > 0L) return existing
    val now = System.currentTimeMillis()
    prefs().edit().putLong("walk_tracking_started_at", now).apply()
    Log.d(TAG, "[OngoingNotification] action=start trackingType=daily trackingStartedAt=$now")
    return now
  }

  private fun getWalkTrackingStartedAt(): Long =
    prefs().getLong("walk_tracking_started_at", 0L)

  private fun buildCurrentWalkNotification(
    body: String,
    deepLink: String,
    title: String,
    todaySteps: Int = -1,
    dailyGoal: Int = -1,
  ): Notification {
    val startedAt = ensureWalkTrackingStartedAt()
    val steps =
      if (todaySteps >= 0) todaySteps
      else parseStepsFromWalkBody(body)
    val goal =
      if (dailyGoal > 0) dailyGoal
      else prefs().getInt("walk_daily_goal", 10_000).coerceAtLeast(1)
    return buildWalkNotification(this, body, deepLink, title, startedAt, steps, goal)
  }

  private fun persistWalkState(
    body: String,
    deepLink: String,
    title: String,
    stepsAtBaseline: Int = parseStepsFromWalkBody(body),
    counterBaseline: Long? = null,
    stepSource: String = "health_connect",
    userId: String? = null,
    apiBaseUrl: String? = null,
    authToken: String? = null,
    dailyGoal: Int? = null,
  ) {
    ensureWalkTrackingStartedAt()
    val editor = prefs().edit()
      .putBoolean("walk_active", true)
      .putString("walk_body", body)
      .putString("walk_deep_link", deepLink)
      .putString("walk_title", title)
      .putString("walk_step_source", stepSource)
      .putString("walk_local_date", NativeStepState.localDateString())
      .putInt("walk_steps_at_baseline", stepsAtBaseline)
      .putLong("walk_state_updated_at", System.currentTimeMillis())
    if (counterBaseline != null && counterBaseline > 0L) {
      editor.putLong("walk_counter_baseline", counterBaseline)
    }
    if (dailyGoal != null && dailyGoal > 0) {
      editor.putInt("walk_daily_goal", dailyGoal)
    }
    // Preserve existing credentials when not supplied — allows sensor ticks to persist
    // steps without accidentally clearing the auth data stored at notification start.
    if (!userId.isNullOrBlank()) editor.putString("walk_user_id", userId)
    if (!apiBaseUrl.isNullOrBlank()) editor.putString("walk_api_base_url", apiBaseUrl)
    if (!authToken.isNullOrBlank()) editor.putString("walk_auth_token", authToken)
    // commit() so swipe-kill before apply() flush still restores walk_active.
    editor.commit()
    // Merge monotonically into native state — never clobber race mode / baselines /
    // higher sensor totals (that froze closed-app counting after a few hundred steps).
    val existing = sensorEngine?.currentState() ?: NativeStepState.load(this)
    if (existing != null) {
      val raceLive = !existing.activeRaceId.isNullOrBlank() ||
        (raceState != null && isActiveRace(raceState!!))
      val nextSource =
        if (usesDeviceSensor(stepSource)) existing.stepSource
        else stepSource.ifBlank { existing.stepSource }
      NativeStepState.save(
        this,
        existing.copy(
          userId = userId?.takeIf { it.isNotBlank() } ?: existing.userId,
          todaySteps = maxOf(existing.todaySteps, stepsAtBaseline.coerceAtLeast(0)),
          notificationMode = if (raceLive) "race_live" else "daily_steps",
          stepSource = nextSource,
          localDate = NativeStepState.localDateString(),
          updatedAt = System.currentTimeMillis(),
        ),
      )
    }
    Log.d(TAG, "[StepFGS] persistNativeState todaySteps=$stepsAtBaseline updatedAt=${System.currentTimeMillis()}")
  }

  private fun clearWalkState() {
    prefs().edit()
      .putBoolean("walk_active", false)
      .remove("walk_body")
      .remove("walk_deep_link")
      .remove("walk_title")
      .remove("walk_step_source")
      .remove("walk_steps_at_baseline")
      .remove("walk_counter_baseline")
      .remove("walk_user_id")
      .remove("walk_api_base_url")
      .remove("walk_auth_token")
      .remove("walk_state_updated_at")
      .remove("walk_local_date")
      .remove("walk_tracking_started_at")
      .remove("walk_daily_goal")
      .apply()
    lastWalkDisplayState = null
    Log.d(TAG, "[OngoingNotification] action=stop trackingType=daily")
  }
}
