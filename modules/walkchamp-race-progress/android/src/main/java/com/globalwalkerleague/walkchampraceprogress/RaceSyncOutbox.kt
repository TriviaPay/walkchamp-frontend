package com.globalwalkerleague.walkchampraceprogress

import android.content.Context
import org.json.JSONObject

/**
 * Latest-value outbox for failed Live Race progress syncs.
 * Always replaced — never replays every missed step event.
 */
data class RaceSyncOutboxItem(
  val userId: String,
  val raceId: String,
  val raceSteps: Int,
  val todaySteps: Int,
  val stepSource: String,
  val clientTimestamp: Long,
  val retryCount: Int = 0,
  val nextRetryAt: Long = 0L,
) {
  fun toJson(): JSONObject = JSONObject().apply {
    put("userId", userId)
    put("raceId", raceId)
    put("raceSteps", raceSteps)
    put("todaySteps", todaySteps)
    put("stepSource", stepSource)
    put("clientTimestamp", clientTimestamp)
    put("retryCount", retryCount)
    put("nextRetryAt", nextRetryAt)
  }

  companion object {
    private const val PREFS = "walkchamp_race_sync_outbox"

    private fun key(userId: String, raceId: String) = "raceSyncOutbox:$userId:$raceId"

    fun save(ctx: Context, item: RaceSyncOutboxItem) {
      if (item.userId.isBlank() || item.raceId.isBlank()) return
      ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
        .putString(key(item.userId, item.raceId), item.toJson().toString())
        .apply()
    }

    fun load(ctx: Context, userId: String, raceId: String): RaceSyncOutboxItem? {
      if (userId.isBlank() || raceId.isBlank()) return null
      val raw = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        .getString(key(userId, raceId), null) ?: return null
      return try {
        val json = JSONObject(raw)
        RaceSyncOutboxItem(
          userId = json.optString("userId"),
          raceId = json.optString("raceId"),
          raceSteps = json.optInt("raceSteps", 0),
          todaySteps = json.optInt("todaySteps", 0),
          stepSource = json.optString("stepSource", "android_step_counter"),
          clientTimestamp = json.optLong("clientTimestamp", System.currentTimeMillis()),
          retryCount = json.optInt("retryCount", 0),
          nextRetryAt = json.optLong("nextRetryAt", 0L),
        )
      } catch (_: Exception) {
        null
      }
    }

    fun clear(ctx: Context, userId: String, raceId: String) {
      if (userId.isBlank() || raceId.isBlank()) return
      ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
        .remove(key(userId, raceId))
        .apply()
    }

    fun clearForUser(ctx: Context, userId: String) {
      if (userId.isBlank()) return
      val prefs = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      val prefix = "raceSyncOutbox:$userId:"
      val editor = prefs.edit()
      prefs.all.keys.filter { it.startsWith(prefix) }.forEach { editor.remove(it) }
      editor.apply()
    }
  }
}
