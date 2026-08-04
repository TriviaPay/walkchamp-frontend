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
import { submitRaceVerifiedTotal } from "@/services/steps/raceVerificationSubmit";
import { verifyRaceProgress } from "@/services/steps/raceHealthVerification";
import { store } from "@/store";

export interface RaceSyncOptions {
  force?: boolean;
  atTarget?: boolean;
  deviceTotalSteps?: number;
  trackingSessionId?: string;
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
    const { isUnlimitedClassicProgressBlocked } = require(
      "@/services/unlimitedRaceProgressGuard",
    ) as typeof import("@/services/unlimitedRaceProgressGuard");
    if (isUnlimitedClassicProgressBlocked(raceId)) return;
    raceStepSyncBuffer.onLocalRaceStepUpdate(raceId, steps, source, options);
  }

  async flush(
    raceId: string,
    steps: number,
    source: RaceProgressSource,
    deviceTotalSteps?: number,
  ): Promise<boolean> {
    const { isUnlimitedClassicProgressBlocked } = require(
      "@/services/unlimitedRaceProgressGuard",
    ) as typeof import("@/services/unlimitedRaceProgressGuard");
    if (isUnlimitedClassicProgressBlocked(raceId)) return true;
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
    const { isUnlimitedClassicProgressBlocked } = require(
      "@/services/unlimitedRaceProgressGuard",
    ) as typeof import("@/services/unlimitedRaceProgressGuard");
    if (isUnlimitedClassicProgressBlocked(raceId)) return;
    for (let attempt = 0; attempt < 2; attempt++) {
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
    // Best-effort end-of-race verify submit (404 soft-skips).
    try {
      const rp = store.getState().raceProgress;
      const startAt = rp.raceStartTime
        ? new Date(rp.raceStartTime).toISOString()
        : new Date().toISOString();
      const local = await verifyRaceProgress({
        raceId,
        startAtUtc: startAt,
        liveRaceSteps: steps,
      });
      if (local.verifiedRaceSteps > 0) {
        await submitRaceVerifiedTotal({
          raceId,
          verifiedCumulativeSteps: local.verifiedRaceSteps,
          measuredAtUtc: local.verifiedAtUtc,
          intervalStartUtc: startAt,
          clientLiveCumulativeSteps: steps,
          verificationSessionId: rp.liveRaceSessionId,
        });
      }
    } catch {
      /* never block goal flush */
    }
  }
}

export const raceStepSyncService = new RaceStepSyncService();
