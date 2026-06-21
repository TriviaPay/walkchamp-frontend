/**
 * Android legacy sensor provider — TYPE_STEP_COUNTER via expo-sensors Pedometer.
 * Delta-based watchStepCount with daily + race baselines in AsyncStorage.
 */

import { Platform } from "react-native";
import { storageGet, storageSet } from "@/utils/storage";
import { isExpoGo } from "../androidHealthConnectService";
import {
  clearRaceBaseline,
  getRaceBaseline,
  setRaceBaseline,
} from "../raceBaselineStorage";
import {
  emptyStepResult,
  getLocalDateKey,
  getUserTimezone,
  type StepPermissionResult,
  type StepPermissionState,
  type StepProvider,
  type StepReadResult,
} from "../stepProviderTypes";

type PedometerSub = { remove: () => void };
type PedometerAPI = {
  isAvailableAsync: () => Promise<boolean>;
  getPermissionsAsync: () => Promise<{ status: string }>;
  requestPermissionsAsync: () => Promise<{ status: string }>;
  watchStepCount: (cb: (r: { steps: number }) => void) => PedometerSub;
};

const DAILY_BASELINE_KEY = "legacy_sensor_daily_baseline";
const DAILY_BASELINE_DATE_KEY = "legacy_sensor_daily_date";
const DAILY_TODAY_KEY = "legacy_sensor_today_steps";
const RAW_COUNTER_AT_SUB_KEY = "legacy_sensor_raw_at_sub";

let _ped: PedometerAPI | null | undefined;
function loadPedometer(): PedometerAPI | null {
  if (_ped !== undefined) return _ped;
  try {
    const m = require("expo-sensors") as { Pedometer?: PedometerAPI };
    _ped = m.Pedometer ?? null;
  } catch {
    _ped = null;
  }
  return _ped;
}

let _sub: PedometerSub | null = null;
let _dailyBaseline = 0;
let _todaySteps = 0;
let _watchCallback: ((result: StepReadResult) => void) | null = null;
let _rawAtSubscription = 0;

function buildResult(steps: number, from: Date, to: Date): StepReadResult {
  return {
    steps: Math.max(0, steps),
    providerId: "android_legacy_sensor",
    verificationLevel: "legacy",
    source: "android_legacy_sensor",
    from: from.toISOString(),
    to: to.toISOString(),
    localDate: getLocalDateKey(from),
    timezone: getUserTimezone(),
    distanceMeters: Math.round(steps * 0.762),
    caloriesBurned: Math.round(steps * 0.04),
    activeMinutes: Math.ceil(steps / 120),
  };
}

async function loadDailyState(): Promise<void> {
  const today = getLocalDateKey();
  const storedDate = await storageGet<string>(DAILY_BASELINE_DATE_KEY as never);
  const storedBaseline =
    (await storageGet<number>(DAILY_BASELINE_KEY as never)) ?? 0;
  const storedToday = (await storageGet<number>(DAILY_TODAY_KEY as never)) ?? 0;

  if (storedDate === today) {
    _dailyBaseline = storedBaseline;
    _todaySteps = storedToday;
  } else {
    _dailyBaseline = 0;
    _todaySteps = 0;
    await storageSet(DAILY_BASELINE_DATE_KEY as never, today);
    await storageSet(DAILY_BASELINE_KEY as never, 0);
    await storageSet(DAILY_TODAY_KEY as never, 0);
  }
}

async function persistDaily(steps: number): Promise<void> {
  const today = getLocalDateKey();
  _todaySteps = steps;
  await storageSet(DAILY_BASELINE_DATE_KEY as never, today);
  await storageSet(DAILY_TODAY_KEY as never, steps);
}

function ensureSubscription(): boolean {
  if (_sub) return true;
  const ped = loadPedometer();
  if (!ped) return false;

  _sub = ped.watchStepCount((result) => {
    const todayTotal = Math.max(_todaySteps, _dailyBaseline + result.steps);
    void persistDaily(todayTotal);
    if (__DEV__ && result.steps > 0) {
      console.log(
        `[StepProvider] legacy sensor delta=${result.steps} today=${todayTotal}`,
      );
    }
    if (_watchCallback) {
      const now = new Date();
      _watchCallback(buildResult(todayTotal, now, now));
    }
  });
  return true;
}

export const androidLegacySensorProvider: StepProvider = {
  providerId: "android_legacy_sensor",
  verificationLevel: "legacy",

  async isAvailable(): Promise<boolean> {
    if (Platform.OS !== "android" || isExpoGo()) return false;
    const ped = loadPedometer();
    if (!ped) return false;
    try {
      return await ped.isAvailableAsync();
    } catch {
      return false;
    }
  },

  async getPermissionStatus(): Promise<StepPermissionState> {
    if (Platform.OS !== "android" || isExpoGo()) return "unavailable";
    const ped = loadPedometer();
    if (!ped) return "unavailable";
    try {
      const { status } = await ped.getPermissionsAsync();
      if (status === "granted") return "granted";
      if (status === "denied") return "denied";
      return "unknown";
    } catch {
      return "unknown";
    }
  },

  async requestPermission(): Promise<StepPermissionResult> {
    if (Platform.OS !== "android" || isExpoGo()) {
      return { status: "unavailable", providerId: null };
    }
    const ped = loadPedometer();
    if (!ped) return { status: "unavailable", providerId: null };
    try {
      const available = await ped.isAvailableAsync();
      if (!available) return { status: "unavailable", providerId: null };

      const { InteractionManager, AppState } =
        require("react-native") as typeof import("react-native");
      await new Promise<void>((resolve) => {
        InteractionManager.runAfterInteractions(() => resolve());
      });
      if (AppState.currentState !== "active") {
        await new Promise((r) => setTimeout(r, 300));
      }

      const { status: before } = await ped.getPermissionsAsync();
      if (before === "granted") {
        return { status: "granted", providerId: "android_legacy_sensor" };
      }
      const { status: after } = await ped.requestPermissionsAsync();
      const granted = after === "granted";
      return {
        status: granted ? "granted" : "denied",
        providerId: granted ? "android_legacy_sensor" : null,
        message: granted ? "Step tracking is ready." : undefined,
      };
    } catch (e) {
      if (__DEV__) console.log("[StepProvider] legacy requestPermission error", e);
      return { status: "unavailable", providerId: null };
    }
  },

  async getTodaySteps(): Promise<StepReadResult> {
    const from = new Date();
    from.setHours(0, 0, 0, 0);
    const to = new Date();
    await loadDailyState();

    const perm = await this.getPermissionStatus();
    if (perm === "granted") {
      ensureSubscription();
    }

    return buildResult(_todaySteps, from, to);
  },

  async getStepsForRange(start: Date, end: Date): Promise<StepReadResult> {
    const today = await this.getTodaySteps();
    return buildResult(today.steps, start, end);
  },

  async getRaceSteps(
    raceId: string,
    raceStartAt: Date,
    userId: string,
  ): Promise<StepReadResult> {
    const to = new Date();
    const baseline = await getRaceBaseline(
      raceId,
      userId,
      "android_legacy_sensor",
    );
    if (baseline === null) {
      return emptyStepResult("android_legacy_sensor", "legacy", raceStartAt, to);
    }
    const today = await this.getTodaySteps();
    const raceSteps = Math.max(0, today.steps - baseline);
    if (__DEV__) {
      console.log(
        `[RaceSteps] race steps calculated ${raceSteps} (today=${today.steps} baseline=${baseline})`,
      );
    }
    return buildResult(raceSteps, raceStartAt, to);
  },

  async createRaceBaseline(raceId: string, userId: string): Promise<number> {
    const today = await this.getTodaySteps();
    await setRaceBaseline(
      raceId,
      userId,
      "android_legacy_sensor",
      today.steps,
    );
    return today.steps;
  },

  async clearRaceBaseline(raceId: string, userId: string): Promise<void> {
    await clearRaceBaseline(raceId, userId, "android_legacy_sensor");
  },

  async startWatchingSteps(
    callback: (result: StepReadResult) => void,
  ): Promise<() => void> {
    await loadDailyState();
    const perm = await this.getPermissionStatus();
    if (perm !== "granted") {
      const req = await this.requestPermission();
      if (req.status !== "granted") return () => {};
    }

    _watchCallback = callback;
    _rawAtSubscription = _todaySteps;
    await storageSet(RAW_COUNTER_AT_SUB_KEY as never, _rawAtSubscription);
    ensureSubscription();

    return () => {
      _watchCallback = null;
      if (_sub) {
        try {
          _sub.remove();
        } catch {}
        _sub = null;
      }
      void storageSet(DAILY_BASELINE_KEY as never, _todaySteps);
    };
  },

  stopWatchingSteps(): void {
    _watchCallback = null;
    if (_sub) {
      try {
        _sub.remove();
      } catch {}
      _sub = null;
    }
  },
};
