/**
 * Unified step provider manager — single entry point for Walk + Live Race.
 *
 * iOS: HealthKit only (unchanged).
 * Android: Health Connect first, legacy TYPE_STEP_COUNTER fallback.
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
  StepProvider,
  StepProviderId,
  StepReadResult,
  StepTrackingStatus,
} from "./stepProviderTypes";
import { STEP_SYNC_CONFIG } from "@/config/stepSyncConfig";
import { stepAudit } from "@/utils/stepAudit";

const PROVIDER_LABELS: Record<StepProviderId, string> = {
  ios_healthkit: "HealthKit",
  android_health_connect: "Health Connect",
  android_legacy_sensor: "Android Steps",
};

let _activeProvider: StepProvider | null = null;
let _watchStop: (() => void) | null = null;
let _initializing: Promise<void> | null = null;
let _diagnosticsLogged = false;
let _lastHcProbeAt = 0;
let _statusCache: { perm: StepPermissionState; at: number } | null = null;

const HC_PROBE_MS = 5 * 60_000;
const STATUS_CACHE_MS = 15_000;

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

async function trySelectAndroidProvider(
  preferHc = true,
  forceReselect = false,
): Promise<StepProvider | null> {
  if (
    !forceReselect &&
    _activeProvider &&
    (_activeProvider.providerId === "android_legacy_sensor" ||
      _activeProvider.providerId === "android_health_connect" ||
      _activeProvider.providerId === "ios_healthkit")
  ) {
    return _activeProvider;
  }

  devLog("platform android");

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
      let hcUsable =
        init.initialized &&
        init.availability === "available" &&
        !hcBlocked;

      if (hcUsable) {
        const hcPerm = await androidHealthConnectProvider.getPermissionStatus();
        devLog(`Health Connect status: usable=true permission=${hcPerm}`);
        if (hcPerm === "granted") {
          devLog("selected android_health_connect");
          sourceLog("[StepSource] selected=health_connect healthConnectAvailable=true");
          return androidHealthConnectProvider;
        }
        // HC not granted — use legacy when available (unsupported / no manifest).
        if (legacyAvailable) {
          devLog("HC not granted — preferring android_legacy_sensor");
          return androidLegacySensorProvider;
        }
        if (hcPerm !== "denied") {
          devLog("Health Connect available, awaiting permission");
          return androidHealthConnectProvider;
        }
        devLog("Health Connect permission denied — trying legacy");
      } else {
        devLog(
          `Health Connect not usable: availability=${init.availability} blocked=${hcBlocked}`,
        );
      }
    } catch (e) {
      devLog("Health Connect selection error — trying legacy", e);
    }
  } else if (preferHc && legacyAvailable) {
    devLog("skipped HC probe — legacy sensor active");
  }

  if (legacyAvailable) {
    devLog("selected android_legacy_sensor");
    sourceLog("[StepSource] selected=sensor healthConnectAvailable=false sensorAvailable=true");
    return androidLegacySensorProvider;
  }

  devLog("no Android provider available");
  return null;
}

async function selectProvider(forceReselect = false): Promise<StepProvider | null> {
  if (!FEATURE_FLAGS.REAL_STEP_TRACKING_ENABLED) return null;
  if (_activeProvider && !forceReselect) return _activeProvider;

  const previousId = _activeProvider?.providerId ?? null;

  if (Platform.OS === "ios") {
    const ok = await iosHealthKitProvider.isAvailable();
    _activeProvider = ok ? iosHealthKitProvider : null;
    if (_activeProvider) devLog("selected ios_healthkit");
    if (_activeProvider) sourceLog("[StepSource] selected=healthkit");
    if (previousId !== (_activeProvider?.providerId ?? null)) {
      stepAudit.noteSourceSwitch(previousId, _activeProvider?.providerId ?? null);
    }
    return _activeProvider;
  }

  if (Platform.OS !== "android") return null;

  _activeProvider = await trySelectAndroidProvider(true, forceReselect);

  // HC unavailable — force legacy
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

  if (previousId !== (_activeProvider?.providerId ?? null)) {
    stepAudit.noteSourceSwitch(previousId, _activeProvider?.providerId ?? null);
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
    if (!_activeProvider) return null;
    return _activeProvider.getRaceSteps(raceId, raceStartAt, userId, raceEndAt);
  },

  async createRaceBaseline(raceId: string, userId: string): Promise<number> {
    await this.initialize();
    if (!_activeProvider?.createRaceBaseline) return 0;
    return _activeProvider.createRaceBaseline(raceId, userId);
  },

  async clearRaceBaseline(raceId: string, userId: string): Promise<void> {
    if (_activeProvider?.clearRaceBaseline) {
      await _activeProvider.clearRaceBaseline(raceId, userId);
    }
  },

  /**
   * True if the active provider relies on a stored delta baseline for race steps
   * (Android legacy sensor only). HC / HealthKit use time-range queries and never
   * need a baseline.
   */
  usesRaceBaseline(): boolean {
    return _activeProvider?.providerId === "android_legacy_sensor";
  },

  /** True when the active provider is Health Connect or HealthKit (verified, not sensor-only). */
  usesVerifiedStepSource(): boolean {
    const id = _activeProvider?.providerId;
    return id === "android_health_connect" || id === "ios_healthkit";
  },

  /**
   * Ensure a race step baseline exists for the active provider.
   * Returns the existing baseline if already stored, otherwise creates a fresh one.
   * For HC / HealthKit (range-based) this always returns 0 — no baseline needed.
   *
   * @param seedSteps Known race progress (e.g. server currentSteps on rejoin).
   *   When provided (including 0), baseline is derived as todaySteps - seedSteps so
   *   getRaceSteps() returns ~seedSteps. NEVER persist baseline while todaySteps is
   *   still 0 after account switch — that makes the later daily total look like race steps.
   */
  async ensureRaceBaseline(
    raceId: string,
    userId: string,
    seedSteps?: number,
  ): Promise<number> {
    if (!_activeProvider) return 0;
    if (_activeProvider.providerId !== "android_legacy_sensor") return 0;

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
        const today = await _activeProvider.getTodaySteps();
        const implied = Math.max(0, today.steps - existing);
        // baseline=0 with mid-day today steps is almost always corrupt after re-login.
        const seedVal = seed ?? 0;
        if (
          today.steps > 0 &&
          existing === 0 &&
          (implied > seedVal + 50 || (seed != null && implied !== seedVal))
        ) {
          const fixed = Math.max(0, today.steps - seedVal);
          await setRaceBaseline(raceId, userId, "android_legacy_sensor", fixed);
          devLog(
            `ensureRaceBaseline repaired raceId=${raceId} was=0 now=${fixed} seed=${seedVal} today=${today.steps}`,
          );
          return fixed;
        }
      } catch (e) {
        devLog("ensureRaceBaseline realign check failed", e);
      }
      devLog(`ensureRaceBaseline raceId=${raceId} existing=${existing}`);
      return existing;
    }

    if (seed != null) {
      const today = await _activeProvider.getTodaySteps();
      if (today.steps <= 0) {
        devLog(
          `ensureRaceBaseline defer persist raceId=${raceId} today=0 seed=${seed}`,
        );
        return 0;
      }
      const baseline = Math.max(0, today.steps - seed);
      await setRaceBaseline(raceId, userId, "android_legacy_sensor", baseline);
      devLog(
        `ensureRaceBaseline raceId=${raceId} created from seed=${seed} today=${today.steps} baseline=${baseline}`,
      );
      return baseline;
    }

    const baseline = await this.createRaceBaseline(raceId, userId);
    devLog(`ensureRaceBaseline raceId=${raceId} created=${baseline}`);
    return baseline;
  },

  /**
   * Realign the legacy sensor race baseline so that the next getRaceSteps() call
   * returns serverConfirmedSteps. Called when the server reports more steps than
   * the local delta counter — e.g. after the app was backgrounded for a long time.
   * No-op for HC / HealthKit.
   */
  async alignRaceBaselineToRaceSteps(
    raceId: string,
    userId: string,
    serverConfirmedSteps: number,
  ): Promise<void> {
    if (!this.usesRaceBaseline()) return;
    if (!_activeProvider) return;
    try {
      const seed = Math.max(0, Math.floor(serverConfirmedSteps));
      await setRaceStepSeed(raceId, userId, seed);
      const today = await _activeProvider.getTodaySteps();
      if (today.steps <= 0) {
        devLog(
          `alignRaceBaselineToRaceSteps defer raceId=${raceId} today=0 seed=${seed}`,
        );
        return;
      }
      const newBaseline = Math.max(0, today.steps - seed);
      await setRaceBaseline(raceId, userId, "android_legacy_sensor", newBaseline);
      devLog(
        `alignRaceBaselineToRaceSteps raceId=${raceId} newBaseline=${newBaseline} todaySteps=${today.steps} seed=${seed}`,
      );
    } catch (e) {
      devLog("alignRaceBaselineToRaceSteps error", e);
    }
  },

  async requestStepPermission(): Promise<StepPermissionResult> {
    if (Platform.OS === "android" && isExpoGo()) {
      return androidLegacySensorProvider.requestPermission();
    }

    if (Platform.OS === "android") {
      const hcBlocked = androidHCService.isRangeReadBlocked();
      const legacyAvail = await androidLegacySensorProvider.isAvailable();

      // Prefer Health Connect — OS-aggregated steps match Samsung Health / Google Fit.
      if (!hcBlocked) {
        try {
          const init = await androidHCService.initialize();
          const hcUsable =
            init.initialized && init.availability === "available";
          if (hcUsable) {
            const hcResult = await androidHealthConnectProvider.requestPermission();
            if (hcResult.status === "granted") {
              _activeProvider = androidHealthConnectProvider;
              return { ...hcResult, message: "Step tracking is ready." };
            }
            devLog("Health Connect permission not granted — trying legacy fallback");
          }
        } catch (e) {
          devLog("Health Connect permission request failed — using legacy", e);
        }
      }

      if (legacyAvail) {
        const activityGranted = await ensureActivityRecognitionPermission();
        if (!activityGranted) {
          return {
            status: "denied",
            providerId: null,
            message: "Physical activity permission is required to track steps.",
          };
        }
        const legacyResult = await androidLegacySensorProvider.requestPermission();
        if (legacyResult.status === "granted") {
          _activeProvider = androidLegacySensorProvider;
          return {
            ...legacyResult,
            message: "Step tracking is ready using Android Steps.",
          };
        }
        if (hcBlocked) {
          return legacyResult;
        }
      }

      if (legacyAvail) {
        const legacyResult = await androidLegacySensorProvider.requestPermission();
        if (legacyResult.status === "granted") {
          _activeProvider = androidLegacySensorProvider;
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

  async startWatchingSteps(
    callback: (result: StepReadResult) => void,
  ): Promise<() => void> {
    await this.initialize();
    this.stopWatchingSteps();
    if (!_activeProvider?.startWatchingSteps) return () => {};
    stepAudit.noteProviderStart(_activeProvider.providerId);
    stepAudit.noteWatchListenerDelta(1, _activeProvider.providerId);
    _watchStop = await _activeProvider.startWatchingSteps(callback);
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
    _activeProvider?.stopWatchingSteps?.();
  },

  /** Switch to legacy sensor when HC fails mid-session (Android only). */
  async switchToLegacyFallback(reason: string): Promise<boolean> {
    if (Platform.OS !== "android") return false;
    devLog(`switching to legacy fallback: ${reason}`);
    const previousId = _activeProvider?.providerId ?? null;
    this.stopWatchingSteps();
    const legacyAvail = await androidLegacySensorProvider.isAvailable();
    if (!legacyAvail) return false;
    const perm = await androidLegacySensorProvider.getPermissionStatus();
    if (perm !== "granted") {
      const req = await androidLegacySensorProvider.requestPermission();
      if (req.status !== "granted") return false;
    }
    _activeProvider = androidLegacySensorProvider;
    stepAudit.noteSourceSwitch(previousId, "android_legacy_sensor");
    stepAudit.log(
      {
        provider: "android_counter",
        eventOrigin: "source_switch",
        suspiciousIncreaseReason: `fallback:${reason}`,
      },
      true,
    );
    devLog("selected android_legacy_sensor (fallback)");
    return true;
  },

  /** Map provider to existing walk backend source field. */
  toWalkSyncSource(): string | undefined {
    switch (_activeProvider?.providerId) {
      case "ios_healthkit":
        return "ios_healthkit";
      case "android_health_connect":
        return "android_health_connect";
      case "android_legacy_sensor":
        return "android_step_counter";
      default:
        return undefined;
    }
  },

  /** Map provider to existing race progress source field. */
  toRaceProgressSource(): string {
    switch (_activeProvider?.providerId) {
      case "ios_healthkit":
        return "healthkit";
      case "android_health_connect":
        return "health_connect";
      case "android_legacy_sensor":
        return "android_step_counter";
      default:
        return "unknown";
    }
  },

  reset(): void {
    this.stopWatchingSteps();
    _activeProvider = null;
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
