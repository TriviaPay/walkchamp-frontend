/**
 * App entry — gesture-handler must load before any navigation / screen modules.
 */
import "react-native-gesture-handler";
import { LogBox, Platform } from "react-native";

LogBox.ignoreLogs(["Unable to activate keep awake"]);

if (typeof globalThis?.addEventListener === "function") {
  globalThis.addEventListener("unhandledrejection", (e) => {
    const msg = String(e?.reason?.message ?? e?.reason ?? "");
    if (msg.includes("Unable to activate keep awake")) {
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
    if (msg.includes("Unable to activate keep awake")) return;
    prev(error, isFatal);
  });
}

import "expo-router/entry";
