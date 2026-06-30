import { PermissionsAndroid, Platform } from "react-native";
import { FEATURE_FLAGS } from "@/config/featureFlags";
import { STEP_TRACKING_NOTIFICATION_CONFIG } from "@/config/stepTrackingNotificationConfig";
import { stepProviderManager } from "@/services/steps/stepProviderManager";
import { getValidSession } from "@/services/authService";

const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? "";

export type WalkStepNotificationPayload = {
  userId: string;
  todaySteps: number;
  dailyGoal: number;
};

type NativeWalkStepState = {
  userId?: string | null;
  todaySteps: number;
  raceSteps?: number;
  activeRaceId?: string | null;
  stepSource: string;
  notificationMode?: string;
  walkActive?: boolean;
  localDate?: string;
  lastUpdatedAt: number;
  updatedAt?: number;
  sensorSupported?: boolean;
  sensorTotal?: number;
};

type NativeModule = {
  startWalkStepNotification: (payload: Record<string, unknown>) => Promise<void>;
  updateWalkStepNotification: (payload: Record<string, unknown>) => Promise<void>;
  stopWalkStepNotification: () => Promise<void>;
  startStepTrackingService?: (payload: Record<string, unknown>) => Promise<void>;
  updateStepTrackingService?: (payload: Record<string, unknown>) => Promise<void>;
  stopStepTrackingService?: (reason?: Record<string, unknown>) => Promise<void>;
  startWalkLiveActivity: (payload: Record<string, unknown>) => Promise<void>;
  updateWalkLiveActivity: (payload: Record<string, unknown>) => Promise<void>;
  endWalkLiveActivity: () => Promise<void>;
  getNativeWalkStepState?: () => Promise<NativeWalkStepState | null>;
  getNativeStepState?: () => Promise<NativeWalkStepState | null>;
  clearNativeStepStateForUser?: (userId: string) => Promise<void>;
  flushRaceSyncOutbox?: () => Promise<void>;
  resetDailyStepsForNewDay?: () => Promise<boolean>;
  addListener?: (
    event: string,
    handler: (state: NativeWalkStepState) => void,
  ) => { remove: () => void };
};

let nativeModule: NativeModule | null | undefined;
let active = false;
let lastUpdateMs = 0;
let lastSteps = -1;

function getNativeModule(): NativeModule | null {
  if (!FEATURE_FLAGS.ENABLE_STEP_TRACKING_NOTIFICATIONS) return null;
  if (nativeModule !== undefined) return nativeModule;
  nativeModule = null;
  try {
    const { requireOptionalNativeModule } =
      require("expo-modules-core") as typeof import("expo-modules-core");
    nativeModule = requireOptionalNativeModule<NativeModule>("WalkChampRaceProgress");
  } catch (err) {
    if (__DEV__) console.warn("[StepTrackingNotif] native module unavailable", err);
    nativeModule = null;
  }
  return nativeModule;
}

async function toNativePayload(payload: WalkStepNotificationPayload): Promise<Record<string, unknown>> {
  const goal = Math.max(1, payload.dailyGoal);
  const steps = Math.max(0, Math.floor(payload.todaySteps));
  const pct = Math.min(100, Math.round((steps / goal) * 100));
  // Auth token and API base are stored in native SharedPreferences so the FGS
  // background sync loop can POST to /api/walk/steps without the JS runtime being alive.
  const session = await getValidSession();
  return {
    userId: payload.userId,
    todaySteps: steps,
    dailyGoal: goal,
    percentComplete: pct,
    title: "Walk Champ",
    deepLink: "globalwalkerleague://walk",
    stepSource: stepProviderManager.toRaceProgressSource(),
    body: `${steps.toLocaleString("en-US")} total steps today`,
    authToken: session ?? "",
    apiBaseUrl: API_BASE,
  };
}

/** Request POST_NOTIFICATIONS before starting the Android foreground service. */
export async function ensureTrackingNotificationPermission(): Promise<boolean> {
  return ensureAndroidNotificationPermission();
}

async function ensureAndroidNotificationPermission(): Promise<boolean> {
  if (Platform.OS !== "android") return true;
  if (typeof Platform.Version === "number" && Platform.Version < 33) return true;
  try {
    const granted = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
    );
    return granted === PermissionsAndroid.RESULTS.GRANTED;
  } catch {
    return false;
  }
}

function shouldThrottle(steps: number, force = false): boolean {
  if (force) return false;
  const now = Date.now();
  const cfg = STEP_TRACKING_NOTIFICATION_CONFIG;
  if (now - lastUpdateMs < cfg.LOCAL_UPDATE_MS) return true;
  if (Math.abs(steps - lastSteps) < cfg.MIN_STEP_DELTA_FOR_UPDATE) return true;
  return false;
}

function logNotification(msg: string): void {
  console.log(`[Notification] ${msg}`);
}

class StepTrackingNotificationService {
  async start(payload: WalkStepNotificationPayload): Promise<void> {
    logNotification("start requested");
    const native = getNativeModule();
    if (!native) {
      logNotification("native module unavailable");
      return;
    }

    if (Platform.OS === "android") {
      const ok = await ensureAndroidNotificationPermission();
      logNotification(`permissionGranted=${ok}`);
      if (!ok) return;
    }

    active = true;
    lastSteps = -1;
    const nativePayload = await toNativePayload(payload);

    try {
      if (Platform.OS === "android" && native.startWalkStepNotification) {
        await native.startWalkStepNotification(nativePayload);
        logNotification(`serviceStartRequested=true steps=${payload.todaySteps}`);
      }
      if (Platform.OS === "ios" && native.startWalkLiveActivity) {
        await native.startWalkLiveActivity(nativePayload);
        logNotification(`liveActivityStart=true steps=${payload.todaySteps}`);
      }
      lastUpdateMs = Date.now();
      lastSteps = payload.todaySteps;
    } catch (err) {
      logNotification(`start failed: ${String(err)}`);
      if (__DEV__) console.warn("[StepTrackingNotif] start failed", err);
    }
  }

  async update(payload: WalkStepNotificationPayload, force = false): Promise<void> {
    if (!active) {
      await this.start(payload);
      return;
    }
    const native = getNativeModule();
    if (!native) return;
    const steps = Math.max(0, Math.floor(payload.todaySteps));
    if (!force && shouldThrottle(steps, false)) return;

    const nativePayload = await toNativePayload({ ...payload, todaySteps: steps });
    try {
      if (Platform.OS === "android" && native.updateWalkStepNotification) {
        await native.updateWalkStepNotification(nativePayload);
      }
      if (Platform.OS === "ios" && native.updateWalkLiveActivity) {
        await native.updateWalkLiveActivity(nativePayload);
      }
      lastUpdateMs = Date.now();
      lastSteps = steps;
    } catch (err) {
      if (__DEV__) console.warn("[StepTrackingNotif] update failed", err);
    }
  }

  /** Force notification to exactly match the walk screen total (including resets). */
  async mirrorWalkScreen(payload: WalkStepNotificationPayload): Promise<void> {
    await this.update(payload, true);
  }

  async stop(): Promise<void> {
    if (!active) return;
    active = false;
    lastSteps = -1;
    const native = getNativeModule();
    if (!native) return;

    try {
      if (Platform.OS === "android") {
        if (native.stopStepTrackingService) {
          await native.stopStepTrackingService({ reason: "tracking_stopped" });
        } else if (native.stopWalkStepNotification) {
          await native.stopWalkStepNotification();
        }
      }
      if (Platform.OS === "ios" && native.endWalkLiveActivity) {
        await native.endWalkLiveActivity();
      }
    } catch (err) {
      if (__DEV__) console.warn("[StepTrackingNotif] stop failed", err);
    }
  }

  async clearNativeStepStateForUser(userId: string): Promise<void> {
    if (Platform.OS !== "android" || !userId) return;
    const native = getNativeModule();
    if (!native?.clearNativeStepStateForUser) return;
    try {
      await native.clearNativeStepStateForUser(userId);
      if (__DEV__) {
        console.log(`[NativeStepState] cleared userScopedKey=nativeStepState:${userId}`);
      }
    } catch (err) {
      if (__DEV__) console.warn("[StepTrackingNotif] clearNativeStepStateForUser failed", err);
    }
  }

  async flushRaceSyncOutbox(): Promise<void> {
    if (Platform.OS !== "android") return;
    const native = getNativeModule();
    if (!native?.flushRaceSyncOutbox) return;
    try {
      await native.flushRaceSyncOutbox();
    } catch (err) {
      if (__DEV__) console.warn("[StepTrackingNotif] flushRaceSyncOutbox failed", err);
    }
  }

  async resetDailyStepsForNewDay(): Promise<void> {
    if (Platform.OS !== "android") return;
    const native = getNativeModule();
    if (!native?.resetDailyStepsForNewDay) return;
    try {
      await native.resetDailyStepsForNewDay();
      if (__DEV__) console.log("[StepFGS] resetDailyStepsForNewDay completed");
    } catch (err) {
      if (__DEV__) console.warn("[StepTrackingNotif] resetDailyStepsForNewDay failed", err);
    }
  }

  isActive(): boolean {
    return active;
  }

  /**
   * Full native step state from the foreground service / sensor engine.
   */
  async getNativeStepState(): Promise<NativeWalkStepState | null> {
    if (Platform.OS !== "android") return null;
    const native = getNativeModule();
    if (!native) return null;
    try {
      const reader = native.getNativeStepState ?? native.getNativeWalkStepState;
      if (!reader) return null;
      const state = await reader();
      if (!state || typeof state.todaySteps !== "number") return null;
      if (__DEV__) {
        console.log(
          `[AppResume] getNativeStepState todaySteps=${state.todaySteps} raceSteps=${state.raceSteps ?? 0} source=${state.stepSource}`,
        );
      }
      return state;
    } catch {
      return null;
    }
  }

  /**
   * Return the last daily step count that was pushed to the native notification /
   * Live Activity, or null if unavailable.
   *
   * Priority:
   *  1. In-memory `lastSteps` — set on every start/update, most current while JS is alive.
   *  2. Native sensor engine state via `getNativeStepState` — survives JS restarts / cold launch.
   */
  async getNativeWalkSteps(): Promise<number | null> {
    if (lastSteps >= 0) return lastSteps;

    const state = await this.getNativeStepState();
    if (!state) return null;
    const walkActive = state.walkActive ?? state.notificationMode === "daily_steps";
    if (!walkActive && (state.todaySteps ?? 0) <= 0) return null;
    return state.todaySteps > 0 ? state.todaySteps : null;
  }

  subscribeNativeStepUpdates(
    handler: (state: NativeWalkStepState) => void,
  ): (() => void) | null {
    const native = getNativeModule();
    if (!native?.addListener) return null;
    const sub = native.addListener("WalkChampStepStateUpdated", handler);
    return () => sub.remove();
  }
}

export const stepTrackingNotificationService = new StepTrackingNotificationService();
