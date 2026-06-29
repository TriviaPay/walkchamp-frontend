package com.globalwalkerleague.walkchampraceprogress

import android.content.Context
import org.json.JSONObject
import java.util.Calendar
import java.util.Locale

/**
 * Canonical native step state persisted while the foreground service runs.
 * This is the source of truth when the JS runtime is asleep.
 */
data class NativeStepState(
  val userId: String?,
  val sensorTotal: Float,
  val dailyBaseline: Float?,
  val raceBaseline: Float?,
  val todaySteps: Int,
  val raceSteps: Int,
  val activeRaceId: String?,
  val notificationMode: String,
  val stepSource: String,
  val localDate: String,
  val sensorSupported: Boolean,
  val updatedAt: Long,
  val lastBackendSyncedAt: Long?,
  val rank: Int = 1,
  val totalParticipants: Int = 1,
  val goalSteps: Int = 0,
  val timeLeftSeconds: Int = 0,
  val username: String = "Runner",
  val raceStatus: String = "idle",
) {
  fun toJson(): JSONObject = JSONObject().apply {
    put("userId", userId ?: "")
    put("sensorTotal", sensorTotal.toDouble())
    put("dailyBaseline", dailyBaseline?.toDouble() ?: JSONObject.NULL)
    put("raceBaseline", raceBaseline?.toDouble() ?: JSONObject.NULL)
    put("todaySteps", todaySteps)
    put("raceSteps", raceSteps)
    put("activeRaceId", activeRaceId ?: "")
    put("notificationMode", notificationMode)
    put("stepSource", stepSource)
    put("localDate", localDate)
    put("sensorSupported", sensorSupported)
    put("updatedAt", updatedAt)
    put("lastBackendSyncedAt", lastBackendSyncedAt ?: JSONObject.NULL)
    put("rank", rank)
    put("totalParticipants", totalParticipants)
    put("goalSteps", goalSteps)
    put("timeLeftSeconds", timeLeftSeconds)
    put("username", username)
    put("raceStatus", raceStatus)
    put("walkActive", notificationMode == "daily_steps")
  }

  fun toEventMap(): Map<String, Any?> = mapOf(
    "userId" to userId,
    "todaySteps" to todaySteps,
    "raceSteps" to raceSteps,
    "activeRaceId" to activeRaceId,
    "stepSource" to stepSource,
    "notificationMode" to notificationMode,
    "updatedAt" to updatedAt,
    "sensorTotal" to sensorTotal.toDouble(),
    "sensorSupported" to sensorSupported,
    "rank" to rank,
    "totalParticipants" to totalParticipants,
    "goalSteps" to goalSteps,
    "timeLeftSeconds" to timeLeftSeconds,
  )

  companion object {
    private const val PREFS = "walkchamp_native_step_state"
    private const val KEY_JSON = "state_json"
    private const val KEY_CURRENT_USER = "current_user_id"

    private fun stateKey(userId: String) = "$KEY_JSON:$userId"

    fun getCurrentUserId(ctx: Context): String? =
      ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        .getString(KEY_CURRENT_USER, null)
        ?.takeIf { it.isNotBlank() }

    fun setCurrentUserId(ctx: Context, userId: String?) {
      val editor = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
      if (userId.isNullOrBlank()) {
        editor.remove(KEY_CURRENT_USER)
      } else {
        editor.putString(KEY_CURRENT_USER, userId)
      }
      editor.apply()
    }

    fun localDateString(): String {
      val cal = Calendar.getInstance()
      return String.format(
        Locale.US,
        "%04d-%02d-%02d",
        cal.get(Calendar.YEAR),
        cal.get(Calendar.MONTH) + 1,
        cal.get(Calendar.DAY_OF_MONTH),
      )
    }

    fun load(ctx: Context, userId: String? = null): NativeStepState? {
      val prefs = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      val uid = userId?.takeIf { it.isNotBlank() } ?: getCurrentUserId(ctx)
      val raw = when {
        uid != null -> prefs.getString(stateKey(uid), null)
        else -> null
      } ?: prefs.getString(KEY_JSON, null)
      return try {
        val json = JSONObject(raw ?: return null)
        val state = NativeStepState(
          userId = json.optString("userId").ifBlank { null },
          sensorTotal = json.optDouble("sensorTotal", 0.0).toFloat(),
          dailyBaseline = if (json.isNull("dailyBaseline")) null else json.optDouble("dailyBaseline").toFloat(),
          raceBaseline = if (json.isNull("raceBaseline")) null else json.optDouble("raceBaseline").toFloat(),
          todaySteps = json.optInt("todaySteps", 0),
          raceSteps = json.optInt("raceSteps", 0),
          activeRaceId = json.optString("activeRaceId").ifBlank { null },
          notificationMode = json.optString("notificationMode", "none"),
          stepSource = json.optString("stepSource", "android_step_counter"),
          localDate = json.optString("localDate", localDateString()),
          sensorSupported = json.optBoolean("sensorSupported", true),
          updatedAt = json.optLong("updatedAt", System.currentTimeMillis()),
          lastBackendSyncedAt = if (json.isNull("lastBackendSyncedAt")) null else json.optLong("lastBackendSyncedAt"),
          rank = json.optInt("rank", 1),
          totalParticipants = json.optInt("totalParticipants", 1),
          goalSteps = json.optInt("goalSteps", 0),
          timeLeftSeconds = json.optInt("timeLeftSeconds", 0),
          username = json.optString("username", "Runner"),
          raceStatus = json.optString("raceStatus", "idle"),
        )
        if (uid == null && !state.userId.isNullOrBlank()) {
          save(ctx, state)
        }
        state
      } catch (_: Exception) {
        null
      }
    }

    fun save(ctx: Context, state: NativeStepState?) {
      val prefs = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      if (state == null) {
        val current = getCurrentUserId(ctx)
        val editor = prefs.edit().remove(KEY_JSON)
        if (current != null) {
          editor.remove(stateKey(current))
        }
        editor.apply()
        return
      }
      val uid = state.userId?.takeIf { it.isNotBlank() } ?: return
      setCurrentUserId(ctx, uid)
      prefs.edit()
        .putString(stateKey(uid), state.toJson().toString())
        .remove(KEY_JSON)
        .apply()
    }

    fun clearForUser(ctx: Context, userId: String) {
      if (userId.isBlank()) return
      val prefs = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      val editor = prefs.edit().remove(stateKey(userId))
      if (getCurrentUserId(ctx) == userId) {
        editor.remove(KEY_CURRENT_USER).remove(KEY_JSON)
      }
      editor.apply()
    }
  }
}
