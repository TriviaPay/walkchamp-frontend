/**
 * Home-screen permission sequence (first login):
 *   1) Health Connect / Apple Health setup (WearableSetupModal)
 *   2) Push notifications prompt
 *
 * No parallel auto OS permission sheets. No duplicate prompts.
 * Daily HC step polls stay paused while the wearable wizard is in progress.
 *
 * The wizard must not open over splash / login — only after the main app shell
 * is ready (splash dismissed + user on authenticated home).
 */

type StepSetupOpener = () => void;
type StepSetupCloser = () => void;
type PushReadyListener = () => void;

let _openStepSetup: StepSetupOpener | null = null;
let _closeStepSetup: StepSetupCloser | null = null;
let _pendingOpenStepSetup = false;
let _stepPhaseDone = false;
/** True while WearableSetupModal is expected / visible — blocks daily HC polls. */
let _stepSetupInProgress = false;
/** Splash dismissed + main shell visible — never open HC over splash/login. */
let _shellReady = false;
let _pushReadyListeners: PushReadyListener[] = [];

function flushPendingOpen(): void {
  if (!_pendingOpenStepSetup || !_shellReady || !_openStepSetup) return;
  if (_stepPhaseDone) {
    _pendingOpenStepSetup = false;
    return;
  }
  _pendingOpenStepSetup = false;
  _openStepSetup();
}

export function registerHomeStepSetupOpener(opener: StepSetupOpener | null): void {
  _openStepSetup = opener;
  flushPendingOpen();
}

/** Optional closer so login can dismiss instantly when HC is already granted. */
export function registerHomeStepSetupCloser(closer: StepSetupCloser | null): void {
  _closeStepSetup = closer;
}

/**
 * Call when animated splash is gone and the user can see the main app.
 * Until then, requestHomeStepSetup only queues — never flashes over splash/login.
 */
export function setHomeStepSetupShellReady(ready: boolean): void {
  _shellReady = ready;
  if (ready) {
    flushPendingOpen();
  } else {
    // Splash/login again — cancel any queued auto-open and hide stray sheets.
    _pendingOpenStepSetup = false;
    _closeStepSetup?.();
  }
}

export function isHomeStepSetupShellReady(): boolean {
  return _shellReady;
}

/** Ask root host to open WearableSetupModal once (after shell is ready). */
export function requestHomeStepSetup(): void {
  setHomeStepSetupInProgress(true);
  // Requesting setup means the home HC phase is active again (e.g. HC update needed).
  _stepPhaseDone = false;
  if (!_shellReady || !_openStepSetup) {
    _pendingOpenStepSetup = true;
    return;
  }
  _openStepSetup();
}

/** Close the home HC sheet without waiting for user Done. */
export function dismissHomeStepSetup(): void {
  _pendingOpenStepSetup = false;
  setHomeStepSetupInProgress(false);
  _closeStepSetup?.();
}

export function setHomeStepSetupInProgress(inProgress: boolean): void {
  _stepSetupInProgress = inProgress;
}

/** True while home wearable setup should block daily Health Connect step polls. */
export function isHomeStepSetupInProgress(): boolean {
  return _stepSetupInProgress && !_stepPhaseDone;
}

/** Call when WearableSetup completes or user taps Maybe Later / Close. */
export function markHomeStepSetupPhaseDone(): void {
  _stepSetupInProgress = false;
  if (_stepPhaseDone) return;
  _stepPhaseDone = true;
  _pendingOpenStepSetup = false;
  const listeners = _pushReadyListeners.splice(0);
  for (const fn of listeners) {
    try {
      fn();
    } catch {
      /* ignore */
    }
  }
}

export function isHomeStepSetupPhaseDone(): boolean {
  return _stepPhaseDone;
}

/**
 * Push prompt waits until step setup phase finishes (or was already done
 * on a previous session via education flag — callers may mark done early).
 */
export function waitForHomeStepSetupPhase(): Promise<void> {
  if (_stepPhaseDone) return Promise.resolve();
  return new Promise((resolve) => {
    _pushReadyListeners.push(resolve);
  });
}

/** Reset on logout / account switch so the next login can show HC setup again. */
export function resetHomePermissionFlow(): void {
  _stepPhaseDone = false;
  _stepSetupInProgress = false;
  _pendingOpenStepSetup = false;
  _pushReadyListeners = [];
  // Keep _shellReady — splash state is independent of account.
}

/** @deprecated use resetHomePermissionFlow */
export function resetHomePermissionFlowForTests(): void {
  resetHomePermissionFlow();
  _openStepSetup = null;
  _closeStepSetup = null;
  _shellReady = false;
}
