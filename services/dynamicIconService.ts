/**
 * dynamicIconService — launcher icon by daily goal milestone (0 / 25 / 50 / 75 / 100 %).
 *
 * iOS: applies immediately.
 * Android: queues while in-app, applies only in true background (avoids Profile crash).
 * KEY_MILESTONE is written only after a successful native apply — never on queue.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import { ensureExpoNativeModulesInstalled, requireOptionalExpoNativeModule } from "@/utils/expoNativeModule";
import { AppState, Platform, type AppStateStatus } from "react-native";
import { getLocalDateStr } from "@/utils/timezone";

const ICON_FOR_MILESTONE: Record<number, string> = {
  0: "WalkChampProgress0",
  25: "WalkChampProgress25",
  50: "WalkChampProgress50",
  75: "WalkChampProgress75",
  100: "WalkChampProgress100",
};

const MILESTONE_FOR_ICON: Record<string, number> = {
  WalkChampProgress0: 0,
  WalkChampProgress25: 25,
  WalkChampProgress50: 50,
  WalkChampProgress75: 75,
  WalkChampProgress100: 100,
};

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

/** Launcher alias toggles crash bridgeless RN during dev reload — release only. */
const SKIP_ANDROID_LAUNCHER_NATIVE =
  Platform.OS === "android" && __DEV__;

let pendingIconName: string | null = null;
let pendingMilestone: number | null = null;
let pendingUserId: string | null = null;
let androidApplyInFlight = false;
let appStateListenerAttached = false;
let backgroundApplyTimer: ReturnType<typeof setTimeout> | null = null;
let checkDebounceTimer: ReturnType<typeof setTimeout> | null = null;
let notifyDebounceTimer: ReturnType<typeof setTimeout> | null = null;
let lastAppliedMilestoneMemory: number | null = null;

type AndroidLauncherIconNative = {
  getLauncherIconName?: () => Promise<string | null>;
  setLauncherIcon?: (iconName: string | null) => Promise<boolean>;
};

let androidLauncherIconNative: AndroidLauncherIconNative | null | undefined;

function toMilestone(pct: number): number {
  if (pct >= 100) return 100;
  if (pct >= 75) return 75;
  if (pct >= 50) return 50;
  if (pct >= 25) return 25;
  return 0;
}

export function milestoneForProgress(steps: number, goal: number): number {
  if (goal <= 0) return 0;
  const pct = Math.min(100, Math.floor((steps / goal) * 100));
  return toMilestone(pct);
}

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
  console.warn(`[DynamicIcon] ${msg}`);
}

function iconNameForMilestone(milestone: number): string {
  return ICON_FOR_MILESTONE[milestone] ?? ICON_FOR_MILESTONE[0];
}

function milestoneForIconName(iconName: string): number {
  return MILESTONE_FOR_ICON[iconName] ?? 0;
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

function ensureAppStateListener(): void {
  if (appStateListenerAttached || Platform.OS !== "android") return;
  appStateListenerAttached = true;

  AppState.addEventListener("change", (state: AppStateStatus) => {
    if (state === "background" || state === "inactive") {
      scheduleAndroidBackgroundApply();
    }
  });
}

function scheduleAndroidBackgroundApply(): void {
  if (!pendingIconName) return;
  // Never flush while foreground — toggling launcher aliases can crash/kill the app.
  if (AppState.currentState === "active") return;

  cancelBackgroundApplyTimer();
  const delay =
    AppState.currentState === "background"
      ? ANDROID_BACKGROUND_APPLY_DELAY_MS
      : 800;
  log(`apply scheduled in ${delay}ms for ${pendingIconName}`);
  backgroundApplyTimer = setTimeout(() => {
    backgroundApplyTimer = null;
    void flushPendingAndroidIcon();
  }, delay);
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
  if (androidLauncherIconNative !== undefined) return androidLauncherIconNative;

  try {
    ensureExpoNativeModulesInstalled();
    androidLauncherIconNative =
      requireOptionalExpoNativeModule<AndroidLauncherIconNative>(
        "WalkChampRaceProgress",
      ) ?? null;
  } catch {
    androidLauncherIconNative = null;
  }

  return androidLauncherIconNative;
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

async function setNativeIcon(iconName: string): Promise<boolean> {
  if (Platform.OS === "web") return false;

  if (Platform.OS === "android") {
    // Launcher alias toggles must run only when backgrounded (OEM / ActivityManager crash).
    if (AppState.currentState === "active") {
      return false;
    }
    const native = getAndroidLauncherIconNative();
    if (native?.setLauncherIcon) {
      try {
        const ok = await native.setLauncherIcon(iconName);
        if (ok) {
          log(`native launcher icon applied: ${iconName}`);
          return true;
        }
      } catch (err: unknown) {
        log(
          `native launcher icon failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    if (AppState.currentState !== "background") {
      return false;
    }
  }

  try {
    const mod = await loadAlternateIconModule();
    if (!mod) return false;
    await mod.setAlternateAppIcon(iconName);
    log(`native icon applied: ${iconName}`);
    return true;
  } catch (err: unknown) {
    log(`native icon failed: ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}

async function persistPendingQueue(
  iconName: string,
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

  if (AppState.currentState === "active") {
    return false;
  }

  androidApplyInFlight = true;
  const iconName = pendingIconName;
  const milestone = pendingMilestone;
  const userId = pendingUserId;

  try {
    log(`flushing icon in background: ${iconName}`);
    const ok = await setNativeIcon(iconName);
    if (ok && milestone != null) {
      await persistAppliedState(milestone, userId);
      pendingIconName = null;
      pendingMilestone = null;
      pendingUserId = null;
      log(`milestone ${milestone}% applied`);
      return true;
    }
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
  const iconName = iconNameForMilestone(milestone);

  if (Platform.OS === "ios") {
    const ok = await setNativeIcon(iconName);
    if (ok) await persistAppliedState(milestone, userId);
    return;
  }

  if (Platform.OS !== "android") return;

  ensureAppStateListener();

  const applied = await getAppliedMilestoneForToday(userId);
  const highest = await getHighestMilestoneForToday(userId);
  let targetMilestone = milestone;
  if (!opts?.force && targetMilestone < highest) {
    log(`skip downgrade queue ${targetMilestone}% < highest ${highest}%`);
    return;
  }
  if (!opts?.force && applied != null && targetMilestone < applied) {
    log(`skip downgrade ${targetMilestone}% < applied ${applied}%`);
    return;
  }

  const targetIcon = iconNameForMilestone(targetMilestone);
  if (
    pendingIconName === targetIcon &&
    pendingMilestone === targetMilestone
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
  log(`queued ${targetIcon} (${targetMilestone}%)`);

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
    pendingIconName = pending;
    pendingMilestone = pendingMs != null ? Number(pendingMs) : milestoneForIconName(pending);
    log(`restored pending queue: ${pending}`);
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
  if (SKIP_ANDROID_LAUNCHER_NATIVE) return;
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

/** Call once after scheduleAppStartupReady — never at module import time. */
export async function initDynamicIconService(): Promise<void> {
  if (Platform.OS !== "android" || SKIP_ANDROID_LAUNCHER_NATIVE) return;
  try {
    const { waitForAppStartupReady } = await import("@/services/appStartup");
    await waitForAppStartupReady();
    await restorePendingFromStorage();
  } catch {
    // best-effort — never crash startup for icon restore
  }
}

export const dynamicIconService = {
  /** Profile/settings — cancel in-flight background timer only (does not block queue). */
  beginUiSensitivePeriod(): void {
    cancelBackgroundApplyTimer();
  },

  endUiSensitivePeriod(): void {
    if (pendingIconName && AppState.currentState === "background") {
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
    };

    if (checkDebounceTimer) clearTimeout(checkDebounceTimer);
    checkDebounceTimer = setTimeout(() => {
      checkDebounceTimer = null;
      void run();
    }, Platform.OS === "android" ? 800 : 300);
  },

  notifyStepsChanged(steps: number, goal: number, userId?: string): void {
    if (SKIP_ANDROID_LAUNCHER_NATIVE) return;
    if (goal <= 0) return;
    const milestone = milestoneForProgress(steps, goal);
    const run = () => {
      void (async () => {
        const highest = await getHighestMilestoneForToday(userId);
        if (steps <= 0 && milestone === 0 && highest > 0) {
          log(`ignore transient 0 steps (highest=${highest}%)`);
          return;
        }

        const applied = await getAppliedMilestoneForToday(userId);
        const targetIcon = iconNameForMilestone(milestone);
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

        log(`steps=${steps} goal=${goal} -> milestone=${milestone}%`);
        void reconcileMilestone(milestone, userId).catch(() => {});
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
        if (AppState.currentState === "background") {
          scheduleAndroidBackgroundApply();
        }
      } else {
        await setNativeIcon("WalkChampProgress0");
      }
    } catch {
      // best-effort
    }
  },
};
