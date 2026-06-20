/**
 * Android Device Sensor Step Service — TYPE_STEP_COUNTER via expo-sensors.
 *
 * This is a LIMITED step source:
 *   • Allowed: Walk tab daily display, casual personal stats.
 *   • NOT allowed: cash challenges, coins battles, sponsored rewards,
 *                  paid races, official prize leaderboards.
 *
 * The TYPE_STEP_COUNTER sensor counts cumulative steps since the last device
 * reboot (not since midnight). We maintain a local baseline in AsyncStorage
 * to compute daily deltas correctly across reboots and midnight resets.
 *
 * Source ID : android_device_step_counter
 * Verification level : limited
 *
 * DEBUG logs prefix: [DeviceSensor]
 */

import { STORAGE_KEYS, storageGet, storageSet } from "@/utils/storage";
import { isExpoGo } from "./androidHealthConnectService";

const DEV = __DEV__;
function log(msg: string, ...args: unknown[]) {
  if (DEV) console.log(`[DeviceSensor] ${msg}`, ...args);
}

// ── AsyncStorage keys ──────────────────────────────────────────────────────────

const SENSOR_BASELINE_KEY = "sensor_step_baseline" as typeof STORAGE_KEYS[keyof typeof STORAGE_KEYS];
const SENSOR_BASELINE_DATE_KEY = "sensor_step_baseline_date" as typeof STORAGE_KEYS[keyof typeof STORAGE_KEYS];
const SENSOR_TODAY_KEY = "sensor_step_today" as typeof STORAGE_KEYS[keyof typeof STORAGE_KEYS];

// ── Pedometer loader (TYPE_STEP_COUNTER on Android) ───────────────────────────

type PedometerSub = { remove: () => void };
type PedometerAPI = {
  isAvailableAsync: () => Promise<boolean>;
  getPermissionsAsync: () => Promise<{ status: string }>;
  requestPermissionsAsync: () => Promise<{ status: string }>;
  watchStepCount: (cb: (r: { steps: number }) => void) => PedometerSub;
};

let _ped: PedometerAPI | null | undefined = undefined;
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

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

// ── Module state ───────────────────────────────────────────────────────────────

let _sub: PedometerSub | null = null;
let _baseline = 0;
let _todaySteps = 0;
let _running = false;

// ── Public service ─────────────────────────────────────────────────────────────

export const androidDeviceSensorService = {
  /**
   * Returns true when the hardware step counter is available on this device.
   * Call before showing limited-sensor option in setup UI.
   */
  async isAvailable(): Promise<boolean> {
    if (isExpoGo()) return false;
    const ped = loadPedometer();
    if (!ped) return false;
    try {
      return await ped.isAvailableAsync();
    } catch {
      return false;
    }
  },

  /**
   * Check / request ACTIVITY_RECOGNITION permission.
   * On Android < 10 the permission doesn't exist → auto-granted.
   */
  async requestPermission(): Promise<"granted" | "denied" | "unavailable"> {
    if (isExpoGo()) return "unavailable";
    const ped = loadPedometer();
    if (!ped) return "unavailable";
    try {
      const available = await ped.isAvailableAsync();
      if (!available) return "unavailable";
      const { status: before } = await ped.getPermissionsAsync();
      if (before === "granted") return "granted";
      const { status: after } = await ped.requestPermissionsAsync();
      return after === "granted" ? "granted" : "denied";
    } catch {
      return "denied";
    }
  },

  /**
   * Get current ACTIVITY_RECOGNITION permission state without showing UI.
   */
  async getPermissionStatus(): Promise<"granted" | "denied" | "unknown" | "unavailable"> {
    if (isExpoGo()) return "unavailable";
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

  /**
   * Start the live TYPE_STEP_COUNTER subscription.
   * The sensor reports cumulative steps since last reboot (delta from start of
   * subscription). We add a stored baseline so daily total is correct even
   * across reboots and midnight resets.
   *
   * @param onUpdate - called with updated today-step total on each sensor event
   */
  async startTracking(onUpdate: (steps: number) => void): Promise<boolean> {
    if (isExpoGo()) return false;
    if (_running) return true;

    const ped = loadPedometer();
    if (!ped) return false;

    try {
      const available = await ped.isAvailableAsync();
      if (!available) return false;

      const perm = await this.requestPermission();
      if (perm !== "granted") return false;

      // Load stored baseline for today
      const today = todayKey();
      const storedDate = await storageGet<string>(SENSOR_BASELINE_DATE_KEY as keyof typeof STORAGE_KEYS);
      const storedBaseline = await storageGet<number>(SENSOR_BASELINE_KEY as keyof typeof STORAGE_KEYS) ?? 0;
      const storedToday = await storageGet<number>(SENSOR_TODAY_KEY as keyof typeof STORAGE_KEYS) ?? 0;

      if (storedDate === today) {
        _baseline = storedBaseline;
        _todaySteps = storedToday;
      } else {
        // New day or first run — reset baseline
        _baseline = 0;
        _todaySteps = 0;
        await storageSet(SENSOR_BASELINE_DATE_KEY as keyof typeof STORAGE_KEYS, today);
        await storageSet(SENSOR_BASELINE_KEY as keyof typeof STORAGE_KEYS, 0);
        await storageSet(SENSOR_TODAY_KEY as keyof typeof STORAGE_KEYS, 0);
      }

      log(`startTracking — baseline=${_baseline} today=${_todaySteps} date=${today}`);

      _sub = ped.watchStepCount((result) => {
        // result.steps = cumulative delta since subscription start (resets on reboot)
        const todayTotal = _baseline + result.steps;
        _todaySteps = todayTotal;
        void storageSet(SENSOR_TODAY_KEY as keyof typeof STORAGE_KEYS, todayTotal);
        log(`watchStepCount delta=${result.steps} today=${todayTotal}`);
        onUpdate(todayTotal);
      });

      _running = true;
      return true;
    } catch (e) {
      log("startTracking error", e);
      return false;
    }
  },

  /**
   * Save current step count as the new baseline.
   * Call when the subscription stops so next session starts from the right value.
   */
  async saveBaseline(): Promise<void> {
    const today = todayKey();
    await storageSet(SENSOR_BASELINE_DATE_KEY as keyof typeof STORAGE_KEYS, today);
    await storageSet(SENSOR_BASELINE_KEY as keyof typeof STORAGE_KEYS, _todaySteps);
    await storageSet(SENSOR_TODAY_KEY as keyof typeof STORAGE_KEYS, _todaySteps);
    log(`saveBaseline — baseline=${_todaySteps}`);
  },

  /** Stop the subscription and save the current baseline. */
  async stopTracking(): Promise<void> {
    if (_sub) {
      try { _sub.remove(); } catch {}
      _sub = null;
    }
    _running = false;
    await this.saveBaseline();
    log("stopTracking");
  },

  /**
   * Reset all state (call on midnight rollover or sign-out).
   */
  async resetForNewDay(): Promise<void> {
    await this.stopTracking();
    const today = todayKey();
    _baseline = 0;
    _todaySteps = 0;
    await storageSet(SENSOR_BASELINE_DATE_KEY as keyof typeof STORAGE_KEYS, today);
    await storageSet(SENSOR_BASELINE_KEY as keyof typeof STORAGE_KEYS, 0);
    await storageSet(SENSOR_TODAY_KEY as keyof typeof STORAGE_KEYS, 0);
    log("resetForNewDay");
  },

  /** Current today step count (in-memory, from the last watchStepCount event). */
  get todaySteps(): number {
    return _todaySteps;
  },

  get isRunning(): boolean {
    return _running;
  },
};
