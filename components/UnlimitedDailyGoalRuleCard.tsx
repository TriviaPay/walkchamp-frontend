/**
 * Compact Daily Goal Rule banner for Unlimited Challenge checkout (Step 5).
 * Visual + motion only — does not change rules, fees, or checkbox enablement.
 */

import React, { memo, useCallback, useEffect, useState } from "react";
import { AccessibilityInfo, StyleSheet, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import type { RoomVisibilityTheme } from "@/constants/createChallengeTheme";
import { rf, rs } from "@/utils/responsive";
import {
  DAILY_GOAL_RULE_A11Y_LABEL,
  DAILY_GOAL_RULE_PRIMARY,
  DAILY_GOAL_RULE_PULSE_CYCLES,
  DAILY_GOAL_RULE_TITLE,
  selectDailyGoalRuleTheme,
} from "@/utils/unlimitedDailyGoalRuleCard";

type Props = {
  visibility: RoomVisibilityTheme;
  attentionActive?: boolean;
  mutedForeground: string;
  foreground: string;
};

function useReducedMotion() {
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (mounted) setReducedMotion(enabled);
    });
    const subscription = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      setReducedMotion,
    );
    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);

  return reducedMotion;
}

function UnlimitedDailyGoalRuleCardInner({
  visibility,
  attentionActive = true,
  foreground,
}: Props) {
  const theme = selectDailyGoalRuleTheme(visibility);
  const reducedMotion = useReducedMotion();

  const opacity = useSharedValue(reducedMotion ? 1 : 0);
  const translateY = useSharedValue(reducedMotion ? 0 : 8);
  const glowOpacity = useSharedValue(0.22);
  const iconScale = useSharedValue(1);

  const stopPulse = useCallback(() => {
    cancelAnimation(glowOpacity);
    cancelAnimation(iconScale);
    glowOpacity.value = withTiming(0.18, { duration: 180 });
    iconScale.value = withTiming(1, { duration: 180 });
  }, [glowOpacity, iconScale]);

  useEffect(() => {
    if (reducedMotion) {
      opacity.value = 1;
      translateY.value = 0;
      return;
    }
    const ease = Easing.out(Easing.cubic);
    opacity.value = withTiming(1, { duration: 320, easing: ease });
    translateY.value = withTiming(0, { duration: 320, easing: ease });
  }, [opacity, reducedMotion, translateY]);

  useEffect(() => {
    if (!attentionActive || reducedMotion) {
      stopPulse();
      return;
    }
    const pulseMs = 900;
    const pauseMs = 300;
    glowOpacity.value = withDelay(
      280,
      withRepeat(
        withSequence(
          withTiming(0.5, { duration: pulseMs, easing: Easing.inOut(Easing.sin) }),
          withTiming(0.18, { duration: pulseMs, easing: Easing.inOut(Easing.sin) }),
          withTiming(0.18, { duration: pauseMs }),
        ),
        DAILY_GOAL_RULE_PULSE_CYCLES,
        false,
      ),
    );
    iconScale.value = withDelay(
      280,
      withRepeat(
        withSequence(
          withTiming(1.05, { duration: pulseMs, easing: Easing.inOut(Easing.sin) }),
          withTiming(1, { duration: pulseMs, easing: Easing.inOut(Easing.sin) }),
          withTiming(1, { duration: pauseMs }),
        ),
        DAILY_GOAL_RULE_PULSE_CYCLES,
        false,
      ),
    );
    return () => stopPulse();
  }, [attentionActive, glowOpacity, iconScale, reducedMotion, stopPulse]);

  const cardStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: translateY.value }],
  }));

  const glowStyle = useAnimatedStyle(() => ({
    opacity: glowOpacity.value,
  }));

  const iconStyle = useAnimatedStyle(() => ({
    transform: [{ scale: iconScale.value }],
  }));

  return (
    <Animated.View
      style={cardStyle}
      accessible
      accessibilityRole="summary"
      accessibilityLabel={DAILY_GOAL_RULE_A11Y_LABEL}
    >
      <Animated.View
        pointerEvents="none"
        style={[styles.glow, { shadowColor: theme.border }, glowStyle]}
      />
      <LinearGradient
        colors={[...theme.gradient]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[styles.card, { borderColor: theme.border }]}
      >
        <View style={styles.row}>
          <Animated.View style={[styles.iconTile, iconStyle]}>
            <Feather name="target" size={16} color={theme.icon} />
          </Animated.View>
          <View style={styles.copy}>
            <Text style={[styles.primary, { color: theme.primaryText }]}>
              {DAILY_GOAL_RULE_PRIMARY}
            </Text>
          </View>
        </View>
        <Text style={{ color: foreground, ...styles.srOnly }}>{DAILY_GOAL_RULE_TITLE}</Text>
      </LinearGradient>
    </Animated.View>
  );
}

export const UnlimitedDailyGoalRuleCard = memo(UnlimitedDailyGoalRuleCardInner);

const styles = StyleSheet.create({
  glow: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 16,
    shadowOpacity: 0.45,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 0 },
    elevation: 5,
  },
  card: {
    borderRadius: 16,
    borderWidth: 1.5,
    paddingHorizontal: 14,
    paddingVertical: 12,
    overflow: "hidden",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  iconTile: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.28)",
  },
  copy: {
    flex: 1,
    minWidth: 0,
  },
  primary: {
    fontSize: rf(13),
    fontWeight: "800",
    lineHeight: rs(18),
  },
  srOnly: {
    position: "absolute",
    width: 1,
    height: 1,
    opacity: 0,
  },
});
