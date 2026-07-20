import React from "react";
import { Image, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { progressIconSourceForStepsSafe } from "@/utils/stepProgress";

type WalkProgressIconProps = {
  steps?: number | null;
  goal?: number | null;
  size?: number;
  style?: StyleProp<ViewStyle>;
};

/**
 * Milestone progress icon (0 / 25 / 50 / 75 / 100 %) with static requires and fallback.
 * Never passes undefined to Image — safe in debug and release APK/IPA.
 */
export function WalkProgressIcon({
  steps = 0,
  goal = 10_000,
  size = 48,
  style,
}: WalkProgressIconProps) {
  const source = progressIconSourceForStepsSafe(steps ?? 0, goal ?? 10_000);

  return (
    <View style={[styles.wrap, { width: size, height: size }, style]}>
      <Image
        source={source}
        style={{ width: size, height: size }}
        resizeMode="contain"
        accessibilityIgnoresInvertColors
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: "center",
    justifyContent: "center",
  },
});
