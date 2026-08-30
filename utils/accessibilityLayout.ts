import { PixelRatio } from "react-native";

/** True when OS font scaling is above the default — use to opt into reflow layouts. */
export function isLargeAccessibilityFont(): boolean {
  return PixelRatio.getFontScale() > 1.08;
}
