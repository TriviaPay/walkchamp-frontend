import React, { useCallback, useEffect, useRef, useState } from "react";
import { useFocusEffect } from "expo-router";
import { BlueShoe } from "@/components/BlueShoe";
import { SkeletonList } from "@/components/SkeletonRows";
import { screenCache } from "@/utils/screenCache";
import { useAvatarVersionContext } from "@/context/AvatarVersionContext";
import { authFetch } from "@/utils/authFetch";
import { getApiBase } from "@/utils/apiUrl";
import {
  ActivityIndicator,
  Animated,
  AppState,
  FlatList,
  Image,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View} from "react-native";
import { AppAlert } from "@/components/AppAlert";
import { useSafeLayout } from "@/hooks/useSafeLayout";
import { LinearGradient } from "expo-linear-gradient";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { useTabBarHeight } from "@/hooks/useTabBarHeight";
import { useAuth } from "@/context/AuthContext";
import { useWalkContext } from "@/context/WalkContext";
import { getBadgeColor } from "@/utils/mockData";
import { formatSteps } from "@/utils/format";
import { getLocalDateStr, getLocalWeekStart, getLocalMonthStart } from "@/utils/timezone";
import { TouchableOpacity } from '@/components/HapticTouchableOpacity';
import { rf, rs } from "@/utils/responsive";
import BannerAdView from "@/components/BannerAdView";
import { PublicProfileModal } from "@/components/PublicProfileModal";
import type { PublicProfileInitialData } from "@/components/PublicProfileModal";
import { GroupPublicStatsModal } from "@/components/GroupPublicStatsModal";
import type { GroupPublicInitialData } from "@/components/GroupPublicStatsModal";

// ── Types ─────────────────────────────────────────────────────────────────────
type MainTab = "global" | "regional" | "race" | "coins" | "groups";
type StepsSubTab = "today" | "week" | "month" | "all_time" | "friends";
type RaceSubTab = "all" | "free" | "paid_1" | "paid_3" | "paid_5";
type GroupPeriodTab = "today" | "all_time";

interface LeaderEntry {
  id: string;
  username: string;
  fullName: string;
  country: string;
  countryCode: string;
  countryFlag: string;
  metric: number;      // steps OR wins OR coins
  metricLabel: string; // "steps" | "wins" | "coins won"
  rank: number;
  badge: string;
  rewardAmount: number;
  avatarColor: string;
  avatarUrl?: string | null;
  avatarVersion?: number | null; }

interface GroupLeaderEntry {
  id: string;
  name: string;
  type: string;
  customGroupType: string | null;
  groupImageUrl: string | null;
  imageVersion: number;
  totalSteps: number;
  memberCount: number;
  rank: number;
  periodLabel: string;
}

const GROUP_PERIOD_TABS: { label: string; value: GroupPeriodTab }[] = [
  { label: "Today",    value: "today" },
  { label: "All-Time", value: "all_time" },
];

const STEPS_SUB_TABS: { label: string; value: StepsSubTab }[] = [
  { label: "Today",    value: "today" },
  { label: "Week",     value: "week" },
  { label: "Month",    value: "month" },
  { label: "All Time", value: "all_time" },
  { label: "Friends",  value: "friends" },
];
const RACE_SUB_TABS: { label: string; value: RaceSubTab }[] = [
  { label: "All Races", value: "all" },
];

function raceBadgeColor(badge: string): string {
  switch (badge) {
    case "Race Legend":    return "#FFD700";
    case "Race Champion":  return "#A855F7";
    case "Race Master":    return "#00B4FF";
    case "Race Expert":    return "#00E676";
    case "Race Winner":    return "#FF8C00";
    default:               return "#7B7E97"; } }
function entryBadgeColor(badge: string): string {
  return getBadgeColor(badge) !== "#7B7E97" ? getBadgeColor(badge) : raceBadgeColor(badge); }

function fmtMetric(n: number, label: string): string {
  return label === "wins" ? `${n}` : formatSteps(n); }

// ── Friend request helper ─────────────────────────────────────────────────────
async function sendFriendRequest(targetId: string): Promise<"ok" | "already" | "error"> {
  try {
    const res = await authFetch(`/api/friends/request`, {
      method: "POST",
      body: JSON.stringify({ targetUserId: targetId }),
    });
    if (res.status === 409) return "already";
    return res.ok ? "ok" : "error";
  } catch {
    return "error";
  }
}

// ── Top3 Podium Card ──────────────────────────────────────────────────────────
function Top3Card({
  entry, rank, colors, isMe, meAvatarUrl, onAvatarPress, }: {
  entry: LeaderEntry; rank: 1 | 2 | 3;
  colors: ReturnType<typeof useColors>;
  isMe: boolean;
  meAvatarUrl?: string | null;
  onAvatarPress?: (entry: LeaderEntry) => void; }) {
  const { getAvatarVersion } = useAvatarVersionContext();
  const rankColors: Record<number, string> = { 1: colors.gold, 2: colors.silver, 3: colors.bronze };
  const rColor = rankColors[rank];
  const isCenter = rank === 1;
  const badgeColor = entryBadgeColor(entry.badge);

  return (
    <View style={[
      st.top3Card,
      { backgroundColor: colors.card, borderColor: rColor + "50" },
      isCenter && st.top3Center,
    ]}>
      {rank === 1 && <Text style={st.crown}>👑</Text>}
      <View style={[st.top3Badge, { backgroundColor: rColor + "22", borderColor: rColor + "55" }]}>
        <Text style={[st.top3BadgeText, { color: rColor }]}>#{rank}</Text>
      </View>
      {(() => {
        const effectiveAvatarUrl = isMe ? meAvatarUrl : (entry.avatarUrl && entry.id ? `${getApiBase()}/api/profile/avatar/${entry.id}?v=${getAvatarVersion(entry.id, entry.avatarVersion ?? 0)}` : null);
        return (
          <TouchableOpacity activeOpacity={0.75} onPress={() => onAvatarPress?.(entry)}>
            <View style={[
              st.top3Avatar,
              {
                backgroundColor: entry.avatarColor + "25",
                borderColor: effectiveAvatarUrl ? colors.primary : entry.avatarColor,
                width: isCenter ? 56 : 48,
                height: isCenter ? 56 : 48,
                borderRadius: isCenter ? 28 : 24,
                overflow: "hidden", },
            ]}>
              {effectiveAvatarUrl ? (
                <Image source={{ uri: effectiveAvatarUrl }} style={{ width: isCenter ? 56 : 48, height: isCenter ? 56 : 48 }} />
              ) : (
                <Text style={[st.top3AvatarText, { color: entry.avatarColor, fontSize: isCenter ? 22 : 18 }]}>
                  {entry.fullName.charAt(0)}
                </Text>
              )}
            </View>
          </TouchableOpacity>
        ); })()}
      <View style={st.top3NameRow}>
        <Text style={[st.top3Username, { color: colors.foreground, fontSize: isCenter ? 13 : 12 }]} numberOfLines={1}>
          @{entry.username}
        </Text>
        <Text style={st.top3Flag}>{entry.countryFlag}</Text>
      </View>
      {entry.metricLabel !== "wins" ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
          {entry.metricLabel === "coins won" ? (
            <Image source={require("@/assets/images/game-coin.png")} style={{ width: isCenter ? 15 : 13, height: isCenter ? 15 : 13 }} />
          ) : (
            <BlueShoe size={isCenter ? 15 : 13} />
          )}
          <Text style={[st.top3Metric, { color: rColor, fontSize: isCenter ? 17 : 15 }]}>
            {fmtMetric(entry.metric, entry.metricLabel)}
          </Text>
        </View>
      ) : (
        <Text style={[st.top3Metric, { color: rColor, fontSize: isCenter ? 17 : 15 }]}>
          {fmtMetric(entry.metric, entry.metricLabel)}
        </Text>
      )}
      <Text style={[st.top3MetricLabel, { color: colors.mutedForeground }]}>{entry.metricLabel}</Text>
      {entry.rewardAmount > 0 ? (
        <View style={[st.top3Pill, { backgroundColor: colors.gold + "15" }]}>
          <Text style={[st.top3PillText, { color: colors.gold }]}>+{entry.rewardAmount * 100} coins</Text>
        </View>
      ) : (
        <View style={[st.top3Pill, { backgroundColor: badgeColor + "15" }]}>
          <Text style={[st.top3PillText, { color: badgeColor }]} numberOfLines={1}>{entry.badge}</Text>
        </View>
      )}
    </View>
  ); }

// ── List Row ──────────────────────────────────────────────────────────────────
function ListRow({
  entry, isMe, colors, meAvatarUrl, onAvatarPress, }: {
  entry: LeaderEntry; isMe: boolean;
  colors: ReturnType<typeof useColors>;
  meAvatarUrl?: string | null;
  onAvatarPress?: (entry: LeaderEntry) => void; }) {
  const { getAvatarVersion } = useAvatarVersionContext();
  const badgeColor = entryBadgeColor(entry.badge);
  return (
    <View style={[
      st.row,
      {
        backgroundColor: isMe ? colors.primary + "10" : colors.card,
        borderColor: isMe ? colors.primary + "40" : colors.border, },
    ]}>
      <View style={st.rowRankBox}>
        {entry.rank <= 3 ? (
          <Text style={st.rowRankEmoji}>{["🥇","🥈","🥉"][entry.rank - 1]}</Text>
        ) : (
          <Text style={[st.rowRank, { color: colors.mutedForeground }]}>{entry.rank}</Text>
        )}
      </View>
      {(() => {
        const effectiveAvatarUrl = isMe ? meAvatarUrl : (entry.avatarUrl && entry.id ? `${getApiBase()}/api/profile/avatar/${entry.id}?v=${getAvatarVersion(entry.id, entry.avatarVersion ?? 0)}` : null);
        return (
          <TouchableOpacity activeOpacity={0.75} onPress={() => onAvatarPress?.(entry)}>
            <View style={[st.rowAvatar, { backgroundColor: entry.avatarColor + "22", borderColor: effectiveAvatarUrl ? colors.primary : entry.avatarColor, overflow: "hidden" }]}>
              {effectiveAvatarUrl ? (
                <Image source={{ uri: effectiveAvatarUrl }} style={{ width: 38, height: 38, borderRadius: 19 }} />
              ) : (
                <Text style={[st.rowAvatarText, { color: entry.avatarColor }]}>{entry.fullName.charAt(0)}</Text>
              )}
            </View>
          </TouchableOpacity>
        ); })()}
      <View style={st.rowInfo}>
        <View style={st.rowNameRow}>
          <Text style={[st.rowUsername, { color: isMe ? colors.primary : colors.foreground }]} numberOfLines={1}>
            @{entry.username}
          </Text>
          <Text style={st.rowFlag}>{entry.countryFlag}</Text>
        </View>
        <View style={[st.rowBadge, { backgroundColor: badgeColor + "18" }]}>
          <Text style={[st.rowBadgeText, { color: badgeColor }]} numberOfLines={1}>{entry.badge}</Text>
        </View>
      </View>
      <View style={st.rowRight}>
        {entry.metricLabel !== "wins" ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
            {entry.metricLabel === "coins won" ? (
              <Image source={require("@/assets/images/game-coin.png")} style={{ width: 13, height: 13 }} />
            ) : (
              <BlueShoe size={13} />
            )}
            <Text style={[st.rowMetric, { color: isMe ? colors.primary : colors.foreground }]}>
              {fmtMetric(entry.metric, entry.metricLabel)}
            </Text>
          </View>
        ) : (
          <Text style={[st.rowMetric, { color: isMe ? colors.primary : colors.foreground }]}>
            {fmtMetric(entry.metric, entry.metricLabel)}
          </Text>
        )}
        {entry.rewardAmount > 0 ? (
          <View style={[st.rowPill, { backgroundColor: colors.gold + "18" }]}>
            <Text style={[st.rowPillText, { color: colors.gold }]}>+{entry.rewardAmount * 100}</Text>
          </View>
        ) : (
          <Text style={[st.rowMetricLabel, { color: colors.mutedForeground }]}>{entry.metricLabel}</Text>
        )}
      </View>
    </View>
  ); }

// ── Groups leaderboard row ────────────────────────────────────────────────────
const GROUP_TYPE_ICON: Record<string, string> = {
  friends: "👫",
  family:  "👨‍👩‍👧",
  office:  "💼",
  custom:  "⭐",
};

function GroupListRow({ entry, colors, onPress }: {
  entry: GroupLeaderEntry;
  colors: ReturnType<typeof useColors>;
  onPress?: () => void;
}) {
  const medalEmoji = ["🥇","🥈","🥉"][entry.rank - 1];
  const typeLabel = entry.type === "custom" && entry.customGroupType
    ? entry.customGroupType
    : (entry.type.charAt(0).toUpperCase() + entry.type.slice(1));
  return (
    <TouchableOpacity activeOpacity={0.75} onPress={onPress} style={[st.row, { borderColor: colors.border, backgroundColor: colors.card }]}>
      <View style={st.rowRankBox}>
        {medalEmoji ? (
          <Text style={st.rowRankEmoji}>{medalEmoji}</Text>
        ) : (
          <Text style={[st.rowRank, { color: colors.mutedForeground }]}>{entry.rank}</Text>
        )}
      </View>
      <View style={[st.rowAvatar, { backgroundColor: colors.primary + "18", borderColor: colors.primary + "40", overflow: "hidden" }]}>
        {entry.groupImageUrl ? (
          <Image source={{ uri: `${getApiBase()}/api/groups/${entry.id}/image?v=${entry.imageVersion}` }} style={{ width: rs(38), height: rs(38), borderRadius: rs(19) }} />
        ) : (
          <Text style={{ fontSize: rf(18) }}>{GROUP_TYPE_ICON[entry.type] ?? "⭐"}</Text>
        )}
      </View>
      <View style={st.rowInfo}>
        <View style={st.rowNameRow}>
          <Text style={[st.rowUsername, { color: colors.foreground }]} numberOfLines={1}>{entry.name}</Text>
        </View>
        <View style={[st.rowBadge, { backgroundColor: colors.primary + "18" }]}>
          <Text style={[st.rowBadgeText, { color: colors.primary }]} numberOfLines={1}>
            {typeLabel} · {entry.memberCount} member{entry.memberCount !== 1 ? "s" : ""}
          </Text>
        </View>
      </View>
      <View style={st.rowRight}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
          <BlueShoe size={13} />
          <Text style={[st.rowMetric, { color: colors.foreground }]}>{formatSteps(entry.totalSteps)}</Text>
        </View>
        <Text style={[st.rowMetricLabel, { color: colors.mutedForeground }]}>{entry.periodLabel ?? "steps"}</Text>
      </View>
    </TouchableOpacity>
  );
}

// ── Groups Top-3 Podium Card ───────────────────────────────────────────────────
function GroupTop3Card({ entry, rank, colors, onPress }: {
  entry: GroupLeaderEntry;
  rank: 1 | 2 | 3;
  colors: ReturnType<typeof useColors>;
  onPress?: () => void;
}) {
  const rankColors: Record<number, string> = { 1: colors.gold, 2: colors.silver, 3: colors.bronze };
  const rColor = rankColors[rank];
  const isCenter = rank === 1;
  const typeLabel = entry.type === "custom" && entry.customGroupType
    ? entry.customGroupType
    : (entry.type.charAt(0).toUpperCase() + entry.type.slice(1));
  return (
    <TouchableOpacity activeOpacity={0.75} onPress={onPress} style={[
      st.top3Card,
      { backgroundColor: colors.card, borderColor: rColor + "50" },
      isCenter && st.top3Center,
    ]}>
      {rank === 1 && <Text style={st.crown}>👑</Text>}
      <View style={[st.top3Badge, { backgroundColor: rColor + "22", borderColor: rColor + "55" }]}>
        <Text style={[st.top3BadgeText, { color: rColor }]}>#{rank}</Text>
      </View>
      <View style={[
        st.top3Avatar,
        {
          backgroundColor: colors.primary + "18",
          borderColor: rColor,
          width: isCenter ? 56 : 48,
          height: isCenter ? 56 : 48,
          borderRadius: isCenter ? 28 : 24,
          overflow: "hidden",
        },
      ]}>
        {entry.groupImageUrl ? (
          <Image
            source={{ uri: `${getApiBase()}/api/groups/${entry.id}/image?v=${entry.imageVersion}` }}
            style={{ width: isCenter ? 56 : 48, height: isCenter ? 56 : 48, borderRadius: isCenter ? 28 : 24 }}
          />
        ) : (
          <Text style={{ fontSize: isCenter ? 22 : 18 }}>{GROUP_TYPE_ICON[entry.type] ?? "⭐"}</Text>
        )}
      </View>
      <View style={st.top3NameRow}>
        <Text style={[st.top3Username, { color: colors.foreground, fontSize: isCenter ? 13 : 12 }]} numberOfLines={1}>
          {entry.name}
        </Text>
      </View>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
        <BlueShoe size={isCenter ? 15 : 13} />
        <Text style={[st.top3Metric, { color: rColor, fontSize: isCenter ? 17 : 15 }]}>
          {formatSteps(entry.totalSteps)}
        </Text>
      </View>
      <Text style={[st.top3MetricLabel, { color: colors.mutedForeground }]}>{entry.periodLabel ?? "steps"}</Text>
      <View style={[st.top3Pill, { backgroundColor: colors.primary + "15" }]}>
        <Text style={[st.top3PillText, { color: colors.primary }]} numberOfLines={1}>
          {typeLabel} · {entry.memberCount}m
        </Text>
      </View>
    </TouchableOpacity>
  );
}

// ── Main Screen ───────────────────────────────────────────────────────────────
export default function LeaderboardScreen() {
  const colors       = useColors();
  const { safeTop }  = useSafeLayout();
  const { user }     = useAuth();
  const { todaySteps, triggerSync } = useWalkContext();
  const tabBarHeight = useTabBarHeight();

  // Navigation state
  const [mainTab,     setMainTab]     = useState<MainTab>("global");
  const [stepsSubTab, setStepsSubTab] = useState<StepsSubTab>("today");
  const [raceSubTab,  setRaceSubTab]  = useState<RaceSubTab>("all");

  // Data state
  const [entries,    setEntries]    = useState<LeaderEntry[]>([]);
  const [userRank,   setUserRank]   = useState(9999);
  const [userWins,   setUserWins]   = useState(0);
  const [loading,    setLoading]    = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error,      setError]      = useState<string | null>(null);
  const [groupEntries,  setGroupEntries]  = useState<GroupLeaderEntry[]>([]);
  const [groupLoading,  setGroupLoading]  = useState(false);
  const [groupPeriod,   setGroupPeriod]   = useState<GroupPeriodTab>("today");
  const [groupRefreshing, setGroupRefreshing] = useState(false);

  const [groupModalGroupId,      setGroupModalGroupId]      = useState<string | null>(null);
  const [groupModalInitialData,  setGroupModalInitialData]  = useState<GroupPublicInitialData | undefined>(undefined);
  const [groupModalVisible,      setGroupModalVisible]      = useState(false);

  const openGroupModal = useCallback((entry: GroupLeaderEntry) => {
    setGroupModalGroupId(entry.id);
    setGroupModalInitialData({
      name:            entry.name,
      type:            entry.type,
      customGroupType: entry.customGroupType,
      groupImageUrl:   entry.groupImageUrl,
      imageVersion:    entry.imageVersion,
      memberCount:     entry.memberCount,
      totalSteps:      entry.totalSteps,
    });
    setGroupModalVisible(true);
  }, []);

  const sentRequests = useRef<Set<string>>(new Set());

  // Per-key data cache — keyed by `${mainTab}_${stepsSubTab}` or `race_${raceSubTab}`.
  // Lets us show cached data instantly when switching tabs while fresh data loads.
  const dataCache = useRef<Map<string, { entries: LeaderEntry[]; userRank: number; userWins: number }>>(new Map());

  // On mount: warm the in-memory cache from AsyncStorage for the initially active tab.
  // This makes the leaderboard instant even after the user kills and relaunches the app.
  useEffect(() => {
    const initialKey = mainTab === "race"
      ? `race_${raceSubTab}`
      : mainTab === "coins" ? "coins"
      : `${mainTab}_${stepsSubTab}`;
    void screenCache.get<{ entries: LeaderEntry[]; userRank: number; userWins: number }>(`lb_${initialKey}`).then((cached) => {
      if (cached && !dataCache.current.has(initialKey)) {
        dataCache.current.set(initialKey, cached);
        setEntries(cached.entries);
        setUserRank(cached.userRank);
        setUserWins(cached.userWins);
      }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // mount only — tab-switch effect handles subsequent navigations

  // ── Profile modal state ──────────────────────────────────────────────────────
  const [profileUserId, setProfileUserId] = useState<string | null>(null);
  const [profileInitialData, setProfileInitialData] = useState<PublicProfileInitialData | undefined>(undefined);

  const handleAvatarPress = useCallback((entry: LeaderEntry) => {
    setProfileInitialData({
      username: entry.username,
      country: entry.country ?? null,
      countryFlag: entry.countryFlag ?? null,
      avatarColor: entry.avatarColor ?? null,
      avatarUrl: entry.avatarUrl ?? null,
      avatarVersion: entry.avatarVersion ?? 0,
      isCurrentUser: entry.id === user?.id,
      activeTitle: null,
      friendStatus: "none",
      friendRequestId: null,
    });
    setProfileUserId(entry.id);
  }, [user?.id]);

  // ── Groups fetch ─────────────────────────────────────────────────────────────
  const fetchGroupData = useCallback(async (period: GroupPeriodTab, isRefresh = false) => {
    if (isRefresh) setGroupRefreshing(true);
    else setGroupLoading(true);
    try {
      const params = new URLSearchParams({ period });
      if (period === "today") params.set("localDate", getLocalDateStr());
      const res = await authFetch(`/api/leaderboard/groups?${params.toString()}`);
      if (res.ok) {
        const d = (await res.json()) as { groups: GroupLeaderEntry[]; leaderboard: GroupLeaderEntry[] };
        setGroupEntries(d.groups ?? d.leaderboard ?? []);
      }
    } catch {} finally {
      setGroupLoading(false);
      setGroupRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (mainTab === "groups") void fetchGroupData(groupPeriod);
  }, [mainTab, groupPeriod, fetchGroupData]);

  // ── Fetch ───────────────────────────────────────────────────────────────────
  const fetchData = useCallback(async (silent = false) => {
    if (mainTab === "groups") return; // handled separately
    const cacheKey = mainTab === "race" ? `race_${raceSubTab}` : mainTab === "coins" ? "coins" : `${mainTab}_${stepsSubTab}`;
    const cached = dataCache.current.get(cacheKey);

    setError(null);
    // Only show a full-page spinner when we have no cached data for this tab yet.
    // If cache exists, keep displaying it while fresh data loads in the background.
    if (!cached && !silent) setLoading(true);

    try {
      let newEntries: LeaderEntry[] = [];
      let newUserRank = 9999;
      let newUserWins = 0;

      if (mainTab === "race") {
        const raceUrl = raceSubTab === "all"
          ? `/api/leaderboard/races`
          : `/api/leaderboard/races?entryType=${raceSubTab}`;
        const res = await authFetch(raceUrl);
        if (!res.ok) throw new Error(`${res.status}`);
        const data = (await res.json()) as {
          leaderboard: Array<{ id: string; username: string; fullName: string; country: string; countryCode: string; countryFlag: string; wins: number; rank: number; badge: string; avatarColor: string; avatarUrl?: string | null; avatarVersion?: number | null }>;
          userRank: number; userWins: number; };
        newEntries = (data.leaderboard ?? []).map((e) => ({
          ...e, metric: e.wins, metricLabel: "wins", rewardAmount: 0,
        }));
        newUserRank = data.userRank ?? 9999;
        newUserWins = data.userWins ?? 0;
      } else if (mainTab === "coins") {
        const res = await authFetch(`/api/leaderboard/coins`);
        if (!res.ok) throw new Error(`${res.status}`);
        const data = (await res.json()) as {
          leaderboard: Array<{ id: string; username: string; fullName: string; country: string; countryCode: string; countryFlag: string; metric: number; metricLabel: string; rank: number; badge: string; avatarColor: string; avatarUrl?: string | null; avatarVersion?: number | null }>;
          userRank: number; };
        newEntries = (data.leaderboard ?? []).map((e) => ({ ...e, rewardAmount: 0 }));
        newUserRank = data.userRank ?? 9999;
        newUserWins = 0;
      } else {
        const isFriends  = stepsSubTab === "friends";
        const isRegional = mainTab === "regional";
        const scope  = isFriends ? "friends" : (isRegional ? "regional" : "global");
        const period = isFriends ? "all_time" : stepsSubTab;
        const params = new URLSearchParams({ period, scope });
        const cc = user?.countryCode;
        if (isRegional && cc) params.set("countryCode", cc);
        // Pass local date boundaries so the server uses the user's calendar
        // day rather than the server's UTC date.
        params.set("localDate", getLocalDateStr());
        if (period === "week") params.set("weekStart", getLocalWeekStart());
        if (period === "month") params.set("monthStart", getLocalMonthStart());

        const res = await authFetch(`/api/leaderboard?${params.toString()}`);
        if (!res.ok) throw new Error(`${res.status}`);
        const data = (await res.json()) as {
          leaderboard: Array<{ id: string; username: string; fullName: string; country: string; countryCode: string; countryFlag: string; steps: number; rank: number; badge: string; rewardAmount: number; avatarColor: string; avatarUrl?: string | null; avatarVersion?: number | null }>;
          userRank: number; };
        newEntries = (data.leaderboard ?? []).map((e) => ({
          ...e, metric: e.steps, metricLabel: "steps",
        }));
        newUserRank = data.userRank ?? 9999;
        newUserWins = 0;
      }

      // Cache and display the fresh result (in-memory + disk)
      dataCache.current.set(cacheKey, { entries: newEntries, userRank: newUserRank, userWins: newUserWins });
      void screenCache.set(`lb_${cacheKey}`, { entries: newEntries, userRank: newUserRank, userWins: newUserWins });
      setEntries(newEntries);
      setUserRank(newUserRank);
      setUserWins(newUserWins);
    } catch {
      // If we have cached data, keep it visible and don't show an error.
      // Only surface the error when there's nothing else to show.
      if (!cached) setError("Could not load leaderboard. Pull down to retry.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [mainTab, stepsSubTab, raceSubTab, user]);

  // When tab/filter changes: immediately show cached data (if any) so the list
  // never disappears, then silently refresh from the backend in the background.
  useEffect(() => {
    const cacheKey = mainTab === "race" ? `race_${raceSubTab}` : `${mainTab}_${stepsSubTab}`;
    const cached = dataCache.current.get(cacheKey);
    if (cached) {
      setEntries(cached.entries);
      setUserRank(cached.userRank);
      setUserWins(cached.userWins);
      void fetchData(true); // background refresh — no spinner
    } else {
      void fetchData(false); // first load — show spinner
    }
  }, [fetchData]); // fetchData changes when mainTab/stepsSubTab/raceSubTab/user change

  const onRefresh = () => {
    setRefreshing(true);
    triggerSync().catch(() => {}).finally(() => void fetchData(true));
  };

  // Whenever the Ranks tab gains focus, flush any unsynced steps to the backend
  // first, then silently refresh the leaderboard. This closes the gap between
  // the live device step count (polled every 15 s from HealthKit/Health Connect)
  // and the backend's step_daily_totals row (written every 30 s by the background
  // sync interval), which was the root cause of Walk tab / Leaderboard mismatches.
  useFocusEffect(
    useCallback(() => {
      // Always sync any unsynced steps to the backend first, then refresh the
      // leaderboard. This closes the gap between the live device step count
      // (updated every 15 s by HealthKit/Health Connect) and the backend's
      // step_daily_totals row (written every 30 s by the background interval).
      triggerSync().catch(() => {}).finally(() => void fetchData(true));
    }, [fetchData, triggerSync]),
  );

  // Refresh data when app returns from the background (e.g. user locks phone, re-opens app).
  // useFocusEffect only fires on tab navigation, not on OS-level app resume.
  const appStateRef = useRef(AppState.currentState);
  useEffect(() => {
    const sub = AppState.addEventListener("change", (nextState) => {
      if (appStateRef.current.match(/inactive|background/) && nextState === "active") {
        // Sync steps first, then refresh the leaderboard with fresh data.
        triggerSync().catch(() => {}).finally(() => void fetchData(true));
      }
      appStateRef.current = nextState;
    });
    return () => sub.remove();
  }, [fetchData, triggerSync]);

  // ── Friend request ──────────────────────────────────────────────────────────
  const handleAddFriend = async (targetId: string) => {
    if (sentRequests.current.has(targetId)) {
      AppAlert.alert("Already sent", "Friend request already sent.");
      return; }
    sentRequests.current.add(targetId);
    const result = await sendFriendRequest(targetId);
    if (result === "ok") AppAlert.alert("Request sent", "Friend request sent!");
    else if (result === "already") AppAlert.alert("Already pending", "A request already exists.");
    else { sentRequests.current.delete(targetId); AppAlert.alert("Error", "Could not send request. Try again."); } };

  // ── Derived ─────────────────────────────────────────────────────────────────
  const userId   = user?.id;
  const top3     = entries.slice(0, 3);
  const rest     = entries.slice(3);
  const hasTop3  = top3.length >= 3;
  const groupTop3    = groupEntries.slice(0, 3);
  const groupRest    = groupEntries.slice(3);
  const hasGroupTop3 = groupTop3.length === 3;
  const isRace   = mainTab === "race";
  const isCoins  = mainTab === "coins";
  const isGroups = mainTab === "groups";
  const isUserTab = !isGroups;

  const subTabOptions = isRace ? RACE_SUB_TABS : STEPS_SUB_TABS;
  const activeSubTab  = isRace ? raceSubTab : stepsSubTab;
  const showSubTabs   = !isCoins && !isGroups;

  const userEntry    = entries.find((e) => e.id === userId);
  // Use the backend-returned metric for the active period when we have it.
  // Falls back to local todaySteps (WalkContext) only when the user isn't in the list.
  // For "Today" period: immediately show the live device step count if it's
  // higher than the last-synced DB value. This eliminates the visual gap between
  // the Walk tab (live HealthKit/HC, 15 s poll) and the Leaderboard (DB, 30 s sync)
  // while the background sync is still in flight.
  const userMetric = isRace
    ? userWins
    : isCoins
      ? (userEntry?.metric ?? 0)
      : stepsSubTab === "today"
        ? Math.max(userEntry?.metric ?? 0, todaySteps)
        : (userEntry?.metric ?? 0);
  // Only look for the person directly above when the user is NOT already rank #1.
  const userAbove    = userRank > 1 ? entries.find((e) => e.rank === userRank - 1) : undefined;
  const gapToNext    = !isRace && !isCoins && userRank > 1 && userAbove
    ? Math.max(0, userAbove.metric - userMetric + 1)
    : 0;

  // Period-aware label for the bottom "my stats" card
  const myStepLabel = (() => {
    if (isRace) return "wins";
    if (isCoins) return `${userMetric.toLocaleString()} coins won`;
    const n = userMetric;
    switch (stepsSubTab) {
      case "today":    return `${n.toLocaleString()} steps today`;
      case "week":     return `${n.toLocaleString()} steps this week`;
      case "month":    return `${n.toLocaleString()} steps this month`;
      case "all_time": return `${n.toLocaleString()} all-time steps`;
      case "friends":  return `${n.toLocaleString()} steps`;
      default:         return `${n.toLocaleString()} steps`;
    }
  })();

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <View style={[st.screen, { backgroundColor: colors.background, paddingBottom: tabBarHeight }]}>

      {/* ── Fixed Header ── */}
      <View style={[st.header, { paddingTop: safeTop + 12, backgroundColor: colors.background }]}>
        <Text style={[st.title, { color: colors.foreground }]}>Leaderboard</Text>

        {/* Main tabs: Global | Regional | Race | Coins | Groups */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={[st.mainTabBar, { backgroundColor: colors.card, borderColor: colors.border }]}
          contentContainerStyle={{ flexDirection: "row", padding: 3, gap: 3 }}
        >
          {([
            { tab: "global" as MainTab, label: "🌍 Global" },
            { tab: "regional" as MainTab, label: "📍 Regional" },
            { tab: "race" as MainTab, label: "🏁 Race" },
            { tab: "coins" as MainTab, label: "Coins" },
            { tab: "groups" as MainTab, label: "👥 Groups" },
          ]).map(({ tab, label }) => {
            const active = mainTab === tab;
            const textColor = active ? colors.primaryForeground : colors.mutedForeground;
            return (
              <TouchableOpacity
                key={tab}
                style={[st.mainTabBtn, active && { backgroundColor: colors.primary }]}
                onPress={() => setMainTab(tab)}
              >
                {tab === "coins" ? (
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
                    <Image
                      source={require("@/assets/images/game-coin.png")}
                      style={{ width: 14, height: 14 }}
                      resizeMode="contain"
                    />
                    <Text style={[st.mainTabText, { color: textColor }]}>{label}</Text>
                  </View>
                ) : (
                  <Text style={[st.mainTabText, { color: textColor }]}>{label}</Text>
                )}
              </TouchableOpacity>
            ); })}
        </ScrollView>

        {/* Sub-tabs — only for global / regional / race */}
        {showSubTabs && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={st.subTabScroll}
            contentContainerStyle={st.subTabContent}
          >
            {subTabOptions.map((opt) => {
              const active = activeSubTab === opt.value;
              return (
                <TouchableOpacity
                  key={opt.value}
                  style={[
                    st.subTabChip,
                    {
                      backgroundColor: active ? colors.primary + "20" : "transparent",
                      borderColor: active ? colors.primary : colors.border, },
                  ]}
                  onPress={() => {
                    if (isRace) setRaceSubTab(opt.value as RaceSubTab);
                    else setStepsSubTab(opt.value as StepsSubTab); }}
                >
                  <Text style={[st.subTabText, { color: active ? colors.primary : colors.mutedForeground }]}>
                    {opt.label}
                  </Text>
                </TouchableOpacity>
              ); })}
          </ScrollView>
        )}

        {/* Group period chips — Today | All-Time */}
        {isGroups && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={st.subTabScroll}
            contentContainerStyle={st.subTabContent}
          >
            {GROUP_PERIOD_TABS.map((opt) => {
              const active = groupPeriod === opt.value;
              return (
                <TouchableOpacity
                  key={opt.value}
                  style={[
                    st.subTabChip,
                    {
                      backgroundColor: active ? colors.primary + "20" : "transparent",
                      borderColor: active ? colors.primary : colors.border,
                    },
                  ]}
                  onPress={() => setGroupPeriod(opt.value)}
                >
                  <Text style={[st.subTabText, { color: active ? colors.primary : colors.mutedForeground }]}>
                    {opt.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        )}

        {/* Context label */}
        <View style={st.contextRow}>
          {isRace ? (
            <Text style={[st.contextText, { color: colors.mutedForeground }]}>
              Most race wins {activeSubTab === "free" ? "(Free races)" : `(${activeSubTab.replace("paid_","$")} entry)`}
            </Text>
          ) : isCoins ? (
            <Text style={[st.contextText, { color: colors.mutedForeground }]}>Coins won in races & challenges · all time</Text>
          ) : isGroups ? (
            <Text style={[st.contextText, { color: colors.mutedForeground }]}>
              {groupPeriod === "today" ? "Groups ranked by total steps today" : "Groups ranked by all-time total steps"}
            </Text>
          ) : (
            <Text style={[st.contextText, { color: colors.mutedForeground }]}>
              {mainTab === "regional" ? "Your country • " : ""}
              {stepsSubTab === "friends" ? "Among friends (all time)" :
               stepsSubTab === "today" ? "Today's steps" :
               stepsSubTab === "week" ? "This week's steps" :
               stepsSubTab === "month" ? "This month's steps" : "All time steps"}
            </Text>
          )}
          <TouchableOpacity
            onPress={() => isGroups
              ? fetchGroupData(groupPeriod, true)
              : triggerSync().catch(() => {}).finally(() => void fetchData(true))}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Feather name="refresh-cw" size={14} color={colors.mutedForeground} />
          </TouchableOpacity>
        </View>
      </View>

      {/* ── Content ── */}
      {isGroups ? (
        groupLoading ? (
          <View style={st.centered}>
            <ActivityIndicator size="large" color={colors.primary} />
            <Text style={[st.centeredText, { color: colors.mutedForeground }]}>Loading groups…</Text>
          </View>
        ) : groupEntries.length === 0 ? (
          <View style={st.centered}>
            <Feather name="users" size={48} color={colors.mutedForeground} />
            {groupPeriod === "today" ? (
              <>
                <Text style={[st.centeredTitle, { color: colors.foreground }]}>No group steps today</Text>
                <Text style={[st.centeredText, { color: colors.mutedForeground }]}>Start walking with your group to rank today.</Text>
              </>
            ) : (
              <>
                <Text style={[st.centeredTitle, { color: colors.foreground }]}>No all-time data yet</Text>
                <Text style={[st.centeredText, { color: colors.mutedForeground }]}>Group totals will appear after members start walking.</Text>
              </>
            )}
          </View>
        ) : (
          <FlatList
            data={groupRest}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => <GroupListRow entry={item} colors={colors} onPress={() => openGroupModal(item)} />}
            contentContainerStyle={[st.listContent, { paddingBottom: 12 }]}
            showsVerticalScrollIndicator={false}
            refreshControl={
              <RefreshControl
                refreshing={groupRefreshing}
                onRefresh={() => fetchGroupData(groupPeriod, true)}
                tintColor={colors.primary}
              />
            }
            ListHeaderComponent={
              <View style={st.listHead}>
                {hasGroupTop3 && (
                  <View style={st.podiumRow}>
                    <GroupTop3Card entry={groupTop3[1]} rank={2} colors={colors} onPress={() => openGroupModal(groupTop3[1])} />
                    <GroupTop3Card entry={groupTop3[0]} rank={1} colors={colors} onPress={() => openGroupModal(groupTop3[0])} />
                    <GroupTop3Card entry={groupTop3[2]} rank={3} colors={colors} onPress={() => openGroupModal(groupTop3[2])} />
                  </View>
                )}
                {!hasGroupTop3 && groupTop3.map((g) => (
                  <GroupListRow key={g.id} entry={g} colors={colors} onPress={() => openGroupModal(g)} />
                ))}
                {groupRest.length > 0 && (
                  <Text style={[st.sectionLabel, { color: colors.mutedForeground }]}>Rank 4 onwards</Text>
                )}
              </View>
            }
          />
        )
      ) : loading && !refreshing ? (
        <View style={{ paddingTop: 8 }}>
          <SkeletonList count={8} variant="leader" />
        </View>
      ) : error ? (
        <View style={st.centered}>
          <Feather name="wifi-off" size={40} color={colors.mutedForeground} />
          <Text style={[st.centeredTitle, { color: colors.foreground }]}>Failed to load</Text>
          <Text style={[st.centeredText, { color: colors.mutedForeground }]}>{error}</Text>
          <TouchableOpacity
            style={[st.retryBtn, { backgroundColor: colors.primary }]}
            onPress={() => fetchData()}
          >
            <Text style={{ color: colors.primaryForeground, fontWeight: "700", fontSize: 14 }}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : entries.length === 0 ? (
        <View style={st.centered}>
          <Feather name="award" size={48} color={colors.mutedForeground} />
          <Text style={[st.centeredTitle, { color: colors.foreground }]}>No rankings yet</Text>
          <Text style={[st.centeredText, { color: colors.mutedForeground }]}>
            {isRace ? "No completed races for this entry type yet." : "Start walking to appear on the leaderboard."}
          </Text>
        </View>
      ) : (
        <FlatList
          data={rest}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <ListRow
              entry={item}
              isMe={item.id === userId}
              colors={colors}
              meAvatarUrl={item.id === userId && user?.id && user?.profileImageUrl ? `${getApiBase()}/api/profile/avatar/${user.id}?v=${user?.avatarVersion ?? ''}` : null}
              onAvatarPress={handleAvatarPress}
            />
          )}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
          ListHeaderComponent={
            <View style={st.listHead}>
              {/* Top 3 podium */}
              {hasTop3 && (
                <View style={st.podiumRow}>
                  <Top3Card entry={top3[1]} rank={2} colors={colors} isMe={top3[1].id === userId} meAvatarUrl={top3[1].id === userId && user?.id && user?.profileImageUrl ? `${getApiBase()}/api/profile/avatar/${user.id}?v=${user?.avatarVersion ?? ''}` : null} onAvatarPress={handleAvatarPress} />
                  <Top3Card entry={top3[0]} rank={1} colors={colors} isMe={top3[0].id === userId} meAvatarUrl={top3[0].id === userId && user?.id && user?.profileImageUrl ? `${getApiBase()}/api/profile/avatar/${user.id}?v=${user?.avatarVersion ?? ''}` : null} onAvatarPress={handleAvatarPress} />
                  <Top3Card entry={top3[2]} rank={3} colors={colors} isMe={top3[2].id === userId} meAvatarUrl={top3[2].id === userId && user?.id && user?.profileImageUrl ? `${getApiBase()}/api/profile/avatar/${user.id}?v=${user?.avatarVersion ?? ''}` : null} onAvatarPress={handleAvatarPress} />
                </View>
              )}
              {/* Partial top (< 3 users) */}
              {!hasTop3 && top3.length > 0 && top3.map((e) => (
                <ListRow key={e.id} entry={e} isMe={e.id === userId} colors={colors} meAvatarUrl={e.id === userId && user?.id && user?.profileImageUrl ? `${getApiBase()}/api/profile/avatar/${user.id}?v=${user?.avatarVersion ?? ''}` : null} onAvatarPress={handleAvatarPress} />
              ))}

              {/* Info note */}
              <View style={[st.infoNote, { backgroundColor: colors.gold + "10", borderColor: colors.gold + "25" }]}>
                <Feather name="info" size={13} color={colors.gold} />
                <Text style={[st.infoNoteText, { color: colors.mutedForeground }]}>
                  {isRace
                    ? "Rankings show total race wins. Only completed races where you finished #1 count as wins."
                    : "Top walkers earn coins & badges. Rankings reflect verified activity and may be adjusted."}
                </Text>
              </View>

              {rest.length > 0 && (
                <Text style={[st.sectionLabel, { color: colors.mutedForeground }]}>Rank 4 onwards</Text>
              )}
            </View> }
          contentContainerStyle={[st.listContent, { paddingBottom: 12 }]}
          showsVerticalScrollIndicator={false}
        />
      )}

      {/* ── Banner Ad — shown above the sticky position bar ── */}
      {isUserTab && <BannerAdView style={{ paddingVertical: 4, backgroundColor: colors.background }} />}

      {/* ── My Position Bar — hidden for groups tab ── */}
      {isUserTab && <View style={[st.myBar, { backgroundColor: colors.background, borderTopColor: colors.border }]}>
        <LinearGradient
          colors={[colors.primary + "18", colors.primary + "06"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={[st.myCard, { borderColor: colors.primary + "35" }]}
        >
          {/* Rank badge */}
          <View style={[st.myRankBadge, { backgroundColor: colors.primary + "25", borderColor: colors.primary }]}>
            <Text style={[st.myRankLabel, { color: colors.mutedForeground }]}>Rank</Text>
            <Text style={[st.myRankNum, { color: colors.primary }]}>
              {userRank === 9999 ? "–" : `#${userRank}`}
            </Text>
          </View>

          {/* Avatar */}
          {(() => {
            const myAvatarUrl = user?.id && user?.profileImageUrl ? `${getApiBase()}/api/profile/avatar/${user.id}?v=${user?.avatarVersion ?? ''}` : null;
            return (
              <View style={[
                st.myAvatar,
                {
                  backgroundColor: (user?.avatarColor ?? colors.primary) + "25",
                  borderColor: user?.avatarColor ?? colors.primary,
                  overflow: "hidden", },
              ]}>
                {myAvatarUrl ? (
                  <Image source={{ uri: myAvatarUrl }} style={{ width: 36, height: 36, borderRadius: 18 }} />
                ) : (
                  <Text style={[st.myAvatarText, { color: user?.avatarColor ?? colors.primary }]}>
                    {(user?.fullName ?? "Y").charAt(0)}
                  </Text>
                )}
              </View>
            ); })()}

          {/* Info */}
          <View style={st.myInfo}>
            <View style={st.myNameRow}>
              <Text style={[st.myUsername, { color: colors.foreground }]} numberOfLines={1}>
                @{user?.username ?? "–"}
              </Text>
              <Text style={st.myFlag}>{user?.countryFlag ?? ""}</Text>
            </View>
            <Text style={[st.myMetric, { color: colors.mutedForeground }]}>
              {isRace ? `${userWins} wins` : myStepLabel}
            </Text>
          </View>

          {/* Next rank nudge / leading badge */}
          {!isRace && userRank === 1 && (
            // User is at the top — celebrate instead of showing a "to #0" pill
            <View style={[st.myNudge, { backgroundColor: colors.gold + "20" }]}>
              <Feather name="award" size={11} color={colors.gold} />
              <Text style={[st.myNudgeText, { color: colors.gold }]}>Leading</Text>
            </View>
          )}
          {!isRace && gapToNext > 0 && userRank > 1 && userRank !== 9999 && (
            <View style={[st.myNudge, { backgroundColor: colors.accent + "18" }]}>
              <Feather name="trending-up" size={11} color={colors.accent} />
              <Text style={[st.myNudgeText, { color: colors.accent }]}>
                +{gapToNext.toLocaleString()} to #{userRank - 1}
              </Text>
            </View>
          )}
          {isRace && userEntry && (
            <View style={[st.myNudge, { backgroundColor: colors.gold + "18" }]}>
              <Text style={[st.myNudgeText, { color: colors.gold }]}>{userEntry.badge}</Text>
            </View>
          )}
        </LinearGradient>
      </View>}
      <PublicProfileModal
        visible={!!profileUserId}
        userId={profileUserId}
        onClose={() => { setProfileUserId(null); setProfileInitialData(undefined); }}
        initialData={profileInitialData}
      />
      <GroupPublicStatsModal
        visible={groupModalVisible}
        groupId={groupModalGroupId}
        onClose={() => setGroupModalVisible(false)}
        initialData={groupModalInitialData}
      />
    </View>
  ); }

// ── Styles ─────────────────────────────────────────────────────────────────────
const st = StyleSheet.create({
  screen:  { flex: 1 },
  header:  { paddingHorizontal: 18, paddingBottom: 6, zIndex: 10 },
  title:   { fontSize: rf(26), fontWeight: "800", letterSpacing: -0.5, marginBottom: 12 },

  // Main tab bar (5-tab scrollable)
  mainTabBar:  { borderRadius: 14, borderWidth: 1, marginBottom: 10 },
  mainTabBtn:  { paddingVertical: rs(9), paddingHorizontal: rs(16), borderRadius: 11, alignItems: "center" },
  mainTabText: { fontSize: rf(13), fontWeight: "700" },

  // Sub-tab chips
  subTabScroll:  { flexGrow: 0, marginBottom: 6 },
  subTabContent: { gap: 6, paddingBottom: 2, paddingRight: 4 },
  subTabChip:    { paddingHorizontal: rs(14), paddingVertical: rs(6), borderRadius: 20, borderWidth: 1 },
  subTabText:    { fontSize: rf(13), fontWeight: "600" },

  // Context row
  contextRow:  { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 2 },
  contextText: { fontSize: rf(11), fontWeight: "500" },

  // States
  centered:     { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, paddingHorizontal: 40 },
  centeredTitle:{ fontSize: rf(18), fontWeight: "700" },
  centeredText: { fontSize: rf(14), textAlign: "center", lineHeight: 20 },
  retryBtn:     { paddingHorizontal: 28, paddingVertical: 11, borderRadius: 12, marginTop: 4 },

  // List
  listHead:    { paddingHorizontal: rs(16) },
  listContent: { paddingTop: 4 },
  podiumRow:   { flexDirection: "row", gap: 8, marginBottom: 14, paddingTop: 4, alignItems: "flex-end" },
  infoNote:    { flexDirection: "row", alignItems: "flex-start", gap: 8, borderRadius: 12, borderWidth: 1, padding: rs(12), marginBottom: 12 },
  infoNoteText:{ flex: 1, fontSize: rf(12), lineHeight: 17 },
  sectionLabel:{ fontSize: rf(12), fontWeight: "600", marginBottom: 8 },

  // Top3 card
  top3Card:     { flex: 1, borderRadius: 16, borderWidth: 1, padding: rs(10), alignItems: "center", gap: 4 },
  top3Center:   { paddingTop: 4, paddingBottom: 6 },
  crown:        { fontSize: rf(18), marginBottom: -2 },
  top3Badge:    { paddingHorizontal: rs(10), paddingVertical: 3, borderRadius: 10, borderWidth: 1, marginBottom: 2 },
  top3BadgeText:{ fontSize: rf(13), fontWeight: "800" },
  top3Avatar:   { borderWidth: 2, alignItems: "center", justifyContent: "center" },
  top3AvatarText:{ fontWeight: "800" },
  top3NameRow:  { flexDirection: "row", alignItems: "center", gap: 3, marginTop: 2 },
  top3Username: { fontWeight: "700", maxWidth: 76 },
  top3Flag:     { fontSize: rf(12) },
  top3Metric:   { fontWeight: "800", marginTop: 2 },
  top3MetricLabel:{ fontSize: rf(10), marginTop: -2 },
  top3Pill:     { paddingHorizontal: 7, paddingVertical: 3, borderRadius: 8, marginTop: 2, maxWidth: "100%" },
  top3PillText: { fontSize: rf(10), fontWeight: "700" },
  top3AddFriend:{ width: rs(28), height: rs(28), borderRadius: rs(14), borderWidth: 1, alignItems: "center", justifyContent: "center", marginTop: 2 },

  // List row
  row:          { flexDirection: "row", alignItems: "center", gap: 10, borderRadius: 14, borderWidth: 1, padding: rs(12), marginHorizontal: rs(16), marginBottom: 8 },
  rowRankBox:   { width: 32, alignItems: "center" },
  rowRank:      { fontSize: rf(13), fontWeight: "700" },
  rowRankEmoji: { fontSize: rf(18) },
  rowAvatar:    { width: rs(38), height: rs(38), borderRadius: rs(19), borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
  rowAvatarText:{ fontSize: rf(15), fontWeight: "700" },
  rowInfo:      { flex: 1, gap: 4 },
  rowNameRow:   { flexDirection: "row", alignItems: "center", gap: 5 },
  rowUsername:  { fontSize: rf(14), fontWeight: "600", maxWidth: 120 },
  rowFlag:      { fontSize: rf(14) },
  rowBadge:     { alignSelf: "flex-start", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  rowBadgeText: { fontSize: rf(11), fontWeight: "600" },
  rowRight:     { alignItems: "flex-end", gap: 4 },
  rowMetric:    { fontSize: rf(15), fontWeight: "700" },
  rowMetricLabel:{ fontSize: rf(11) },
  rowPill:      { paddingHorizontal: 7, paddingVertical: 3, borderRadius: 8 },
  rowPillText:  { fontSize: rf(11), fontWeight: "700" },
  addFriendBtn: { width: rs(30), height: rs(30), borderRadius: rs(15), borderWidth: 1, alignItems: "center", justifyContent: "center" },

  // My position bar
  myBar:  { borderTopWidth: 1, paddingHorizontal: rs(14), paddingTop: rs(10), paddingBottom: rs(10) },
  myCard: { flexDirection: "row", alignItems: "center", gap: 10, borderRadius: 16, borderWidth: 1, paddingHorizontal: rs(14), paddingVertical: rs(12) },
  myRankBadge: { alignItems: "center", width: rs(44), paddingVertical: rs(5), borderRadius: 12, borderWidth: 1.5 },
  myRankLabel: { fontSize: rf(9), fontWeight: "600", marginBottom: 1 },
  myRankNum:   { fontSize: rf(20), fontWeight: "900", lineHeight: 22 },
  myAvatar:    { width: rs(36), height: rs(36), borderRadius: rs(18), borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
  myAvatarText:{ fontSize: rf(14), fontWeight: "800" },
  myInfo:      { flex: 1 },
  myNameRow:   { flexDirection: "row", alignItems: "center", gap: 5 },
  myUsername:  { fontSize: rf(14), fontWeight: "600", maxWidth: 120 },
  myFlag:      { fontSize: rf(14) },
  myMetric:    { fontSize: rf(12), marginTop: 2 },
  myNudge:     { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 5, borderRadius: 10 },
  myNudgeText: { fontSize: rf(11), fontWeight: "700" }, });
