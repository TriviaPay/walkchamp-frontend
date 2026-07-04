/**
 * Live race step sync buffer — batches backend progress API calls.
 *
 * Local UI updates immediately; network sync uses the same interval as local
 * step polling. Goal completion and race end always force an immediate flush.
 */

import { AppState, Platform, type AppStateStatus } from "react-native";
import { LIVE_RACE_SYNC_CONFIG, STEP_SYNC_CONFIG } from "@/config/stepSyncConfig";
import {
  postRaceProgress,
  type RaceProgressResult,
  type RaceProgressSource,
} from "@/services/raceProgressApi";

export type RaceProgressSyncedHandler = (result: RaceProgressResult & { raceId: string }) => void;

export interface RaceSyncBufferOptions {
  force?: boolean;
  atTarget?: boolean;
  deviceTotalSteps?: number;
}

class RaceStepSyncBuffer {
  private lastSyncedSteps = 0;
  /** Last step count we already POSTed (may be ahead of server acceptance). */
  private lastSentSteps = 0;
  private lastSyncTime = 0;
  private lastHttpAttemptAt = 0;
  private syncBackoffUntil = 0;
  private pendingRaceSteps = 0;
  private pendingRaceId: string | null = null;
  private pendingSource: RaceProgressSource = "unknown";
  private pendingDeviceTotal: number | undefined;
  private syncSeq = 0;
  private inFlight = false;
  private pendingTimer: ReturnType<typeof setTimeout> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private retryAttempt = 0;
  private queuedFlush: { atTarget?: boolean; reason?: string } | null = null;
  private serverStuckAt = -1;
  private serverStuckRetries = 0;
  private onProgressSynced: RaceProgressSyncedHandler | null = null;

  setProgressSyncedHandler(handler: RaceProgressSyncedHandler | null): void {
    this.onProgressSynced = handler;
  }

  reset(): void {
    this.cancelTimers();
    this.lastSyncedSteps = 0;
    this.lastSentSteps = 0;
    this.lastSyncTime = 0;
    this.pendingRaceSteps = 0;
    this.pendingRaceId = null;
    this.inFlight = false;
    this.retryAttempt = 0;
    this.syncSeq = 0;
    this.queuedFlush = null;
    this.serverStuckAt = -1;
    this.serverStuckRetries = 0;
    this.lastHttpAttemptAt = 0;
    this.syncBackoffUntil = 0;
  }

  cancelPending(): void {
    this.cancelTimers();
  }

  getLastSyncedSteps(): number {
    return this.lastSyncedSteps;
  }

  /** Rejoin / resume — avoid re-sending steps the server already has. */
  seedLastSynced(steps: number): void {
    const safe = Math.max(0, Math.floor(steps));
    this.lastSyncedSteps = safe;
    this.lastSentSteps = Math.max(this.lastSentSteps, safe);
    this.pendingRaceSteps = Math.max(this.pendingRaceSteps, safe);
  }

  private hasPendingHttpWork(): boolean {
    return this.pendingRaceSteps > this.lastSentSteps;
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

  onLocalRaceStepUpdate(
    raceId: string,
    raceSteps: number,
    source: RaceProgressSource,
    options: RaceSyncBufferOptions = {},
  ): void {
    // Native FGS owns HTTP sync in background; queue locally and flush on resume.
    if (Platform.OS === "android" && AppState.currentState !== "active") {
      this.pendingRaceId = raceId;
      this.pendingRaceSteps = Math.max(this.pendingRaceSteps, raceSteps);
      this.pendingSource = source;
      if (deviceTotalSteps !== undefined) {
        this.pendingDeviceTotal = deviceTotalSteps;
      }
      console.log(
        `[RaceStepSync] queued raceId=${raceId} steps=${raceSteps} (background)`,
      );
      return;
    }
    const { force = false, atTarget = false, deviceTotalSteps } = options;
    const cfg = LIVE_RACE_SYNC_CONFIG;
    const now = Date.now();

    this.pendingRaceId = raceId;
    this.pendingRaceSteps = Math.max(this.pendingRaceSteps, raceSteps);
    this.pendingSource = source;
    if (deviceTotalSteps !== undefined) {
      this.pendingDeviceTotal = deviceTotalSteps;
    }

    const delta = this.pendingRaceSteps - this.lastSentSteps;
    const elapsedSinceHttp = now - this.lastHttpAttemptAt;

    if (atTarget) {
      this.cancelTimers();
      void this.flushRaceSteps({ atTarget: true, reason: "goal" });
      return;
    }

    if (force) {
      if (!this.hasPendingHttpWork() && now < this.syncBackoffUntil) {
        return;
      }
      void this.flushRaceSteps({ reason: "force" });
      return;
    }

    if (delta <= 0) {
      return;
    }

    if (now < this.syncBackoffUntil) {
      return;
    }

    const burstSync = delta >= STEP_SYNC_CONFIG.RACE_BACKEND_SYNC_FORCE_DELTA;
    const shouldSync =
      delta >= cfg.minStepDeltaToSync &&
      (elapsedSinceHttp >= cfg.backendSyncMs || burstSync);

    if (shouldSync) {
      if (this.pendingTimer) {
        clearTimeout(this.pendingTimer);
        this.pendingTimer = null;
      }
      void this.flushRaceSteps({ reason: burstSync ? "burst" : "interval" });
      return;
    }

    this.scheduleTrailingSync(elapsedSinceHttp);
  }

  async flushRaceSteps(
    options: { force?: boolean; atTarget?: boolean; reason?: string } = {},
  ): Promise<boolean> {
    const raceId = this.pendingRaceId;
    if (!raceId) return false;

    const steps = this.pendingRaceSteps;
    if (steps <= this.lastSentSteps && !options.atTarget) {
      return true;
    }

    const bypassThrottle = options.atTarget === true;
    const waitMs = this.msUntilNextHttpAllowed(bypassThrottle);
    if (waitMs > 0) {
      this.scheduleDelayedFlush(waitMs, options);
      return false;
    }

    if (this.inFlight) {
      this.queuedFlush = {
        atTarget: !!options.atTarget || !!this.queuedFlush?.atTarget,
        reason: options.reason ?? this.queuedFlush?.reason,
      };
      return false;
    }

    this.inFlight = true;
    this.lastHttpAttemptAt = Date.now();
    this.lastSentSteps = steps;
    const seq = ++this.syncSeq;

    if (__DEV__) {
      console.log(
        `[RaceSync] flushed backend raceSteps=${steps} reason=${options.reason ?? "batch"}`,
      );
    }

    let ok = false;
    try {
      const result = await postRaceProgress(
        raceId,
        steps,
        seq,
        this.pendingDeviceTotal,
        this.pendingSource,
      );
      ok = result.ok;
      if (ok && this.onProgressSynced && result.rank !== undefined) {
        this.onProgressSynced({ ...result, raceId });
      }
      if (ok) {
        const serverSteps = Math.max(0, Math.floor(result.acceptedSteps));
        const sentSteps = Math.max(0, Math.floor(steps));
        this.lastSyncedSteps = Math.max(this.lastSyncedSteps, serverSteps);

        if (serverSteps >= sentSteps) {
          this.lastSyncTime = Date.now();
          this.retryAttempt = 0;
          this.serverStuckAt = -1;
          this.serverStuckRetries = 0;
          if (__DEV__) {
            console.log(
              `[StepSync] provider ${this.pendingSource} synced steps=${this.lastSyncedSteps}`,
            );
          }
        } else {
          if (serverSteps === this.serverStuckAt) {
            this.serverStuckRetries += 1;
          } else {
            this.serverStuckAt = serverSteps;
            this.serverStuckRetries = 1;
          }
          if (__DEV__) {
            console.log(
              `[RaceSync] server behind sent=${sentSteps} stored=${serverSteps}, retrying`,
            );
          }
          if (this.serverStuckRetries >= 3) {
            this.syncBackoffUntil =
              Date.now() + LIVE_RACE_SYNC_CONFIG.backendSyncMs * 10;
            if (__DEV__) {
              console.log(
                `[RaceSync] server stuck at ${serverSteps} (sent ${sentSteps}), pausing sync ${LIVE_RACE_SYNC_CONFIG.backendSyncMs * 10}ms`,
              );
            }
          } else {
            this.scheduleCatchUpRetry();
          }
        }
      } else {
        this.scheduleRetry();
      }
    } finally {
      this.inFlight = false;
      const queued = this.queuedFlush;
      this.queuedFlush = null;
      if (queued) {
        void this.flushRaceSteps({
          atTarget: queued.atTarget,
          reason: queued.reason ?? "queued",
        });
      }
    }

    return ok;
  }

  private msUntilNextHttpAllowed(bypassThrottle: boolean): number {
    if (bypassThrottle) return 0;
    const now = Date.now();
    const intervalWait = Math.max(
      0,
      LIVE_RACE_SYNC_CONFIG.backendSyncMs - (now - this.lastHttpAttemptAt),
    );
    const backoffWait = Math.max(0, this.syncBackoffUntil - now);
    return Math.max(intervalWait, backoffWait);
  }

  private scheduleDelayedFlush(
    delayMs: number,
    options: { atTarget?: boolean; reason?: string },
  ): void {
    if (this.pendingTimer) return;
    this.pendingTimer = setTimeout(() => {
      this.pendingTimer = null;
      void this.flushRaceSteps(options);
    }, delayMs);
  }

  private scheduleTrailingSync(elapsedSinceLastSync: number): void {
    if (this.pendingTimer) return;
    const delay = Math.max(
      250,
      LIVE_RACE_SYNC_CONFIG.backendSyncMs - elapsedSinceLastSync,
      LIVE_RACE_SYNC_CONFIG.maxPendingAgeMs > 0
        ? LIVE_RACE_SYNC_CONFIG.maxPendingAgeMs - elapsedSinceLastSync
        : 0,
    );
    this.pendingTimer = setTimeout(() => {
      this.pendingTimer = null;
      void this.flushRaceSteps({ reason: "trailing" });
    }, delay);
  }

  private scheduleCatchUpRetry(): void {
    if (this.retryTimer) return;
    if (!this.hasPendingHttpWork()) return;
    const delay = LIVE_RACE_SYNC_CONFIG.backendSyncMs;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      if (this.hasPendingHttpWork()) {
        void this.flushRaceSteps({ reason: "server_behind" });
      }
    }, delay);
  }

  private scheduleRetry(): void {
    if (this.retryTimer) return;
    const backoff = Math.min(30_000, 2_000 * 2 ** this.retryAttempt);
    this.retryAttempt += 1;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.flushRaceSteps({ reason: "retry" });
    }, backoff);
  }
}

export const raceStepSyncBuffer = new RaceStepSyncBuffer();

AppState.addEventListener("change", (next: AppStateStatus) => {
  if (next === "active") {
    void raceStepSyncBuffer.flushRaceSteps({ force: true, reason: "resume" });
    return;
  }
  if (
    (next === "background" || next === "inactive") &&
    LIVE_RACE_SYNC_CONFIG.flushOnAppBackground
  ) {
    void raceStepSyncBuffer.flushRaceSteps({ reason: "background" });
  }
});
