/**
 * RaceStepSyncService — delegates to raceStepSyncBuffer for batched sync.
 * Kept for backward compatibility with RaceContext / AuthContext.
 */

import { raceStepSyncBuffer } from "@/services/raceStepSyncBuffer";
import type { RaceProgressSource } from "@/services/raceProgressApi";

export interface RaceSyncOptions {
  force?: boolean;
  atTarget?: boolean;
  deviceTotalSteps?: number;
}

class RaceStepSyncService {
  reset(): void {
    raceStepSyncBuffer.reset();
  }

  cancelPending(): void {
    raceStepSyncBuffer.cancelPending();
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
  ): Promise<void> {
    raceStepSyncBuffer.onLocalRaceStepUpdate(raceId, steps, source, {
      force: true,
      deviceTotalSteps,
    });
    await raceStepSyncBuffer.flushRaceSteps({ force: true, reason: "flush" });
  }
}

export const raceStepSyncService = new RaceStepSyncService();
