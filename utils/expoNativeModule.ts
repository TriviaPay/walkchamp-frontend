/**
 * Typed helpers for optional expo-modules-core APIs that may be absent in type defs.
 */

import { isAppStartupReady } from "@/services/appStartup";

type ExpoModulesCoreRuntime = typeof import("expo-modules-core") & {
  ensureNativeModulesAreInstalled?: () => void;
};

export function ensureExpoNativeModulesInstalled(): void {
  if (!isAppStartupReady()) return;
  try {
    const ExpoModulesCore = require("expo-modules-core") as ExpoModulesCoreRuntime;
    ExpoModulesCore.ensureNativeModulesAreInstalled?.();
  } catch {
    // Native bridge may be unavailable in web / test runtimes.
  }
}

export function requireOptionalExpoNativeModule<T>(moduleName: string): T | null {
  try {
    ensureExpoNativeModulesInstalled();
    const ExpoModulesCore = require("expo-modules-core") as typeof import("expo-modules-core");
    return ExpoModulesCore.requireOptionalNativeModule<T>(moduleName);
  } catch {
    return null;
  }
}
