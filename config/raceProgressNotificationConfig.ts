/**
 * Live race progress notification / Live Activity throttle intervals.
 * Separate from step sync — notifications update less often than local UI.
 */
export const RACE_PROGRESS_NOTIFICATION_CONFIG = {
  /** Min gap between Android ongoing notification / iOS Live Activity local updates */
  LOCAL_UPDATE_MS: 8_000,

  /** Min step or rank change before forcing a local notification update */
  MIN_STEP_DELTA_FOR_UPDATE: 5,

  /** Register iOS Live Activity push token with backend after start */
  REGISTER_TOKEN_DELAY_MS: 1_500,
} as const;

export function formatTimeLeft(seconds: number): string {
  if (seconds <= 0) return "Open";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}
