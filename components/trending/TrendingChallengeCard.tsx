/**
 * Compact Unlimited Challenge card — prize pool gold highlight + shimmer.
 */

import React, { memo, useEffect, useRef } from "react";
import { Animated, Easing, StyleSheet, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { TouchableOpacity } from "@/components/HapticTouchableOpacity";
import { TrendingNeonArt } from "@/components/trending/TrendingNeonArt";
import { getTrendingTheme } from "@/constants/trendingChallengeThemes";
import {
  formatTrendingStartLabel,
  type TrendingChallenge,
} from "@/utils/trendingChallenges";
import { displayChallengeTitle } from "@/features/unlimited/mappers/unlimitedLiveUiCopy";
import { rf, rs } from "@/utils/responsive";

type Props = {
  challenge: TrendingChallenge;
  width: number;
  height: number;
  onPress: () => void;
  positionLabel: string;
};

function TrendingChallengeCardInner({
  challenge,
  width,
  height,
  onPress,
  positionLabel,
}: Props) {
  const theme = getTrendingTheme(challenge.themeKey);
  const startLabel = formatTrendingStartLabel(challenge.startsAtUtc);
  const endLabel = challenge.endsAtUtc
    ? formatTrendingStartLabel(challenge.endsAtUtc)
    : null;
  const a11y = `${challenge.title}. Prize pool ${challenge.prizePoolDisplay}. ${challenge.participantCount} participants. Start Date ${startLabel}.${endLabel ? ` End Date ${endLabel}.` : ""} Available challenge ${positionLabel}. Double tap to view.`;

  const shimmerX = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(shimmerX, {
          toValue: 1,
          duration: 1600,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(shimmerX, {
          toValue: 0,
          duration: 0,
          useNativeDriver: true,
        }),
        Animated.delay(700),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [shimmerX]);

  const shimmerTranslate = shimmerX.interpolate({
    inputRange: [0, 1],
    outputRange: [-width * 0.5, width * 0.9],
  });

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.92}
      accessibilityRole="button"
      accessibilityLabel={a11y}
      style={[
        styles.card,
        {
          width,
          height,
          borderColor: theme.border,
          shadowColor: theme.border,
        },
      ]}
    >
      <LinearGradient colors={[...theme.gradient]} style={StyleSheet.absoluteFillObject} />
      <View style={[styles.badge, { backgroundColor: theme.badgeBg }]}>
        <Feather name="clock" size={8} color={theme.badgeText} />
        <Text style={[styles.badgeText, { color: theme.badgeText }]}>Available</Text>
        <View style={[styles.typePill, { borderColor: theme.border }]}>
          <Text style={[styles.typeText, { color: theme.badgeText }]}>{challenge.typeBadge}</Text>
        </View>
      </View>

      <Text style={styles.title} numberOfLines={1}>
        {displayChallengeTitle(challenge.title)}
      </Text>

      <View style={styles.artBox}>
        <TrendingNeonArt artworkKey={challenge.artworkKey} theme={theme} />
      </View>

      <View style={styles.prizeBanner}>
        <LinearGradient
          colors={["rgba(255,215,0,0.12)", "rgba(255,215,0,0.28)", "rgba(255,215,0,0.14)"]}
          start={{ x: 0, y: 0.5 }}
          end={{ x: 1, y: 0.5 }}
          style={StyleSheet.absoluteFillObject}
        />
        <Animated.View
          pointerEvents="none"
          style={[
            styles.prizeShimmer,
            { transform: [{ translateX: shimmerTranslate }] },
          ]}
        >
          <LinearGradient
            colors={["transparent", "rgba(255,255,220,0.65)", "transparent"]}
            start={{ x: 0, y: 0.5 }}
            end={{ x: 1, y: 0.5 }}
            style={StyleSheet.absoluteFillObject}
          />
        </Animated.View>
        <Feather name="award" size={12} color="#FFD700" />
        <Text style={styles.prizeLabel}>Prize pool</Text>
        <Text style={styles.prizeValue} numberOfLines={1}>
          {challenge.prizePoolDisplay}
        </Text>
      </View>

      <View style={styles.joinedRow}>
        <Feather name="users" size={10} color={theme.icon} />
        <Text style={styles.joinedLabel}>Joined</Text>
        <Text style={styles.joinedValue} numberOfLines={1}>
          {challenge.participantCount.toLocaleString()}
        </Text>
      </View>

      <View style={[styles.datesBlock, { borderTopColor: theme.border + "55" }]}>
        <View style={styles.dateRow}>
          <Text style={styles.dateKey}>Start Date</Text>
          <Text style={[styles.dateValue, { color: theme.accent }]} numberOfLines={1}>
            {startLabel}
          </Text>
        </View>
        <View style={styles.dateRow}>
          <Text style={styles.dateKey}>End Date</Text>
          <Text style={[styles.dateValue, { color: theme.accent }]} numberOfLines={1}>
            {endLabel ?? "TBD"}
          </Text>
        </View>
      </View>
    </TouchableOpacity>
  );
}

export const TrendingChallengeCard = memo(TrendingChallengeCardInner);

const styles = StyleSheet.create({
  card: {
    borderRadius: 12,
    borderWidth: 1.5,
    paddingHorizontal: 8,
    paddingTop: 6,
    paddingBottom: 0,
    overflow: "hidden",
    shadowOpacity: 0.28,
    shadowRadius: 4,
    shadowOffset: { width: 1, height: 0 },
    elevation: 3,
  },
  badge: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: 3,
    borderRadius: 999,
    paddingHorizontal: 5,
    paddingVertical: 1,
    marginBottom: 2,
  },
  badgeText: {
    fontSize: rf(7.5),
    fontWeight: "800",
  },
  typePill: {
    marginLeft: 2,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 4,
    paddingVertical: 0,
  },
  typeText: {
    fontSize: rf(7.5),
    fontWeight: "700",
  },
  title: {
    color: "#FFF",
    fontSize: rf(12),
    fontWeight: "800",
    marginBottom: 3,
    lineHeight: rs(15),
  },
  artBox: {
    height: 22,
    marginBottom: 3,
  },
  prizeBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#FFD700AA",
    paddingHorizontal: 7,
    paddingVertical: 5,
    marginBottom: 4,
    overflow: "hidden",
  },
  prizeShimmer: {
    position: "absolute",
    top: 0,
    bottom: 0,
    width: 42,
  },
  prizeLabel: {
    color: "#FFD700",
    fontSize: rf(10),
    fontWeight: "800",
  },
  prizeValue: {
    flex: 1,
    color: "#FFE566",
    fontSize: rf(13),
    fontWeight: "900",
    textAlign: "right",
    letterSpacing: 0.2,
    textShadowColor: "rgba(255,215,0,0.55)",
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 6,
  },
  joinedRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginBottom: 4,
  },
  joinedLabel: {
    flex: 1,
    color: "rgba(255,255,255,0.55)",
    fontSize: rf(9),
    fontWeight: "600",
  },
  joinedValue: {
    color: "#FFF",
    fontSize: rf(9),
    fontWeight: "800",
  },
  datesBlock: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: 4,
    paddingBottom: 5,
    gap: 2,
  },
  dateRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  dateKey: {
    color: "rgba(255,255,255,0.55)",
    fontSize: rf(9),
    fontWeight: "700",
    width: rs(58),
  },
  dateValue: {
    flex: 1,
    fontSize: rf(10),
    fontWeight: "800",
    textAlign: "right",
  },
});
