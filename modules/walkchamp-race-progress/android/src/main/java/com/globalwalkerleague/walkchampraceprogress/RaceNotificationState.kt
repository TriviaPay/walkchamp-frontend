package com.globalwalkerleague.walkchampraceprogress

import android.content.Context
import org.json.JSONObject
import java.util.Locale

/**
 * Canonical active-race state persisted for foreground-service recovery.
 */
data class RaceNotificationState(
  val raceId: String,
  val userId: String,
  val username: String,
  val raceSteps: Int,
  val rank: Int,
  val totalParticipants: Int,
  val goalSteps: Int,
  val timeLeftSeconds: Int,
  val raceStatus: String,
  val raceStartTimeMs: Long,
  val challengeEndAtMs: Long,
  val lastUpdatedAt: Long,
  val apiBaseUrl: String,
  val authToken: String,
  val stepSource: String,
  /** Cumulative TYPE_STEP_COUNTER at race start — used for background step reads. */
  val sensorCounterBaseline: Long = 0L,
  /** Race step count when [sensorCounterBaseline] was captured — pairs with sensor delta. */
  val raceStepsAtSensorBaseline: Int = 0,
) {
  fun toNotificationBody(): String = formatCompactRaceBody(
    raceSteps = raceSteps,
    rank = rank,
    totalParticipants = totalParticipants,
    goalSteps = goalSteps,
    timeLeftSeconds = timeLeftSeconds,
  )

  fun deepLink(): String = "walkchamp://race/$raceId"

  fun mergeIncoming(
    incoming: RaceNotificationState,
    allowReset: Boolean = false,
  ): RaceNotificationState {
    if (incoming.raceId != raceId) {
      return if (allowReset) incoming else this
    }
    if (
      !allowReset &&
      incoming.userId.isNotBlank() &&
      userId.isNotBlank() &&
      incoming.userId != userId
    ) {
      return this
    }

    val source = incoming.stepSource.ifBlank { stepSource }
    val verified = isVerifiedStepSource(source)

    // Health Connect / HealthKit updates from JS are authoritative — never keep stale inflated counts.
    if (!allowReset && !verified && incoming.lastUpdatedAt < lastUpdatedAt) {
      return this
    }

    val mergedSteps = when {
      allowReset -> incoming.raceSteps
      verified -> incoming.raceSteps.coerceAtLeast(0)
      else -> maxOf(raceSteps, incoming.raceSteps)
    }
    return copy(
      username = incoming.username.ifBlank { username },
      raceSteps = mergedSteps,
      rank = if (incoming.rank > 0) incoming.rank else rank,
      totalParticipants = if (incoming.totalParticipants > 0) incoming.totalParticipants else totalParticipants,
      goalSteps = if (incoming.goalSteps > 0) incoming.goalSteps else goalSteps,
      timeLeftSeconds = incoming.timeLeftSeconds,
      raceStatus = incoming.raceStatus.ifBlank { raceStatus },
      // Never overwrite session anchors once set — chronometer must not jump/reset.
      raceStartTimeMs = when {
        raceStartTimeMs > 0L -> raceStartTimeMs
        incoming.raceStartTimeMs > 0L -> incoming.raceStartTimeMs
        else -> 0L
      },
      challengeEndAtMs = when {
        challengeEndAtMs > 0L -> challengeEndAtMs
        incoming.challengeEndAtMs > 0L -> incoming.challengeEndAtMs
        else -> 0L
      },
      lastUpdatedAt = maxOf(lastUpdatedAt, incoming.lastUpdatedAt),
      apiBaseUrl = incoming.apiBaseUrl.ifBlank { apiBaseUrl },
      authToken = incoming.authToken.ifBlank { authToken },
      stepSource = incoming.stepSource.ifBlank { stepSource },
      sensorCounterBaseline = if (incoming.sensorCounterBaseline > 0L) {
        incoming.sensorCounterBaseline
      } else {
        sensorCounterBaseline
      },
      raceStepsAtSensorBaseline = if (incoming.raceStepsAtSensorBaseline > 0 || incoming.sensorCounterBaseline > 0L) {
        incoming.raceStepsAtSensorBaseline
      } else {
        raceStepsAtSensorBaseline
      },
    )
  }

  fun withComputedTimeLeft(nowMs: Long = System.currentTimeMillis()): RaceNotificationState {
    val anchored = ensureChronometerAnchors(nowMs)
    if (anchored.challengeEndAtMs <= 0) return anchored
    val left = ((anchored.challengeEndAtMs - nowMs) / 1000L).toInt().coerceAtLeast(0)
    return if (left == anchored.timeLeftSeconds) anchored
    else anchored.copy(timeLeftSeconds = left, lastUpdatedAt = nowMs)
  }

  /**
   * Lock session anchors once so chronometer never resets on update/restore.
   * If end is missing but a positive timeLeft snapshot exists, derive end once.
   */
  fun ensureChronometerAnchors(nowMs: Long = System.currentTimeMillis()): RaceNotificationState {
    var start = raceStartTimeMs
    var end = challengeEndAtMs
    if (start <= 0L) start = nowMs
    if (end <= 0L && timeLeftSeconds > 0) {
      end = nowMs + timeLeftSeconds * 1000L
    }
    if (start == raceStartTimeMs && end == challengeEndAtMs) return this
    return copy(raceStartTimeMs = start, challengeEndAtMs = end)
  }

  fun toJson(): JSONObject = JSONObject().apply {
    put("raceId", raceId)
    put("userId", userId)
    put("username", username)
    put("raceSteps", raceSteps)
    put("rank", rank)
    put("totalParticipants", totalParticipants)
    put("goalSteps", goalSteps)
    put("timeLeftSeconds", timeLeftSeconds)
    put("raceStatus", raceStatus)
    put("raceStartTimeMs", raceStartTimeMs)
    put("challengeEndAtMs", challengeEndAtMs)
    put("lastUpdatedAt", lastUpdatedAt)
    put("apiBaseUrl", apiBaseUrl)
    put("authToken", authToken)
    put("stepSource", stepSource)
    put("sensorCounterBaseline", sensorCounterBaseline)
    put("raceStepsAtSensorBaseline", raceStepsAtSensorBaseline)
  }

  companion object {
    private const val PREFS_NAME = "walkchamp_race_fgs"
    private const val KEY_STATE_JSON = "race_state_json"
    private const val KEY_RACE_ACTIVE = "race_active"
    private const val KEY_ACTIVE_USER_ID = "race_active_user_id"

    fun stateKey(userId: String) = "$KEY_STATE_JSON:$userId"

    fun formatCompactRaceBody(
      raceSteps: Int,
      rank: Int,
      totalParticipants: Int,
      goalSteps: Int,
      timeLeftSeconds: Int,
    ): String {
      val stepsText = String.format(Locale.US, "%,d", raceSteps.coerceAtLeast(0))
      val goalText = formatGoalSteps(goalSteps)
      // Elapsed / countdown is owned by Android notification chronometer (setWhen).
      // Keep body steps/rank/goal only so a frozen "m:ss left" string cannot stick.
      val openHint = if (timeLeftSeconds <= 0) " - Open" else ""
      return "$stepsText steps - #$rank/$totalParticipants - Goal $goalText$openHint"
    }

    private fun formatGoalSteps(goalSteps: Int): String {
      val goal = goalSteps.coerceAtLeast(0)
      if (goal >= 10_000 && goal % 1000 == 0) return "${goal / 1000}K"
      if (goal >= 1000 && goal % 1000 == 0) return "${goal / 1000}K"
      return String.format(Locale.US, "%,d", goal)
    }

    fun isVerifiedStepSource(stepSource: String): Boolean {
      return when (stepSource.lowercase()) {
        "health_connect", "android_health_connect", "healthkit", "ios_healthkit" -> true
        else -> false
      }
    }

    fun fromPayload(payload: Map<String, Any?>, nowMs: Long = System.currentTimeMillis()): RaceNotificationState? {
      val raceId = payload["raceId"] as? String ?: return null
      val userId = payload["userId"] as? String ?: ""
      val username = payload["username"] as? String ?: "Runner"
      val raceSteps = (payload["raceSteps"] as? Number)?.toInt() ?: 0
      val rank = (payload["rank"] as? Number)?.toInt() ?: 1
      val total = (payload["totalParticipants"] as? Number)?.toInt() ?: 1
      val goal = (payload["goalSteps"] as? Number)?.toInt() ?: 0
      val timeLeft = (payload["timeLeftSeconds"] as? Number)?.toInt() ?: 0
      val status = payload["raceStatus"] as? String ?: "in_progress"
      var raceStartMs = parseTimeMs(payload["raceStartTime"])
      var challengeEndMs = parseTimeMs(payload["challengeEndAt"])
      if (raceStartMs <= 0L) raceStartMs = nowMs
      // Derive end once from remaining seconds when caller has no absolute end.
      if (challengeEndMs <= 0L && timeLeft > 0) {
        challengeEndMs = nowMs + timeLeft * 1000L
      }
      val apiBase = payload["apiBaseUrl"] as? String ?: ""
      val token = payload["authToken"] as? String ?: ""
      val source = payload["stepSource"] as? String ?: "health_connect"
      val sensorBaseline = (payload["sensorCounterBaseline"] as? Number)?.toLong() ?: 0L
      val raceStepsAtBaseline = (payload["raceStepsAtSensorBaseline"] as? Number)?.toInt() ?: raceSteps
      return RaceNotificationState(
        raceId = raceId,
        userId = userId,
        username = username,
        raceSteps = raceSteps.coerceAtLeast(0),
        rank = rank.coerceAtLeast(1),
        totalParticipants = total.coerceAtLeast(1),
        goalSteps = goal.coerceAtLeast(0),
        timeLeftSeconds = timeLeft.coerceAtLeast(0),
        raceStatus = status,
        raceStartTimeMs = raceStartMs,
        challengeEndAtMs = challengeEndMs,
        lastUpdatedAt = nowMs,
        apiBaseUrl = apiBase,
        authToken = token,
        stepSource = source,
        sensorCounterBaseline = sensorBaseline,
        raceStepsAtSensorBaseline = raceStepsAtBaseline,
      )
    }

    private fun parseTimeMs(value: Any?): Long {
      return when (value) {
        is Number -> value.toLong()
        is String -> {
          if (value.all { it.isDigit() }) value.toLongOrNull() ?: 0L
          else try {
            java.time.Instant.parse(value).toEpochMilli()
          } catch (_: Exception) {
            0L
          }
        }
        else -> 0L
      }
    }

    fun load(ctx: Context, userId: String? = null): RaceNotificationState? {
      val prefs = ctx.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
      if (!prefs.getBoolean(KEY_RACE_ACTIVE, false)) return null
      val uid = userId?.takeIf { it.isNotBlank() }
        ?: prefs.getString(KEY_ACTIVE_USER_ID, null)?.takeIf { it.isNotBlank() }
      val raw = when {
        uid != null -> prefs.getString(stateKey(uid), null)
        else -> null
      } ?: prefs.getString(KEY_STATE_JSON, null)
      return try {
        val json = JSONObject(raw ?: return null)
        RaceNotificationState(
          raceId = json.optString("raceId"),
          userId = json.optString("userId"),
          username = json.optString("username", "Runner"),
          raceSteps = json.optInt("raceSteps", 0),
          rank = json.optInt("rank", 1),
          totalParticipants = json.optInt("totalParticipants", 1),
          goalSteps = json.optInt("goalSteps", 0),
          timeLeftSeconds = json.optInt("timeLeftSeconds", 0),
          raceStatus = json.optString("raceStatus", "in_progress"),
          raceStartTimeMs = json.optLong("raceStartTimeMs", 0L),
          challengeEndAtMs = json.optLong("challengeEndAtMs", 0L),
          lastUpdatedAt = json.optLong("lastUpdatedAt", System.currentTimeMillis()),
          apiBaseUrl = json.optString("apiBaseUrl", ""),
          authToken = json.optString("authToken", ""),
          stepSource = json.optString("stepSource", "health_connect"),
          sensorCounterBaseline = json.optLong("sensorCounterBaseline", 0L),
          raceStepsAtSensorBaseline = json.optInt("raceStepsAtSensorBaseline", 0),
        ).takeIf { it.raceId.isNotBlank() }?.also { state ->
          if (uid == null && state.userId.isNotBlank()) {
            save(ctx, state)
          }
        }
      } catch (_: Exception) {
        null
      }
    }

    fun save(ctx: Context, state: RaceNotificationState?) {
      val prefs = ctx.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
      if (state == null) {
        val activeUser = prefs.getString(KEY_ACTIVE_USER_ID, null)?.takeIf { it.isNotBlank() }
        val editor = prefs.edit()
          .putBoolean(KEY_RACE_ACTIVE, false)
          .remove(KEY_STATE_JSON)
        if (activeUser != null) {
          editor.remove(stateKey(activeUser)).remove(KEY_ACTIVE_USER_ID)
        }
        editor.apply()
        return
      }
      prefs.edit()
        .putBoolean(KEY_RACE_ACTIVE, true)
        .putString(KEY_ACTIVE_USER_ID, state.userId)
        .putString(stateKey(state.userId), state.toJson().toString())
        .remove(KEY_STATE_JSON)
        .apply()
    }

    fun clearForUser(ctx: Context, userId: String) {
      if (userId.isBlank()) return
      val prefs = ctx.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
      val editor = prefs.edit().remove(stateKey(userId))
      if (prefs.getString(KEY_ACTIVE_USER_ID, null) == userId) {
        editor
          .putBoolean(KEY_RACE_ACTIVE, false)
          .remove(KEY_ACTIVE_USER_ID)
          .remove(KEY_STATE_JSON)
      }
      editor.apply()
    }
  }
}
