/**
 * Coordinates walk-tab backend sync with live-race sync.
 *
 * Both streams may run together:
 *   POST /api/walk/steps — verified daily walk (and Unlimited streak)
 *   POST /api/races/:id/progress — classic live-race session delta
 *
 * Keep this pause flag false unless a caller explicitly needs a logout/switch flush.
 */

let walkBackendSyncPaused = false;

/** Optional pause for POST /api/walk/steps (logout / account switch). Live races do not pause this. */
export function setWalkBackendSyncPaused(paused: boolean): void {
  walkBackendSyncPaused = paused;
  if (__DEV__) {
    console.log(`[WalkSyncCoordinator] walk backend sync ${paused ? "paused" : "resumed"}`);
  }
}

export function isWalkBackendSyncPaused(): boolean {
  return walkBackendSyncPaused;
}
