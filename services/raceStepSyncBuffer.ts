/**
 * Live race step sync buffer — batches backend progress API calls.
 *
 * Local UI updates immediately; network sync is throttled with flush on
 * critical lifecycle events. Wraps existing POST /api/races/:id/progress.
 */

import { AppState, type AppStateStatus } from "react-native";
import { LIVE_RACE_SYNC_CONFIG } from "@/config/stepSyncConfig";
import {
  postRaceProgress,
  type RaceProgressSource,
} from "@/services/raceProgressApi";

export interface RaceSyncBufferOptions {
  force?: boolean;
  atTarget?: boolean;
  deviceTotalSteps?: number;
}

class RaceStepSyncBuffer {
  private lastSyncedSteps = 0;
  private lastSyncTime = 0;
  private pendingRaceSteps = 0;
  private pendingRaceId: string | null = null;
  private pendingSource: RaceProgressSource = "unknown";
  private pendingDeviceTotal: number | undefined;
  private syncSeq = 0;
  private inFlight = false;
  private pendingTimer: ReturnType<typeof setTimeout> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private retryAttempt = 0;

  reset(): void {
    this.cancelTimers();
    this.lastSyncedSteps = 0;
    this.lastSyncTime = 0;
    this.pendingRaceSteps = 0;
    this.pendingRaceId = null;
    this.inFlight = false;
    this.retryAttempt = 0;
    this.syncSeq = 0;
  }

  cancelPending(): void {
    this.cancelTimers();
  }

  private cancelTimers(): void {
    if (this.pendingTimer) {
      clearTimeout(this.pendingTimer);
      this.pendingTimer = null;
    }
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
  }

  /**
   * Called on every local race step update.
   * UI is updated by the caller — this only manages backend sync.
   */
  onLocalRaceStepUpdate(
    raceId: string,
    raceSteps: number,
    source: RaceProgressSource,
    options: RaceSyncBufferOptions = {},
  ): void {
    const { force = false, atTarget = false, deviceTotalSteps } = options;
    const cfg = LIVE_RACE_SYNC_CONFIG;
    const now = Date.now();

    this.pendingRaceId = raceId;
    this.pendingRaceSteps = Math.max(this.pendingRaceSteps, raceSteps);
    this.pendingSource = source;
    this.pendingDeviceTotal = deviceTotalSteps;

    const delta = this.pendingRaceSteps - this.lastSyncedSteps;
    const elapsed = now - this.lastSyncTime;

    if (__DEV__) {
      console.log(
        `[RaceSync] local update raceSteps=${raceSteps} pending=${this.pendingRaceSteps} delta=${delta}`,
      );
    }

    if (force || atTarget) {
      this.cancelTimers();
      void this.flushRaceSteps({ force: true, reason: force ? "force" : "goal" });
      return;
    }

    if (delta <= 0) {
      if (__DEV__) console.log("[RaceSync] skipped backend sync, no new steps");
      return;
    }

    const shouldSync =
      delta >= cfg.minStepDeltaToSync &&
      elapsed >= cfg.backendSyncMs;

    if (shouldSync) {
      this.cancelTimers();
      void this.flushRaceSteps();
      return;
    }

    this.scheduleTrailingSync(elapsed);
  }

  async flushRaceSteps(
    options: { force?: boolean; reason?: string } = {},
  ): Promise<void> {
    const raceId = this.pendingRaceId;
    if (!raceId) return;

    const steps = this.pendingRaceSteps;
    if (!options.force && steps <= this.lastSyncedSteps) {
      if (__DEV__) console.log("[RaceSync] skipped flush, no new steps");
      return;
    }

    if (this.inFlight) {
      if (__DEV__) console.log("[RaceSync] sync in flight — queued latest value");
      return;
    }

    this.inFlight = true;
    const seq = ++this.syncSeq;

    if (__DEV__) {
      console.log(
        `[RaceSync] flushed backend raceSteps=${steps} reason=${options.reason ?? "batch"}`,
      );
    }

    const ok = await postRaceProgress(
      raceId,
      steps,
      seq,
      this.pendingDeviceTotal,
      this.pendingSource,
    );

    this.inFlight = false;

    if (ok) {
      this.lastSyncedSteps = Math.max(this.lastSyncedSteps, steps);
      this.lastSyncTime = Date.now();
      this.retryAttempt = 0;
      if (__DEV__) {
        console.log(`[StepSync] provider ${this.pendingSource} synced steps=${steps}`);
      }
    } else {
      this.scheduleRetry();
    }

    if (
      this.pendingRaceId === raceId &&
      this.pendingRaceSteps > this.lastSyncedSteps &&
      !this.pendingTimer &&
      !this.retryTimer
    ) {
      this.scheduleTrailingSync(Date.now() - this.lastSyncTime);
    }
  }

  private scheduleTrailingSync(elapsedSinceLastSync: number): void {
    if (this.pendingTimer) return;
    const delay = Math.max(
      500,
      LIVE_RACE_SYNC_CONFIG.backendSyncMs - elapsedSinceLastSync,
      LIVE_RACE_SYNC_CONFIG.maxPendingAgeMs > 0
        ? LIVE_RACE_SYNC_CONFIG.maxPendingAgeMs - elapsedSinceLastSync
        : 0,
    );
    this.pendingTimer = setTimeout(() => {
      this.pendingTimer = null;
      void this.flushRaceSteps();
    }, delay);
  }

  private scheduleRetry(): void {
    if (this.retryTimer) return;
    const backoff = Math.min(30_000, 2_000 * 2 ** this.retryAttempt);
    this.retryAttempt += 1;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.flushRaceSteps({ force: true, reason: "retry" });
    }, backoff);
  }
}

export const raceStepSyncBuffer = new RaceStepSyncBuffer();

// Flush pending steps on app background; on resume only if progress is pending.
AppState.addEventListener("change", (next: AppStateStatus) => {
  if (
    (next === "background" || next === "inactive") &&
    LIVE_RACE_SYNC_CONFIG.flushOnAppBackground
  ) {
    void raceStepSyncBuffer.flushRaceSteps({ force: true, reason: "background" });
  }
});
