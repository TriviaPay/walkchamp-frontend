package com.globalwalkerleague.walkchampraceprogress

import android.content.Context
import android.content.res.Configuration
import android.graphics.Color
import android.os.Build
import android.util.Log
import android.util.TypedValue
import android.view.View
import android.widget.RemoteViews
import androidx.core.app.NotificationCompat

/**
 * Custom RemoteViews for ongoing notifications. Display-only — never reads
 * Health Connect / sensors or recalculates steps.
 *
 * Android N+ (`DecoratedCustomViewStyle`) draws a system header with the default
 * app icon + "WalkChamp". On those devices we hide our in-layout brand mark so
 * the icon is not duplicated. Older / unsupported surfaces keep the brand icon
 * beside the status line (same as before).
 *
 * Text colors follow the **device** night mode (white on dark, black on light).
 * Progress bar fill is always WalkChamp green.
 */
object WalkChampNotificationViews {
  private const val TAG = "WalkChampNotifUI"
  /** Progress fill — same green in light and dark. */
  private val PROGRESS_GREEN = Color.parseColor("#22C55E")
  /** Percent / accent text on light notification chrome (readable dark green). */
  private val PROGRESS_GREEN_LIGHT_TEXT = Color.parseColor("#15803D")

  /**
   * True when the system notification chrome already shows the app / launcher
   * icon (DecoratedCustomViewStyle header). Callers should skip an extra brand
   * large-icon in that case.
   */
  fun deviceShowsDefaultNotificationAppIcon(): Boolean {
    return Build.VERSION.SDK_INT >= Build.VERSION_CODES.N
  }

  fun applyWalkCustomViews(
    ctx: Context,
    builder: NotificationCompat.Builder,
    steps: Int,
    goal: Int,
    brandTitle: String = "WalkChamp",
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
      // Full progress in the tray view; same RemoteViews for content + big → no expand.
      val full = RemoteViews(ctx.packageName, R.layout.notification_daily_walk).also {
        bindBrandIconOnly(it, typeIcon)
        it.setTextViewText(R.id.notification_subtitle, statusLine)
        it.setTextViewText(R.id.notification_steps_line, stepsLine)
        it.setTextViewText(R.id.notification_percent, "$pct%")
        it.setProgressBar(R.id.notification_progress, 100, pct, false)
        applyTextTheme(
          ctx,
          it,
          primaryIds = intArrayOf(R.id.notification_steps_line),
          secondaryIds = intArrayOf(R.id.notification_subtitle),
          accentIds = intArrayOf(R.id.notification_percent),
        )
      }
      // Keep legacy remaining text available via contentText for accessibility / OEM fallbacks.
      builder.setContentText(remainingLine)
      finishNonExpandableCustomBuilder(builder, full)
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
    brandTitle: String = "WalkChamp",
  ): Boolean {
    // Always notification_live.png for every ongoing race type (sponsored / free / cash / etc.).
    val typeIcon = R.drawable.notification_live
    val steps = state.raceSteps.coerceAtLeast(0)
    val goal = state.goalSteps.coerceAtLeast(0)
    val pct = NotificationVisuals.clampPercent(steps, if (goal > 0) goal else 1)
    val stepsLine = if (goal > 0) {
      "${NotificationVisuals.formatSteps(steps)} / ${NotificationVisuals.formatSteps(goal)} steps"
    } else {
      "${NotificationVisuals.formatSteps(steps)} steps"
    }
    val rankLine = "Rank #${state.rank.coerceAtLeast(1)} of ${state.totalParticipants.coerceAtLeast(1)}"
    val participantsLine =
      "${state.totalParticipants.coerceAtLeast(1)} Participants"
    val typeLabel = NotificationVisuals.raceTypeLabel(
      isSponsored = state.isSponsored,
      raceTypeHint = state.raceTypeHint,
      unlimitedDailyMode = state.unlimitedDailyMode,
    )

    return try {
      fun bindFullRaceLayout(views: RemoteViews) {
        bindBrandIconOnly(views, typeIcon)
        // Never show status / lead / race-type label on the left.
        views.setViewVisibility(R.id.notification_subtitle, View.GONE)
        views.setViewVisibility(R.id.notification_headline, View.GONE)
        views.setTextViewText(R.id.notification_steps_line, stepsLine)
        views.setTextViewText(R.id.notification_percent, if (goal > 0) "$pct%" else "")
        views.setProgressBar(R.id.notification_progress, 100, if (goal > 0) pct else 0, false)
        views.setTextViewText(R.id.notification_rank_line, rankLine)
        views.setTextViewText(R.id.notification_participants_line, participantsLine)
        // Label sits under the PNG on the right — shrink text instead of expanding layout.
        views.setTextViewText(R.id.notification_type_label, typeLabel)
        views.setTextViewTextSize(
          R.id.notification_type_label,
          TypedValue.COMPLEX_UNIT_SP,
          NotificationVisuals.raceTypeLabelTextSizeSp(typeLabel),
        )
        views.setImageViewResource(R.id.notification_type_icon, typeIcon)
        applyTextTheme(
          ctx,
          views,
          primaryIds = intArrayOf(R.id.notification_steps_line),
          secondaryIds = intArrayOf(
            R.id.notification_rank_line,
            R.id.notification_participants_line,
            R.id.notification_type_label,
          ),
          accentIds = intArrayOf(R.id.notification_percent),
        )
      }

      // One full layout in the collapsed tray — no big-content view → nothing to expand.
      val full = RemoteViews(ctx.packageName, R.layout.notification_live_race).also(::bindFullRaceLayout)
      // Clear system title/text so the type label is only under the PNG, not on the left.
      builder.setContentTitle("")
      builder.setContentText("")
      finishNonExpandableCustomBuilder(builder, full)
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
   * Left: WalkChamp brand only when the system will not show the default app
   * icon. Right: type illustration (always). Brand title stays hidden — the
   * DecoratedCustomViewStyle header already shows "WalkChamp".
   */
  private fun bindBrandIconOnly(views: RemoteViews, typeIcon: Int) {
    if (deviceShowsDefaultNotificationAppIcon()) {
      // System header already has the app icon — avoid a second brand mark.
      views.setViewVisibility(R.id.notification_app_icon, View.GONE)
    } else {
      views.setViewVisibility(R.id.notification_app_icon, View.VISIBLE)
      views.setImageViewResource(R.id.notification_app_icon, R.drawable.notification_walkchamp_brand)
    }
    views.setImageViewResource(R.id.notification_type_icon, typeIcon)
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

  /**
   * Full tray layout with no expand affordance.
   * Use the **same** RemoteViews for content + big + heads-up — setting big to
   * null with DecoratedCustomViewStyle still shows the expand/collapse chevron
   * on many OEMs.
   */
  private fun finishNonExpandableCustomBuilder(
    builder: NotificationCompat.Builder,
    content: RemoteViews,
  ) {
    builder
      .setStyle(NotificationCompat.DecoratedCustomViewStyle())
      .setCustomContentView(content)
      .setCustomBigContentView(content)
      .setCustomHeadsUpContentView(content)
  }

  /** Device dark mode → white text; light mode → black text. Percent uses readable green. */
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
    // Dark mode keeps bright green; light mode uses darker green for contrast on gray cards.
    val accent = if (night) PROGRESS_GREEN else PROGRESS_GREEN_LIGHT_TEXT
    for (id in primaryIds) views.setTextColor(id, primary)
    for (id in secondaryIds) views.setTextColor(id, secondary)
    for (id in accentIds) views.setTextColor(id, accent)
  }

  private fun isDeviceNightMode(ctx: Context): Boolean {
    val mask = ctx.resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK
    return mask == Configuration.UI_MODE_NIGHT_YES
  }
}
