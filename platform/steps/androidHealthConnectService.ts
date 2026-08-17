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

import type { Permission } from "react-native-health-connect";
import { STEP_SYNC_CONFIG } from "@/config/stepSyncConfig";
import { storageGet, storageSet } from "@/utils/storage";
import { stepAudit } from "@/utils/stepAudit";
import { logger } from "@/utils/logger";
import { normalizeHealthConnectOrigins } from "./healthConnectOrigins";
import { shouldReuseHealthConnectPermCache } from "./healthConnectVerificationStateLogic";

const HC_MANIFEST_BLOCKED_KEY = "hc_manifest_read_steps_blocked" as never;

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
  metadata?: { dataOrigin?: unknown };
}

interface HCPerm {
  accessType: string;
  recordType: string;
}

/** Library format: [{ accessType: 'read', recordType: 'Steps' }] — not "read:Steps" strings. */
const READ_STEPS_PERMISSION: Permission = {
  accessType: "read",
  recordType: "Steps",
};

interface HCAggregateStepsResult {
  COUNT_TOTAL?: number;
  dataOrigins?: unknown;
}

interface HCModule {
  initialize: (providerPackageName?: string) => Promise<boolean>;
  getSdkStatus: (providerPackageName?: string) => Promise<number>;
  requestPermission: (perms: Permission[]) => Promise<Permission[]>;
  getGrantedPermissions: () => Promise<Permission[]>;
  readRecords: (
    recordType: string,
    options: unknown,
  ) => Promise<{ records: HCStepRecord[] }>;
  aggregateRecord?: (request: {
    recordType: "Steps";
    timeRangeFilter: {
      operator: "between";
      startTime: string;
      endTime: string;
    };
  }) => Promise<HCAggregateStepsResult>;
  openHealthConnectSettings: () => Promise<void>;
  openHealthConnectDataManagement?: (providerPackageName?: string) => Promise<void>;
}

const HC_PROVIDER_PACKAGE = "com.google.android.apps.healthdata";

// SdkAvailabilityStatus from react-native-health-connect (do not guess values)
const HC_SDK = {
  SDK_UNAVAILABLE: 1,
  SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED: 2,
  SDK_AVAILABLE: 3,
} as const;

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

let _readPermissionBlocked = false;
/** True when APK manifest is missing READ_STEPS — native HC calls can crash. */
let _manifestBlockedLoaded = false;

function markHcNativeError(detail: unknown): void {
  const msg = String(detail);
  if (msg.includes("not declared")) {
    _readPermissionBlocked = true;
    void storageSet(HC_MANIFEST_BLOCKED_KEY, true);
    hcLog("READ_STEPS missing from manifest — HC native calls disabled");
  }
}

async function loadManifestBlockedFlag(): Promise<void> {
  if (_manifestBlockedLoaded) return;
  _manifestBlockedLoaded = true;
  try {
    const stored = await storageGet<boolean>(HC_MANIFEST_BLOCKED_KEY);
    if (stored) {
      _readPermissionBlocked = true;
      hcLog("READ_STEPS manifest blocked (cached)");
    }
  } catch {
    /* ignore */
  }
}
let _initialized = false;
let _availability: HCAvailability = "not_supported";
/** True after requestPermission() was shown at least once this session. */
let _permissionRequested = false;
let _permissionRequestInFlight = false;
let _permissionRequestWaiters: Array<() => void> = [];
/** In-memory cache — last confirmed today total. Updated on every successful HC read. */
let _cachedTodaySteps = 0;
let _cachedTodayDate = "";
let _cachedTodayOrigins: string[] = [];
let _lastInitResult: HCInitResult | null = null;
let _permCache: { status: HCPermStatus; at: number } | null = null;
let _permBackoffUntil = 0;
let _lastHcErrorLogAt = 0;

const HC_PERM_CACHE_MS = 60_000;
const HC_PERM_BACKOFF_MS = 120_000;
const HC_ERROR_LOG_COOLDOWN_MS = 60_000;

// ── Helpers ───────────────────────────────────────────────────────────────────

function getLocalMidnight(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function localDateKey(d = new Date()): string {
  return (
    `${d.getFullYear()}-` +
    `${String(d.getMonth() + 1).padStart(2, "0")}-` +
    `${String(d.getDate()).padStart(2, "0")}`
  );
}

function rememberTodaySteps(steps: number, origins?: string[]): void {
  const today = localDateKey();
  if (_cachedTodayDate !== today) {
    _cachedTodayDate = today;
    _cachedTodaySteps = 0;
    _cachedTodayOrigins = [];
  }
  if (steps > 0) _cachedTodaySteps = Math.max(_cachedTodaySteps, steps);
  if (origins) _cachedTodayOrigins = origins;
}

function cachedTodayOrigins(): string[] {
  return _cachedTodayDate === localDateKey() ? [..._cachedTodayOrigins] : [];
}

function cachedTodayIfSameDay(): number {
  return _cachedTodayDate === localDateKey() ? Math.max(0, _cachedTodaySteps) : 0;
}

function isLocalTodayRange(start: Date): boolean {
  return Math.abs(start.getTime() - getLocalMidnight().getTime()) < 2 * 60_000;
}

function getUserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return "UTC";
  }
}

function getPackageName(): string {
  try {
    const C = require("expo-constants") as {
      default?: { expoConfig?: { android?: { package?: string } } };
    };
    return C?.default?.expoConfig?.android?.package ?? "com.walkchamp.app";
  } catch {
    return "com.walkchamp.app";
  }
}

function getAndroidApiLevel(): number {
  try {
    const { Platform } =
      require("react-native") as typeof import("react-native");
    return typeof Platform.Version === "number" ? Platform.Version : 0;
  } catch {
    return 0;
  }
}

function formatPerms(perms: Array<Pick<Permission, "accessType" | "recordType">>): string {
  return JSON.stringify(
    perms.map((p) => ({ accessType: p.accessType, recordType: p.recordType })),
  );
}

async function waitForAppActive(timeoutMs = 5000): Promise<void> {
  const { AppState } = require("react-native") as typeof import("react-native");
  if (AppState.currentState === "active") return;
  await new Promise<void>((resolve) => {
    const deadline = setTimeout(() => {
      sub.remove();
      resolve();
    }, timeoutMs);
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        clearTimeout(deadline);
        sub.remove();
        resolve();
      }
    });
  });
}

function hasStepsRead(perms: HCPerm[]): boolean {
  return perms.some(
    (p) => p.recordType === "Steps" && p.accessType === "read",
  );
}

function hcLog(message: string, detail?: unknown): void {
  if (!STEP_SYNC_CONFIG.STEP_DEBUG_VERBOSE) return;
  // Never log raw Health Connect records — counts / status only.
  logger.debug("AndroidHC", message, detail);
}

function hcWarnOnce(message: string, detail?: unknown): void {
  const now = Date.now();
  if (now - _lastHcErrorLogAt < HC_ERROR_LOG_COOLDOWN_MS) return;
  _lastHcErrorLogAt = now;
  // Sanitize: log error name/message only — never raw health records.
  const safeDetail =
    detail instanceof Error
      ? { name: detail.name, message: detail.message }
      : detail !== undefined
        ? String(detail).slice(0, 200)
        : undefined;
  logger.warn("AndroidHC", message, safeDetail);
}

function isHcRateLimitedError(detail: unknown): boolean {
  return String(detail).toLowerCase().includes("rate limited");
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
  isPermissionRequestInFlight(): boolean {
    return _permissionRequestInFlight;
  },

  /** True when HC range reads fail due to missing manifest/runtime permission. */
  isRangeReadBlocked(): boolean {
    return _readPermissionBlocked;
  },

  /**
   * True when Health Connect is initialized, Steps read is granted, and range
   * reads are not blocked (manifest / SecurityException).
   */
  async isReadyForRaceReads(): Promise<boolean> {
    if (isExpoGo()) return false;
    if (_readPermissionBlocked) return false;

    const init = await this.initialize();
    if (!init.initialized || init.availability !== "available") return false;

    const perm = await this.getPermissionStatus();
    return perm === "granted" && !_readPermissionBlocked;
  },

  // ── Cache accessors ─────────────────────────────────────────────────────────

  /**
   * Zero-cost in-memory read of the last confirmed today step total.
   * Used by StepPollingService on every 500 ms race tick.
   */
  getCachedTodaySteps(): number {
    return _cachedTodaySteps;
  },

  /**
   * Raw SDK status from Health Connect (1=unavailable, 2=update required, 3=available).
   */
  async getSdkStatusRaw(): Promise<number> {
    if (isExpoGo()) return HC_SDK.SDK_UNAVAILABLE;
    const hc = loadHCModule();
    if (!hc) return HC_SDK.SDK_UNAVAILABLE;
    try {
      return await hc.getSdkStatus(HC_PROVIDER_PACKAGE);
    } catch {
      return HC_SDK.SDK_UNAVAILABLE;
    }
  },

  get availability(): HCAvailability {
    return _availability;
  },

  // ── Initialization ──────────────────────────────────────────────────────────

  /**
   * Initialize Health Connect and check availability + permission.
   * Safe to call multiple times — re-runs permission check each call.
   */
  async initialize(): Promise<HCInitResult> {
    await loadManifestBlockedFlag();
    if (isExpoGo()) {
      return {
        availability: "not_supported",
        permission: "unavailable",
        initialized: false,
      };
    }

    if (_initialized && _lastInitResult?.initialized) {
      return _lastInitResult;
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
      hcLog(`app package: ${getPackageName()}, hc provider: ${HC_PROVIDER_PACKAGE}`);
      const sdkStatus = await hc.getSdkStatus(HC_PROVIDER_PACKAGE);
      hcLog(`SDK status: ${sdkStatus}`);

      let availability: HCAvailability;
      if (sdkStatus === HC_SDK.SDK_AVAILABLE) {
        availability = "available";
      } else if (sdkStatus === HC_SDK.SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED) {
        availability = "needs_update";
      } else if (sdkStatus === HC_SDK.SDK_UNAVAILABLE) {
        availability = getAndroidApiLevel() >= 28 ? "not_installed" : "not_supported";
      } else {
        availability = "not_supported";
      }
      _availability = availability;

      if (availability !== "available") {
        _lastInitResult = { availability, permission: "unavailable", initialized: false };
        return _lastInitResult;
      }

      const ok = await hc.initialize(HC_PROVIDER_PACKAGE);
      hcLog(`initialize(${HC_PROVIDER_PACKAGE}): ${ok}`);
      _initialized = ok;

      if (!ok) {
        _lastInitResult = { availability, permission: "unavailable", initialized: false };
        return _lastInitResult;
      }

      const permission = await this.getPermissionStatus();
      _lastInitResult = { availability, permission, initialized: true };
      return _lastInitResult;
    } catch (e) {
      hcWarnOnce("initialize error", e);
      _lastInitResult = {
        availability: "not_supported",
        permission: "unavailable",
        initialized: false,
      };
      return _lastInitResult;
    }
  },

  // ── Permissions ─────────────────────────────────────────────────────────────

  /**
   * Silent check — no UI. Returns current READ_STEPS permission state.
   * Empty grants before any request → "unknown" (not "denied").
   */
  async getPermissionStatus(): Promise<HCPermStatus> {
    if (isExpoGo()) return "unavailable";
    if (!_initialized) return "unknown";
    const now = Date.now();
    if (
      shouldReuseHealthConnectPermCache({
        cacheStatus: _permCache?.status ?? null,
        cacheAgeMs: _permCache ? now - _permCache.at : Number.POSITIVE_INFINITY,
        ttlMs: HC_PERM_CACHE_MS,
        backoffActive: now < _permBackoffUntil && !!_permCache,
      })
    ) {
      return _permCache!.status;
    }
    const hc = loadHCModule();
    if (!hc) return "unavailable";
    try {
      const granted = await hc.getGrantedPermissions();
      const hasSteps = hasStepsRead(granted);
      hcLog(`granted permissions: ${formatPerms(granted)} — Steps read: ${hasSteps}`);
      const status: HCPermStatus = hasSteps
        ? "granted"
        : _permissionRequested
          ? "denied"
          : "unknown";
      _permCache = { status, at: now };
      return status;
    } catch (e) {
      if (isHcRateLimitedError(e)) {
        _permBackoffUntil = now + HC_PERM_BACKOFF_MS;
        hcWarnOnce("getPermissionStatus rate limited — backing off", e);
      } else {
        hcWarnOnce("getPermissionStatus error", e);
      }
      return _permCache?.status ?? "unknown";
    }
  },

  /**
   * Re-run SDK init + permission check (e.g. after installing HC or returning from settings).
   */
  async refresh(): Promise<HCInitResult> {
    _initialized = false;
    return this.initialize();
  },

  /**
   * Request READ_STEPS permission — shows the HC permission sheet in-app.
   * Initializes HC first if not already done.
   */
  async requestPermission(): Promise<HCPermStatus> {
    if (isExpoGo()) return "unavailable";
    if (_readPermissionBlocked) {
      hcLog("requestPermission skipped — READ_STEPS not in manifest");
      return "unavailable";
    }
    if (_permissionRequestInFlight) {
      hcLog("requestPermission waiting — already in flight");
      await new Promise<void>((resolve) => {
        _permissionRequestWaiters.push(resolve);
      });
      return this.getPermissionStatus();
    }

    hcLog(`requestPermission start — package: ${getPackageName()}`);

    // Do NOT request ACTIVITY_RECOGNITION / Pedometer here.
    // Enable Step Tracking must only show the Health Connect READ_STEPS sheet.
    // Physical activity + notifications are requested once after Done via
    // completeStepSetup({ allowAll: true }) → activateStepTracking(firstSetupAllowAll).

    if (!_initialized) {
      const initResult = await this.initialize();
      if (!initResult.initialized) {
        // Do not open Play Store / Health Connect — caller uses Android Steps fallback.
        hcLog(
          `HC not initialized (${initResult.availability}) — skipping external navigation`,
        );
        return "unavailable";
      }
    }

    const hc = loadHCModule();
    if (!hc) return "unavailable";
    _permissionRequestInFlight = true;
    try {
      const before = await hc.getGrantedPermissions();
      hcLog(`granted before request: ${formatPerms(before)}`);

      if (hasStepsRead(before)) {
        hcLog("Steps read already granted — skipping request sheet");
        _permissionRequested = true;
        _permCache = { status: "granted", at: Date.now() };
        _permBackoffUntil = 0;
        return "granted";
      }

      hcLog(
        `calling requestPermission payload: ${formatPerms([READ_STEPS_PERMISSION])}`,
      );

      // Wait for UI/modal animations to finish so MainActivity is RESUMED.
      const { InteractionManager } =
        require("react-native") as typeof import("react-native");
      await new Promise<void>((resolve) => {
        InteractionManager.runAfterInteractions(() => resolve());
      });
      await waitForAppActive();
      await new Promise((r) => setTimeout(r, 350));

      const result = await hc.requestPermission([READ_STEPS_PERMISSION]);
      hcLog(`requestPermission result: ${formatPerms(result)}`);

      // Re-check granted permissions immediately after dialog closes.
      _initialized = true;
      const after = await hc.getGrantedPermissions();
      hcLog(`granted after request: ${formatPerms(after)}`);

      const granted = hasStepsRead(after) || hasStepsRead(result);
      hcLog(`READ_STEPS granted: ${granted}`);

      if (granted) {
        _permissionRequested = true;
        // Must update cache immediately — otherwise Done re-reads a stale
        // "unknown" for up to HC_PERM_CACHE_MS and bounces back to Enable.
        _permCache = { status: "granted", at: Date.now() };
        _permBackoffUntil = 0;
        try {
          const read = await this.readTodaySteps();
          hcLog(
            `readRecords today (midnight→now): ${read.steps} steps, records ok`,
          );
        } catch (readErr) {
          hcLog("readRecords after grant error", readErr);
        }
        return "granted";
      }

      if (!hasStepsRead(result) && (result?.length ?? 0) === 0) {
        hcLog(
          "empty permission result — dialog may not have shown; caller should use Android Steps fallback",
        );
        // Do not cache as denied — dialog may not have shown.
        return "unknown";
      }

      _permissionRequested = true;
      _permCache = { status: "denied", at: Date.now() };
      hcLog("READ_STEPS not granted — user can retry Enable Step Tracking");
      return "denied";
    } catch (e) {
      markHcNativeError(e);
      hcLog("requestPermission error", e);
      return "denied";
    } finally {
      _permissionRequestInFlight = false;
      const waiters = _permissionRequestWaiters.splice(0);
      for (const resolve of waiters) resolve();
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
    if (_readPermissionBlocked) return fallback;
    if (!_initialized) return fallback;

    const hc = loadHCModule();
    if (!hc) return fallback;

    try {
      const timeRangeFilter = {
        operator: "between" as const,
        startTime: start.toISOString(),
        endTime: end.toISOString(),
      };

      let steps = 0;
      let readMethod: "aggregate" | "readRecords" = "readRecords";
      let recordCount = 0;
      let dataOrigins: string[] = [];
      let aggregateEmpty = false;

      if (typeof hc.aggregateRecord === "function") {
        try {
          const agg = await hc.aggregateRecord({
            recordType: "Steps",
            timeRangeFilter,
          });
          steps = Math.max(0, agg?.COUNT_TOTAL ?? 0);
          dataOrigins = normalizeHealthConnectOrigins(agg?.dataOrigins);
          readMethod = "aggregate";
          aggregateEmpty =
            steps === 0 && dataOrigins.length === 0;
        } catch (aggErr) {
          hcLog("aggregateRecord failed — falling back to readRecords", aggErr);
        }
      }

      // Samsung/HC often returns aggregate COUNT_TOTAL=0 with no origins while
      // steps still exist — fall back to readRecords before treating as zero.
      // Also read records when aggregate has a count but no origins so we can
      // tell Samsung Health from phone-only Health Connect steps.
      if (readMethod !== "aggregate" || aggregateEmpty || dataOrigins.length === 0) {
        try {
          const res = await hc.readRecords("Steps", { timeRangeFilter });
          recordCount = res.records?.length ?? 0;
          const total = (res.records ?? []).reduce(
            (sum, r) => sum + (r.count ?? 0),
            0,
          );
          const recordOrigins = normalizeHealthConnectOrigins(res.records ?? []);
          if (recordOrigins.length > 0) {
            dataOrigins = [...new Set([...dataOrigins, ...recordOrigins])];
          }
          if (total > 0 || recordCount > 0) {
            steps = Math.max(0, total);
            readMethod = "readRecords";
          }
        } catch (recErr) {
          if (readMethod !== "aggregate") {
            hcLog("readRecords failed", recErr);
          }
        }
      }

      const emptyRead =
        steps === 0 && recordCount === 0 && dataOrigins.length === 0;
      if (emptyRead && isLocalTodayRange(start)) {
        const cached = cachedTodayIfSameDay();
        if (cached > 0) {
          hcLog(
            `empty HC poll — keeping cached todaySteps=${cached} (aggregate/records=0)`,
          );
          steps = cached;
        }
      }

      hcLog(
        `readStepsForRange ${start.toISOString()} → ${end.toISOString()} = ${steps} method=${readMethod} records=${recordCount} origins=${dataOrigins?.length ?? 0}`,
      );

      try {
        stepAudit.noteHealthConnectRead({
          method: readMethod,
          steps,
          recordCount,
          dataOrigins: dataOrigins.length ? dataOrigins : null,
          eventOrigin: "poll",
        });
      } catch {
        /* audit optional */
      }

      if (isLocalTodayRange(start)) {
        rememberTodaySteps(steps, dataOrigins);
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
      markHcNativeError(e);
      hcLog("readStepsForRange error", e);
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
      hcLog("openSettings error", e);
    }
  },

  /**
   * Opens Health Connect data management — shows this app in HC permissions.
   */
  async openDataManagement(): Promise<void> {
    const hc = loadHCModule();
    if (!hc) return;
    try {
      if (typeof hc.openHealthConnectDataManagement === "function") {
        await hc.openHealthConnectDataManagement(HC_PROVIDER_PACKAGE);
        return;
      }
    } catch (e) {
      hcLog("openDataManagement error", e);
    }
    await this.openSettings();
  },

  /**
   * Best-effort open to this app's Health Connect permission screen.
   * Falls back to generic Health Connect settings when OEM routing differs.
   */
  async openAppPermissions(): Promise<void> {
    try {
      const { Linking } =
        require("react-native") as typeof import("react-native");
      const pkg = encodeURIComponent(getPackageName());
      const deepLinks = [
        `intent://permissions/apps?package=${pkg}#Intent;scheme=healthconnect;package=com.google.android.apps.healthdata;end`,
        `intent://permissions#Intent;scheme=healthconnect;package=com.google.android.apps.healthdata;end`,
        `intent://onboarding?package_name=${pkg}#Intent;scheme=healthconnect;package=com.google.android.apps.healthdata;end`,
        "healthconnect://settings/permissions",
      ];
      for (const link of deepLinks) {
        try {
          await Linking.openURL(link);
          return;
        } catch {
          hcLog(`openAppPermissions link failed: ${link}`);
        }
      }
    } catch (e) {
      hcLog("openAppPermissions deep-link error", e);
    }
    await this.openSettings();
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
      hcLog("openInstallPage error", e);
    }
  },

  // ── Reset ────────────────────────────────────────────────────────────────────

  /** Clear in-memory today total after local midnight (HC range reads still authoritative). */
  resetTodayStepCache(): void {
    _cachedTodaySteps = 0;
    _cachedTodayDate = "";
    _cachedTodayOrigins = [];
    hcLog("today cache reset for user/date scope change");
  },

  /**
   * Compatibility helpers used by newer setup/diagnostic modules.
   * Kept lightweight so feature/priya step core stays intact.
   */
  /** Drop permission cache only — keep today's HC step total. */
  invalidatePermissionCache(): void {
    _permCache = null;
    _permBackoffUntil = 0;
  },

  invalidateCachesForForeground(): void {
    this.resetTodayStepCache();
    this.invalidatePermissionCache();
  },

  async openHealthConnectManagement(opts?: {
    preferredPackageName?: string;
  }): Promise<void> {
    void opts;
    await this.openDataManagement();
  },

  async probeTodayStepFeed(): Promise<{
    readable: boolean;
    steps: number;
    recordHint: string;
    recordCount: number;
    dataOrigins: string[];
    hasHistoricalStepRecords: boolean;
    latestRecordEndTime?: string;
  }> {
    try {
      const today = await this.readTodaySteps();
      const steps = Math.max(0, today?.steps ?? this.getCachedTodaySteps());
      const todayOrigins = cachedTodayOrigins();
      const recentOrigins = await this.readRecentStepOrigins(14);
      const dataOrigins = [...new Set([...todayOrigins, ...recentOrigins])];
      const readable = (await this.getPermissionStatus()) === "granted";
      return {
        readable,
        steps,
        recordHint: readable
          ? dataOrigins.some((o) => o.toLowerCase().includes("shealth"))
            ? `Samsung Health is writing steps (${steps.toLocaleString()} today)`
            : steps > 0
              ? `Receiving steps (${steps.toLocaleString()} today)`
              : "Health Connect readable"
          : "Allow WalkChamp Read Steps",
        recordCount: dataOrigins.length,
        dataOrigins,
        hasHistoricalStepRecords: steps > 0 || dataOrigins.length > 0,
      };
    } catch {
      return {
        readable: false,
        steps: 0,
        recordHint: "Could not verify Health Connect yet",
        recordCount: 0,
        dataOrigins: [],
        hasHistoricalStepRecords: false,
      };
    }
  },

  /**
   * Origins from recent Step records (not only today). Used to detect that
   * Samsung Health is connected even before today's sync lands.
   */
  async readRecentStepOrigins(days = 14): Promise<string[]> {
    const hc = loadHCModule();
    if (!hc || days <= 0) return [];
    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - Math.min(days, 30));
    start.setHours(0, 0, 0, 0);
    try {
      const res = await hc.readRecords("Steps", {
        timeRangeFilter: {
          operator: "between" as const,
          startTime: start.toISOString(),
          endTime: end.toISOString(),
        },
      });
      return normalizeHealthConnectOrigins(res.records ?? []);
    } catch {
      return [];
    }
  },

  reset(): void {
    _initialized = false;
    _permissionRequested = false;
    _cachedTodaySteps = 0;
    _cachedTodayDate = "";
    _cachedTodayOrigins = [];
    _availability = "not_supported";
  },
};
