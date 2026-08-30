/**
 * Step sync intervals — single source of truth for local polling vs backend batching.
 *
 * TYPE_STEP_COUNTER → live/provisional UI + race progress
 * Health Connect / HealthKit → verified daily + settlement (event-driven, not 1s polling)
 *
 * Battery: keep UI responsive while foreground; batch backend; slow JS when native FGS owns BG.
 */
export const STEP_SYNC_CONFIG = {
  /** Walk screen — push step delta to /api/walk/steps (batched). */
  WALK_BACKEND_SYNC_MS: 10_000,

  /**
   * Walk — provider reconciliation poll while app is active.
   * Actual HC rereads are gated by WALK_HEALTH_* — this is the outer JS timer only.
   */
  WALK_LOCAL_RECONCILE_POLL_MS: 5_000,

  /** Outer JS reconcile while Android native FGS owns background tracking. */
  WALK_LOCAL_RECONCILE_BACKGROUND_MS: 60_000,

  /** Outer JS reconcile when idle (no FGS / no live race). */
  WALK_LOCAL_RECONCILE_IDLE_MS: 120_000,

  /**
   * Health Connect / HealthKit daily re-read. Native HC writes are batched —
   * never poll HC every second.
   */
  WALK_HEALTH_VERIFICATION_MS: 30_000,

  /**
   * While today's HC/HK aggregate is still 0 (reinstall, cold start, writer lag),
   * reread faster so the full midnight→now total lands instead of leftover sensor.
   */
  WALK_HEALTH_EMPTY_RETRY_MS: 2_500,

  /** How long after bind/resume to keep the fast empty-HC retry. */
  WALK_HEALTH_EMPTY_RETRY_WINDOW_MS: 90_000,

  /**
   * Cap fast empty/no-data HC retries so 2.5s cannot run for the full window.
   * After this many empty fast attempts, fall back to WALK_HEALTH_VERIFICATION_MS
   * until an appropriate reset (resume / race start / new catch-up window).
   */
  WALK_HEALTH_EMPTY_RETRY_MAX_ATTEMPTS: 5,

  /** Race — read device steps locally for UI (sensor / HealthKit / Health Connect) */
  RACE_LOCAL_POLL_MS: 1_500,

  /** Race — minimum time between /api/races/:id/progress calls (foreground). */
  RACE_BACKEND_SYNC_MS: 12_000,

  /** Race — slower sync while screen off / app backgrounded (native may also sync). */
  RACE_BACKEND_SYNC_BACKGROUND_MS: 20_000,

  /** Race — sync when this many new steps accumulated AND interval elapsed */
  RACE_BACKEND_SYNC_MIN_DELTA: 3,

  /** Race — sync immediately on a large catch-up burst */
  RACE_BACKEND_SYNC_FORCE_DELTA: 60,

  /** Local UI refresh during live race (provider watch / poll) while visible */
  RACE_UI_UPDATE_MS: 1_500,

  /** Live race screen — min gap between background GET /api/races/:id refreshes */
  LIVE_RACE_DETAIL_REFRESH_MS: 20_000,

  /** Participant list fallback poll when Pusher is delayed */
  LIVE_RACE_PARTICIPANTS_POLL_MS: 5_000,

  /** Walk tab — challenge card refresh while focused (Pusher handles room events) */
  WALK_CHALLENGE_POLL_MS: 20_000,

  /** Debounce parallel AppState foreground handlers */
  APP_FOREGROUND_DEBOUNCE_MS: 400,

  /** Min gap between soft-forced race detail GETs */
  LIVE_RACE_FORCE_FETCH_MIN_GAP_MS: 3_000,

  /** Live race — completion safety-net poll (after 60s elapsed) */
  LIVE_RACE_COMPLETION_POLL_MS: 8_000,

  /** Matchmaking lobby — room status poll while waiting for start */
  MATCHMAKING_ROOM_POLL_MS: 8_000,

  /** Live race — spectator watch-count heartbeat (POST /spectate) */
  LIVE_RACE_SPECTATE_HEARTBEAT_MS: 60_000,

  /** Walk — min new steps before POST /api/walk/steps (Health Connect / HealthKit) */
  WALK_BACKEND_SYNC_MIN_DELTA_VERIFIED: 5,

  /** Legacy sensor — smaller batches OK */
  WALK_BACKEND_SYNC_MIN_DELTA_LEGACY: 3,

  /** Ignore single-step HC spikes without a confirming read (phantom on app open) */
  WALK_PHANTOM_STEP_BUMP: 1,

  /** Ignore a single tick jump larger than this (vehicle/shake/duplicate event guard) */
  WALK_MAX_STEP_SPIKE: 500,

  /** Legacy sensor — max steps ahead of backend without a gradual confirming tick */
  LEGACY_MAX_UNCONFIRMED_AHEAD: 12,

  /** Legacy sensor — max single poll jump while walking (faster walks still OK) */
  LEGACY_MAX_TICK_JUMP: 8,

  /**
   * Active-race Health Connect / HealthKit verification interval.
   * Live UI stays on the device sensor; this only refreshes verified totals.
   */
  RACE_HEALTH_VERIFICATION_MS: 180_000,

  /** Set true in __DEV__ to log every poll/notification tick (very noisy). */
  STEP_DEBUG_VERBOSE: false,

  /**
   * Phase 1 false-step investigation — [StepAudit] logs.
   * Defaults on in __DEV__; set false to silence without removing call sites.
   * Production release builds should keep this false (or rely on __DEV__ gate).
   */
  STEP_AUDIT_ENABLED: typeof __DEV__ !== "undefined" && __DEV__,
} as const;

/** Live race backend sync buffer — used by raceStepSyncBuffer.ts */
export const LIVE_RACE_SYNC_CONFIG = {
  uiUpdateMs: STEP_SYNC_CONFIG.RACE_UI_UPDATE_MS,
  backendSyncMs: STEP_SYNC_CONFIG.RACE_BACKEND_SYNC_MS,
  minStepDeltaToSync: STEP_SYNC_CONFIG.RACE_BACKEND_SYNC_MIN_DELTA,
  maxPendingAgeMs: STEP_SYNC_CONFIG.RACE_BACKEND_SYNC_MS,
  flushOnGoalComplete: true,
  flushOnAppBackground: true,
  flushOnForfeit: true,
  flushOnRaceEnd: true,
} as const;
