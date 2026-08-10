/**
 * Safe back navigation for Expo Router nested stacks.
 * `router.canGoBack()` can report true at the root while the focused navigator
 * cannot handle GO_BACK (dev warning: "GO_BACK was not handled by any navigator").
 */

import { router, type Href } from "expo-router";
import type { NavigationProp, ParamListBase } from "@react-navigation/native";

export function safeGoBack(
  fallback: Href = "/(tabs)/walk",
  navigation?: NavigationProp<ParamListBase> | null,
): void {
  try {
    if (navigation) {
      const state = navigation.getState?.();
      // Prefer explicit stack depth — more reliable than canGoBack() across nested navigators.
      if (state && typeof state.index === "number" && state.index > 0) {
        navigation.goBack();
        return;
      }
      if (typeof navigation.canGoBack === "function" && navigation.canGoBack()) {
        navigation.goBack();
        return;
      }
    }
  } catch {
    /* fall through to replace */
  }

  try {
    router.replace(fallback);
  } catch {
    /* last resort — ignore */
  }
}
