/**
 * Cold-start gate for APK/fresh installs.
 * Defers native module work until the React bridge and first frame are ready.
 */

import { InteractionManager, Platform } from "react-native";

let ready = false;
let readyPromise: Promise<void> | null = null;
let resolveReady: (() => void) | null = null;

export function isAppStartupReady(): boolean {
  return ready;
}

export function waitForAppStartupReady(): Promise<void> {
  if (ready) return Promise.resolve();
  if (!readyPromise) {
    readyPromise = new Promise<void>((resolve) => {
      resolveReady = resolve;
    });
  }
  return readyPromise;
}

/** Call once after fonts/splash — before touching HC, FGS, OneSignal, or step native APIs. */
export function scheduleAppStartupReady(): void {
  // Fast Refresh / Metro reload can leave ready=true while the native JS context
  // is torn down — force a short re-arm so native module access stays gated.
  if (ready && __DEV__) {
    ready = false;
    readyPromise = null;
    resolveReady = null;
  }
  if (ready) return;

  if (!readyPromise) {
    readyPromise = new Promise<void>((resolve) => {
      resolveReady = resolve;
    });
  }

  InteractionManager.runAfterInteractions(() => {
    const markReady = () => {
      if (ready) return;
      ready = true;
      console.log("[Startup] app ready");
      try {
        const { perf } = require("@/utils/perfLogger") as typeof import("@/utils/perfLogger");
        perf.appStartupReady();
      } catch {
        /* optional */
      }
      resolveReady?.();
      resolveReady = null;
    };

    // Release APK / EAS cold install: short gate so Walk/Live can hydrate faster
    // while still avoiding bridgeless JavaScriptContextHolder NPEs on first frame.
    if (Platform.OS === "android") {
      setTimeout(markReady, __DEV__ ? 400 : 800);
    } else {
      requestAnimationFrame(markReady);
    }
  });
}
