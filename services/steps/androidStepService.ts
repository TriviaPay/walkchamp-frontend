/**
 * androidStepService — Android real step tracking via the built-in step counter.
 *
 * Strategy:
 *   1. Detect Expo Go → bail early.  ACTIVITY_RECOGNITION is absent from Expo
 *      Go's AndroidManifest, so PermissionsAndroid.request() returns "denied"
 *      immediately (no dialog ever shown).
 *   2. Check / request ACTIVITY_RECOGNITION via PermissionsAndroid (native RN API).
 *   3. If granted, subscribe to Pedometer.watchStepCount() for live step deltas.
 *
 * Health Connect is intentionally skipped — sensor-only for simplicity and
 * because HC requires the Health Connect app to be installed separately.
 *
 * DEBUG logs: prefix [AndroidSteps]
 */

export type AndroidStepSource = "android_step_counter" | "unavailable";

export type AndroidPermStatus =
  | "granted"
  | "denied"
  | "unknown"
  | "unavailable";

export interface AndroidTodayData {
  steps: number;
  distanceMeters: number;
  calories: number;
  activeMinutes: number;
  source: AndroidStepSource;
}

// ── Lazy Pedometer loader ─────────────────────────────────────────────────────

type PedometerAPI = {
  watchStepCount: (
    cb: (r: { steps: number }) => void,
  ) => { remove: () => void };
};

let _ped: PedometerAPI | null | undefined = undefined;
function loadPedometer(): PedometerAPI | null {
  if (_ped !== undefined) return _ped;
  try {
    const m = require("expo-sensors") as { Pedometer?: PedometerAPI };
    _ped = m.Pedometer ?? null;
  } catch {
    _ped = null;
  }
  return _ped;
}

// ── Expo Go detection ─────────────────────────────────────────────────────────

/**
 * Returns true when the app is running inside Expo Go (the store client).
 *
 * In Expo Go, android.permission.ACTIVITY_RECOGNITION is NOT listed in the
 * host app's AndroidManifest.xml.  Android therefore rejects every
 * PermissionsAndroid.request() call instantly — no dialog is ever shown and
 * the result is always "never_ask_again" / "denied".
 *
 * Exported so WalkContext and the walk screen UI can both use it.
 */
export function isExpoGo(): boolean {
  try {
    const C = require("expo-constants") as {
      default?: { executionEnvironment?: string };
    };
    // "storeClient" = Expo Go; "standalone" / "bare" = real build
    // Use optional chaining so this never throws in standalone APK builds
    // where Constants shape may differ slightly between Expo SDK versions.
    return C?.default?.executionEnvironment === "storeClient";
  } catch {
    return false;
  }
}

// ── Permission helpers ────────────────────────────────────────────────────────

const ACTIVITY_PERM = "android.permission.ACTIVITY_RECOGNITION";

/**
 * Silent check — returns true if the permission is already granted.
 * On Android < 10 (API 29) the runtime permission doesn't exist → always true.
 */
async function checkPermission(): Promise<boolean> {
  try {
    const { PermissionsAndroid } =
      require("react-native") as typeof import("react-native");
    if (!PermissionsAndroid.PERMISSIONS.ACTIVITY_RECOGNITION) {
      // Pre-API 29: no ACTIVITY_RECOGNITION runtime permission needed
      return true;
    }
    return PermissionsAndroid.check(ACTIVITY_PERM);
  } catch {
    return false;
  }
}

/**
 * Show the system ACTIVITY_RECOGNITION dialog (or return "denied" immediately
 * if the user previously chose "Don't ask again").
 */
async function requestPermissionDialog(): Promise<"granted" | "denied"> {
  try {
    const { PermissionsAndroid } =
      require("react-native") as typeof import("react-native");
    if (!PermissionsAndroid.PERMISSIONS.ACTIVITY_RECOGNITION) {
      return "granted"; // Pre-API 29: no dialog needed
    }
    _permissionEverRequested = true;
    const result = await PermissionsAndroid.request(ACTIVITY_PERM, {
      title: "Step Tracking",
      message:
        "WalkChamp needs access to your physical activity data to count your steps and award prizes.",
      buttonPositive: "Allow",
      buttonNegative: "Deny",
    });
    if (__DEV__)
      if (__DEV__) console.log(`[AndroidSteps] PermissionsAndroid.request result: ${result}`);
    return result === PermissionsAndroid.RESULTS.GRANTED ? "granted" : "denied";
  } catch (e) {
    if (__DEV__) console.log(`[AndroidSteps] requestPermissionDialog threw:`, e);
    return "denied";
  }
}

// ── Module state ──────────────────────────────────────────────────────────────

let _activeSource: AndroidStepSource = "unavailable";
let _subscription: { remove: () => void } | null = null;
let _latestSteps = 0; // last known today total (set by live subscription)

/**
 * Tracks whether requestPermissionDialog() was ever called this session.
 *
 * Samsung / OEM quirk: some devices return the permission as "denied" (via
 * expo-sensors getPermissionsAsync) before the dialog has ever appeared.
 * Using PermissionsAndroid.check() is binary (granted / not-granted) and
 * doesn't distinguish "never asked" from "permanently denied".
 *
 * Rule:
 *   false → not-granted means "never asked" → return "unknown" (show Enable)
 *   true  → not-granted means "user denied" → return "denied" (show Settings)
 */
let _permissionEverRequested = false;

// ── Public service ────────────────────────────────────────────────────────────

export const androidStepService = {
  get source(): AndroidStepSource {
    return _activeSource;
  },

  /**
   * Determine whether step tracking is available and already permitted.
   * Does NOT show any UI. Call on app start.
   *
   * Returns "android_step_counter" if ready to track, "unavailable" otherwise.
   */
  async initialize(): Promise<AndroidStepSource> {
    if (__DEV__) {
      const { Platform } =
        require("react-native") as typeof import("react-native");
      if (__DEV__) console.log(
        `[AndroidSteps] initialize — Android version: ${Platform.Version}, Expo Go: ${isExpoGo()}`,
      );
    }

    if (isExpoGo()) {
      if (__DEV__)
        if (__DEV__) console.log(
          `[AndroidSteps] Expo Go detected — ACTIVITY_RECOGNITION unavailable`,
        );
      _activeSource = "unavailable";
      return "unavailable";
    }

    const granted = await checkPermission();
    if (__DEV__)
      if (__DEV__) console.log(`[AndroidSteps] ACTIVITY_RECOGNITION granted: ${granted}`);

    if (granted) {
      _activeSource = "android_step_counter";
      return "android_step_counter";
    }

    _activeSource = "unavailable";
    return "unavailable";
  },

  /**
   * Return the current permission state without showing any UI.
   *
   * "unknown"     → permission never requested yet; show the Enable button
   * "denied"      → user explicitly denied; show the Settings link
   * "granted"     → tracking is allowed
   * "unavailable" → Expo Go environment; can't be granted here
   */
  async getPermissionStatus(): Promise<AndroidPermStatus> {
    if (isExpoGo()) return "unavailable";

    const granted = await checkPermission();
    if (granted) return "granted";

    // Not granted — tell the UI whether to show Enable (unknown) or Settings (denied)
    return _permissionEverRequested ? "denied" : "unknown";
  },

  /**
   * Request ACTIVITY_RECOGNITION permission.
   * Shows the system dialog the first time; returns "denied" immediately if
   * the user previously chose "Don't ask again". Sets _activeSource on success.
   */
  async requestPermission(): Promise<AndroidPermStatus> {
    if (__DEV__) console.log(`[AndroidSteps] requestPermission called`);

    if (isExpoGo()) {
      if (__DEV__)
        if (__DEV__) console.log(`[AndroidSteps] Expo Go — cannot request permission`);
      return "unavailable";
    }

    const result = await requestPermissionDialog();
    if (__DEV__) console.log(`[AndroidSteps] Permission result: ${result}`);

    if (result === "granted") {
      _activeSource = "android_step_counter";
      return "granted";
    }
    return "denied";
  },

  /**
   * Return the latest today step data from the live subscription.
   * Returns null if not currently tracking.
   */
  readTodaySteps(): AndroidTodayData | null {
    if (_activeSource !== "android_step_counter") return null;
    const steps = _latestSteps;
    return {
      steps,
      distanceMeters: Math.round(steps * 0.762),
      calories: Math.round(steps * 0.04),
      activeMinutes: Math.ceil(steps / 120),
      source: "android_step_counter",
    };
  },

  /**
   * Subscribe to Pedometer.watchStepCount() for live step updates.
   *
   * result.steps = cumulative delta since the subscription was created.
   * savedDailySteps = confirmed step count at subscription start (baseline).
   * Callback receives absolute today total = savedDailySteps + delta.
   */
  startLiveTracking(
    onUpdate: (data: AndroidTodayData) => void,
    savedDailySteps = 0,
  ): void {
    this.stopLiveTracking();
    _latestSteps = savedDailySteps;

    if (_activeSource !== "android_step_counter") return;
    const ped = loadPedometer();
    if (!ped) {
      if (__DEV__)
        if (__DEV__) console.log(`[AndroidSteps] Pedometer module not available`);
      return;
    }

    if (__DEV__)
      if (__DEV__) console.log(
        `[AndroidSteps] Starting watchStepCount (baseline: ${savedDailySteps})`,
      );
    _subscription = ped.watchStepCount((result) => {
      const totalToday = savedDailySteps + result.steps;
      _latestSteps = totalToday;
      if (__DEV__ && result.steps > 0) {
        if (__DEV__) console.log(
          `[AndroidSteps] Step delta: ${result.steps} — today total: ${totalToday}`,
        );
      }
      onUpdate({
        steps: totalToday,
        distanceMeters: Math.round(totalToday * 0.762),
        calories: Math.round(totalToday * 0.04),
        activeMinutes: Math.ceil(totalToday / 120),
        source: "android_step_counter",
      });
    });
    if (__DEV__) console.log(`[AndroidSteps] watchStepCount subscription active`);
  },

  stopLiveTracking(): void {
    if (_subscription) {
      try {
        _subscription.remove();
      } catch {}
      _subscription = null;
    }
  },

  /** Reset all state (call on sign-out or app reset). */
  reset(): void {
    this.stopLiveTracking();
    _activeSource = "unavailable";
    _latestSteps = 0;
    _permissionEverRequested = false;
  },
};
