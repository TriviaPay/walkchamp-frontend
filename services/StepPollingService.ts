/**
 * StepPollingService — centralized step polling for Walk screen and Live Race.
 *
 * Only ONE interval runs at any time. Duplicate start calls in the same mode
 * are silently ignored (logged in __DEV__). Starting a different mode always
 * clears the previous interval first.
 *
 * Modes:
 *   inactive — no polling (default at startup / after logout)
 *   walk     — low-frequency (10 s), for Walk screen daily step updates
 *   race     — high-frequency (500 ms), for Live Race real-time progress
 *
 * What each tick does (race mode):
 *   1. Read latest step count — zero-cost in-memory read (no HealthKit / Health Connect I/O).
 *      iOS:     stepTracker.readLatestLiveSteps() — last CMPedometer watchStepCount value.
 *      Android: androidHCService.getCachedTodaySteps() — last HC poll result (updated every 15 s).
 *   2. Compare with last emitted value. Do nothing if unchanged (skip re-renders).
 *   3. Calculate race steps from baseline.
 *   4. Fire onUpdate callback → UI updates immediately.
 *   5. The caller (RaceContext) decides whether to throttle backend sync.
 *
 * Walk mode tick is intentionally a no-op stub — WalkContext already has its
 * own platform-aware polling and nothing needs to be duplicated here. The mode
 * exists so future callers can switch the service to walk mode and stop race
 * polling without building a separate interval.
 */

import { Platform } from "react-native";
import { stepTracker } from "./StepTrackingService";
import { androidHCService } from "./steps/androidHealthConnectService";
import { FEATURE_FLAGS } from "@/config/featureFlags";

export type PollingMode = "inactive" | "walk" | "race";

export interface RacePollingConfig {
  raceId: string;
  raceStartTime: Date;
  /**
   * Device steps captured at race start.
   * iOS:     0 — watchStepCount is cumulative from subscription start.
   * Android: savedDailySteps — captured before the subscription began.
   */
  baseline: number;
  target: number;
  /**
   * Called whenever the race step count changes.
   * raceSteps  = steps since race start (baseline-corrected).
   * deviceTotal = absolute device total (for anti-cheat / audit).
   */
  onUpdate: (raceSteps: number, deviceTotal: number) => void;
}

const RACE_INTERVAL_MS = 500;
const WALK_INTERVAL_MS = 10_000;

class StepPollingService {
  private _mode: PollingMode = "inactive";
  private _interval: ReturnType<typeof setInterval> | null = null;
  private _raceConfig: RacePollingConfig | null = null;
  private _lastEmittedSteps = -1;

  /**
   * Start polling in the given mode.
   *
   * • If the same mode is already active, the call is silently ignored.
   * • If a different mode is active, the existing interval is stopped first.
   * • Always fires one immediate tick so the UI does not wait for the first
   *   interval to elapse.
   */
  startPolling(mode: PollingMode, raceConfig?: RacePollingConfig): void {
    if (mode === "race" && !FEATURE_FLAGS.REAL_STEP_TRACKING_ENABLED) {
      if (__DEV__)
        if (__DEV__) console.log(
          "[StepPolling] skipped — REAL_STEP_TRACKING_ENABLED is false",
        );
      return;
    }

    // Allow restart when raceId changes even if mode stays "race".
    // Without this guard a second race would silently reuse the old raceId config.
    const isRaceIdChange = mode === "race" &&
      raceConfig?.raceId !== undefined &&
      this._raceConfig?.raceId !== raceConfig.raceId;

    if (!isRaceIdChange && this._interval !== null && this._mode === mode) {
      if (__DEV__)
        if (__DEV__) console.log(`[StepPolling] duplicateStartPrevented mode:${mode}`);
      return;
    }

    this._clearInterval("restart");
    if (mode === "inactive") return;

    this._mode = mode;
    this._raceConfig = raceConfig ?? null;
    this._lastEmittedSteps = -1;

    const intervalMs = mode === "race" ? RACE_INTERVAL_MS : WALK_INTERVAL_MS;

    if (__DEV__) {
      if (__DEV__) console.log(
        `[StepPolling] start mode:${mode} intervalMs:${intervalMs} platform:${Platform.OS}`,
      );
      if (raceConfig) {
        if (__DEV__) console.log(
          `[StepPolling] raceId:${raceConfig.raceId} baseline:${raceConfig.baseline} target:${raceConfig.target}`,
        );
      }
    }

    this._interval = setInterval(() => void this._tick(), intervalMs);
    void this._tick();
  }

  /** Stop all polling and reset internal state. */
  stopPolling(reason = "manual"): void {
    this._clearInterval(reason);
  }

  /** Convenience alias — same as startPolling but semantically clearer when switching. */
  switchMode(mode: PollingMode, raceConfig?: RacePollingConfig): void {
    this.startPolling(mode, raceConfig);
  }

  // ── Private ──────────────────────────────────────────────────────────────────

  private _clearInterval(reason: string): void {
    if (this._interval !== null) {
      clearInterval(this._interval);
      this._interval = null;
      if (__DEV__)
        if (__DEV__) console.log(
          `[StepPolling] stop reason:${reason} previousMode:${this._mode}`,
        );
    }
    this._mode = "inactive";
    this._raceConfig = null;
    this._lastEmittedSteps = -1;
  }

  private async _tick(): Promise<void> {
    if (__DEV__)
      if (__DEV__) console.log(
        `[StepPolling] tick mode:${this._mode} platform:${Platform.OS}`,
      );

    if (this._mode === "race" && this._raceConfig) {
      this._raceModeTick(this._raceConfig);
    }
    // Walk mode: WalkContext owns its own polling. No-op here for now.
  }

  /**
   * Race mode tick.
   *
   * Reads the in-memory step value cached by the platform subscription — no
   * HealthKit or Health Connect query is made on each tick.
   * Only fires the callback when the step count has actually changed.
   */
  private _raceModeTick(ctx: RacePollingConfig): void {
    let raceSteps = 0;
    let deviceTotal = 0;

    if (Platform.OS === "ios") {
      // readLatestLiveSteps() returns the last value pushed by CMPedometer
      // watchStepCount. Zero-cost: no HealthKit I/O.
      // Because watchStepCount is cumulative since subscription start and the
      // subscription begins at race start, these steps are already race-relative.
      const latest = stepTracker.readLatestLiveSteps();
      raceSteps = Math.max(0, latest);
      deviceTotal = ctx.baseline + latest;
    } else {
      // getCachedTodaySteps() returns the last value from WalkContext's 15 s HC poll.
      // Zero-cost: no Health Connect I/O on every tick.
      const cached = androidHCService.getCachedTodaySteps();
      if (cached === 0 && ctx.baseline === 0) {
        if (__DEV__)
          if (__DEV__) console.log("[StepPolling] Android HC cache is 0 — skipping tick");
        return;
      }
      deviceTotal = cached;
      raceSteps = Math.max(0, cached - ctx.baseline);
    }

    if (__DEV__) {
      if (__DEV__) console.log(
        `[StepPolling] deviceTotalSteps:${deviceTotal}`,
      );
      if (__DEV__) console.log(
        `[RaceSteps] raceId:${ctx.raceId} baselineSteps:${ctx.baseline} calculatedRaceSteps:${raceSteps} targetSteps:${ctx.target} progress:${(raceSteps / Math.max(ctx.target, 1)).toFixed(3)} isCompleted:${raceSteps >= ctx.target}`,
      );
    }

    // Skip if value unchanged — avoids React state updates with no visual effect
    if (raceSteps === this._lastEmittedSteps) {
      if (__DEV__)
        if (__DEV__) console.log(`[StepSync] skippedNoChange raceSteps:${raceSteps}`);
      return;
    }

    this._lastEmittedSteps = raceSteps;
    ctx.onUpdate(raceSteps, deviceTotal);
  }
}

export const stepPollingService = new StepPollingService();
