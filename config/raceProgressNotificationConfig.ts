/**
 * Live race progress notification / Live Activity throttle intervals.
 * Separate from step sync — notifications update less often than local UI.
 *
 * Rationale:
 *   • Visible race UI can refresh ~1.5 s.
 *   • Backend sync is batched (~12 s).
 *   • Notification / Live Activity is the heavyweight path (IPC + OS rendering).
 */
export const RACE_PROGRESS_NOTIFICATION_CONFIG = {
  /** Min gap between Android ongoing notification / iOS Live Activity local updates (ms). */
  LOCAL_UPDATE_MS: 10_000,

  /** Min step delta before a notification update is considered worthwhile. */
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
