import React, { useCallback, useEffect, useRef } from "react";
import { Animated, Image, StyleSheet, Text, View } from "react-native";
import { useSafeLayout } from "@/hooks/useSafeLayout";
import { useAuth } from "@/context/AuthContext";
import { CHANNELS, EVENTS, subscribeToChannel } from "@/services/realtimeService";
import CoinIcon from "@/components/CoinIcon";
import * as Haptics from "@/utils/haptics";
import { useTopBanner, type BannerItem } from "@/context/TopBannerContext";

// ── Individual animated banner card ──────────────────────────────────────────

function BannerCard({ item }: { item: BannerItem }) {
  const translateY = useRef(new Animated.Value(-100)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  const hapticFiredRef = useRef(false);

  useEffect(() => {
    // Haptic — fire once per banner display
    if (!hapticFiredRef.current) {
      hapticFiredRef.current = true;
      if (item.haptic === "success") {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } else {
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }
    }

    // Slide in + fade in
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
    return (
      <Animated.View
        pointerEvents="none"
        style={[fg.card, item.isGold && fg.cardGold, { opacity, transform: [{ translateY }] }]}
      >
        <Text style={fg.rankEmoji}>{item.emoji}</Text>
        <View style={fg.textCol}>
          <Text style={fg.headline}>{item.headline ?? "FINISH!"}</Text>
          <Text style={fg.body} numberOfLines={2}>
            <Text style={item.isMe ? fg.meHighlight : fg.nameHighlight}>
              {item.isMe ? "You" : (item.username ?? "")}
            </Text>
            {" "}{item.body ?? ""}
          </Text>
        </View>
      </Animated.View>
    );
  }

  // coins_earned
  return (
    <Animated.View
      pointerEvents="none"
      style={[ce.pill, { opacity, transform: [{ translateY }] }]}
    >
      <CoinIcon size="small" />
      <Text style={ce.amount}>+{item.coins}</Text>
      <View style={ce.sep} />
      <Text style={ce.desc} numberOfLines={1}>{item.description}</Text>
    </Animated.View>
  );
}

// ── Pusher listener — feeds coins_earned events into the queue ────────────────

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
    const channel = subscribeToChannel(CHANNELS.privateUser(user.id));
    if (!channel) return;

    const onCoinsEarned = (data: CoinEarnedPayload) => {
      enqueueBanner({
        id: `coins-earned-${data.rewardCode}-${user.id}`,
        type: "coins_earned",
        coins: data.coins,
        description: data.description,
        haptic: "light",
        durationMs: 5000,
      });
    };

    channel.bind(EVENTS.COINS_EARNED, onCoinsEarned);
    return () => { channel.unbind(EVENTS.COINS_EARNED, onCoinsEarned); };
  }, [user?.id, enqueueBanner]);

  return null;
}

// ── Global display — renders stacked banners below the safe area ──────────────

export default function CoinRewardToast() {
  const { safeTop } = useSafeLayout();
  const { visible } = useTopBanner();

  return (
    <>
      <CoinRewardListener />
      {visible.length > 0 && (
        <View
          pointerEvents="none"
          style={[wrap.container, { top: safeTop + 8 }]}
        >
          {visible.map((item) => (
            <BannerCard key={item.id} item={item} />
          ))}
        </View>
      )}
    </>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const wrap = StyleSheet.create({
  container: {
    position: "absolute",
    left: 0,
    right: 0,
    zIndex: 99999,
    alignItems: "center",
    gap: 8,
  },
});

const fg = StyleSheet.create({
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 11,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: "#C0C0C055",
    backgroundColor: "#1A1F36F0",
    shadowColor: "#000",
    shadowOpacity: 0.7,
    shadowRadius: 14,
    elevation: 20,
    maxWidth: "90%",
  },
  cardGold: {
    borderColor: "#FFD70088",
    backgroundColor: "#140E00F0",
    shadowColor: "#FFD700",
    shadowOpacity: 0.55,
  },
  rankEmoji: { fontSize: 28 },
  textCol:   { flex: 1 },
  headline:  { fontSize: 10, fontWeight: "900", letterSpacing: 2.5, color: "#FFD700", marginBottom: 2 },
  body:      { fontSize: 14, fontWeight: "700", color: "#FFFFFF", lineHeight: 20 },
  meHighlight:   { color: "#00E676", fontWeight: "900" },
  nameHighlight: { color: "#FFFFFF", fontWeight: "900" },
});

const ce = StyleSheet.create({
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: "#1A1400",
    borderWidth: 1.5,
    borderColor: "#FFD700",
    shadowColor: "#FFD700",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.45,
    shadowRadius: 12,
    elevation: 12,
    maxWidth: 340,
  },
  amount: { fontSize: 16, fontWeight: "900", color: "#FFD700" },
  sep:    { width: 1, height: 14, backgroundColor: "#FFD70040" },
  desc:   { fontSize: 13, fontWeight: "600", color: "#FFF9E6", flexShrink: 1 },
});
