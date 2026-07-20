/**
 * Coordinates walk-tab backend sync with live-race sync so both streams
 * never POST step progress to different endpoints at the same time.
 */

let walkBackendSyncPaused = false;

/** Pause POST /api/walk/steps while a live race is active (race progress owns sync). */
export function setWalkBackendSyncPaused(paused: boolean): void {
  walkBackendSyncPaused = paused;
  if (__DEV__) {
    console.log(`[WalkSyncCoordinator] walk backend sync ${paused ? "paused" : "resumed"}`);
  }
}

export function isWalkBackendSyncPaused(): boolean {
  return walkBackendSyncPaused;
}
