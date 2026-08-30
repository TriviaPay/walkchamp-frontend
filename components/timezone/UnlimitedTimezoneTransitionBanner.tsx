/**
 * In-race timezone transition strip (Image 3).
 * Today uses backend viewerTimezone; next day uses pendingTimezone + effective day.
 */
import React, { memo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { rf } from "@/utils/responsive";

type Props = {
  todayTimezone: string;
  nextTimezone: string;
  effectiveDay: number;
  onPress?: () => void;
};

export const UnlimitedTimezoneTransitionBanner = memo(
  function UnlimitedTimezoneTransitionBanner({
    todayTimezone,
    nextTimezone,
    effectiveDay,
    onPress,
  }: Props) {
    const content = (
      <View style={styles.card}>
        <Feather name="globe" size={16} color="#E2E8F8" />
        <View style={styles.textCol}>
          <Text style={styles.today} numberOfLines={1}>
            Today: {todayTimezone}
          </Text>
          <Text style={styles.next} numberOfLines={1}>
            Next day: {nextTimezone} (starts from Day {effectiveDay})
          </Text>
        </View>
        {onPress ? <Feather name="chevron-right" size={18} color="#FFFFFF" /> : null}
      </View>
    );

    if (onPress) {
      return (
        <Pressable onPress={onPress} accessibilityRole="button">
          {content}
        </Pressable>
      );
    }
    return content;
  },
);

const styles = StyleSheet.create({
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginHorizontal: 12,
    marginTop: 8,
    marginBottom: 4,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(167,139,250,0.55)",
    backgroundColor: "rgba(22,16,42,0.95)",
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  textCol: { flex: 1, minWidth: 0 },
  today: {
    color: "#FFFFFF",
    fontSize: rf(13),
    fontWeight: "800",
  },
  next: {
    color: "rgba(186,170,230,0.95)",
    fontSize: rf(11),
    marginTop: 2,
  },
});
