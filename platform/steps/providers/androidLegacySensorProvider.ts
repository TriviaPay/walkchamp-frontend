/**
 * Android legacy sensor provider — TYPE_STEP_COUNTER via expo-sensors Pedometer.
 * Delta-based watchStepCount with daily + race baselines in AsyncStorage.
 */

import { Platform } from "react-native";
import { STEP_SYNC_CONFIG } from "@/config/stepSyncConfig";
import { storageGet, storageRemove, storageSet } from "@/utils/storage";
import { stepScopedKeys } from "@/utils/stepScopedStorage";
import { stepAudit } from "@/utils/stepAudit";
import { isExpoGo } from "../androidHealthConnectService";
import {
  clearRaceBaseline,
  getRaceBaseline,
  setRaceBaseline,
  getRaceStepSeed,
  setRaceStepSeed,
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
let _userId: string | null = null;
let _watchStartedAtMs = 0;
let _ignoredInitialPhantom = false;
/** Pedometer session steps already discarded as subscribe phantom (cumulative offset). */
let _watchSessionFloor = 0;
let _loadedDailyKey: string | null = null;
/** Calendar day the in-memory counters belong to — prevents carrying yesterday into today. */
let _boundLocalDate: string | null = null;

function activeUserId(): string | null {
  return _userId;
}

function requireBoundUser(): boolean {
  if (_userId) return true;
  if (__DEV__) {
    console.log("[StepProvider] legacy sensor skipped — no signed-in user");
  }
  return false;
}

function scoped(localDate = getLocalDateKey()) {
  const userId = activeUserId();
  if (!userId) {
    throw new Error("legacy_sensor_unbound");
  }
  return stepScopedKeys(userId, localDate);
}

/**
 * If the local calendar day changed, zero daily counters so midnight never
 * carries yesterday's total into today's storage key.
 * @returns true when a rollover happened
 */
function rollLocalDayIfNeeded(watchFloorHint?: number): boolean {
  if (!requireBoundUser()) return false;
  const today = getLocalDateKey();
  if (_boundLocalDate === today) return false;

  const rolled = _boundLocalDate != null && _boundLocalDate !== today;
  _boundLocalDate = today;
  _loadedDailyKey = `${_userId}:${today}`;

  if (!rolled) {
    // First bind for this process/day — loadDailyState fills from storage.
    return false;
  }

  _dailyBaseline = 0;
  _todaySteps = 0;
  _rawAtSubscription = 0;
  _watchSessionFloor =
    typeof watchFloorHint === "number" && watchFloorHint > 0 ? watchFloorHint : 0;
  _ignoredInitialPhantom = false;
  _watchStartedAtMs = Date.now();
  const keys = scoped(today);
  void storageSet(keys.currentLocalDate, today);
  void storageSet(keys.baseline, 0);
  void storageSet(keys.steps, 0);
  void storageSet(keys.stepSnapshot, 0);
  if (__DEV__) {
    console.log(
      `[StepProvider] local midnight rollover — todaySteps reset to 0 date=${today}`,
    );
  }
  return true;
}

export function isAndroidLegacySensorUserBound(): boolean {
  return _userId != null;
}

/** Remove polluted pre-login storage from earlier sessions. */
export async function clearSignedOutLegacySensorState(): Promise<void> {
  const today = getLocalDateKey();
  const keys = stepScopedKeys("signed-out", today);
  await Promise.all([
    storageRemove(keys.baseline),
    storageRemove(keys.steps),
    storageRemove(keys.stepSnapshot),
    storageRemove(keys.currentLocalDate),
  ]);
}

export function setAndroidLegacySensorUserContext(userId: string | null): void {
  if (_userId === userId) return;
  if (__DEV__) {
    console.log(`[AuthSwitch] legacy sensor user old=${_userId ?? "none"} new=${userId ?? "none"}`);
  }
  _userId = userId;
  _dailyBaseline = 0;
  _todaySteps = 0;
  _rawAtSubscription = 0;
  if (_sub) {
    try {
      _sub.remove();
    } catch {}
    _sub = null;
  }
}

export async function clearAndroidLegacySensorScopedState(userId: string): Promise<void> {
  const today = getLocalDateKey();
  const keys = stepScopedKeys(userId, today);
  await Promise.all([
    storageRemove(keys.baseline),
    storageRemove(keys.steps),
    storageRemove(keys.stepSnapshot),
    storageRemove(keys.currentLocalDate),
    storageRemove(DAILY_BASELINE_KEY as never),
    storageRemove(DAILY_BASELINE_DATE_KEY as never),
    storageRemove(DAILY_TODAY_KEY as never),
    storageRemove(RAW_COUNTER_AT_SUB_KEY as never),
  ]);
  if (_userId === userId) {
    setAndroidLegacySensorUserContext(null);
  }
}

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
  if (!requireBoundUser()) {
    _dailyBaseline = 0;
    _todaySteps = 0;
    return;
  }
  const today = getLocalDateKey();
  const keys = scoped(today);
  const dayKey = `${_userId}:${today}`;
  const firstLoadToday = _loadedDailyKey !== dayKey;
  rollLocalDayIfNeeded();
  _loadedDailyKey = dayKey;
  const storedDate = await storageGet<string>(keys.currentLocalDate);
  const storedBaseline =
    (await storageGet<number>(keys.baseline)) ?? 0;
  const storedToday = (await storageGet<number>(keys.steps)) ?? 0;

  if (storedDate === today) {
    _todaySteps = Math.max(_todaySteps, Math.max(0, storedToday));
    _dailyBaseline = storedBaseline;
    _boundLocalDate = today;
    if (__DEV__ && STEP_SYNC_CONFIG.STEP_DEBUG_VERBOSE && firstLoadToday) {
      console.log(
        `[StepBaseline] loaded existing baseline userId=${_userId} localDate=${today} baseline=${storedBaseline}`,
      );
    }
  } else {
    _dailyBaseline = 0;
    _todaySteps = 0;
    _boundLocalDate = today;
    await storageSet(keys.currentLocalDate, today);
    await storageSet(keys.baseline, 0);
    await storageSet(keys.steps, 0);
    if (__DEV__ && STEP_SYNC_CONFIG.STEP_DEBUG_VERBOSE) {
      console.log(
        `[StepBaseline] created new baseline userId=${_userId} localDate=${today} baseline=0`,
      );
    }
  }
}

async function persistDaily(steps: number): Promise<void> {
  if (!requireBoundUser()) return;
  rollLocalDayIfNeeded();
  const today = getLocalDateKey();
  const keys = scoped(today);
  _todaySteps = Math.max(0, Math.floor(steps));
  await storageSet(keys.currentLocalDate, today);
  await storageSet(keys.steps, _todaySteps);
}

function alignDailyBaselineForWatch(): void {
  if (!requireBoundUser()) return;
  const keys = scoped();
  _dailyBaseline = _todaySteps;
  void storageSet(keys.baseline, _dailyBaseline);
  if (__DEV__ && STEP_SYNC_CONFIG.STEP_DEBUG_VERBOSE) {
    console.log(
      `[StepBaseline] userId=${_userId} localDate=${getLocalDateKey()} baseline=${_dailyBaseline}`,
    );
  }
}

function ensureSubscription(): boolean {
  if (_sub) return true;
  const ped = loadPedometer();
  if (!ped) return false;

  alignDailyBaselineForWatch();
  _watchStartedAtMs = Date.now();
  _ignoredInitialPhantom = false;
  _watchSessionFloor = 0;

  _sub = ped.watchStepCount((result) => {
    if (!requireBoundUser()) return;
    const rawDelta = Math.max(0, Math.floor(result.steps));
    if (rawDelta <= 0) return;

    // Midnight while watch is alive: zero today and re-floor — never persist yesterday's total under today's date.
    if (rollLocalDayIfNeeded(rawDelta)) {
      alignDailyBaselineForWatch();
      if (_watchCallback) {
        const now = new Date();
        _watchCallback(buildResult(0, now, now));
      }
      return;
    }

    const sinceSubscribeMs = Date.now() - _watchStartedAtMs;
    // First ticks after subscribe are often phantom (Android reports a burst).
    // Remember the discarded cumulative value so later ticks don't re-apply it
    // as todayTotal = baseline + 1 (the classic reload fake +1).
    if (!_ignoredInitialPhantom && sinceSubscribeMs < 5_000) {
      if (
        rawDelta > 1 ||
        (rawDelta === 1 && _todaySteps === 0 && _dailyBaseline === 0)
      ) {
        _ignoredInitialPhantom = true;
        _watchSessionFloor = rawDelta;
        alignDailyBaselineForWatch();
        stepAudit.notePhantom({
          providerId: "android_legacy_sensor",
          eventOrigin: "subscribe",
          previousDailySteps: _todaySteps,
          calculatedDailySteps: _todaySteps,
          reason: `ignored_initial_phantom delta=${rawDelta}`,
        });
        if (__DEV__) {
          console.log(
            `[StepProvider] ignored initial phantom delta=${rawDelta} after subscribe`,
          );
        }
        return;
      }
    }

    // Single +1 phantom within a few seconds of subscribe.
    if (
      !_ignoredInitialPhantom &&
      rawDelta === 1 &&
      sinceSubscribeMs < 4_000
    ) {
      _ignoredInitialPhantom = true;
      _watchSessionFloor = rawDelta;
      alignDailyBaselineForWatch();
      stepAudit.notePhantom({
        providerId: "android_legacy_sensor",
        eventOrigin: "subscribe",
        previousDailySteps: _todaySteps,
        calculatedDailySteps: _todaySteps,
        reason: "ignored_initial_phantom delta=1",
      });
      if (__DEV__) {
        console.log("[StepProvider] ignored initial phantom delta=1 after subscribe");
      }
      return;
    }

    const delta = Math.max(0, rawDelta - _watchSessionFloor);
    if (delta <= 0) return;

    const todayTotal = _dailyBaseline + delta;
    if (todayTotal <= _todaySteps) return;

    void persistDaily(todayTotal);
    stepAudit.noteSensorTick({
      providerId: "android_legacy_sensor",
      rawSensorTotal: rawDelta,
      dailyBaseline: _dailyBaseline,
      calculatedDailySteps: todayTotal,
      eventOrigin: "watch",
      phantomEventDetected: false,
    });
    if (__DEV__) {
      console.log(
        `[StepProvider] legacy sensor delta=${delta} today=${todayTotal} (base=${_dailyBaseline})`,
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

      const { hasActivityRecognitionPermission } = await import(
        "@/services/permissions/activityRecognitionPermissionService"
      );
      if (await hasActivityRecognitionPermission()) {
        return { status: "granted", providerId: "android_legacy_sensor" };
      }

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
    if (!requireBoundUser()) {
      return buildResult(0, from, to);
    }
    await loadDailyState();
    let steps = _todaySteps;
    if (!_sub && steps === 0) {
      ensureSubscription();
    }
    return buildResult(steps, from, to);
  },

  async getStepsForRange(start: Date, end: Date): Promise<StepReadResult> {
    const today = await this.getTodaySteps();
    return buildResult(today.steps, start, end);
  },

  async getRaceSteps(
    raceId: string,
    raceStartAt: Date,
    userId: string,
    raceEndAt?: Date,
  ): Promise<StepReadResult> {
    // After the sponsored window ends, freeze — do not grow from further sensor ticks.
    if (raceEndAt && Date.now() >= raceEndAt.getTime()) {
      const frozenTo = raceEndAt;
      const seed = await getRaceStepSeed(raceId, userId);
      if (seed != null) {
        return buildResult(Math.max(0, seed), raceStartAt, frozenTo);
      }
      const baseline = await getRaceBaseline(
        raceId,
        userId,
        "android_legacy_sensor",
      );
      if (baseline != null) {
        const today = await this.getTodaySteps();
        return buildResult(Math.max(0, today.steps - baseline), raceStartAt, frozenTo);
      }
      return emptyStepResult("android_legacy_sensor", "legacy", raceStartAt, frozenTo);
    }
    const to = new Date();
    let baseline = await getRaceBaseline(
      raceId,
      userId,
      "android_legacy_sensor",
    );
    const today = await this.getTodaySteps();
    const seed = await getRaceStepSeed(raceId, userId);

    // Local midnight for mid-day race corruption check.
    const midnight = new Date();
    midnight.setHours(0, 0, 0, 0);
    const startedAfterMidnightMs = raceStartAt.getTime() - midnight.getTime();
    const midDayRace = startedAfterMidnightMs > 5 * 60 * 1000;

    // baseline=0 after re-login makes raceSteps == todaySteps. Repair or refuse.
    if (baseline === 0 && midDayRace && today.steps > 0) {
      if (seed != null) {
        baseline = Math.max(0, today.steps - seed);
        await setRaceBaseline(raceId, userId, "android_legacy_sensor", baseline);
        if (__DEV__) {
          console.log(
            `[RaceSteps] repaired baseline=0 → ${baseline} seed=${seed} today=${today.steps}`,
          );
        }
      } else {
        if (__DEV__) {
          console.log(
            `[RaceSteps] refusing baseline=0 for mid-day race today=${today.steps} (no seed) — use server floor`,
          );
        }
        return emptyStepResult("android_legacy_sensor", "legacy", raceStartAt, to);
      }
    }

    if (baseline === null) {
      if (seed != null && today.steps > 0) {
        baseline = Math.max(0, today.steps - seed);
        await setRaceBaseline(raceId, userId, "android_legacy_sensor", baseline);
      } else if (seed != null) {
        // Today not ready — report seed only so UI doesn't jump to daily total later.
        return buildResult(seed, raceStartAt, to);
      } else {
        return emptyStepResult("android_legacy_sensor", "legacy", raceStartAt, to);
      }
    }

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
    await setRaceStepSeed(raceId, userId, 0);
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

  async reconcileTodaySteps(steps: number): Promise<void> {
    if (!requireBoundUser()) return;
    await loadDailyState();
    const next = Math.max(_todaySteps, Math.floor(steps));
    if (next <= _todaySteps) return;

    _todaySteps = next;
    await persistDaily(next);

    if (!_sub) return;

    _dailyBaseline = next;
    await storageSet(scoped().baseline, _dailyBaseline);
    try {
      _sub.remove();
    } catch {}
    _sub = null;
    ensureSubscription();
  },

  /**
   * Drop a reload/subscribe phantom (+1) that already landed in storage so race
   * math (today - raceBaseline) does not keep a fake race step.
   */
  async discardPhantomTodayBump(confirmedSteps: number): Promise<void> {
    if (!requireBoundUser()) return;
    await loadDailyState();
    const confirmed = Math.max(0, Math.floor(confirmedSteps));
    const previous = _todaySteps;
    const ahead = previous - confirmed;
    if (ahead <= 0 || ahead > STEP_SYNC_CONFIG.WALK_PHANTOM_STEP_BUMP) return;
    await persistDaily(confirmed);
    _dailyBaseline = confirmed;
    await storageSet(scoped().baseline, confirmed);
    if (__DEV__) {
      console.log(
        `[StepProvider] discarded phantom today bump ${previous}->${confirmed}`,
      );
    }
  },

  async startWatchingSteps(
    callback: (result: StepReadResult) => void,
  ): Promise<() => void> {
    if (!requireBoundUser()) return () => {};
    await loadDailyState();
    const perm = await this.getPermissionStatus();
    if (perm !== "granted") {
      const req = await this.requestPermission();
      if (req.status !== "granted") return () => {};
    }

    _watchCallback = callback;
    _rawAtSubscription = _todaySteps;
    await storageSet(scoped().stepSnapshot, _rawAtSubscription);
    if (_sub) {
      try {
        _sub.remove();
      } catch {}
      _sub = null;
    }
    alignDailyBaselineForWatch();
    ensureSubscription();

    return () => {
      _watchCallback = null;
      if (_sub) {
        try {
          _sub.remove();
        } catch {}
        _sub = null;
      }
      if (requireBoundUser()) {
        void storageSet(scoped().baseline, _todaySteps);
      }
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

  /** Reset in-memory + persisted daily counters at local midnight. */
  async resetForNewLocalDay(): Promise<void> {
    if (!requireBoundUser()) return;
    const today = getLocalDateKey();
    const keys = scoped(today);
    _boundLocalDate = today;
    _loadedDailyKey = `${_userId}:${today}`;
    _dailyBaseline = 0;
    _todaySteps = 0;
    _rawAtSubscription = 0;
    _watchSessionFloor = 0;
    _ignoredInitialPhantom = false;
    _watchStartedAtMs = Date.now();
    await storageSet(keys.currentLocalDate, today);
    await storageSet(keys.baseline, 0);
    await storageSet(keys.steps, 0);
    await storageSet(keys.stepSnapshot, 0);
    const { stepEngineLog } = await import("@/utils/stepAccuracy");
    stepEngineLog(
      "StepBaseline",
      `userId=${_userId} localDate=${today} baseline=0 created=true`,
    );
    if (_sub) {
      try {
        _sub.remove();
      } catch {}
      _sub = null;
    }
    if (_watchCallback) {
      alignDailyBaselineForWatch();
      ensureSubscription();
    }
  },
};
