/**
 * Android Health Connect step provider — wraps androidHealthConnectService.
 */

import { Platform } from "react-native";
import { androidHCService } from "../androidHealthConnectService";
import {
  emptyStepResult,
  getLocalDateKey,
  getUserTimezone,
  type StepPermissionResult,
  type StepPermissionState,
  type StepProvider,
  type StepReadResult,
} from "../stepProviderTypes";

function todayMidnight(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function buildResult(
  steps: number,
  from: Date,
  to: Date,
  extras?: Partial<StepReadResult>,
): StepReadResult {
  return {
    steps: Math.max(0, steps),
    providerId: "android_health_connect",
    verificationLevel: "verified",
    source: "android_health_connect",
    from: from.toISOString(),
    to: to.toISOString(),
    localDate: getLocalDateKey(from),
    timezone: getUserTimezone(),
    distanceMeters: Math.round(steps * 0.762),
    caloriesBurned: Math.round(steps * 0.04),
    activeMinutes: Math.ceil(steps / 120),
    ...extras,
  };
}

export const androidHealthConnectProvider: StepProvider = {
  providerId: "android_health_connect",
  verificationLevel: "verified",

  async isAvailable(): Promise<boolean> {
    if (Platform.OS !== "android") return false;
    try {
      const init = await androidHCService.initialize();
      return (
        init.initialized &&
        init.availability === "available" &&
        !androidHCService.isRangeReadBlocked()
      );
    } catch (e) {
      if (__DEV__) console.log("[StepProvider] Health Connect isAvailable error", e);
      return false;
    }
  },

  async getPermissionStatus(): Promise<StepPermissionState> {
    if (Platform.OS !== "android") return "unavailable";
    try {
      return androidHCService.getPermissionStatus();
    } catch {
      return "unavailable";
    }
  },

  async requestPermission(): Promise<StepPermissionResult> {
    try {
      await androidHCService.initialize();
      const status = await androidHCService.requestPermission();
      return {
        status,
        providerId: status === "granted" ? "android_health_connect" : null,
      };
    } catch (e) {
      if (__DEV__) console.log("[StepProvider] Health Connect requestPermission error", e);
      return { status: "unavailable", providerId: null };
    }
  },

  async getTodaySteps(): Promise<StepReadResult> {
    const from = todayMidnight();
    const to = new Date();
    try {
      const data = await androidHCService.readTodaySteps();
      return buildResult(data.steps, from, to, {
        distanceMeters: data.distanceMeters,
        caloriesBurned: data.caloriesBurned,
        activeMinutes: data.activeMinutes,
      });
    } catch (e) {
      if (__DEV__) console.log("[StepProvider] Health Connect getTodaySteps error", e);
      return emptyStepResult("android_health_connect", "verified", from, to);
    }
  },

  async getStepsForRange(start: Date, end: Date): Promise<StepReadResult> {
    try {
      const data = await androidHCService.readStepsForRange(start, end);
      return buildResult(data.steps, start, end, {
        distanceMeters: data.distanceMeters,
        caloriesBurned: data.caloriesBurned,
        activeMinutes: data.activeMinutes,
      });
    } catch (e) {
      if (__DEV__) console.log("[StepProvider] Health Connect getStepsForRange error", e);
      return emptyStepResult("android_health_connect", "verified", start, end);
    }
  },

  async getRaceSteps(
    _raceId: string,
    raceStartAt: Date,
    _userId: string,
  ): Promise<StepReadResult> {
    return this.getStepsForRange(raceStartAt, new Date());
  },

  async createRaceBaseline(_raceId: string, _userId: string): Promise<number> {
    return androidHCService.getCachedTodaySteps();
  },
};
