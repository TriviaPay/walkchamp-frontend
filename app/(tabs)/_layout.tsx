import { BlurView } from "expo-blur";
import { isLiquidGlassAvailable } from "expo-glass-effect";
import { Redirect, Tabs } from "expo-router";
import { Icon, Label, NativeTabs } from "expo-router/unstable-native-tabs";
import { SymbolView } from "expo-symbols";
import { Feather, Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import React from "react";
import { Platform, StyleSheet, View } from "react-native";

import { useColors } from "@/hooks/useColors";
import { useTheme } from "@/context/ThemeContext";
import { useAppSelector } from "@/store/hooks";
import { useSound } from "@/context/SoundContext";
import { useUnread } from "@/context/UnreadContext";
import * as Haptics from "@/utils/haptics";

function NativeTabLayout() {
  const { totalUnread } = useUnread();
  const chatBadge = totalUnread > 0 ? (totalUnread > 99 ? "99+" : String(totalUnread)) : undefined;
  return (
    <NativeTabs>
      <NativeTabs.Trigger name="walk">
        <Icon sf={{ default: "figure.walk", selected: "figure.walk.circle.fill" }} />
        <Label>Walk</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="live">
        <Icon sf={{ default: "antenna.radiowaves.left.and.right", selected: "antenna.radiowaves.left.and.right.circle.fill" }} />
        <Label>Live</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="leaderboard">
        <Icon sf={{ default: "trophy", selected: "trophy.fill" }} />
        <Label>Ranks</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="chat" options={{ badgeValue: chatBadge }}>
        <Icon sf={{ default: "bubble.left.and.bubble.right", selected: "bubble.left.and.bubble.right.fill" }} />
        <Label>Chat</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="wallet">
        <Icon sf={{ default: "creditcard", selected: "creditcard.fill" }} />
        <Label>Wallet</Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}

function ClassicTabLayout() {
  const colors = useColors();
  const { isDark } = useTheme();
  const { soundEnabled } = useSound();
  const { totalUnread } = useUnread();
  const isIOS = Platform.OS === "ios";
  const isWeb = Platform.OS === "web";

  const tabBarStyle = {
    position: "absolute" as const,
    backgroundColor: isIOS ? "transparent" : colors.card,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    elevation: 0,
    ...(isWeb ? { height: 84 } : {}),
  };

  const screenOpts = {
    tabBarActiveTintColor: colors.primary,
    tabBarInactiveTintColor: colors.mutedForeground,
    headerShown: false,
    tabBarStyle,
    tabBarBackground: () =>
      isIOS ? (
        <BlurView
          intensity={80}
          tint={isDark ? "dark" : "light"}
          style={StyleSheet.absoluteFill}
        />
      ) : isWeb ? (
        <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.card }]} />
      ) : null,
  };

  return (
    <Tabs screenOptions={screenOpts} screenListeners={{ tabPress: () => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy); } }}>
      {/* Visible tabs: Walk → Live → Ranks → Chat → Wallet */}
      <Tabs.Screen
        name="walk"
        options={{
          title: "Walk",
          tabBarIcon: ({ color }) =>
            isIOS ? (
              <SymbolView name="figure.walk" tintColor={color} size={22} />
            ) : (
              <MaterialCommunityIcons name="walk" size={24} color={color} />
            ),
        }}
      />
      <Tabs.Screen
        name="live"
        options={{
          title: "Live",
          tabBarIcon: ({ color }) => (
            isIOS ? (
              <SymbolView name="antenna.radiowaves.left.and.right" tintColor={color} size={22} />
            ) : (
              <MaterialCommunityIcons name="access-point" size={24} color={color} />
            )
          ),
        }}
      />
      {/* live-track kept as backup — hidden from tab bar */}
      <Tabs.Screen name="live-track" options={{ href: null }} />
      <Tabs.Screen
        name="leaderboard"
        options={{
          title: "Ranks",
          tabBarIcon: ({ color }) =>
            isIOS ? (
              <SymbolView name="trophy" tintColor={color} size={22} />
            ) : (
              <MaterialCommunityIcons name="trophy-outline" size={24} color={color} />
            ),
        }}
      />
      <Tabs.Screen
        name="chat"
        options={{
          title: "Chat",
          tabBarBadge: totalUnread > 0 ? (totalUnread > 99 ? "99+" : totalUnread) : undefined,
          tabBarBadgeStyle: { backgroundColor: "#FF3B30", fontSize: 10, minWidth: 16, height: 16, lineHeight: 16, borderRadius: 8 },
          tabBarIcon: ({ color }) =>
            isIOS ? (
              <SymbolView name="bubble.left.and.bubble.right" tintColor={color} size={22} />
            ) : (
              <Ionicons name="chatbubbles-outline" size={24} color={color} />
            ),
        }}
      />
      {/* Shop — hidden from tab bar; accessible via floating icon on Walk tab */}
      <Tabs.Screen
        name="shop"
        options={{ href: null }}
      />
      <Tabs.Screen
        name="wallet"
        options={{
          title: "Wallet",
          tabBarIcon: ({ color }) =>
            isIOS ? (
              <SymbolView name="creditcard" tintColor={color} size={22} />
            ) : (
              <MaterialCommunityIcons name="wallet-outline" size={24} color={color} />
            ),
        }}
      />

      {/* Profile — kept in tabs group but hidden from tab bar; navigable via router.push */}
      <Tabs.Screen
        name="profile"
        options={{
          href: null,
          tabBarStyle: { display: "none" },
        }}
      />
    </Tabs>
  );
}

export default function TabLayout() {
  const isAuthenticated = useAppSelector((s) => s.auth.isAuthenticated);
  const isRestoring = useAppSelector((s) => s.auth.isRestoringSession);

  // Synchronous redirect — fires in the same render cycle as the state change,
  // preventing a one-frame flash of the walk screen before iOS/Android navigates.
  if (!isRestoring && !isAuthenticated) {
    return <Redirect href="/(auth)" />;
  }

  if (isLiquidGlassAvailable()) {
    return <NativeTabLayout />;
  }
  return <ClassicTabLayout />;
}
