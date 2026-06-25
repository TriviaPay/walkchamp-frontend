/**
 * RaceStepSyncService — delegates to raceStepSyncBuffer for batched sync.
 * Kept for backward compatibility with RaceContext / AuthContext.
 */

import { raceStepSyncBuffer, type RaceProgressSyncedHandler } from "@/services/raceStepSyncBuffer";
import { LIVE_RACE_SYNC_CONFIG } from "@/config/stepSyncConfig";
import {
  postRaceReconcile,
  type RaceProgressSource,
} from "@/services/raceProgressApi";

export interface RaceSyncOptions {
  force?: boolean;
  atTarget?: boolean;
  deviceTotalSteps?: number;
}

class RaceStepSyncService {
  reset(): void {
    raceStepSyncBuffer.reset();
  }

  seedSyncedSteps(steps: number): void {
    raceStepSyncBuffer.seedLastSynced(steps);
  }

  cancelPending(): void {
    raceStepSyncBuffer.cancelPending();
  }

  setProgressSyncedHandler(handler: RaceProgressSyncedHandler | null): void {
    raceStepSyncBuffer.setProgressSyncedHandler(handler);
  }

  notifyStepsUpdated(
    raceId: string,
    steps: number,
    source: RaceProgressSource,
    options: RaceSyncOptions = {},
  ): void {
    raceStepSyncBuffer.onLocalRaceStepUpdate(raceId, steps, source, options);
  }

  async flush(
    raceId: string,
    steps: number,
    source: RaceProgressSource,
    deviceTotalSteps?: number,
  ): Promise<boolean> {
    raceStepSyncBuffer.onLocalRaceStepUpdate(raceId, steps, source, {
      deviceTotalSteps,
    });
    return raceStepSyncBuffer.flushRaceSteps({ reason: "flush" });
  }

  /** Goal completion — retry until backend accepts final step count. */
  async flushGoal(
    raceId: string,
    steps: number,
    source: RaceProgressSource,
    deviceTotalSteps?: number,
  ): Promise<void> {
    for (let attempt = 0; attempt < 4; attempt++) {
      raceStepSyncBuffer.onLocalRaceStepUpdate(raceId, steps, source, {
        atTarget: true,
        deviceTotalSteps,
      });
      const ok = await raceStepSyncBuffer.flushRaceSteps({
        atTarget: true,
        reason: "goal",
      });
      if (ok && raceStepSyncBuffer.getLastSyncedSteps() >= steps) {
        return;
      }
      await new Promise((r) => setTimeout(r, LIVE_RACE_SYNC_CONFIG.backendSyncMs));
    }
    await postRaceReconcile(raceId, steps, source);
  }
}

export const raceStepSyncService = new RaceStepSyncService();
