/**
 * dynamicIconService — launcher icon by daily goal milestone (0 / 25 / 50 / 75 / 100 %).
 *
 * iOS: applies immediately via expo-alternate-app-icons.
 * Android home-screen icon is NOT switched at runtime. Enabling/disabling
 * launcher activity-aliases kills the process on many OEMs (Samsung especially)
 * even with DONT_KILL_APP and even after the app is backgrounded. The in-app
 * WalkProgressIcon still follows 0 / 25 / 50 / 75 / 100 % live.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import { ensureExpoNativeModulesInstalled, requireOptionalExpoNativeModule } from "@/utils/expoNativeModule";
import { AppState, Platform, type AppStateStatus } from "react-native";
import { getLocalDateStr } from "@/utils/timezone";
import { logger } from "@/utils/logger";
import {
  type DynamicAppIcon,
  iconForMilestone,
  milestoneForIconName,
  milestoneForProgress,
  normalizeDynamicAppIcon,
  shouldReplacePendingIcon,
} from "@/utils/dynamicAppIcon";

export {
  milestoneForProgress,
  iconForMilestone as iconNameForMilestone,
  type DynamicAppIcon,
} from "@/utils/dynamicAppIcon";

export const PROGRESS_ICON_SOURCES = {
  0: require("@/assets/icons/WalkChampProgress0.png"),
  25: require("@/assets/icons/WalkChampProgress25.png"),
  50: require("@/assets/icons/WalkChampProgress50.png"),
  75: require("@/assets/icons/WalkChampProgress75.png"),
  100: require("@/assets/icons/WalkChampProgress100.png"),
} as const;

const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? "";

const KEY_MILESTONE = "@dyn_icon_milestone";
const KEY_USER_ID = "@dyn_icon_user_id";
const KEY_DATE = "@dyn_icon_date";
const KEY_ENABLED = "@dyn_icon_enabled";
const KEY_PENDING_ICON = "@dyn_icon_pending_name";
const KEY_PENDING_MILESTONE = "@dyn_icon_pending_milestone";
const KEY_PENDING_DATE = "@dyn_icon_pending_date";

/** Delay after entering background before native apply (ms). */
const ANDROID_BACKGROUND_APPLY_DELAY_MS = 1_500;

/**
 * Never toggle Android launcher aliases from JS. Runtime PackageManager flips
 * crash the app. In-app progress icon does not use this path.
 */
const ANDROID_LAUNCHER_DISABLED = Platform.OS === "android";

let pendingIconName: DynamicAppIcon | null = null;
let pendingMilestone: number | null = null;
let pendingUserId: string | null = null;
let androidApplyInFlight = false;
let appStateListenerAttached = false;
let backgroundApplyTimer: ReturnType<typeof setTimeout> | null = null;
let checkDebounceTimer: ReturnType<typeof setTimeout> | null = null;
let notifyDebounceTimer: ReturnType<typeof setTimeout> | null = null;
let lastAppliedMilestoneMemory: number | null = null;
/** Defer native apply while Profile / sensitive UI is interacting. */
let uiSensitiveDepth = 0;

/** Single-flight: only one native set at a time; latest requested icon wins. */
let latestRequestedIcon: DynamicAppIcon | null = null;

type AndroidLauncherIconNative = {
  getLauncherIconName?: () => Promise<string | null>;
  setLauncherIcon?: (iconName: string | null) => Promise<boolean>;
};

let androidLauncherIconNative: AndroidLauncherIconNative | null | undefined;
/** True once resolved after app startup (success or confirmed missing). */
let androidLauncherIconNativeResolved = false;

export function progressIconSourceForSteps(steps: number, goal: number) {
  const safeSteps = Math.max(0, Math.floor(Number.isFinite(steps) ? steps : 0));
  const safeGoal = goal > 0 ? goal : 10_000;
  const milestone = milestoneForProgress(safeSteps, safeGoal);
  return (
    PROGRESS_ICON_SOURCES[milestone as keyof typeof PROGRESS_ICON_SOURCES] ??
    PROGRESS_ICON_SOURCES[0]
  );
}

function log(msg: string): void {
  // Prefer warn so Metro shows queue/apply status while diagnosing home-screen icons.
  if (__DEV__) {
    console.warn(`[DynamicIcon] ${msg}`);
  }
  logger.debug("DynamicIcon", msg);
}

function warn(msg: string): void {
  if (__DEV__) {
    console.warn(`[DynamicIcon] ${msg}`);
  }
  logger.warn("DynamicIcon", msg);
}

function cancelBackgroundApplyTimer(): void {
  if (backgroundApplyTimer) {
    clearTimeout(backgroundApplyTimer);
    backgroundApplyTimer = null;
  }
}

async function getAppliedMilestoneForToday(userId?: string): Promise<number | null> {
  try {
    const today = getLocalDateStr();
    const [storedMilestone, storedDate, storedUserId] = await Promise.all([
      AsyncStorage.getItem(KEY_MILESTONE),
      AsyncStorage.getItem(KEY_DATE),
      AsyncStorage.getItem(KEY_USER_ID),
    ]);
    if (storedDate !== today || storedMilestone == null) return null;
    if (userId && storedUserId && storedUserId !== userId) return null;
    const n = Number(storedMilestone);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

let appStateSub: { remove: () => void } | null = null;

function ensureAppStateListener(): void {
  if (appStateListenerAttached || Platform.OS !== "android") return;
  appStateListenerAttached = true;

  appStateSub?.remove();
  appStateSub = AppState.addEventListener("change", () => {
    // Retry pending applies on any state change (including returning to active).
    if (pendingIconName) scheduleAndroidBackgroundApply();
  });
}

function scheduleAndroidBackgroundApply(): void {
  if (!pendingIconName) return;
  if (uiSensitiveDepth > 0) {
    log(`defer apply — UI-sensitive period active icon=${pendingIconName}`);
    return;
  }

  // Never flip launcher aliases while the UI is visible — that crashes the app.
  if (AppState.currentState !== "background") {
    log(
      `queued until background icon=${pendingIconName} state=${AppState.currentState}`,
    );
    return;
  }

  cancelBackgroundApplyTimer();
  log(
    `apply scheduled in ${ANDROID_BACKGROUND_APPLY_DELAY_MS}ms for ${pendingIconName} state=${AppState.currentState}`,
  );
  backgroundApplyTimer = setTimeout(() => {
    backgroundApplyTimer = null;
    void flushPendingAndroidIcon();
  }, ANDROID_BACKGROUND_APPLY_DELAY_MS);
}

async function loadAlternateIconModule() {
  if (Platform.OS === "web") return null;
  const Constants = (await import("expo-constants")).default;
  if ((Constants.executionEnvironment as string) === "storeClient") {
    return null;
  }
  const mod = await import("expo-alternate-app-icons");
  if (!mod.supportsAlternateIcons) return null;
  return mod;
}

function getAndroidLauncherIconNative(): AndroidLauncherIconNative | null {
  if (Platform.OS !== "android") return null;
  if (androidLauncherIconNativeResolved) {
    return androidLauncherIconNative ?? null;
  }

  try {
    ensureExpoNativeModulesInstalled();
    const mod = requireOptionalExpoNativeModule<AndroidLauncherIconNative>(
      "WalkChampRaceProgress",
    );
    if (mod == null) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { isAppStartupReady } = require("@/services/appStartup") as {
        isAppStartupReady: () => boolean;
      };
      // Do not permanently cache a miss caused by startup-not-ready.
      if (!isAppStartupReady()) {
        return null;
      }
      androidLauncherIconNative = null;
      androidLauncherIconNativeResolved = true;
      warn(
        "WalkChampRaceProgress native module unavailable — home-screen icon cannot update",
      );
      return null;
    }
    androidLauncherIconNative = mod;
    androidLauncherIconNativeResolved = true;
    log("WalkChampRaceProgress launcher API ready");
    return mod;
  } catch {
    androidLauncherIconNative = null;
    androidLauncherIconNativeResolved = true;
    return null;
  }
}

async function getHighestMilestoneForToday(userId?: string): Promise<number> {
  const applied = await getAppliedMilestoneForToday(userId);
  const values = [
    applied,
    lastAppliedMilestoneMemory,
    pendingMilestone,
  ].filter((n): n is number => n != null && Number.isFinite(n));
  return values.length > 0 ? Math.max(...values) : 0;
}

async function setNativeIconOnce(iconName: DynamicAppIcon): Promise<boolean> {
  if (Platform.OS === "web") return false;

  if (Platform.OS === "android") {
    if (uiSensitiveDepth > 0) {
      log(`defer android apply — UI-sensitive icon=${iconName}`);
      return false;
    }
    if (AppState.currentState !== "background") {
      log(
        `defer android apply — not background icon=${iconName} state=${AppState.currentState}`,
      );
      return false;
    }
    const native = getAndroidLauncherIconNative();
    if (native?.setLauncherIcon) {
      try {
        const ok = await native.setLauncherIcon(iconName);
        if (ok) {
          log(
            `native launcher icon applied platform=android icon=${iconName} state=${AppState.currentState}`,
          );
          return true;
        }
        warn(`native launcher icon rejected platform=android icon=${iconName}`);
      } catch (err: unknown) {
        warn(
          `native launcher icon failed platform=android icon=${iconName} err=${err instanceof Error ? err.message : "unknown"}`,
        );
      }
    } else {
      warn(
        `android launcher API missing — cannot update home-screen icon (in-app progress icon still works)`,
      );
    }
    return false;
  }

  try {
    const mod = await loadAlternateIconModule();
    if (!mod) {
      warn(`alternate icon module unavailable platform=${Platform.OS}`);
      return false;
    }
    await mod.setAlternateAppIcon(iconName);
    log(`native icon applied platform=${Platform.OS} icon=${iconName}`);
    return true;
  } catch (err: unknown) {
    warn(
      `native icon failed platform=${Platform.OS} icon=${iconName} err=${err instanceof Error ? err.message : "unknown"}`,
    );
    return false;
  }
}

/** Single-flight + latest-wins queue for native icon changes. */
let nativeChain: Promise<void> = Promise.resolve();

async function setNativeIcon(iconName: DynamicAppIcon): Promise<boolean> {
  latestRequestedIcon = iconName;
  const requested = iconName;

  const result = new Promise<boolean>((resolve) => {
    nativeChain = nativeChain
      .catch(() => undefined)
      .then(async () => {
        const target = latestRequestedIcon ?? requested;
        try {
          const ok = await setNativeIconOnce(target);
          resolve(ok && latestRequestedIcon === target);
        } catch {
          resolve(false);
        }
      });
  });

  return result;
}

async function persistPendingQueue(
  iconName: DynamicAppIcon,
  milestone: number,
  userId?: string,
): Promise<void> {
  const today = getLocalDateStr();
  const pairs: [string, string][] = [
    [KEY_PENDING_ICON, iconName],
    [KEY_PENDING_MILESTONE, String(milestone)],
    [KEY_PENDING_DATE, today],
  ];
  if (userId) pairs.push([KEY_USER_ID, userId]);
  await AsyncStorage.multiSet(pairs);
}

async function persistAppliedState(
  milestone: number,
  userId?: string | null,
): Promise<void> {
  const today = getLocalDateStr();
  const pairs: [string, string][] = [
    [KEY_MILESTONE, String(milestone)],
    [KEY_DATE, today],
  ];
  if (userId) pairs.push([KEY_USER_ID, userId]);
  await AsyncStorage.multiSet(pairs);
  await AsyncStorage.multiRemove([
    KEY_PENDING_ICON,
    KEY_PENDING_MILESTONE,
    KEY_PENDING_DATE,
  ]);
  lastAppliedMilestoneMemory = milestone;
}

async function flushPendingAndroidIcon(): Promise<boolean> {
  if (Platform.OS !== "android" || androidApplyInFlight || !pendingIconName) {
    return false;
  }

  if (uiSensitiveDepth > 0) {
    log(`flush deferred — UI-sensitive icon=${pendingIconName}`);
    return false;
  }
  if (AppState.currentState !== "background") {
    log(
      `flush deferred — not background icon=${pendingIconName} state=${AppState.currentState}`,
    );
    return false;
  }

  androidApplyInFlight = true;
  const iconName = pendingIconName;
  const milestone = pendingMilestone;
  const userId = pendingUserId;

  try {
    // Retry briefly if native module was not ready on first touch after startup.
    for (let attempt = 0; attempt < 3; attempt++) {
      log(
        `flushing launcher icon: ${iconName} attempt=${attempt + 1} state=${AppState.currentState}`,
      );
      const ok = await setNativeIcon(iconName);
      if (ok && milestone != null) {
        await persistAppliedState(milestone, userId);
        pendingIconName = null;
        pendingMilestone = null;
        pendingUserId = null;
        log(`milestone ${milestone}% applied stored=${iconName}`);
        return true;
      }
      const native = getAndroidLauncherIconNative();
      if (native?.setLauncherIcon) break;
      await new Promise((r) => setTimeout(r, 400));
    }
    warn(`flush failed for ${iconName} — will retry on next step/background`);
    return false;
  } finally {
    androidApplyInFlight = false;
  }
}

async function getNativeIconName(): Promise<string | null> {
  try {
    if (Platform.OS === "android") {
      const native = getAndroidLauncherIconNative();
      if (native?.getLauncherIconName) {
        return await native.getLauncherIconName();
      }
    }
    const mod = await loadAlternateIconModule();
    if (!mod?.getAppIconName) return null;
    return mod.getAppIconName();
  } catch {
    return null;
  }
}

async function queueIconChange(
  milestone: number,
  userId?: string,
  opts?: { force?: boolean },
): Promise<void> {
  const iconName = iconForMilestone(milestone);

  if (Platform.OS === "ios") {
    const ok = await setNativeIcon(iconName);
    if (ok) await persistAppliedState(milestone, userId);
    return;
  }

  if (Platform.OS !== "android") return;

  ensureAppStateListener();

  const applied = await getAppliedMilestoneForToday(userId);
  const highest = await getHighestMilestoneForToday(userId);
  const targetMilestone = milestone;
  if (!opts?.force && targetMilestone < highest) {
    log(`skip downgrade queue ${targetMilestone}% < highest ${highest}%`);
    return;
  }
  if (!opts?.force && applied != null && targetMilestone < applied) {
    log(`skip downgrade ${targetMilestone}% < applied ${applied}%`);
    return;
  }

  const targetIcon = iconForMilestone(targetMilestone);
  if (
    pendingIconName === targetIcon &&
    pendingMilestone === targetMilestone
  ) {
    return;
  }
  if (
    !shouldReplacePendingIcon(pendingIconName, targetIcon, {
      force: opts?.force,
    })
  ) {
    return;
  }
  if (applied === targetMilestone && !opts?.force) {
    const nativeName = await getNativeIconName();
    const nativeMilestone = milestoneForIconName(
      nativeName ?? "WalkChampProgress0",
    );
    if (nativeMilestone === targetMilestone) return;
    log(
      `cache=${targetMilestone}% but native=${nativeName ?? "default"} — re-queue`,
    );
  }

  pendingIconName = targetIcon;
  pendingMilestone = targetMilestone;
  pendingUserId = userId ?? null;
  await persistPendingQueue(targetIcon, targetMilestone, userId);
  log(`queued ${targetIcon} (${targetMilestone}%) storedPending=${targetIcon}`);

  scheduleAndroidBackgroundApply();
}

async function restorePendingFromStorage(): Promise<void> {
  if (Platform.OS !== "android") return;
  try {
    const [pending, pendingMs, pendingDate] = await Promise.all([
      AsyncStorage.getItem(KEY_PENDING_ICON),
      AsyncStorage.getItem(KEY_PENDING_MILESTONE),
      AsyncStorage.getItem(KEY_PENDING_DATE),
    ]);
    const today = getLocalDateStr();
    if (!pending || pendingDate !== today) {
      if (pending && pendingDate !== today) {
        await AsyncStorage.multiRemove([
          KEY_PENDING_ICON,
          KEY_PENDING_MILESTONE,
          KEY_PENDING_DATE,
        ]);
      }
      return;
    }
    pendingIconName = normalizeDynamicAppIcon(pending);
    pendingMilestone =
      pendingMs != null ? Number(pendingMs) : milestoneForIconName(pending);
    log(`restored pending queue: ${pendingIconName}`);
    ensureAppStateListener();
    scheduleAndroidBackgroundApply();
  } catch {
    // best-effort
  }
}

async function reconcileMilestone(
  milestone: number,
  userId?: string,
  opts?: { force?: boolean },
): Promise<void> {
  if (ANDROID_LAUNCHER_DISABLED) {
    log("android launcher updates disabled via EXPO_PUBLIC_DYNAMIC_ICON_ANDROID_DISABLE");
    return;
  }
  if (!(await dynamicIconService.isEnabled())) return;

  const highest = await getHighestMilestoneForToday(userId);
  if (!opts?.force && milestone < highest) {
    log(`skip reconcile downgrade ${milestone}% < highest ${highest}%`);
    return;
  }

  const applied =
    lastAppliedMilestoneMemory ?? (await getAppliedMilestoneForToday(userId));
  if (!opts?.force && applied != null && milestone < applied) return;

  await queueIconChange(milestone, userId, opts);
}

/**
 * Flush any pending Android launcher icon once the app is backgrounded.
 * Call after notifyStepsChanged / AppState transitions. No-op while active.
 */
export function flushAndroidIconIfBackground(): void {
  if (Platform.OS !== "android" || ANDROID_LAUNCHER_DISABLED) return;
  ensureAppStateListener();
  scheduleAndroidBackgroundApply();
}

/** Call once after scheduleAppStartupReady — never at module import time. */
export async function initDynamicIconService(): Promise<void> {
  if (Platform.OS !== "android" || ANDROID_LAUNCHER_DISABLED) return;
  try {
    const { waitForAppStartupReady } = await import("@/services/appStartup");
    await waitForAppStartupReady();
    await restorePendingFromStorage();
    // Also try an immediate flush if something was pending and app is already active.
    if (pendingIconName) scheduleAndroidBackgroundApply();
  } catch {
    // best-effort — never crash startup for icon restore
  }
}

export const dynamicIconService = {
  flushAndroidIconIfBackground,

  /** Profile/settings — briefly defer native apply during sensitive UI. */
  beginUiSensitivePeriod(): void {
    uiSensitiveDepth += 1;
    cancelBackgroundApplyTimer();
  },

  endUiSensitivePeriod(): void {
    uiSensitiveDepth = Math.max(0, uiSensitiveDepth - 1);
    if (uiSensitiveDepth === 0 && pendingIconName) {
      scheduleAndroidBackgroundApply();
    }
  },

  async isEnabled(): Promise<boolean> {
    try {
      return (await AsyncStorage.getItem(KEY_ENABLED)) !== "false";
    } catch {
      return true;
    }
  },

  async setEnabled(enabled: boolean, userId?: string): Promise<void> {
    try {
      await AsyncStorage.setItem(KEY_ENABLED, enabled ? "true" : "false");
      if (!enabled) {
        await reconcileMilestone(0, userId, { force: true });
      } else {
        const applied = await getAppliedMilestoneForToday(userId);
        if (applied != null) {
          await reconcileMilestone(applied, userId);
        }
      }
    } catch {
      // best-effort
    }
  },

  async checkAndUpdate(opts?: {
    userId?: string;
    steps?: number;
    goal?: number;
    allowApiFetch?: boolean;
  }): Promise<void> {
    const run = async () => {
      try {
        if (opts?.steps !== undefined && opts?.goal !== undefined && opts.goal > 0) {
          await reconcileMilestone(
            milestoneForProgress(opts.steps, opts.goal),
            opts.userId,
          );
          return;
        }

        if (Platform.OS === "android" && !opts?.allowApiFetch) {
          const applied = await getAppliedMilestoneForToday(opts?.userId);
          if (applied != null) await reconcileMilestone(applied, opts?.userId);
          return;
        }

        const today = getLocalDateStr();
        const { getValidSession } = await import("@/services/authService");
        const session = await getValidSession();
        if (!session) return;

        const res = await fetch(`${API_BASE}/api/walk/today?localDate=${today}`, {
          headers: { Authorization: `Bearer ${session}` },
        }).catch(() => null);
        if (!res?.ok) return;

        const data = (await res.json()) as { today?: { steps: number; goal: number } };
        const steps = data.today?.steps ?? 0;
        const goal = Math.max(1, data.today?.goal ?? 10_000);
        await reconcileMilestone(
          milestoneForProgress(steps, goal),
          opts?.userId,
        );
      } catch (err: unknown) {
        warn(
          `checkAndUpdate failed err=${err instanceof Error ? err.message : "unknown"}`,
        );
      }
    };

    if (checkDebounceTimer) clearTimeout(checkDebounceTimer);
    checkDebounceTimer = setTimeout(() => {
      checkDebounceTimer = null;
      void run();
    }, Platform.OS === "android" ? 800 : 300);
  },

  notifyStepsChanged(steps: number, goal: number, userId?: string): void {
    if (ANDROID_LAUNCHER_DISABLED) return;
    if (goal <= 0) return;
    const milestone = milestoneForProgress(steps, goal);
    const run = () => {
      void (async () => {
        try {
          const highest = await getHighestMilestoneForToday(userId);
          if (steps <= 0 && milestone === 0 && highest > 0) {
            log(`ignore transient 0 steps (highest=${highest}%)`);
            return;
          }

          const applied = await getAppliedMilestoneForToday(userId);
          const targetIcon = iconForMilestone(milestone);
          if (
            applied === milestone &&
            pendingIconName === targetIcon &&
            pendingMilestone === milestone
          ) {
            return;
          }
          if (applied === milestone && milestone === 0 && steps <= 0) {
            return;
          }

          log(
            `steps update platform=${Platform.OS} requested=${targetIcon} stored=${applied ?? "none"}`,
          );
          void reconcileMilestone(milestone, userId).catch(() => {});
        } catch {
          // never throw into step pipeline
        }
      })();
    };
    if (AppState.currentState === "background") {
      if (notifyDebounceTimer) {
        clearTimeout(notifyDebounceTimer);
        notifyDebounceTimer = null;
      }
      run();
      return;
    }
    if (notifyDebounceTimer) clearTimeout(notifyDebounceTimer);
    notifyDebounceTimer = setTimeout(() => {
      notifyDebounceTimer = null;
      run();
    }, 400);
  },

  async onLogout(): Promise<void> {
    try {
      cancelBackgroundApplyTimer();
      pendingIconName = null;
      pendingMilestone = null;
      pendingUserId = null;
      lastAppliedMilestoneMemory = null;
      latestRequestedIcon = null;
      await AsyncStorage.multiRemove([
        KEY_MILESTONE,
        KEY_USER_ID,
        KEY_DATE,
        KEY_PENDING_ICON,
        KEY_PENDING_MILESTONE,
        KEY_PENDING_DATE,
      ]);
      if (Platform.OS === "android") {
        pendingIconName = "WalkChampProgress0";
        pendingMilestone = 0;
        await persistPendingQueue("WalkChampProgress0", 0);
        scheduleAndroidBackgroundApply();
      } else {
        await setNativeIcon("WalkChampProgress0");
      }
    } catch {
      // best-effort
    }
  },
};
