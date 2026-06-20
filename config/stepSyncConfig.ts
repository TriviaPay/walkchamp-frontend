/**
 * Step sync intervals — single source of truth for local polling vs backend batching.
 *
 * Walk tab: low-frequency backend sync (30 s).
 * Live race: frequent local reads for smooth UI, batched backend sync (7 s default).
 */
export const STEP_SYNC_CONFIG = {
  /** Walk screen — push step delta to /api/me/steps */
  WALK_BACKEND_SYNC_MS: 30_000,

  /** Race — read device steps locally for UI (no network) */
  RACE_LOCAL_POLL_MS: 1_000,

  /** Race — minimum time between /api/races/:id/progress calls */
  RACE_BACKEND_SYNC_MS: 7_000,

  /** Race — sync when this many new steps accumulated AND interval elapsed */
  RACE_BACKEND_SYNC_MIN_DELTA: 1,

  /** Race — sync immediately on a large catch-up burst */
  RACE_BACKEND_SYNC_FORCE_DELTA: 60,

  /** Local UI refresh during live race (provider watch / poll) */
  RACE_UI_UPDATE_MS: 1_000,

  /** Live race screen — min gap between background GET /api/races/:id refreshes */
  LIVE_RACE_DETAIL_REFRESH_MS: 20_000,

  /** Live race — completion safety-net poll (after 60s elapsed) */
  LIVE_RACE_COMPLETION_POLL_MS: 8_000,

  /** Matchmaking lobby — room status poll while waiting for start */
  MATCHMAKING_ROOM_POLL_MS: 8_000,

  /** Spectator heartbeat POST /spectate */
  LIVE_RACE_SPECTATE_HEARTBEAT_MS: 60_000,
} as const;

/** Live race backend sync buffer — used by raceStepSyncBuffer.ts */
export const LIVE_RACE_SYNC_CONFIG = {
  uiUpdateMs: STEP_SYNC_CONFIG.RACE_UI_UPDATE_MS,
  backendSyncMs: STEP_SYNC_CONFIG.RACE_BACKEND_SYNC_MS,
  minStepDeltaToSync: STEP_SYNC_CONFIG.RACE_BACKEND_SYNC_MIN_DELTA,
  maxPendingAgeMs: 15_000,
  flushOnGoalComplete: true,
  flushOnAppBackground: true,
  flushOnForfeit: true,
  flushOnRaceEnd: true,
} as const;
