package com.globalwalkerleague.walkchampraceprogress

import android.content.Context

/**
 * Persists API credentials for native Live Race background sync.
 * Separate from notification state so auth survives state merges and service restarts.
 */
object RaceSyncCredentials {
  private const val PREFS = "walkchamp_race_sync_creds"

  private fun apiKey(userId: String) = "race_api_base:$userId"
  private fun tokenKey(userId: String) = "race_auth_token:$userId"

  fun persist(ctx: Context, userId: String, apiBaseUrl: String, authToken: String) {
    if (userId.isBlank()) return
    val editor = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
    if (apiBaseUrl.isNotBlank()) editor.putString(apiKey(userId), apiBaseUrl.trim())
    if (authToken.isNotBlank()) editor.putString(tokenKey(userId), authToken.trim())
    editor.apply()
  }

  fun clearForUser(ctx: Context, userId: String) {
    if (userId.isBlank()) return
    ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
      .remove(apiKey(userId))
      .remove(tokenKey(userId))
      .apply()
  }

  /**
   * Resolve API base + bearer token for background race sync.
   * Priority: race state → dedicated race creds → walk FGS prefs.
   */
  fun resolve(
    ctx: Context,
    state: RaceNotificationState,
    walkPrefs: android.content.SharedPreferences,
  ): Pair<String, String>? {
    val userId = state.userId.ifBlank {
      walkPrefs.getString("walk_user_id", null)?.trim().orEmpty()
    }
    val credPrefs = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    val api = sequenceOf(
      state.apiBaseUrl.trim(),
      if (userId.isNotBlank()) credPrefs.getString(apiKey(userId), null)?.trim().orEmpty() else "",
      walkPrefs.getString("walk_api_base_url", null)?.trim().orEmpty(),
    ).firstOrNull { it.isNotBlank() } ?: ""

    val token = sequenceOf(
      state.authToken.trim(),
      if (userId.isNotBlank()) credPrefs.getString(tokenKey(userId), null)?.trim().orEmpty() else "",
      walkPrefs.getString("walk_auth_token", null)?.trim().orEmpty(),
    ).firstOrNull { it.isNotBlank() } ?: ""

    if (api.isBlank() || token.isBlank()) return null
    return api to token
  }
}
