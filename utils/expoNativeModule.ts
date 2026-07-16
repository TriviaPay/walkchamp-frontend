/**
 * Typed helpers for optional expo-modules-core APIs that may be absent in type defs.
 * Never touch native modules until app startup marks the React runtime ready —
 * otherwise Android bridgeless mode throws JavaScriptContextHolder null NPEs.
 */

import { isAppStartupReady } from "@/services/appStartup";

type ExpoModulesCoreRuntime = typeof import("expo-modules-core") & {
  ensureNativeModulesAreInstalled?: () => void;
};

function isJsRuntimeError(error: unknown): boolean {
  const msg = String((error as { message?: string })?.message ?? error ?? "");
  return (
    msg.includes("JavaScriptContextHolder") ||
    msg.includes("runtime not ready") ||
    msg.includes("NullPointerException")
  );
}

export function ensureExpoNativeModulesInstalled(): void {
  if (!isAppStartupReady()) return;
  try {
    const ExpoModulesCore = require("expo-modules-core") as ExpoModulesCoreRuntime;
    ExpoModulesCore.ensureNativeModulesAreInstalled?.();
  } catch (error) {
    if (__DEV__ && !isJsRuntimeError(error)) {
      console.warn("[ExpoNativeModule] ensureNativeModulesAreInstalled failed", error);
    }
  }
}

export function requireOptionalExpoNativeModule<T>(moduleName: string): T | null {
  if (!isAppStartupReady()) return null;
  try {
    ensureExpoNativeModulesInstalled();
    const ExpoModulesCore = require("expo-modules-core") as typeof import("expo-modules-core");
    return ExpoModulesCore.requireOptionalNativeModule<T>(moduleName);
  } catch (error) {
    if (__DEV__ && !isJsRuntimeError(error)) {
      console.warn(`[ExpoNativeModule] ${moduleName} unavailable`, error);
    }
    return null;
  }
}
