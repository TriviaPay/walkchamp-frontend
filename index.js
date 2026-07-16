/**
 * App entry — gesture-handler must load before any navigation / screen modules.
 */
import "react-native-gesture-handler";
import { LogBox, Platform } from "react-native";

LogBox.ignoreLogs([
  "Unable to activate keep awake",
  "JavaScriptContextHolder",
  "runtime not ready",
]);

function isBenignStartupError(msg: string): boolean {
  return (
    msg.includes("Unable to activate keep awake") ||
    msg.includes("JavaScriptContextHolder") ||
    msg.includes("[runtime not ready]") ||
    msg.includes("runtime not ready")
  );
}

if (typeof globalThis?.addEventListener === "function") {
  globalThis.addEventListener("unhandledrejection", (e) => {
    const msg = String(e?.reason?.message ?? e?.reason ?? "");
    if (isBenignStartupError(msg)) {
      e.preventDefault?.();
    }
  });
}

if (
  Platform.OS === "android" &&
  typeof global?.ErrorUtils?.setGlobalHandler === "function"
) {
  const prev = global.ErrorUtils.getGlobalHandler();
  global.ErrorUtils.setGlobalHandler((error, isFatal) => {
    const msg = String(error?.message ?? "");
    if (isBenignStartupError(msg)) {
      if (__DEV__) {
        console.warn("[Startup] swallowed bridge-not-ready error", msg.slice(0, 160));
      }
      return;
    }
    prev(error, isFatal);
  });
}

import "expo-router/entry";
