import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { getBadgeColor } from "@/utils/mockData";

interface BadgePillProps {
  badge: string;
  size?: "sm" | "md" | "lg";
}

export function BadgePill({ badge, size = "md" }: BadgePillProps) {
  const color = getBadgeColor(badge);

  const textSize = size === "sm" ? 10 : size === "lg" ? 14 : 12;
  const padH = size === "sm" ? 6 : size === "lg" ? 12 : 8;
  const padV = size === "sm" ? 2 : size === "lg" ? 5 : 3;

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
