package com.globalwalkerleague.walkchampraceprogress

import android.content.Context
import android.content.res.Configuration
import android.graphics.Color
import android.util.Log
import android.view.View
import android.widget.RemoteViews
import androidx.core.app.NotificationCompat

/**
 * Custom RemoteViews for ongoing notifications. Display-only — never reads
 * Health Connect / sensors or recalculates steps.
 *
 * Android 12+ always draws a system header with the app name ("Walk Champ").
 * We therefore hide our in-layout brand title so "Walk Champ" is not repeated;
 * the colorful brand icon stays beside the status line (Daily Walk / Live Race).
 *
 * Text colors follow the **device** night mode (white on dark, black on light).
 * Progress bar fill is always Walk Champ green.
 */
object WalkChampNotificationViews {
  private const val TAG = "WalkChampNotifUI"
  /** Progress fill + percent accent — same green in light and dark. */
  private val PROGRESS_GREEN = Color.parseColor("#22C55E")

  fun applyWalkCustomViews(
    ctx: Context,
    builder: NotificationCompat.Builder,
    steps: Int,
    goal: Int,
    brandTitle: String = "Walk Champ",
  ): Boolean {
    val safeSteps = steps.coerceAtLeast(0)
    val safeGoal = if (goal > 0) goal else 10_000
    val pct = NotificationVisuals.clampPercent(safeSteps, safeGoal)
    val remaining = NotificationVisuals.remainingSteps(safeSteps, safeGoal)
    val stepsLine =
      "${NotificationVisuals.formatSteps(safeSteps)} / ${NotificationVisuals.formatSteps(safeGoal)} steps"
    val remainingLine = "${NotificationVisuals.formatSteps(remaining)} steps remaining"
    val visual = if (pct >= 100) {
      NotificationVisualType.GOAL_COMPLETED
    } else {
      NotificationVisualType.DAILY_WALK
    }
    val typeIcon = NotificationVisuals.resolveDrawable(visual)
    val statusLine = if (pct >= 100) "Goal Complete" else "Daily Walk"

    return try {
      val collapsed = RemoteViews(ctx.packageName, R.layout.notification_daily_walk).also {
        bindBrandIconOnly(it, typeIcon)
        it.setTextViewText(R.id.notification_subtitle, statusLine)
        it.setTextViewText(R.id.notification_steps_line, stepsLine)
        applyTextTheme(
          ctx,
          it,
          primaryIds = intArrayOf(R.id.notification_subtitle, R.id.notification_steps_line),
        )
      }
      val expanded = RemoteViews(ctx.packageName, R.layout.notification_daily_walk_expanded).also {
        bindBrandIconOnly(it, typeIcon)
        it.setTextViewText(R.id.notification_subtitle, statusLine)
        it.setTextViewText(R.id.notification_steps_line, stepsLine)
        it.setTextViewText(R.id.notification_percent, "$pct%")
        it.setTextViewText(R.id.notification_remaining, remainingLine)
        it.setProgressBar(R.id.notification_progress, 100, pct, false)
        applyTextTheme(
          ctx,
          it,
          primaryIds = intArrayOf(R.id.notification_subtitle, R.id.notification_steps_line),
          secondaryIds = intArrayOf(R.id.notification_remaining),
          accentIds = intArrayOf(R.id.notification_percent),
        )
      }
      finishCustomBuilder(builder, collapsed, expanded)
      true
    } catch (e: Exception) {
      Log.w(TAG, "Custom walk notification rendering failed: ${e.message}")
      false
    }
  }

  fun applyRaceCustomViews(
    ctx: Context,
    builder: NotificationCompat.Builder,
    state: RaceNotificationState,
    brandTitle: String = "Walk Champ",
  ): Boolean {
    val visual = NotificationVisuals.forOngoingRace(state.isSponsored)
    val typeLabel = NotificationVisuals.raceTypeLabel(state.isSponsored)
    val typeIcon = NotificationVisuals.resolveDrawable(visual)
    val steps = state.raceSteps.coerceAtLeast(0)
    val goal = state.goalSteps.coerceAtLeast(0)
    val pct = NotificationVisuals.clampPercent(steps, if (goal > 0) goal else 1)
    val timeLeft = NotificationVisuals.formatTimeLeft(state.timeLeftSeconds)
    val statusLine = "$typeLabel • $timeLeft"
    val headline = when {
      state.rank == 1 -> "You're in the lead!"
      else -> "Keep going, every step counts."
    }
    val stepsLine = if (goal > 0) {
      "${NotificationVisuals.formatSteps(steps)} / ${NotificationVisuals.formatSteps(goal)} steps"
    } else {
      "${NotificationVisuals.formatSteps(steps)} steps"
    }
    val rankLine = "Rank #${state.rank.coerceAtLeast(1)} of ${state.totalParticipants.coerceAtLeast(1)}"
    val participantsLine =
      "${state.totalParticipants.coerceAtLeast(1)} Participants"

    return try {
      val collapsed = RemoteViews(ctx.packageName, R.layout.notification_live_race).also {
        bindBrandIconOnly(it, typeIcon)
        it.setTextViewText(R.id.notification_subtitle, statusLine)
        it.setTextViewText(R.id.notification_headline, headline)
        applyTextTheme(
          ctx,
          it,
          primaryIds = intArrayOf(R.id.notification_subtitle, R.id.notification_headline),
        )
      }
      val expanded = RemoteViews(ctx.packageName, R.layout.notification_live_race_expanded).also {
        bindBrandIconOnly(it, typeIcon)
        it.setTextViewText(R.id.notification_subtitle, statusLine)
        it.setTextViewText(R.id.notification_headline, headline)
        it.setTextViewText(R.id.notification_steps_line, stepsLine)
        it.setTextViewText(R.id.notification_percent, if (goal > 0) "$pct%" else "")
        it.setProgressBar(R.id.notification_progress, 100, if (goal > 0) pct else 0, false)
        it.setTextViewText(R.id.notification_rank_line, rankLine)
        it.setTextViewText(R.id.notification_participants_line, participantsLine)
        applyTextTheme(
          ctx,
          it,
          primaryIds = intArrayOf(R.id.notification_subtitle, R.id.notification_headline, R.id.notification_steps_line),
          secondaryIds = intArrayOf(
            R.id.notification_rank_line,
            R.id.notification_participants_line,
          ),
          accentIds = intArrayOf(R.id.notification_percent),
        )
      }
      finishCustomBuilder(builder, collapsed, expanded)
      true
    } catch (e: Exception) {
      Log.w(TAG, "Custom race notification rendering failed: ${e.message}")
      false
    }
  }

  fun applyGoalProgressCustomViews(
    ctx: Context,
    builder: NotificationCompat.Builder,
    steps: Int,
    goal: Int,
  ): Boolean {
    val safeSteps = steps.coerceAtLeast(0)
    val safeGoal = if (goal > 0) goal else 10_000
    val pct = NotificationVisuals.clampPercent(safeSteps, safeGoal)
    val remaining = NotificationVisuals.remainingSteps(safeSteps, safeGoal)
    val stepsLine =
      "${NotificationVisuals.formatSteps(safeSteps)} / ${NotificationVisuals.formatSteps(safeGoal)} steps"
    val typeIcon = NotificationVisuals.resolveDrawable(NotificationVisualType.GOAL_PROGRESS)
    return try {
      val collapsed = RemoteViews(ctx.packageName, R.layout.notification_goal_progress).also {
        bindBrandIconOnly(it, typeIcon)
        it.setTextViewText(R.id.notification_subtitle, "Goal Update")
        it.setTextViewText(R.id.notification_steps_line, stepsLine)
        applyTextTheme(
          ctx,
          it,
          primaryIds = intArrayOf(R.id.notification_subtitle, R.id.notification_steps_line),
        )
      }
      val expanded = RemoteViews(ctx.packageName, R.layout.notification_goal_progress_expanded).also {
        bindBrandIconOnly(it, typeIcon)
        it.setTextViewText(R.id.notification_subtitle, "Goal Update")
        it.setTextViewText(R.id.notification_steps_line, stepsLine)
        it.setTextViewText(R.id.notification_percent, "$pct%")
        it.setTextViewText(
          R.id.notification_remaining,
          "${NotificationVisuals.formatSteps(remaining)} steps remaining",
        )
        it.setProgressBar(R.id.notification_progress, 100, pct, false)
        applyTextTheme(
          ctx,
          it,
          primaryIds = intArrayOf(R.id.notification_subtitle, R.id.notification_steps_line),
          secondaryIds = intArrayOf(R.id.notification_remaining),
          accentIds = intArrayOf(R.id.notification_percent),
        )
      }
      finishCustomBuilder(builder, collapsed, expanded)
      true
    } catch (e: Exception) {
      Log.w(TAG, "Custom goal notification rendering failed: ${e.message}")
      false
    }
  }

  fun applyUpcomingRaceCustomViews(
    ctx: Context,
    builder: NotificationCompat.Builder,
    headline: String,
    body: String,
    participantsLine: String,
    timeLine: String,
  ): Boolean {
    val typeIcon = NotificationVisuals.resolveDrawable(NotificationVisualType.UPCOMING_RACE)
    return try {
      val collapsed = RemoteViews(ctx.packageName, R.layout.notification_upcoming_race).also {
        bindBrandIconOnly(it, typeIcon)
        it.setTextViewText(R.id.notification_headline, headline)
        it.setTextViewText(R.id.notification_body, body)
        applyTextTheme(
          ctx,
          it,
          primaryIds = intArrayOf(R.id.notification_headline),
          secondaryIds = intArrayOf(R.id.notification_body),
        )
      }
      val expanded = RemoteViews(ctx.packageName, R.layout.notification_upcoming_race_expanded).also {
        bindBrandIconOnly(it, typeIcon)
        it.setTextViewText(R.id.notification_headline, headline)
        it.setTextViewText(R.id.notification_body, body)
        it.setTextViewText(R.id.notification_participants_line, participantsLine)
        it.setTextViewText(R.id.notification_time_line, timeLine)
        applyTextTheme(
          ctx,
          it,
          primaryIds = intArrayOf(R.id.notification_headline),
          secondaryIds = intArrayOf(
            R.id.notification_body,
            R.id.notification_participants_line,
            R.id.notification_time_line,
          ),
        )
      }
      finishCustomBuilder(builder, collapsed, expanded)
      true
    } catch (e: Exception) {
      Log.w(TAG, "Custom upcoming race notification rendering failed: ${e.message}")
      false
    }
  }

  fun applyWinnerCustomViews(
    ctx: Context,
    builder: NotificationCompat.Builder,
    headline: String,
    body: String,
    stepsLine: String,
    rewardLine: String,
  ): Boolean {
    val typeIcon = NotificationVisuals.resolveDrawable(NotificationVisualType.WINNER)
    return try {
      val collapsed = RemoteViews(ctx.packageName, R.layout.notification_winner).also {
        bindBrandIconOnly(it, typeIcon)
        it.setTextViewText(R.id.notification_headline, headline)
        it.setTextViewText(R.id.notification_body, body)
        applyTextTheme(
          ctx,
          it,
          primaryIds = intArrayOf(R.id.notification_headline),
          secondaryIds = intArrayOf(R.id.notification_body),
        )
      }
      val expanded = RemoteViews(ctx.packageName, R.layout.notification_winner_expanded).also {
        bindBrandIconOnly(it, typeIcon)
        it.setTextViewText(R.id.notification_headline, headline)
        it.setTextViewText(R.id.notification_body, body)
        it.setTextViewText(R.id.notification_steps_line, stepsLine)
        it.setTextViewText(R.id.notification_reward_line, rewardLine)
        applyTextTheme(
          ctx,
          it,
          primaryIds = intArrayOf(R.id.notification_headline, R.id.notification_steps_line),
          secondaryIds = intArrayOf(R.id.notification_body),
          accentIds = intArrayOf(R.id.notification_reward_line),
        )
      }
      finishCustomBuilder(builder, collapsed, expanded)
      true
    } catch (e: Exception) {
      Log.w(TAG, "Custom winner notification rendering failed: ${e.message}")
      false
    }
  }

  /**
   * Left: Walk Champ brand. Right: type illustration.
   * Brand title stays visible in the custom layout; DecoratedCustomViewStyle
   * also shows the system app name on supported OEMs.
   */
  private fun bindBrandIconOnly(views: RemoteViews, typeIcon: Int) {
    views.setImageViewResource(R.id.notification_app_icon, R.drawable.notification_walkchamp_brand)
    views.setImageViewResource(R.id.notification_type_icon, typeIcon)
    // System header already shows "Walk Champ" — hide duplicate in-layout title.
    views.setViewVisibility(R.id.notification_brand_title, View.GONE)
  }

  private fun finishCustomBuilder(
    builder: NotificationCompat.Builder,
    collapsed: RemoteViews,
    expanded: RemoteViews,
  ) {
    builder
      .setStyle(NotificationCompat.DecoratedCustomViewStyle())
      .setCustomContentView(collapsed)
      .setCustomBigContentView(expanded)
  }

  /** Device dark mode → white text; light mode → black text. Percent/reward use green. */
  private fun applyTextTheme(
    ctx: Context,
    views: RemoteViews,
    primaryIds: IntArray,
    secondaryIds: IntArray = intArrayOf(),
    accentIds: IntArray = intArrayOf(),
  ) {
    val night = isDeviceNightMode(ctx)
    val primary = if (night) Color.WHITE else Color.BLACK
    val secondary =
      if (night) Color.argb(0xB3, 0xFF, 0xFF, 0xFF) else Color.argb(0x99, 0x00, 0x00, 0x00)
    for (id in primaryIds) views.setTextColor(id, primary)
    for (id in secondaryIds) views.setTextColor(id, secondary)
    for (id in accentIds) views.setTextColor(id, PROGRESS_GREEN)
  }

  private fun isDeviceNightMode(ctx: Context): Boolean {
    val mask = ctx.resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK
    return mask == Configuration.UI_MODE_NIGHT_YES
  }
}
