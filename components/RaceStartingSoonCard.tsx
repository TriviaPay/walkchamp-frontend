import React, { useEffect, useRef, useState } from "react";
import {
  AccessibilityInfo,
  Animated,
  Easing,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Feather } from "@expo/vector-icons";
import { TouchableOpacity } from "@/components/HapticTouchableOpacity";
import { rf, rs } from "@/utils/responsive";
import {
  getSponsoredPrizePerWinnerUsd,
  SPONSORED_DEFAULT_TARGET_STEPS,
} from "@/utils/sponsoredEventsApi";

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
  /** Optional outer wrapper style (e.g. carousel card width). */
  style?: StyleProp<ViewStyle>;
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
    startsIn: "rgba(254,215,170,0.9)",
    colon: "#FDBA74",
    pillBorder: "rgba(251,146,60,0.28)",
  },
  cash: {
    badgeLabel: "CASH",
    badgeBg: "rgba(250,204,21,0.28)",
    badgeBorder: "rgba(253,224,71,0.75)",
    badgeText: "#FEF08A",
    cardGrad: ["#0c0a09", "#1a1408", "#292010"],
    cardLiveGrad: ["#052e16", "#065f46", "#064e3b"],
    shadow: "#FBBF24",
    neon: "rgba(251,191,36,0.65)",
    neonLive: "rgba(52,211,153,0.75)",
    timeGrad: ["#292524", "#44403C"],
    timeUrgentGrad: ["#78350F", "#EAB308"],
    trophyGrad: ["#CA8A04", "#FDE047"],
    progressGrad: ["#A16207", "#FACC15"],
    ctaGrad: ["#A16207", "#EAB308"],
    ctaLiveGrad: ["#059669", "#10B981"],
    startsIn: "rgba(253,230,138,0.95)",
    colon: "#FDE047",
    pillBorder: "rgba(250,204,21,0.35)",
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

function useReducedMotion() {
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (mounted) setReducedMotion(enabled);
    });
    const subscription = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      setReducedMotion,
    );
    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);

  return reducedMotion;
}

/** Display-only countdown status copy from remaining ms. */
function daysToGoMessage(totalMs: number): string {
  if (totalMs <= 0) return "Almost time! Keep your steps going";
  const days = Math.ceil(totalMs / 86_400_000);
  if (days <= 1) return "Almost time! Keep your steps going";
  return `${days} days to go`;
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
      return `$${usd}`;
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
        style={[
          styles.timeBox,
          { borderColor: urgent ? theme.badgeBorder : theme.pillBorder },
        ]}
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
  style,
}: {
  icon: React.ReactNode;
  text: string;
  borderColor: string;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[styles.infoPill, style, { borderColor }]}>
      {icon}
      <Text
        style={styles.infoPillText}
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.78}
      >
        {text}
      </Text>
    </View>
  );
}

function EntryFeePill({
  challengeType,
  entryAmountCents,
  coinEntryAmount,
  borderColor,
  accentColor,
}: {
  challengeType: RaceStartingSoonChallengeType;
  entryAmountCents?: number;
  coinEntryAmount?: number;
  borderColor: string;
  accentColor: string;
}) {
  const isCash = challengeType === "cash";
  const isCoins = challengeType === "coins";
  const cashAmount =
    entryAmountCents && entryAmountCents > 0
      ? `$${(entryAmountCents / 100).toFixed(entryAmountCents % 100 === 0 ? 0 : 2)}`
      : "Cash";
  const coinsAmount =
    coinEntryAmount && coinEntryAmount > 0
      ? `${coinEntryAmount.toLocaleString()} Coins`
      : "Coins";

  return (
    <View
      style={[
        styles.infoPill,
        styles.entryFeePill,
        isCoins && styles.coinsEntryFeePill,
        { borderColor },
      ]}
    >
      {!isCoins && (
        <Feather
          name={challengeType === "sponsored" ? "award" : "credit-card"}
          size={rf(isCash ? 14 : 12)}
          color={accentColor}
        />
      )}
      <View style={[styles.entryFeeCopy, isCoins && styles.entryFeeCopyCoins]}>
        <Text
          style={styles.entryFeeLabel}
          numberOfLines={1}
          adjustsFontSizeToFit
        >
          {isCash ? "Entry Fee" : isCoins ? "Entry" : challengeType === "free" ? "Entry" : "Reward"}
        </Text>
        <Text
          style={[
            styles.entryFeeAmount,
            isCoins && styles.coinsEntryFeeAmount,
            isCash && styles.cashEntryFeeAmount,
            { color: accentColor },
          ]}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.72}
        >
          {isCash ? cashAmount : isCoins ? coinsAmount : challengeType === "free" ? "FREE" : "Prize"}
        </Text>
      </View>
    </View>
  );
}

/** Reserved prize/reward section shared by every challenge type. */
function PrizeSection({
  label,
  amount,
  accentColor,
  shimmerEnabled,
  reducedMotion,
  descriptive = false,
  emphasis = "default",
}: {
  label: string;
  amount: string;
  accentColor: string;
  shimmerEnabled: boolean;
  reducedMotion: boolean;
  /** Word-based reward copy (e.g. "Coins + Badges") renders smaller / two lines. */
  descriptive?: boolean;
  emphasis?: "default" | "coins" | "cash";
}) {
  const shimmer = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (reducedMotion || !shimmerEnabled) {
      shimmer.setValue(0);
      return;
    }
    const shimmerLoop = Animated.loop(
      Animated.sequence([
        Animated.delay(emphasis === "coins" ? 3600 : 3000),
        Animated.timing(shimmer, {
          toValue: 1,
          duration: 1100,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(shimmer, { toValue: 0, duration: 0, useNativeDriver: true }),
      ]),
    );
    shimmerLoop.start();
    return () => shimmerLoop.stop();
  }, [emphasis, reducedMotion, shimmer, shimmerEnabled]);

  const shimmerX = shimmer.interpolate({
    inputRange: [0, 1],
    outputRange: [-80, 220],
  });

  return (
    <View style={styles.prizeSection}>
      <View style={styles.prizeHeading}>
        <View style={[styles.prizeRule, { backgroundColor: accentColor }]} />
        <Text style={[styles.prizeLabel, { color: accentColor }]}>{label}</Text>
        <View style={[styles.prizeRule, { backgroundColor: accentColor }]} />
      </View>
      <View style={styles.prizeAmountWrap}>
        <Text
          style={[
            descriptive ? styles.prizeAmountDescriptive : styles.prizeAmount,
            emphasis === "coins" && styles.prizeAmountCoins,
            emphasis === "cash" && styles.prizeAmountCash,
            {
              color: accentColor,
              textShadowColor: `${accentColor}80`,
            },
          ]}
          numberOfLines={descriptive ? 2 : 1}
          adjustsFontSizeToFit
          minimumFontScale={descriptive ? 0.7 : 0.8}
        >
          {amount}
        </Text>
        {!reducedMotion && shimmerEnabled && (
          <Animated.View
            pointerEvents="none"
            style={[
              styles.prizeShimmer,
              {
                transform: [{ translateX: shimmerX }],
                opacity: shimmer.interpolate({
                  inputRange: [0, 0.15, 0.5, 0.85, 1],
                  outputRange: [0, 0.2, 0.38, 0.2, 0],
                }),
              },
            ]}
          />
        )}
      </View>
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
  entryAmountCents,
  onPressCta,
  style,
}: RaceStartingSoonCardProps) {
  const theme = THEMES[challengeType];
  const isCash = challengeType === "cash";
  const reducedMotion = useReducedMotion();
  const hasStart = Boolean(scheduledStartAt);
  const parts = useStartsInParts(phase === "racing" ? null : scheduledStartAt);
  const urgent =
    phase === "join_window" ||
    (!parts.expired && parts.totalMs > 0 && parts.totalMs < 10 * 60_000);
  const isLive = phase === "racing" || (hasStart && parts.expired && phase !== "registered");

  const glow = useRef(new Animated.Value(0.45)).current;

  useEffect(() => {
    if (reducedMotion) {
      glow.setValue(0.7);
      return;
    }
    const breathe = Animated.loop(
      Animated.sequence([
        Animated.timing(glow, { toValue: 0.9, duration: 1800, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(glow, { toValue: 0.45, duration: 1800, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ]),
    );
    breathe.start();
    return () => breathe.stop();
  }, [glow, reducedMotion]);

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
  const progressMsg = !isLive && !parts.expired
    ? daysToGoMessage(parts.totalMs)
    : "Almost time! Keep your steps going";

  const thirdInfoText =
    challengeType === "cash"
      ? entryAmountCents && entryAmountCents > 0
        ? `Entry $${(entryAmountCents / 100).toFixed(entryAmountCents % 100 === 0 ? 0 : 2)}`
        : "Cash Entry"
      : challengeType === "sponsored"
        ? `Reward ${prizeText}`
        : challengeType === "coins"
          ? coinEntryAmount && coinEntryAmount > 0
            ? `Entry ${coinEntryAmount.toLocaleString()} Coins`
            : "Coins Entry"
          : "Entry Free";
  const prizeLabel =
    challengeType === "sponsored"
      ? "REWARD"
      : challengeType === "free"
        ? "REWARDS"
        : challengeType === "coins"
          ? "COINS PRIZE POOL"
          : "PRIZE POOL";
  // Positive, challenge-specific reward copy — never "No cash prize".
  const coinsPoolText =
    coinEntryAmount && coinEntryAmount > 0
      ? `${(coinEntryAmount * Math.max(1, registeredCount)).toLocaleString()} Coins`
      : null;
  const prizeDisplay =
    challengeType === "free"
      ? "Coins + Badges"
      : challengeType === "coins"
        ? coinsPoolText ?? "Coin prize updates as players join"
        : prizeText;
  // Descriptive (word) rewards use a smaller two-line style; numeric pools stay large.
  const prizeDescriptive =
    challengeType === "free" || (challengeType === "coins" && !coinsPoolText);
  const prizeAccent =
    challengeType === "cash"
      ? "#FDE047"
      : challengeType === "sponsored"
        ? "#D8B4FE"
        : challengeType === "coins"
          ? "#FDBA74"
          : "#6EE7B7";

  const showCountdown = !isLive && hasStart && !parts.expired;

  return (
    <Animated.View
      style={[
        styles.wrap,
        style,
        {
          shadowColor: theme.shadow,
          opacity: glow.interpolate({ inputRange: [0.45, 0.9], outputRange: [0.98, 1] }),
        },
      ]}
    >
      <LinearGradient
        colors={isLive ? theme.cardLiveGrad : theme.cardGrad}
        style={[
          styles.card,
          urgent && !isLive && styles.cardUrgent,
          isLive && styles.cardLive,
        ]}
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

        <View style={styles.topRow}>
          <View
            style={[
              styles.badge,
              {
                backgroundColor: isLive ? "rgba(16,185,129,0.35)" : theme.badgeBg,
                borderColor: isLive ? "rgba(110,231,183,0.55)" : theme.badgeBorder,
              },
              isCash && !isLive && styles.badgeCash,
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

        <Text style={styles.title} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.85}>
          {title}
        </Text>
        <Text style={styles.subtitle} numberOfLines={2}>
          {subtitle}
        </Text>

        <View style={styles.midRow}>
          <View style={styles.countdownIconWrap}>
            <LinearGradient
              colors={theme.trophyGrad}
              style={styles.countdownIcon}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
            >
              <Feather name="clock" size={rf(20)} color="#FFF" />
            </LinearGradient>
          </View>

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

        <View
          style={[
            styles.infoRow,
            (isCash || challengeType === "coins") && styles.infoRowEmphasized,
          ]}
        >
          <InfoPill
            icon={<Text style={styles.infoEmoji}>👥</Text>}
            text={`${registeredCount} / ${maxSlots}`}
            borderColor={theme.pillBorder}
            style={challengeType === "coins" ? styles.coinsSecondaryInfoPill : undefined}
          />
          <InfoPill
            icon={<Text style={styles.infoEmoji}>🎯</Text>}
            text={`${targetSteps.toLocaleString()} Steps`}
            borderColor={theme.pillBorder}
            style={challengeType === "coins" ? styles.coinsStepInfoPill : undefined}
          />
          {isCash || challengeType === "coins" ? (
            <EntryFeePill
              challengeType={challengeType}
              entryAmountCents={entryAmountCents}
              coinEntryAmount={coinEntryAmount}
              borderColor={theme.pillBorder}
              accentColor={prizeAccent}
            />
          ) : (
            <InfoPill
              icon={
                challengeType === "free" ? (
                  <Text style={styles.infoEmoji}>🎁</Text>
                ) : (
                  <Feather name="award" size={rf(11)} color={theme.startsIn} />
                )
              }
              text={thirdInfoText}
              borderColor={theme.pillBorder}
            />
          )}
        </View>

        <PrizeSection
          label={prizeLabel}
          amount={prizeDisplay}
          accentColor={prizeAccent}
          shimmerEnabled={(isCash || challengeType === "coins") && !isLive}
          reducedMotion={reducedMotion}
          descriptive={prizeDescriptive}
          emphasis={isCash ? "cash" : challengeType === "coins" ? "coins" : "default"}
        />

        {!isLive && (
          <View style={styles.progressBlock}>
            <Text style={[styles.progressMsg, isCash && styles.progressMsgCash]}>{progressMsg}</Text>
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
    height: Math.max(rs(455), 410),
    marginBottom: rs(12),
    borderRadius: rs(24),
    shadowOpacity: 0.45,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 6 },
    elevation: 10,
  },
  card: {
    flex: 1,
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
  topRow: {
    flexDirection: "row",
    flexWrap: "wrap",
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
  badgeCash: {
    shadowColor: "#FACC15",
    shadowOpacity: 0.25,
    shadowRadius: 5,
    shadowOffset: { width: 0, height: 0 },
  },
  badgeText: {
    fontSize: rf(9),
    fontWeight: "800",
    letterSpacing: 0.6,
  },
  registeredBadge: {
    marginLeft: "auto",
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
    minHeight: rf(24),
    color: "#FFF",
    fontSize: rf(20),
    fontWeight: "900",
    letterSpacing: 0.2,
  },
  subtitle: {
    minHeight: rf(32),
    color: "rgba(237,233,254,0.82)",
    fontSize: rf(12),
    lineHeight: rf(16),
    marginTop: rs(2),
    marginBottom: rs(12),
  },
  midRow: {
    minHeight: rs(54),
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: rs(10),
    marginBottom: rs(12),
  },
  countdownIconWrap: {
    width: rs(54),
    height: rs(54),
    alignItems: "center",
    justifyContent: "center",
  },
  countdownIcon: {
    width: rs(48),
    height: rs(48),
    borderRadius: rs(24),
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.25)",
  },
  countdownBlock: {
    flex: 1,
    minWidth: rs(160),
  },
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
    minWidth: rs(36),
    paddingHorizontal: rs(5),
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
    marginHorizontal: rs(2),
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
  prizeSection: {
    minHeight: rs(62),
    alignItems: "center",
    marginBottom: rs(12),
    paddingTop: rs(2),
  },
  prizeHeading: {
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: rs(6),
    marginBottom: rs(5),
  },
  prizeRule: {
    flex: 1,
    maxWidth: rs(64),
    height: StyleSheet.hairlineWidth,
    opacity: 0.5,
  },
  prizeLabel: {
    fontSize: rf(10),
    fontWeight: "800",
    letterSpacing: 1.4,
  },
  prizeAmountWrap: {
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
    minWidth: rs(130),
    paddingHorizontal: rs(8),
  },
  prizeAmount: {
    maxWidth: rs(220),
    fontSize: rf(28),
    fontWeight: "900",
    letterSpacing: 0.5,
    fontVariant: ["tabular-nums"],
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 7,
  },
  prizeAmountCoins: {
    maxWidth: rs(250),
    fontSize: rf(35),
    textShadowRadius: 9,
  },
  prizeAmountCash: {
    maxWidth: rs(250),
    fontSize: rf(38),
    textShadowRadius: 10,
  },
  prizeAmountDescriptive: {
    maxWidth: rs(240),
    fontSize: rf(17),
    lineHeight: rf(21),
    fontWeight: "900",
    letterSpacing: 0.3,
    textAlign: "center",
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 6,
  },
  prizeShimmer: {
    position: "absolute",
    top: rs(4),
    bottom: rs(4),
    width: rs(26),
    backgroundColor: "rgba(255,255,255,0.45)",
    transform: [{ skewX: "-18deg" }],
  },
  infoRow: {
    height: rs(36),
    flexDirection: "row",
    gap: rs(6),
    marginBottom: rs(10),
  },
  infoRowEmphasized: {
    height: rs(42),
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
    paddingVertical: rs(6),
  },
  entryFeePill: {
    flex: 1.32,
    minWidth: 0,
    minHeight: rs(42),
    paddingHorizontal: rs(7),
  },
  coinsEntryFeePill: {
    flex: 1.62,
    paddingHorizontal: rs(9),
  },
  coinsSecondaryInfoPill: {
    flex: 0.82,
  },
  coinsStepInfoPill: {
    flex: 0.96,
  },
  entryFeeCopy: {
    flex: 1,
    minWidth: 0,
    justifyContent: "center",
  },
  entryFeeCopyCoins: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: rs(3),
  },
  entryFeeLabel: {
    color: "rgba(237,233,254,0.72)",
    fontSize: rf(7.5),
    lineHeight: rf(9),
    fontWeight: "700",
    textTransform: "uppercase",
  },
  entryFeeAmount: {
    fontSize: rf(11),
    lineHeight: rf(14),
    fontWeight: "900",
  },
  coinsEntryFeeAmount: {
    fontSize: rf(13),
    lineHeight: rf(15),
  },
  cashEntryFeeAmount: {
    fontSize: rf(15),
    lineHeight: rf(17),
    textShadowColor: "rgba(253,224,71,0.7)",
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 6,
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
  progressMsgCash: {
    color: "rgba(253,230,138,0.9)",
    fontWeight: "700",
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
    shadowColor: "#FACC15",
    shadowOpacity: 0.3,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 0 },
  },
  ctaTouch: {
    marginTop: "auto",
    borderRadius: rs(14),
    overflow: "hidden",
  },
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
