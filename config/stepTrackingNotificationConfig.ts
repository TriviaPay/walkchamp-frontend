/**
 * Throttle intervals for persistent walk-step notifications / Live Activity.
 */
export const STEP_TRACKING_NOTIFICATION_CONFIG = {
  /** Min gap between notification / Live Activity updates */
  LOCAL_UPDATE_MS: 15_000,

  /** Min step delta before forcing an update */
  MIN_STEP_DELTA_FOR_UPDATE: 25,
} as const;
