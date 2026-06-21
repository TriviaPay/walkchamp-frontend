/**
 * dynamicIconService — switches the home-screen app icon based on the
 * logged-in user's daily goal progress milestone (0 / 25 / 50 / 75 / 100 %).
 *
 * Platform behaviour
 *  • iOS (dev-build / EAS): uses expo-alternate-app-icons; icons must be
 *    registered in app.json at build time. Switches immediately.
 *  • Android: uses the same package (Activity Alias path). Requires a
 *    development/production build; gracefully no-ops in Expo Go.
 *  • Unsupported / Expo Go: silently no-ops — never throws, never crashes.
 *
 * Usage
 *  • After every successful step sync:
 *      dynamicIconService.checkAndUpdate({ steps, goal }).catch(() => {});
 *  • On app foreground / launch:
 *      dynamicIconService.checkAndUpdate().catch(() => {});
 *  • On logout:
 *      dynamicIconService.onLogout().catch(() => {});
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";
import { getLocalDateStr } from "@/utils/timezone";

const ICON_FOR_MILESTONE: Record<number, string> = {
  0:   "WalkChampProgress0",
  25:  "WalkChampProgress25",
  50:  "WalkChampProgress50",
  75:  "WalkChampProgress75",
  100: "WalkChampProgress100",
};

/** In-app progress logo assets (same milestones as the dynamic launcher icon). */
export const PROGRESS_ICON_SOURCES = {
  0:   require("@/assets/icons/WalkChampProgress0.png"),
  25:  require("@/assets/icons/WalkChampProgress25.png"),
  50:  require("@/assets/icons/WalkChampProgress50.png"),
  75:  require("@/assets/icons/WalkChampProgress75.png"),
  100: require("@/assets/icons/WalkChampProgress100.png"),
} as const;

const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? "";

function toMilestone(pct: number): number {
  if (pct >= 100) return 100;
  if (pct >= 75)  return 75;
  if (pct >= 50)  return 50;
  if (pct >= 25)  return 25;
  return 0;
}

export function milestoneForProgress(steps: number, goal: number): number {
  if (goal <= 0) return 0;
  const pct = Math.min(100, Math.floor((steps / goal) * 100));
  return toMilestone(pct);
}

export function progressIconSourceForSteps(steps: number, goal: number) {
  return PROGRESS_ICON_SOURCES[milestoneForProgress(steps, goal) as keyof typeof PROGRESS_ICON_SOURCES];
}

const KEY_MILESTONE = "@dyn_icon_milestone";
const KEY_USER_ID   = "@dyn_icon_user_id";
const KEY_DATE      = "@dyn_icon_date";
const KEY_ENABLED   = "@dyn_icon_enabled";

async function loadAlternateIconModule() {
  if (Platform.OS === "web") return null;
  const Constants = (await import("expo-constants")).default;
  if ((Constants.executionEnvironment as string) === "storeClient") {
    console.log("[DynamicIcon] Expo Go — skipping native icon switch");
    return null;
  }
  const mod = await import("expo-alternate-app-icons");
  if (!mod.supportsAlternateIcons) {
    console.log("[DynamicIcon] device does not support alternate icons");
    return null;
  }
  return mod;
}

async function getActiveIconName(): Promise<string | null> {
  try {
    const mod = await loadAlternateIconModule();
    return mod?.getAppIconName?.() ?? null;
  } catch {
    return null;
  }
}

async function setNativeIcon(iconName: string | null): Promise<boolean> {
  if (Platform.OS === "web") {
    console.log("[DynamicIcon] unsupported platform: web");
    return false;
  }
  try {
    const mod = await loadAlternateIconModule();
    if (!mod) return false;
    await mod.setAlternateAppIcon(iconName);
    console.log("[DynamicIcon] icon set success:", iconName ?? "default");
    return true;
  } catch (err: unknown) {
    console.log(
      "[DynamicIcon] icon set failed:",
      err instanceof Error ? err.message : String(err),
    );
    return false;
  }
}

export const dynamicIconService = {
  async isEnabled(): Promise<boolean> {
    try {
      const val = await AsyncStorage.getItem(KEY_ENABLED);
      return val !== "false";
    } catch {
      return true;
    }
  },

  async setEnabled(enabled: boolean, userId?: string): Promise<void> {
    try {
      await AsyncStorage.setItem(KEY_ENABLED, enabled ? "true" : "false");
      if (!enabled) {
        await setNativeIcon("WalkChampProgress0");
        await AsyncStorage.setItem(KEY_MILESTONE, "0");
      } else {
        await this.checkAndUpdate({ userId });
      }
    } catch {
      // best-effort
    }
  },

  /**
   * Fetch current progress (or use provided steps/goal) and update the
   * launcher icon if the progress milestone has changed.
   * Always call fire-and-forget with .catch(() => {}).
   */
  async checkAndUpdate(opts?: {
    userId?: string;
    steps?: number;
    goal?: number;
  }): Promise<void> {
    if (!(await this.isEnabled())) return;

    try {
      const today = getLocalDateStr();
      let progressPercent: number;

      if (
        opts?.steps !== undefined &&
        opts?.goal !== undefined &&
        opts.goal > 0
      ) {
        progressPercent = Math.min(
          100,
          Math.floor((opts.steps / opts.goal) * 100),
        );
        console.log("[DynamicIcon] daily goal progress (inline):", progressPercent + "%");
      } else {
        const { getValidSession } = await import("@/services/authService");
        const session = await getValidSession();
        if (!session) {
          console.log("[DynamicIcon] no session — skipping icon update");
          return;
        }
        const res = await fetch(
          `${API_BASE}/api/walk/today?localDate=${today}`,
          { headers: { Authorization: `Bearer ${session}` } },
        ).catch(() => null);
        if (!res?.ok) {
          console.log("[DynamicIcon] could not fetch progress — skipping");
          return;
        }
        const data = (await res.json()) as {
          today?: { steps: number; goal: number };
        };
        const steps = data.today?.steps ?? 0;
        const goal  = Math.max(1, data.today?.goal ?? 10000);
        progressPercent = Math.min(100, Math.floor((steps / goal) * 100));
        console.log("[DynamicIcon] daily goal progress (fetched):", progressPercent + "%");
      }

      const milestone = toMilestone(progressPercent);
      const iconName  = ICON_FOR_MILESTONE[milestone];
      console.log("[DynamicIcon] calculated milestone:", milestone);

      const [storedMilestone, storedDate, storedUser, activeIconName] =
        await Promise.all([
          AsyncStorage.getItem(KEY_MILESTONE),
          AsyncStorage.getItem(KEY_DATE),
          AsyncStorage.getItem(KEY_USER_ID),
          getActiveIconName(),
        ]);

      const userMatch = !opts?.userId || storedUser === opts.userId;
      const cacheMatches =
        userMatch &&
        storedDate === today &&
        storedMilestone === String(milestone);
      const nativeMatches = activeIconName === iconName;

      if (cacheMatches && nativeMatches) {
        console.log("[DynamicIcon] icon already correct:", iconName);
        return;
      }

      if (cacheMatches && !nativeMatches) {
        console.log(
          "[DynamicIcon] cache ok but launcher is",
          activeIconName ?? "MainActivity",
          "— re-applying",
          iconName,
        );
      }

      console.log("[DynamicIcon] setting icon:", iconName);
      const ok = await setNativeIcon(iconName);
      if (ok) {
        const pairs: [string, string][] = [
          [KEY_MILESTONE, String(milestone)],
          [KEY_DATE,      today],
        ];
        if (opts?.userId) pairs.push([KEY_USER_ID, opts.userId]);
        await AsyncStorage.multiSet(pairs);
      }
    } catch (err: unknown) {
      console.log(
        "[DynamicIcon] error:",
        err instanceof Error ? err.message : String(err),
      );
    }
  },

  /** Call on logout — clears per-user state and resets icon to WalkChampProgress0. */
  async onLogout(): Promise<void> {
    try {
      await AsyncStorage.multiRemove([KEY_MILESTONE, KEY_USER_ID, KEY_DATE]);
      await setNativeIcon("WalkChampProgress0");
    } catch {
      // best-effort
    }
  },
};
