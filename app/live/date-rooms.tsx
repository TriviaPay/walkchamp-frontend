import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  BackHandler,
  FlatList,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";
import { rf, rs } from "@/utils/responsive";
import { screenCache } from "@/utils/screenCache";
import { TouchableOpacity } from "@/components/HapticTouchableOpacity";
import { PublicProfileModal } from "@/components/PublicProfileModal";
import type { PublicProfileInitialData } from "@/components/PublicProfileModal";
import { getRoomCountLabel } from "@/utils/raceDateGrouping";
import { RaceCard, type LiveRace, type LiveRacePlayer } from "@/app/(tabs)/live";

const NEON_PURPLE = "#7C3AED";

export default function DateRoomsScreen() {
  const colors = useColors();
  const { user } = useAuth();
  const {
    cacheKey,
    dateLabel,
    count,
    myRaceId,
    myRaceIsHost,
  } = useLocalSearchParams<{
    cacheKey?: string;
    dateLabel?: string;
    count?: string;
    origin?: string;
    myRaceId?: string;
    myRaceIsHost?: string;
  }>();

  const [races, setRaces] = useState<LiveRace[]>(
    () => (cacheKey ? screenCache.getSync<LiveRace[]>(cacheKey) ?? [] : []),
  );

  // Warm from disk if the in-memory cache missed (e.g. app was backgrounded).
  useEffect(() => {
    if (!cacheKey || races.length > 0) return;
    void screenCache.get<LiveRace[]>(cacheKey).then((cached) => {
      if (cached) setRaces(cached);
    });
  }, [cacheKey, races.length]);

  // Avatar → public profile modal (same behaviour as the Live tab).
  const [profileUserId, setProfileUserId] = useState<string | null>(null);
  const [profileInitialData, setProfileInitialData] = useState<PublicProfileInitialData | undefined>();
  const handleAvatarPress = useCallback((p: LiveRacePlayer) => {
    setProfileInitialData({
      username: p.username,
      countryFlag: p.countryFlag,
      avatarColor: p.avatarColor,
      avatarUrl: p.avatarUrl ?? undefined,
      avatarVersion: p.avatarVersion,
      isCurrentUser: p.username === user?.username,
    });
    setProfileUserId(p.userId);
  }, [user?.username]);

  // Robust back: close modal first, then pop (with safe fallback).
  const backLockRef = useRef(false);
  const handleBack = useCallback(() => {
    if (profileUserId) { setProfileUserId(null); return true; }
    if (backLockRef.current) return true;
    backLockRef.current = true;
    setTimeout(() => { backLockRef.current = false; }, 600);
    if (router.canGoBack()) router.back();
    else router.replace("/(tabs)/live");
    return true;
  }, [profileUserId]);

  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", handleBack);
    return () => sub.remove();
  }, [handleBack]);

  const roomCount = count ? Number(count) : races.length;
  const myRace = myRaceId ? { id: myRaceId, isHost: myRaceIsHost === "1" } : null;

  return (
    <SafeAreaView style={[st.root, { backgroundColor: colors.background }]} edges={["top", "bottom"]}>
      <View style={[st.header, { borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={handleBack} style={[st.backBtn, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Feather name="arrow-left" size={20} color={colors.foreground} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={[st.title, { color: colors.foreground }]} numberOfLines={1}>
            {dateLabel ?? "Rooms"}
          </Text>
          <Text style={[st.subtitle, { color: colors.mutedForeground }]}>
            {getRoomCountLabel(roomCount)}
          </Text>
        </View>
      </View>

      {races.length === 0 ? (
        <View style={st.emptyBox}>
          <Feather name="zap-off" size={32} color={colors.mutedForeground} />
          <Text style={[st.emptyText, { color: colors.mutedForeground }]}>No rooms available right now.</Text>
        </View>
      ) : (
        <FlatList
          data={races}
          keyExtractor={(r) => r.id}
          contentContainerStyle={st.list}
          showsVerticalScrollIndicator={false}
          renderItem={({ item }) => (
            <RaceCard
              race={item}
              colors={colors}
              isMyRace={item.id === myRace?.id}
              isHost={myRace?.isHost}
              myUsername={user?.username}
              onAvatarPress={handleAvatarPress}
            />
          )}
        />
      )}

      <PublicProfileModal
        visible={!!profileUserId}
        userId={profileUserId}
        initialData={profileInitialData}
        onClose={() => { setProfileUserId(null); setProfileInitialData(undefined); }}
      />
    </SafeAreaView>
  );
}

const st = StyleSheet.create({
  root:     { flex: 1 },
  header:   { flexDirection: "row", alignItems: "center", gap: rs(12), paddingHorizontal: rs(16), paddingVertical: rs(12), borderBottomWidth: 1 },
  backBtn:  { width: 40, height: 40, borderRadius: 20, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  title:    { fontSize: rf(20), fontWeight: "900", letterSpacing: -0.4 },
  subtitle: { fontSize: rf(12.5), fontWeight: "600", marginTop: 1 },
  list:     { padding: rs(14), gap: 12, paddingBottom: 28 },
  emptyBox: { flex: 1, alignItems: "center", justifyContent: "center", gap: 14 },
  emptyText:{ fontSize: rf(15), textAlign: "center" },
});
