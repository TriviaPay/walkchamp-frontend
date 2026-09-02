/**
 * Throttle intervals for persistent walk-step notifications / Live Activity.
 *
 * Avoid notify() after every individual step — batch for battery.
 */
export const STEP_TRACKING_NOTIFICATION_CONFIG = {
  /** Min gap between notification.notify() calls (ms). */
  LOCAL_UPDATE_MS: 10_000,

  /** Min step delta before the notification is considered worth updating. */
  MIN_STEP_DELTA_FOR_UPDATE: 5,

  /** Debounce rapid step bursts before pushing to native (ms). */
  DEBOUNCE_MS: 800,
} as const;
