import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  RefreshControl,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { Feather } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import { screenCache } from "@/utils/screenCache";
import { perf } from "@/utils/perfLogger";
import { useScreenMountPerf } from "@/hooks/useScreenMountPerf";
import { runCoalesced, apiFetchAllowed, markApiFetched } from "@/utils/apiRequestCoordinator";
import { authFetch } from "@/utils/authFetch";
import { getLocalDateStr } from "@/utils/timezone";
import { getApiBase } from "@/utils/apiUrl";
import { profileAvatarImageUri } from "@/services/mediaApi";
import { useAuth } from "@/context/AuthContext";
import { SkeletonGroupsScreen } from "@/components/SkeletonRows";
import { useWalk } from "@/context/WalkContext";
import { subscribeToChannel, CHANNELS, EVENTS } from "@/services/realtimeService";
import { useUnread } from "@/context/UnreadContext";

// ── Theme ────────────────────────────────────────────────────────────────────
const T = {
  bg: "#070B18",
  bg2: "#10142A",
  cyan: "#00D8FF",
  purple: "#8B5CFF",
  green: "#00F59B",
  gold: "#FFC83D",
  textPrimary: "#FFFFFF",
  textSecondary: "#9AA4C7",
  textMuted: "#6F7897",
  cardBorder: "rgba(0, 216, 255, 0.25)",
  cardBg: "rgba(16, 20, 42, 0.95)",
};

type GroupTypeFilter = "all" | "friends" | "family" | "office" | "custom";

interface TopWalker {
  userId: string;
  username: string;
  avatarUrl: string | null;
  steps: number;
}

interface MemberAvatar {
  userId: string;
  username: string;
  avatarUrl: string | null;
  avatarColor: string | null;
  avatarVersion?: number;
}

interface UserGroup {
  groupId: string;
  groupName: string;
  groupType: string;
  customGroupType: string | null;
  groupImageUrl: string | null;
  colorThemeKey: string | null;
  userRole: string;
  memberCount: number;
  dailyGoalSteps: number;
  todayGroupSteps: number;
  currentUserTodaySteps: number;
  progressPercent: number;
  inviteCode?: string;
  topWalker: TopWalker | null;
  memberAvatars: MemberAvatar[];
}

interface FilterChip {
  group_type: string;
  label: string;
  count: number;
}

interface OverviewSummary {
  total_groups: number;
  today_user_steps: number;
  active_members_total: number;
}

interface PendingInvite {
  id: string;
  groupId: string;
  invitedByUserId: string;
  invitedByUsername: string | null;
  createdAt: string;
  group: {
    groupName: string;
    groupType: string;
    dailyGoalSteps?: number;
    maxMembers?: number;
  } | null;
}

// ── Per-type visual config ────────────────────────────────────────────────────
const TYPE_CFG = {
  friends: {
    icon: "users" as const,
    start: "#2563FF",
    end: "#7C3AED",
    glow: "rgba(37,99,255,0.18)",
    border: "rgba(37,99,255,0.50)",
    placeholderBg: "rgba(37,99,255,0.22)",
  },
  family: {
    icon: "heart" as const,
    start: "#FF3D9A",
    end: "#FF9F1C",
    glow: "rgba(255,61,154,0.18)",
    border: "rgba(255,61,154,0.50)",
    placeholderBg: "rgba(255,61,154,0.22)",
  },
  office: {
    icon: "briefcase" as const,
    start: "#00C2A8",
    end: "#00F59B",
    glow: "rgba(0,194,168,0.18)",
    border: "rgba(0,194,168,0.50)",
    placeholderBg: "rgba(0,194,168,0.22)",
  },
  custom: {
    icon: "star" as const,
    start: "#8B5CFF",
    end: "#00D8FF",
    glow: "rgba(139,92,255,0.18)",
    border: "rgba(139,92,255,0.50)",
    placeholderBg: "rgba(139,92,255,0.22)",
  },
};

// ── Custom color themes ───────────────────────────────────────────────────────
const CUSTOM_THEMES: Record<string, { label: string; start: string; end: string }> = {
  custom_purple_blue:  { label: "Purple Blue",  start: "#8B5CFF", end: "#2563FF" },
  custom_cyan_green:   { label: "Cyan Green",   start: "#06B6D4", end: "#22C55E" },
  custom_pink_orange:  { label: "Pink Orange",  start: "#EC4899", end: "#F97316" },
  custom_gold_amber:   { label: "Gold",         start: "#F59E0B", end: "#EF4444" },
  custom_red_rose:     { label: "Red Rose",     start: "#EF4444", end: "#F43F5E" },
  custom_teal_mint:    { label: "Teal Mint",    start: "#14B8A6", end: "#6EE7B7" },
};

function makeCfgFromColors(start: string, end: string, icon: typeof TYPE_CFG["custom"]["icon"]) {
  return {
    icon,
    start,
    end,
    glow: start + "2E",
    border: start + "80",
    placeholderBg: start + "38",
  };
}

function cfg(type: string, colorThemeKey?: string | null) {
  if (type === "custom" && colorThemeKey && colorThemeKey in CUSTOM_THEMES) {
    const ct = CUSTOM_THEMES[colorThemeKey];
    return makeCfgFromColors(ct.start, ct.end, "star");
  }
  return TYPE_CFG[type as keyof typeof TYPE_CFG] ?? TYPE_CFG.custom;
}

function fmt(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, "") + "k";
  return String(n);
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// ── Avatar bubble ─────────────────────────────────────────────────────────────
const STACK_COLORS = ["#4D7CFE", "#8B6CFF", "#59D79C", "#F59E8B", "#FF9F1C"];
function stackBg(username: string | null, index: number, avatarColor: string | null): string {
  if (avatarColor) return avatarColor;
  if (!username) return STACK_COLORS[index % STACK_COLORS.length];
  const hash = username.split("").reduce((a, c) => a + c.charCodeAt(0), 0);
  return STACK_COLORS[hash % STACK_COLORS.length];
}

function AvatarBubble({ a, i, borderColor, size }: {
  a: MemberAvatar; i: number; borderColor: string; size: number;
}) {
  const [imgErr, setImgErr] = useState(false);
  const displayUri = a.userId && !imgErr
    ? profileAvatarImageUri(a.userId, a.avatarVersion ?? 0)
    : null;
  const hasImg = !!displayUri;
  const bg = stackBg(a.username, i, a.avatarColor);
  return (
    <View style={{
      width: size, height: size, borderRadius: size / 2,
      borderWidth: 2, borderColor,
      marginLeft: i === 0 ? 0 : -9,
      overflow: "hidden",
      backgroundColor: hasImg ? "transparent" : bg,
      alignItems: "center", justifyContent: "center",
      zIndex: 10 - i,
    }}>
      {hasImg ? (
        <Image source={{ uri: displayUri }} style={{ width: size, height: size }} onError={() => setImgErr(true)} />
      ) : (
        <Text style={{ fontSize: size * 0.38, color: "#fff", fontWeight: "800" }}>
          {(a.username ?? "?")[0].toUpperCase()}
        </Text>
      )}
    </View>
  );
}

function AvatarStack({ avatars, borderColor }: { avatars: MemberAvatar[]; borderColor: string }) {
  const shown = avatars.slice(0, 4);
  const extra = avatars.length - shown.length;
  return (
    <View style={{ flexDirection: "row" }}>
      {shown.map((a, i) => (
        <AvatarBubble key={a.userId} a={a} i={i} borderColor={borderColor} size={26} />
      ))}
      {extra > 0 && (
        <View style={{
          width: 26, height: 26, borderRadius: 13,
          backgroundColor: "#1E2A50", borderWidth: 2, borderColor,
          marginLeft: -9, alignItems: "center", justifyContent: "center",
        }}>
          <Text style={{ fontSize: 8, color: T.textSecondary, fontWeight: "700" }}>+{extra}</Text>
        </View>
      )}
    </View>
  );
}

// ── Group image placeholder ───────────────────────────────────────────────────
type TypeCfg = typeof TYPE_CFG[keyof typeof TYPE_CFG];

function GroupImagePlaceholder({ group, c }: { group: UserGroup; c: TypeCfg }) {
  const [imgErr, setImgErr] = useState(false);
  const imgUri = group.groupImageUrl && !imgErr
    ? `${getApiBase()}/api/groups/${group.groupId}/image`
    : null;
  return (
    <View style={[s.gcImageWrap, { borderColor: c.start + "55", backgroundColor: c.placeholderBg }]}>
      {imgUri ? (
        <Image
          source={{ uri: imgUri }}
          style={{ width: 48, height: 48, borderRadius: 14 }}
          onError={() => setImgErr(true)}
        />
      ) : (
        <Feather name={c.icon} size={22} color={c.start} />
      )}
    </View>
  );
}

// ── Group card ────────────────────────────────────────────────────────────────
function GroupCard({ group, onPress }: { group: UserGroup; onPress: () => void }) {
  const c = cfg(group.groupType, group.colorThemeKey);
  const pct = group.progressPercent;
  const { todaySteps: liveSteps } = useWalk();
  const { user } = useAuth();
  const isTopWalker = !!group.topWalker && group.topWalker.userId === user?.id;
  const mySteps = Math.max(group.currentUserTodaySteps, liveSteps);

  const typeLabel =
    group.groupType === "custom" && group.customGroupType
      ? group.customGroupType
      : group.groupType.charAt(0).toUpperCase() + group.groupType.slice(1);

  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.82} style={[s.groupCard, { borderColor: c.border, shadowColor: c.start }]}>
      {/* Category accent line */}
      <LinearGradient colors={[c.start, c.end]} style={s.groupCardAccent} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} />

      <View style={[s.groupCardInner, { backgroundColor: c.glow }]}>

        {/* ── Row 1: Image + Name + Admin + Chevron ── */}
        <View style={s.gcHeaderRow}>
          <GroupImagePlaceholder group={group} c={c} />
          <View style={{ flex: 1, marginLeft: 12 }}>
            <Text style={s.gcName} numberOfLines={1}>{group.groupName}</Text>
            <Text style={s.gcTypeLine} numberOfLines={1}>
              <Text style={{ color: c.start, fontWeight: "700" }}>{typeLabel}</Text>
              <Text style={{ color: T.textSecondary }}>
                {" · "}{group.memberCount} member{group.memberCount !== 1 ? "s" : ""}
                {" · "}Goal {fmt(group.dailyGoalSteps)}/day
              </Text>
            </Text>
          </View>
          <View style={{ gap: 5, alignItems: "flex-end" }}>
            {group.userRole === "admin" && (
              <View style={s.gcAdminBadge}>
                <Text style={s.gcAdminText}>👑 ADMIN</Text>
              </View>
            )}
            <Feather name="chevron-right" size={16} color={c.start + "99"} />
          </View>
        </View>

        {/* ── Row 2: Progress bar ── */}
        <View style={s.gcProgressRow}>
          <View style={s.gcProgressBg}>
            {/* Ghost track — always visible, shows category color */}
            <LinearGradient
              colors={[c.start + "28", c.end + "28"]}
              style={StyleSheet.absoluteFill}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
            />
            {/* Filled portion */}
            {pct > 0 && (
              <LinearGradient
                colors={[c.start, c.end]}
                style={[s.gcProgressFill, { width: `${Math.min(pct, 100)}%` as never }]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
              />
            )}
          </View>
          <Text style={[s.gcPct, { color: pct >= 100 ? T.green : pct > 0 ? c.start : T.textMuted }]}>{pct}%</Text>
        </View>

        {/* ── Row 3: Today group total ── */}
        <Text style={s.gcToday}>
          Today:{" "}
          <Text style={{ color: T.textPrimary, fontWeight: "700" }}>{fmt(group.todayGroupSteps)}</Text>
          {" / "}{fmt(group.dailyGoalSteps * group.memberCount)} steps
        </Text>

        {/* ── Row 4: My contribution + leader + avatars ── */}
        <View style={s.gcFooter}>
          <View style={{ flex: 1, gap: 3 }}>
            <Text style={s.gcYou}>
              You:{" "}
              <Text style={{ color: mySteps > 0 ? c.start : T.textSecondary, fontWeight: "800" }}>
                {fmt(mySteps)} steps
              </Text>
            </Text>
            {isTopWalker ? (
              <Text style={s.gcTop}>🏆 You're leading the group!</Text>
            ) : group.topWalker && group.topWalker.steps > 0 ? (
              <Text style={s.gcTop}>
                🏆 {group.topWalker.username} · {fmt(group.topWalker.steps)} steps
              </Text>
            ) : (
              <Text style={s.gcTop}>Steps will appear once members start walking</Text>
            )}
          </View>
          <AvatarStack avatars={group.memberAvatars} borderColor={T.bg} />
        </View>
      </View>
    </TouchableOpacity>
  );
}

interface GroupsOverviewCache {
  summary: OverviewSummary;
  filters: FilterChip[];
  groups: UserGroup[];
  pendingInvites: PendingInvite[];
}

const GROUPS_CACHE_KEY = "screen_groups_overview";

// ── Screen ────────────────────────────────────────────────────────────────────
export default function GroupsScreen() {
  useScreenMountPerf("Groups");
  const router = useRouter();
  const { user } = useAuth();
  const { todaySteps: liveSteps } = useWalk();
  const { pendingGroupInvites: groupInviteCount, clearGroupInvites } = useUnread();

  const [loading, setLoading] = useState(
    () => screenCache.getSync(GROUPS_CACHE_KEY) === null,
  );
  const [refreshing, setRefreshing] = useState(false);
  const [summary, setSummary] = useState<OverviewSummary>(
    () => screenCache.getSync<GroupsOverviewCache>(GROUPS_CACHE_KEY)?.summary
      ?? { total_groups: 0, today_user_steps: 0, active_members_total: 0 },
  );
  const [filters, setFilters] = useState<FilterChip[]>(
    () => screenCache.getSync<GroupsOverviewCache>(GROUPS_CACHE_KEY)?.filters ?? [],
  );
  const [groups, setGroups] = useState<UserGroup[]>(
    () => screenCache.getSync<GroupsOverviewCache>(GROUPS_CACHE_KEY)?.groups ?? [],
  );
  const [pendingInvites, setPendingInvites] = useState<PendingInvite[]>(
    () => screenCache.getSync<GroupsOverviewCache>(GROUPS_CACHE_KEY)?.pendingInvites ?? [],
  );
  const [selectedFilter, setSelectedFilter] = useState<GroupTypeFilter>("all");
  const hasLoadedRef = useRef(false);

  const [createModal, setCreateModal] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createType, setCreateType] = useState("friends");
  const [createGoal, setCreateGoal] = useState("10000");
  const [createCustomType, setCreateCustomType] = useState("");
  const [createColorTheme, setCreateColorTheme] = useState("custom_purple_blue");
  const [creating, setCreating] = useState(false);

  const resetCreateModal = () => {
    setCreateModal(false);
    setCreateName("");
    setCreateGoal("10000");
    setCreateType("friends");
    setCreateCustomType("");
    setCreateColorTheme("custom_purple_blue");
  };

  const fetchOverview = useCallback(async (opts?: { force?: boolean }) => {
    const cacheKey = `${GROUPS_CACHE_KEY}_${getLocalDateStr()}`;
    if (!opts?.force && !apiFetchAllowed(cacheKey, 30_000)) {
      perf.apiSkipped("groups_overview_throttled");
      setLoading(false);
      setRefreshing(false);
      return;
    }
    markApiFetched(cacheKey);

    try {
      await runCoalesced(GROUPS_CACHE_KEY, async () => {
        const res = await authFetch(`/api/groups/overview?localDate=${getLocalDateStr()}`);
        if (!res.ok) return;
        const data = await res.json();
        const next: GroupsOverviewCache = {
          summary: data.summary ?? summary,
          filters: data.filters ?? [],
          groups: data.groups ?? [],
          pendingInvites: data.pendingInvites ?? [],
        };
        if (data.summary) setSummary(data.summary);
        if (data.filters) setFilters(data.filters);
        if (data.groups) setGroups(data.groups);
        if (data.pendingInvites !== undefined) setPendingInvites(data.pendingInvites);
        void screenCache.set(GROUPS_CACHE_KEY, next);
      });
    } catch (e) {
      if (__DEV__) console.log("[GroupsLanding] fetch error:", e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [summary]);

  useFocusEffect(
    useCallback(() => {
      void (async () => {
        if (!screenCache.getSync(GROUPS_CACHE_KEY)) {
          const diskCached = await screenCache.get<GroupsOverviewCache>(GROUPS_CACHE_KEY);
          if (diskCached) {
            perf.cacheHit(GROUPS_CACHE_KEY);
            setSummary(diskCached.summary);
            setFilters(diskCached.filters);
            setGroups(diskCached.groups);
            setPendingInvites(diskCached.pendingInvites);
            setLoading(false);
          } else {
            perf.cacheMiss(GROUPS_CACHE_KEY);
          }
        } else {
          perf.cacheHit(GROUPS_CACHE_KEY);
        }
        if (!hasLoadedRef.current) setLoading(screenCache.getSync(GROUPS_CACHE_KEY) === null);
        await fetchOverview();
        hasLoadedRef.current = true;
      })();
      if (groupInviteCount > 0) clearGroupInvites();
    }, [fetchOverview, groupInviteCount, clearGroupInvites]),
  );

  useEffect(() => {
    if (!user?.id) return;
    const ch = subscribeToChannel(CHANNELS.privateUser(user.id));
    if (!ch) return;
    ch.bind(EVENTS.GROUP_INVITE_NEW, fetchOverview);
    return () => { ch.unbind(EVENTS.GROUP_INVITE_NEW, fetchOverview); };
  }, [user?.id, fetchOverview]);

  const visibleGroups = selectedFilter === "all" ? groups : groups.filter((g) => g.groupType === selectedFilter);

  const openGroup = (groupId: string) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push(`/groups/${groupId}`);
  };

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    void fetchOverview({ force: true });
  }, [fetchOverview]);

  const handleAccept = async (invite: PendingInvite) => {
    try {
      const res = await authFetch(`/api/groups/invites/${invite.id}/accept`, { method: "POST" });
      if (res.ok) { await fetchOverview(); }
      else { Alert.alert("Error", "Could not accept invite."); }
    } catch { Alert.alert("Error", "Network error."); }
  };

  const handleDecline = async (invite: PendingInvite) => {
    try {
      await authFetch(`/api/groups/invites/${invite.id}/decline`, { method: "POST" });
      await fetchOverview();
    } catch {}
  };

  const handleCreate = async () => {
    if (!createName.trim()) return;
    if (createType === "custom" && createCustomType.trim().length < 2) {
      Alert.alert("Required", "Enter a custom group type (e.g. Apartment Team, Gym Team).");
      return;
    }
    setCreating(true);
    try {
      const res = await authFetch(`/api/groups`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          groupName: createName.trim(),
          groupType: createType,
          customGroupType: createType === "custom" ? createCustomType.trim() : undefined,
          dailyGoalSteps: parseInt(createGoal, 10) || 10000,
          colorThemeKey: createType === "custom" ? createColorTheme : undefined,
        }),
      });
      if (res.ok) {
        const d = await res.json();
        resetCreateModal();
        await fetchOverview();
        if (d.group?.id) router.push(`/groups/${d.group.id}`);
      } else if (res.status === 409) {
        Alert.alert("Name Taken", "A group with this name already exists. Please choose a different name.");
      } else {
        Alert.alert("Error", "Could not create group.");
      }
    } catch {
      Alert.alert("Error", "Network error.");
    } finally {
      setCreating(false);
    }
  };

  const filterCfg = selectedFilter !== "all" ? cfg(selectedFilter) : null;

  return (
    <SafeAreaView style={s.safe} edges={["top", "bottom"]}>
      {loading ? (
        <SkeletonGroupsScreen />
      ) : (
      <ScrollView
        contentContainerStyle={s.scroll}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={T.cyan} />}
      >
        {/* ── Header ──────────────────────────────────────────────────────── */}
        <View style={s.header}>
          <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
            <Feather name="arrow-left" size={20} color={T.textPrimary} />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={s.headerTitle}>Walk Champ Groups</Text>
            <Text style={s.headerSub}>Build your circle. Hit goals together.</Text>
          </View>
        </View>

        {/* ── Summary card ─────────────────────────────────────────────────── */}
        <View style={s.summaryCard}>
          <LinearGradient
            colors={["rgba(0,216,255,0.08)", "rgba(139,92,255,0.08)", "rgba(0,0,0,0)"]}
            style={StyleSheet.absoluteFill}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
          />
          <View style={s.summaryRow}>
            <View style={s.summaryItem}>
              <Feather name="users" size={16} color={T.cyan} style={{ marginBottom: 6 }} />
              <Text style={s.summaryVal}>{summary.total_groups}</Text>
              <Text style={s.summaryLabel}>My Groups</Text>
            </View>
            <View style={s.summaryDivider} />
            <View style={s.summaryItem}>
              {(() => {
                const ls = Math.max(summary.today_user_steps, liveSteps);
                return (
                  <>
                    <Feather name="activity" size={16} color={ls > 0 ? T.green : T.purple} style={{ marginBottom: 6 }} />
                    <Text style={[s.summaryVal, { color: ls > 0 ? T.green : T.textPrimary }]}>{fmt(ls)}</Text>
                  </>
                );
              })()}
              <Text style={s.summaryLabel}>Today Steps</Text>
            </View>
            <View style={s.summaryDivider} />
            <View style={s.summaryItem}>
              <Feather name="zap" size={16} color={T.purple} style={{ marginBottom: 6 }} />
              <Text style={s.summaryVal}>{summary.active_members_total}</Text>
              <Text style={s.summaryLabel}>Active Members</Text>
            </View>
          </View>
        </View>

        {/* ── Filter chips ──────────────────────────────────────────────────── */}
        {filters.length > 0 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.filtersRow}>
            {filters.map((f) => {
              const active = selectedFilter === f.group_type;
              const fc = cfg(f.group_type);
              return (
                <TouchableOpacity
                  key={f.group_type}
                  onPress={() => setSelectedFilter(f.group_type as GroupTypeFilter)}
                  activeOpacity={0.75}
                >
                  {active ? (
                    <LinearGradient
                      colors={[fc.start, fc.end]}
                      style={s.filterChipActive}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 0 }}
                    >
                      <Text style={s.filterChipActiveText}>{f.label}</Text>
                      {f.count > 0 && (
                        <View style={s.filterChipCountActive}>
                          <Text style={s.filterChipCountTextActive}>{f.count}</Text>
                        </View>
                      )}
                    </LinearGradient>
                  ) : (
                    <View style={s.filterChip}>
                      <Text style={s.filterChipText}>{f.label}</Text>
                      {f.count > 0 && (
                        <View style={s.filterChipCount}>
                          <Text style={s.filterChipCountText}>{f.count}</Text>
                        </View>
                      )}
                    </View>
                  )}
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        )}

        {/* ── Section header ────────────────────────────────────────────────── */}
        <View style={s.sectionHeader}>
          <Text style={s.sectionTitle}>All My Groups</Text>
          <TouchableOpacity onPress={() => setCreateModal(true)} style={s.newGroupBtn}>
            <LinearGradient colors={[T.cyan, T.purple]} style={s.newGroupGrad} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}>
              <Feather name="plus" size={13} color="#fff" />
              <Text style={s.newGroupBtnText}>New</Text>
            </LinearGradient>
          </TouchableOpacity>
        </View>

        {/* ── Groups list / empty state ─────────────────────────────────────── */}
        {visibleGroups.length === 0 ? (
          <View style={s.emptyBox}>
            <View style={[s.emptyIconWrap, filterCfg && {
              borderColor: filterCfg.border,
              backgroundColor: filterCfg.placeholderBg,
            }]}>
              <Feather
                name={filterCfg ? filterCfg.icon : "users"}
                size={28}
                color={filterCfg ? filterCfg.start : T.cyan}
              />
            </View>
            {selectedFilter === "all" ? (
              <>
                <Text style={s.emptyTitle}>No groups yet</Text>
                <Text style={s.emptySub}>Create your first walking group or accept an invite.</Text>
              </>
            ) : (
              <>
                <Text style={[s.emptyTitle, filterCfg && { color: filterCfg.start }]}>
                  No {selectedFilter.charAt(0).toUpperCase() + selectedFilter.slice(1)} groups
                </Text>
                <Text style={s.emptySub}>
                  Create or join a {selectedFilter.charAt(0).toUpperCase() + selectedFilter.slice(1)} group.
                </Text>
              </>
            )}
            <TouchableOpacity onPress={() => setCreateModal(true)} style={s.emptyCreateBtn} activeOpacity={0.82}>
              <LinearGradient
                colors={filterCfg ? [filterCfg.start, filterCfg.end] : [T.cyan, T.purple]}
                style={s.emptyCreateGrad}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
              >
                <Feather name="plus-circle" size={15} color="#fff" />
                <Text style={s.emptyCreateText}>Create New Group</Text>
              </LinearGradient>
            </TouchableOpacity>
          </View>
        ) : (
          visibleGroups.map((g) => (
            <GroupCard key={g.groupId} group={g} onPress={() => openGroup(g.groupId)} />
          ))
        )}

        {/* ── Pending Invitations ───────────────────────────────────────────── */}
        {pendingInvites.length > 0 && (
          <>
            <Text style={[s.sectionTitle, { marginTop: 24, marginBottom: 12 }]}>
              Pending Invitations
            </Text>
            {pendingInvites.map((inv) => {
              const ic = cfg(inv.group?.groupType ?? "custom");
              return (
                <View key={inv.id} style={[s.inviteCard, { borderColor: ic.border }]}>
                  <View style={[s.inviteIconWrap, { backgroundColor: ic.glow, borderColor: ic.border }]}>
                    <Feather name={ic.icon} size={18} color={ic.start} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={s.inviteName}>{inv.group?.groupName ?? "Unknown Group"}</Text>
                    <Text style={s.inviteMeta}>
                      Invited by {inv.invitedByUsername ?? "someone"} · {timeAgo(inv.createdAt)}
                    </Text>
                    {inv.group?.dailyGoalSteps && (
                      <Text style={s.inviteGoal}>Goal: {fmt(inv.group.dailyGoalSteps)} steps/day</Text>
                    )}
                  </View>
                  <View style={s.inviteActions}>
                    <TouchableOpacity onPress={() => handleAccept(inv)} style={s.inviteAcceptBtn} activeOpacity={0.8}>
                      <Text style={s.inviteAcceptText}>Accept</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => handleDecline(inv)} style={s.inviteDeclineBtn} activeOpacity={0.8}>
                      <Text style={s.inviteDeclineText}>Decline</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              );
            })}
          </>
        )}

        {/* ── Create New Group CTA ──────────────────────────────────────────── */}
        {groups.length > 0 && (
          <TouchableOpacity onPress={() => setCreateModal(true)} style={s.createCta} activeOpacity={0.82}>
            <LinearGradient
              colors={[T.cyan, T.purple]}
              style={s.createCtaGrad}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
            >
              <Feather name="plus-circle" size={17} color="#fff" />
              <Text style={s.createCtaText}>Create New Group</Text>
            </LinearGradient>
          </TouchableOpacity>
        )}

        <View style={{ height: 40 }} />
      </ScrollView>
      )}

      {/* ── Create Group Modal ─────────────────────────────────────────────── */}
      <Modal
        visible={createModal}
        transparent
        animationType="slide"
        onRequestClose={resetCreateModal}
      >
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          keyboardVerticalOffset={Platform.OS === "ios" ? 0 : 24}
        >
          <View style={s.modalOverlay}>
            <View style={s.modalBox}>
              <View style={s.modalHandle} />
              <View style={s.modalHeader}>
                <Text style={s.modalTitle}>Create Group</Text>
                <TouchableOpacity onPress={resetCreateModal} hitSlop={{ top: 12, left: 12, right: 12, bottom: 12 }}>
                  <Feather name="x" size={20} color={T.textSecondary} />
                </TouchableOpacity>
              </View>

              <Text style={s.modalLabel}>Group Name</Text>
              <TextInput
                style={s.modalInput}
                placeholder="e.g. Morning Walkers"
                placeholderTextColor={T.textMuted}
                value={createName}
                onChangeText={setCreateName}
              />

              <Text style={s.modalLabel}>Type</Text>
              <View style={s.typeRow}>
                {(["friends", "family", "office", "custom"] as const).map((t) => {
                  const tc = cfg(t);
                  const active = createType === t;
                  return (
                    <TouchableOpacity key={t} onPress={() => setCreateType(t)} activeOpacity={0.75}>
                      {active ? (
                        <LinearGradient
                          colors={[tc.start, tc.end]}
                          style={s.typeChipActive}
                          start={{ x: 0, y: 0 }}
                          end={{ x: 1, y: 0 }}
                        >
                          <Feather name={tc.icon} size={12} color="#fff" />
                          <Text style={s.typeChipActiveText}>{t.charAt(0).toUpperCase() + t.slice(1)}</Text>
                        </LinearGradient>
                      ) : (
                        <View style={s.typeChip}>
                          <Feather name={tc.icon} size={12} color={T.textMuted} />
                          <Text style={s.typeChipText}>{t.charAt(0).toUpperCase() + t.slice(1)}</Text>
                        </View>
                      )}
                    </TouchableOpacity>
                  );
                })}
              </View>

              {createType === "custom" && (
                <>
                  <Text style={s.modalLabel}>Custom Group Type <Text style={{ color: T.textMuted, fontWeight: "400" }}>(required)</Text></Text>
                  <TextInput
                    style={s.modalInput}
                    placeholder="e.g. Apartment Team, Gym Team, Weekend Walkers"
                    placeholderTextColor={T.textMuted}
                    value={createCustomType}
                    onChangeText={setCreateCustomType}
                    maxLength={30}
                    autoCapitalize="words"
                  />

                  <Text style={s.modalLabel}>Group Color</Text>
                  <View style={s.colorPickerRow}>
                    {Object.entries(CUSTOM_THEMES).map(([key, ct]) => {
                      const isSelected = createColorTheme === key;
                      return (
                        <TouchableOpacity
                          key={key}
                          onPress={() => setCreateColorTheme(key)}
                          activeOpacity={0.8}
                          style={[s.colorSwatch, isSelected && { borderColor: ct.start, borderWidth: 2.5 }]}
                        >
                          <LinearGradient
                            colors={[ct.start, ct.end]}
                            style={s.colorSwatchGrad}
                            start={{ x: 0, y: 0 }}
                            end={{ x: 1, y: 1 }}
                          />
                          {isSelected && (
                            <View style={s.colorSwatchCheck}>
                              <Feather name="check" size={10} color="#fff" />
                            </View>
                          )}
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </>
              )}

              <Text style={s.modalLabel}>Daily Goal (steps)</Text>
              <TextInput
                style={s.modalInput}
                placeholder="10000"
                placeholderTextColor={T.textMuted}
                value={createGoal}
                onChangeText={setCreateGoal}
                keyboardType="number-pad"
              />

              {(() => {
                const isDisabled = creating || !createName.trim() || (createType === "custom" && createCustomType.trim().length < 2);
                const activeCfg = cfg(createType, createType === "custom" ? createColorTheme : null);
                return (
                  <TouchableOpacity
                    onPress={handleCreate}
                    disabled={isDisabled}
                    style={{ marginTop: 16 }}
                    activeOpacity={0.82}
                  >
                    <LinearGradient
                      colors={isDisabled ? ["#1E2A50", "#1E2A50"] : [activeCfg.start, activeCfg.end]}
                      style={s.modalCreateBtn}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 0 }}
                    >
                      {creating ? (
                        <ActivityIndicator color="#fff" size="small" />
                      ) : (
                        <Text style={s.modalCreateText}>Create Group</Text>
                      )}
                    </LinearGradient>
                  </TouchableOpacity>
                );
              })()}
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: T.bg },
  centered: { flex: 1, alignItems: "center", justifyContent: "center" },
  scroll: { paddingHorizontal: 16, paddingBottom: 20 },

  header: { flexDirection: "row", alignItems: "flex-start", gap: 12, paddingTop: 8, paddingBottom: 16 },
  backBtn: { marginTop: 2, padding: 4 },
  headerTitle: { fontSize: 20, fontWeight: "800", color: T.textPrimary, letterSpacing: 0.3 },
  headerSub: { fontSize: 12, color: T.textMuted, marginTop: 2 },

  summaryCard: {
    borderRadius: 16, padding: 18, marginBottom: 18,
    borderWidth: 1, borderColor: T.cardBorder,
    backgroundColor: "rgba(16,20,42,0.9)",
    overflow: "hidden",
  },
  summaryRow: { flexDirection: "row", alignItems: "center" },
  summaryItem: { flex: 1, alignItems: "center" },
  summaryVal: { fontSize: 24, fontWeight: "800", color: T.textPrimary },
  summaryLabel: { fontSize: 11, color: T.textSecondary, marginTop: 3 },
  summaryDivider: { width: 1, height: 40, backgroundColor: T.cardBorder },

  filtersRow: { paddingBottom: 14, gap: 8 },
  filterChip: {
    flexDirection: "row", alignItems: "center", gap: 5,
    paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20,
    borderWidth: 1, borderColor: "rgba(255,255,255,0.1)",
    backgroundColor: "rgba(16,20,42,0.8)",
  },
  filterChipText: { fontSize: 13, color: T.textSecondary, fontWeight: "600" },
  filterChipActive: {
    flexDirection: "row", alignItems: "center", gap: 5,
    paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20,
  },
  filterChipActiveText: { fontSize: 13, color: "#fff", fontWeight: "700" },
  filterChipCount: {
    width: 18, height: 18, borderRadius: 9,
    backgroundColor: "rgba(255,255,255,0.15)",
    alignItems: "center", justifyContent: "center",
  },
  filterChipCountText: { fontSize: 10, color: T.textSecondary, fontWeight: "700" },
  filterChipCountActive: {
    width: 18, height: 18, borderRadius: 9,
    backgroundColor: "rgba(0,0,0,0.3)",
    alignItems: "center", justifyContent: "center",
  },
  filterChipCountTextActive: { fontSize: 10, color: "#fff", fontWeight: "700" },

  sectionHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 },
  sectionTitle: { fontSize: 16, fontWeight: "700", color: T.textPrimary },
  newGroupBtn: { borderRadius: 10, overflow: "hidden" },
  newGroupGrad: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 10 },
  newGroupBtnText: { fontSize: 13, color: "#fff", fontWeight: "700" },

  // ── Group card ──────────────────────────────────────────────────────────────
  groupCard: {
    marginBottom: 14, borderRadius: 18, borderWidth: 1.5,
    backgroundColor: "rgba(10,14,30,0.97)",
    shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.45, shadowRadius: 16,
    elevation: 8, overflow: "hidden",
  },
  groupCardAccent: { height: 4, width: "100%" },
  groupCardInner: { padding: 14, paddingTop: 12 },

  // Header row: image + name/meta + admin + chevron
  gcHeaderRow: { flexDirection: "row", alignItems: "center", marginBottom: 12 },
  gcImageWrap: {
    width: 48, height: 48, borderRadius: 14,
    borderWidth: 1.5,
    alignItems: "center", justifyContent: "center",
    overflow: "hidden",
    flexShrink: 0,
  },
  gcName: { fontSize: 16, fontWeight: "800", color: T.textPrimary, marginBottom: 3 },
  gcTypeLine: { fontSize: 12, color: T.textSecondary },

  gcAdminBadge: {
    paddingHorizontal: 7, paddingVertical: 3, borderRadius: 6,
    backgroundColor: "rgba(255,200,61,0.15)", borderWidth: 1, borderColor: "rgba(255,200,61,0.5)",
  },
  gcAdminText: { fontSize: 9, color: T.gold, fontWeight: "800", letterSpacing: 0.4 },

  gcProgressRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 },
  gcProgressBg: { flex: 1, height: 8, borderRadius: 4, backgroundColor: "rgba(255,255,255,0.05)", overflow: "hidden" },
  gcProgressFill: { height: "100%", borderRadius: 4 },
  gcPct: { fontSize: 12, fontWeight: "800", minWidth: 36, textAlign: "right" },

  gcToday: { fontSize: 12, color: T.textMuted, marginBottom: 10 },

  gcFooter: { flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between" },
  gcYou: { fontSize: 14, color: T.textSecondary, fontWeight: "600" },
  gcTop: { fontSize: 11, color: T.textMuted, marginTop: 1 },

  // Empty state
  emptyBox: { alignItems: "center", paddingVertical: 52, gap: 8 },
  emptyIconWrap: {
    width: 72, height: 72, borderRadius: 36, borderWidth: 1,
    borderColor: T.cardBorder, backgroundColor: "rgba(0,216,255,0.08)",
    alignItems: "center", justifyContent: "center", marginBottom: 8,
  },
  emptyTitle: { fontSize: 17, color: T.textSecondary, fontWeight: "800", marginTop: 4 },
  emptySub: { fontSize: 13, color: T.textMuted, textAlign: "center", maxWidth: 240 },
  emptyCreateBtn: { marginTop: 20, borderRadius: 14, overflow: "hidden" },
  emptyCreateGrad: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 28, paddingVertical: 14, borderRadius: 14 },
  emptyCreateText: { fontSize: 15, color: "#fff", fontWeight: "700" },

  // Invite cards
  inviteCard: {
    flexDirection: "row", alignItems: "flex-start", gap: 12,
    backgroundColor: "rgba(16,20,42,0.9)", borderRadius: 14, padding: 14,
    marginBottom: 10, borderWidth: 1,
  },
  inviteIconWrap: { width: 42, height: 42, borderRadius: 13, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  inviteName: { fontSize: 14, fontWeight: "700", color: T.textPrimary },
  inviteMeta: { fontSize: 12, color: T.textSecondary, marginTop: 2 },
  inviteGoal: { fontSize: 11, color: T.textMuted, marginTop: 2 },
  inviteActions: { gap: 6, alignItems: "flex-end" },
  inviteAcceptBtn: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 9, backgroundColor: T.green + "22", borderWidth: 1, borderColor: T.green + "60" },
  inviteAcceptText: { fontSize: 12, color: T.green, fontWeight: "700" },
  inviteDeclineBtn: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 9, backgroundColor: "rgba(255,255,255,0.06)", borderWidth: 1, borderColor: "rgba(255,255,255,0.1)" },
  inviteDeclineText: { fontSize: 12, color: T.textMuted, fontWeight: "600" },

  // Create CTA
  createCta: { marginTop: 16, borderRadius: 14, overflow: "hidden", shadowColor: T.cyan, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 12, elevation: 6 },
  createCtaGrad: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 16, borderRadius: 14 },
  createCtaText: { fontSize: 16, color: "#fff", fontWeight: "800" },

  // Modal
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.75)", justifyContent: "flex-end" },
  modalBox: {
    backgroundColor: "#0D1225", borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: 24, paddingBottom: 40, borderWidth: 1, borderColor: T.cardBorder,
  },
  modalHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: T.cardBorder, alignSelf: "center", marginBottom: 16 },
  modalHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 4 },
  modalTitle: { fontSize: 18, fontWeight: "800", color: T.textPrimary },
  modalLabel: { fontSize: 13, color: T.textSecondary, marginBottom: 6, marginTop: 14 },
  modalInput: {
    backgroundColor: "rgba(255,255,255,0.05)", borderRadius: 10,
    borderWidth: 1, borderColor: T.cardBorder,
    padding: 12, color: T.textPrimary, fontSize: 15,
  },
  typeRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  typeChip: {
    flexDirection: "row", alignItems: "center", gap: 5,
    paddingHorizontal: 13, paddingVertical: 8, borderRadius: 10,
    borderWidth: 1, borderColor: "rgba(255,255,255,0.1)",
    backgroundColor: "rgba(16,20,42,0.8)",
  },
  typeChipText: { fontSize: 13, color: T.textMuted, fontWeight: "600" },
  typeChipActive: {
    flexDirection: "row", alignItems: "center", gap: 5,
    paddingHorizontal: 13, paddingVertical: 8, borderRadius: 10,
  },
  typeChipActiveText: { fontSize: 13, color: "#fff", fontWeight: "700" },
  modalCreateBtn: { paddingVertical: 15, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  modalCreateText: { fontSize: 16, color: "#fff", fontWeight: "800" },

  colorPickerRow: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 2 },
  colorSwatch: {
    width: 40, height: 40, borderRadius: 12,
    overflow: "hidden",
    borderWidth: 1.5, borderColor: "rgba(255,255,255,0.12)",
    alignItems: "center", justifyContent: "center",
  },
  colorSwatchGrad: { ...StyleSheet.absoluteFillObject, borderRadius: 10 },
  colorSwatchCheck: {
    width: 16, height: 16, borderRadius: 8,
    backgroundColor: "rgba(0,0,0,0.45)",
    alignItems: "center", justifyContent: "center",
  },
});
