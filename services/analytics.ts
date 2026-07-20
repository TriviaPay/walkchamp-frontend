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
  | "first_race_completed";

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
