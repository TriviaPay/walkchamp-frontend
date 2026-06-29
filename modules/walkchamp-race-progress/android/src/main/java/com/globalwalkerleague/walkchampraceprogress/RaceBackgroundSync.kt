package com.globalwalkerleague.walkchampraceprogress

import android.util.Log
import org.json.JSONObject
import java.io.BufferedReader
import java.io.BufferedWriter
import java.io.InputStreamReader
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.atomic.AtomicInteger

data class RaceSyncResponse(
  val ok: Boolean,
  val httpCode: Int = 0,
  val acceptedSteps: Int,
  val rank: Int?,
  val totalParticipants: Int?,
  val goalSteps: Int?,
  val timeLeftSeconds: Int?,
  val username: String?,
  val raceStatus: String?,
)

object RaceBackgroundSync {
  private val syncSeq = AtomicInteger(0)
  private const val TAG = "LiveRaceSync"

  fun syncProgress(
    state: RaceNotificationState,
    apiBaseUrl: String,
    authToken: String,
    todaySteps: Int = 0,
  ): RaceSyncResponse? {
    val base = apiBaseUrl.trim().removeSuffix("/")
    val token = authToken.trim()
    if (base.isBlank() || token.isBlank() || state.raceId.isBlank()) {
      Log.w(
        TAG,
        "[LiveRaceSync] skipped noAuthToken queued=true raceId=${state.raceId} hasApi=${base.isNotBlank()} hasToken=${token.isNotBlank()}",
      )
      return null
    }

    val url = URL("$base/api/races/${state.raceId}/progress")
    val conn = (url.openConnection() as HttpURLConnection).apply {
      requestMethod = "POST"
      connectTimeout = 12_000
      readTimeout = 12_000
      doOutput = true
      setRequestProperty("Content-Type", "application/json")
      setRequestProperty("Authorization", "Bearer $token")
    }

    val seq = syncSeq.incrementAndGet()
    val stepsBucket = (state.raceSteps / 10) * 10
    val tsBucket = System.currentTimeMillis() / 10_000L
    val stepSource = if (state.stepSource.isBlank()) "android_step_counter" else state.stepSource
    val body = JSONObject().apply {
      put("steps", state.raceSteps)
      put("raceSteps", state.raceSteps)
      put("todaySteps", todaySteps.coerceAtLeast(0))
      if (state.userId.isNotBlank()) put("userId", state.userId)
      put("deviceTime", java.time.Instant.now().toString())
      put("clientTimestamp", java.time.Instant.now().toString())
      put("stepSource", stepSource)
      put("sequenceId", seq)
      put("platform", "android")
      put("appState", "background_service")
      put(
        "idempotencyKey",
        "race_progress:${state.raceId}:${state.userId}:$stepsBucket:$tsBucket",
      )
    }

    return try {
      Log.d(
        TAG,
        "[LiveRaceSync] sending background progress raceId=${state.raceId} steps=${state.raceSteps} userId=${state.userId}",
      )
      BufferedWriter(OutputStreamWriter(conn.outputStream)).use { it.write(body.toString()) }
      val code = conn.responseCode
      val stream = if (code in 200..299) conn.inputStream else conn.errorStream
      val text = BufferedReader(InputStreamReader(stream)).use { it.readText() }
      val json = try {
        JSONObject(text)
      } catch (_: Exception) {
        JSONObject()
      }
      val ok = code in 200..299
      val accepted = when {
        json.has("steps") -> json.optInt("steps", state.raceSteps)
        json.has("raceSteps") -> json.optInt("raceSteps", state.raceSteps)
        else -> state.raceSteps
      }
      if (ok) {
        Log.d(
          TAG,
          "[LiveRaceSync] success rank=${json.optInt("rank", -1)} syncedSteps=$accepted raceId=${state.raceId}",
        )
        Log.d(TAG, "[LiveRaceBroadcast] backend accepted and broadcast raceId=${state.raceId}")
      } else {
        Log.w(
          TAG,
          "[LiveRaceSync] failed queued retry reason=http_$code raceId=${state.raceId}",
        )
      }
      RaceSyncResponse(
        ok = ok,
        httpCode = code,
        acceptedSteps = accepted.coerceAtLeast(0),
        rank = json.optInt("rank", -1).takeIf { it > 0 },
        totalParticipants = json.optInt("totalParticipants", -1).takeIf { it > 0 },
        goalSteps = json.optInt("goalSteps", -1).takeIf { it > 0 },
        timeLeftSeconds = json.optInt("timeLeftSeconds", -1).takeIf { it >= 0 },
        username = json.optString("username").takeIf { it.isNotBlank() },
        raceStatus = json.optString("raceStatus").takeIf { it.isNotBlank() }
          ?: json.optString("race_status").takeIf { it.isNotBlank() },
      )
    } catch (e: Exception) {
      Log.w(TAG, "[LiveRaceSync] failed queued retry reason=${e.message}")
      null
    } finally {
      conn.disconnect()
    }
  }
}
