/**
 * iOS HealthKit step provider — wraps StepTrackingService (unchanged iOS logic).
 */

import { Platform } from "react-native";
import { stepTracker } from "@/services/StepTrackingService";
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
    providerId: "ios_healthkit",
    verificationLevel: "verified",
    source: "ios_healthkit",
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

export const iosHealthKitProvider: StepProvider = {
  providerId: "ios_healthkit",
  verificationLevel: "verified",

  async isAvailable(): Promise<boolean> {
    if (Platform.OS !== "ios") return false;
    return stepTracker.isAvailable();
  },

  async getPermissionStatus(): Promise<StepPermissionState> {
    if (Platform.OS !== "ios") return "unavailable";
    return stepTracker.getPermissionStatus();
  },

  async requestPermission(): Promise<StepPermissionResult> {
    const status = await stepTracker.requestPermission();
    return {
      status,
      providerId: status === "granted" ? "ios_healthkit" : null,
    };
  },

  async getTodaySteps(): Promise<StepReadResult> {
    const from = todayMidnight();
    const to = new Date();
    const data = await stepTracker.getStepsForTimeRange(from, to);
    if (!data) return emptyStepResult("ios_healthkit", "verified", from, to);
    return buildResult(data.steps, from, to);
  },

  async getStepsForRange(start: Date, end: Date): Promise<StepReadResult> {
    const data = await stepTracker.getStepsForTimeRange(start, end);
    if (!data) return emptyStepResult("ios_healthkit", "verified", start, end);
    return buildResult(data.steps, start, end);
  },

  async getRaceSteps(
    _raceId: string,
    raceStartAt: Date,
    _userId: string,
    raceEndAt?: Date,
  ): Promise<StepReadResult> {
    const endMs = raceEndAt
      ? Math.min(Date.now(), raceEndAt.getTime())
      : Date.now();
    const to = new Date(endMs);
    if (to.getTime() <= raceStartAt.getTime()) {
      return emptyStepResult("ios_healthkit", "verified", raceStartAt, to);
    }
    return this.getStepsForRange(raceStartAt, to);
  },

  async startWatchingSteps(
    callback: (result: StepReadResult) => void,
  ): Promise<() => void> {
    stepTracker.startLiveTracking((data) => {
      const now = new Date();
      callback(buildResult(data.steps, now, now));
    });
    return () => stepTracker.stopLiveTracking();
  },

  stopWatchingSteps(): void {
    stepTracker.stopLiveTracking();
  },

  async createRaceBaseline(_raceId: string, _userId: string): Promise<number> {
    return 0;
  },
};
