import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  Easing,
  Image,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Feather } from "@expo/vector-icons";
import { TouchableOpacity } from "@/components/HapticTouchableOpacity";
import { rf, rs } from "@/utils/responsive";
import {
  getSponsoredPrizePerWinnerUsd,
  SPONSORED_DEFAULT_TARGET_STEPS,
} from "@/utils/sponsoredEventsApi";

const COIN_IMG = require("@/assets/images/game-coin.png");

export type RaceStartingSoonPhase = "registered" | "join_window" | "racing";
export type RaceStartingSoonChallengeType = "free" | "coins" | "cash" | "sponsored";

export type RaceStartingSoonCardProps = {
  challengeType: RaceStartingSoonChallengeType;
  phase: RaceStartingSoonPhase;
  scheduledStartAt: string | null;
  registeredCount: number;
  maxSlots: number;
  targetSteps?: number;
  /** Cash/sponsored prize pool in cents when known. */
  prizePoolCents?: number;
  /** Sponsored gift / per-winner amount in cents. */
  prizePerWinnerCents?: number;
  /** Coins battle entry (and typical prize labeling). */
  coinEntryAmount?: number;
  /** Cash entry fee in cents. */
  entryAmountCents?: number;
  onPressCta: () => void;
};

type Theme = {
  badgeLabel: string;
  badgeBg: string;
  badgeBorder: string;
  badgeText: string;
  cardGrad: [string, string, string];
  cardLiveGrad: [string, string, string];
  shadow: string;
  neon: string;
  neonLive: string;
  timeGrad: [string, string];
  timeUrgentGrad: [string, string];
  trophyGrad: [string, string];
  progressGrad: [string, string];
  ctaGrad: [string, string];
  ctaLiveGrad: [string, string];
  particle: string;
  startsIn: string;
  colon: string;
  pillBorder: string;
};

const THEMES: Record<RaceStartingSoonChallengeType, Theme> = {
  free: {
    badgeLabel: "FREE",
    badgeBg: "rgba(16,185,129,0.4)",
    badgeBorder: "rgba(110,231,183,0.55)",
    badgeText: "#D1FAE5",
    cardGrad: ["#022c22", "#065f46", "#064e3b"],
    cardLiveGrad: ["#052e16", "#065f46", "#064e3b"],
    shadow: "#34D399",
    neon: "rgba(52,211,153,0.55)",
    neonLive: "rgba(52,211,153,0.75)",
    timeGrad: ["#064E3B", "#059669"],
    timeUrgentGrad: ["#065F46", "#10B981"],
    trophyGrad: ["#059669", "#34D399"],
    progressGrad: ["#059669", "#6EE7B7"],
    ctaGrad: ["#047857", "#10B981"],
    ctaLiveGrad: ["#059669", "#10B981"],
    particle: "#A7F3D0",
    startsIn: "rgba(167,243,208,0.9)",
    colon: "#A7F3D0",
    pillBorder: "rgba(52,211,153,0.28)",
  },
  coins: {
    badgeLabel: "COINS",
    badgeBg: "rgba(249,115,22,0.4)",
    badgeBorder: "rgba(253,186,116,0.55)",
    badgeText: "#FFEDD5",
    cardGrad: ["#431407", "#9a3412", "#7c2d12"],
    cardLiveGrad: ["#052e16", "#065f46", "#064e3b"],
    shadow: "#FB923C",
    neon: "rgba(251,146,60,0.55)",
    neonLive: "rgba(52,211,153,0.75)",
    timeGrad: ["#7C2D12", "#EA580C"],
    timeUrgentGrad: ["#9A3412", "#F97316"],
    trophyGrad: ["#EA580C", "#FBBF24"],
    progressGrad: ["#EA580C", "#FDBA74"],
    ctaGrad: ["#C2410C", "#F97316"],
    ctaLiveGrad: ["#059669", "#10B981"],
    particle: "#FED7AA",
    startsIn: "rgba(254,215,170,0.9)",
    colon: "#FDBA74",
    pillBorder: "rgba(251,146,60,0.28)",
  },
  cash: {
    badgeLabel: "CASH",
    badgeBg: "rgba(234,179,8,0.35)",
    badgeBorder: "rgba(253,224,71,0.55)",
    badgeText: "#FEF9C3",
    cardGrad: ["#1c1917", "#1e3a5f", "#0c4a6e"],
    cardLiveGrad: ["#052e16", "#065f46", "#064e3b"],
    shadow: "#F59E0B",
    neon: "rgba(251,191,36,0.5)",
    neonLive: "rgba(52,211,153,0.75)",
    timeGrad: ["#0C4A6E", "#0369A1"],
    timeUrgentGrad: ["#B45309", "#F59E0B"],
    trophyGrad: ["#D97706", "#FBBF24"],
    progressGrad: ["#0284C7", "#FBBF24"],
    ctaGrad: ["#0369A1", "#EAB308"],
    ctaLiveGrad: ["#059669", "#10B981"],
    particle: "#FDE68A",
    startsIn: "rgba(253,230,138,0.9)",
    colon: "#FDE68A",
    pillBorder: "rgba(56,189,248,0.28)",
  },
  sponsored: {
    badgeLabel: "SPONSORED",
    badgeBg: "rgba(124,58,237,0.45)",
    badgeBorder: "rgba(196,181,253,0.5)",
    badgeText: "#EDE9FE",
    cardGrad: ["#1a0533", "#3b0764", "#2e1065"],
    cardLiveGrad: ["#052e16", "#065f46", "#064e3b"],
    shadow: "#A855F7",
    neon: "rgba(168,85,247,0.55)",
    neonLive: "rgba(52,211,153,0.75)",
    timeGrad: ["#1E1B4B", "#312E81"],
    timeUrgentGrad: ["#4C1D95", "#7C3AED"],
    trophyGrad: ["#7C3AED", "#A855F7"],
    progressGrad: ["#7C3AED", "#C084FC"],
    ctaGrad: ["#6D28D9", "#A855F7"],
    ctaLiveGrad: ["#059669", "#10B981"],
    particle: "#E9D5FF",
    startsIn: "rgba(216,180,254,0.9)",
    colon: "#C4B5FD",
    pillBorder: "rgba(167,139,250,0.28)",
  },
};

function pad2(n: number) {
  return String(Math.max(0, n)).padStart(2, "0");
}

function useStartsInParts(iso: string | null) {
  const [parts, setParts] = useState({ h: 0, m: 0, s: 0, totalMs: 0, expired: !iso });

  useEffect(() => {
    if (!iso) {
      setParts({ h: 0, m: 0, s: 0, totalMs: 0, expired: true });
      return;
    }
    const tick = () => {
      const diff = new Date(iso).getTime() - Date.now();
      if (diff <= 0) {
        setParts({ h: 0, m: 0, s: 0, totalMs: 0, expired: true });
        return;
      }
      const h = Math.floor(diff / 3_600_000);
      const m = Math.floor((diff % 3_600_000) / 60_000);
      const s = Math.floor((diff % 60_000) / 1_000);
      setParts({ h, m, s, totalMs: diff, expired: false });
    };
    tick();
    const id = setInterval(tick, 1_000);
    return () => clearInterval(id);
  }, [iso]);

  return parts;
}

function prizePoolLabel(
  challengeType: RaceStartingSoonChallengeType,
  opts: {
    prizePoolCents?: number;
    prizePerWinnerCents?: number;
    coinEntryAmount?: number;
    registeredCount: number;
    maxSlots: number;
  },
): string {
  switch (challengeType) {
    case "free":
      return "None";
    case "coins": {
      if (opts.coinEntryAmount && opts.coinEntryAmount > 0) {
        const pool = opts.coinEntryAmount * Math.max(1, opts.registeredCount);
        return `${pool.toLocaleString()} Coins`;
      }
      return "Coins";
    }
    case "cash": {
      if (opts.prizePoolCents != null && opts.prizePoolCents > 0) {
        return `$${(opts.prizePoolCents / 100).toFixed(opts.prizePoolCents % 100 === 0 ? 0 : 2)}`;
      }
      return "$";
    }
    case "sponsored": {
      const usd = getSponsoredPrizePerWinnerUsd(opts.prizePerWinnerCents);
      return `$${usd} Gift`;
    }
  }
}

function TimeBox({
  value,
  label,
  urgent,
  theme,
}: {
  value: string;
  label: string;
  urgent: boolean;
  theme: Theme;
}) {
  return (
    <View style={styles.timeBoxWrap}>
      <LinearGradient
        colors={urgent ? theme.timeUrgentGrad : theme.timeGrad}
        style={[styles.timeBox, urgent && { borderColor: theme.badgeBorder }]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
      >
        <Text style={styles.timeValue}>{value}</Text>
      </LinearGradient>
      <Text style={[styles.timeLabel, { color: theme.startsIn }]}>{label}</Text>
    </View>
  );
}

function InfoPill({
  icon,
  text,
  borderColor,
}: {
  icon: React.ReactNode;
  text: string;
  borderColor: string;
}) {
  return (
    <View style={[styles.infoPill, { borderColor }]}>
      {icon}
      <Text style={styles.infoPillText} numberOfLines={1}>
        {text}
      </Text>
    </View>
  );
}

export function RaceStartingSoonCard({
  challengeType,
  phase,
  scheduledStartAt,
  registeredCount,
  maxSlots,
  targetSteps = SPONSORED_DEFAULT_TARGET_STEPS,
  prizePoolCents,
  prizePerWinnerCents,
  coinEntryAmount,
  entryAmountCents: _entryAmountCents,
  onPressCta,
}: RaceStartingSoonCardProps) {
  const theme = THEMES[challengeType];
  const hasStart = Boolean(scheduledStartAt);
  const parts = useStartsInParts(phase === "racing" ? null : scheduledStartAt);
  const urgent =
    phase === "join_window" ||
    (!parts.expired && parts.totalMs > 0 && parts.totalMs < 10 * 60_000);
  const isLive = phase === "racing" || (hasStart && parts.expired && phase !== "registered");

  const glow = useRef(new Animated.Value(0.45)).current;
  const shimmer = useRef(new Animated.Value(0)).current;
  const particleY = useRef(new Animated.Value(0)).current;
  const pulse = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const breathe = Animated.loop(
      Animated.sequence([
        Animated.timing(glow, { toValue: 0.9, duration: 1800, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(glow, { toValue: 0.45, duration: 1800, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ]),
    );
    breathe.start();
    return () => breathe.stop();
  }, [glow]);

  useEffect(() => {
    const shimmerLoop = Animated.loop(
      Animated.sequence([
        Animated.delay(7000),
        Animated.timing(shimmer, { toValue: 1, duration: 900, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.timing(shimmer, { toValue: 0, duration: 0, useNativeDriver: true }),
      ]),
    );
    shimmerLoop.start();
    return () => shimmerLoop.stop();
  }, [shimmer]);

  useEffect(() => {
    const float = Animated.loop(
      Animated.sequence([
        Animated.timing(particleY, { toValue: -6, duration: 2200, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(particleY, { toValue: 0, duration: 2200, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ]),
    );
    float.start();
    return () => float.stop();
  }, [particleY]);

  useEffect(() => {
    if (!urgent || isLive) {
      pulse.setValue(1);
      return;
    }
    const pulseLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1.04, duration: 500, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 500, useNativeDriver: true }),
      ]),
    );
    pulseLoop.start();
    return () => pulseLoop.stop();
  }, [urgent, isLive, pulse]);

  const slotPct = maxSlots > 0 ? Math.min(1, registeredCount / maxSlots) : 0;
  const prizeText = prizePoolLabel(challengeType, {
    prizePoolCents,
    prizePerWinnerCents,
    coinEntryAmount,
    registeredCount,
    maxSlots,
  });

  const title = isLive ? "LIVE NOW ⚡" : "Race Starting Soon! 🚀";
  const subtitle = isLive
    ? "Your race is live. Join now!"
    : "You're registered.\nGet ready for the challenge.";
  const ctaLabel = isLive ? "Join Race" : urgent ? "Join Waiting Room" : "Open Waiting Room";

  const shimmerX = shimmer.interpolate({
    inputRange: [0, 1],
    outputRange: [-120, 320],
  });

  const particles = useMemo(
    () => [
      { top: rs(18), left: rs(22), size: 3, opacity: 0.55 },
      { top: rs(42), right: rs(34), size: 2.5, opacity: 0.4 },
      { bottom: rs(54), left: rs(48), size: 2, opacity: 0.35 },
      { bottom: rs(28), right: rs(58), size: 3, opacity: 0.5 },
      { top: rs(68), left: "46%" as const, size: 2, opacity: 0.3 },
    ],
    [],
  );

  const showCountdown = !isLive && hasStart && !parts.expired;

  return (
    <Animated.View
      style={[
        styles.wrap,
        {
          shadowColor: theme.shadow,
          transform: [{ scale: pulse }],
          opacity: glow.interpolate({ inputRange: [0.45, 0.9], outputRange: [0.98, 1] }),
        },
      ]}
    >
      <LinearGradient
        colors={isLive ? theme.cardLiveGrad : theme.cardGrad}
        style={[styles.card, urgent && !isLive && styles.cardUrgent, isLive && styles.cardLive]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
      >
        <View
          style={[
            styles.neonBorder,
            { borderColor: isLive ? theme.neonLive : theme.neon },
            isLive && styles.neonBorderLive,
          ]}
          pointerEvents="none"
        />

        <Animated.View
          pointerEvents="none"
          style={[
            styles.shimmer,
            {
              transform: [{ translateX: shimmerX }],
              opacity: shimmer.interpolate({ inputRange: [0, 0.2, 0.8, 1], outputRange: [0, 0.35, 0.35, 0] }),
            },
          ]}
        />

        {particles.map((p, i) => (
          <Animated.View
            key={i}
            pointerEvents="none"
            style={[
              styles.particle,
              {
                top: (p as { top?: number }).top,
                bottom: (p as { bottom?: number }).bottom,
                left: (p as { left?: number | `${number}%` }).left,
                right: (p as { right?: number }).right,
                width: p.size,
                height: p.size,
                borderRadius: p.size,
                opacity: p.opacity,
                backgroundColor: theme.particle,
                transform: [{ translateY: particleY }],
              },
            ]}
          />
        ))}

        <View style={styles.topRow}>
          <View
            style={[
              styles.badge,
              {
                backgroundColor: isLive ? "rgba(16,185,129,0.35)" : theme.badgeBg,
                borderColor: isLive ? "rgba(110,231,183,0.55)" : theme.badgeBorder,
              },
            ]}
          >
            <Text style={[styles.badgeText, { color: isLive ? "#D1FAE5" : theme.badgeText }]}>
              {isLive ? "LIVE EVENT" : theme.badgeLabel}
            </Text>
          </View>
          <View style={styles.registeredBadge}>
            <Text style={styles.registeredText}>{isLive ? "● RACING" : "✓ REGISTERED"}</Text>
          </View>
        </View>

        <Text style={styles.title}>{title}</Text>
        <Text style={styles.subtitle}>{subtitle}</Text>

        <View style={styles.midRow}>
          <Animated.View style={[styles.trophyWrap, { transform: [{ translateY: particleY }] }]}>
            <LinearGradient colors={theme.trophyGrad} style={styles.trophyOrb} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}>
              <Text style={styles.trophyEmoji}>{isLive ? "🏁" : "🏆"}</Text>
            </LinearGradient>
            {(challengeType === "coins" || challengeType === "sponsored") && (
              <>
                <Image source={COIN_IMG} style={styles.floatCoin1} resizeMode="contain" />
                <Image source={COIN_IMG} style={styles.floatCoin2} resizeMode="contain" />
              </>
            )}
          </Animated.View>

          <View style={styles.countdownBlock}>
            {showCountdown && (
              <>
                <Text style={[styles.startsIn, { color: theme.startsIn }]}>STARTS IN</Text>
                <View style={styles.timeRow}>
                  <TimeBox value={pad2(parts.h)} label="HRS" urgent={urgent} theme={theme} />
                  <Text style={[styles.colon, { color: theme.colon }]}>:</Text>
                  <TimeBox value={pad2(parts.m)} label="MINS" urgent={urgent} theme={theme} />
                  <Text style={[styles.colon, { color: theme.colon }]}>:</Text>
                  <TimeBox value={pad2(parts.s)} label="SECS" urgent={urgent} theme={theme} />
                </View>
              </>
            )}
            {!isLive && !showCountdown && (
              <View style={styles.livePill}>
                <Text style={styles.livePillText}>You're registered — waiting room open</Text>
              </View>
            )}
            {isLive && (
              <View style={styles.livePill}>
                <Text style={styles.livePillText}>Race in progress</Text>
              </View>
            )}
          </View>
        </View>

        <View style={styles.infoRow}>
          <InfoPill
            icon={<Text style={styles.infoEmoji}>👥</Text>}
            text={`${registeredCount} / ${maxSlots}`}
            borderColor={theme.pillBorder}
          />
          <InfoPill
            icon={<Text style={styles.infoEmoji}>🎯</Text>}
            text={`${targetSteps.toLocaleString()} Steps`}
            borderColor={theme.pillBorder}
          />
          <InfoPill
            icon={<Text style={styles.infoEmoji}>🎁</Text>}
            text={prizeText}
            borderColor={theme.pillBorder}
          />
        </View>

        {!isLive && (
          <View style={styles.progressBlock}>
            <Text style={styles.progressMsg}>Almost time! Keep your steps going 💪</Text>
            <View style={styles.progressTrack}>
              <LinearGradient
                colors={theme.progressGrad}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={[styles.progressFill, { width: `${Math.max(8, slotPct * 100)}%` as `${number}%` }]}
              />
            </View>
          </View>
        )}

        <TouchableOpacity activeOpacity={0.88} onPress={onPressCta} style={styles.ctaTouch}>
          <LinearGradient
            colors={isLive ? theme.ctaLiveGrad : theme.ctaGrad}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={styles.cta}
          >
            <Text style={styles.ctaText}>{ctaLabel}</Text>
            <Feather name="chevron-right" size={18} color="#FFF" />
          </LinearGradient>
        </TouchableOpacity>
      </LinearGradient>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginBottom: rs(12),
    borderRadius: rs(24),
    shadowOpacity: 0.45,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 6 },
    elevation: 10,
  },
  card: {
    borderRadius: rs(24),
    padding: rs(16),
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  cardUrgent: {
    borderColor: "rgba(255,255,255,0.18)",
  },
  cardLive: {
    borderColor: "rgba(52,211,153,0.35)",
  },
  neonBorder: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: rs(24),
    borderWidth: 1.5,
  },
  neonBorderLive: {
    borderWidth: 2,
  },
  shimmer: {
    position: "absolute",
    top: 0,
    bottom: 0,
    width: rs(70),
    backgroundColor: "rgba(255,255,255,0.14)",
    transform: [{ skewX: "-18deg" }],
  },
  particle: {
    position: "absolute",
  },
  topRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: rs(8),
    gap: rs(8),
  },
  badge: {
    borderWidth: 1,
    paddingHorizontal: rs(8),
    paddingVertical: rs(4),
    borderRadius: rs(8),
  },
  badgeText: {
    fontSize: rf(9),
    fontWeight: "800",
    letterSpacing: 0.6,
  },
  registeredBadge: {
    backgroundColor: "rgba(16,185,129,0.22)",
    borderColor: "rgba(52,211,153,0.65)",
    borderWidth: 1,
    paddingHorizontal: rs(8),
    paddingVertical: rs(4),
    borderRadius: rs(999),
  },
  registeredText: {
    color: "#6EE7B7",
    fontSize: rf(10),
    fontWeight: "800",
  },
  title: {
    color: "#FFF",
    fontSize: rf(20),
    fontWeight: "900",
    letterSpacing: 0.2,
  },
  subtitle: {
    color: "rgba(237,233,254,0.82)",
    fontSize: rf(12),
    lineHeight: rf(16),
    marginTop: rs(2),
    marginBottom: rs(12),
  },
  midRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: rs(10),
    marginBottom: rs(12),
  },
  trophyWrap: {
    width: rs(64),
    height: rs(64),
    alignItems: "center",
    justifyContent: "center",
  },
  trophyOrb: {
    width: rs(56),
    height: rs(56),
    borderRadius: rs(18),
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.25)",
  },
  trophyEmoji: { fontSize: rf(28) },
  floatCoin1: {
    position: "absolute",
    width: rs(16),
    height: rs(16),
    top: -2,
    right: -2,
  },
  floatCoin2: {
    position: "absolute",
    width: rs(13),
    height: rs(13),
    bottom: 2,
    left: -4,
    opacity: 0.85,
  },
  countdownBlock: { flex: 1 },
  startsIn: {
    fontSize: rf(10),
    fontWeight: "800",
    letterSpacing: 1,
    marginBottom: rs(6),
  },
  timeRow: {
    flexDirection: "row",
    alignItems: "flex-start",
  },
  timeBoxWrap: { alignItems: "center" },
  timeBox: {
    minWidth: rs(42),
    paddingHorizontal: rs(8),
    paddingVertical: rs(7),
    borderRadius: rs(10),
    alignItems: "center",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.25)",
  },
  timeValue: {
    color: "#FFF",
    fontSize: rf(18),
    fontWeight: "900",
    fontVariant: ["tabular-nums"],
  },
  timeLabel: {
    fontSize: rf(8),
    fontWeight: "700",
    marginTop: rs(3),
    letterSpacing: 0.5,
  },
  colon: {
    fontSize: rf(18),
    fontWeight: "800",
    marginHorizontal: rs(4),
    marginTop: rs(6),
  },
  livePill: {
    alignSelf: "flex-start",
    backgroundColor: "rgba(16,185,129,0.2)",
    borderColor: "rgba(52,211,153,0.55)",
    borderWidth: 1,
    borderRadius: rs(10),
    paddingHorizontal: rs(12),
    paddingVertical: rs(10),
  },
  livePillText: {
    color: "#6EE7B7",
    fontSize: rf(13),
    fontWeight: "800",
  },
  infoRow: {
    flexDirection: "row",
    gap: rs(6),
    marginBottom: rs(10),
  },
  infoPill: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: rs(4),
    backgroundColor: "rgba(15,10,40,0.55)",
    borderWidth: 1,
    borderRadius: rs(10),
    paddingHorizontal: rs(7),
    paddingVertical: rs(7),
  },
  infoEmoji: { fontSize: rf(11) },
  infoPillText: {
    flexShrink: 1,
    color: "#EDE9FE",
    fontSize: rf(9.5),
    fontWeight: "700",
  },
  progressBlock: { marginBottom: rs(12) },
  progressMsg: {
    color: "rgba(237,233,254,0.85)",
    fontSize: rf(11),
    fontWeight: "600",
    marginBottom: rs(6),
  },
  progressTrack: {
    height: rs(6),
    borderRadius: rs(999),
    backgroundColor: "rgba(255,255,255,0.1)",
    overflow: "hidden",
  },
  progressFill: {
    height: "100%",
    borderRadius: rs(999),
  },
  ctaTouch: { borderRadius: rs(14), overflow: "hidden" },
  cta: {
    height: rs(48),
    borderRadius: rs(14),
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: rs(6),
  },
  ctaText: {
    color: "#FFF",
    fontSize: rf(15),
    fontWeight: "800",
  },
});
