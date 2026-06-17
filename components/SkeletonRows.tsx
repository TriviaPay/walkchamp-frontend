/**
 * Lightweight shimmer skeleton rows — shown in place of a spinner while a screen
 * has no cached data to display. Uses React Native's Animated API only (no extra packages).
 */

import React, { useEffect, useRef } from "react";
import { Animated, StyleSheet, View } from "react-native";
import { useColors } from "@/hooks/useColors";

interface ShimmerBarProps {
  width: number | `${number}%`;
  height?: number;
  borderRadius?: number;
  color: string;
  delay?: number;
}

function ShimmerBar({ width, height = 14, borderRadius = 6, color, delay = 0 }: ShimmerBarProps) {
  const anim = useRef(new Animated.Value(0.35)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.delay(delay),
        Animated.timing(anim, { toValue: 0.9, duration: 650, useNativeDriver: true }),
        Animated.timing(anim, { toValue: 0.35, duration: 650, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [anim, delay]);

  return (
    <Animated.View
      style={{ width, height, borderRadius, backgroundColor: color, opacity: anim }}
    />
  );
}

/** A single leaderboard-style row skeleton. */
export function SkeletonLeaderRow() {
  const colors = useColors();
  const c = colors.border;
  return (
    <View style={[styles.leaderRow, { backgroundColor: colors.card }]}>
      <ShimmerBar width={24} height={14} color={c} />
      <ShimmerBar width={36} height={36} borderRadius={18} color={c} delay={60} />
      <View style={styles.textBlock}>
        <ShimmerBar width="55%" height={14} color={c} delay={80} />
        <ShimmerBar width="35%" height={10} color={c} delay={120} />
      </View>
      <ShimmerBar width={50} height={14} color={c} delay={100} />
    </View>
  );
}

/** A single race-card–style skeleton row. */
export function SkeletonRaceRow() {
  const colors = useColors();
  const c = colors.border;
  return (
    <View style={[styles.raceRow, { backgroundColor: colors.card }]}>
      <View style={styles.raceLeft}>
        <ShimmerBar width="70%" height={16} color={c} />
        <ShimmerBar width="45%" height={11} color={c} delay={60} />
        <ShimmerBar width="55%" height={11} color={c} delay={90} />
      </View>
      <ShimmerBar width={72} height={30} borderRadius={8} color={c} delay={80} />
    </View>
  );
}

/** A single chat-message–style skeleton row. */
export function SkeletonChatRow({ isMe = false }: { isMe?: boolean }) {
  const colors = useColors();
  const c = colors.border;
  const w = 36 + Math.floor(Math.random() * 4) * 10;  // variety widths
  return (
    <View style={[styles.chatRow, isMe && styles.chatRowMe]}>
      {!isMe && <ShimmerBar width={28} height={28} borderRadius={14} color={c} />}
      <View style={isMe ? styles.chatBubbleMe : styles.chatBubble}>
        <ShimmerBar width={`${w}%` as `${number}%`} height={12} color={c} />
        <ShimmerBar width="30%" height={9} color={c} delay={60} />
      </View>
    </View>
  );
}

/** A single step-history bar chart skeleton — 7 bars of varying height. */
export function SkeletonHistoryChart() {
  const colors = useColors();
  const c = colors.border;
  const heights = [0.55, 0.30, 0.80, 0.45, 1.00, 0.65, 0.35];
  return (
    <View style={styles.historyChart}>
      {heights.map((h, i) => (
        <View key={i} style={styles.historyBarWrap}>
          <ShimmerBar
            width={28}
            height={Math.round(h * 110)}
            borderRadius={5}
            color={c}
            delay={i * 50}
          />
        </View>
      ))}
    </View>
  );
}

/** A single walk-tab challenge card skeleton (matches ChallengeCategoryCard shape). */
export function SkeletonWalkCard() {
  const colors = useColors();
  const c = colors.border;
  return (
    <View style={[styles.walkCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={styles.walkLeft}>
        <ShimmerBar width={32} height={32} borderRadius={8} color={c} />
        <View style={styles.walkText}>
          <ShimmerBar width="55%" height={15} color={c} />
          <ShimmerBar width="75%" height={11} color={c} delay={60} />
        </View>
      </View>
      <ShimmerBar width={80} height={32} borderRadius={10} color={c} delay={80} />
    </View>
  );
}

/** Profile edit-form loading skeleton — mimics the Full Name / Username / Bio / Color rows. */
export function SkeletonEditForm() {
  const colors = useColors();
  const c = colors.border;
  return (
    <View style={{ paddingHorizontal: 20, paddingTop: 24, gap: 28 }}>
      {/* Full Name */}
      <View style={{ gap: 8 }}>
        <ShimmerBar width={80} height={11} color={c} />
        <ShimmerBar width="100%" height={46} borderRadius={12} color={c} delay={40} />
      </View>
      {/* Username */}
      <View style={{ gap: 8 }}>
        <ShimmerBar width={80} height={11} color={c} />
        <ShimmerBar width="100%" height={46} borderRadius={12} color={c} delay={60} />
      </View>
      {/* Bio */}
      <View style={{ gap: 8 }}>
        <ShimmerBar width={40} height={11} color={c} />
        <ShimmerBar width="100%" height={100} borderRadius={12} color={c} delay={80} />
      </View>
      {/* Color row */}
      <View style={{ gap: 8 }}>
        <ShimmerBar width={100} height={11} color={c} />
        <View style={{ flexDirection: "row", gap: 12 }}>
          {[0, 60, 120, 180, 240, 300, 360, 420].map((delay) => (
            <ShimmerBar key={delay} width={36} height={36} borderRadius={18} color={c} delay={delay} />
          ))}
        </View>
      </View>
    </View>
  );
}

/** Full-screen skeleton for the live race detail screen (dark #050711 background). */
export function SkeletonLiveDetail() {
  const DARK = "#1A1D2E";
  const rows = [0, 80, 160, 240];
  return (
    <View style={{ flex: 1, backgroundColor: "#050711" }}>
      {/* Track area placeholder */}
      <View style={{ marginHorizontal: 12, marginTop: 12, borderRadius: 16, overflow: "hidden", height: 220, backgroundColor: "#0D0F1E" }}>
        <View style={{ padding: 14, gap: 10 }}>
          <View style={{ flexDirection: "row", gap: 10, alignItems: "center" }}>
            <ShimmerBar width={60} height={20} borderRadius={10} color={DARK} />
            <ShimmerBar width="55%" height={14} color={DARK} delay={40} />
          </View>
          <ShimmerBar width="100%" height={10} borderRadius={5} color={DARK} delay={80} />
          <ShimmerBar width="100%" height={10} borderRadius={5} color={DARK} delay={120} />
          <ShimmerBar width="80%" height={10} borderRadius={5} color={DARK} delay={160} />
        </View>
        {/* Fake runner dots */}
        <View style={{ flexDirection: "row", justifyContent: "space-around", paddingHorizontal: 24, marginTop: 16 }}>
          {[0, 50, 100, 150].map((d) => (
            <ShimmerBar key={d} width={36} height={36} borderRadius={18} color={DARK} delay={d} />
          ))}
        </View>
      </View>

      {/* Tab bar placeholder */}
      <View style={{ flexDirection: "row", gap: 8, marginHorizontal: 12, marginTop: 12 }}>
        <ShimmerBar width="48%" height={36} borderRadius={10} color={DARK} delay={60} />
        <ShimmerBar width="48%" height={36} borderRadius={10} color={DARK} delay={100} />
      </View>

      {/* Comment rows */}
      <View style={{ marginTop: 14, paddingHorizontal: 12, gap: 12 }}>
        {rows.map((d) => (
          <View key={d} style={{ flexDirection: "row", gap: 10, alignItems: "flex-start" }}>
            <ShimmerBar width={28} height={28} borderRadius={14} color={DARK} delay={d} />
            <View style={{ flex: 1, gap: 6 }}>
              <ShimmerBar width="30%" height={11} color={DARK} delay={d + 40} />
              <ShimmerBar width="75%" height={13} color={DARK} delay={d + 80} />
            </View>
          </View>
        ))}
      </View>

      {/* Input bar placeholder */}
      <View style={{ flexDirection: "row", gap: 10, alignItems: "center", paddingHorizontal: 12, marginTop: "auto", paddingVertical: 10, borderTopWidth: 1, borderTopColor: "#1A1D2E" }}>
        <ShimmerBar width={32} height={32} borderRadius={16} color={DARK} />
        <ShimmerBar width="65%" height={38} borderRadius={20} color={DARK} delay={60} />
        <ShimmerBar width={60} height={38} borderRadius={20} color={DARK} delay={100} />
      </View>
    </View>
  );
}

/** Renders N skeleton rows for a list screen. */
export function SkeletonList({
  count = 6,
  variant = "leader",
}: {
  count?: number;
  variant?: "leader" | "race" | "chat" | "walk";
}) {
  return (
    <>
      {Array.from({ length: count }).map((_, i) =>
        variant === "race" ? (
          <SkeletonRaceRow key={i} />
        ) : variant === "chat" ? (
          <SkeletonChatRow key={i} isMe={i % 3 === 0} />
        ) : variant === "walk" ? (
          <SkeletonWalkCard key={i} />
        ) : (
          <SkeletonLeaderRow key={i} />
        )
      )}
    </>
  );
}

const styles = StyleSheet.create({
  historyChart: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "center",
    height: 130,
    gap: 8,
    paddingHorizontal: 24,
    paddingBottom: 8,
    marginTop: 24,
  },
  historyBarWrap: { alignItems: "center", justifyContent: "flex-end" },
  leaderRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    marginHorizontal: 12,
    marginBottom: 6,
  },
  textBlock: { flex: 1, gap: 6 },
  raceRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderRadius: 16,
    marginHorizontal: 12,
    marginBottom: 10,
    padding: 16,
  },
  raceLeft: { flex: 1, gap: 8, marginRight: 12 },
  chatRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 8,
    paddingHorizontal: 12,
    marginBottom: 10,
  },
  chatRowMe: { justifyContent: "flex-end" },
  chatBubble: { flex: 1, gap: 6, maxWidth: "70%" },
  chatBubbleMe: { alignItems: "flex-end", gap: 6, maxWidth: "70%" },
  walkCard: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderRadius: 16,
    marginHorizontal: 12,
    marginBottom: 10,
    padding: 14,
    borderWidth: 1,
  },
  walkLeft: { flexDirection: "row", alignItems: "center", gap: 10, flex: 1 },
  walkText: { flex: 1, gap: 7 },
});
