import React, { useEffect, useRef } from "react";
import { Animated, StyleSheet, Text, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";

export const ENABLE_JOIN_CARD_ANIMATION = true;

// ── RaceJoinBadge ─────────────────────────────────────────────────────────────

interface RaceJoinBadgeProps {
  status?: string;
  joinedCount?: number;
  maxPlayers?: number;
  label?: string;
}

export function RaceJoinBadge({ status, joinedCount = 1, maxPlayers = 10, label = "Host" }: RaceJoinBadgeProps) {
  const pulseAnim  = useRef(new Animated.Value(1)).current;
  const glowAnim   = useRef(new Animated.Value(0.5)).current;
  const scaleAnim  = useRef(new Animated.Value(1)).current;

  const isJoinable      = status === "join_available";
  const isActiveHost    = status === "user_hosting_active";
  const isActiveJoined  = status === "user_joined_active";
  const isWaitingHost   = status === "user_hosting_waiting";
  const isWaitingJoined = status === "user_joined_waiting";
  const isForfeited     = status === "forfeited";
  const isFinished      = status === "finished";
  const isWaiting       = isWaitingHost || isWaitingJoined;

  // Pulse + glow for joinable; gentle scale-bounce for waiting (player count changes)
  useEffect(() => {
    if (isJoinable) {
      const pulse = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim,  { toValue: 0.78, duration: 550, useNativeDriver: true }),
          Animated.timing(pulseAnim,  { toValue: 1,    duration: 550, useNativeDriver: true }),
        ]),
      );
      const glow = Animated.loop(
        Animated.sequence([
          Animated.timing(glowAnim, { toValue: 1,   duration: 600, useNativeDriver: true }),
          Animated.timing(glowAnim, { toValue: 0.4, duration: 600, useNativeDriver: true }),
        ]),
      );
      pulse.start();
      glow.start();
      return () => { pulse.stop(); glow.stop(); };
    }
    if (isWaiting) {
      const bounce = Animated.sequence([
        Animated.timing(scaleAnim, { toValue: 1.12, duration: 180, useNativeDriver: true }),
        Animated.timing(scaleAnim, { toValue: 1,    duration: 180, useNativeDriver: true }),
      ]);
      bounce.start();
    } else {
      pulseAnim.setValue(1);
      glowAnim.setValue(0.5);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isJoinable, isWaiting, joinedCount]);

  // ── Join available — solid gradient badge, prominent ──────────────────────
  if (isJoinable) {
    return (
      <Animated.View
        style={{ transform: [{ scale: pulseAnim }] }}
        accessibilityLabel={`Join room, ${joinedCount} of ${maxPlayers} players joined`}
      >
        <LinearGradient
          colors={["#00E676", "#00C853"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={bjStyles.joinPill}
        >
          <Animated.View style={[bjStyles.joinDot, { opacity: glowAnim }]} />
          <Text style={bjStyles.joinText}>Join</Text>
          <View style={bjStyles.joinCountBox}>
            <Text style={bjStyles.joinCountText}>{joinedCount}/{maxPlayers}</Text>
          </View>
        </LinearGradient>
      </Animated.View>
    );
  }

  // ── Waiting (player count visible) ────────────────────────────────────────
  if (isWaiting) {
    if (isWaitingHost) {
      // Solid amber gradient — matches the prominence of the "Join" badge
      return (
        <Animated.View style={{ transform: [{ scale: scaleAnim }] }} accessibilityLabel={`Hosting, ${joinedCount} of ${maxPlayers} players joined`}>
          <LinearGradient
            colors={["#F59E0B", "#D97706"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={bjStyles.hostingPill}
          >
            <Animated.View style={bjStyles.hostingDot} />
            <Text style={bjStyles.hostingLabel}>Hosting</Text>
            <View style={bjStyles.hostingCountBox}>
              <Text style={bjStyles.hostingCountText}>{joinedCount}/{maxPlayers}</Text>
            </View>
          </LinearGradient>
        </Animated.View>
      );
    }
    // Waiting (joined, not host)
    return (
      <Animated.View
        style={[bjStyles.waitingPill, { backgroundColor: "rgba(0,230,118,0.22)", borderColor: "rgba(0,230,118,0.60)", transform: [{ scale: scaleAnim }] }]}
      >
        <Animated.View style={[bjStyles.waitingDot, { backgroundColor: "#00E676" }]} />
        <View style={bjStyles.waitingInner}>
          <Text style={[bjStyles.waitingLabel, { color: "#00E676" }]}>Waiting</Text>
          <Text style={[bjStyles.waitingCount, { color: "#00E676" }]}>{joinedCount}/{maxPlayers}</Text>
        </View>
      </Animated.View>
    );
  }

  // ── Active race ────────────────────────────────────────────────────────────
  if (isActiveHost) {
    return (
      <LinearGradient
        colors={["#F59E0B", "#D97706"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={bjStyles.activeHostPill}
      >
        <View style={[bjStyles.dot, { backgroundColor: "#FFF" }]} />
        <Text style={bjStyles.activeHostText}>HOSTING</Text>
      </LinearGradient>
    );
  }
  if (isActiveJoined) {
    return (
      <LinearGradient
        colors={["#00E676", "#00C853"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={bjStyles.racingPill}
      >
        <View style={bjStyles.racingDot} />
        <Text style={bjStyles.racingText}>RACING</Text>
      </LinearGradient>
    );
  }
  if (isForfeited) {
    return (
      <View style={[bjStyles.pill, { backgroundColor: "rgba(255,68,68,0.22)", borderColor: "rgba(255,68,68,0.55)" }]}>
        <Text style={[bjStyles.text, { color: "#FF4444" }]}>FORFEITED</Text>
      </View>
    );
  }

  // ── Default (Host / finished / etc.) ──────────────────────────────────────
  return (
    <View style={[bjStyles.pill, { backgroundColor: "rgba(255,255,255,0.92)", borderColor: "rgba(255,255,255,0.95)" }]}>
      <Text style={[bjStyles.text, { color: "#111827" }]}>{label}</Text>
    </View>
  );
}

const bjStyles = StyleSheet.create({
  // Generic small pill (active/forfeited/host)
  pill:  { flexDirection: "row", alignItems: "center", gap: 5, borderRadius: 8, paddingHorizontal: 9, paddingVertical: 5, borderWidth: 1 },
  dot:   { width: 6, height: 6, borderRadius: 3 },
  text:  { fontSize: 11, fontWeight: "800" },

  // "Join" pill — solid gradient, bold
  joinPill:     { flexDirection: "row", alignItems: "center", gap: 6, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6 },
  joinDot:      { width: 7, height: 7, borderRadius: 3.5, backgroundColor: "#004D26" },
  joinText:     { fontSize: 13, fontWeight: "900", color: "#003820", letterSpacing: 0.2 },
  joinCountBox: { backgroundColor: "rgba(0,0,0,0.22)", borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  joinCountText:{ fontSize: 12, fontWeight: "900", color: "#FFF" },

  // Waiting pill — slightly larger to show count (joined, non-host)
  waitingPill:  { flexDirection: "row", alignItems: "center", gap: 5, borderRadius: 10, paddingHorizontal: 9, paddingVertical: 5, borderWidth: 1.5 },
  waitingDot:   { width: 7, height: 7, borderRadius: 3.5 },
  waitingInner: { gap: 1 },
  waitingLabel: { fontSize: 9, fontWeight: "800", letterSpacing: 0.3, opacity: 0.85 },
  waitingCount: { fontSize: 13, fontWeight: "900", lineHeight: 14 },

  // Hosting pill — solid amber gradient (mirrors join pill prominence)
  hostingPill:     { flexDirection: "row", alignItems: "center", gap: 6, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6 },
  hostingDot:      { width: 7, height: 7, borderRadius: 3.5, backgroundColor: "#7C2D00" },
  hostingLabel:    { fontSize: 13, fontWeight: "900", color: "#1C0A00", letterSpacing: 0.2 },
  hostingCountBox: { backgroundColor: "rgba(0,0,0,0.22)", borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  hostingCountText:{ fontSize: 12, fontWeight: "900", color: "#FFF" },

  // Active HOSTING pill — solid amber gradient, compact
  activeHostPill: { flexDirection: "row", alignItems: "center", gap: 5, borderRadius: 8, paddingHorizontal: 9, paddingVertical: 5 },
  activeHostText: { fontSize: 11, fontWeight: "800", color: "#1C0A00" },

  // Active RACING pill — solid green (same weight as Join), only for racing
  racingPill: { flexDirection: "row", alignItems: "center", gap: 5, borderRadius: 8, paddingHorizontal: 9, paddingVertical: 5 },
  racingDot:  { width: 6, height: 6, borderRadius: 3, backgroundColor: "#004D26" },
  racingText: { fontSize: 11, fontWeight: "900", color: "#003820", letterSpacing: 0.3 },
});

// ── JoinProgressOverlay ───────────────────────────────────────────────────────
// Absolute-fill left-to-right shimmer overlay. Place inside a View that has
// overflow:"hidden" so it clips to the card shape.

interface JoinProgressOverlayProps {
  isJoining: boolean;
  tintColor?: string;
  showText?: boolean;
}

export function JoinProgressOverlay({ isJoining, tintColor = "#00E676", showText = true }: JoinProgressOverlayProps) {
  const progress     = useRef(new Animated.Value(0)).current;
  const textOpacity  = useRef(new Animated.Value(0)).current;
  const dotAnim      = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!ENABLE_JOIN_CARD_ANIMATION) return;
    if (isJoining) {
      progress.setValue(0);
      textOpacity.setValue(0);
      Animated.parallel([
        Animated.timing(progress,    { toValue: 0.85, duration: 750, useNativeDriver: false }),
        Animated.timing(textOpacity, { toValue: 1,    duration: 220, useNativeDriver: true }),
      ]).start();
      const dots = Animated.loop(
        Animated.sequence([
          Animated.timing(dotAnim, { toValue: 1, duration: 500, useNativeDriver: true }),
          Animated.timing(dotAnim, { toValue: 0, duration: 500, useNativeDriver: true }),
        ]),
      );
      dots.start();
      return () => dots.stop();
    } else {
      Animated.parallel([
        Animated.timing(progress,    { toValue: 0, duration: 250, useNativeDriver: false }),
        Animated.timing(textOpacity, { toValue: 0, duration: 150, useNativeDriver: true }),
      ]).start();
    }
  }, [isJoining, progress, textOpacity, dotAnim]);

  if (!ENABLE_JOIN_CARD_ANIMATION) return null;

  const width      = progress.interpolate({ inputRange: [0, 1], outputRange: ["0%", "100%"] });
  const dotOpacity = dotAnim.interpolate({ inputRange: [0, 1], outputRange: [0.5, 1] });

  return (
    <View
      style={ovStyles.container}
      accessibilityLabel="Joining room, please wait"
      pointerEvents="none"
    >
      <Animated.View style={[ovStyles.fill, { width }]}>
        <LinearGradient
          colors={["rgba(0,230,118,0.26)", "rgba(0,230,118,0.73)"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={StyleSheet.absoluteFillObject}
        />
      </Animated.View>
      {showText && (
        <Animated.View style={[ovStyles.textRow, { opacity: textOpacity }]}>
          <View style={ovStyles.matchingPill}>
            <View style={ovStyles.matchingDot} />
            <Text style={ovStyles.text}>Matching</Text>
            <Animated.Text style={[ovStyles.dots, { opacity: dotOpacity }]}>•••</Animated.Text>
          </View>
        </Animated.View>
      )}
    </View>
  );
}

const ovStyles = StyleSheet.create({
  container:    { ...StyleSheet.absoluteFillObject, zIndex: 20, justifyContent: "center", alignItems: "center" },
  fill:         { position: "absolute", left: 0, top: 0, bottom: 0, overflow: "hidden" },
  textRow:      { flexDirection: "row", alignItems: "center" },
  matchingPill: {
    flexDirection: "row", alignItems: "center", gap: 7,
    backgroundColor: "rgba(0,0,0,0.55)",
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: "rgba(0,230,118,0.7)",
    paddingHorizontal: 16,
    paddingVertical: 9,
  },
  matchingDot:  { width: 8, height: 8, borderRadius: 4, backgroundColor: "#00E676" },
  text:         { color: "#FFF", fontSize: 15, fontWeight: "900", letterSpacing: 0.5, textShadowColor: "rgba(0,0,0,0.8)", textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 4 },
  dots:         { color: "#00E676", fontSize: 15, fontWeight: "900", textShadowColor: "rgba(0,0,0,0.8)", textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 4 },
});
