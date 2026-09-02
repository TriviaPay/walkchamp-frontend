/**
 * Sticky timezone-change banner above the tab bar (Image 1).
 * Review opens the Walk overlay modal via UnlimitedTimezoneContext.
 */
import React, { memo } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { usePathname } from "expo-router";
import { useUnlimitedTimezone } from "@/context/UnlimitedTimezoneContext";
import { useTabBarHeight } from "@/hooks/useTabBarHeight";
import { FIXED_PILL_TEXT_PROPS } from "@/constants/accessibility";
import { rf } from "@/utils/responsive";

function shouldHideTimezoneStickyBanner(pathname: string | null | undefined): boolean {
  if (typeof pathname !== "string") return false;
  return (
    pathname.includes("/race/live-detail") ||
    pathname.includes("/live-track") ||
    pathname.includes("/race/unlimited-results")
  );
}

export const TIMEZONE_STICKY_BANNER_HEIGHT = 72;

export const TimezoneChangeStickyBanner = memo(function TimezoneChangeStickyBanner() {
  const { detectBanner, openReviewModal } = useUnlimitedTimezone();
  const tabBarHeight = useTabBarHeight();
  const pathname = usePathname();

  if (!detectBanner || shouldHideTimezoneStickyBanner(pathname)) return null;

  return (
    <View
      pointerEvents="box-none"
      style={[styles.anchor, { bottom: tabBarHeight + (Platform.OS === "ios" ? 4 : 8) }]}
    >
      <Pressable
        onPress={() => void openReviewModal()}
        accessibilityRole="button"
        accessibilityLabel="Review time zone change"
        style={styles.press}
      >
        <LinearGradient
          colors={["#2A1B4A", "#152038"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.card}
        >
          <View style={styles.iconBox}>
            <Feather name="globe" size={18} color="#E2E8F8" />
          </View>
          <View style={styles.textCol}>
            <Text style={styles.title} {...FIXED_PILL_TEXT_PROPS}>
              Time Zone Change Detected
            </Text>
            <Text style={styles.sub} {...FIXED_PILL_TEXT_PROPS}>
              {detectBanner.currentTimezone} → {detectBanner.deviceTimezone}
            </Text>
            <Text style={styles.hint} {...FIXED_PILL_TEXT_PROPS}>
              Your current day will continue as is.
            </Text>
          </View>
          <Text style={styles.review} {...FIXED_PILL_TEXT_PROPS}>Review ›</Text>
        </LinearGradient>
      </Pressable>
    </View>
  );
});

const styles = StyleSheet.create({
  anchor: {
    position: "absolute",
    left: 12,
    right: 12,
    zIndex: 40,
    elevation: 40,
  },
  press: { borderRadius: 14 },
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(167,139,250,0.45)",
    paddingVertical: 10,
    paddingHorizontal: 12,
    minHeight: TIMEZONE_STICKY_BANNER_HEIGHT - 8,
  },
  iconBox: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: "rgba(20,30,60,0.95)",
    alignItems: "center",
    justifyContent: "center",
  },
  textCol: { flex: 1, minWidth: 0 },
  title: {
    color: "#FFFFFF",
    fontSize: rf(13),
    fontWeight: "800",
  },
  sub: {
    color: "rgba(186,198,220,0.95)",
    fontSize: rf(11),
    marginTop: 1,
  },
  hint: {
    color: "rgba(160,174,200,0.9)",
    fontSize: rf(11),
    marginTop: 1,
  },
  review: {
    color: "#FFFFFF",
    fontSize: rf(13),
    fontWeight: "700",
    paddingLeft: 4,
  },
});
