/**
 * Step sync intervals — single source of truth for local polling vs backend batching.
 *
 * Walk + live race: backend progress every 3 s; local UI from sensor/HealthKit/HC immediately.
 */
export const STEP_SYNC_CONFIG = {
  /** Walk screen — push step delta to /api/walk/steps */
  WALK_BACKEND_SYNC_MS: 3_000,

  /** Race — read device steps locally for UI (sensor / HealthKit / Health Connect) */
  RACE_LOCAL_POLL_MS: 1_000,

  /** Race — minimum time between /api/races/:id/progress calls */
  RACE_BACKEND_SYNC_MS: 3_000,

  /** Race — sync when this many new steps accumulated AND interval elapsed */
  RACE_BACKEND_SYNC_MIN_DELTA: 1,

  /** Race — sync immediately on a large catch-up burst */
  RACE_BACKEND_SYNC_FORCE_DELTA: 60,

  /** Local UI refresh during live race (provider watch / poll) */
  RACE_UI_UPDATE_MS: 1_000,

  /** Live race screen — min gap between background GET /api/races/:id refreshes */
  LIVE_RACE_DETAIL_REFRESH_MS: 20_000,

  /** Participant list fallback poll when Pusher is delayed */
  LIVE_RACE_PARTICIPANTS_POLL_MS: 3_000,

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
} as const;

/** Live race backend sync buffer — used by raceStepSyncBuffer.ts */
export const LIVE_RACE_SYNC_CONFIG = {
  uiUpdateMs: STEP_SYNC_CONFIG.RACE_UI_UPDATE_MS,
  backendSyncMs: STEP_SYNC_CONFIG.RACE_BACKEND_SYNC_MS,
  minStepDeltaToSync: STEP_SYNC_CONFIG.RACE_BACKEND_SYNC_MIN_DELTA,
  maxPendingAgeMs: 3_000,
  flushOnGoalComplete: true,
  flushOnAppBackground: true,
  flushOnForfeit: true,
  flushOnRaceEnd: true,
} as const;
