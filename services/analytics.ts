/**
 * Lightweight analytics abstraction.
 * Failures never throw / never block UI. No sensitive payloads.
 */

type AnalyticsProps = Record<string, string | number | boolean | null | undefined>;

export type AnalyticsEvent =
  | "signup_started"
  | "signup_completed"
  | "health_permission_requested"
  | "health_permission_granted"
  | "health_permission_denied"
  | "first_walk_started"
  | "first_walk_completed"
  | "first_race_viewed"
  | "first_race_join_attempted"
  | "first_race_joined"
  | "first_race_completed"
  | "unlimited_challenge_selected"
  | "unlimited_challenge_create_started"
  | "unlimited_challenge_created"
  | "unlimited_challenge_create_failed"
  | "unlimited_challenge_join_started"
  | "unlimited_challenge_joined"
  | "unlimited_challenge_join_failed"
  | "unlimited_waiting_room_viewed"
  | "unlimited_challenge_left"
  | "unlimited_live_race_viewed"
  | "unlimited_daily_goal_completed_viewed"
  | "unlimited_disqualification_viewed"
  | "unlimited_results_viewed"
  | "create_challenge_step_1_viewed"
  | "create_challenge_step_2_viewed"
  | "create_challenge_step_3_viewed"
  | "create_challenge_step_4_viewed"
  | "create_challenge_step_5_viewed"
  | "cash_challenge_unlimited_selected"
  | "cash_challenge_fixed_selected"
  | "challenge_entry_amount_changed"
  | "challenge_daily_goal_changed"
  | "challenge_duration_changed"
  | "challenge_review_opened"
  | "challenge_review_blocked"
  | "walk_trending_preview_impression"
  | "walk_trending_preview_card_impression"
  | "walk_trending_preview_auto_advanced"
  | "walk_trending_preview_swiped"
  | "walk_trending_preview_card_opened"
  | "walk_trending_preview_view_all_pressed"
  | "walk_trending_preview_empty"
  | "walk_trending_preview_error";

type AnalyticsSink = (event: AnalyticsEvent, props?: AnalyticsProps) => void;

const sinks: AnalyticsSink[] = [];

export function registerAnalyticsSink(sink: AnalyticsSink): () => void {
  sinks.push(sink);
  return () => {
    const idx = sinks.indexOf(sink);
    if (idx >= 0) sinks.splice(idx, 1);
  };
}

export function trackEvent(event: AnalyticsEvent, props?: AnalyticsProps): void {
  try {
    if (__DEV__) {
      console.log("[Analytics]", event, props ?? {});
    }
    for (const sink of sinks) {
      try {
        sink(event, props);
      } catch {
        /* sink failures isolated */
      }
    }
  } catch {
    /* never throw */
  }
}
