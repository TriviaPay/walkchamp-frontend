import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import { useColors } from "@/hooks/useColors";
import { useSafeLayout } from "@/hooks/useSafeLayout";
import { TouchableOpacity } from "@/components/HapticTouchableOpacity";
import { TermsAndConditionsDocument } from "@/components/TermsAndConditionsDocument";
import { TERMS_DOCUMENT } from "@/constants/termsAndConditions";
import { rf } from "@/utils/responsive";

/**
 * Public Terms and Conditions route (`/terms`).
 * Available without requiring an authenticated session.
 */
export default function TermsScreen() {
  const colors = useColors();
  const { safeTop, safeBottom } = useSafeLayout();

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.header, { paddingTop: safeTop + 12, borderBottomColor: colors.border }]}>
        <TouchableOpacity
          onPress={() => {
            if (router.canGoBack()) router.back();
            else router.replace("/(tabs)/walk");
          }}
          style={styles.backBtn}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Feather name="arrow-left" size={22} color={colors.foreground} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={[styles.headerTitle, { color: colors.foreground }]}>Terms and Conditions</Text>
          <Text style={[styles.headerSub, { color: colors.mutedForeground }]}>
            Last Updated: {TERMS_DOCUMENT.lastUpdatedLabel}
          </Text>
        </View>
        <View style={{ width: 38 }} />
      </View>

      <TermsAndConditionsDocument contentBottomPad={safeBottom + 36} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backBtn: {
    width: 38,
    height: 38,
    alignItems: "center",
    justifyContent: "center",
  },
  headerCenter: { flex: 1, alignItems: "center" },
  headerTitle: { fontSize: rf(17), fontWeight: "800" },
  headerSub: { fontSize: rf(11), marginTop: 2, fontWeight: "600" },
});
