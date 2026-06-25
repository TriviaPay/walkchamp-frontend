package com.globalwalkerleague.walkchampraceprogress

import android.content.Intent
import android.os.Build
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class WalkChampRaceProgressModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("WalkChampRaceProgress")

    AsyncFunction("startRaceProgressNotification") { payload: Map<String, Any?> ->
      sendRaceService(WalkChampRaceForegroundService.ACTION_START, payload)
    }

    AsyncFunction("updateRaceProgressNotification") { payload: Map<String, Any?> ->
      sendRaceService(WalkChampRaceForegroundService.ACTION_UPDATE, payload)
    }

    AsyncFunction("stopRaceProgressNotification") { payload: Map<String, Any?> ->
      val raceId = payload["raceId"] as? String ?: return@AsyncFunction
      val ctx = appContext.reactContext ?: return@AsyncFunction
      val intent = Intent(ctx, WalkChampRaceForegroundService::class.java).apply {
        action = WalkChampRaceForegroundService.ACTION_STOP
        putExtra(WalkChampRaceForegroundService.EXTRA_RACE_ID, raceId)
      }
      ctx.startService(intent)
    }

    AsyncFunction("startWalkStepNotification") { payload: Map<String, Any?> ->
      sendWalkService(WalkChampRaceForegroundService.ACTION_START_WALK, payload)
    }

    AsyncFunction("updateWalkStepNotification") { payload: Map<String, Any?> ->
      sendWalkService(WalkChampRaceForegroundService.ACTION_UPDATE_WALK, payload)
    }

    AsyncFunction("stopWalkStepNotification") {
      val ctx = appContext.reactContext ?: return@AsyncFunction
      val intent = Intent(ctx, WalkChampRaceForegroundService::class.java).apply {
        action = WalkChampRaceForegroundService.ACTION_STOP_WALK
      }
      ctx.startService(intent)
    }

    AsyncFunction("startRaceLiveActivity") { payload: Map<String, Any?> ->
      WalkChampRaceLiveActivity.start(appContext.reactContext, payload)
    }

    AsyncFunction("updateRaceLiveActivity") { payload: Map<String, Any?> ->
      WalkChampRaceLiveActivity.update(payload)
    }

    AsyncFunction("endRaceLiveActivity") { payload: Map<String, Any?> ->
      val raceId = payload["raceId"] as? String ?: return@AsyncFunction
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

  private fun sendRaceService(action: String, payload: Map<String, Any?>) {
    val ctx = appContext.reactContext ?: return
    val raceId = payload["raceId"] as? String ?: return
    val body = payload["body"] as? String ?: formatRaceBody(payload)
    val deepLink = payload["deepLink"] as? String ?: "globalwalkerleague://race/$raceId"
    WalkChampRaceForegroundService.ensureChannels(ctx)
    val intent = Intent(ctx, WalkChampRaceForegroundService::class.java).apply {
      this.action = action
      putExtra(WalkChampRaceForegroundService.EXTRA_RACE_ID, raceId)
      putExtra(WalkChampRaceForegroundService.EXTRA_BODY, body)
      putExtra(WalkChampRaceForegroundService.EXTRA_DEEP_LINK, deepLink)
    }
    startServiceIntent(ctx, intent)
  }

  private fun sendWalkService(action: String, payload: Map<String, Any?>) {
    val ctx = appContext.reactContext ?: return
    val body = payload["body"] as? String ?: formatWalkBody(payload)
    val deepLink = payload["deepLink"] as? String ?: "globalwalkerleague://walk"
    val title = payload["title"] as? String ?: "Walk Champ"
    WalkChampRaceForegroundService.ensureChannels(ctx)
    val intent = Intent(ctx, WalkChampRaceForegroundService::class.java).apply {
      this.action = action
      putExtra(WalkChampRaceForegroundService.EXTRA_BODY, body)
      putExtra(WalkChampRaceForegroundService.EXTRA_DEEP_LINK, deepLink)
      putExtra(WalkChampRaceForegroundService.EXTRA_TITLE, title)
    }
    startServiceIntent(ctx, intent)
  }

  private fun startServiceIntent(ctx: android.content.Context, intent: Intent) {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      ctx.startForegroundService(intent)
    } else {
      ctx.startService(intent)
    }
  }

  private fun formatRaceBody(payload: Map<String, Any?>): String {
    val username = payload["username"] as? String ?: "Runner"
    val steps = (payload["raceSteps"] as? Number)?.toInt() ?: 0
    val rank = (payload["rank"] as? Number)?.toInt() ?: 1
    val total = (payload["totalParticipants"] as? Number)?.toInt() ?: 1
    val goal = (payload["goalSteps"] as? Number)?.toInt() ?: 0
    val timeLeft = (payload["timeLeftSeconds"] as? Number)?.toInt() ?: 0
    val timeLabel = if (timeLeft > 0) {
      val m = timeLeft / 60
      val s = timeLeft % 60
      String.format("%d:%02d", m, s)
    } else {
      "Open"
    }
    return "$username: $steps steps\nRank #$rank of $total\nGoal: $goal\nTime Left: $timeLabel"
  }

  private fun formatWalkBody(payload: Map<String, Any?>): String {
    val steps = (payload["todaySteps"] as? Number)?.toInt() ?: 0
    val goal = (payload["dailyGoal"] as? Number)?.toInt() ?: 10_000
    val pct = if (goal > 0) ((steps.toDouble() / goal.toDouble()) * 100).toInt().coerceIn(0, 100) else 0
    return "$steps steps today\nGoal: $goal ($pct%)"
  }
}
