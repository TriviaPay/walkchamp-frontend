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
  if (ready) return;

  InteractionManager.runAfterInteractions(() => {
    const markReady = () => {
      if (ready) return;
      ready = true;
      console.log("[Startup] app ready");
      resolveReady?.();
      resolveReady = null;
    };

    // Release APK / EAS cold install: bridge + native modules need extra time.
    if (Platform.OS === "android") {
      setTimeout(markReady, __DEV__ ? 800 : 2000);
    } else {
      requestAnimationFrame(markReady);
    }
  });
}
