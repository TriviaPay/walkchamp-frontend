import React, { useState } from "react";
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import { useColors } from "@/hooks/useColors";
import { useSafeLayout } from "@/hooks/useSafeLayout";
import { rf } from "@/utils/responsive";

const FAQ: { q: string; a: string }[] = [
  {
    q: "How does Walk Champ track steps?",
    a: "Walk Champ reads your daily steps from Apple Health (iOS) or Health Connect (Android). Steps are synced automatically and stored securely on our servers.",
  },
  {
    q: "How do I connect Apple Health?",
    a: "Go to Profile → Preferences → Wearable Setup and follow the step-by-step guide. Walk Champ will request permission to read your steps from Apple Health.",
  },
  {
    q: "How do I connect Health Connect?",
    a: "Go to Profile → Preferences → Wearable Setup on Android. Walk Champ will guide you through granting Health Connect permissions for Steps.",
  },
  {
    q: "Why are my steps different from my wearable?",
    a: "Differences can occur due to sync timing, wearable battery-saving modes, or data-source priority settings in Apple Health / Health Connect. Make sure your wearable is set as the top data source for Steps.",
  },
  {
    q: "How do Free Challenges work?",
    a: "Free challenges are step-racing competitions with no entry fee. Finish first to win coins. Join one from the Walk tab.",
  },
  {
    q: "How do Coins Battle challenges work?",
    a: "Coins Battle challenges require a coin entry fee. The prize pool is distributed to the top finishers — 100% to 1st in a 2-player race, 60%/40% for 3 players, and 50%/30%/20% for 4+ players.",
  },
  {
    q: "How do Sponsored Events work?",
    a: "Sponsored Events are special challenges run by partners. Winners receive a gift-card reward (e.g., $5). Complete your step goal to be eligible. Event details are shown in the race lobby.",
  },
  {
    q: "How do Groups work?",
    a: "Groups let you compete with friends or teammates. Join or create a group in the Groups tab. Daily group step totals are tracked separately from the global leaderboard.",
  },
  {
    q: "How do coins work?",
    a: "Coins are virtual in-app items earned by walking, completing challenges, achieving streaks, and winning races. Coins have no cash value and cannot be withdrawn or exchanged for real money.",
  },
  {
    q: "Can I withdraw coins?",
    a: "No. Coins are virtual in-app items and have no cash value. Coins cannot be withdrawn or exchanged for real money.",
  },
  {
    q: "How do I delete my account?",
    a: "Go to Profile → Account → Delete Account. You will be asked to confirm twice. Once deleted, your account and data are permanently removed.",
  },
  {
    q: "How do I contact support?",
    a: "Go to Profile → Support → Help & Support to email us or report an issue directly from the app.",
  },
];

export default function FAQScreen() {
  const colors = useColors();
  const { safeTop, safeBottom } = useSafeLayout();
  const [expanded, setExpanded] = useState<number | null>(null);

  return (
    <View style={[s.container, { backgroundColor: colors.background }]}>
      <View style={[s.header, { paddingTop: safeTop + 16, borderBottomColor: colors.border }]}>
        <TouchableOpacity
          onPress={() => router.back()}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Feather name="arrow-left" size={22} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={[s.headerTitle, { color: colors.foreground }]}>FAQ</Text>
        <View style={{ width: 22 }} />
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[s.list, { paddingBottom: safeBottom + 40 }]}
      >
        <Text style={[s.subtitle, { color: colors.mutedForeground }]}>
          Frequently asked questions about Walk Champ.
        </Text>

        {FAQ.map((item, i) => (
          <TouchableOpacity
            key={i}
            style={[s.item, {
              backgroundColor: colors.card,
              borderColor: expanded === i ? colors.primary + "50" : colors.border,
            }]}
            activeOpacity={0.75}
            onPress={() => setExpanded(p => (p === i ? null : i))}
          >
            <View style={s.itemHeader}>
              <Text style={[s.question, { color: colors.foreground, flex: 1 }]}>{item.q}</Text>
              <Feather
                name={expanded === i ? "chevron-up" : "chevron-down"}
                size={16}
                color={colors.mutedForeground}
              />
            </View>
            {expanded === i && (
              <Text style={[s.answer, { color: colors.mutedForeground }]}>{item.a}</Text>
            )}
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 20, paddingBottom: 16, borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTitle: { fontSize: 17, fontWeight: "700" },
  list: { paddingHorizontal: 16, paddingTop: 20, gap: 10 },
  subtitle: { fontSize: rf(14), lineHeight: 20, marginBottom: 8 },
  item: { borderRadius: 14, borderWidth: 1, padding: 16, gap: 12 },
  itemHeader: { flexDirection: "row", alignItems: "center", gap: 12 },
  question: { fontSize: rf(15), fontWeight: "600", lineHeight: 21 },
  answer: { fontSize: rf(14), lineHeight: 21 },
});
