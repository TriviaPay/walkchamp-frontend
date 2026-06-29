package com.globalwalkerleague.walkchampraceprogress

import android.content.Intent
import android.os.Build
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class WalkChampRaceProgressModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("WalkChampRaceProgress")

    Events("WalkChampStepStateUpdated")

    OnCreate {
      WalkChampStepStateEmitter.onStepStateUpdated = { payload ->
        sendEvent("WalkChampStepStateUpdated", payload)
      }
    }

    OnDestroy {
      WalkChampStepStateEmitter.onStepStateUpdated = null
    }

    AsyncFunction("startRaceProgressNotification") { payload: Map<String, Any?> ->
      sendRaceService(WalkChampRaceForegroundService.ACTION_START, payload)
      null
    }

    AsyncFunction("updateRaceProgressNotification") { payload: Map<String, Any?> ->
      sendRaceService(WalkChampRaceForegroundService.ACTION_UPDATE, payload)
      null
    }

    AsyncFunction("stopRaceProgressNotification") { payload: Map<String, Any?> ->
      stopRaceService(payload)
      null
    }

    AsyncFunction("startRaceBackgroundService") { payload: Map<String, Any?> ->
      sendRaceService(WalkChampRaceForegroundService.ACTION_START, payload)
      null
    }

    AsyncFunction("updateRaceBackgroundService") { payload: Map<String, Any?> ->
      sendRaceService(WalkChampRaceForegroundService.ACTION_UPDATE, payload)
      null
    }

    AsyncFunction("stopRaceBackgroundService") { payload: Map<String, Any?> ->
      stopRaceService(payload)
      null
    }

    AsyncFunction("getRaceBackgroundState") {
      val ctx = appContext.reactContext ?: return@AsyncFunction null
      val state = RaceNotificationState.load(ctx) ?: return@AsyncFunction null
      state.toJson().toString()
    }

    /**
     * Canonical native step state — persisted by NativeStepSensorEngine / foreground service.
     */
    AsyncFunction("getNativeStepState") {
      val ctx = appContext.reactContext ?: return@AsyncFunction null
      nativeStepStateMap(ctx)
    }

    /** Alias for unified native step state API. */
    AsyncFunction("getNativeWalkStepState") {
      val ctx = appContext.reactContext ?: return@AsyncFunction null
      nativeStepStateMap(ctx)
    }

    AsyncFunction("startStepTrackingService") { payload: Map<String, Any?> ->
      sendWalkService(WalkChampRaceForegroundService.ACTION_START_WALK, payload)
      null
    }

    AsyncFunction("updateStepTrackingService") { payload: Map<String, Any?> ->
      sendWalkService(WalkChampRaceForegroundService.ACTION_UPDATE_WALK, payload)
      null
    }

    AsyncFunction("stopStepTrackingService") { payload: Map<String, Any?>? ->
      val ctx = appContext.reactContext ?: return@AsyncFunction null
      val intent = Intent(ctx, WalkChampRaceForegroundService::class.java).apply {
        action = WalkChampRaceForegroundService.ACTION_STOP_WALK
        putExtra("reason", payload?.get("reason") as? String ?: "tracking_stopped")
      }
      deliverToService(ctx, intent)
      null
    }

    AsyncFunction("startWalkStepNotification") { payload: Map<String, Any?> ->
      sendWalkService(WalkChampRaceForegroundService.ACTION_START_WALK, payload)
      null
    }

    AsyncFunction("updateWalkStepNotification") { payload: Map<String, Any?> ->
      sendWalkService(WalkChampRaceForegroundService.ACTION_UPDATE_WALK, payload)
      null
    }

    AsyncFunction("stopWalkStepNotification") {
      val ctx = appContext.reactContext ?: return@AsyncFunction null
      val intent = Intent(ctx, WalkChampRaceForegroundService::class.java).apply {
        action = WalkChampRaceForegroundService.ACTION_STOP_WALK
      }
      deliverToService(ctx, intent)
      null
    }

    AsyncFunction("flushRaceSyncOutbox") {
      val ctx = appContext.reactContext ?: return@AsyncFunction null
      val intent = Intent(ctx, WalkChampRaceForegroundService::class.java).apply {
        action = WalkChampRaceForegroundService.ACTION_FLUSH_RACE_SYNC
      }
      deliverToService(ctx, intent)
      null
    }

    AsyncFunction("clearNativeStepStateForUser") { userId: String ->
      val ctx = appContext.reactContext ?: return@AsyncFunction null
      NativeStepState.clearForUser(ctx, userId)
      RaceNotificationState.clearForUser(ctx, userId)
      val intent = Intent(ctx, WalkChampRaceForegroundService::class.java).apply {
        action = WalkChampRaceForegroundService.ACTION_CLEAR_USER_SESSION
        putExtra("userId", userId)
      }
      deliverToService(ctx, intent)
      null
    }

    AsyncFunction("startRaceLiveActivity") { payload: Map<String, Any?> ->
      WalkChampRaceLiveActivity.start(appContext.reactContext, payload)
    }

    AsyncFunction("updateRaceLiveActivity") { payload: Map<String, Any?> ->
      WalkChampRaceLiveActivity.update(payload)
    }

    AsyncFunction("endRaceLiveActivity") { payload: Map<String, Any?> ->
      val raceId = payload["raceId"] as? String ?: return@AsyncFunction null
      WalkChampRaceLiveActivity.end(raceId)
    }

    AsyncFunction("startWalkLiveActivity") { payload: Map<String, Any?> ->
      WalkChampWalkLiveActivity.start(payload)
    }

    AsyncFunction("updateWalkLiveActivity") { payload: Map<String, Any?> ->
      WalkChampWalkLiveActivity.update(payload)
    }

    AsyncFunction("endWalkLiveActivity") {
      WalkChampWalkLiveActivity.end()
    }
  }

  private fun stopRaceService(payload: Map<String, Any?>) {
    val raceId = payload["raceId"] as? String ?: return
    val ctx = appContext.reactContext ?: return
    val reason = payload["reason"] as? String ?: "race_stopped"
    val todaySteps = (payload["todaySteps"] as? Number)?.toInt() ?: 0
    val intent = Intent(ctx, WalkChampRaceForegroundService::class.java).apply {
      action = WalkChampRaceForegroundService.ACTION_STOP
      putExtra(WalkChampRaceForegroundService.EXTRA_RACE_ID, raceId)
      putExtra("reason", reason)
      putExtra("todaySteps", todaySteps)
    }
    deliverToService(ctx, intent)
  }

  private fun sendRaceService(action: String, payload: Map<String, Any?>) {
    val ctx = appContext.reactContext ?: return
    val raceId = payload["raceId"] as? String ?: return
    val enriched = enrichRacePayload(payload)
    val state = RaceNotificationState.fromPayload(enriched) ?: return
    val body = payload["body"] as? String ?: state.toNotificationBody()
    val deepLink = payload["deepLink"] as? String ?: state.deepLink()
    WalkChampRaceForegroundService.ensureChannels(ctx)
    val intent = Intent(ctx, WalkChampRaceForegroundService::class.java).apply {
      this.action = action
      putExtra(WalkChampRaceForegroundService.EXTRA_RACE_ID, raceId)
      putExtra(WalkChampRaceForegroundService.EXTRA_BODY, body)
      putExtra(WalkChampRaceForegroundService.EXTRA_DEEP_LINK, deepLink)
      putExtra(WalkChampRaceForegroundService.EXTRA_STATE_JSON, state.toJson().toString())
    }
    if (action == WalkChampRaceForegroundService.ACTION_START) {
      // START must be called from the foreground — use startForegroundService.
      startServiceForeground(ctx, intent)
    } else {
      // UPDATE delivers to an already-running service — safe from any app state.
      deliverToService(ctx, intent)
    }
  }

  private fun enrichRacePayload(payload: Map<String, Any?>): Map<String, Any?> {
    val merged = payload.toMutableMap()
    if (merged["body"] == null) {
      merged["body"] = formatRaceBody(merged)
    }
    return merged
  }

  private fun sendWalkService(action: String, payload: Map<String, Any?>) {
    val ctx = appContext.reactContext ?: return
    val body = payload["body"] as? String ?: formatWalkBody(payload)
    val deepLink = payload["deepLink"] as? String ?: "walkchamp://walk"
    val title = payload["title"] as? String ?: "Walk Champ"
    WalkChampRaceForegroundService.ensureChannels(ctx)
    val intent = Intent(ctx, WalkChampRaceForegroundService::class.java).apply {
      this.action = action
      putExtra(WalkChampRaceForegroundService.EXTRA_BODY, body)
      putExtra(WalkChampRaceForegroundService.EXTRA_DEEP_LINK, deepLink)
      putExtra(WalkChampRaceForegroundService.EXTRA_TITLE, title)
      putExtra(
        WalkChampRaceForegroundService.EXTRA_STEP_SOURCE,
        payload["stepSource"] as? String ?: "health_connect",
      )
      putExtra(
        WalkChampRaceForegroundService.EXTRA_TODAY_STEPS,
        (payload["todaySteps"] as? Number)?.toInt() ?: 0,
      )
      // Credentials allow the native background sync loop to POST daily steps to the backend.
      putExtra("userId", payload["userId"] as? String ?: "")
      putExtra("apiBaseUrl", payload["apiBaseUrl"] as? String ?: "")
      putExtra("authToken", payload["authToken"] as? String ?: "")
    }
    if (action == WalkChampRaceForegroundService.ACTION_START_WALK) {
      startServiceForeground(ctx, intent)
    } else {
      deliverToService(ctx, intent)
    }
  }

  private fun parseStepsFromWalkBody(body: String): Int {
    val match = Regex("([\\d,]+)").find(body) ?: return 0
    return match.groupValues[1].replace(",", "").toIntOrNull() ?: 0
  }

  private fun nativeStepStateMap(ctx: android.content.Context): Map<String, Any?>? {
    val state = NativeStepState.load(ctx)
    if (state != null) {
      return mapOf(
        "userId" to state.userId,
        "sensorTotal" to state.sensorTotal.toDouble(),
        "dailyBaseline" to state.dailyBaseline?.toDouble(),
        "raceBaseline" to state.raceBaseline?.toDouble(),
        "todaySteps" to state.todaySteps,
        "raceSteps" to state.raceSteps,
        "activeRaceId" to state.activeRaceId,
        "notificationMode" to state.notificationMode,
        "stepSource" to state.stepSource,
        "localDate" to state.localDate,
        "sensorSupported" to state.sensorSupported,
        "updatedAt" to state.updatedAt,
        "lastBackendSyncedAt" to state.lastBackendSyncedAt,
        "rank" to state.rank,
        "totalParticipants" to state.totalParticipants,
        "goalSteps" to state.goalSteps,
        "timeLeftSeconds" to state.timeLeftSeconds,
        "username" to state.username,
        "raceStatus" to state.raceStatus,
        "walkActive" to (state.notificationMode == "daily_steps" || ctx.getSharedPreferences("walkchamp_race_fgs_walk", android.content.Context.MODE_PRIVATE).getBoolean("walk_active", false)),
        "lastUpdatedAt" to state.updatedAt,
      )
    }
    val p = ctx.getSharedPreferences("walkchamp_race_fgs_walk", android.content.Context.MODE_PRIVATE)
    if (!p.getBoolean("walk_active", false)) return null
    val body = p.getString("walk_body", "") ?: ""
    val steps = parseStepsFromWalkBody(body)
    val source = p.getString("walk_step_source", "health_connect") ?: "health_connect"
    val updatedAt = p.getLong("walk_state_updated_at", 0L)
    return mapOf(
      "todaySteps" to steps,
      "raceSteps" to 0,
      "stepSource" to source,
      "notificationMode" to "daily_steps",
      "walkActive" to true,
      "updatedAt" to updatedAt,
      "lastUpdatedAt" to updatedAt,
      "sensorSupported" to true,
    )
  }

  /**
   * Start/restart the service as a foreground service.
   * Only safe to call when the app is in the foreground (START actions).
   */
  private fun startServiceForeground(ctx: android.content.Context, intent: Intent): Unit {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      try {
        ctx.startForegroundService(intent)
      } catch (e: Exception) {
        android.util.Log.w("WalkChampFGS", "[RaceService] startForegroundService blocked, using startService: ${e.message}")
        try {
          ctx.startService(intent)
        } catch (_: Exception) {
        }
      }
    } else {
      ctx.startService(intent)
    }
  }

  /**
   * Deliver an intent to an already-running service via startService().
   * Must return Unit — startService() returns ComponentName which Expo cannot marshal.
   */
  private fun deliverToService(ctx: android.content.Context, intent: Intent): Unit {
    try {
      ctx.startService(intent)
    } catch (_: Exception) {
    }
  }

  private fun formatRaceBody(payload: Map<String, Any?>): String {
    val steps = (payload["raceSteps"] as? Number)?.toInt() ?: 0
    val rank = (payload["rank"] as? Number)?.toInt() ?: 1
    val total = (payload["totalParticipants"] as? Number)?.toInt() ?: 1
    val goal = (payload["goalSteps"] as? Number)?.toInt() ?: 0
    val timeLeft = (payload["timeLeftSeconds"] as? Number)?.toInt() ?: 0
    return RaceNotificationState.formatCompactRaceBody(
      raceSteps = steps,
      rank = rank,
      totalParticipants = total,
      goalSteps = goal,
      timeLeftSeconds = timeLeft,
    )
  }

  private fun formatWalkBody(payload: Map<String, Any?>): String {
    val steps = (payload["todaySteps"] as? Number)?.toInt() ?: 0
    return "${String.format("%,d", steps)} total steps today"
  }
}
