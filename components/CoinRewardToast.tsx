import React, { useEffect, useRef } from "react";
import { Animated, StyleSheet, Text, View } from "react-native";
import { useSafeLayout } from "@/hooks/useSafeLayout";
import { useAuth } from "@/context/AuthContext";
import {
  CHANNELS,
  EVENTS,
  subscribeToChannel,
  unsubscribeFromChannel,
} from "@/services/realtimeService";
import CoinIcon from "@/components/CoinIcon";
import * as Haptics from "@/utils/haptics";
import { useTopBanner, type BannerItem } from "@/context/TopBannerContext";
import { useTheme } from "@/context/ThemeContext";
import { rf } from "@/utils/responsive";

const BANNER_DURATION_MS = 10_000;
/** Sit below the status bar / Walk stats so text is not clipped at the top. */
const BANNER_BELOW_SAFE_TOP = 52;

function coinsPalette(isDark: boolean) {
  if (isDark) {
    return {
      bg: "#1A1408",
      border: "#F5C518",
      amount: "#FFD700",
      desc: "#FFF8DC",
      sep: "#F5C51866",
      tagBg: "#F5C518",
      tagFg: "#1A1408",
    };
  }
  return {
    bg: "#FFF8E7",
    border: "#C9A227",
    amount: "#8B5A00",
    desc: "#1C1408",
    sep: "#C9A22766",
    tagBg: "#C9A227",
    tagFg: "#FFFFFF",
  };
}

function noticePalette(isDark: boolean, isGold: boolean) {
  if (isDark) {
    return {
      bg: isGold ? "#140E00F0" : "#0D1F2AF0",
      border: isGold ? "#FFD70088" : "#38BDF8AA",
      headline: isGold ? "#FFD700" : "#7DD3FC",
      body: "#F8FAFC",
      tagBg: isGold ? "#FFD700" : "#0EA5E9",
      tagFg: isGold ? "#1A1408" : "#05202E",
    };
  }
  return {
    bg: isGold ? "#FFFBEB" : "#F0F9FF",
    border: isGold ? "#D97706" : "#0284C7",
    headline: isGold ? "#B45309" : "#0369A1",
    body: "#0F172A",
    tagBg: isGold ? "#D97706" : "#0284C7",
    tagFg: "#FFFFFF",
  };
}

function BannerCard({ item }: { item: BannerItem }) {
  const { isDark } = useTheme();
  const translateY = useRef(new Animated.Value(-100)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  const hapticFiredRef = useRef(false);

  useEffect(() => {
    if (!hapticFiredRef.current) {
      hapticFiredRef.current = true;
      if (item.haptic === "success") {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } else {
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }
    }

    Animated.parallel([
      Animated.spring(translateY, {
        toValue: 0,
        useNativeDriver: true,
        friction: 9,
        tension: 65,
      }),
      Animated.timing(opacity, { toValue: 1, duration: 200, useNativeDriver: true }),
    ]).start();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (item.type === "finish_goal") {
    const pal = noticePalette(isDark, !!item.isGold);
    return (
      <Animated.View
        pointerEvents="none"
        style={[
          fg.card,
          {
            opacity,
            transform: [{ translateY }],
            backgroundColor: pal.bg,
            borderColor: pal.border,
          },
        ]}
      >
        <View style={[fg.tag, { backgroundColor: pal.tagBg }]}>
          <Text style={[fg.tagTxt, { color: pal.tagFg }]}>RACE</Text>
        </View>
        <Text style={fg.rankEmoji}>{item.emoji}</Text>
        <View style={fg.textCol}>
          <Text style={[fg.headline, { color: pal.headline }]}>{item.headline ?? "FINISH!"}</Text>
          <Text style={[fg.body, { color: pal.body }]} numberOfLines={2}>
            <Text style={item.isMe ? fg.meHighlight : [fg.nameHighlight, { color: pal.body }]}>
              {item.isMe ? "You" : (item.username ?? "")}
            </Text>
            {" "}{item.body ?? ""}
          </Text>
        </View>
      </Animated.View>
    );
  }

  const pal = coinsPalette(isDark);
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        ce.pill,
        {
          opacity,
          transform: [{ translateY }],
          backgroundColor: pal.bg,
          borderColor: pal.border,
          shadowColor: pal.border,
        },
      ]}
    >
      <CoinIcon size="small" />
      <Text style={[ce.amount, { color: pal.amount }]}>+{item.coins}</Text>
      <View style={[ce.sep, { backgroundColor: pal.sep }]} />
      <Text style={[ce.desc, { color: pal.desc }]} numberOfLines={2}>
        {item.description}
      </Text>
    </Animated.View>
  );
}

interface CoinEarnedPayload {
  coins: number;
  description: string;
  rewardCode: string;
}

function CoinRewardListener() {
  const { user } = useAuth();
  const { enqueueBanner } = useTopBanner();

  useEffect(() => {
    if (!user?.id) return;
    const channelName = CHANNELS.privateUser(user.id);
    const channel = subscribeToChannel(channelName);
    if (!channel) return;

    const onCoinsEarned = (data: CoinEarnedPayload) => {
      enqueueBanner({
        id: `coins-earned-${data.rewardCode}-${user.id}`,
        type: "coins_earned",
        coins: data.coins,
        description: data.description,
        haptic: "light",
        durationMs: BANNER_DURATION_MS,
      });
    };

    channel.bind(EVENTS.COINS_EARNED, onCoinsEarned);
    return () => {
      channel.unbind(EVENTS.COINS_EARNED, onCoinsEarned);
      unsubscribeFromChannel(channelName);
    };
  }, [user?.id, enqueueBanner]);

  return null;
}

export default function CoinRewardToast() {
  const { safeTop } = useSafeLayout();
  const { visible } = useTopBanner();

  return (
    <>
      <CoinRewardListener />
      {visible.length > 0 && (
        <View
          pointerEvents="none"
          style={[wrap.container, { top: safeTop + BANNER_BELOW_SAFE_TOP }]}
        >
          {visible.map((item) => (
            <BannerCard key={item.id} item={item} />
          ))}
        </View>
      )}
    </>
  );
}

const wrap = StyleSheet.create({
  container: {
    position: "absolute",
    left: 16,
    right: 16,
    zIndex: 99999,
    alignItems: "center",
    gap: 8,
  },
});

const fg = StyleSheet.create({
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderRadius: 16,
    borderWidth: 2,
    shadowColor: "#000",
    shadowOpacity: 0.35,
    shadowRadius: 14,
    elevation: 20,
    maxWidth: "100%",
    alignSelf: "stretch",
  },
  tag: {
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 3,
  },
  tagTxt: { fontSize: rf(9), fontWeight: "900", letterSpacing: 0.6 },
  rankEmoji: { fontSize: rf(28) },
  textCol: { flex: 1, minWidth: 0 },
  headline: { fontSize: rf(10), fontWeight: "900", letterSpacing: 2.5, marginBottom: 2 },
  body: { fontSize: rf(14), fontWeight: "700", lineHeight: 20 },
  meHighlight: { color: "#00C853", fontWeight: "900" },
  nameHighlight: { fontWeight: "900" },
});

const ce = StyleSheet.create({
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 18,
    borderWidth: 1.5,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.35,
    shadowRadius: 12,
    elevation: 12,
    maxWidth: "100%",
    alignSelf: "center",
  },
  amount: { fontSize: rf(16), fontWeight: "900" },
  sep: { width: 1, height: 16 },
  desc: { fontSize: rf(13), fontWeight: "600", flexShrink: 1 },
});
