import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import React, { useRef, useState } from "react";
import {
  Dimensions,
  FlatList,
  StyleSheet,
  Text,
  View} from "react-native";
import { useSafeLayout } from "@/hooks/useSafeLayout";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useColors } from "@/hooks/useColors";
import { TouchableOpacity } from '@/components/HapticTouchableOpacity';
import { rf, rs } from "@/utils/responsive";

const { width } = Dimensions.get("window");

const SLIDES = [
  {
    id: "1",
    icon: "activity" as const,
    title: "Track Every Step",
    description: "Count your daily steps in real-time. Every step brings you closer to the global leaderboard.",
    color: "#00E676",
  },
  {
    id: "2",
    icon: "award" as const,
    title: "Compete Globally",
    description: "Race against walkers from 40+ countries. Daily, weekly, and all-time leaderboards.",
    color: "#00B4FF",
  },
  {
    id: "3",
    icon: "dollar-sign" as const,
    title: "Earn Real Rewards",
    description: "Top walkers earn real money. Daily Top 10 get paid. Walk more, earn more.",
    color: "#FFD700",
  },
  {
    id: "4",
    icon: "message-circle" as const,
    title: "Walk & Talk",
    description: "Chat with walkers worldwide while you're on the move. Walk Chat unlocks when you start walking.",
    color: "#A855F7",
  },
];

export default function OnboardingScreen() {
  const colors = useColors();
  const { insets, safeTop, safeBottom } = useSafeLayout();
  const [activeIndex, setActiveIndex] = useState(0);
  const flatListRef = useRef<FlatList>(null);

  const handleNext = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (activeIndex < SLIDES.length - 1) {
      flatListRef.current?.scrollToIndex({ index: activeIndex + 1 });
      setActiveIndex(activeIndex + 1);
    } else {
      router.push("/(auth)/signup");
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <FlatList
        ref={flatListRef}
        data={SLIDES}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        scrollEnabled={false}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <View style={[styles.slide, { width }]}>
            <LinearGradient
              colors={[item.color + "20", "transparent"]}
              style={styles.slideGlow}
            />
            <View style={[styles.iconCircle, { backgroundColor: item.color + "20", borderColor: item.color + "40" }]}>
              <Feather name={item.icon} size={56} color={item.color} />
            </View>
            <Text style={[styles.slideTitle, { color: colors.foreground }]}>{item.title}</Text>
            <Text style={[styles.slideDesc, { color: colors.mutedForeground }]}>{item.description}</Text>
          </View>
        )}
      />

      {/* Dots */}
      <View style={styles.dotsRow}>
        {SLIDES.map((_, i) => (
          <View
            key={i}
            style={[
              styles.dot,
              { backgroundColor: i === activeIndex ? colors.primary : colors.border },
              i === activeIndex && styles.dotActive,
            ]}
          />
        ))}
      </View>

      {/* Buttons */}
      <View style={[styles.buttons, { paddingBottom: safeBottom + 24 }]}>
        <TouchableOpacity
          style={[styles.nextBtn, { backgroundColor: colors.primary }]}
          onPress={handleNext}
        >
          <LinearGradient colors={[colors.primary, colors.accent]} style={styles.nextGradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}>
            <Text style={[styles.nextText, { color: colors.primaryForeground }]}>
              {activeIndex === SLIDES.length - 1 ? "Get Started" : "Next"}
            </Text>
            <Feather name="arrow-right" size={20} color={colors.primaryForeground} />
          </LinearGradient>
        </TouchableOpacity>

        <TouchableOpacity onPress={() => router.push("/(auth)")}>
          <Text style={[styles.loginLink, { color: colors.mutedForeground }]}>
            Already have an account? <Text style={{ color: colors.primary }}>Sign in</Text>
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  slide: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: rs(40),
    gap: rs(24),
  },
  slideGlow: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  iconCircle: {
    width: rs(140),
    height: rs(140),
    borderRadius: rs(70),
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  slideTitle: {
    fontSize: rf(30),
    fontWeight: "800",
    textAlign: "center",
    letterSpacing: -0.5,
  },
  slideDesc: {
    fontSize: rf(16),
    textAlign: "center",
    lineHeight: rf(24),
  },
  dotsRow: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 8,
    marginBottom: rs(32),
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  dotActive: {
    width: 24,
  },
  buttons: {
    paddingHorizontal: rs(24),
    gap: rs(16),
  },
  nextBtn: {
    borderRadius: 16,
    overflow: "hidden",
  },
  nextGradient: {
    paddingVertical: rs(18),
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  nextText: {
    fontSize: rf(18),
    fontWeight: "700",
  },
  loginLink: {
    textAlign: "center",
    fontSize: rf(15),
  },
});
