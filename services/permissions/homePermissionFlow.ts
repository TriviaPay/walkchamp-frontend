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

import { resolveStepAccessAction } from "@/services/steps/healthConnectVerificationStateLogic";

type StepSetupOpener = () => void;
type StepSetupCloser = () => void;
type PushReadyListener = () => void;
type StepGrantHandler = () => void;

let _openStepSetup: StepSetupOpener | null = null;
let _closeStepSetup: StepSetupCloser | null = null;
let _pendingOpenStepSetup = false;
let _stepPhaseDone = false;
/** True while WearableSetupModal is expected / visible — blocks daily HC polls. */
let _stepSetupInProgress = false;
/** Splash dismissed + main shell visible — never open HC over splash/login. */
let _shellReady = false;
let _pushReadyListeners: PushReadyListener[] = [];
let _setupDoneListeners: PushReadyListener[] = [];
let _grantPermissionOnly: StepGrantHandler | null = null;

let _wizardCountsAsLater = false;

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

function openHomeStepSetupWizard(countsAsLater: boolean): void {
  _wizardCountsAsLater = countsAsLater;
  setHomeStepSetupInProgress(true);
  _stepPhaseDone = false;
  if (!_shellReady || !_openStepSetup) {
    _pendingOpenStepSetup = true;
    return;
  }
  _openStepSetup();
}

export function homeStepSetupCountsAsLater(): boolean {
  return _wizardCountsAsLater;
}

/** Ask root host to open WearableSetupModal once (after shell is ready). */
export function requestHomeStepSetup(): void {
  void (async () => {
    try {
      const { osStepAccessGranted } = await import(
        "@/services/permissions/permissionCoordinator"
      );
      if (await osStepAccessGranted()) {
        markHomeStepSetupPhaseDone();
        _grantPermissionOnly?.();
        return;
      }
    } catch {
      /* still open wizard if the OS check fails */
    }
    openHomeStepSetupWizard(true);
  })();
}

/** Walk / match gates: OS grant sheet only when that is all that is missing. */
export function registerHomeStepGrantHandler(fn: StepGrantHandler | null): void {
  _grantPermissionOnly = fn;
}

export type HomeStepAccessHint = {
  hcAvailability?: string | null;
  verificationStatus?: string | null;
  healthConnectAvailable?: boolean;
  readStepsPermissionGranted?: boolean;
};

/**
 * Grant Health Connect / HealthKit access in place when the health app is
 * already installed. Opens the full wizard only for install / update / writer.
 */
export function requestHomeStepAccess(hint?: HomeStepAccessHint): void {
  const run = (action: "grant_permission" | "full_setup") => {
    if (action === "grant_permission" && _grantPermissionOnly) {
      _grantPermissionOnly();
      return;
    }
    openHomeStepSetupWizard(false);
  };

  const hinted =
    hint &&
    (hint.verificationStatus ||
      hint.hcAvailability ||
      hint.healthConnectAvailable === true ||
      hint.readStepsPermissionGranted === false);

  if (hinted) {
    run(resolveStepAccessAction(hint));
    return;
  }

  void (async () => {
    try {
      const { getHealthConnectVerificationState } = await import(
        "@/services/steps/healthConnectVerificationState"
      );
      const vs = await getHealthConnectVerificationState();
      run(
        resolveStepAccessAction({
          verificationStatus: vs.status,
          healthConnectAvailable: vs.healthConnectAvailable,
          readStepsPermissionGranted: vs.readStepsPermissionGranted,
        }),
      );
    } catch {
      openHomeStepSetupWizard(false);
    }
  })();
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
  const setupListeners = _setupDoneListeners.slice();
  for (const fn of setupListeners) {
    try {
      fn();
    } catch {
      /* ignore */
    }
  }
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

/** Walk tab refreshes Health Connect status after the setup sheet closes. */
export function subscribeHomeStepSetupDone(fn: PushReadyListener): () => void {
  _setupDoneListeners.push(fn);
  return () => {
    _setupDoneListeners = _setupDoneListeners.filter((x) => x !== fn);
  };
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

/** Soft reset on logout — clear in-progress wizard only; do not force re-prompt. */
export function resetHomePermissionFlowSoft(): void {
  _stepSetupInProgress = false;
  _pendingOpenStepSetup = false;
  _pushReadyListeners = [];
  // Keep _stepPhaseDone and _shellReady so granted-device logins do not reopen HC.
}

/** Full reset (tests / hard restart). Prefer soft reset on account switch. */
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
  _grantPermissionOnly = null;
  _setupDoneListeners = [];
  _wizardCountsAsLater = false;
}
