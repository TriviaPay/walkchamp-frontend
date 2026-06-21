import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  FlatList,
  ScrollView,
  StyleSheet,
  Text,
  View} from "react-native";
import { useSafeLayout } from "@/hooks/useSafeLayout";
import { Feather } from "@expo/vector-icons";
import { SkeletonList } from "@/components/SkeletonRows";
import { LiveRace, formatElapsed } from "@/utils/mockLiveRaces";
import { usePresence } from "@/context/PresenceContext";
import { TouchableOpacity } from '@/components/HapticTouchableOpacity';
import { authFetch } from "@/utils/authFetch";
import { subscribeToChannel, unsubscribeFromChannel } from "@/services/realtimeService";

const FILTERS = ["All", "Free", "$1", "$3", "$5", "Country"] as const;
type FilterType = (typeof FILTERS)[number];

type ApiRace = {
  id: string;
  title: string;
  type: string;
  entryType: string;
  playerCount: number;
  maxPlayers: number;
  targetSteps: number;
  status: string;
  prizePool: number;
  spectatorCount: number;
  startedAt: string | null;
  reactionCounts: Record<string, number>;
  players: Array<{
    userId: string;
    username: string;
    countryFlag: string;
    avatarColor: string;
    currentSteps: number;
    rank: number;
  }>;
};

function mapApiRace(room: ApiRace): LiveRace {
  const elapsedSeconds = room.startedAt
    ? Math.max(0, Math.floor((Date.now() - new Date(room.startedAt).getTime()) / 1000))
    : 0;
  return {
    id: room.id,
    title: room.title,
    type: room.type as LiveRace["type"],
    entryType: room.entryType as LiveRace["entryType"],
    playerCount: room.playerCount,
    maxPlayers: room.maxPlayers,
    targetSteps: room.targetSteps,
    elapsedSeconds,
    spectatorCount: room.spectatorCount ?? 0,
    commentCount: 0,
    reactionCounts: room.reactionCounts ?? {},
    players: (room.players ?? []).map((p) => ({
      id: p.userId,
      username: p.username,
      countryFlag: p.countryFlag ?? "🏳️",
      avatarColor: p.avatarColor ?? "#00E676",
      currentSteps: p.currentSteps,
      targetSteps: room.targetSteps,
      rank: p.rank,
    })),
    comments: [],
    prizePool: room.prizePool ?? 0,
    isLive: true,
  };
}

const FILTER_PARAM: Record<FilterType, string | null> = {
  All: null,
  Free: "free",
  "$1": "$1",
  "$3": "$3",
  "$5": "$5",
  Country: "country",
};

function LiveBadge({ colors }: { colors: ReturnType<typeof useColors> }) {
  const pulse = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.4, duration: 600, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 600, useNativeDriver: true }),
      ])
    ).start();
  }, [pulse]);
  return (
    <View style={styles.liveBadge}>
      <Animated.View style={[styles.liveDot, { opacity: pulse }]} />
      <Text style={styles.liveText}>LIVE</Text>
    </View>
  );
}

function RaceCard({ race, onWatch, colors }: { race: LiveRace; onWatch: () => void; colors: ReturnType<typeof useColors> }) {
  const top3 = race.players.slice(0, 3);
  const entryColor: Record<string, string> = {
    "Free": colors.accent,
    "$1": colors.primary,
    "$3": colors.accent,
    "$5": colors.gold,
  };
  const typeIcon: Record<string, string> = {
    quick: "zap",
    endurance: "trending-up",
    country_battle: "globe",
    friends: "users",
    sponsored: "gift",
  };

  return (
    <View style={[styles.raceCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
      {/* Header */}
      <View style={styles.raceCardHeader}>
        <View style={styles.raceCardLeft}>
          <LiveBadge colors={colors} />
          <View style={[styles.entryBadge, { backgroundColor: (entryColor[race.entryType] ?? colors.primary) + "20", borderColor: (entryColor[race.entryType] ?? colors.primary) + "40" }]}>
            <Text style={[styles.entryText, { color: entryColor[race.entryType] ?? colors.primary }]}>{race.entryType}</Text>
          </View>
        </View>
        <View style={styles.spectatorRow}>
          <Feather name="eye" size={12} color={colors.mutedForeground} />
          <Text style={[styles.spectatorCount, { color: colors.mutedForeground }]}>{race.spectatorCount.toLocaleString()}</Text>
        </View>
      </View>

      {/* Title */}
      <Text style={[styles.raceTitle, { color: colors.foreground }]}>{race.title}</Text>

      {/* Meta row */}
      <View style={styles.metaRow}>
        <View style={styles.metaItem}>
          <Feather name={typeIcon[race.type] as never} size={12} color={colors.mutedForeground} />
          <Text style={[styles.metaText, { color: colors.mutedForeground }]}>{race.playerCount}/{race.maxPlayers} players</Text>
        </View>
        <View style={styles.metaItem}>
          <Feather name="flag" size={12} color={colors.mutedForeground} />
          <Text style={[styles.metaText, { color: colors.mutedForeground }]}>{race.targetSteps.toLocaleString()} steps</Text>
        </View>
        <View style={styles.metaItem}>
          <Feather name="clock" size={12} color={colors.mutedForeground} />
          <Text style={[styles.metaText, { color: colors.mutedForeground }]}>{formatElapsed(race.elapsedSeconds)}</Text>
        </View>
      </View>

      {/* Top 3 players */}
      <View style={[styles.topSection, { borderColor: colors.border }]}>
        {top3.map((p, i) => {
          const pct = (p.currentSteps / p.targetSteps) * 100;
          const rankColor = [colors.gold, colors.silver, colors.bronze][i];
          return (
            <View key={p.id} style={styles.playerRow}>
              <Text style={[styles.rankNum, { color: rankColor }]}>#{i + 1}</Text>
              <View style={[styles.playerAvatar, { backgroundColor: p.avatarColor + "25", borderColor: p.avatarColor }]}>
                <Text style={[styles.playerAvatarText, { color: p.avatarColor }]}>{p.username.charAt(0).toUpperCase()}</Text>
              </View>
              <View style={styles.playerInfo}>
                <View style={styles.playerNameRow}>
                  <Text style={[styles.playerName, { color: colors.foreground }]}>{p.username}</Text>
                  <Text style={styles.playerFlag}>{p.countryFlag}</Text>
                </View>
                <View style={[styles.progressTrack, { backgroundColor: colors.border }]}>
                  <LinearGradient
                    colors={[p.avatarColor, p.avatarColor + "99"]}
                    style={[styles.progressFill, { width: `${pct}%` }]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 0 }}
                  />
                </View>
              </View>
              <Text style={[styles.stepCount, { color: colors.mutedForeground }]}>{p.currentSteps.toLocaleString()}</Text>
            </View>
          );
        })}
      </View>

      {/* Footer */}
      <View style={styles.raceCardFooter}>
        <View style={styles.reactionRow}>
          {["🔥", "👏", "👑"].map((r) => (
            <Text key={r} style={styles.reactionItem}>{r} {(race.reactionCounts[r] ?? 0) > 99 ? "99+" : race.reactionCounts[r]}</Text>
          ))}
        </View>
        {race.prizePool > 0 && (
          <Text style={[styles.prizeText, { color: colors.gold }]}>💰 ${race.prizePool.toFixed(0)} pool</Text>
        )}
      </View>

      <TouchableOpacity onPress={onWatch} activeOpacity={0.85} style={styles.watchBtn}>
        <LinearGradient
          colors={["#00E676", "#00B4FF"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={styles.watchBtnGrad}
        >
          <Feather name="eye" size={16} color="#000" />
          <Text style={styles.watchBtnText}>Watch Live</Text>
        </LinearGradient>
      </TouchableOpacity>
    </View>
  );
}

export default function LiveRacesScreen() {
  const colors = useColors();
  const { insets, safeTop, safeBottom } = useSafeLayout();
  const { counts, formatCount } = usePresence();
  const [activeFilter, setActiveFilter] = useState<FilterType>("All");
  const [liveRaces, setLiveRaces] = useState<LiveRace[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchRaces = useCallback(async (filter: FilterType) => {
    try {
      const filterParam = FILTER_PARAM[filter];
      const params = new URLSearchParams({ status: "in_progress", limit: "30" });
      if (filterParam) params.set("filter", filterParam);
      const res = await authFetch(`/api/races?${params.toString()}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as { races: ApiRace[] };
      setLiveRaces((json.races ?? []).map(mapApiRace));
      setError(null);
    } catch {
      setError("Could not load live races");
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial fetch + re-fetch when filter changes
  useEffect(() => {
    setLoading(true);
    fetchRaces(activeFilter);
  }, [activeFilter, fetchRaces]);

  // Auto-refresh every 30 s to pick up step progress changes
  useEffect(() => {
    const interval = setInterval(() => fetchRaces(activeFilter), 30_000);
    return () => clearInterval(interval);
  }, [activeFilter, fetchRaces]);

  // Tick elapsed timer locally every second — no step simulation
  useEffect(() => {
    const tick = setInterval(() => {
      setLiveRaces((prev) => prev.map((r) => ({ ...r, elapsedSeconds: r.elapsedSeconds + 1 })));
    }, 1_000);
    return () => clearInterval(tick);
  }, []);

  // Pusher: when a new race starts, refresh the list immediately
  useEffect(() => {
    const channel = subscribeToChannel("public-presence");
    const refresh = () => fetchRaces(activeFilter);
    channel?.bind("race:started", refresh);
    return () => {
      channel?.unbind("race:started", refresh);
      unsubscribeFromChannel("public-presence");
    };
  }, [activeFilter, fetchRaces]);

  const filtered = liveRaces.filter((r) => {
    if (activeFilter === "All") return true;
    if (activeFilter === "Country") return r.type === "country_battle";
    return r.entryType === activeFilter;
  });

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: safeTop + 12 }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Feather name="arrow-left" size={22} color={colors.foreground} />
        </TouchableOpacity>
        <View>
          <Text style={[styles.headerTitle, { color: colors.foreground }]}>Live Races</Text>
          <Text style={[styles.headerSub, { color: colors.mutedForeground }]}>
            {formatCount(counts.racing)} racing · {formatCount(counts.spectating)} watching
          </Text>
        </View>
        <View style={styles.liveBadgeHeader}>
          <View style={styles.liveDot} />
          <Text style={styles.liveText}>LIVE</Text>
        </View>
      </View>

      {/* Filters */}
      <View style={styles.filterSection}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterRow} contentContainerStyle={{ gap: 8, paddingHorizontal: 2 }}>
          {FILTERS.map((f) => {
            const active = activeFilter === f;
            const label = f === "Country" ? "🌍 Country" : f;
            return (
              <TouchableOpacity
                key={f}
                onPress={() => setActiveFilter(f)}
                style={[styles.filterChip, {
                  backgroundColor: active ? colors.primary : colors.card,
                  borderColor: active ? colors.primary : colors.border,
                }]}
              >
                <Text style={[styles.filterChipText, { color: active ? "#000000" : colors.foreground }]}>{label}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>

      {/* Race count */}
      <Text style={[styles.countLabel, { color: colors.mutedForeground }]}>
        {loading ? "Loading…" : error ? error : `${filtered.length} live race${filtered.length !== 1 ? "s" : ""} right now`}
      </Text>

      {/* List */}
      {loading ? (
        <View style={{ paddingHorizontal: 16, paddingTop: 8 }}>
          <SkeletonList count={5} variant="race" />
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: safeBottom + 24 }}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
              {error ? error : "No live races right now — check back soon!"}
            </Text>
          }
          renderItem={({ item }) => (
            <RaceCard
              race={item}
              colors={colors}
              onWatch={() => router.push({ pathname: "/spectator/[id]", params: { id: item.id } })}
            />
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingBottom: 12 },
  backBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  headerTitle: { fontSize: 20, fontWeight: "800" },
  headerSub: { fontSize: 12, marginTop: 1 },
  liveBadgeHeader: { marginLeft: "auto", flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: "#FF0000" + "20", borderRadius: 12, paddingHorizontal: 10, paddingVertical: 5, borderWidth: 1, borderColor: "#FF0000" + "40" },
  filterSection: { paddingHorizontal: 16, paddingBottom: 8 },
  filterRow: { flexGrow: 0 },
  filterChip: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, borderWidth: 1 },
  filterChipText: { fontSize: 13, fontWeight: "600" },
  countLabel: { paddingHorizontal: 16, paddingBottom: 4, fontSize: 12 },
  emptyText: { textAlign: "center", marginTop: 40, fontSize: 14 },
  raceCard: { borderRadius: 16, borderWidth: 1, padding: 14, gap: 10 },
  raceCardHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  raceCardLeft: { flexDirection: "row", alignItems: "center", gap: 8 },
  liveBadge: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "#FF0000" + "20", borderRadius: 10, paddingHorizontal: 8, paddingVertical: 4, borderWidth: 1, borderColor: "#FF0000" + "40" },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "#FF4444" },
  liveText: { fontSize: 11, fontWeight: "800", color: "#FF4444", letterSpacing: 0.5 },
  entryBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10, borderWidth: 1 },
  entryText: { fontSize: 12, fontWeight: "700" },
  spectatorRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  spectatorCount: { fontSize: 12 },
  raceTitle: { fontSize: 16, fontWeight: "700" },
  metaRow: { flexDirection: "row", gap: 14 },
  metaItem: { flexDirection: "row", alignItems: "center", gap: 4 },
  metaText: { fontSize: 12 },
  topSection: { borderTopWidth: 1, paddingTop: 10, gap: 8 },
  playerRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  rankNum: { fontSize: 13, fontWeight: "800", width: 26 },
  playerAvatar: { width: 28, height: 28, borderRadius: 14, borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
  playerAvatarText: { fontSize: 11, fontWeight: "800" },
  playerInfo: { flex: 1, gap: 4 },
  playerNameRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  playerName: { fontSize: 13, fontWeight: "600", flex: 1 },
  playerFlag: { fontSize: 14 },
  progressTrack: { height: 4, borderRadius: 2, overflow: "hidden" },
  progressFill: { height: "100%", borderRadius: 2 },
  stepCount: { fontSize: 12, fontWeight: "600", minWidth: 42, textAlign: "right" },
  raceCardFooter: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  reactionRow: { flexDirection: "row", gap: 10 },
  reactionItem: { fontSize: 12 },
  prizeText: { fontSize: 12, fontWeight: "700" },
  watchBtn: { borderRadius: 12, overflow: "hidden" },
  watchBtnGrad: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 12 },
  watchBtnText: { fontSize: 15, fontWeight: "800", color: "#000" },
});
