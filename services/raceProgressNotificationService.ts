import { Platform } from "react-native";
import { FEATURE_FLAGS } from "@/config/featureFlags";
import { RACE_PROGRESS_NOTIFICATION_CONFIG } from "@/config/raceProgressNotificationConfig";
import { registerLiveActivityToken } from "@/services/raceProgressApi";
import { getValidSession } from "@/services/authService";
import { stepProviderManager } from "@/services/steps/stepProviderManager";
import { store } from "@/store";
import { getNotificationPermissionStatus } from "@/services/permissions/notificationPermissionService";

const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? "";

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
  /** Absolute race end (ISO or epoch ms). Used once to seed native countdown chronometer. */
  challengeEndAt?: string | number;
};

type NativeModule = {
  startRaceProgressNotification: (payload: Record<string, unknown>) => Promise<void>;
  updateRaceProgressNotification: (payload: Record<string, unknown>) => Promise<void>;
  stopRaceProgressNotification: (payload: { raceId: string; reason?: string }) => Promise<void>;
  startRaceBackgroundService?: (payload: Record<string, unknown>) => Promise<void>;
  updateRaceBackgroundService?: (payload: Record<string, unknown>) => Promise<void>;
  stopRaceBackgroundService?: (payload: {
    raceId: string;
    reason?: string;
    todaySteps?: number;
  }) => Promise<void>;
  getRaceBackgroundState?: () => Promise<string | null>;
  startRaceLiveActivity: (
    payload: Record<string, unknown>,
  ) => Promise<{ activityId?: string; pushToken?: string }>;
  updateRaceLiveActivity: (payload: Record<string, unknown>) => Promise<void>;
  endRaceLiveActivity: (payload: { raceId: string; raceStatus?: string }) => Promise<void>;
  enableRaceHealthKitBackground?: (raceStartISO: string) => Promise<void>;
  disableRaceHealthKitBackground?: () => Promise<void>;
  addListener?: (event: string, handler: () => void) => { remove: () => void };
};

let nativeModule: NativeModule | null | undefined;
let notificationPermissionDenied = false;
let healthKitWakeSubscription: { remove: () => void } | null = null;

function getNativeModule(): NativeModule | null {
  if (!FEATURE_FLAGS.ENABLE_RACE_PROGRESS_NOTIFICATIONS) return null;
  if (nativeModule !== undefined) return nativeModule;
  try {
    const { isAppStartupReady } = require("@/services/appStartup") as typeof import("@/services/appStartup");
    // Do not cache null before startup — bridge may not be ready yet.
    if (!isAppStartupReady()) return null;
    const { requireOptionalExpoNativeModule } = require("@/utils/expoNativeModule") as typeof import("@/utils/expoNativeModule");
    nativeModule = requireOptionalExpoNativeModule<NativeModule>("WalkChampRaceProgress");
  } catch (err) {
    if (__DEV__) console.warn("[RaceProgressNotif] native module unavailable", err);
    nativeModule = null;
  }
  return nativeModule ?? null;
}

async function checkAndroidNotificationPermission(): Promise<boolean> {
  if (Platform.OS !== "android") return true;
  const status = await getNotificationPermissionStatus();
  const ok = status === "granted";
  notificationPermissionDenied = !ok;
  return ok;
}

async function toNativePayload(
  payload: RaceProgressNotificationPayload,
  raceStartISO?: string,
): Promise<Record<string, unknown>> {
  const session = await getValidSession();
  const out: Record<string, unknown> = {
    raceId: payload.raceId,
    userId: payload.userId,
    username: payload.username,
    raceSteps: payload.raceSteps,
    rank: payload.rank,
    totalParticipants: payload.totalParticipants,
    goalSteps: payload.goalSteps,
    timeLeftSeconds: payload.timeLeftSeconds,
    raceStatus: payload.raceStatus ?? "in_progress",
    raceStartTime: raceStartISO,
    stepSource: stepProviderManager.toRaceProgressSource(),
    apiBaseUrl: API_BASE,
    authToken: session ?? "",
    deepLink: `walkchamp://race/${payload.raceId}`,
    body: formatRaceNotificationBody(payload),
  };
  if (payload.challengeEndAt != null && payload.challengeEndAt !== "") {
    out.challengeEndAt = payload.challengeEndAt;
  }
  return out;
}

function formatGoalSteps(goalSteps: number): string {
  const goal = Math.max(0, goalSteps);
  if (goal >= 1000 && goal % 1000 === 0) return `${goal / 1000}K`;
  return goal.toLocaleString();
}

function formatRaceNotificationBody(payload: RaceProgressNotificationPayload): string {
  // Elapsed / countdown is owned by the Android notification chronometer.
  // Do not embed a static "m:ss left" — it freezes between JS updates.
  const steps = payload.raceSteps.toLocaleString();
  const goal = formatGoalSteps(payload.goalSteps);
  const openHint = payload.timeLeftSeconds > 0 ? "" : " • Open";
  return `${steps} steps • #${payload.rank}/${payload.totalParticipants} • Goal ${goal}${openHint}`;
}

class RaceProgressNotificationService {
  private activeRaceId: string | null = null;
  private lastLocalUpdateMs = 0;
  private lastSteps = -1;
  private lastRank = -1;
  private lastTimeLeft = -1;
  private registerTimer: ReturnType<typeof setTimeout> | null = null;
  private onHealthKitWake: (() => void) | null = null;

  private clearRegisterTimer(): void {
    if (this.registerTimer) {
      clearTimeout(this.registerTimer);
      this.registerTimer = null;
    }
  }

  isNotificationPermissionDenied(): boolean {
    return notificationPermissionDenied;
  }

  setHealthKitWakeHandler(handler: (() => void) | null): void {
    this.onHealthKitWake = handler;
  }

  private shouldThrottle(
    steps: number,
    rank: number,
    timeLeftSeconds: number,
    force = false,
  ): boolean {
    if (force) return false;
    const now = Date.now();
    const cfg = RACE_PROGRESS_NOTIFICATION_CONFIG;
    if (now - this.lastLocalUpdateMs < cfg.LOCAL_UPDATE_MS) return true;
    if (
      Math.abs(steps - this.lastSteps) < cfg.MIN_STEP_DELTA_FOR_UPDATE &&
      rank === this.lastRank &&
      timeLeftSeconds === this.lastTimeLeft
    ) {
      return true;
    }
    return false;
  }

  private markUpdated(steps: number, rank: number, timeLeftSeconds: number): void {
    this.lastLocalUpdateMs = Date.now();
    this.lastSteps = steps;
    this.lastRank = rank;
    this.lastTimeLeft = timeLeftSeconds;
  }

  private async registerLiveActivityTokenWithRetry(
    raceId: string,
    activityId: string,
    initialToken: string,
  ): Promise<void> {
    const tryRegister = async (token: string) => {
      if (!token) return false;
      try {
        await registerLiveActivityToken(raceId, activityId, token, "ios");
        return true;
      } catch {
        return false;
      }
    };

    if (await tryRegister(initialToken)) return;

    for (const delayMs of [1500, 3000, 5000]) {
      await new Promise((r) => setTimeout(r, delayMs));
      const native = getNativeModule();
      if (!native?.startRaceLiveActivity) return;
      // Token may arrive after start — re-read from a no-op update path is unnecessary;
      // backend registration retries on next progress sync if needed.
      if (initialToken && (await tryRegister(initialToken))) return;
    }
  }

  private raceStartISO: string | null = null;

  async start(payload: RaceProgressNotificationPayload, raceStartISO?: string): Promise<void> {
    if (!FEATURE_FLAGS.ENABLE_RACE_PROGRESS_NOTIFICATIONS) return;
    // Defensive: never start participant-only live race notification without identity.
    if (!payload.raceId || !payload.userId) {
      if (__DEV__) {
        console.warn("[RaceProgressNotif] start blocked — missing raceId/userId");
      }
      return;
    }
    const native = getNativeModule();
    if (!native) return;

    this.clearRegisterTimer();
    this.activeRaceId = payload.raceId;
    this.raceStartISO = raceStartISO ?? null;
    this.lastSteps = -1;
    this.lastRank = -1;
    this.lastTimeLeft = -1;
    const nativePayload = await toNativePayload(payload, raceStartISO);

    try {
      if (Platform.OS === "android") {
        const permitted = await checkAndroidNotificationPermission();
        if (!permitted) {
          console.warn(
            "[RaceProgressNotif] POST_NOTIFICATIONS denied — FGS still starting",
          );
        }
        const { ensureActivityRecognitionPermission } = await import(
          "@/services/permissions/activityRecognitionPermissionService"
        );
        const arGranted = await ensureActivityRecognitionPermission();
        if (!arGranted) {
          console.warn(
            "[RaceProgressNotif] ACTIVITY_RECOGNITION denied — health FGS not started",
          );
          return;
        }
        const startFn =
          native.startRaceBackgroundService ?? native.startRaceProgressNotification;
        if (startFn) {
          await startFn(nativePayload);
        }
        if (__DEV__) {
          console.log(`[RaceNotification] startForeground raceId=${payload.raceId}`);
        }
      }

      if (Platform.OS === "ios") {
        if (raceStartISO && native.enableRaceHealthKitBackground) {
          await native.enableRaceHealthKitBackground(raceStartISO);
          healthKitWakeSubscription?.remove();
          if (native.addListener) {
            healthKitWakeSubscription = native.addListener("onHealthKitRaceStepsWake", () => {
              this.onHealthKitWake?.();
            });
          }
        }
        if (native.startRaceLiveActivity) {
          const result = await native.startRaceLiveActivity(nativePayload);
          const activityId = result?.activityId;
          const pushToken = result?.pushToken ?? "";
          if (activityId) {
            void this.registerLiveActivityTokenWithRetry(payload.raceId, activityId, pushToken);
          }
        }
      }
      this.markUpdated(payload.raceSteps, payload.rank, payload.timeLeftSeconds);
    } catch (err) {
      if (__DEV__) console.warn("[RaceProgressNotif] start failed", err);
    }
  }

  async stop(raceId: string, raceStatus = "completed", todaySteps?: number): Promise<void> {
    if (!FEATURE_FLAGS.ENABLE_RACE_PROGRESS_NOTIFICATIONS) return;
    const native = getNativeModule();
    if (!native) return;

    this.clearRegisterTimer();
    healthKitWakeSubscription?.remove();
    healthKitWakeSubscription = null;
    if (this.activeRaceId === raceId) {
      this.activeRaceId = null;
      this.raceStartISO = null;
    }
    try {
      if (Platform.OS === "android") {
        const stopFn =
          native.stopRaceBackgroundService ?? native.stopRaceProgressNotification;
        if (stopFn) {
          await stopFn({ raceId, reason: raceStatus, todaySteps: todaySteps ?? 0 });
        }
      }
      if (Platform.OS === "ios") {
        if (native.disableRaceHealthKitBackground) {
          await native.disableRaceHealthKitBackground();
        }
        if (native.endRaceLiveActivity) {
          await native.endRaceLiveActivity({ raceId, raceStatus });
        }
      }
    } catch (err) {
      if (__DEV__) console.warn("[RaceProgressNotif] stop failed", err);
    }
  }

  /** Stop any active race notification (logout / global cleanup). */
  async stopAll(todaySteps?: number, reason = "cancelled"): Promise<void> {
    if (this.activeRaceId) {
      await this.stop(this.activeRaceId, reason, reason === "logout" ? 0 : todaySteps);
    }
    notificationPermissionDenied = false;
  }

  async onLocalRaceStepsUpdated(
    payload: RaceProgressNotificationPayload,
    forceUpdate = false,
  ): Promise<void> {
    await this.onBackendProgressSynced(payload, forceUpdate);
  }

  async onBackendProgressSynced(
    payload: RaceProgressNotificationPayload,
    forceUpdate = false,
  ): Promise<void> {
    if (!FEATURE_FLAGS.ENABLE_RACE_PROGRESS_NOTIFICATIONS) return;
    const native = getNativeModule();
    if (!native) return;

    if (!payload.raceId || this.activeRaceId !== payload.raceId) return;
    if (payload.raceStatus === "completed" || payload.raceStatus === "cancelled") {
      const todaySteps = store.getState().raceProgress.todaySteps;
      await this.stop(payload.raceId, payload.raceStatus, todaySteps);
      return;
    }
    const forceByGoal = payload.goalSteps > 0 && payload.raceSteps >= payload.goalSteps;
    if (
      this.shouldThrottle(
        payload.raceSteps,
        payload.rank,
        payload.timeLeftSeconds,
        forceUpdate || forceByGoal,
      )
    ) {
      return;
    }

    const nativePayload = await toNativePayload(payload, this.raceStartISO ?? undefined);
    try {
      if (Platform.OS === "android") {
        const updateFn =
          native.updateRaceBackgroundService ?? native.updateRaceProgressNotification;
        if (updateFn) {
          await updateFn(nativePayload);
        }
      }
      if (Platform.OS === "ios" && native.updateRaceLiveActivity) {
        await native.updateRaceLiveActivity(nativePayload);
      }
      this.markUpdated(payload.raceSteps, payload.rank, payload.timeLeftSeconds);
    } catch (err) {
      if (__DEV__) console.warn("[RaceProgressNotif] update failed", err);
    }
  }

  /** Read last native FGS race state (Android) for hydrate on resume. */
  async getNativeRaceState(): Promise<string | null> {
    if (Platform.OS !== "android") return null;
    const native = getNativeModule();
    if (!native?.getRaceBackgroundState) return null;
    try {
      return await native.getRaceBackgroundState();
    } catch {
      return null;
    }
  }

  /**
   * Return the race step count last persisted by the native foreground service
   * (Android only). Parsed from the same JSON blob used for hydration on resume.
   * Returns null on iOS or when the native service has no state.
   * Used by stepDisplayMerge to reconcile native FGS state on app resume.
   */
  async getNativeRaceSteps(): Promise<number | null> {
    const raw = await this.getNativeRaceState();
    if (!raw) return null;
    try {
      const json = JSON.parse(raw) as Record<string, unknown>;
      const steps = typeof json.raceSteps === "number" ? json.raceSteps : undefined;
      return steps ?? null;
    } catch {
      return null;
    }
  }
}

export const raceProgressNotificationService = new RaceProgressNotificationService();
