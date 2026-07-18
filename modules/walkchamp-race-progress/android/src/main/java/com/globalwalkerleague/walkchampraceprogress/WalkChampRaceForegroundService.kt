package com.globalwalkerleague.walkchampraceprogress

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
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import androidx.core.content.PermissionChecker

class WalkChampRaceForegroundService : Service() {
  companion object {
    const val CHANNEL_RACE = "walkchamp_race_live"
    const val CHANNEL_STEPS = "walkchamp_steps_ongoing"
    const val NOTIFICATION_ID_RACE = 1001
    const val NOTIFICATION_ID_WALK = 91002

    const val ACTION_START = "com.globalwalkerleague.walkchampraceprogress.START"
    const val ACTION_UPDATE = "com.globalwalkerleague.walkchampraceprogress.UPDATE"
    const val ACTION_STOP = "com.globalwalkerleague.walkchampraceprogress.STOP"
    const val ACTION_RESTORE = "com.globalwalkerleague.walkchampraceprogress.RESTORE"

    const val ACTION_START_WALK = "com.globalwalkerleague.walkchampraceprogress.START_WALK"
    const val ACTION_UPDATE_WALK = "com.globalwalkerleague.walkchampraceprogress.UPDATE_WALK"
    const val ACTION_STOP_WALK = "com.globalwalkerleague.walkchampraceprogress.STOP_WALK"
    /** Sent after race ends: switch foreground notification to daily-steps mode. */
    const val ACTION_SWITCH_TO_WALK = "com.globalwalkerleague.walkchampraceprogress.SWITCH_TO_WALK"
    const val ACTION_FLUSH_RACE_SYNC = "com.globalwalkerleague.walkchampraceprogress.FLUSH_RACE_SYNC"
    const val ACTION_CLEAR_USER_SESSION = "com.globalwalkerleague.walkchampraceprogress.CLEAR_USER_SESSION"
    const val ACTION_MIDNIGHT_RESET = "com.globalwalkerleague.walkchampraceprogress.MIDNIGHT_RESET"

    const val EXTRA_RACE_ID = "raceId"
    const val EXTRA_BODY = "body"
    const val EXTRA_DEEP_LINK = "deepLink"
    const val EXTRA_TITLE = "title"
    const val EXTRA_STATE_JSON = "stateJson"
    const val EXTRA_STEP_SOURCE = "stepSource"
    const val EXTRA_TODAY_STEPS = "todaySteps"

    private const val TAG = "WalkChampFGS"

    fun formatWalkNotificationBody(steps: Int): String {
      return "Tracking your steps - ${String.format("%,d", steps.coerceAtLeast(0))} steps today"
    }
    private const val NOTIFICATION_TICK_MS = 3_000L
    /** Race progress backend sync â€” latest value only, not every sensor tick. */
    private const val BACKEND_SYNC_MS = 15_000L
    private const val RACE_SYNC_MIN_INTERVAL_MS = 10_000L
    private const val RACE_SYNC_MIN_STEP_DELTA = 3
    /** How often to sync daily walk steps to the backend when backgrounded. */
    private const val WALK_BACKEND_SYNC_MS = 30_000L
    private const val WALK_STEP_REFRESH_MS = 3_000L
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
      )
    }

    fun buildRaceNotification(
      ctx: Context,
      raceId: String,
      body: String,
      deepLink: String,
      raceStartTimeMs: Long = 0L,
      challengeEndAtMs: Long = 0L,
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
      val builder = NotificationCompat.Builder(ctx, CHANNEL_RACE)
        .setContentTitle("Live Race")
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

      // Native chronometer: Android advances the visible timer without 1s rebuilds.
      when {
        challengeEndAtMs > 0L -> {
          builder
            .setWhen(challengeEndAtMs)
            .setShowWhen(true)
            .setUsesChronometer(true)
            .setChronometerCountDown(true)
          Log.d(
            TAG,
            "[OngoingNotification] trackingType=race chronometerEnabled=true mode=countdown endAt=$challengeEndAtMs",
          )
        }
        raceStartTimeMs > 0L -> {
          builder
            .setWhen(raceStartTimeMs)
            .setShowWhen(true)
            .setUsesChronometer(true)
          Log.d(
            TAG,
            "[OngoingNotification] trackingType=race chronometerEnabled=true mode=elapsed startAt=$raceStartTimeMs",
          )
        }
        else -> {
          Log.d(TAG, "[OngoingNotification] trackingType=race chronometerEnabled=false")
        }
      }
      return builder.build()
    }

    fun buildWalkNotification(
      ctx: Context,
      body: String,
      deepLink: String,
      title: String,
      trackingStartedAtMs: Long = 0L,
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
        .setStyle(NotificationCompat.BigTextStyle().bigText(body))
        .setSmallIcon(notificationSmallIcon(ctx))
        .setOngoing(true)
        .setOnlyAlertOnce(true)
        .setSilent(true)
        .setCategory(NotificationCompat.CATEGORY_SERVICE)
        .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
        .setPriority(NotificationCompat.PRIORITY_LOW)
        .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
        .setContentIntent(pending)

      if (trackingStartedAtMs > 0L) {
        builder
          .setWhen(trackingStartedAtMs)
          .setShowWhen(true)
          .setUsesChronometer(true)
        Log.d(
          TAG,
          "[OngoingNotification] trackingType=daily chronometerEnabled=true trackingStartedAt=$trackingStartedAtMs elapsedMs=${System.currentTimeMillis() - trackingStartedAtMs}",
        )
      } else {
        Log.d(TAG, "[OngoingNotification] trackingType=daily chronometerEnabled=false")
      }

      return builder.build().also {
        Log.d(TAG, "[WalkChampFGS] notification built channelId=$CHANNEL_STEPS")
      }
    }
  }

  private var raceState: RaceNotificationState? = null
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

  private val notificationTickRunnable = object : Runnable {
    override fun run() {
      val state = raceState ?: return
      if (!isActiveRace(state)) return
      tickRace(state, syncBackend = false)
      workerHandler?.postDelayed(this, NOTIFICATION_TICK_MS)
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

  /** Native tick â€” keeps walk notification fresh while app is backgrounded (sensor + JS HC refresh). */
  private val walkStepRefreshRunnable = object : Runnable {
    override fun run() {
      if (!walkRunning) return
      val activeRace = raceState
      if (activeRace != null && isActiveRace(activeRace)) {
        workerHandler?.postDelayed(this, WALK_STEP_REFRESH_MS)
        return
      }
      try {
        sensorEngine?.currentState()?.let { handleNativeStepStateUpdate(it) }
        WalkChampStepStateEmitter.emitWalkStepRefreshRequest()
        Log.d(TAG, "[WalkChampFGS] walkStepRefresh tick emitted")
      } catch (e: Exception) {
        Log.w(TAG, "[WalkChampFGS] walkStepRefresh tick failed", e)
      }
      workerHandler?.postDelayed(this, WALK_STEP_REFRESH_MS)
    }
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
    return try {
      if (Build.VERSION.SDK_INT >= 34) {
        startForeground(
          notificationId,
          notification,
          ServiceInfo.FOREGROUND_SERVICE_TYPE_HEALTH,
        )
      } else {
        startForeground(notificationId, notification)
      }
      true
    } catch (e: SecurityException) {
      Log.e(TAG, "[WalkChampFGS] startForeground SecurityException: ${e.message}")
      try {
        notificationManager().notify(notificationId, notification)
      } catch (_: Exception) {
      }
      false
    } catch (e: Exception) {
      Log.e(TAG, "[WalkChampFGS] startForeground failed: ${e.message}")
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
      Log.w(TAG, "[WalkChampFGS] walk FGS not promoted - notify-only fallback; stopping to avoid FGS timeout crash")
      // startForegroundService requires startForeground or stopSelf within the OS timeout.
      try {
        stopForeground(STOP_FOREGROUND_REMOVE)
      } catch (_: Exception) {
      }
      stopSelf()
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
      Log.w(TAG, "[WalkChampFGS] race FGS not promoted - notify-only fallback; stopping to avoid FGS timeout crash")
      try {
        stopForeground(STOP_FOREGROUND_REMOVE)
      } catch (_: Exception) {
      }
      stopSelf()
    }
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

    persistWalkState(body, deepLink, title, parsedSteps, null, stepSource, userId, apiBaseUrl, authToken)

    if (raceState != null && isActiveRace(raceState!!)) {
      return
    }

    val engine = ensureSensorEngine()
    engine.updateMetadata(userId, "daily_steps", stepSource)
    engine.setPendingKnownTodaySteps(parsedSteps.coerceAtLeast(0))
    if (isStart) {
      engine.seedDailyBaselineFromKnownSteps(parsedSteps.coerceAtLeast(0), stepSource = stepSource)
    } else {
      engine.mergeJsWalkUpdate(parsedSteps.coerceAtLeast(0), stepSource)
    }
    startSensorTrackingIfNeeded()
    if (isStart || raceState == null) {
      startWalkLoopsIfNeeded()
    }
    Log.d(TAG, "[StepFGS] stepUpdate todaySteps=$parsedSteps source=$stepSource sensor=always_on")
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
      Log.w(TAG, "[RaceService] notify failed: ${e.message}")
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
      acquire(3 * 60 * 60 * 1000L)
    }
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
    if (walkRunning) {
      startWalkBackendSyncLoop()
    }
    startMidnightCheckLoop()
    startSensorTrackingIfNeeded()
    acquireWakeLock()
  }

  private fun startWalkBackendSyncLoop() {
    ensureWorker()
    workerHandler?.removeCallbacks(walkBackendSyncRunnable)
    workerHandler?.postDelayed(walkBackendSyncRunnable, WALK_BACKEND_SYNC_MS)
    startMidnightCheckLoop()
    startSensorTrackingIfNeeded()
    Log.d(TAG, "[StepFGS] startForeground mode=daily_steps sensor=event-driven")
    acquireWakeLock()
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
      releaseWakeLock()
    }
  }

  private fun stopAllLoops() {
    workerHandler?.removeCallbacks(notificationTickRunnable)
    workerHandler?.removeCallbacks(backendSyncRunnable)
    workerHandler?.removeCallbacks(walkBackendSyncRunnable)
    stopWalkStepRefreshLoop()
    stopMidnightCheckLoop()
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
    return walkRunning || (race != null && isActiveRace(race))
  }

  private fun startSensorTrackingIfNeeded() {
    if (!isTrackingActive()) return
    Log.d(TAG, "[WalkChampFGS] sensor registration starting")
    Log.d(TAG, "[StepFGS] service started â€” registering hardware step sensor")
    ensureSensorEngine().start()
    Log.d(TAG, "[WalkChampFGS] sensor registered")
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
    val activeRace = raceState
    val raceActive = activeRace != null && isActiveRace(activeRace)

    if (raceActive && state.activeRaceId == activeRace!!.raceId && state.raceSteps >= 0) {
      // Live race ongoing notification: sensor advances steps in open / background / closed
      // (same keep-alive path as daily walk). Monotonic max avoids HC/JS regressions.
      val updated = activeRace.copy(
        raceSteps = maxOf(activeRace.raceSteps, state.raceSteps),
        rank = if (state.rank > 0) state.rank else activeRace.rank,
        totalParticipants = if (state.totalParticipants > 0) state.totalParticipants else activeRace.totalParticipants,
        goalSteps = if (state.goalSteps > 0) state.goalSteps else activeRace.goalSteps,
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

    if (!walkRunning) return
    if (raceActive) return

    applyWalkNotificationFromNativeState(state)
  }

  private fun applyWalkNotificationFromNativeState(state: NativeStepState) {
    val verified = RaceNotificationState.isVerifiedStepSource(state.stepSource)
    if (!verified && !state.sensorSupported) {
      Log.w(TAG, "[UnsupportedDevice] step sensor unavailable â€” keeping last known value")
      return
    }
    updateWalkNotificationToSteps(state.todaySteps, state.stepSource)
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

  private fun updateWalkNotificationToSteps(steps: Int, stepSource: String? = null) {
    val safeSteps = monotonicWalkSteps(steps)
    val body = formatWalkNotificationBody(safeSteps)
    val deepLink = prefs().getString("walk_deep_link", "walkchamp://walk") ?: "walkchamp://walk"
    val title = prefs().getString("walk_title", "Walk Champ") ?: "Walk Champ"
    val source = stepSource ?: prefs().getString("walk_step_source", "health_connect") ?: "health_connect"
    lastWalkNotification = buildCurrentWalkNotification(body, deepLink, title)
    val nm = notificationManager()
    safeStartForeground(NOTIFICATION_ID_WALK, lastWalkNotification!!)
    nm.notify(NOTIFICATION_ID_WALK, lastWalkNotification!!)
    Log.d(
      TAG,
      "[WalkChampFGS] notificationUpdated id=$NOTIFICATION_ID_WALK steps=$safeSteps",
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
      engine.updateMetadata(merged.userId, "race_live", "android_step_counter")
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

    val now = System.currentTimeMillis()
    if (now - lastWalkBackendSyncMs < WALK_BACKEND_SYNC_MS - 1_000L) return
    lastWalkBackendSyncMs = now

    val localDate = WalkStepBackgroundSync.localDateString()
    Log.d(TAG, "[StepFGS] backendSync walk attempt todaySteps=$todaySteps date=$localDate")
    val result = WalkStepBackgroundSync.syncDailySteps(
      userId = userId,
      todaySteps = todaySteps,
      stepSource = if (usesDeviceSensor(stepSource)) "android_step_counter" else stepSource,
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
    val body = anchored.toNotificationBody()
    val notification = buildRaceNotification(this, anchored)
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

  private fun clearSessionForUser(userId: String) {
    if (userId.isBlank()) return
    Log.d(TAG, "[Logout] clearing active step session userId=$userId")
    stopRaceLoops()
    raceState = null
    RaceNotificationState.clearForUser(this, userId)
    RaceNotificationState.save(this, null)
    notificationManager().cancel(NOTIFICATION_ID_RACE)
    // Always clear walk FGS state on logout so restore cannot re-launch startForegroundService
    // after AuthSwitch (user=none) without ACTIVITY_RECOGNITION / within the FGS timeout.
    walkRunning = false
    foregroundWalkPromoted = false
    foregroundRacePromoted = false
    lastWalkNotification = null
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
    val stepSource = p.getString("walk_step_source", "android_step_counter") ?: "android_step_counter"
    val userId = p.getString("walk_user_id", null)
    val parsedSteps = parseStepsFromWalkBody(body)
    lastWalkNotification = buildCurrentWalkNotification(body, deepLink, title)
    walkRunning = true
    if (promoteForeground) {
      safeStartForeground(NOTIFICATION_ID_WALK, lastWalkNotification!!)
    }
    postOngoingNotification(NOTIFICATION_ID_WALK, lastWalkNotification!!)
    // Re-arm hardware sensor so notification keeps updating after swipe-away / process death.
    val engine = ensureSensorEngine()
    engine.updateMetadata(userId, "daily_steps", stepSource)
    engine.setPendingKnownTodaySteps(parsedSteps.coerceAtLeast(0))
    if (parsedSteps > 0) {
      engine.seedDailyBaselineFromKnownSteps(parsedSteps, stepSource = stepSource)
    }
    startSensorTrackingIfNeeded()
    Log.d(TAG, "[RaceService] restored walk notification from storage promoteFg=$promoteForeground source=$stepSource")
    startWalkLoopsIfNeeded()
    return true
  }

  private fun deliverRestoreIntent() {
    if (!hasHealthForegroundPrerequisite()) {
      Log.w(
        TAG,
        "[RaceNotification] skip restore startForegroundService - ACTIVITY_RECOGNITION missing",
      )
      return
    }
    val restart = Intent(applicationContext, WalkChampRaceForegroundService::class.java).apply {
      action = ACTION_RESTORE
    }
    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        ContextCompat.startForegroundService(applicationContext, restart)
      } else {
        applicationContext.startService(restart)
      }
      Log.d(TAG, "[RaceNotification] keepAlive appClosed=true restore scheduled")
    } catch (e: Exception) {
      Log.w(TAG, "[RaceService] restore foreground service failed: ${e.message}")
      try {
        applicationContext.startService(restart)
      } catch (_: Exception) {
      }
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
      engine.updateMetadata(loaded.userId, "race_live", "android_step_counter")
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
      val hasRace = (raceState != null && isActiveRace(raceState!!)) ||
        (storedRace != null && isActiveRace(storedRace))
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
        if (raceState == null && !walkRunning) restoreWalkFromStorage(promoteForeground = !foregroundWalkPromoted)
        // Early promote above may set walkRunning without re-arming the sensor — fix that.
        if (raceState == null && walkRunning) {
          val p = prefs()
          val stepSource = p.getString("walk_step_source", "android_step_counter") ?: "android_step_counter"
          val userId = p.getString("walk_user_id", null)
          val body = p.getString("walk_body", "") ?: ""
          val parsedSteps = parseStepsFromWalkBody(body)
          val engine = ensureSensorEngine()
          engine.updateMetadata(userId, "daily_steps", stepSource)
          if (parsedSteps > 0) {
            engine.seedDailyBaselineFromKnownSteps(parsedSteps, stepSource = stepSource)
          }
          startWalkLoopsIfNeeded()
        }
        raceState?.let {
          if (!foregroundRacePromoted) publishRaceNotification()
          startRaceLoops()
        }
        startSensorTrackingIfNeeded()
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
      ACTION_CLEAR_USER_SESSION -> {
        val userId = intent.getStringExtra("userId") ?: getActiveUserId() ?: ""
        clearSessionForUser(userId)
        return START_NOT_STICKY
      }
      ACTION_STOP -> {
        val raceId = intent.getStringExtra(EXTRA_RACE_ID)
        if (raceId == null || raceState?.raceId == raceId || raceState == null) {
          val reason = intent.getStringExtra("reason") ?: "race_stopped"
          val todaySteps = intent.getIntExtra("todaySteps", 0)
          stopRaceAndSwitchToDailySteps(reason, todaySteps)
        }
        return START_NOT_STICKY
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
          syncBackoffIndex = 0
          lastBackendSyncMs = 0L
          lastSyncedRaceSteps = -1
          raceState = incoming.withComputedTimeLeft()
          val notification = buildRaceNotification(this, raceState!!)
          promoteRaceForegroundNow(notification)
          postOngoingNotification(NOTIFICATION_ID_RACE, notification)
        }
        ensureWorker()
        workerHandler?.post {
          applyRaceState(incoming, allowReset)
          startRaceLoops()
        }
      }
      ACTION_STOP_WALK -> {
        walkRunning = false
        foregroundWalkPromoted = false
        lastWalkNotification = null
        clearWalkState()
        stopSensorTrackingIfIdle()
        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        nm.cancel(NOTIFICATION_ID_WALK)
        if (raceState != null && isActiveRace(raceState!!)) {
          publishRaceNotification()
        } else {
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
        val notification = buildCurrentWalkNotification(body, deepLink, title)
        lastWalkNotification = notification
        walkRunning = true
        val nm = notificationManager()
        if (raceState != null && isActiveRace(raceState!!)) {
          nm.notify(NOTIFICATION_ID_WALK, notification)
        } else if (action == ACTION_START_WALK) {
          promoteWalkForegroundNow(notification)
          nm.notify(NOTIFICATION_ID_WALK, notification)
        } else {
          if (foregroundWalkPromoted) {
            promoteWalkForegroundNow(notification)
          } else {
            safeStartForeground(NOTIFICATION_ID_WALK, notification)
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
      if (raceState == null && hasActiveRace) {
        restoreRaceFromStorage(promoteForeground = true)
      }
      if (raceState != null && isActiveRace(raceState!!)) {
        publishRaceNotification()
        startRaceLoops()
      } else if (walkRunning || restoreWalkFromStorage(promoteForeground = true)) {
        startWalkLoopsIfNeeded()
      }
      startSensorTrackingIfNeeded()
      deliverRestoreIntent()
      // Do not call super â€” default implementation stops the service.
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
  ): Notification {
    val startedAt = ensureWalkTrackingStartedAt()
    return buildWalkNotification(this, body, deepLink, title, startedAt)
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
    // Preserve existing credentials when not supplied â€” allows sensor ticks to persist
    // steps without accidentally clearing the auth data stored at notification start.
    if (!userId.isNullOrBlank()) editor.putString("walk_user_id", userId)
    if (!apiBaseUrl.isNullOrBlank()) editor.putString("walk_api_base_url", apiBaseUrl)
    if (!authToken.isNullOrBlank()) editor.putString("walk_auth_token", authToken)
    editor.apply()
    val nativeSource = if (usesDeviceSensor(stepSource)) "android_step_counter" else stepSource
    val existing = NativeStepState.load(this)
    NativeStepState.save(
      this,
      NativeStepState(
        userId = userId ?: existing?.userId,
        sensorTotal = existing?.sensorTotal ?: 0f,
        dailyBaseline = existing?.dailyBaseline,
        raceBaseline = existing?.raceBaseline,
        todaySteps = stepsAtBaseline.coerceAtLeast(0),
        raceSteps = existing?.raceSteps ?: 0,
        activeRaceId = existing?.activeRaceId,
        notificationMode = "daily_steps",
        stepSource = nativeSource,
        localDate = NativeStepState.localDateString(),
        sensorSupported = existing?.sensorSupported ?: true,
        updatedAt = System.currentTimeMillis(),
        lastBackendSyncedAt = existing?.lastBackendSyncedAt,
      ),
    )
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
      .apply()
    Log.d(TAG, "[OngoingNotification] action=stop trackingType=daily")
  }
}
