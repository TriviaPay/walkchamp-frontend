/**
 * StepTrackingService — iOS HealthKit step tracking via expo-sensors Pedometer.
 *
 * This service is iOS-only.  Android step tracking is handled by
 * services/steps/androidStepService.ts which covers Health Connect and the
 * native step counter sensor fallback.
 *
 * The module is loaded lazily so a missing or incompatible native module
 * never crashes the app.
 */

import { Platform } from "react-native";
import { FEATURE_FLAGS } from "@/config/featureFlags";

export type PermissionStatus = "granted" | "denied" | "unavailable" | "unknown";

export interface StepData {
  steps: number;
  source: "healthkit" | "unavailable";
}

// ── Lazy Pedometer loader ─────────────────────────────────────────────────────

type PedometerSubscription = { remove: () => void };
type StepCountResult = { steps: number };
type PermResult = { status: string };

interface PedometerAPI {
  isAvailableAsync: () => Promise<boolean>;
  getPermissionsAsync: () => Promise<PermResult>;
  requestPermissionsAsync: () => Promise<PermResult>;
  getStepCountAsync: (start: Date, end: Date) => Promise<StepCountResult>;
  watchStepCount: (
    callback: (result: StepCountResult) => void,
  ) => PedometerSubscription;
}

let _pedometer: PedometerAPI | null | undefined = undefined;

function getPedometer(): PedometerAPI | null {
  if (_pedometer !== undefined) return _pedometer;
  try {
    const sensors = require("expo-sensors") as { Pedometer?: PedometerAPI };
    _pedometer = sensors.Pedometer ?? null;
  } catch {
    _pedometer = null;
  }
  return _pedometer;
}

// ── Service ───────────────────────────────────────────────────────────────────

class IOSStepTrackingService {
  private _liveSubscription: PedometerSubscription | null = null;
  /** Last step count pushed by the active watchStepCount subscription. */
  private _latestLiveSteps = 0;

  /**
   * Return the most recent step count received from the CMPedometer
   * watchStepCount subscription. Zero-cost in-memory read — no HealthKit I/O.
   * Returns 0 if no subscription is active.
   * Used by StepPollingService to poll without querying HealthKit every tick.
   */
  readLatestLiveSteps(): number {
    return this._latestLiveSteps;
  }

  isEnabled(): boolean {
    if (Platform.OS !== "ios") return false;
    if (!FEATURE_FLAGS.REAL_STEP_TRACKING_ENABLED) return false;
    if (!FEATURE_FLAGS.IOS_STEP_TRACKING_ENABLED) return false;
    return true;
  }

  async isAvailable(): Promise<boolean> {
    if (!this.isEnabled()) return false;
    const Pedometer = getPedometer();
    if (!Pedometer) return false;
    try {
      return await Pedometer.isAvailableAsync();
    } catch {
      return false;
    }
  }

  async getPermissionStatus(): Promise<PermissionStatus> {
    if (!this.isEnabled()) return "unavailable";
    const Pedometer = getPedometer();
    if (!Pedometer) return "unavailable";
    try {
      const { status } = await Pedometer.getPermissionsAsync();
      if (status === "undetermined") return "unknown";
      return status as PermissionStatus;
    } catch {
      return "unavailable";
    }
  }

  async requestPermission(): Promise<PermissionStatus> {
    if (!this.isEnabled()) return "unavailable";
    const Pedometer = getPedometer();
    if (!Pedometer) return "unavailable";
    try {
      const available = await Pedometer.isAvailableAsync();
      if (!available) return "unavailable";
      const { status } = await Pedometer.requestPermissionsAsync();
      if (status === "undetermined") return "unknown";
      return status as PermissionStatus;
    } catch {
      return "unavailable";
    }
  }

  /**
   * Subscribe to real-time step updates via CMPedometer (watchStepCount).
   * Callback receives cumulative steps since the subscription started — perfect
   * for race tracking (no baseline needed; delta == race steps).
   * Permission is checked before subscribing; silently no-ops if unavailable.
   */
  startLiveTracking(onUpdate: (data: StepData) => void): void {
    this.stopLiveTracking();
    if (!this.isEnabled()) return;
    const Pedometer = getPedometer();
    if (!Pedometer) return;

    // Check permission before wiring up the subscription
    Pedometer.getPermissionsAsync()
      .then(({ status }) => {
        if (status !== "granted") {
          if (__DEV__)
            if (__DEV__) console.log(`[RaceStepsRealtime] iOS watchStepCount skipped — permission: ${status}`);
          return;
        }
        if (__DEV__)
          if (__DEV__) console.log(`[RaceStepsRealtime] iOS watchStepCount subscription started`);
        this._liveSubscription = Pedometer.watchStepCount((result) => {
          const steps = Math.max(0, result.steps ?? 0);
          this._latestLiveSteps = steps;
          onUpdate({ steps, source: "healthkit" });
        });
      })
      .catch(() => {});
  }

  /** Stop the live step subscription started by startLiveTracking(). */
  stopLiveTracking(): void {
    if (this._liveSubscription) {
      try {
        this._liveSubscription.remove();
      } catch {}
      this._liveSubscription = null;
      this._latestLiveSteps = 0;
      if (__DEV__) console.log(`[RaceStepsRealtime] iOS watchStepCount subscription stopped`);
    }
  }

  /**
   * Read steps from HealthKit for the given time range.
   * Works even when the app was closed (HealthKit records continuously).
   */
  async getStepsForTimeRange(start: Date, end: Date): Promise<StepData | null> {
    if (!this.isEnabled()) return null;
    const Pedometer = getPedometer();
    if (!Pedometer) return null;
    try {
      const available = await Pedometer.isAvailableAsync();
      if (!available) return null;
      const { status } = await Pedometer.getPermissionsAsync();
      if (status !== "granted") return null;
      const result = await Pedometer.getStepCountAsync(start, end);
      return {
        steps: Math.max(0, result.steps ?? 0),
        source: "healthkit",
      };
    } catch {
      return null;
    }
  }
}

export const stepTracker = new IOSStepTrackingService();
