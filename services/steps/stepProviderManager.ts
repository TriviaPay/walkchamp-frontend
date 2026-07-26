/**
 * Unified step provider manager — Walk + Live Race.
 *
 * Hybrid (ENABLE_LIVE_RACE_DEVICE_SENSOR):
 *   Daily: Health Connect (Android) / HealthKit (iOS) only — never TYPE_STEP_COUNTER
 *   Live race: TYPE_STEP_COUNTER / Core Motion path — never HC as low-latency feed
 *
 * When hybrid is off, legacy single-provider fallback remains for older builds.
 */

import { AppState, Platform } from "react-native";
import { FEATURE_FLAGS } from "@/config/featureFlags";
import { isExpoGo } from "./androidHealthConnectService";
import { androidHealthConnectProvider } from "./providers/androidHealthConnectProvider";
import { androidLegacySensorProvider } from "./providers/androidLegacySensorProvider";
import { iosHealthKitProvider } from "./providers/iosHealthKitProvider";
import { androidHCService } from "./androidHealthConnectService";
import {
  getRaceBaseline,
  setRaceBaseline,
  getRaceStepSeed,
  setRaceStepSeed,
} from "./raceBaselineStorage";
import type {
  StepPermissionResult,
  StepPermissionState,
  StepProvider,
  StepProviderId,
  StepReadResult,
  StepTrackingStatus,
} from "./stepProviderTypes";
import type { StepProgressSource } from "@/store/slices/raceProgressSlice";
import { STEP_SYNC_CONFIG } from "@/config/stepSyncConfig";
import { stepAudit } from "@/utils/stepAudit";
import { canonicalLiveRaceStepSource } from "./liveRaceSources";

export { isLegacyStepSourceId } from "./verifiedStepSources";

const PROVIDER_LABELS: Record<StepProviderId, string> = {
  ios_healthkit: "HealthKit",
  android_health_connect: "Health Connect",
  android_legacy_sensor: "Android Steps",
};

/** Daily verified provider (HC / HK). */
let _activeProvider: StepProvider | null = null;
/** Live race provider (TYPE_STEP_COUNTER). Parallel to daily — never swaps daily. */
let _liveRaceProvider: StepProvider | null = null;
let _watchStop: (() => void) | null = null;
let _liveRaceWatchStop: (() => void) | null = null;
let _initializing: Promise<void> | null = null;
let _diagnosticsLogged = false;
let _lastHcProbeAt = 0;
let _statusCache: { perm: StepPermissionState; at: number } | null = null;

const HC_PROBE_MS = 5 * 60_000;
const STATUS_CACHE_MS = 15_000;

function liveRaceSensorEnabled(): boolean {
  return FEATURE_FLAGS.ENABLE_LIVE_RACE_DEVICE_SENSOR === true;
}

function raceProvider(): StepProvider | null {
  if (liveRaceSensorEnabled() && _liveRaceProvider) return _liveRaceProvider;
  return _activeProvider;
}

function devLog(msg: string, ...args: unknown[]): void {
  if (__DEV__ && STEP_SYNC_CONFIG.STEP_DEBUG_VERBOSE) {
    console.log(`[StepProvider] ${msg}`, ...args);
  }
}

function sourceLog(msg: string): void {
  if (__DEV__ && STEP_SYNC_CONFIG.STEP_DEBUG_VERBOSE) {
    console.log(msg);
  }
}

async function probeHcManifestBlocked(): Promise<boolean> {
  return androidHCService.isRangeReadBlocked();
}

async function ensureActivityRecognitionPermission(): Promise<boolean> {
  const { ensureActivityRecognitionPermission: ensureActivity } = await import(
    "@/services/permissions/activityRecognitionPermissionService"
  );
  return ensureActivity();
}

/** Resolve Android live-race sensor without prompting (silent AR check). */
async function resolveAndroidLiveRaceProvider(): Promise<StepProvider | null> {
  if (!liveRaceSensorEnabled()) return null;
  if (isExpoGo()) return null;
  const available = await androidLegacySensorProvider.isAvailable();
  if (!available) return null;
  const { hasActivityRecognitionPermission } = await import(
    "@/services/permissions/activityRecognitionPermissionService"
  );
  const arOk = await hasActivityRecognitionPermission();
  if (!arOk) return null;
  const perm = await androidLegacySensorProvider.getPermissionStatus();
  if (perm === "denied") return null;
  return androidLegacySensorProvider;
}

/**
 * Daily Android selection.
 * Hybrid: Health Connect only (never TYPE_STEP_COUNTER for todaySteps).
 * Legacy mode: HC preferred, sensor fallback.
 */
async function trySelectAndroidProvider(
  preferHc = true,
  forceReselect = false,
): Promise<StepProvider | null> {
  if (
    !forceReselect &&
    _activeProvider &&
    (_activeProvider.providerId === "android_health_connect" ||
      _activeProvider.providerId === "ios_healthkit" ||
      (!liveRaceSensorEnabled() &&
        _activeProvider.providerId === "android_legacy_sensor"))
  ) {
    return _activeProvider;
  }

  // Hybrid: drop legacy if it somehow became daily.
  if (
    liveRaceSensorEnabled() &&
    _activeProvider?.providerId === "android_legacy_sensor"
  ) {
    _activeProvider = null;
  }

  const legacyAvailable = await androidLegacySensorProvider.isAvailable();
  const now = Date.now();
  const shouldProbeHc =
    preferHc &&
    (forceReselect || now - _lastHcProbeAt >= HC_PROBE_MS || !_activeProvider);

  if (shouldProbeHc) {
    _lastHcProbeAt = now;
    try {
      const init = await androidHCService.initialize();
      const hcBlocked = await probeHcManifestBlocked();
      const hcUsable =
        init.initialized &&
        init.availability === "available" &&
        !hcBlocked;

      if (hcUsable) {
        const hcPerm = await androidHealthConnectProvider.getPermissionStatus();
        devLog(`Health Connect status: usable=true permission=${hcPerm}`);
        if (hcPerm === "granted") {
          sourceLog(
            "[StepSource] selected=health_connect healthConnectAvailable=true",
          );
          return androidHealthConnectProvider;
        }
        if (liveRaceSensorEnabled()) {
          // Hybrid: keep HC as daily candidate even if not granted yet (setup UI).
          if (hcPerm !== "denied") {
            return androidHealthConnectProvider;
          }
          devLog("HC denied — hybrid daily has no sensor fallback");
          return null;
        }
        if (legacyAvailable) {
          devLog("HC not granted — preferring android_legacy_sensor");
          return androidLegacySensorProvider;
        }
        if (hcPerm !== "denied") {
          return androidHealthConnectProvider;
        }
      } else {
        devLog(
          `Health Connect not usable: availability=${init.availability} blocked=${hcBlocked}`,
        );
        if (liveRaceSensorEnabled()) {
          return null;
        }
      }
    } catch (e) {
      devLog("Health Connect selection error", e);
      if (liveRaceSensorEnabled()) return null;
    }
  }

  if (liveRaceSensorEnabled()) {
    return null;
  }

  if (legacyAvailable) {
    devLog("selected android_legacy_sensor");
    sourceLog(
      "[StepSource] selected=sensor healthConnectAvailable=false sensorAvailable=true",
    );
    return androidLegacySensorProvider;
  }

  return null;
}

async function selectProvider(forceReselect = false): Promise<StepProvider | null> {
  if (!FEATURE_FLAGS.REAL_STEP_TRACKING_ENABLED) return null;
  if (_activeProvider && !forceReselect) {
    if (Platform.OS === "android" && liveRaceSensorEnabled()) {
      _liveRaceProvider = await resolveAndroidLiveRaceProvider();
    }
    return _activeProvider;
  }

  const previousId = _activeProvider?.providerId ?? null;

  if (Platform.OS === "ios") {
    const ok = await iosHealthKitProvider.isAvailable();
    _activeProvider = ok ? iosHealthKitProvider : null;
    // Hybrid: daily stays HealthKit-labeled provider; live race also uses CMPedometer
    // via the same Pedometer bridge but never swaps daily scope.
    _liveRaceProvider = liveRaceSensorEnabled() && ok ? iosHealthKitProvider : _activeProvider;
    if (_activeProvider) {
      sourceLog("[StepSource] selected=healthkit");
    }
    if (previousId !== (_activeProvider?.providerId ?? null)) {
      stepAudit.noteSourceSwitch(previousId, _activeProvider?.providerId ?? null);
    }
    return _activeProvider;
  }

  if (Platform.OS !== "android") return null;

  _activeProvider = await trySelectAndroidProvider(true, forceReselect);

  if (!liveRaceSensorEnabled()) {
    if (
      !_activeProvider ||
      ((await _activeProvider.getPermissionStatus()) === "denied" &&
        (await androidLegacySensorProvider.isAvailable()))
    ) {
      const legacy = await trySelectAndroidProvider(false, forceReselect);
      if (legacy?.providerId === "android_legacy_sensor") {
        _activeProvider = legacy;
      }
    }
  }

  _liveRaceProvider = await resolveAndroidLiveRaceProvider();

  if (previousId !== (_activeProvider?.providerId ?? null)) {
    stepAudit.noteSourceSwitch(previousId, _activeProvider?.providerId ?? null);
  }

  if (__DEV__ && STEP_SYNC_CONFIG.STEP_DEBUG_VERBOSE) {
    console.log(
      `[StepProvider] daily=${_activeProvider?.providerId ?? "none"} liveRace=${_liveRaceProvider?.providerId ?? "none"} hybrid=${liveRaceSensorEnabled()}`,
    );
  }

  return _activeProvider;
}

async function runInitialize(forceReselect = false): Promise<void> {
  await selectProvider(forceReselect);
  await logStepSourceDiagnostics();
}

async function logStepSourceDiagnostics(): Promise<void> {
  if (!__DEV__ || !STEP_SYNC_CONFIG.STEP_DEBUG_VERBOSE || _diagnosticsLogged) return;
  _diagnosticsLogged = true;
  if (Platform.OS === "android") {
    let hcAvail = false;
    try {
      const init = await androidHCService.initialize();
      hcAvail = init.initialized && init.availability === "available";
    } catch {
      hcAvail = false;
    }
    const legacyAvail = await androidLegacySensorProvider.isAvailable();
    const id = _activeProvider?.providerId ?? null;
    const selected =
      id === "android_health_connect"
        ? "health_connect"
        : id === "android_legacy_sensor"
          ? "sensor"
          : "none";
    sourceLog(
      `[StepSource] selected=${selected} healthConnectAvailable=${hcAvail} sensorAvailable=${legacyAvail}`,
    );
    return;
  }
  if (Platform.OS === "ios") {
    const ok = await iosHealthKitProvider.isAvailable();
    sourceLog(
      `[StepSource] selected=${ok ? "healthkit" : "none"} healthKitAvailable=${ok}`,
    );
    return;
  }
  sourceLog("[StepSource] selected=none");
}

export const stepProviderManager = {
  /** Select the best provider — call on launch, resume, permission change. */
  async initialize(forceReselect = false): Promise<StepTrackingStatus> {
    if (_initializing) {
      await _initializing;
      return this.refreshStatus();
    }
    if (_activeProvider && !forceReselect) {
      return this.refreshStatus();
    }
    _initializing = runInitialize(forceReselect).finally(() => {
      _initializing = null;
    });
    await _initializing;
    return this.refreshStatus();
  },

  getActiveProviderId(): StepProviderId | null {
    return _activeProvider?.providerId ?? null;
  },

  getActiveProvider(): StepProvider | null {
    return _activeProvider;
  },

  /** True while JS startWatchingSteps subscription is live (Walk live pipeline). */
  isLiveWatchActive(): boolean {
    return _watchStop != null;
  },

  getVerificationLevel(): "verified" | "legacy" | "unsupported" {
    if (!_activeProvider) return "unsupported";
    return _activeProvider.verificationLevel;
  },

  getStepTrackingStatus(): StepTrackingStatus {
    const providerId = _activeProvider?.providerId ?? null;
    return {
      ready: providerId !== null,
      providerId,
      verificationLevel: _activeProvider?.verificationLevel ?? "legacy",
      permission: "unknown",
      sourceLabel: providerId ? PROVIDER_LABELS[providerId] : null,
    };
  },

  async refreshStatus(): Promise<StepTrackingStatus> {
    if (!_activeProvider) {
      await runInitialize(false);
    }
    if (!_activeProvider) {
      const status = this.getStepTrackingStatus();
      status.permission = "unavailable";
      status.ready = false;
      return status;
    }
    const now = Date.now();
    if (_statusCache && now - _statusCache.at < STATUS_CACHE_MS) {
      const status = this.getStepTrackingStatus();
      status.permission = _statusCache.perm;
      status.ready = _statusCache.perm === "granted";
      return status;
    }
    const perm = await _activeProvider.getPermissionStatus();
    _statusCache = { perm, at: now };
    const status = this.getStepTrackingStatus();
    status.permission = perm;
    status.ready = perm === "granted";
    return status;
  },

  async isTrackingReady(): Promise<boolean> {
    await this.initialize();
    if (!_activeProvider) return false;
    const perm = await _activeProvider.getPermissionStatus();
    return perm === "granted";
  },

  async getTodaySteps(): Promise<StepReadResult | null> {
    await this.initialize();
    if (!_activeProvider) return null;
    const perm = await _activeProvider.getPermissionStatus();
    if (perm !== "granted") return null;
    const result = await _activeProvider.getTodaySteps();
    devLog(`today steps ${result.steps} provider=${result.providerId}`);
    return result;
  },

  /** Background FGS poll — no HC re-probe, no permission spam. */
  async getTodayStepsForBackgroundPoll(): Promise<StepReadResult | null> {
    if (!_activeProvider) {
      await this.initialize();
    }
    if (!_activeProvider) return null;
    const cachedPerm = _statusCache?.perm;
    const perm =
      cachedPerm && cachedPerm === "granted"
        ? cachedPerm
        : await _activeProvider.getPermissionStatus();
    if (perm !== "granted") return null;
    return _activeProvider.getTodaySteps();
  },

  async getStepsForRange(start: Date, end: Date): Promise<StepReadResult | null> {
    await this.initialize();
    if (!_activeProvider) return null;
    return _activeProvider.getStepsForRange(start, end);
  },

  async getRaceSteps(
    raceId: string,
    raceStartAt: Date,
    userId: string,
    raceEndAt?: Date,
  ): Promise<StepReadResult | null> {
    await this.initialize();
    const provider = raceProvider();
    if (!provider) return null;
    return provider.getRaceSteps(raceId, raceStartAt, userId, raceEndAt);
  },

  async createRaceBaseline(raceId: string, userId: string): Promise<number> {
    await this.initialize();
    const provider = raceProvider();
    if (!provider?.createRaceBaseline) return 0;
    return provider.createRaceBaseline(raceId, userId);
  },

  async clearRaceBaseline(raceId: string, userId: string): Promise<void> {
    const provider = raceProvider();
    if (provider?.clearRaceBaseline) {
      await provider.clearRaceBaseline(raceId, userId);
    }
  },

  /**
   * True when live race uses device-sensor baseline math (Android TYPE_STEP_COUNTER).
   */
  usesRaceBaseline(): boolean {
    return raceProvider()?.providerId === "android_legacy_sensor";
  },

  /** True when the daily provider is Health Connect or HealthKit. */
  usesVerifiedStepSource(): boolean {
    const id = _activeProvider?.providerId;
    return id === "android_health_connect" || id === "ios_healthkit";
  },

  getDailyProviderId(): StepProviderId | null {
    return _activeProvider?.providerId ?? null;
  },

  getLiveRaceProviderId(): StepProviderId | null {
    return raceProvider()?.providerId ?? null;
  },

  isLiveRaceWatchActive(): boolean {
    return _liveRaceWatchStop != null;
  },

  /**
   * Ensure a race step baseline exists for the live-race sensor provider.
   */
  async ensureRaceBaseline(
    raceId: string,
    userId: string,
    seedSteps?: number,
  ): Promise<number> {
    const provider = raceProvider();
    if (!provider) return 0;
    if (provider.providerId !== "android_legacy_sensor") return 0;

    if (typeof seedSteps === "number" && Number.isFinite(seedSteps)) {
      await setRaceStepSeed(raceId, userId, seedSteps);
    }

    const existing = await getRaceBaseline(raceId, userId, "android_legacy_sensor");
    const seed =
      typeof seedSteps === "number" && Number.isFinite(seedSteps)
        ? Math.max(0, Math.floor(seedSteps))
        : await getRaceStepSeed(raceId, userId);

    if (existing !== null) {
      try {
        const today = await provider.getTodaySteps();
        const implied = Math.max(0, today.steps - existing);
        const seedVal = seed ?? 0;
        if (
          today.steps > 0 &&
          existing === 0 &&
          (implied > seedVal + 50 || (seed != null && implied !== seedVal))
        ) {
          const fixed = Math.max(0, today.steps - seedVal);
          await setRaceBaseline(raceId, userId, "android_legacy_sensor", fixed);
          return fixed;
        }
      } catch (e) {
        devLog("ensureRaceBaseline realign check failed", e);
      }
      return existing;
    }

    if (seed != null) {
      const today = await provider.getTodaySteps();
      if (today.steps <= 0) return 0;
      const baseline = Math.max(0, today.steps - seed);
      await setRaceBaseline(raceId, userId, "android_legacy_sensor", baseline);
      return baseline;
    }

    const baseline = await this.createRaceBaseline(raceId, userId);
    return baseline;
  },

  async alignRaceBaselineToRaceSteps(
    raceId: string,
    userId: string,
    serverConfirmedSteps: number,
  ): Promise<void> {
    if (!this.usesRaceBaseline()) return;
    const provider = raceProvider();
    if (!provider) return;
    try {
      const seed = Math.max(0, Math.floor(serverConfirmedSteps));
      await setRaceStepSeed(raceId, userId, seed);
      const today = await provider.getTodaySteps();
      if (today.steps <= 0) return;
      const newBaseline = Math.max(0, today.steps - seed);
      await setRaceBaseline(raceId, userId, "android_legacy_sensor", newBaseline);
    } catch (e) {
      devLog("alignRaceBaselineToRaceSteps error", e);
    }
  },

  async requestStepPermission(): Promise<StepPermissionResult> {
    if (Platform.OS === "android" && isExpoGo()) {
      return {
        status: "unavailable",
        providerId: null,
        message:
          "Step tracking requires the installed Walk Champ app. It does not work in Expo Go.",
      };
    }

    if (Platform.OS === "android") {
      const hcBlocked = androidHCService.isRangeReadBlocked();
      const legacyAvail = await androidLegacySensorProvider.isAvailable();

      // Daily: Health Connect only when hybrid is on.
      if (!hcBlocked) {
        try {
          const init = await androidHCService.initialize();
          if (init.availability === "needs_update") {
            return {
              status: "unavailable",
              providerId: null,
              message: "Update Health Connect from the Play Store to continue.",
            };
          }
          if (init.availability === "not_installed") {
            return {
              status: "unavailable",
              providerId: null,
              message: "Install Health Connect to track verified steps.",
            };
          }
          const hcUsable =
            init.initialized && init.availability === "available";
          if (hcUsable) {
            const hcResult =
              await androidHealthConnectProvider.requestPermission();
            if (hcResult.status === "granted") {
              _activeProvider = androidHealthConnectProvider;
              _statusCache = { perm: "granted", at: Date.now() };
              _liveRaceProvider = await resolveAndroidLiveRaceProvider();
              return { ...hcResult, message: "Step tracking is ready." };
            }
            if (liveRaceSensorEnabled()) {
              return {
                ...hcResult,
                message:
                  hcResult.message ??
                  "Walk Champ needs Health Connect step access for verified daily tracking.",
              };
            }
            devLog("HC not granted — trying legacy fallback (non-hybrid)");
          }
        } catch (e) {
          if (liveRaceSensorEnabled()) {
            return {
              status: "unavailable",
              providerId: null,
              message: "Health Connect is required for verified daily steps.",
            };
          }
          devLog("HC permission request failed — using legacy", e);
        }
      }

      if (liveRaceSensorEnabled()) {
        return {
          status: "unavailable",
          providerId: null,
          message: "Health Connect is required for verified daily steps.",
        };
      }

      if (legacyAvail) {
        const activityGranted = await ensureActivityRecognitionPermission();
        if (!activityGranted) {
          return {
            status: "denied",
            providerId: null,
            message:
              "Physical activity permission is required to track steps.",
          };
        }
        const legacyResult =
          await androidLegacySensorProvider.requestPermission();
        if (legacyResult.status === "granted") {
          _activeProvider = androidLegacySensorProvider;
          _liveRaceProvider = androidLegacySensorProvider;
          return {
            ...legacyResult,
            message: "Step tracking is ready using Android Steps.",
          };
        }
        return legacyResult;
      }

      return {
        status: "unavailable",
        providerId: null,
        message: "Step tracking is not available on this device.",
      };
    }

    await this.initialize(true);
    const result = await iosHealthKitProvider.requestPermission();
    if (result.status === "granted") {
      _activeProvider = iosHealthKitProvider;
      return { ...result, message: "Step tracking is ready." };
    }
    return result;
  },

  /** Daily Walk watch — HC / HealthKit only under hybrid (never sensor). */
  async startWatchingSteps(
    callback: (result: StepReadResult) => void,
  ): Promise<() => void> {
    await this.initialize();
    this.stopWatchingSteps();
    const provider = _activeProvider;
    if (!provider?.startWatchingSteps) return () => {};
    if (
      liveRaceSensorEnabled() &&
      provider.providerId === "android_legacy_sensor"
    ) {
      return () => {};
    }
    stepAudit.noteProviderStart(provider.providerId);
    stepAudit.noteWatchListenerDelta(1, provider.providerId);
    _watchStop = await provider.startWatchingSteps(callback);
    return () => this.stopWatchingSteps();
  },

  stopWatchingSteps(): void {
    if (_watchStop) {
      try {
        _watchStop();
      } catch (e) {
        if (__DEV__) devLog("stopWatchingSteps cleanup error", e);
      }
      _watchStop = null;
      stepAudit.noteWatchListenerDelta(-1, _activeProvider?.providerId);
      stepAudit.noteProviderStop(_activeProvider?.providerId);
    }
    if (_activeProvider?.providerId !== "android_legacy_sensor") {
      _activeProvider?.stopWatchingSteps?.();
    }
  },

  /** Live race watch — TYPE_STEP_COUNTER. Does not change daily provider. */
  async startLiveRaceWatching(
    callback: (result: StepReadResult) => void,
  ): Promise<() => void> {
    await this.initialize();
    this.stopLiveRaceWatching();
    const ready = await this.ensureLiveRaceSensorReady();
    if (!ready) return () => {};
    const provider = _liveRaceProvider;
    if (!provider?.startWatchingSteps) return () => {};
    stepAudit.noteProviderStart(provider.providerId);
    _liveRaceWatchStop = await provider.startWatchingSteps(callback);
    return () => this.stopLiveRaceWatching();
  },

  stopLiveRaceWatching(): void {
    if (_liveRaceWatchStop) {
      try {
        _liveRaceWatchStop();
      } catch {
        /* ignore */
      }
      _liveRaceWatchStop = null;
      stepAudit.noteProviderStop(_liveRaceProvider?.providerId);
    }
    if (_activeProvider?.providerId !== "android_legacy_sensor") {
      _liveRaceProvider?.stopWatchingSteps?.();
    }
  },

  /** Request ACTIVITY_RECOGNITION (Android) / Motion (iOS) + arm live sensor for race (not daily). */
  async ensureLiveRaceSensorReady(): Promise<boolean> {
    if (!liveRaceSensorEnabled()) {
      return this.usesRaceBaseline() || Platform.OS === "ios";
    }
    await this.initialize();

    if (Platform.OS === "ios") {
      const avail = await iosHealthKitProvider.isAvailable();
      if (!avail) {
        _liveRaceProvider = null;
        return false;
      }
      const perm = await iosHealthKitProvider.getPermissionStatus();
      if (perm === "granted") {
        _liveRaceProvider = iosHealthKitProvider;
        return true;
      }
      const req = await iosHealthKitProvider.requestPermission();
      if (req.status === "granted") {
        _liveRaceProvider = iosHealthKitProvider;
        return true;
      }
      _liveRaceProvider = null;
      return false;
    }

    if (Platform.OS !== "android") return false;
    const ok = await ensureActivityRecognitionPermission();
    if (!ok) {
      _liveRaceProvider = null;
      return false;
    }
    _liveRaceProvider = await resolveAndroidLiveRaceProvider();
    if (!_liveRaceProvider) {
      const avail = await androidLegacySensorProvider.isAvailable();
      if (!avail) return false;
      const req = await androidLegacySensorProvider.requestPermission();
      if (req.status !== "granted") return false;
      _liveRaceProvider = androidLegacySensorProvider;
    }
    const perm = await _liveRaceProvider.getPermissionStatus();
    if (perm === "granted") return true;
    const req = await _liveRaceProvider.requestPermission();
    _liveRaceProvider = await resolveAndroidLiveRaceProvider();
    return req.status === "granted" || !!_liveRaceProvider;
  },

  /**
   * Hybrid: arm live race sensor only — never replaces HC daily provider.
   * Non-hybrid: promote legacy as daily (legacy behavior).
   */
  async switchToLegacyFallback(reason: string): Promise<boolean> {
    if (Platform.OS !== "android") return false;
    if (liveRaceSensorEnabled()) {
      devLog(`arming live race sensor: ${reason}`);
      return this.ensureLiveRaceSensorReady();
    }
    devLog(`switching daily to legacy fallback: ${reason}`);
    const previousId = _activeProvider?.providerId ?? null;
    this.stopWatchingSteps();
    const legacyAvail = await androidLegacySensorProvider.isAvailable();
    if (!legacyAvail) return false;
    const activityGranted = await ensureActivityRecognitionPermission();
    if (!activityGranted) return false;
    const perm = await androidLegacySensorProvider.getPermissionStatus();
    if (perm !== "granted") {
      const req = await androidLegacySensorProvider.requestPermission();
      if (req.status !== "granted") return false;
    }
    _activeProvider = androidLegacySensorProvider;
    _liveRaceProvider = androidLegacySensorProvider;
    stepAudit.noteSourceSwitch(previousId, "android_legacy_sensor");
    return true;
  },

  toWalkSyncSource(): string | undefined {
    switch (_activeProvider?.providerId) {
      case "ios_healthkit":
        return "ios_healthkit";
      case "android_health_connect":
        return "android_health_connect";
      case "android_legacy_sensor":
        return liveRaceSensorEnabled() ? undefined : "android_step_counter";
      default:
        return undefined;
    }
  },

  toRaceProgressSource(): StepProgressSource {
    if (liveRaceSensorEnabled()) {
      if (Platform.OS === "android") {
        const live = raceProvider();
        if (live?.providerId === "android_legacy_sensor" || _liveRaceProvider) {
          return canonicalLiveRaceStepSource("android");
        }
      }
      if (Platform.OS === "ios" && _activeProvider?.providerId === "ios_healthkit") {
        return canonicalLiveRaceStepSource("ios");
      }
    }
    const live = raceProvider();
    if (live?.providerId === "android_legacy_sensor") {
      return canonicalLiveRaceStepSource("android");
    }
    switch (_activeProvider?.providerId) {
      case "ios_healthkit":
        return "healthkit";
      case "android_health_connect":
        return "health_connect";
      case "android_legacy_sensor":
        return canonicalLiveRaceStepSource("android");
      default:
        return "unknown";
    }
  },

  reset(): void {
    this.stopWatchingSteps();
    this.stopLiveRaceWatching();
    _activeProvider = null;
    _liveRaceProvider = null;
  },
};

// Re-select provider when app returns to foreground (HC install / permission change).
// Guarded: never touch HC/native until JS runtime is ready (avoids reload NPE).
if (Platform.OS === "android") {
  AppState.addEventListener("change", (state) => {
    if (state !== "active") return;
    void (async () => {
      try {
        const { waitForAppStartupReady } = await import("@/services/appStartup");
        await waitForAppStartupReady();
        await stepProviderManager.initialize(true);
      } catch (e) {
        if (__DEV__) {
          console.warn("[StepProvider] foreground reselect skipped", e);
        }
      }
    })();
  });
}
