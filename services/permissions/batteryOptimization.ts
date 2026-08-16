import { Platform } from "react-native";
import { requireOptionalExpoNativeModule } from "@/utils/expoNativeModule";
import { storageGet, storageSet } from "@/utils/storage";

/**
 * Many OEMs (Xiaomi/MIUI, OPPO/ColorOS, Vivo, Samsung "Sleeping apps", etc.) kill the
 * whole WalkChamp process — not just background the foreground service — during a long
 * walk unless the user has explicitly whitelisted the app from battery optimization.
 * This is the single most common cause of "the app just closes by itself while walking"
 * on Android, and it happens even though the step-tracking foreground service + its
 * permissions are otherwise set up correctly.
 */

type BatteryOptimizationNative = {
  isIgnoringBatteryOptimizations?: () => Promise<boolean>;
  requestIgnoreBatteryOptimizations?: () => Promise<boolean>;
};

const PROMPTED_KEY = "walkchamp_battery_opt_prompted_v1";

let cachedNative: BatteryOptimizationNative | null | undefined;

function getNativeModule(): BatteryOptimizationNative | null {
  if (cachedNative !== undefined) return cachedNative;
  cachedNative =
    requireOptionalExpoNativeModule<BatteryOptimizationNative>(
      "WalkChampRaceProgress",
    ) ?? null;
  return cachedNative;
}

/** True when the OS is free to kill WalkChamp under memory/battery pressure. */
export async function isIgnoringBatteryOptimizations(): Promise<boolean> {
  if (Platform.OS !== "android") return true;
  const native = getNativeModule();
  if (!native?.isIgnoringBatteryOptimizations) return true;
  try {
    return await native.isIgnoringBatteryOptimizations();
  } catch {
    return true;
  }
}

/** Opens the system "ignore battery optimizations" dialog for this app. */
export async function requestIgnoreBatteryOptimizations(): Promise<boolean> {
  if (Platform.OS !== "android") return false;
  const native = getNativeModule();
  if (!native?.requestIgnoreBatteryOptimizations) return false;
  try {
    return (await native.requestIgnoreBatteryOptimizations()) === true;
  } catch {
    return false;
  }
}

/**
 * One-time (per install) nudge — call from a walk/race start flow. Never blocks the
 * walk itself; only surfaces the prompt if the OS can still kill the app and we
 * haven't already asked. Safe to call repeatedly (e.g. every walk start).
 */
export async function maybePromptIgnoreBatteryOptimizations(): Promise<void> {
  if (Platform.OS !== "android") return;
  try {
    const { isHomeStepSetupShellReady } = await import(
      "@/services/permissions/homePermissionFlow"
    );
    if (!isHomeStepSetupShellReady()) return;
    const alreadyIgnoring = await isIgnoringBatteryOptimizations();
    if (alreadyIgnoring) return;
    const alreadyPrompted = await storageGet<boolean>(PROMPTED_KEY);
    if (alreadyPrompted) return;
    // After login the home shell is still settling (setup / race restore).
    // Showing a modal immediately can close the activity on some OEMs.
    await new Promise((r) => setTimeout(r, 1600));
    if (!isHomeStepSetupShellReady()) return;
    await storageSet(PROMPTED_KEY, true);
    const { presentBatteryOptimizationPrompt } = await import(
      "@/components/BatteryOptimizationModal"
    );
    const choice = await presentBatteryOptimizationPrompt();
    if (choice === "allow") {
      void requestIgnoreBatteryOptimizations();
    }
  } catch {
    /* non-fatal — never block walk/race start over this */
  }
}
