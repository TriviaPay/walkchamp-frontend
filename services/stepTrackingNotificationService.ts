import { PermissionsAndroid, Platform, AppState } from "react-native";
import { requireOptionalExpoNativeModule } from "@/utils/expoNativeModule";
import Constants from "expo-constants";
import { FEATURE_FLAGS } from "@/config/featureFlags";
import { STEP_TRACKING_NOTIFICATION_CONFIG } from "@/config/stepTrackingNotificationConfig";
import { STEP_SYNC_CONFIG } from "@/config/stepSyncConfig";
import { isJsAuthoritativeStepSession } from "@/services/steps/jsStepOwnership";
import { getValidSession } from "@/services/authService";
import {
  getNotificationPermissionStatus,
} from "@/services/permissions/notificationPermissionService";
import { formatWalkOngoingNotificationBody } from "@/services/permissions/androidNotificationAccess";
import { hasOngoingNotificationAccess } from "@/services/permissions/notificationGate";

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
  dailyBaseline?: number;
  raceBaseline?: number;
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

let nativeModule: NativeModule | null = null;
let nativeModuleResolved = false;
let active = false;
let lastUpdateMs = 0;
let lastSteps = -1;
let lastPermissionDeniedMessageAt = 0;

function resolveNativeModule(): NativeModule | null {
  try {
    const direct = requireOptionalExpoNativeModule<NativeModule>(
      "WalkChampRaceProgress",
    );
    if (direct) return direct;

    try {
      const fromPackage = require("walkchamp-race-progress") as NativeModule;
      if (fromPackage) return fromPackage;
    } catch {
      // package entry unavailable in this runtime
    }

    const expoKeys = Object.keys(
      (globalThis as { expo?: { modules?: Record<string, unknown> } }).expo?.modules ?? {},
    );
    logOngoing(
      `native module WalkChampRaceProgress unavailable (expo.modules keys=${expoKeys.length})`,
    );
    return null;
  } catch (err) {
    logOngoing(`native module load failed: ${String(err)}`);
    return null;
  }
}

function getNativeModule(forceRefresh = false): NativeModule | null {
  if (!FEATURE_FLAGS.ENABLE_STEP_TRACKING_NOTIFICATIONS) return null;
  if (nativeModuleResolved && !forceRefresh) return nativeModule;
  // resolveNativeModule / requireOptionalExpoNativeModule already gate on startup ready.
  // Do not cache null — otherwise a cold-start miss permanently disables FGS updates.
  nativeModule = resolveNativeModule();
  if (nativeModule != null) {
    nativeModuleResolved = true;
  }
  return nativeModule;
}

function getPackageName(): string {
  return (
    Constants.expoConfig?.android?.package ??
    Constants.manifest2?.extra?.expoClient?.android?.package ??
    "unknown"
  );
}

async function getActivityRecognitionGranted(): Promise<boolean | "n/a"> {
  if (Platform.OS !== "android") return "n/a";
  try {
    if (!PermissionsAndroid.PERMISSIONS.ACTIVITY_RECOGNITION) return "n/a";
    return await PermissionsAndroid.check(
      PermissionsAndroid.PERMISSIONS.ACTIVITY_RECOGNITION,
    );
  } catch {
    return false;
  }
}

function logOngoing(msg: string): void {
  if (__DEV__) {
    console.log(`[OngoingNotification] ${msg}`);
  }
}

async function logOngoingDiagnostics(phase: string): Promise<void> {
  if (Platform.OS !== "android") return;
  const notif = await getNotificationPermissionStatus();
  const activity = await getActivityRecognitionGranted();
  logOngoing(
    `${phase} buildType=${__DEV__ ? "debug" : "release"} packageName=${getPackageName()} platformVersion=${Platform.Version} notificationPermission=${notif} activityRecognitionPermission=${activity}`,
  );
}

async function toNativePayload(payload: WalkStepNotificationPayload): Promise<Record<string, unknown>> {
  const goal = Math.max(1, payload.dailyGoal);
  const steps = Math.max(0, Math.floor(payload.todaySteps));
  const pct = Math.min(100, Math.round((steps / goal) * 100));
  const session = await getValidSession();
  return {
    userId: payload.userId,
    todaySteps: steps,
    dailyGoal: goal,
    percentComplete: pct,
    title: "Walk Champ",
    deepLink: "globalwalkerleague://walk",
    stepSource: stepProviderManager.toRaceProgressSource(),
    body: formatWalkOngoingNotificationBody(steps),
    authToken: session ?? "",
    apiBaseUrl: API_BASE,
  };
}

/** Check-only — never shows a system prompt. */
export async function ensureTrackingNotificationPermission(): Promise<boolean> {
  return hasOngoingNotificationAccess();
}

/** User-visible message when notification permission blocks the ongoing notification. */
export function getOngoingNotificationDeniedMessage(): string {
  return "Notifications are disabled. Please enable notifications in Settings to show ongoing step tracking.";
}

export function shouldShowOngoingNotificationDeniedMessage(): boolean {
  const now = Date.now();
  if (now - lastPermissionDeniedMessageAt < 30_000) return false;
  lastPermissionDeniedMessageAt = now;
  return true;
}

function shouldThrottle(steps: number, force = false): boolean {
  if (force) return false;
  const now = Date.now();
  const cfg = STEP_TRACKING_NOTIFICATION_CONFIG;
  if (now - lastUpdateMs < cfg.LOCAL_UPDATE_MS) return true;
  if (Math.abs(steps - lastSteps) < cfg.MIN_STEP_DELTA_FOR_UPDATE) return true;
  return false;
}

class StepTrackingNotificationService {
  async start(payload: WalkStepNotificationPayload): Promise<boolean> {
    logOngoing("start requested");
    await logOngoingDiagnostics("start");

    const native = getNativeModule(true);
    if (!native) {
      logOngoing("abort native module unavailable");
      return false;
    }

    if (Platform.OS === "android") {
      logOngoing("channelEnsure requested");
      const granted = await hasOngoingNotificationAccess();
      logOngoing(`notificationPermission result granted=${granted}`);
      if (!granted) {
        logOngoing("abort app notifications disabled — foreground service not started");
        return false;
      }
    }

    active = true;
    lastSteps = -1;
    const nativePayload = await toNativePayload(payload);

    try {
      if (Platform.OS === "android" && native.startWalkStepNotification) {
        logOngoing("foregroundServiceStart requested");
        await native.startWalkStepNotification(nativePayload);
        logOngoing(`foregroundServiceStart complete steps=${payload.todaySteps}`);
      }
      if (Platform.OS === "ios" && native.startWalkLiveActivity) {
        await native.startWalkLiveActivity(nativePayload);
        logOngoing(`liveActivityStart=true steps=${payload.todaySteps}`);
      }
      lastUpdateMs = Date.now();
      lastSteps = payload.todaySteps;
      return true;
    } catch (err) {
      logOngoing(`start failed error=${String(err)}`);
      console.warn("[StepTrackingNotif] start failed", err);
      return false;
    }
  }

  async update(payload: WalkStepNotificationPayload, force = false): Promise<void> {
    if (!active) {
      await this.start(payload);
      return;
    }
    const native = getNativeModule();
    if (!native) return;
    let steps = Math.max(0, Math.floor(payload.todaySteps));
    if (Platform.OS === "android") {
      try {
        // While JS owns the session (foreground watch/race poll), notification follows
        // Redux/JS — do not keep a higher FGS-only total locked on the tray.
        const jsOwns =
          AppState.currentState === "active" && isJsAuthoritativeStepSession();
        if (!jsOwns) {
          const native = await this.getNativeStepState(payload.userId);
          const today = new Date();
          const localDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
          const nativeStale = !!(native?.localDate && native.localDate !== localDate);
          if (
            !nativeStale &&
            native?.todaySteps != null &&
            steps < native.todaySteps
          ) {
            logOngoing(
              `skippedReason=belowNative incoming=${steps} native=${native.todaySteps}`,
            );
            return;
          }
        }
      } catch {
        // proceed with incoming steps
      }
    }
    if (lastSteps >= 0 && steps < lastSteps) {
      logOngoing(
        `skippedReason=regression incoming=${steps} last=${lastSteps}`,
      );
      return;
    }
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
      if (STEP_SYNC_CONFIG.STEP_DEBUG_VERBOSE) {
        logOngoing(`notifyUpdated id=91002 steps=${steps}`);
      }
    } catch (err) {
      logOngoing(`update failed error=${String(err)}`);
      if (__DEV__) console.warn("[StepTrackingNotif] update failed", err);
    }
  }

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
    } catch (err) {
      if (__DEV__) console.warn("[StepTrackingNotif] resetDailyStepsForNewDay failed", err);
    }
  }

  isActive(): boolean {
    return active;
  }

  async getNativeStepState(expectedUserId?: string | null): Promise<NativeWalkStepState | null> {
    if (Platform.OS !== "android") return null;
    const native = getNativeModule();
    if (!native) return null;
    try {
      const reader = native.getNativeStepState ?? native.getNativeWalkStepState;
      if (!reader) return null;
      const state = await reader();
      if (!state || typeof state.todaySteps !== "number") return null;
      if (
        expectedUserId &&
        state.userId &&
        state.userId !== expectedUserId
      ) {
        if (__DEV__) {
          console.log(
            `[OngoingNotification] ignored native state — user mismatch native=${state.userId} expected=${expectedUserId}`,
          );
        }
        return null;
      }
      return state;
    } catch {
      return null;
    }
  }

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
    const sub = native.addListener("WalkChampStepStateUpdated", (state: NativeWalkStepState) => {
      try {
        const { stepAudit } = require("@/utils/stepAudit") as typeof import("@/utils/stepAudit");
        stepAudit.noteSensorTick({
          providerId: "android_legacy_sensor",
          calculatedDailySteps: state?.todaySteps ?? null,
          calculatedRaceSteps: state?.raceSteps ?? null,
          rawSensorTotal:
            typeof state?.sensorTotal === "number" ? state.sensorTotal : null,
          dailyBaseline:
            typeof state?.dailyBaseline === "number" ? state.dailyBaseline : null,
          raceBaseline:
            typeof state?.raceBaseline === "number" ? state.raceBaseline : null,
          raceId: state?.activeRaceId ?? null,
          eventOrigin: "fgs",
        });
      } catch {
        /* optional */
      }
      handler(state);
    });
    return () => sub.remove();
  }

  subscribeWalkStepRefreshRequests(handler: () => void): (() => void) | null {
    const native = getNativeModule();
    if (!native?.addListener) return null;
    const sub = native.addListener("WalkChampWalkStepRefreshRequested", handler);
    return () => sub.remove();
  }
}

export const stepTrackingNotificationService = new StepTrackingNotificationService();
