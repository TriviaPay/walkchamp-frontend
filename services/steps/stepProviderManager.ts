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
import type {
  StepPermissionResult,
  StepProvider,
  StepProviderId,
  StepReadResult,
  StepTrackingStatus,
} from "./stepProviderTypes";

const PROVIDER_LABELS: Record<StepProviderId, string> = {
  ios_healthkit: "HealthKit",
  android_health_connect: "Health Connect",
  android_legacy_sensor: "Android Steps",
};

let _activeProvider: StepProvider | null = null;
let _watchStop: (() => void) | null = null;
let _initializing: Promise<void> | null = null;

function devLog(msg: string, ...args: unknown[]): void {
  if (__DEV__) console.log(`[StepProvider] ${msg}`, ...args);
}

async function probeHcManifestBlocked(): Promise<boolean> {
  if (androidHCService.isRangeReadBlocked()) return true;
  try {
    await androidHCService.readTodaySteps();
  } catch {
    /* readTodaySteps sets _readPermissionBlocked on SecurityException */
  }
  return androidHCService.isRangeReadBlocked();
}

async function trySelectAndroidProvider(
  preferHc = true,
): Promise<StepProvider | null> {
  devLog("platform android");

  const legacyAvailable = await androidLegacySensorProvider.isAvailable();

  if (preferHc) {
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
  }

  if (legacyAvailable) {
    devLog("selected android_legacy_sensor");
    return androidLegacySensorProvider;
  }

  devLog("no Android provider available");
  return null;
}

async function selectProvider(forceReselect = false): Promise<StepProvider | null> {
  if (!FEATURE_FLAGS.REAL_STEP_TRACKING_ENABLED) return null;
  if (_activeProvider && !forceReselect) return _activeProvider;

  if (Platform.OS === "ios") {
    const ok = await iosHealthKitProvider.isAvailable();
    _activeProvider = ok ? iosHealthKitProvider : null;
    if (_activeProvider) devLog("selected ios_healthkit");
    return _activeProvider;
  }

  if (Platform.OS !== "android") return null;

  _activeProvider = await trySelectAndroidProvider(true);

  // HC unavailable — force legacy
  if (
    !_activeProvider ||
    ((await _activeProvider.getPermissionStatus()) === "denied" &&
      (await androidLegacySensorProvider.isAvailable()))
  ) {
    const legacy = await trySelectAndroidProvider(false);
    if (legacy?.providerId === "android_legacy_sensor") {
      _activeProvider = legacy;
    }
  }

  return _activeProvider;
}

async function runInitialize(forceReselect = false): Promise<void> {
  await selectProvider(forceReselect);
}

export const stepProviderManager = {
  /** Select the best provider — call on launch, resume, permission change. */
  async initialize(forceReselect = false): Promise<StepTrackingStatus> {
    if (_initializing) {
      await _initializing;
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
    const perm = await _activeProvider.getPermissionStatus();
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

  async getStepsForRange(start: Date, end: Date): Promise<StepReadResult | null> {
    await this.initialize();
    if (!_activeProvider) return null;
    return _activeProvider.getStepsForRange(start, end);
  },

  async getRaceSteps(
    raceId: string,
    raceStartAt: Date,
    userId: string,
  ): Promise<StepReadResult | null> {
    await this.initialize();
    if (!_activeProvider) return null;
    return _activeProvider.getRaceSteps(raceId, raceStartAt, userId);
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

  async requestStepPermission(): Promise<StepPermissionResult> {
    if (Platform.OS === "android" && isExpoGo()) {
      return androidLegacySensorProvider.requestPermission();
    }

    await this.initialize(true);

    if (Platform.OS === "android") {
      const init = await androidHCService.initialize();
      const hcBlocked = await probeHcManifestBlocked();
      const hcUsable =
        init.initialized &&
        init.availability === "available" &&
        !hcBlocked;
      const legacyAvail = await androidLegacySensorProvider.isAvailable();
      const hcPerm = hcUsable
        ? await androidHealthConnectProvider.getPermissionStatus()
        : "unavailable";

      // Prefer legacy when HC is blocked, unavailable, or not yet granted.
      if (legacyAvail && (!hcUsable || hcPerm !== "granted")) {
        devLog(
          hcBlocked
            ? "READ_STEPS not declared — using Android Steps"
            : hcPerm !== "granted"
              ? "HC not granted — using Android Steps"
              : `Health Connect skipped (${init.availability}) — using Android Steps`,
        );
        const legacyResult = await androidLegacySensorProvider.requestPermission();
        if (legacyResult.status === "granted") {
          _activeProvider = androidLegacySensorProvider;
          return {
            ...legacyResult,
            message: "Step tracking is ready using Android Steps.",
          };
        }
        if (!hcUsable || hcBlocked) return legacyResult;
      }

      if (hcUsable) {
        const hcResult = await androidHealthConnectProvider.requestPermission();
        if (hcResult.status === "granted") {
          _activeProvider = androidHealthConnectProvider;
          return { ...hcResult, message: "Step tracking is ready." };
        }
        devLog("Health Connect permission not granted — trying legacy fallback");
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
    _watchStop = await _activeProvider.startWatchingSteps(callback);
    return () => this.stopWatchingSteps();
  },

  stopWatchingSteps(): void {
    if (_watchStop) {
      _watchStop();
      _watchStop = null;
    }
    _activeProvider?.stopWatchingSteps?.();
  },

  /** Switch to legacy sensor when HC fails mid-session (Android only). */
  async switchToLegacyFallback(reason: string): Promise<boolean> {
    if (Platform.OS !== "android") return false;
    devLog(`switching to legacy fallback: ${reason}`);
    this.stopWatchingSteps();
    const legacyAvail = await androidLegacySensorProvider.isAvailable();
    if (!legacyAvail) return false;
    const perm = await androidLegacySensorProvider.getPermissionStatus();
    if (perm !== "granted") {
      const req = await androidLegacySensorProvider.requestPermission();
      if (req.status !== "granted") return false;
    }
    _activeProvider = androidLegacySensorProvider;
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
if (Platform.OS === "android") {
  AppState.addEventListener("change", (state) => {
    if (state === "active") {
      void stepProviderManager.initialize(true);
    }
  });
}
