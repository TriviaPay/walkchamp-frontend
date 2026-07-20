/**
 * App entry — gesture-handler must load before any navigation / screen modules.
 */
import "react-native-gesture-handler";
import { LogBox, Platform } from "react-native";

LogBox.ignoreLogs([
  "Unable to activate keep awake",
  "JavaScriptContextHolder",
  "runtime not ready",
  "Uncaught (in promise",
]);

function isBenignStartupError(msg: string): boolean {
  return (
    msg.includes("Unable to activate keep awake") ||
    msg.includes("JavaScriptContextHolder") ||
    msg.includes("[runtime not ready]") ||
    msg.includes("runtime not ready")
  );
}

// Expo / Hermes often reports keep-awake via console.error (not ErrorUtils).
const _consoleError = console.error.bind(console);
console.error = (...args) => {
  const flat = args
    .map((a) => {
      if (a instanceof Error) return a.message;
      if (typeof a === "string") return a;
      try {
        return String(a);
      } catch {
        return "";
      }
    })
    .join(" ");
  if (isBenignStartupError(flat)) return;
  _consoleError(...args);
};

if (typeof globalThis?.addEventListener === "function") {
  globalThis.addEventListener("unhandledrejection", (e) => {
    const msg = String(e?.reason?.message ?? e?.reason ?? "");
    if (isBenignStartupError(msg)) {
      e.preventDefault?.();
    }
  });
}

// Hermes promise rejection tracking (RN) — prevent redbox for keep-awake.
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const tracking = require("promise/setimmediate/rejection-tracking");
  tracking?.enable?.({
    allRejections: true,
    onUnhandled: (_id, error) => {
      const msg = String(error?.message ?? error ?? "");
      if (isBenignStartupError(msg)) return;
      _consoleError("Uncaught (in promise)", error);
    },
    onHandled: () => {},
  });
} catch {
  /* optional on some runtimes */
}

if (
  Platform.OS === "android" &&
  typeof global?.ErrorUtils?.setGlobalHandler === "function"
) {
  const prev = global.ErrorUtils.getGlobalHandler();
  global.ErrorUtils.setGlobalHandler((error, isFatal) => {
    const msg = String(error?.message ?? "");
    if (isBenignStartupError(msg)) {
      return;
    }
    prev(error, isFatal);
  });
}

import "expo-router/entry";
