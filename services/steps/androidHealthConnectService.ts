/**
 * androidHealthConnectService — Android Health Connect step tracking.
 *
 * Replaces expo-sensors Pedometer.watchStepCount() with range-based HC queries,
 * mirroring iOS HealthKit behavior exactly:
 *
 *   iOS:     Pedometer.getStepCountAsync(midnight, now)
 *   Android: readRecords('Steps', { between: midnight, now }) → sum
 *
 * No delta baseline math. No subscription to manage.
 * Steps are authoritative and cumulative from local midnight.
 *
 * HC availability states:
 *   available     — HC installed & SDK initialized
 *   not_installed — HC app absent (need Play Store install)
 *   needs_update  — HC installed but requires update
 *   not_supported — device doesn't support HC (very old Android)
 *
 * Permission states:
 *   granted     — READ_STEPS granted
 *   unknown     — never requested → show Enable button
 *   denied      — user denied → show Open HC Settings
 *   unavailable — Expo Go or HC not available
 */

export type HCAvailability =
  | "available"
  | "not_installed"
  | "needs_update"
  | "not_supported";

export type HCPermStatus = "granted" | "unknown" | "denied" | "unavailable";

export interface StepReadResult {
  steps: number;
  distanceMeters?: number;
  caloriesBurned?: number;
  activeMinutes?: number;
  source: "android_health_connect";
  startTime: string;
  endTime: string;
  timezone: string;
}

export interface HCInitResult {
  availability: HCAvailability;
  permission: HCPermStatus;
  initialized: boolean;
}

// ── Expo Go detection ─────────────────────────────────────────────────────────

/**
 * True when running inside Expo Go (storeClient).
 * Health Connect requires a standalone/dev-client build.
 */
export function isExpoGo(): boolean {
  try {
    const C = require("expo-constants") as {
      default?: { executionEnvironment?: string };
    };
    return C?.default?.executionEnvironment === "storeClient";
  } catch {
    return false;
  }
}

// ── Lazy HC module loader ─────────────────────────────────────────────────────

interface HCStepRecord {
  count: number;
  startTime: string;
  endTime: string;
}

interface HCPerm {
  accessType: string;
  recordType: string;
}

interface HCModule {
  initialize: () => Promise<boolean>;
  getSdkStatus: () => Promise<number>;
  requestPermission: (perms: HCPerm[]) => Promise<HCPerm[]>;
  getGrantedPermissions: () => Promise<HCPerm[]>;
  readRecords: (
    recordType: string,
    options: unknown,
  ) => Promise<{ records: HCStepRecord[] }>;
  openHealthConnectSettings: () => Promise<void>;
}

// SDK availability codes from Health Connect SDK
const SDK_AVAILABLE = 1;
const SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED = 2;
// SDK_UNAVAILABLE = 3

let _hcModule: HCModule | null | undefined = undefined;

function loadHCModule(): HCModule | null {
  if (_hcModule !== undefined) return _hcModule;
  try {
    const m = require("react-native-health-connect") as Partial<HCModule>;
    _hcModule =
      typeof m.initialize === "function" ? (m as HCModule) : null;
  } catch {
    _hcModule = null;
  }
  return _hcModule;
}

// ── Module state ──────────────────────────────────────────────────────────────

let _initialized = false;
let _availability: HCAvailability = "not_supported";
/** In-memory cache — last confirmed today total. Updated on every successful HC read. */
let _cachedTodaySteps = 0;

// ── Helpers ───────────────────────────────────────────────────────────────────

function getLocalMidnight(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function getUserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return "UTC";
  }
}

function emptyResult(start: Date, end: Date): StepReadResult {
  return {
    steps: 0,
    source: "android_health_connect",
    startTime: start.toISOString(),
    endTime: end.toISOString(),
    timezone: getUserTimezone(),
  };
}

// ── Public service ────────────────────────────────────────────────────────────

export const androidHCService = {
  // ── Cache accessors ─────────────────────────────────────────────────────────

  /**
   * Zero-cost in-memory read of the last confirmed today step total.
   * Used by StepPollingService on every 500 ms race tick.
   */
  getCachedTodaySteps(): number {
    return _cachedTodaySteps;
  },

  // ── Initialization ──────────────────────────────────────────────────────────

  /**
   * Initialize Health Connect and check availability + permission.
   * Safe to call multiple times — re-runs permission check each call.
   */
  async initialize(): Promise<HCInitResult> {
    if (isExpoGo()) {
      return {
        availability: "not_supported",
        permission: "unavailable",
        initialized: false,
      };
    }

    const hc = loadHCModule();
    if (!hc) {
      return {
        availability: "not_supported",
        permission: "unavailable",
        initialized: false,
      };
    }

    try {
      const sdkStatus = await hc.getSdkStatus();
      if (__DEV__)
        console.log(`[AndroidHC] getSdkStatus: ${sdkStatus}`);

      let availability: HCAvailability;
      if (sdkStatus === SDK_AVAILABLE) {
        availability = "available";
      } else if (sdkStatus === SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED) {
        availability = "needs_update";
      } else {
        // HC app not installed
        availability = "not_installed";
      }
      _availability = availability;

      if (availability !== "available") {
        return { availability, permission: "unavailable", initialized: false };
      }

      const ok = await hc.initialize();
      if (__DEV__) console.log(`[AndroidHC] initialize: ${ok}`);
      _initialized = ok;

      if (!ok) {
        return { availability, permission: "unavailable", initialized: false };
      }

      const permission = await this.getPermissionStatus();
      return { availability, permission, initialized: true };
    } catch (e) {
      if (__DEV__) console.log(`[AndroidHC] initialize error:`, e);
      return {
        availability: "not_supported",
        permission: "unavailable",
        initialized: false,
      };
    }
  },

  // ── Permissions ─────────────────────────────────────────────────────────────

  /**
   * Silent check — no UI. Returns current READ_STEPS permission state.
   */
  async getPermissionStatus(): Promise<HCPermStatus> {
    if (isExpoGo()) return "unavailable";
    if (!_initialized) return "unknown";
    const hc = loadHCModule();
    if (!hc) return "unavailable";
    try {
      const granted = await hc.getGrantedPermissions();
      const hasSteps = granted.some(
        (p) => p.recordType === "Steps" && p.accessType === "read",
      );
      if (__DEV__)
        console.log(
          `[AndroidHC] getGrantedPermissions — Steps read: ${hasSteps}`,
        );
      return hasSteps ? "granted" : "denied";
    } catch {
      return "unknown";
    }
  },

  /**
   * Request READ_STEPS permission — shows the HC permission sheet.
   * Initializes HC first if not already done.
   */
  async requestPermission(): Promise<HCPermStatus> {
    if (isExpoGo()) return "unavailable";

    if (!_initialized) {
      const initResult = await this.initialize();
      if (!initResult.initialized) return "unavailable";
    }

    const hc = loadHCModule();
    if (!hc) return "unavailable";
    try {
      const result = await hc.requestPermission([
        { accessType: "read", recordType: "Steps" },
      ]);
      if (__DEV__)
        console.log(`[AndroidHC] requestPermission result count: ${result.length}`);
      const granted = result.some(
        (p) => p.recordType === "Steps" && p.accessType === "read",
      );
      if (__DEV__)
        console.log(`[AndroidHC] READ_STEPS granted: ${granted}`);
      return granted ? "granted" : "denied";
    } catch (e) {
      if (__DEV__) console.log(`[AndroidHC] requestPermission error:`, e);
      return "denied";
    }
  },

  // ── Step reads ───────────────────────────────────────────────────────────────

  /**
   * Read cumulative steps from `start` to `end`.
   * Equivalent to iOS Pedometer.getStepCountAsync(start, end).
   *
   * Updates the in-memory cache with the result (monotonic max guard).
   */
  async readStepsForRange(start: Date, end: Date): Promise<StepReadResult> {
    const fallback = emptyResult(start, end);
    if (!_initialized) return fallback;

    const hc = loadHCModule();
    if (!hc) return fallback;

    try {
      const res = await hc.readRecords("Steps", {
        timeRangeFilter: {
          operator: "between",
          startTime: start.toISOString(),
          endTime: end.toISOString(),
        },
      });

      const total = (res.records ?? []).reduce(
        (sum, r) => sum + (r.count ?? 0),
        0,
      );
      const steps = Math.max(0, total);

      if (__DEV__)
        console.log(
          `[AndroidHC] readStepsForRange ${start.toISOString()} → ${end.toISOString()} = ${steps} (${res.records?.length ?? 0} records)`,
        );

      // Monotonic cache update — never decrease the cached value
      if (steps > _cachedTodaySteps) {
        _cachedTodaySteps = steps;
      }

      return {
        steps,
        distanceMeters: Math.round(steps * 0.762),
        caloriesBurned: Math.round(steps * 0.04),
        activeMinutes: Math.ceil(steps / 120),
        source: "android_health_connect",
        startTime: start.toISOString(),
        endTime: end.toISOString(),
        timezone: getUserTimezone(),
      };
    } catch (e) {
      if (__DEV__) console.log(`[AndroidHC] readStepsForRange error:`, e);
      return fallback;
    }
  },

  /**
   * Read today's cumulative steps from local midnight to now.
   * Primary method for daily step count.
   * Equivalent to iOS getStepCountAsync(localMidnight, now).
   */
  async readTodaySteps(): Promise<StepReadResult> {
    return this.readStepsForRange(getLocalMidnight(), new Date());
  },

  // ── Settings / install ──────────────────────────────────────────────────────

  /**
   * Open Health Connect settings where users can manage app permissions.
   */
  async openSettings(): Promise<void> {
    const hc = loadHCModule();
    if (!hc) return;
    try {
      await hc.openHealthConnectSettings();
    } catch (e) {
      if (__DEV__) console.log(`[AndroidHC] openSettings error:`, e);
    }
  },

  /**
   * Open Play Store page to install Health Connect.
   * Falls back to web URL if the market:// scheme is unavailable.
   */
  async openInstallPage(): Promise<void> {
    try {
      const { Linking } =
        require("react-native") as typeof import("react-native");
      const market =
        "market://details?id=com.google.android.apps.healthdata";
      const web =
        "https://play.google.com/store/apps/details?id=com.google.android.apps.healthdata";
      const canUseMarket = await Linking.canOpenURL(market).catch(() => false);
      await Linking.openURL(canUseMarket ? market : web);
    } catch (e) {
      if (__DEV__) console.log(`[AndroidHC] openInstallPage error:`, e);
    }
  },

  // ── Reset ────────────────────────────────────────────────────────────────────

  reset(): void {
    _initialized = false;
    _cachedTodaySteps = 0;
    _availability = "not_supported";
  },
};
