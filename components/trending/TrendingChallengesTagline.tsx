/**
 * Rotating subtitle under “Trending Challenges” — one tagline, 60s cycle.
 */

import React, { memo, useCallback, useEffect, useRef, useState } from "react";
import {
  AccessibilityInfo,
  AppState,
  StyleSheet,
  Text,
  View,
  type TextStyle,
} from "react-native";
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import { rf } from "@/utils/responsive";
import {
  TRENDING_CHALLENGE_TAGLINES,
  TRENDING_TAGLINE_ANIM_MS,
  TRENDING_TAGLINE_LINE_HEIGHT,
  TRENDING_TAGLINE_ROTATE_MS,
  TRENDING_TAGLINE_SLIDE_PX,
  createTrendingTaglineRotator,
  getTrendingTaglineAt,
  nextTrendingTaglineIndex,
} from "@/utils/trendingChallengeTaglines";

type Props = {
  /** Existing subtitle text style from the section (color/size/weight). */
  textStyle?: TextStyle;
};

function TrendingChallengesTaglineInner({ textStyle }: Props) {
  const [index, setIndex] = useState(0);
  const [reducedMotion, setReducedMotion] = useState(false);
  const indexRef = useRef(0);
  const animatingRef = useRef(false);
  const appActiveRef = useRef(AppState.currentState === "active");

  const opacity = useSharedValue(1);
  const translateY = useSharedValue(0);

  useEffect(() => {
    indexRef.current = index;
  }, [index]);

  useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((v) => {
      if (mounted) setReducedMotion(v);
    });
    const sub = AccessibilityInfo.addEventListener("reduceMotionChanged", setReducedMotion);
    return () => {
      mounted = false;
      sub.remove();
    };
  }, []);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      appActiveRef.current = state === "active";
    });
    return () => sub.remove();
  }, []);

  const finishSwap = useCallback((next: number) => {
    setIndex(next);
    indexRef.current = next;
    opacity.value = 0;
    translateY.value = TRENDING_TAGLINE_SLIDE_PX;
    opacity.value = withTiming(1, {
      duration: TRENDING_TAGLINE_ANIM_MS / 2,
      easing: Easing.out(Easing.cubic),
    });
    translateY.value = withTiming(0, {
      duration: TRENDING_TAGLINE_ANIM_MS / 2,
      easing: Easing.out(Easing.cubic),
    });
    animatingRef.current = false;
  }, [opacity, translateY]);

  const clearAnimating = useCallback(() => {
    animatingRef.current = false;
  }, []);

  const advance = useCallback(() => {
    if (animatingRef.current) return;
    const next = nextTrendingTaglineIndex(indexRef.current);

    if (reducedMotion) {
      setIndex(next);
      indexRef.current = next;
      return;
    }

    animatingRef.current = true;
    opacity.value = withTiming(
      0,
      { duration: TRENDING_TAGLINE_ANIM_MS / 2, easing: Easing.in(Easing.cubic) },
      (finished) => {
        if (finished) runOnJS(finishSwap)(next);
        else runOnJS(clearAnimating)();
      },
    );
    translateY.value = withTiming(-TRENDING_TAGLINE_SLIDE_PX, {
      duration: TRENDING_TAGLINE_ANIM_MS / 2,
      easing: Easing.in(Easing.cubic),
    });
  }, [clearAnimating, finishSwap, opacity, reducedMotion, translateY]);

  const advanceRef = useRef(advance);
  advanceRef.current = advance;

  // One interval for the component lifetime — advance via stable ref.
  useEffect(() => {
    const rotator = createTrendingTaglineRotator({
      intervalMs: TRENDING_TAGLINE_ROTATE_MS,
      onAdvance: () => advanceRef.current(),
      isAppActive: () => appActiveRef.current,
    });
    rotator.start();
    return () => rotator.stop();
  }, []);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: translateY.value }],
  }));

  const label = getTrendingTaglineAt(index);

  return (
    <View
      style={styles.slot}
      accessibilityLiveRegion="polite"
      accessibilityLabel={label}
    >
      <Animated.View style={[styles.lineWrap, animatedStyle]}>
        <Text style={[styles.subtitle, textStyle]} numberOfLines={1} ellipsizeMode="tail">
          {label}
        </Text>
      </Animated.View>
    </View>
  );
}

export const TrendingChallengesTagline = memo(TrendingChallengesTaglineInner);

/** Exported for tests — confirms the constant list is wired. */
export const TRENDING_TAGLINE_COUNT = TRENDING_CHALLENGE_TAGLINES.length;

const styles = StyleSheet.create({
  slot: {
    marginTop: 2,
    height: TRENDING_TAGLINE_LINE_HEIGHT,
    justifyContent: "center",
    overflow: "hidden",
  },
  lineWrap: {
    height: TRENDING_TAGLINE_LINE_HEIGHT,
    justifyContent: "center",
  },
  subtitle: {
    color: "rgba(148,163,184,0.9)",
    fontSize: rf(11),
    fontWeight: "500",
    lineHeight: TRENDING_TAGLINE_LINE_HEIGHT,
  },
});
