import React, { useCallback, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { router, useFocusEffect } from "expo-router";
import { ChallengeParticipationBreakdownCard } from "@/components/ChallengeParticipationBreakdownCard";
import { TouchableOpacity } from "@/components/HapticTouchableOpacity";
import { useColors } from "@/hooks/useColors";
import { useSafeLayout } from "@/hooks/useSafeLayout";
import { useAuth } from "@/context/AuthContext";
import { profileMeCacheKey } from "@/hooks/useAvatarCache";
import { authFetch } from "@/utils/authFetch";
import { profileMePath } from "@/utils/profileApi";
import { apiFetchAllowed, markApiFetched } from "@/utils/apiRequestCoordinator";
import { screenCache } from "@/utils/screenCache";
import { rf, rs } from "@/utils/responsive";
import {
  applyIncomingBreakdown,
  extractBreakdownFromProfileMePayload,
  statsHasBreakdownField,
  type ChallengeParticipationBreakdown,
} from "@/utils/challengeParticipationBreakdown";

const PROFILE_ME_TTL_MS = 90_000;

export default function ProfileDashboardScreen() {
  const colors = useColors();
  const { user } = useAuth();
  const { safeTop, safeBottom } = useSafeLayout();
  const profileCacheKey = profileMeCacheKey(user?.id);
  const cached = screenCache.getSync<{ stats?: unknown }>(profileCacheKey);
  const [breakdown, setBreakdown] = useState<ChallengeParticipationBreakdown | undefined>(() =>
    applyIncomingBreakdown(cached?.stats, undefined),
  );
  const [loading, setLoading] = useState(!cached);

  useFocusEffect(
    useCallback(() => {
      const cachedNow = screenCache.getSync<{ stats?: unknown }>(profileCacheKey);
      if (cachedNow?.stats) {
        setBreakdown((prev) => applyIncomingBreakdown(cachedNow.stats, prev));
        setLoading(false);
      }

      if (!apiFetchAllowed("profile_me_full", PROFILE_ME_TTL_MS)) {
        setLoading(false);
        return;
      }

      markApiFetched("profile_me_full");
      void (async () => {
        try {
          const res = await authFetch(profileMePath());
          if (!res.ok) return;
          const json: unknown = await res.json();
          const data = (json as { data?: { stats?: unknown } }).data;
          if (statsHasBreakdownField(data?.stats)) {
            setBreakdown(extractBreakdownFromProfileMePayload(json));
          }
        } finally {
          setLoading(false);
        }
      })();
    }, [profileCacheKey]),
  );

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
