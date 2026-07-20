import { LinearGradient } from "expo-linear-gradient";
import React from "react";
import { StyleProp, StyleSheet, ViewStyle } from "react-native";
import { useColors } from "@/hooks/useColors";

interface GradientCardProps {
  children: React.ReactNode;
  colors?: [string, string, ...string[]];
  style?: StyleProp<ViewStyle>;
  start?: { x: number; y: number };
  end?: { x: number; y: number };
}

export function GradientCard({ children, colors: gradColors, style, start, end }: GradientCardProps) {
  const colors = useColors();
  const defaultColors: [string, string] = [`${colors.primary}20`, `${colors.accent}10`];

  return (
    <LinearGradient
      colors={gradColors ?? defaultColors}
      start={start ?? { x: 0, y: 0 }}
      end={end ?? { x: 1, y: 1 }}
      style={[styles.card, { borderColor: colors.border }, style]}
    >
      {children}
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
  },
});
