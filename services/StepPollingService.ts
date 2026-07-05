/**
 * StepPollingService — centralized step polling for Walk screen and Live Race.
 *
 * Uses stepProviderManager for provider-independent reads.
 */

import { STEP_SYNC_CONFIG } from "@/config/stepSyncConfig";
import { FEATURE_FLAGS } from "@/config/featureFlags";
import { stepProviderManager } from "@/services/steps/stepProviderManager";

export type PollingMode = "inactive" | "walk" | "race";

export interface RacePollingConfig {
  raceId: string;
  raceStartTime: Date;
  userId: string;
  baseline: number;
  target: number;
  onUpdate: (raceSteps: number, deviceTotal: number) => void;
  onReadBlocked?: () => void;
}

const RACE_INTERVAL_MS = STEP_SYNC_CONFIG.RACE_LOCAL_POLL_MS;
const WALK_INTERVAL_MS = STEP_SYNC_CONFIG.WALK_BACKEND_SYNC_MS;

class StepPollingService {
  private _mode: PollingMode = "inactive";
  private _interval: ReturnType<typeof setInterval> | null = null;
  private _raceConfig: RacePollingConfig | null = null;
  private _lastEmittedSteps = -1;
  private _unchangedTicks = 0;

  startPolling(mode: PollingMode, raceConfig?: RacePollingConfig): void {
    if (mode === "race" && !FEATURE_FLAGS.REAL_STEP_TRACKING_ENABLED) {
      if (__DEV__) console.log("[StepPolling] skipped — REAL_STEP_TRACKING_ENABLED is false");
      return;
    }

    const isRaceIdChange =
      mode === "race" &&
      raceConfig?.raceId !== undefined &&
      this._raceConfig?.raceId !== raceConfig.raceId;

    if (!isRaceIdChange && this._interval !== null && this._mode === mode) {
      if (__DEV__) console.log(`[StepPolling] duplicateStartPrevented mode:${mode}`);
      return;
    }

    this._clearInterval("restart");
    if (mode === "inactive") return;

    this._mode = mode;
    this._raceConfig = raceConfig ?? null;
    this._lastEmittedSteps = -1;
    this._unchangedTicks = 0;

    const intervalMs = mode === "race" ? RACE_INTERVAL_MS : WALK_INTERVAL_MS;

    if (__DEV__) {
      console.log(
        `[StepPolling] start mode:${mode} intervalMs:${intervalMs} provider=${stepProviderManager.getActiveProviderId() ?? "none"}`,
      );
    }

    this._interval = setInterval(() => void this._tick(), intervalMs);
    void this._tick();
  }

  stopPolling(reason = "manual"): void {
    this._clearInterval(reason);
  }

  /** True when race-mode polling is active (optionally for a specific race). */
  isRacePolling(raceId?: string): boolean {
    if (this._mode !== "race" || this._interval === null) return false;
    if (!raceId) return true;
    return this._raceConfig?.raceId === raceId;
  }

  switchMode(mode: PollingMode, raceConfig?: RacePollingConfig): void {
    this.startPolling(mode, raceConfig);
  }

  private _clearInterval(reason: string): void {
    if (this._interval !== null) {
      clearInterval(this._interval);
      this._interval = null;
      if (__DEV__) console.log(`[StepPolling] stop reason:${reason} previousMode:${this._mode}`);
    }
    this._mode = "inactive";
    this._raceConfig = null;
    this._lastEmittedSteps = -1;
    this._unchangedTicks = 0;
  }

  private async _tick(): Promise<void> {
    if (this._mode === "race" && this._raceConfig) {
      await this._raceModeTick(this._raceConfig);
    }
  }

  private async _raceModeTick(ctx: RacePollingConfig): Promise<void> {
    try {
      const result = await stepProviderManager.getRaceSteps(
        ctx.raceId,
        ctx.raceStartTime,
        ctx.userId,
      );

      if (!result) {
        ctx.onReadBlocked?.();
        return;
      }

      const raceSteps = Math.max(0, result.steps);
      const deviceTotal = Math.max(ctx.baseline, ctx.baseline + raceSteps);

      if (__DEV__) {
        console.log(
          `[RaceSteps] raceId:${ctx.raceId} provider:${result.providerId} raceSteps:${raceSteps} target:${ctx.target}`,
        );
      }

      if (raceSteps === this._lastEmittedSteps) {
        if (__DEV__) console.log(`[RaceSync] unchanged raceSteps:${raceSteps} (re-emit)`);
      } else {
        this._unchangedTicks = 0;
      }

      this._lastEmittedSteps = raceSteps;
      ctx.onUpdate(raceSteps, deviceTotal);
    } catch (e) {
      if (__DEV__) console.log("[StepPolling] race tick error", e);
      ctx.onReadBlocked?.();
    }
  }
}

export const stepPollingService = new StepPollingService();
