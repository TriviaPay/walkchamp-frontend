import React from "react";
import { TouchableOpacity as RNTouchableOpacity, type TouchableOpacityProps } from "react-native";
import * as Haptics from "expo-haptics";
import { useSound } from "@/context/SoundContext";

function HapticTouchableOpacityInner({ onPress, ...props }: TouchableOpacityProps) {
  const { soundEnabled } = useSound();

  const handlePress: TouchableOpacityProps["onPress"] = (e) => {
    if (soundEnabled) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {});
    }
    onPress?.(e);
  };

  return <RNTouchableOpacity {...props} onPress={handlePress} />;
}

export { HapticTouchableOpacityInner as HapticTouchableOpacity };
export { HapticTouchableOpacityInner as TouchableOpacity };
export type { TouchableOpacityProps };
