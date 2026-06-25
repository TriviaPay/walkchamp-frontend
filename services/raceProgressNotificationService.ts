import { Platform } from "react-native";
import { requireOptionalNativeModule } from "expo-modules-core";
import { RACE_PROGRESS_NOTIFICATION_CONFIG } from "@/config/raceProgressNotificationConfig";
import { registerLiveActivityToken } from "@/services/raceProgressApi";

export type RaceProgressNotificationPayload = {
  raceId: string;
  userId: string;
  username: string;
  raceSteps: number;
  rank: number;
  totalParticipants: number;
  goalSteps: number;
  timeLeftSeconds: number;
  raceStatus?: string;
  lastSyncedAt?: string;
};

type NativeModule = {
  startRaceProgressNotification: (payload: Record<string, unknown>) => Promise<void>;
  updateRaceProgressNotification: (payload: Record<string, unknown>) => Promise<void>;
  stopRaceProgressNotification: (payload: { raceId: string }) => Promise<void>;
  startRaceLiveActivity: (
    payload: Record<string, unknown>,
  ) => Promise<{ activityId?: string; pushToken?: string }>;
  updateRaceLiveActivity: (payload: Record<string, unknown>) => Promise<void>;
  endRaceLiveActivity: (payload: { raceId: string; raceStatus?: string }) => Promise<void>;
};

const native = requireOptionalNativeModule<NativeModule>("WalkChampRaceProgress");

function toNativePayload(payload: RaceProgressNotificationPayload): Record<string, unknown> {
  return {
    raceId: payload.raceId,
    userId: payload.userId,
    username: payload.username,
    raceSteps: payload.raceSteps,
    rank: payload.rank,
    totalParticipants: payload.totalParticipants,
    goalSteps: payload.goalSteps,
    timeLeftSeconds: payload.timeLeftSeconds,
    raceStatus: payload.raceStatus ?? "in_progress",
    deepLink: `globalwalkerleague://race/${payload.raceId}`,
  };
}

class RaceProgressNotificationService {
  private activeRaceId: string | null = null;
  private lastLocalUpdateMs = 0;
  private lastSteps = -1;
  private lastRank = -1;
  private registerTimer: ReturnType<typeof setTimeout> | null = null;

  private clearRegisterTimer(): void {
    if (this.registerTimer) {
      clearTimeout(this.registerTimer);
      this.registerTimer = null;
    }
  }

  private shouldThrottle(steps: number, rank: number, force = false): boolean {
    if (force) return false;
    const now = Date.now();
    const cfg = RACE_PROGRESS_NOTIFICATION_CONFIG;
    if (now - this.lastLocalUpdateMs < cfg.LOCAL_UPDATE_MS) return true;
    if (
      Math.abs(steps - this.lastSteps) < cfg.MIN_STEP_DELTA_FOR_UPDATE &&
      rank === this.lastRank
    ) {
      return true;
    }
    return false;
  }

  private markUpdated(steps: number, rank: number): void {
    this.lastLocalUpdateMs = Date.now();
    this.lastSteps = steps;
    this.lastRank = rank;
  }

  async start(payload: RaceProgressNotificationPayload): Promise<void> {
    this.clearRegisterTimer();
    this.activeRaceId = payload.raceId;
    this.lastSteps = -1;
    this.lastRank = -1;
    const nativePayload = toNativePayload(payload);

    try {
      if (Platform.OS === "android" && native?.startRaceProgressNotification) {
        await native.startRaceProgressNotification(nativePayload);
      }
      if (Platform.OS === "ios" && native?.startRaceLiveActivity) {
        const result = await native.startRaceLiveActivity(nativePayload);
        const activityId = result?.activityId;
        const pushToken = result?.pushToken;
        if (activityId && pushToken) {
          this.registerTimer = setTimeout(() => {
            void registerLiveActivityToken(payload.raceId, activityId, pushToken, "ios");
          }, RACE_PROGRESS_NOTIFICATION_CONFIG.REGISTER_TOKEN_DELAY_MS);
        }
      }
      this.markUpdated(payload.raceSteps, payload.rank);
    } catch (err) {
      if (__DEV__) console.warn("[RaceProgressNotif] start failed", err);
    }
  }

  async stop(raceId: string, raceStatus = "completed"): Promise<void> {
    this.clearRegisterTimer();
    if (this.activeRaceId === raceId) {
      this.activeRaceId = null;
    }
    try {
      if (Platform.OS === "android" && native?.stopRaceProgressNotification) {
        await native.stopRaceProgressNotification({ raceId });
      }
      if (Platform.OS === "ios" && native?.endRaceLiveActivity) {
        await native.endRaceLiveActivity({ raceId, raceStatus });
      }
    } catch (err) {
      if (__DEV__) console.warn("[RaceProgressNotif] stop failed", err);
    }
  }

  async onBackendProgressSynced(payload: RaceProgressNotificationPayload): Promise<void> {
    if (!payload.raceId || this.activeRaceId !== payload.raceId) return;
    if (payload.raceStatus === "completed" || payload.raceStatus === "cancelled") {
      await this.stop(payload.raceId, payload.raceStatus);
      return;
    }
    const force = payload.goalSteps > 0 && payload.raceSteps >= payload.goalSteps;
    if (this.shouldThrottle(payload.raceSteps, payload.rank, force)) return;

    const nativePayload = toNativePayload(payload);
    try {
      if (Platform.OS === "android" && native?.updateRaceProgressNotification) {
        await native.updateRaceProgressNotification(nativePayload);
      }
      if (Platform.OS === "ios" && native?.updateRaceLiveActivity) {
        await native.updateRaceLiveActivity(nativePayload);
      }
      this.markUpdated(payload.raceSteps, payload.rank);
    } catch (err) {
      if (__DEV__) console.warn("[RaceProgressNotif] update failed", err);
    }
  }
}

export const raceProgressNotificationService = new RaceProgressNotificationService();
