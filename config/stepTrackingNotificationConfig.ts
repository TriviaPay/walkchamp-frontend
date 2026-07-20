/**
 * Throttle intervals for persistent walk-step notifications / Live Activity.
 *
 * Walk notification should feel near real-time (1–3 s) while avoiding OS spam.
 * Debounce in coordinator is separate (300 ms); this config gates actual notify().
 */
export const STEP_TRACKING_NOTIFICATION_CONFIG = {
  /** Min gap between notification.notify() calls (ms). */
  LOCAL_UPDATE_MS: 2_000,

  /** Min step delta before the notification is considered worth updating. */
  MIN_STEP_DELTA_FOR_UPDATE: 1,

  /** Debounce rapid step bursts before pushing to native (ms). */
  DEBOUNCE_MS: 300,
} as const;
