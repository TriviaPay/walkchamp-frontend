import React, { memo, useEffect, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useNetwork } from "@/context/NetworkContext";

/**
 * Non-intrusive offline banner. Hysteresis avoids flicker on brief drops.
 */
function OfflineBannerImpl() {
  const { isOnline } = useNetwork();
  const insets = useSafeAreaInsets();
  const [visible, setVisible] = useState(false);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!isOnline) {
      if (hideTimer.current) clearTimeout(hideTimer.current);
      // Short delay so transient blips don't flash the banner.
      showTimer.current = setTimeout(() => setVisible(true), 400);
    } else {
      if (showTimer.current) clearTimeout(showTimer.current);
      hideTimer.current = setTimeout(() => setVisible(false), 300);
    }
    return () => {
      if (showTimer.current) clearTimeout(showTimer.current);
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, [isOnline]);

  if (!visible) return null;

  return (
    <View
      pointerEvents="none"
      style={[styles.banner, { paddingTop: Math.max(insets.top, 6) }]}
      accessibilityLiveRegion="polite"
      accessibilityRole="alert"
    >
      <Text style={styles.text}>No internet connection</Text>
    </View>
  );
}

export const OfflineBanner = memo(OfflineBannerImpl);

const styles = StyleSheet.create({
  banner: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    zIndex: 9999,
    backgroundColor: "#3F1D1D",
    paddingBottom: 8,
    paddingHorizontal: 12,
    alignItems: "center",
  },
  text: {
    color: "#FECACA",
    fontSize: 12,
    fontWeight: "600",
  },
});
