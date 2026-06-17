import React, { useEffect, useRef } from "react";
import { Animated, Text, StyleSheet, View } from "react-native";
import Svg, { Circle, Defs, LinearGradient, Stop } from "react-native-svg";
import { useColors } from "@/hooks/useColors";

interface StepRingProps {
  steps: number;
  goal?: number;
  size?: number;
  strokeWidth?: number;
  label?: string;
  animated?: boolean;
}

export function StepRing({ steps, goal = 10000, size = 200, strokeWidth = 14, label, animated = true }: StepRingProps) {
  const colors = useColors();
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const rawProgress = Math.min(steps / goal, 1);
  const animProgress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (animated) {
      Animated.timing(animProgress, {
        toValue: rawProgress,
        duration: 800,
        useNativeDriver: false,
      }).start();
    } else {
      animProgress.setValue(rawProgress);
    }
  }, [rawProgress, animated, animProgress]);

  const strokeDashoffset = animProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [circumference, 0],
  });

  const percent = Math.round(rawProgress * 100);

  return (
    <View style={[styles.container, { width: size, height: size }]}>
      <Svg width={size} height={size} style={styles.svg}>
        <Defs>
          <LinearGradient id="ringGradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <Stop offset="0%" stopColor={colors.neonBlue} />
            <Stop offset="100%" stopColor={colors.neonGreen} />
          </LinearGradient>
        </Defs>
        {/* Background track */}
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={colors.border}
          strokeWidth={strokeWidth}
        />
        {/* Progress arc */}
        <AnimatedCircle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="url(#ringGradient)"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={strokeDashoffset}
          rotation="-90"
          origin={`${size / 2}, ${size / 2}`}
        />
      </Svg>
      <View style={styles.center}>
        <Text style={[styles.steps, { color: colors.foreground }]}>
          {steps.toLocaleString()}
        </Text>
        <Text style={[styles.label, { color: colors.mutedForeground }]}>
          {label ?? "steps"}
        </Text>
        <Text style={[styles.percent, { color: colors.primary }]}>
          {percent}%
        </Text>
      </View>
    </View>
  );
}

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

const styles = StyleSheet.create({
  container: {
    alignItems: "center",
    justifyContent: "center",
  },
  svg: {
    position: "absolute",
  },
  center: {
    alignItems: "center",
    justifyContent: "center",
  },
  steps: {
    fontSize: 36,
    fontWeight: "700",
    letterSpacing: -1,
  },
  label: {
    fontSize: 13,
    fontWeight: "500",
    marginTop: 2,
  },
  percent: {
    fontSize: 14,
    fontWeight: "600",
    marginTop: 4,
  },
});
