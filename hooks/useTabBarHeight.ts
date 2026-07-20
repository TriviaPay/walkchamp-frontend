import { Platform } from "react-native";
import { useSafeLayout } from "./useSafeLayout";

const TAB_BAR_BASE = Platform.select({ ios: 49, android: 56, default: 84 })!;

export function useTabBarHeight(): number {
  const { safeBottom } = useSafeLayout();
  return TAB_BAR_BASE + safeBottom;
}
