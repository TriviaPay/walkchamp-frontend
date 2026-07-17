import React, { useEffect, useRef } from "react";
import { Animated, Image, StyleSheet, Text, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Feather } from "@expo/vector-icons";
import { TouchableOpacity } from "@/components/HapticTouchableOpacity";
import { RaceJoinBadge, JoinProgressOverlay } from "@/components/RaceJoinBadge";
import { useTheme } from "@/context/ThemeContext";

export const ENABLE_CHALLENGE_CATEGORY_CARDS = true;

export interface ChallengeStatus {
  status: string;
  raceId: string | null;
  isHost: boolean;
  isParticipant: boolean;
  joinedCount: number;
  maxPlayers: number;
  targetSteps?: number;
  canHost: boolean;
  canJoin: boolean;
  isActive: boolean;
  isFinished: boolean;
  label: string;
  liveCount?: number;
  waitingCount?: number;
  canHostNew?: boolean;
}

interface Props {
  fee: number;
  label: string;
  subtitle: string;
  icon: string;
  iconImage?: ReturnType<typeof require>;
  gradientColors: [string, string];
  lightAccent?: string;
  entryKey: string;
  cs: ChallengeStatus | undefined;
  isJoining: boolean;
  onPress: () => void;
  onHostNew: () => void;
  onWatchLive: () => void;
}

export function ChallengeCategoryCard({
  label, subtitle, icon, iconImage, gradientColors, lightAccent, cs,
  isJoining, onPress, onHostNew, onWatchLive,
}: Props) {
  const { isDark } = useTheme();

  const statusLabel  = cs?.label ?? "Host";
  const liveCount    = cs?.liveCount ?? 0;
  const isActiveOther   = cs?.status === "active_other";
  const isJoinAvailable = cs?.status === "join_available";

  const displaySubtitle = (isJoinAvailable && liveCount > 0)
    ? `● ${liveCount} live  ·  ${subtitle}`
    : subtitle;

  // Always render with the gradient (dark) style regardless of theme
  const cardInner = (
    <LinearGradient
      colors={gradientColors}
      style={cStyles.gradient}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 0 }}
    >
      <View style={[cStyles.iconBox, { backgroundColor: "rgba(255,255,255,0.18)" }]}>
        {iconImage
          ? <Image source={iconImage} style={cStyles.iconImg} resizeMode="contain" />
          : <Feather name={icon as never} size={22} color="#FFF" />}
      </View>
      <View style={cStyles.textBlock}>
        <Text style={cStyles.title}>{label}</Text>
        <Text style={cStyles.sub}>{displaySubtitle}</Text>
      </View>
      <View style={cStyles.rightBlock}>
        {isActiveOther ? (
          <>
            <LiveBadge count={liveCount} />
            <TouchableOpacity
              onPress={onHostNew}
              activeOpacity={0.82}
              hitSlop={{ top: 6, bottom: 6, left: 8, right: 8 }}
              accessibilityLabel="Host new challenge"
            >
              <Text style={cStyles.hostLink}>Host New</Text>
            </TouchableOpacity>
          </>
        ) : (
          <>
            <RaceJoinBadge
              status={cs?.status}
              joinedCount={cs?.joinedCount}
              maxPlayers={cs?.maxPlayers ?? 10}
              label={statusLabel}
            />
            <Feather name="chevron-right" size={18} color="rgba(255,255,255,0.8)" />
          </>
        )}
      </View>
    </LinearGradient>
  );

  // Same outer card height as RACING — no Watch/Host row under the card.
  if (isActiveOther) {
    return (
      <TouchableOpacity
        onPress={onWatchLive}
        activeOpacity={0.88}
        style={cStyles.cardShellMb}
        accessibilityLabel={liveCount > 0 ? `${liveCount} live, tap to watch` : "Live race, tap to watch"}
      >
        {cardInner}
        <JoinProgressOverlay isJoining={isJoining} />
      </TouchableOpacity>
    );
  }

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.88}
      disabled={isJoining}
      style={cStyles.cardShellMb}
    >
      {cardInner}
      <JoinProgressOverlay isJoining={isJoining} />
    </TouchableOpacity>
  );
}

function LiveBadge({ count }: { count: number }) {
  const pulse = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.55, duration: 580, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1,    duration: 580, useNativeDriver: true }),
      ]),
    );
    anim.start();
    return () => anim.stop();
  }, [pulse]);
  // Same pill size/weight as RACING — mustard (distinct from green RACING / amber HOSTING)
  return (
    <LinearGradient
      colors={["#EAB308", "#CA8A04"]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 0 }}
      style={lbStyles.pill}
    >
      <Animated.View style={[lbStyles.dot, { opacity: pulse }]} />
      <Text style={lbStyles.text}>{count > 0 ? `${count} LIVE` : "LIVE"}</Text>
    </LinearGradient>
  );
}

const lbStyles = StyleSheet.create({
  // Match RaceJoinBadge racingPill sizing so card right-side height stays consistent
  pill: {
    flexDirection: "row", alignItems: "center", gap: 5,
    borderRadius: 8, paddingHorizontal: 9, paddingVertical: 5,
  },
  dot:  { width: 6, height: 6, borderRadius: 3, backgroundColor: "#713F12" },
  text: { fontSize: 11, fontWeight: "900", color: "#422006", letterSpacing: 0.3 },
});

const cStyles = StyleSheet.create({
  cardShellMb:   { borderRadius: 18, overflow: "hidden", marginBottom: 10 },

  gradient:  { flexDirection: "row", alignItems: "center", gap: 14, paddingHorizontal: 18, paddingVertical: 18 },
  iconBox:   { width: 46, height: 46, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  iconImg:   { width: 28, height: 28 },
  textBlock: { flex: 1 },
  title:     { fontSize: 17, fontWeight: "800", color: "#FFF" },
  sub:       { fontSize: 12, color: "rgba(255,255,255,0.78)", marginTop: 2 },
  rightBlock:{ alignItems: "flex-end", gap: 6 },
  hostLink:  { fontSize: 11, fontWeight: "800", color: "rgba(255,255,255,0.88)", letterSpacing: 0.2 },
});
