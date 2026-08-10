import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { getBadgeColor } from "@/utils/mockData";
import { rf, rs } from "@/utils/responsive";

interface BadgePillProps {
  badge: string;
  size?: "sm" | "md" | "lg";
}

export function BadgePill({ badge, size = "md" }: BadgePillProps) {
  const color = getBadgeColor(badge);

  const textSize = size === "sm" ? rf(10) : size === "lg" ? rf(14) : rf(12);
  const padH = size === "sm" ? rs(6) : size === "lg" ? rs(12) : rs(8);
  const padV = size === "sm" ? rs(2) : size === "lg" ? rs(5) : rs(3);

  return (
    <View style={[styles.pill, { backgroundColor: color + "20", borderColor: color + "60", paddingHorizontal: padH, paddingVertical: padV }]}>
      <Text style={[styles.text, { color, fontSize: textSize }]}>{badge}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    borderRadius: 20,
    borderWidth: 1,
    alignSelf: "flex-start",
  },
  text: {
    fontWeight: "700",
  },
});
