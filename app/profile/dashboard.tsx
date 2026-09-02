import React from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import { ChallengeParticipationBreakdownCard } from "@/components/ChallengeParticipationBreakdownCard";
import { TouchableOpacity } from "@/components/HapticTouchableOpacity";
import { useColors } from "@/hooks/useColors";
import { useSafeLayout } from "@/hooks/useSafeLayout";
import { useAuth } from "@/context/AuthContext";
import { useChallengeParticipationBreakdown } from "@/hooks/useChallengeParticipationBreakdown";
import { rf, rs } from "@/utils/responsive";

/** Deep-link / legacy route — Profile tab uses inline expand instead. */
export default function ProfileDashboardScreen() {
  const colors = useColors();
  const { user } = useAuth();
  const { safeTop, safeBottom } = useSafeLayout();
  const { breakdown, loading } = useChallengeParticipationBreakdown(user?.id, true);

  return (
    <View style={[ds.container, { backgroundColor: colors.background }]}>
      <View style={[ds.header, { paddingTop: safeTop + 16, borderBottomColor: colors.border }]}>
        <TouchableOpacity
          onPress={() => router.back()}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Feather name="arrow-left" size={22} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={[ds.headerTitle, { color: colors.foreground }]} numberOfLines={1}>
          New dashboard
        </Text>
        <View style={{ width: 22 }} />
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[ds.body, { paddingBottom: safeBottom + 40 }]}
      >
        <ChallengeParticipationBreakdownCard
          breakdown={breakdown}
          loading={loading && breakdown === undefined}
        />
        {!loading && breakdown === undefined ? (
          <Text style={[ds.unavailable, { color: colors.mutedForeground }]}>
            Challenge participation is unavailable right now.
          </Text>
        ) : null}
      </ScrollView>
    </View>
  );
}

const ds = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: rs(20),
    paddingBottom: rs(16),
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTitle: { fontSize: rf(17), fontWeight: "700", flexShrink: 1 },
  body: { paddingHorizontal: rs(16), paddingTop: rs(20) },
  unavailable: { fontSize: rf(13), lineHeight: 18 },
});
