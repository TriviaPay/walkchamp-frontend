import { Platform, StatusBar } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

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

/** Floor for bottom safe-area: 16 on Android gesture nav, 20 on iOS/web. */
export function getSafeBottom(insetsBottom: number): number {
  return Math.max(insetsBottom, Platform.OS === "android" ? 16 : 20);
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
