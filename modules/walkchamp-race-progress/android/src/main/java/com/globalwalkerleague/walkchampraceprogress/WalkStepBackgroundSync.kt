package com.globalwalkerleague.walkchampraceprogress

import android.util.Log
import org.json.JSONObject
import java.io.BufferedReader
import java.io.BufferedWriter
import java.io.InputStreamReader
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL
import java.util.Calendar

/**
 * Syncs daily walk step count to the backend from the native foreground service.
 *
 * Called every 30 s while the walk notification is active and the app is backgrounded.
 * Only the latest absolute total is sent — no replay of every missed update.
 */
object WalkStepBackgroundSync {
  private const val TAG = "WalkChampFGS"

  data class WalkSyncResult(val ok: Boolean)

  fun syncDailySteps(
    userId: String,
    todaySteps: Int,
    stepSource: String,
    apiBaseUrl: String,
    authToken: String,
    localDate: String,
  ): WalkSyncResult {
    if (userId.isBlank() || apiBaseUrl.isBlank() || authToken.isBlank()) {
      Log.d(TAG, "[StepFGS] backendSync walk skipped — missing credentials")
      return WalkSyncResult(ok = false)
    }
    if (todaySteps <= 0) return WalkSyncResult(ok = false)

    val base = apiBaseUrl.trim().removeSuffix("/")
    val conn = (URL("$base/api/walk/steps").openConnection() as HttpURLConnection).apply {
      requestMethod = "POST"
      connectTimeout = 12_000
      readTimeout = 12_000
      doOutput = true
      setRequestProperty("Content-Type", "application/json")
      setRequestProperty("Authorization", "Bearer $authToken")
    }

    // Bucket key prevents backend from accepting the same progress twice within a
    // 50-step / 30-second window (idempotency key matches JS outbox pattern).
    val stepsBucket = (todaySteps / 50) * 50
    val tsBucket = System.currentTimeMillis() / 30_000L
    val bodyJson = JSONObject().apply {
      put("steps", todaySteps)
      put("totalSteps", todaySteps)
      put("localDate", localDate)
      put("source", stepSource)
      put("platform", "android")
      put("appState", "background_service")
      put("idempotencyKey", "walk_steps:$userId:$localDate:$stepsBucket:$tsBucket")
    }

    return try {
      Log.d(TAG, "[StepFGS] backendSync walk send userId=$userId todaySteps=$todaySteps date=$localDate")
      BufferedWriter(OutputStreamWriter(conn.outputStream)).use { it.write(bodyJson.toString()) }
      val code = conn.responseCode
      val ok = code in 200..299
      if (ok) {
        Log.d(TAG, "[StepFGS] backendSync walk success http=$code")
      } else {
        val errText = try {
          BufferedReader(InputStreamReader(conn.errorStream)).use { it.readText() }
        } catch (_: Exception) { "" }
        Log.w(TAG, "[StepFGS] backendSync walk failed http=$code err=$errText")
      }
      WalkSyncResult(ok = ok)
    } catch (e: Exception) {
      Log.w(TAG, "[StepFGS] backendSync walk exception: ${e.message}")
      WalkSyncResult(ok = false)
    } finally {
      conn.disconnect()
    }
  }

  /** Returns the local date as "YYYY-MM-DD" in the device's default timezone. */
  fun localDateString(): String {
    val cal = Calendar.getInstance()
    return String.format(
      java.util.Locale.US,
      "%04d-%02d-%02d",
      cal.get(Calendar.YEAR),
      cal.get(Calendar.MONTH) + 1,
      cal.get(Calendar.DAY_OF_MONTH),
    )
  }
}
