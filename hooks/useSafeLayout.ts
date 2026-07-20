import { Platform, StatusBar } from "react-native";
import {
  initialWindowMetrics,
  useSafeAreaInsets,
} from "react-native-safe-area-context";

/**
 * Returns a safe top inset that never clips status bar / notch / Dynamic Island.
 * - Android: uses StatusBar.currentHeight (falls back to 24)
 * - iOS / Expo web: minimum 60 — covers Dynamic Island (~59 px) and notch (~44 px);
 *   on real devices insets.top is always reported accurately and wins via Math.max.
 */
export function getSafeTop(insetsTop: number): number {
  return Math.max(
    insetsTop,
    Platform.OS === "android" ? (StatusBar.currentHeight ?? 24) : 60,
  );
}

/**
 * Bottom inset for home indicator / Android 3-button navigation bar.
 * Some Samsung devices report 0 until edge-to-edge metrics are ready — fall back
 * to initialWindowMetrics, then a conservative Android minimum (48 px).
 */
export function getSafeBottom(insetsBottom: number): number {
  const androidMin = 48;
  const iosMin = 20;
  if (insetsBottom > 0) {
    return Math.max(insetsBottom, Platform.OS === "android" ? androidMin : iosMin);
  }
  const initialBottom = initialWindowMetrics?.insets.bottom ?? 0;
  if (initialBottom > 0) {
    return Math.max(initialBottom, Platform.OS === "android" ? androidMin : iosMin);
  }
  return Platform.OS === "android" ? androidMin : iosMin;
}

/**
 * Drop-in replacement for useSafeAreaInsets() with platform-aware fallbacks so
 * content never overlaps the status bar, notch, or home indicator on any device
 * or in the Expo web / Replit preview where insets are reported as 0.
 */
export function useSafeLayout() {
  const insets = useSafeAreaInsets();
  return {
    insets,
    safeTop: getSafeTop(insets.top),
    safeBottom: getSafeBottom(insets.bottom),
  };
}
