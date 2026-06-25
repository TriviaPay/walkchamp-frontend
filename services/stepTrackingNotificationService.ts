import { PermissionsAndroid, Platform } from "react-native";
import { FEATURE_FLAGS } from "@/config/featureFlags";
import { STEP_TRACKING_NOTIFICATION_CONFIG } from "@/config/stepTrackingNotificationConfig";

export type WalkStepNotificationPayload = {
  userId: string;
  todaySteps: number;
  dailyGoal: number;
};

type NativeModule = {
  startWalkStepNotification: (payload: Record<string, unknown>) => Promise<void>;
  updateWalkStepNotification: (payload: Record<string, unknown>) => Promise<void>;
  stopWalkStepNotification: () => Promise<void>;
  startWalkLiveActivity: (payload: Record<string, unknown>) => Promise<void>;
  updateWalkLiveActivity: (payload: Record<string, unknown>) => Promise<void>;
  endWalkLiveActivity: () => Promise<void>;
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

function toNativePayload(payload: WalkStepNotificationPayload): Record<string, unknown> {
  const goal = Math.max(1, payload.dailyGoal);
  const pct = Math.min(100, Math.round((payload.todaySteps / goal) * 100));
  return {
    userId: payload.userId,
    todaySteps: payload.todaySteps,
    dailyGoal: goal,
    percentComplete: pct,
    title: "Walk Champ",
    deepLink: "globalwalkerleague://walk",
  };
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

class StepTrackingNotificationService {
  async start(payload: WalkStepNotificationPayload): Promise<void> {
    const native = getNativeModule();
    if (!native) return;

    if (Platform.OS === "android") {
      const ok = await ensureAndroidNotificationPermission();
      if (!ok) return;
    }

    active = true;
    lastSteps = -1;
    const nativePayload = toNativePayload(payload);

    try {
      if (Platform.OS === "android" && native.startWalkStepNotification) {
        await native.startWalkStepNotification(nativePayload);
      }
      if (Platform.OS === "ios" && native.startWalkLiveActivity) {
        await native.startWalkLiveActivity(nativePayload);
      }
      lastUpdateMs = Date.now();
      lastSteps = payload.todaySteps;
    } catch (err) {
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
    if (shouldThrottle(payload.todaySteps, force)) return;

    const nativePayload = toNativePayload(payload);
    try {
      if (Platform.OS === "android" && native.updateWalkStepNotification) {
        await native.updateWalkStepNotification(nativePayload);
      }
      if (Platform.OS === "ios" && native.updateWalkLiveActivity) {
        await native.updateWalkLiveActivity(nativePayload);
      }
      lastUpdateMs = Date.now();
      lastSteps = payload.todaySteps;
    } catch (err) {
      if (__DEV__) console.warn("[StepTrackingNotif] update failed", err);
    }
  }

  async stop(): Promise<void> {
    if (!active) return;
    active = false;
    lastSteps = -1;
    const native = getNativeModule();
    if (!native) return;

    try {
      if (Platform.OS === "android" && native.stopWalkStepNotification) {
        await native.stopWalkStepNotification();
      }
      if (Platform.OS === "ios" && native.endWalkLiveActivity) {
        await native.endWalkLiveActivity();
      }
    } catch (err) {
      if (__DEV__) console.warn("[StepTrackingNotif] stop failed", err);
    }
  }

  isActive(): boolean {
    return active;
  }
}

export const stepTrackingNotificationService = new StepTrackingNotificationService();
