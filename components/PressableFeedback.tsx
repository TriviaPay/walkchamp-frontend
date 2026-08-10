/**
 * Global pressable with immediate visual + haptic feedback.
 *
 * Used app-wide via `TouchableOpacity` re-export so CTAs feel responsive
 * without changing layouts. Press animation never delays `onPress`.
 */

import React, { useCallback, useRef } from "react";
import {
  Animated,
  TouchableOpacity as RNTouchableOpacity,
  type GestureResponderEvent,
  type StyleProp,
  type TouchableOpacityProps,
  type ViewStyle,
} from "react-native";
import * as Haptics from "expo-haptics";
import { useSound } from "@/context/SoundContext";

const AnimatedTouchable = Animated.createAnimatedComponent(RNTouchableOpacity);

export type PressableFeedbackProps = TouchableOpacityProps & {
  /** Scale when pressed (default 0.97). */
  pressScale?: number;
  /** Skip haptic even when sound feedback is enabled. */
  disableHaptic?: boolean;
  hapticStyle?: Haptics.ImpactFeedbackStyle;
};

function PressableFeedbackInner({
  children,
  onPress,
  onPressIn,
  onPressOut,
  disabled,
  style,
  activeOpacity = 0.82,
  pressScale = 0.97,
  disableHaptic = false,
  hapticStyle = Haptics.ImpactFeedbackStyle.Medium,
  ...rest
}: PressableFeedbackProps) {
  const { soundEnabled } = useSound();
  const scale = useRef(new Animated.Value(1)).current;

  const handlePressIn = useCallback(
    (e: GestureResponderEvent) => {
      Animated.timing(scale, {
        toValue: pressScale,
        duration: 70,
        useNativeDriver: true,
      }).start();
      onPressIn?.(e);
    },
    [onPressIn, pressScale, scale],
  );

  const handlePressOut = useCallback(
    (e: GestureResponderEvent) => {
      Animated.spring(scale, {
        toValue: 1,
        friction: 6,
        tension: 420,
        useNativeDriver: true,
      }).start();
      onPressOut?.(e);
    },
    [onPressOut, scale],
  );

  const handlePress = useCallback(
    (e: GestureResponderEvent) => {
      if (!disableHaptic && soundEnabled) {
        void Haptics.impactAsync(hapticStyle).catch(() => {});
      }
      onPress?.(e);
    },
    [disableHaptic, hapticStyle, onPress, soundEnabled],
  );

  return (
    <AnimatedTouchable
      {...rest}
      disabled={disabled}
      activeOpacity={activeOpacity}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      onPress={handlePress}
      style={[style as StyleProp<ViewStyle>, { transform: [{ scale }] }]}
    >
      {children}
    </AnimatedTouchable>
  );
}

export const PressableFeedback = PressableFeedbackInner;
export default PressableFeedback;

/** Drop-in TouchableOpacity with press-scale + haptic (Sound gated). */
export const HapticTouchableOpacity = PressableFeedbackInner;
export const TouchableOpacity = PressableFeedbackInner;
export type { TouchableOpacityProps };
