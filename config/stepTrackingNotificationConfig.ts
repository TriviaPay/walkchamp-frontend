/**
 * Throttle intervals for persistent walk-step notifications / Live Activity.
 *
 * Professional health-app recommendation:
 *   • Notification / Live Activity updates are expensive — hardware wake, IPC to
 *     native, channel binding, OS rendering pipeline.
 *   • 500 ms / 1-step was far too aggressive and contributed to battery drain.
 *   • 5 000 ms / 5-step is a good trade-off: visibly responsive without hammering
 *     the OS notification pipeline.
 */
export const STEP_TRACKING_NOTIFICATION_CONFIG = {
  /** Min gap between debounced notification / Live Activity updates (ms). */
  LOCAL_UPDATE_MS: 5_000,

  /** Min step delta before the notification is considered worth updating. */
  MIN_STEP_DELTA_FOR_UPDATE: 5,
} as const;
