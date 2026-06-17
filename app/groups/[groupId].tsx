import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator, Alert, Image, Modal, Platform, ScrollView, StyleSheet,
  Text, TextInput, TouchableOpacity, View, RefreshControl, Dimensions,
} from "react-native";
import * as ImagePicker from "expo-image-picker";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { Feather } from "@expo/vector-icons";
import Svg, { Circle, Defs, LinearGradient as SvgGradient, Stop, Polyline } from "react-native-svg";
import { useLocalSearchParams, useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import { authFetch } from "@/utils/authFetch";
import { getLocalDateStr } from "@/utils/timezone";
import { getApiBase } from "@/utils/apiUrl";
import { getStoredSession } from "@/services/authService";
import { subscribeToChannel } from "@/services/realtimeService";
import { useWalk } from "@/context/WalkContext";

const { width: SCREEN_W } = Dimensions.get("window");

// ── Design tokens ─────────────────────────────────────────────────────────────
const T = {
  bg: "#070B18",
  bg2: "#10142A",
  card: "rgba(14,20,45,0.88)",
  cyan: "#00D8FF",
  purple: "#8B5CFF",
  green: "#00F59B",
  gold: "#FFC83D",
  red: "#FF4D5E",
  white: "#FFFFFF",
  secondary: "#9AA4C7",
  muted: "#6F7897",
  border: "rgba(0,216,255,0.22)",
  borderStrong: "rgba(0,216,255,0.45)",
};

type GroupType = "friends" | "family" | "office" | "custom";
type TabKey = "today" | "overall" | "members" | "history";

interface Profile { id: string; username: string; fullName: string | null; avatarUrl: string | null; countryCode: string | null }
interface MemberEntry {
  id: string; userId: string; role: string; joinedAt: string | null;
  profile: Profile | null; todaySteps: number; allTimeSteps: number;
  distanceKm: number; isCurrentUser: boolean;
}
interface Group {
  id: string; groupName: string; groupType: GroupType; customGroupType: string | null; adminUserId: string;
  dailyGoalSteps: number; privacy: string;
  inviteCode: string | null; themeKey: string | null; status: string;
  memberCount: number; todayTotal: number; userRole: string;
  groupImageUrl: string | null;
}
interface GroupStats {
  bestStreak: number; weeklyMomentumPct: number; totalDistKm: number;
  avgDailyStepsPerMember: number; activeDays: number; totalGroupAllTime: number;
  sparkline: number[];
}
interface LeaderboardEntry {
  rank: number; userId: string; profile: Profile | null; steps: number; role: string; isCurrentUser: boolean;
}
interface DailyResult {
  id: string; resultDate: string; groupTotalSteps: number; dailyGoalSteps: number; goalCompleted: boolean;
}
interface PendingGroupInvite {
  id: string; groupId: string; invitedUserId: string; status: string; createdAt: string;
  invitedProfile: Profile | null;
}
interface SelectedMember {
  userId: string; username: string; fullName: string | null; avatarUrl: string | null;
  countryCode: string | null; role: string; todaySteps: number; allTimeSteps: number;
  isCurrentUser: boolean;
}

const TABS: { key: TabKey; label: string; icon: string }[] = [
  { key: "today", label: "Today", icon: "sun" },
  { key: "overall", label: "Overall", icon: "award" },
  { key: "members", label: "Members", icon: "users" },
  { key: "history", label: "History", icon: "calendar" },
];

// Per group-type color identity
const TYPE_THEME: Record<GroupType, { g1: string; g2: string; accent: string; glow: string; badgeBg: string; badgeBorder: string }> = {
  friends: { g1: "#2563FF", g2: "#7C3AED", accent: "#7EB4FF", glow: "#2563FF", badgeBg: "rgba(37,99,255,0.15)", badgeBorder: "rgba(37,99,255,0.5)" },
  family:  { g1: "#FF3D9A", g2: "#FF9F1C", accent: "#FFBF80", glow: "#FF3D9A", badgeBg: "rgba(255,61,154,0.15)", badgeBorder: "rgba(255,61,154,0.5)" },
  office:  { g1: "#00C2A8", g2: "#00F59B", accent: "#70FFD5", glow: "#00C2A8", badgeBg: "rgba(0,194,168,0.15)", badgeBorder: "rgba(0,194,168,0.5)" },
  custom:  { g1: "#8B5CFF", g2: "#00D8FF", accent: "#C4A0FF", glow: "#8B5CFF", badgeBg: "rgba(139,92,255,0.15)", badgeBorder: "rgba(139,92,255,0.5)" },
};

// Custom color theme overrides (same keys as groups list screen)
const CUSTOM_THEME_COLORS: Record<string, { g1: string; g2: string }> = {
  custom_purple_blue: { g1: "#8B5CFF", g2: "#2563FF" },
  custom_cyan_green:  { g1: "#06B6D4", g2: "#22C55E" },
  custom_pink_orange: { g1: "#EC4899", g2: "#F97316" },
  custom_gold_amber:  { g1: "#F59E0B", g2: "#EF4444" },
  custom_red_rose:    { g1: "#EF4444", g2: "#F43F5E" },
  custom_teal_mint:   { g1: "#14B8A6", g2: "#6EE7B7" },
};

function resolveTheme(groupType: GroupType, themeKey: string | null) {
  if (groupType === "custom" && themeKey && themeKey in CUSTOM_THEME_COLORS) {
    const ct = CUSTOM_THEME_COLORS[themeKey];
    return {
      g1: ct.g1, g2: ct.g2,
      accent: ct.g1 + "CC",
      glow: ct.g1,
      badgeBg: ct.g1 + "26",
      badgeBorder: ct.g1 + "80",
    };
  }
  return TYPE_THEME[groupType] ?? TYPE_THEME.custom;
}

// Deterministic solid background per username so initials are always readable
const AVATAR_COLORS = ["#2563FF", "#7C3AED", "#00C2A8", "#FF3D9A", "#FF9F1C", "#10B981", "#F59E0B"];
function avatarBg(username?: string | null): string {
  if (!username) return AVATAR_COLORS[0];
  const hash = username.split("").reduce((acc, c) => acc + c.charCodeAt(0), 0);
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

function flag(code: string | null | undefined) {
  if (!code || code.length !== 2) return "";
  try { return String.fromCodePoint(...[...code.toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65)); }
  catch { return ""; }
}
function fmtN(n: number) { return n >= 1_000_000 ? (n / 1_000_000).toFixed(2) + "M" : n >= 1000 ? (n / 1000).toFixed(1) + "k" : String(n); }
function fmtInt(n: number) { return n.toLocaleString(); }
function timeAgo(iso: string) {
  const d = (Date.now() - new Date(iso).getTime()) / 1000;
  if (d < 3600) return `${Math.floor(d / 60)}m ago`;
  if (d < 86400) return `${Math.floor(d / 3600)}h ago`;
  return `${Math.floor(d / 86400)}d ago`;
}

// ── Progress ring ─────────────────────────────────────────────────────────────
function ProgressRing({ pct, size, stroke, g1, g2, label, valueText, subText, pctText, centerTop }: {
  pct: number; size: number; stroke: number; g1: string; g2: string;
  label?: string; valueText: string; subText: string; pctText: string;
  centerTop?: React.ReactNode;
}) {
  const R = (size - stroke) / 2;
  const CIRC = 2 * Math.PI * R;
  const progress = Math.min(1, Math.max(0, pct));
  const glowId = `rg-${size}-${g1.replace("#", "")}`;
  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      <Svg width={size} height={size} style={{ position: "absolute" }}>
        <Defs>
          <SvgGradient id={glowId} x1="0%" y1="0%" x2="100%" y2="100%">
            <Stop offset="0%" stopColor={g1} />
            <Stop offset="100%" stopColor={g2} />
          </SvgGradient>
        </Defs>
        {/* Track */}
        <Circle cx={size / 2} cy={size / 2} r={R} stroke="rgba(255,255,255,0.06)" strokeWidth={stroke} fill="none" />
        {/* Progress */}
        <Circle
          cx={size / 2} cy={size / 2} r={R}
          stroke={`url(#${glowId})`}
          strokeWidth={stroke}
          fill="none"
          strokeDasharray={[progress * CIRC, CIRC * (1 - progress)]}
          strokeDashoffset={CIRC * 0.25}
          strokeLinecap="round"
        />
      </Svg>
      <View style={{ alignItems: "center" }}>
        {centerTop && <View style={{ marginBottom: 4 }}>{centerTop}</View>}
        {label && <Text style={{ color: T.secondary, fontSize: 9, fontWeight: "700", letterSpacing: 1.5, marginBottom: 4 }}>{label}</Text>}
        <Text style={{ color: T.white, fontSize: size > 170 ? 24 : 20, fontWeight: "900", letterSpacing: -1 }}>{valueText}</Text>
        <Text style={{ color: T.muted, fontSize: 10, marginTop: 2 }}>{subText}</Text>
        <Text style={{ color: progress >= 1 ? T.green : g1, fontSize: size > 170 ? 19 : 15, fontWeight: "800", marginTop: 5 }}>{pctText}</Text>
      </View>
    </View>
  );
}

// ── Sparkline ─────────────────────────────────────────────────────────────────
function Sparkline({ data, color, width: W, height: H }: { data: number[]; color: string; width: number; height: number }) {
  if (!data.length || data.every((v) => v === 0)) return null;
  const max = Math.max(...data, 1);
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * W},${H - (v / max) * H * 0.85}`).join(" ");
  return (
    <Svg width={W} height={H}>
      <Polyline points={pts} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

// ── Avatar circle ─────────────────────────────────────────────────────────────
// `userId` + `hasAvatar` → use the public display proxy so OCI auth is handled server-side.
// `url` is kept only as a "has avatar" signal (raw OCI URLs can't be fetched directly by RN).
function AvatarCircle({ userId, url, username, color, size = 38 }: { userId?: string | null; url?: string | null; username?: string | null; color: string; size?: number }) {
  const [imgErr, setImgErr] = useState(false);
  const displayUri = url && userId ? `${getApiBase()}/api/profile/avatar/${userId}` : null;
  const hasImg = !!displayUri && !imgErr;
  const initial = (username?.[0] ?? "?").toUpperCase();
  return (
    <View style={{
      width: size, height: size, borderRadius: size / 2, borderWidth: 2,
      borderColor: color,
      backgroundColor: hasImg ? "transparent" : avatarBg(username),
      alignItems: "center", justifyContent: "center", overflow: "hidden",
    }}>
      {hasImg ? (
        <Image
          source={{ uri: displayUri }}
          style={{ width: size, height: size }}
          onError={() => setImgErr(true)}
        />
      ) : (
        <Text style={{ fontSize: size * 0.38, fontWeight: "800", color: "#FFFFFF" }}>
          {initial}
        </Text>
      )}
    </View>
  );
}

// ── Large avatar for the member profile modal ─────────────────────────────────
function ModalAvatar({ userId, username, url, borderColor }: { userId?: string | null; username: string; url: string | null; borderColor: string }) {
  const [imgErr, setImgErr] = useState(false);
  const displayUri = url && userId ? `${getApiBase()}/api/profile/avatar/${userId}` : null;
  const hasImg = !!displayUri && !imgErr;
  return (
    <View style={{ alignItems: "center", marginBottom: 12 }}>
      <View style={[s.mpAvatar, {
        backgroundColor: hasImg ? "transparent" : avatarBg(username),
        borderColor,
      }]}>
        {hasImg ? (
          <Image
            source={{ uri: displayUri }}
            style={{ width: 72, height: 72, borderRadius: 36 }}
            onError={() => setImgErr(true)}
          />
        ) : (
          <Text style={{ fontSize: 30, fontWeight: "800", color: "#FFFFFF" }}>
            {(username?.[0] ?? "?").toUpperCase()}
          </Text>
        )}
      </View>
    </View>
  );
}

// ── Small tag ─────────────────────────────────────────────────────────────────
function Tag({ label, color }: { label: string; color: string }) {
  return (
    <View style={{ backgroundColor: color + "22", paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, borderWidth: 1, borderColor: color + "40" }}>
      <Text style={{ color, fontSize: 8, fontWeight: "800", letterSpacing: 0.3 }}>{label}</Text>
    </View>
  );
}

// ── Rank badge ────────────────────────────────────────────────────────────────
function RankBadge({ rank }: { rank: number }) {
  if (rank === 1) return (
    <View style={[s.rankBadge, { backgroundColor: "rgba(255,200,61,0.15)", borderColor: "rgba(255,200,61,0.5)" }]}>
      <Text style={{ fontSize: 16 }}>👑</Text>
    </View>
  );
  if (rank === 2) return (
    <View style={[s.rankBadge, { backgroundColor: "rgba(148,163,184,0.15)", borderColor: "rgba(148,163,184,0.4)" }]}>
      <Text style={{ fontSize: 13, fontWeight: "800", color: "#94A3B8" }}>#2</Text>
    </View>
  );
  if (rank === 3) return (
    <View style={[s.rankBadge, { backgroundColor: "rgba(205,127,50,0.15)", borderColor: "rgba(205,127,50,0.4)" }]}>
      <Text style={{ fontSize: 13, fontWeight: "800", color: "#CD7F32" }}>#3</Text>
    </View>
  );
  return (
    <View style={[s.rankBadge, { backgroundColor: "rgba(255,255,255,0.05)", borderColor: "rgba(255,255,255,0.08)" }]}>
      <Text style={{ fontSize: 12, fontWeight: "700", color: T.muted }}>#{rank}</Text>
    </View>
  );
}

// ── Group image circle (header + hero) ────────────────────────────────────────
function GroupImageCircle({ groupId, hasImage, g1, g2, size = 52, onPress }: {
  groupId: string; hasImage: boolean; g1: string; g2: string; size?: number;
  onPress?: () => void;
}) {
  const [imgErr, setImgErr] = useState(false);
  const uri = hasImage ? `${getApiBase()}/api/groups/${groupId}/image` : null;
  const showImg = !!uri && !imgErr;
  const inner = (
    <View style={{
      width: size, height: size, borderRadius: size / 2,
      overflow: "hidden", borderWidth: 2, borderColor: g1 + "60",
    }}>
      {showImg ? (
        <Image
          source={{ uri }}
          style={{ width: size, height: size }}
          onError={() => setImgErr(true)}
        />
      ) : (
        <LinearGradient
          colors={[g1 + "40", g2 + "20"]}
          style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}
          start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
        >
          <Feather name="users" size={size * 0.4} color={g1} />
        </LinearGradient>
      )}
    </View>
  );
  if (onPress) {
    return (
      <TouchableOpacity onPress={onPress} activeOpacity={0.8} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
        {inner}
      </TouchableOpacity>
    );
  }
  return inner;
}

// ── Main screen ───────────────────────────────────────────────────────────────
export default function GroupDetailScreen() {
  const router = useRouter();
  const { groupId } = useLocalSearchParams<{ groupId: string }>();
  const { todaySteps: liveSteps } = useWalk();

  const [group, setGroup] = useState<Group | null>(null);
  const [members, setMembers] = useState<MemberEntry[]>([]);
  const [history, setHistory] = useState<DailyResult[]>([]);
  const [todayLB, setTodayLB] = useState<LeaderboardEntry[]>([]);
  const [overallLB, setOverallLB] = useState<LeaderboardEntry[]>([]);
  const [groupStats, setGroupStats] = useState<GroupStats | null>(null);
  const [pendingGroupInvites, setPendingGroupInvites] = useState<PendingGroupInvite[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const hasSyncedRef = useRef(false);
  const [activeTab, setActiveTab] = useState<TabKey>("today");
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);
  const [showGroupImagePreview, setShowGroupImagePreview] = useState(false);
  const [selectedMember, setSelectedMember] = useState<SelectedMember | null>(null);

  const fetchData = useCallback(async (isRefresh = false) => {
    if (!isRefresh) setLoading(true);
    try {
      const ld = getLocalDateStr();
      const [detailRes, todayRes, overallRes] = await Promise.all([
        authFetch(`/api/groups/${groupId}?localDate=${ld}`),
        authFetch(`/api/groups/${groupId}/leaderboard?range=today&localDate=${ld}`),
        authFetch(`/api/groups/${groupId}/leaderboard?range=all_time`),
      ]);
      if (!detailRes.ok) { Alert.alert("Error", "Failed to load group"); router.back(); return; }
      const detail = await detailRes.json();
      const todayData = todayRes.ok ? await todayRes.json() : { leaderboard: [] };
      const overallData = overallRes.ok ? await overallRes.json() : { leaderboard: [] };
      setGroup(detail.group);
      setMembers(detail.members ?? []);
      setHistory(detail.history ?? []);
      setGroupStats(detail.groupStats ?? null);
      setPendingGroupInvites(detail.pendingGroupInvites ?? []);
      setTodayLB(todayData.leaderboard ?? []);
      setOverallLB(overallData.leaderboard ?? []);
    } catch (_) {}
    finally { setLoading(false); setRefreshing(false); }
  }, [groupId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  useEffect(() => {
    if (!groupId) return;
    const ch = subscribeToChannel(`public-group-${groupId}`);
    if (!ch) return;
    const onUpdate = () => fetchData(true);
    ch.bind("group.steps.updated", onUpdate);
    ch.bind("group.invite.accepted", onUpdate);
    ch.bind("group.member.removed", onUpdate);
    ch.bind("group.goal.updated", onUpdate);
    return () => {
      ch.unbind("group.steps.updated", onUpdate);
      ch.unbind("group.invite.accepted", onUpdate);
      ch.unbind("group.member.removed", onUpdate);
      ch.unbind("group.goal.updated", onUpdate);
    };
  }, [groupId, fetchData]);

  // Backfill: if user's live steps exceed what's recorded in this group, sync once so the DB catches up
  useEffect(() => {
    if (!group || hasSyncedRef.current || liveSteps <= 0 || todayLB.length === 0) return;
    const myEntry = todayLB.find((e) => e.isCurrentUser);
    if (!myEntry || myEntry.steps >= liveSteps) return;
    hasSyncedRef.current = true;
    const today = getLocalDateStr();
    authFetch("/api/groups/steps/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dailySteps: liveSteps, stepDate: today }),
    }).then(() => fetchData(true)).catch(() => {});
  }, [group?.id, todayLB]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) {
    return (
      <View style={[s.loadingWrap, { backgroundColor: T.bg }]}>
        <ActivityIndicator size="large" color={T.cyan} />
        <Text style={{ color: T.secondary, marginTop: 12, fontSize: 14 }}>Loading group...</Text>
      </View>
    );
  }
  if (!group) return null;

  const theme = resolveTheme(group.groupType, group.themeKey);
  const isAdmin = group.userRole === "admin";
  const groupGoal = group.dailyGoalSteps * (group.memberCount || 1);

  // Apply live-steps override: replace the current user's DB steps with the higher of DB or live
  const myGroupSteps = todayLB.find((e) => e.isCurrentUser)?.steps ?? 0;
  const myAdjustedSteps = Math.max(myGroupSteps, liveSteps);
  const adjustedTodayTotal = group.todayTotal - myGroupSteps + myAdjustedSteps;
  const adjustedTodayLB = [...todayLB
    .map((e) => e.isCurrentUser ? { ...e, steps: myAdjustedSteps } : e)]
    .sort((a, b) => b.steps - a.steps)
    .map((e, i) => ({ ...e, rank: i + 1 }));

  const goalPct = groupGoal > 0 ? adjustedTodayTotal / groupGoal : 0;
  const allTimeGoal = Math.max(group.memberCount, 1) * group.dailyGoalSteps * 100;
  const allTimePct = allTimeGoal > 0 ? (groupStats?.totalGroupAllTime ?? 0) / allTimeGoal : 0;
  const topWalker = adjustedTodayLB[0] ?? null;
  const avgStepsPerHr = groupStats && groupStats.activeDays > 0
    ? Math.round(groupStats.avgDailyStepsPerMember / 24)
    : 0;

  return (
    <View style={[s.root, { backgroundColor: T.bg }]}>
      {/* ── Hero gradient header ───────────────────────────────────────────── */}
      <LinearGradient
        colors={[theme.g1 + "30", theme.g2 + "15", T.bg]}
        style={s.heroGrad}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
      >
        <SafeAreaView edges={["top"]}>
          {/* Top bar */}
          <View style={s.topBar}>
            <TouchableOpacity onPress={() => router.back()} style={s.topBarBtn} activeOpacity={0.7}>
              <Feather name="chevron-left" size={20} color={T.white} />
            </TouchableOpacity>
            <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8, maxWidth: "100%" }}>
                {group.groupImageUrl && (
                  <GroupImageCircle
                    groupId={group.id} hasImage g1={theme.g1} g2={theme.g2} size={34}
                    onPress={() => setShowGroupImagePreview(true)}
                  />
                )}
                <Text style={s.topBarTitle} numberOfLines={1}>{group.groupName}</Text>
              </View>
            </View>
            {isAdmin && (
              <TouchableOpacity onPress={() => setShowEditModal(true)} style={s.topBarBtn} activeOpacity={0.7}>
                <Feather name="settings" size={17} color={T.white} />
              </TouchableOpacity>
            )}
          </View>
        </SafeAreaView>

        <View style={s.heroPadding}>
          {/* Type badge */}
          <View style={[s.typeBadge, { backgroundColor: theme.badgeBg, borderColor: theme.badgeBorder }]}>
            <Feather name={group.groupType === "friends" ? "users" : group.groupType === "family" ? "heart" : group.groupType === "office" ? "briefcase" : "star"} size={10} color={theme.g1} />
            <Text style={{ color: theme.g1, fontSize: 10, fontWeight: "800", letterSpacing: 1.2, marginLeft: 5 }}>
              {group.groupType === "custom" && group.customGroupType ? group.customGroupType.toUpperCase() : group.groupType.toUpperCase()}
            </Text>
          </View>

          {/* Hero section changes by tab */}
          {(activeTab === "today" || activeTab === "overall") && (
            <View style={activeTab === "today" ? s.todayHeroRow : s.overallHeroCol}>
              {activeTab === "today" ? (
                <>
                  <ProgressRing
                    pct={goalPct} size={168} stroke={14}
                    g1={theme.g1} g2={theme.g2}
                    label="TODAY"
                    valueText={fmtInt(adjustedTodayTotal)}
                    subText={`/ ${fmtN(groupGoal)} STEPS`}
                    pctText={`${Math.round(goalPct * 100)}%`}
                  />
                  <View style={s.todayStatCol}>
                    {[
                      { icon: "users", val: `${group.memberCount}`, lbl: "Members", color: T.cyan },
                      { icon: "target", val: fmtN(group.dailyGoalSteps), lbl: "Daily Goal", color: T.purple },
                      { icon: "zap", val: `${groupStats?.bestStreak ?? 0}`, lbl: "Day Streak 🔥", color: T.gold },
                    ].map((st) => (
                      <View key={st.lbl} style={[s.statCard, { borderColor: st.color + "30" }]}>
                        <Feather name={st.icon as never} size={13} color={st.color} />
                        <Text style={{ color: T.white, fontWeight: "800", fontSize: 15, marginTop: 3 }}>{st.val}</Text>
                        <Text style={{ color: T.muted, fontSize: 9 }}>{st.lbl}</Text>
                      </View>
                    ))}
                  </View>
                </>
              ) : (
                <>
                  <ProgressRing
                    pct={allTimePct} size={190} stroke={15}
                    g1={theme.g1} g2={theme.g2}
                    label="TOTAL GROUP STEPS"
                    valueText={fmtN(groupStats?.totalGroupAllTime ?? 0)}
                    subText={`/ ${fmtN(allTimeGoal)}`}
                    pctText={`${Math.round(allTimePct * 100)}%`}
                  />
                  <View style={s.overallMetaRow}>
                    <Feather name="users" size={11} color={T.muted} />
                    <Text style={{ color: T.muted, fontSize: 11, marginLeft: 4 }}>{group.memberCount} members</Text>
                    <Text style={{ color: T.muted, marginHorizontal: 6 }}>·</Text>
                    <Feather name="target" size={11} color={T.muted} />
                    <Text style={{ color: T.muted, fontSize: 11, marginLeft: 4 }}>{fmtN(group.dailyGoalSteps)} daily goal</Text>
                  </View>
                </>
              )}
            </View>
          )}

          {(activeTab === "members" || activeTab === "history") && (
            <View style={[s.membersHero, { borderColor: theme.g1 + "25" }]}>
              <GroupImageCircle
                groupId={group.id}
                hasImage={!!group.groupImageUrl}
                g1={theme.g1}
                g2={theme.g2}
                size={52}
              />
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={{ color: T.white, fontWeight: "800", fontSize: 16 }} numberOfLines={1}>{group.groupName}</Text>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 4 }}>
                  <Text style={{ color: T.secondary, fontSize: 12 }}>{group.memberCount} members</Text>
                  <Text style={{ color: T.muted }}>·</Text>
                  <Text style={{ color: T.secondary, fontSize: 12 }}>{fmtN(group.dailyGoalSteps)} daily goal</Text>
                </View>
                <View style={[s.miniGoalBar, { marginTop: 8, backgroundColor: "rgba(255,255,255,0.08)" }]}>
                  <LinearGradient
                    colors={[theme.g1, theme.g2]}
                    style={{ width: `${Math.min(100, Math.round(goalPct * 100))}%` as `${number}%`, height: 4, borderRadius: 2 }}
                    start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
                  />
                </View>
                <Text style={{ color: T.muted, fontSize: 11, marginTop: 4 }}>
                  {Math.round(goalPct * 100)}% of daily goal · {fmtInt(adjustedTodayTotal)} steps today
                </Text>
              </View>
            </View>
          )}

          {/* Action buttons */}
          <View style={s.heroActions}>
            {isAdmin && (
              <TouchableOpacity
                onPress={() => setShowInviteModal(true)}
                style={s.inviteBtn}
                activeOpacity={0.8}
              >
                <LinearGradient colors={[theme.g1 + "40", theme.g2 + "25"]} style={s.inviteBtnInner} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}>
                  <Feather name="user-plus" size={14} color={T.cyan} />
                  <Text style={{ color: T.cyan, fontWeight: "700", fontSize: 13, marginLeft: 6 }}>Invite Members</Text>
                </LinearGradient>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              onPress={() => setShowLeaveConfirm(true)}
              style={s.leaveBtn}
              activeOpacity={0.8}
            >
              <Feather name="log-out" size={14} color={T.red} />
              <Text style={{ color: T.red, fontWeight: "700", fontSize: 13, marginLeft: 6 }}>Leave Group</Text>
            </TouchableOpacity>
          </View>
        </View>
      </LinearGradient>

      {/* ── Tab bar ──────────────────────────────────────────────────────────── */}
      <View style={s.tabBar}>
        {TABS.map((tab) => {
          const active = activeTab === tab.key;
          return (
            <TouchableOpacity
              key={tab.key}
              onPress={() => { Haptics.selectionAsync(); setActiveTab(tab.key); }}
              style={s.tabItem}
              activeOpacity={0.75}
            >
              {active ? (
                <LinearGradient colors={[theme.g1 + "30", theme.g2 + "20"]} style={s.tabActiveChip} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}>
                  <Feather name={tab.icon as never} size={12} color={theme.g1} />
                  <Text style={{ fontSize: 12, fontWeight: "700", color: theme.g1, marginLeft: 4 }}>{tab.label}</Text>
                </LinearGradient>
              ) : (
                <View style={s.tabInactiveChip}>
                  <Feather name={tab.icon as never} size={12} color={T.muted} />
                  <Text style={{ fontSize: 12, fontWeight: "600", color: T.muted, marginLeft: 4 }}>{tab.label}</Text>
                </View>
              )}
            </TouchableOpacity>
          );
        })}
      </View>

      {/* ── Tab content ──────────────────────────────────────────────────────── */}
      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchData(true); }} tintColor={T.cyan} />}
      >
        <View style={{ paddingBottom: 48 }}>
          {activeTab === "today" && (
            <TodayTab
              todayLB={adjustedTodayLB}
              topWalker={topWalker}
              avgStepsPerHr={avgStepsPerHr}
              theme={theme}
              onMemberPress={setSelectedMember}
            />
          )}
          {activeTab === "overall" && (
            <OverallTab
              overallLB={overallLB} groupStats={groupStats} theme={theme}
              onMemberPress={setSelectedMember}
            />
          )}
          {activeTab === "members" && (
            <MembersTab
              members={members}
              pendingGroupInvites={pendingGroupInvites}
              isAdmin={isAdmin}
              groupId={group.id}
              adminUserId={group.adminUserId}
              theme={theme}
              onInvitePress={() => setShowInviteModal(true)}
              onRefresh={() => fetchData(true)}
              onMemberPress={setSelectedMember}
            />
          )}
          {activeTab === "history" && (
            <HistoryTab history={history} goal={group.dailyGoalSteps} theme={theme} />
          )}
        </View>
      </ScrollView>

      {/* ── Modals ───────────────────────────────────────────────────────────── */}
      {/* ── Group image full-screen preview ──────────────────────────────── */}
      <Modal
        visible={showGroupImagePreview}
        transparent
        animationType="fade"
        onRequestClose={() => setShowGroupImagePreview(false)}
        statusBarTranslucent
      >
        <TouchableOpacity
          style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.88)", alignItems: "center", justifyContent: "center" }}
          activeOpacity={1}
          onPress={() => setShowGroupImagePreview(false)}
        >
          <View style={{ width: 260, height: 260, borderRadius: 130, overflow: "hidden", borderWidth: 3, borderColor: theme.g1 + "80" }}>
            <Image
              source={{ uri: `${getApiBase()}/api/groups/${group.id}/image` }}
              style={{ width: 260, height: 260 }}
              resizeMode="cover"
            />
          </View>
          <Text style={{ color: "rgba(255,255,255,0.45)", fontSize: 13, marginTop: 20 }}>Tap anywhere to close</Text>
        </TouchableOpacity>
      </Modal>

      {showInviteModal && (
        <InviteMemberModal groupId={group.id} theme={theme} onClose={() => setShowInviteModal(false)} onInvited={() => { setShowInviteModal(false); fetchData(true); }} />
      )}
      {showEditModal && (
        <EditGroupModal
          group={group}
          theme={theme}
          onClose={() => setShowEditModal(false)}
          onUpdated={() => { setShowEditModal(false); fetchData(true); }}
          onDeleted={() => { setShowEditModal(false); router.back(); }}
        />
      )}
      {showLeaveConfirm && (
        <LeaveModal
          groupName={group.groupName}
          groupId={group.id}
          isAdmin={isAdmin}
          otherMembers={members.filter((m) => !m.isCurrentUser)}
          theme={theme}
          onClose={() => setShowLeaveConfirm(false)}
          onLeft={() => router.back()}
        />
      )}
      {selectedMember && (
        <MemberProfileModal member={selectedMember} theme={theme} onClose={() => setSelectedMember(null)} />
      )}
    </View>
  );
}

// ── Today tab ─────────────────────────────────────────────────────────────────
function TodayTab({ todayLB, topWalker, avgStepsPerHr, theme, onMemberPress }: {
  todayLB: LeaderboardEntry[];
  topWalker: LeaderboardEntry | null;
  avgStepsPerHr: number;
  theme: { g1: string; g2: string; accent: string; glow: string };
  onMemberPress: (m: SelectedMember) => void;
}) {
  return (
    <View style={{ padding: 16, gap: 12 }}>
      {/* Insight cards row */}
      <View style={{ flexDirection: "row", gap: 10 }}>
        {/* Top Walker */}
        <View style={[s.insightCard, { borderColor: "rgba(255,200,61,0.3)", flex: 1 }]}>
          <LinearGradient colors={["rgba(255,200,61,0.1)", "rgba(139,92,255,0.05)"]} style={StyleSheet.absoluteFill} />
          <View style={{ flexDirection: "row", alignItems: "center", gap: 5, marginBottom: 8 }}>
            <Text style={{ fontSize: 14 }}>👑</Text>
            <Text style={{ color: T.secondary, fontSize: 9, fontWeight: "700", letterSpacing: 0.8 }}>TODAY'S TOP WALKER</Text>
          </View>
          {topWalker ? (
            <>
              <Text style={{ color: T.white, fontWeight: "800", fontSize: 14 }} numberOfLines={1}>
                {topWalker.profile?.fullName ?? topWalker.profile?.username ?? "—"}
              </Text>
              <Text style={{ color: T.gold, fontWeight: "700", fontSize: 12, marginTop: 3 }}>
                {fmtInt(topWalker.steps)} steps
              </Text>
            </>
          ) : (
            <Text style={{ color: T.muted, fontSize: 12 }}>No steps yet</Text>
          )}
        </View>

        {/* Group pace */}
        <View style={[s.insightCard, { borderColor: "rgba(0,245,155,0.25)", flex: 1 }]}>
          <LinearGradient colors={["rgba(0,245,155,0.08)", "rgba(0,216,255,0.05)"]} style={StyleSheet.absoluteFill} />
          <View style={{ flexDirection: "row", alignItems: "center", gap: 5, marginBottom: 8 }}>
            <Feather name="activity" size={11} color={T.green} />
            <Text style={{ color: T.secondary, fontSize: 9, fontWeight: "700", letterSpacing: 0.8 }}>GROUP PACE</Text>
          </View>
          <Text style={{ color: T.white, fontWeight: "800", fontSize: 14 }}>{fmtN(avgStepsPerHr)} steps/hr</Text>
          <Text style={{ color: T.green, fontWeight: "700", fontSize: 11, marginTop: 3 }}>
            {avgStepsPerHr > 500 ? "Ahead of goal!" : "Keep going!"}
          </Text>
        </View>
      </View>

      {/* Today rankings */}
      {todayLB.length === 0 ? (
        <View style={s.emptyWrap}>
          <View style={s.emptyIcon}>
            <Feather name="activity" size={24} color={T.cyan} />
          </View>
          <Text style={s.emptyTitle}>No steps yet today</Text>
          <Text style={s.emptyText}>Rankings will appear once members start walking.</Text>
        </View>
      ) : (
        <>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 4 }}>
            <Feather name="award" size={12} color={T.gold} />
            <Text style={{ color: T.secondary, fontSize: 11, fontWeight: "700", letterSpacing: 0.8 }}>TODAY'S RANKINGS</Text>
          </View>
          {todayLB.map((entry, i) => (
            <TouchableOpacity
              key={entry.userId}
              onPress={() => onMemberPress({
                userId: entry.userId,
                username: entry.profile?.username ?? "Unknown",
                fullName: entry.profile?.fullName ?? null,
                avatarUrl: entry.profile?.avatarUrl ?? null,
                countryCode: entry.profile?.countryCode ?? null,
                role: entry.role,
                todaySteps: entry.steps,
                allTimeSteps: 0,
                isCurrentUser: entry.isCurrentUser,
              })}
              activeOpacity={0.8}
              style={[s.lbRow, {
                backgroundColor: entry.isCurrentUser ? theme.g1 + "12" : T.card,
                borderColor: i === 0 ? "rgba(255,200,61,0.3)" : entry.isCurrentUser ? theme.g1 + "40" : T.border,
              }]}
            >
              <RankBadge rank={entry.rank} />
              <AvatarCircle userId={entry.userId} url={entry.profile?.avatarUrl} username={entry.profile?.username} color={theme.g1} />
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 5, flexWrap: "wrap" }}>
                  <Text style={{ color: T.white, fontWeight: "700", fontSize: 14 }} numberOfLines={1}>
                    {entry.profile?.fullName ?? entry.profile?.username ?? "Unknown"}
                  </Text>
                  {!!entry.profile?.countryCode && <Text style={{ fontSize: 12 }}>{flag(entry.profile.countryCode)}</Text>}
                  {entry.role === "admin" && <Tag label="ADMIN" color={T.gold} />}
                  {entry.isCurrentUser && <Tag label="YOU" color={theme.g1} />}
                </View>
                <Text style={{ color: T.muted, fontSize: 11 }}>@{entry.profile?.username ?? "—"}</Text>
              </View>
              <View style={{ alignItems: "flex-end" }}>
                <Text style={{ color: entry.steps > 0 ? theme.g1 : T.muted, fontWeight: "800", fontSize: 15 }}>{fmtN(entry.steps)}</Text>
                <Text style={{ color: T.muted, fontSize: 9 }}>steps today</Text>
              </View>
              <Feather name="chevron-right" size={14} color={T.muted} style={{ marginLeft: 4 }} />
            </TouchableOpacity>
          ))}
        </>
      )}
    </View>
  );
}

// ── Overall tab ───────────────────────────────────────────────────────────────
function OverallTab({ overallLB, groupStats, theme, onMemberPress }: {
  overallLB: LeaderboardEntry[];
  groupStats: GroupStats | null;
  theme: { g1: string; g2: string; accent: string; glow: string };
  onMemberPress: (m: SelectedMember) => void;
}) {
  const spark = groupStats?.sparkline ?? [];
  const momentumPos = (groupStats?.weeklyMomentumPct ?? 0) >= 0;
  const statCards = [
    { label: "Total Group Steps", val: fmtN(groupStats?.totalGroupAllTime ?? 0), icon: "trending-up", color: T.cyan, sub: "All time" },
    { label: "Best Streak", val: `${groupStats?.bestStreak ?? 0}`, icon: "zap", color: T.gold, sub: "days" },
    { label: "Avg Daily Steps", val: fmtN(groupStats?.avgDailyStepsPerMember ?? 0), icon: "activity", color: T.green, sub: "per member" },
    { label: "Total Distance", val: `${groupStats?.totalDistKm ?? 0} km`, icon: "map-pin", color: T.purple, sub: "all time" },
  ];
  return (
    <View style={{ padding: 16, gap: 12 }}>
      {/* Stat mini cards */}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {statCards.map((sc) => (
          <View key={sc.label} style={[s.statMini, { borderColor: sc.color + "25" }]}>
            <LinearGradient colors={[sc.color + "12", "transparent"]} style={StyleSheet.absoluteFill} />
            <Feather name={sc.icon as never} size={16} color={sc.color} />
            <Text style={{ color: T.white, fontWeight: "800", fontSize: 16, marginTop: 6 }}>{sc.val}</Text>
            <Text style={{ color: T.muted, fontSize: 9, marginTop: 2 }}>{sc.label}</Text>
          </View>
        ))}
      </View>

      {/* Momentum */}
      <View style={[s.momentumCard, { borderColor: (momentumPos ? T.green : T.red) + "25" }]}>
        <LinearGradient colors={[(momentumPos ? T.green : T.red) + "08", "transparent"]} style={StyleSheet.absoluteFill} />
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Feather name="trending-up" size={13} color={momentumPos ? T.green : T.red} />
            <Text style={{ color: T.secondary, fontSize: 12, fontWeight: "700" }}>Weekly Momentum</Text>
          </View>
          <Text style={{ color: momentumPos ? T.green : T.red, fontWeight: "800", fontSize: 16 }}>
            {momentumPos ? "+" : ""}{groupStats?.weeklyMomentumPct ?? 0}%
          </Text>
        </View>
        <Text style={{ color: T.muted, fontSize: 11, marginBottom: 10 }}>vs. previous 7 days</Text>
        <Sparkline data={spark} color={momentumPos ? T.green : T.red} width={SCREEN_W - 64} height={48} />
        {momentumPos && <Text style={{ color: T.green, fontSize: 11, fontWeight: "700", textAlign: "right", marginTop: 6 }}>Great momentum! 🔥</Text>}
      </View>

      {/* All-time leaderboard */}
      {overallLB.length === 0 ? (
        <View style={s.emptyWrap}>
          <View style={s.emptyIcon}><Feather name="award" size={24} color={T.cyan} /></View>
          <Text style={s.emptyTitle}>Build your ranking</Text>
          <Text style={s.emptyText}>Start walking to build your all-time ranking!</Text>
        </View>
      ) : (
        <>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 4 }}>
            <Feather name="star" size={12} color={T.purple} />
            <Text style={{ color: T.secondary, fontSize: 11, fontWeight: "700", letterSpacing: 0.8 }}>ALL-TIME RANKINGS</Text>
          </View>
          {overallLB.map((entry, i) => (
            <TouchableOpacity
              key={entry.userId}
              onPress={() => onMemberPress({
                userId: entry.userId,
                username: entry.profile?.username ?? "Unknown",
                fullName: entry.profile?.fullName ?? null,
                avatarUrl: entry.profile?.avatarUrl ?? null,
                countryCode: entry.profile?.countryCode ?? null,
                role: entry.role,
                todaySteps: 0,
                allTimeSteps: entry.steps,
                isCurrentUser: entry.isCurrentUser,
              })}
              activeOpacity={0.8}
              style={[s.lbRow, {
                backgroundColor: entry.isCurrentUser ? theme.g1 + "10" : T.card,
                borderColor: entry.isCurrentUser ? theme.g1 + "40" : T.border,
              }]}
            >
              <RankBadge rank={entry.rank} />
              <AvatarCircle userId={entry.userId} url={entry.profile?.avatarUrl} username={entry.profile?.username} color={theme.g1} />
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
                  <Text style={{ color: T.white, fontWeight: "700", fontSize: 14 }} numberOfLines={1}>
                    {entry.profile?.fullName ?? entry.profile?.username ?? "Unknown"}
                  </Text>
                  {!!entry.profile?.countryCode && <Text style={{ fontSize: 12 }}>{flag(entry.profile.countryCode)}</Text>}
                  {entry.role === "admin" && <Tag label="ADMIN" color={T.gold} />}
                  {entry.isCurrentUser && <Tag label="YOU" color={theme.g1} />}
                </View>
                <Text style={{ color: T.muted, fontSize: 10 }}>@{entry.profile?.username ?? "—"}</Text>
              </View>
              <View style={{ alignItems: "flex-end" }}>
                <Text style={{ color: theme.g1, fontWeight: "800", fontSize: 15 }}>{fmtN(entry.steps)}</Text>
                <Text style={{ color: T.muted, fontSize: 9 }}>total steps</Text>
              </View>
              <Feather name="chevron-right" size={14} color={T.muted} style={{ marginLeft: 4 }} />
            </TouchableOpacity>
          ))}
        </>
      )}
    </View>
  );
}

// ── Members tab ───────────────────────────────────────────────────────────────
function MembersTab({ members, pendingGroupInvites, isAdmin, groupId, adminUserId, theme, onInvitePress, onRefresh, onMemberPress }: {
  members: MemberEntry[]; pendingGroupInvites: PendingGroupInvite[];
  isAdmin: boolean; groupId: string; adminUserId: string;
  theme: { g1: string; g2: string; accent: string; glow: string };
  onInvitePress: () => void; onRefresh: () => void;
  onMemberPress: (m: SelectedMember) => void;
}) {
  const activeCount = members.length;

  const handleCancelInvite = async (inviteId: string, username: string) => {
    Alert.alert("Cancel Invite", `Cancel the invite sent to @${username}?`, [
      { text: "Keep", style: "cancel" },
      { text: "Cancel Invite", style: "destructive", onPress: async () => {
        try {
          const res = await authFetch(`/api/groups/invites/${inviteId}/cancel`, { method: "POST" });
          const data = await res.json();
          if (!res.ok) { Alert.alert("Error", data.error ?? "Failed to cancel invite"); return; }
          onRefresh();
        } catch { Alert.alert("Error", "Network error"); }
      }},
    ]);
  };

  const handleRemove = async (targetId: string, username: string) => {
    Alert.alert("Remove Member", `Remove @${username} from the group?`, [
      { text: "Cancel", style: "cancel" },
      { text: "Remove", style: "destructive", onPress: async () => {
        try {
          const res = await authFetch(`/api/groups/${groupId}/members/${targetId}/remove`, { method: "POST" });
          const data = await res.json();
          if (!res.ok) { Alert.alert("Error", data.error ?? "Failed"); return; }
          onRefresh();
        } catch { Alert.alert("Error", "Network error"); }
      }},
    ]);
  };

  return (
    <View style={{ padding: 16, gap: 16 }}>
      {/* Admin invite card */}
      {isAdmin && (
        <TouchableOpacity onPress={onInvitePress} activeOpacity={0.8}>
          <LinearGradient colors={[theme.g1 + "20", theme.g2 + "10"]} style={[s.inviteCard, { borderColor: theme.g1 + "50" }]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}>
            <View style={[s.inviteIconBig, { backgroundColor: theme.g1 + "25", borderColor: theme.g1 + "50" }]}>
              <Feather name="user-plus" size={20} color={theme.g1} />
            </View>
            <View style={{ flex: 1, marginLeft: 14 }}>
              <Text style={{ color: T.white, fontWeight: "800", fontSize: 15 }}>Invite friends</Text>
              <Text style={{ color: T.secondary, fontSize: 12, marginTop: 2 }}>Add friends and crush your goals together!</Text>
            </View>
            <View style={[s.inviteSmallBtn, { backgroundColor: theme.g1 }]}>
              <Text style={{ color: "#FFF", fontWeight: "800", fontSize: 12 }}>Invite</Text>
            </View>
          </LinearGradient>
        </TouchableOpacity>
      )}

      {/* Active members */}
      <View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 10 }}>
          <Feather name="users" size={11} color={T.cyan} />
          <Text style={{ color: T.secondary, fontSize: 10, fontWeight: "700", letterSpacing: 1 }}>
            MEMBERS ({activeCount})
          </Text>
        </View>
        {members.map((m) => (
          <TouchableOpacity
            key={m.userId}
            onPress={() => onMemberPress({
              userId: m.userId,
              username: m.profile?.username ?? "Unknown",
              fullName: m.profile?.fullName ?? null,
              avatarUrl: m.profile?.avatarUrl ?? null,
              countryCode: m.profile?.countryCode ?? null,
              role: m.role,
              todaySteps: m.todaySteps,
              allTimeSteps: m.allTimeSteps,
              isCurrentUser: m.isCurrentUser,
            })}
            activeOpacity={0.8}
            style={[s.memberRow, {
              backgroundColor: m.isCurrentUser ? theme.g1 + "10" : T.card,
              borderColor: m.isCurrentUser ? theme.g1 + "40" : T.border,
            }]}
          >
            {m.role === "admin" ? (
              <View style={s.memberRankWrap}>
                <View style={[s.rankBadge, { backgroundColor: "rgba(255,200,61,0.15)", borderColor: "rgba(255,200,61,0.4)" }]}>
                  <Text style={{ fontSize: 14 }}>👑</Text>
                </View>
              </View>
            ) : (
              <View style={{ width: 40, marginRight: 4 }} />
            )}
            <AvatarCircle userId={m.userId} url={m.profile?.avatarUrl} username={m.profile?.username} color={theme.g1} size={38} />
            <View style={{ flex: 1, marginLeft: 10 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
                <Text style={{ color: T.white, fontWeight: "700", fontSize: 14 }} numberOfLines={1}>
                  {m.profile?.fullName ?? m.profile?.username ?? "Unknown"}
                </Text>
                {!!m.profile?.countryCode && <Text style={{ fontSize: 12 }}>{flag(m.profile.countryCode)}</Text>}
                {m.role === "admin" && <Tag label="ADMIN" color={T.gold} />}
                {m.isCurrentUser && <Tag label="YOU" color={theme.g1} />}
              </View>
              <Text style={{ color: T.muted, fontSize: 11 }}>@{m.profile?.username ?? "—"}</Text>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 4, marginTop: 2 }}>
                <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: T.green }} />
                <Text style={{ color: T.green, fontSize: 10 }}>Active</Text>
              </View>
            </View>
            {isAdmin && m.userId !== adminUserId ? (
              <TouchableOpacity
                onPress={(e) => { e.stopPropagation?.(); handleRemove(m.userId, m.profile?.username ?? "member"); }}
                style={s.threeDots}
                activeOpacity={0.7}
              >
                <Feather name="more-vertical" size={16} color={T.muted} />
              </TouchableOpacity>
            ) : null}
          </TouchableOpacity>
        ))}
      </View>

      {/* Pending invites */}
      {pendingGroupInvites.length > 0 && (
        <View>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 10 }}>
            <Feather name="clock" size={11} color={T.gold} />
            <Text style={{ color: T.secondary, fontSize: 10, fontWeight: "700", letterSpacing: 1 }}>
              PENDING INVITES ({pendingGroupInvites.length})
            </Text>
          </View>
          {pendingGroupInvites.map((inv) => (
            <View key={inv.id} style={[s.memberRow, { backgroundColor: T.card, borderColor: "rgba(255,200,61,0.2)" }]}>
              <View style={[s.rankBadge, { backgroundColor: "rgba(255,200,61,0.12)", borderColor: "rgba(255,200,61,0.3)", marginRight: 4 }]}>
                <Feather name="clock" size={12} color={T.gold} />
              </View>
              <View style={[s.memberAvatar, { backgroundColor: "rgba(255,200,61,0.12)", borderColor: "rgba(255,200,61,0.3)" }]}>
                <Text style={{ fontSize: 14, fontWeight: "700", color: T.gold }}>
                  {(inv.invitedProfile?.username?.[0] ?? "?").toUpperCase()}
                </Text>
              </View>
              <View style={{ flex: 1, marginLeft: 10 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
                  <Text style={{ color: T.white, fontWeight: "700", fontSize: 14 }} numberOfLines={1}>
                    {inv.invitedProfile?.fullName ?? inv.invitedProfile?.username ?? "Unknown"}
                  </Text>
                  {!!inv.invitedProfile?.countryCode && <Text style={{ fontSize: 12 }}>{flag(inv.invitedProfile.countryCode)}</Text>}
                  <Tag label="INVITED" color={T.gold} />
                </View>
                <Text style={{ color: T.muted, fontSize: 10 }}>Invited {timeAgo(inv.createdAt)}</Text>
              </View>
              {isAdmin && (
                <TouchableOpacity
                  onPress={() => handleCancelInvite(inv.id, inv.invitedProfile?.username ?? "user")}
                  style={[s.threeDots, { backgroundColor: "rgba(255,77,94,0.12)", borderRadius: 8, padding: 8 }]}
                  activeOpacity={0.7}
                >
                  <Feather name="x" size={15} color={T.red} />
                </TouchableOpacity>
              )}
            </View>
          ))}
        </View>
      )}

      {isAdmin && (
        <View style={s.adminNote}>
          <Feather name="shield" size={11} color={T.muted} />
          <Text style={{ color: T.muted, fontSize: 11, marginLeft: 6 }}>Only admins can remove members</Text>
        </View>
      )}
    </View>
  );
}

// ── History tab ───────────────────────────────────────────────────────────────
function HistoryTab({ history, goal, theme }: {
  history: DailyResult[];
  goal: number;
  theme: { g1: string; g2: string };
}) {
  if (!history.length) {
    return (
      <View style={s.emptyWrap}>
        <View style={s.emptyIcon}><Feather name="calendar" size={24} color={T.cyan} /></View>
        <Text style={s.emptyTitle}>No history yet</Text>
        <Text style={s.emptyText}>Daily results will appear after the first day ends.</Text>
      </View>
    );
  }
  return (
    <View style={{ padding: 16, gap: 8 }}>
      {history.map((day) => {
        const pct = goal > 0 ? Math.round((day.groupTotalSteps / goal) * 100) : 0;
        return (
          <View key={day.id} style={[s.historyRow, { backgroundColor: T.card, borderColor: day.goalCompleted ? T.green + "30" : T.border }]}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: T.white, fontWeight: "700", fontSize: 13 }}>{day.resultDate}</Text>
              <Text style={{ color: T.secondary, fontSize: 11, marginTop: 2 }}>{fmtInt(day.groupTotalSteps)} group steps</Text>
              <View style={[s.miniGoalBar, { backgroundColor: "rgba(255,255,255,0.06)", marginTop: 6 }]}>
                <LinearGradient
                  colors={day.goalCompleted ? [T.green, T.cyan] : [theme.g1, theme.g2]}
                  style={{ width: `${Math.min(100, pct)}%` as `${number}%`, height: 3, borderRadius: 2 }}
                  start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
                />
              </View>
            </View>
            {day.goalCompleted ? (
              <View style={[s.histBadge, { backgroundColor: T.green + "15", borderColor: T.green + "40" }]}>
                <Feather name="check-circle" size={11} color={T.green} />
                <Text style={{ color: T.green, fontSize: 11, fontWeight: "700", marginLeft: 4 }}>Goal Met</Text>
              </View>
            ) : (
              <View style={[s.histBadge, { backgroundColor: "rgba(255,255,255,0.05)", borderColor: T.border }]}>
                <Text style={{ color: T.secondary, fontSize: 11, fontWeight: "700" }}>{pct}%</Text>
              </View>
            )}
          </View>
        );
      })}
    </View>
  );
}

// ── Member profile modal ──────────────────────────────────────────────────────
function MemberProfileModal({ member, theme, onClose }: {
  member: SelectedMember;
  theme: { g1: string; g2: string; accent: string; glow: string };
  onClose: () => void;
}) {
  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <TouchableOpacity style={s.mpOverlay} activeOpacity={1} onPress={onClose}>
        <TouchableOpacity activeOpacity={1} onPress={() => {}}>
          <View style={s.mpSheet}>
            <LinearGradient colors={[theme.g1 + "15", theme.g2 + "08", "transparent"]} style={StyleSheet.absoluteFill} />
            <View style={s.mpHandle} />

            {/* Avatar */}
            <ModalAvatar userId={member.userId} username={member.username} url={member.avatarUrl} borderColor={theme.g1} />

            <Text style={s.mpName}>
              {member.fullName ?? member.username}
              {!!member.countryCode && `  ${flag(member.countryCode)}`}
            </Text>
            <Text style={s.mpUsername}>@{member.username}</Text>

            {/* Badges */}
            <View style={{ flexDirection: "row", justifyContent: "center", gap: 8, marginTop: 10, marginBottom: 16 }}>
              {member.role === "admin" && (
                <View style={[s.mpBadge, { backgroundColor: "rgba(255,200,61,0.15)", borderColor: "rgba(255,200,61,0.4)" }]}>
                  <Text style={{ color: T.gold, fontSize: 11, fontWeight: "700" }}>👑 Admin</Text>
                </View>
              )}
              {member.isCurrentUser && (
                <View style={[s.mpBadge, { backgroundColor: theme.g1 + "20", borderColor: theme.g1 + "50" }]}>
                  <Text style={{ color: theme.g1, fontSize: 11, fontWeight: "700" }}>✦ You</Text>
                </View>
              )}
            </View>

            {/* Stats */}
            <View style={s.mpStatsRow}>
              <View style={s.mpStatItem}>
                <Text style={[s.mpStatVal, { color: T.cyan }]}>{fmtN(member.todaySteps)}</Text>
                <Text style={s.mpStatLabel}>Today Steps</Text>
              </View>
              <View style={s.mpStatDivider} />
              <View style={s.mpStatItem}>
                <Text style={[s.mpStatVal, { color: T.purple }]}>{fmtN(member.allTimeSteps)}</Text>
                <Text style={s.mpStatLabel}>Group Total</Text>
              </View>
            </View>

            <TouchableOpacity onPress={onClose} style={s.mpCloseBtn} activeOpacity={0.8}>
              <Text style={s.mpCloseBtnText}>Close</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

// ── Invite member modal ───────────────────────────────────────────────────────
interface SearchUser { id: string; username: string; fullName: string | null; avatarUrl: string | null; avatarColor: string | null; countryFlag: string | null }

function InviteMemberModal({ groupId, theme, onClose, onInvited }: {
  groupId: string; theme: { g1: string; g2: string; glow: string };
  onClose: () => void; onInvited: () => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchUser[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<SearchUser | null>(null);
  const [sending, setSending] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const search = useCallback(async (q: string) => {
    if (q.trim().length < 2) { setResults([]); setSearching(false); return; }
    setSearching(true);
    try {
      const res = await authFetch(`/api/users/search?query=${encodeURIComponent(q.trim())}`);
      const data = await res.json();
      setResults(data.users ?? []);
    } catch { setResults([]); }
    finally { setSearching(false); }
  }, []);

  const onChangeText = (text: string) => {
    setQuery(text);
    setSelected(null);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => search(text), 280);
  };

  const onSelect = (u: SearchUser) => {
    setSelected(u);
    setQuery(u.username);
    setResults([]);
  };

  const handleInvite = async () => {
    const name = selected?.username ?? query.trim();
    if (!name) { Alert.alert("Required", "Enter or select a username"); return; }
    setSending(true);
    try {
      const res = await authFetch(`/api/groups/${groupId}/invite`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: name }),
      });
      const data = await res.json();
      if (!res.ok) { Alert.alert("Error", data.error ?? "Failed to send invite"); return; }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert("Invite Sent", `An invite was sent to @${name}`);
      onInvited();
    } catch { Alert.alert("Error", "Network error"); }
    finally { setSending(false); }
  };

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={[s.modalRoot, { backgroundColor: T.bg }]}>
        <View style={[s.modalHeader, { borderBottomColor: T.border }]}>
          <Feather name="user-plus" size={20} color={T.cyan} />
          <Text style={[s.modalTitle, { color: T.white, marginLeft: 10 }]}>Invite Member</Text>
          <TouchableOpacity onPress={onClose} style={{ marginLeft: "auto" }} activeOpacity={0.7}>
            <Feather name="x" size={22} color={T.secondary} />
          </TouchableOpacity>
        </View>

        <View style={{ padding: 20 }}>
          <Text style={{ color: T.secondary, fontSize: 12, fontWeight: "700", marginBottom: 10, textTransform: "uppercase", letterSpacing: 0.5 }}>Search Username</Text>

          {/* Input + spinner row */}
          <View style={{ position: "relative" }}>
            <TextInput
              value={query}
              onChangeText={onChangeText}
              placeholder="Type a username…"
              placeholderTextColor={T.muted}
              autoCapitalize="none"
              autoCorrect={false}
              style={[s.textInput, {
                backgroundColor: T.card,
                borderColor: selected ? theme.g1 + "80" : T.border,
                color: T.white,
                paddingRight: 40,
              }]}
            />
            <View style={{ position: "absolute", right: 12, top: 0, bottom: 0, justifyContent: "center" }}>
              {searching
                ? <ActivityIndicator size="small" color={T.muted} />
                : selected
                  ? <Feather name="check-circle" size={16} color={theme.g1} />
                  : query.length >= 2
                    ? <Feather name="search" size={15} color={T.muted} />
                    : null}
            </View>
          </View>

          {/* Dropdown results */}
          {results.length > 0 && (
            <View style={{
              backgroundColor: T.bg2,
              borderWidth: 1, borderColor: T.border, borderRadius: 12,
              marginTop: 4, overflow: "hidden", maxHeight: 260,
            }}>
              <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
                {results.map((u, idx) => (
                  <TouchableOpacity
                    key={u.id}
                    onPress={() => onSelect(u)}
                    activeOpacity={0.75}
                    style={{
                      flexDirection: "row", alignItems: "center", padding: 12,
                      borderBottomWidth: idx < results.length - 1 ? 1 : 0,
                      borderBottomColor: "rgba(255,255,255,0.06)",
                    }}
                  >
                    {/* Avatar */}
                    <View style={{
                      width: 36, height: 36, borderRadius: 18,
                      backgroundColor: u.avatarColor ?? avatarBg(u.username),
                      alignItems: "center", justifyContent: "center",
                      overflow: "hidden", marginRight: 10,
                    }}>
                      {u.avatarUrl ? (
                        <Image source={{ uri: `${getApiBase()}/api/profile/avatar/${u.id}` }} style={{ width: 36, height: 36 }} />
                      ) : (
                        <Text style={{ color: "#fff", fontWeight: "800", fontSize: 15 }}>
                          {(u.username[0] ?? "?").toUpperCase()}
                        </Text>
                      )}
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: T.white, fontWeight: "700", fontSize: 14 }} numberOfLines={1}>
                        {u.fullName ?? u.username}
                        {u.countryFlag ? `  ${u.countryFlag}` : ""}
                      </Text>
                      <Text style={{ color: T.muted, fontSize: 11 }}>@{u.username}</Text>
                    </View>
                    <Feather name="chevron-right" size={14} color={T.muted} />
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
          )}

          {/* No results hint */}
          {!searching && query.trim().length >= 2 && results.length === 0 && !selected && (
            <Text style={{ color: T.muted, fontSize: 12, marginTop: 8 }}>No users found for "{query}"</Text>
          )}

          <Text style={{ color: T.muted, fontSize: 12, marginTop: 12 }}>
            They'll receive a notification and must accept the invite.
          </Text>

          <TouchableOpacity onPress={handleInvite} disabled={sending || (!selected && query.trim().length < 2)} activeOpacity={0.82} style={{ marginTop: 24 }}>
            <LinearGradient
              colors={[T.cyan, T.purple]}
              style={[s.ctaBtn, { opacity: sending || (!selected && query.trim().length < 2) ? 0.5 : 1 }]}
              start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
            >
              {sending ? <ActivityIndicator color="#FFF" size="small" /> : <Text style={{ color: "#FFF", fontWeight: "800", fontSize: 16 }}>Send Invite</Text>}
            </LinearGradient>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

// ── Edit group modal ──────────────────────────────────────────────────────────
function EditGroupModal({ group, theme, onClose, onUpdated, onDeleted }: {
  group: Group; theme: { g1: string; g2: string; glow: string };
  onClose: () => void; onUpdated: () => void; onDeleted: () => void;
}) {
  const [groupName, setGroupName] = useState(group.groupName);
  const [goal, setGoal] = useState(group.dailyGoalSteps);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [imageUri, setImageUri] = useState<string | null>(
    group.groupImageUrl ? `${getApiBase()}/api/groups/${group.id}/image` : null,
  );
  const GOALS = [5000, 7500, 10000, 15000, 20000, 25000, 30000];

  const handlePickImage = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert("Permission Required", "Please allow photo library access to upload a group picture.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: "images",
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.8,
    });
    if (result.canceled || !result.assets?.[0]) return;

    const asset = result.assets[0];
    const uri = asset.uri;
    const mimeType = asset.mimeType ?? "image/jpeg";
    const ext = mimeType.split("/")[1] ?? "jpg";

    setUploading(true);
    try {
      const { session } = await getStoredSession();
      if (!session) return;

      const formData = new FormData();
      if (Platform.OS === "web") {
        const blobRes = await fetch(uri);
        const blob = await blobRes.blob();
        formData.append("image", blob, `group-image.${ext}`);
      } else {
        formData.append("image", { uri, name: `group-image.${ext}`, type: mimeType } as unknown as Blob);
      }

      const url = `${getApiBase()}/api/groups/${group.id}/image`;
      const json: Record<string, unknown> = await (Platform.OS === "web"
        ? fetch(url, { method: "POST", headers: { Authorization: `Bearer ${session}` }, body: formData }).then((r) => r.json())
        : new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open("POST", url);
            xhr.setRequestHeader("Authorization", `Bearer ${session}`);
            xhr.onload = () => { try { resolve(JSON.parse(xhr.responseText)); } catch { reject(new Error("Bad response")); } };
            xhr.onerror = () => reject(new Error("Network error"));
            xhr.send(formData);
          }));

      if (json.success) {
        setImageUri(`${getApiBase()}${json.displayUrl as string}?t=${Date.now()}`);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } else {
        Alert.alert("Upload Failed", "Could not save the group photo. Please try again.");
      }
    } catch {
      Alert.alert("Upload Failed", "Network error. Please try again.");
    } finally {
      setUploading(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await authFetch(`/api/groups/${group.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ groupName: groupName.trim(), dailyGoalSteps: goal }),
      });
      const data = await res.json();
      if (!res.ok) { Alert.alert("Error", data.error ?? "Failed to update group"); return; }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onUpdated();
    } catch { Alert.alert("Error", "Network error"); }
    finally { setSaving(false); }
  };

  const handleDelete = () => {
    Alert.alert(
      "Delete Group",
      `Permanently delete "${group.groupName}"? All members will be removed and this cannot be undone.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete", style: "destructive",
          onPress: async () => {
            setDeleting(true);
            try {
              const res = await authFetch(`/api/groups/${group.id}`, { method: "DELETE" });
              const data = await res.json();
              if (!res.ok) { Alert.alert("Error", data.error ?? "Failed to delete group"); return; }
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              onDeleted();
            } catch { Alert.alert("Error", "Network error"); }
            finally { setDeleting(false); }
          },
        },
      ],
    );
  };

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={[s.modalRoot, { backgroundColor: T.bg }]}>
        <View style={[s.modalHeader, { borderBottomColor: T.border }]}>
          <Feather name="settings" size={20} color={T.cyan} />
          <Text style={[s.modalTitle, { color: T.white, marginLeft: 10 }]}>Edit Group</Text>
          <TouchableOpacity onPress={onClose} style={{ marginLeft: "auto" }} activeOpacity={0.7}>
            <Feather name="x" size={22} color={T.secondary} />
          </TouchableOpacity>
        </View>
        <ScrollView contentContainerStyle={{ padding: 20 }}>

          {/* ── Group photo ── */}
          <Text style={{ color: T.secondary, fontSize: 12, fontWeight: "700", marginBottom: 12, textTransform: "uppercase", letterSpacing: 0.5 }}>Group Photo</Text>
          <TouchableOpacity onPress={handlePickImage} disabled={uploading} activeOpacity={0.8} style={{ alignSelf: "center", marginBottom: 24 }}>
            <View style={{
              width: 90, height: 90, borderRadius: 45, overflow: "hidden",
              borderWidth: 2.5, borderColor: uploading ? T.muted : theme.g1,
            }}>
              {imageUri ? (
                <Image source={{ uri: imageUri }} style={{ width: 90, height: 90 }} />
              ) : (
                <LinearGradient
                  colors={[theme.g1 + "40", theme.g2 + "25"]}
                  style={{ width: 90, height: 90, alignItems: "center", justifyContent: "center" }}
                  start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
                >
                  <Feather name="users" size={34} color={theme.g1} />
                </LinearGradient>
              )}
            </View>
            {/* Camera overlay */}
            <View style={{
              position: "absolute", bottom: 0, right: 0,
              width: 30, height: 30, borderRadius: 15,
              backgroundColor: uploading ? T.muted : theme.g1,
              alignItems: "center", justifyContent: "center",
              borderWidth: 2, borderColor: T.bg,
            }}>
              {uploading
                ? <ActivityIndicator size="small" color="#FFF" />
                : <Feather name="camera" size={14} color="#FFF" />
              }
            </View>
          </TouchableOpacity>
          <Text style={{ color: T.muted, fontSize: 12, textAlign: "center", marginTop: -18, marginBottom: 20 }}>
            {uploading ? "Uploading…" : "Tap to change photo"}
          </Text>

          {/* ── Group name ── */}
          <Text style={{ color: T.secondary, fontSize: 12, fontWeight: "700", marginBottom: 8, textTransform: "uppercase", letterSpacing: 0.5 }}>Group Name</Text>
          <TextInput
            value={groupName} onChangeText={setGroupName} maxLength={60}
            style={[s.textInput, { backgroundColor: T.card, borderColor: T.border, color: T.white }]}
          />

          {/* ── Daily goal ── */}
          <Text style={{ color: T.secondary, fontSize: 12, fontWeight: "700", marginBottom: 8, marginTop: 20, textTransform: "uppercase", letterSpacing: 0.5 }}>Daily Group Goal</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {GOALS.map((g) => (
              <TouchableOpacity
                key={g}
                onPress={() => setGoal(g)}
                style={[s.goalChip, { borderColor: goal === g ? T.cyan : T.border, backgroundColor: goal === g ? T.cyan + "18" : T.card }]}
                activeOpacity={0.75}
              >
                <Text style={{ color: goal === g ? T.cyan : T.secondary, fontWeight: "700", fontSize: 13 }}>{(g / 1000).toFixed(0)}k</Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* ── Save ── */}
          <TouchableOpacity onPress={handleSave} disabled={saving || uploading} activeOpacity={0.82} style={{ marginTop: 30 }}>
            <LinearGradient
              colors={[T.cyan, T.purple]}
              style={[s.ctaBtn, { opacity: saving || uploading ? 0.6 : 1 }]}
              start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
            >
              {saving ? <ActivityIndicator color="#FFF" size="small" /> : <Text style={{ color: "#FFF", fontWeight: "800", fontSize: 16 }}>Save Changes</Text>}
            </LinearGradient>
          </TouchableOpacity>

          {/* ── Delete group ── */}
          <View style={{ height: 1, backgroundColor: T.border, marginVertical: 28 }} />
          <Text style={{ color: T.muted, fontSize: 12, marginBottom: 12, textAlign: "center" }}>
            Deleting the group is permanent and cannot be undone.
          </Text>
          <TouchableOpacity onPress={handleDelete} disabled={deleting} activeOpacity={0.82}>
            <View style={[s.ctaBtn, { backgroundColor: T.red + "20", borderWidth: 1, borderColor: T.red + "60", opacity: deleting ? 0.6 : 1 }]}>
              {deleting
                ? <ActivityIndicator color={T.red} size="small" />
                : (
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                    <Feather name="trash-2" size={17} color={T.red} />
                    <Text style={{ color: T.red, fontWeight: "800", fontSize: 16 }}>Delete Group</Text>
                  </View>
                )}
            </View>
          </TouchableOpacity>
          <View style={{ height: 20 }} />
        </ScrollView>
      </View>
    </Modal>
  );
}

// ── Leave modal ───────────────────────────────────────────────────────────────
function LeaveModal({ groupName, groupId, isAdmin, otherMembers, theme, onClose, onLeft }: {
  groupName: string; groupId: string; isAdmin: boolean;
  otherMembers: MemberEntry[];
  theme: { g1: string; g2: string };
  onClose: () => void; onLeft: () => void;
}) {
  const [leaving, setLeaving] = useState(false);
  const [selectedNewAdmin, setSelectedNewAdmin] = useState<string | null>(null);

  const needsTransfer = isAdmin && otherMembers.length > 0;
  const isLastMember = isAdmin && otherMembers.length === 0;
  const canLeave = !needsTransfer || !!selectedNewAdmin;

  const handleLeave = async () => {
    if (!canLeave) return;
    setLeaving(true);
    try {
      const body: Record<string, string> = {};
      if (needsTransfer && selectedNewAdmin) body.newAdminId = selectedNewAdmin;
      const res = await authFetch(`/api/groups/${groupId}/leave`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) { Alert.alert("Error", data.message ?? data.error ?? "Failed to leave group"); return; }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onLeft();
    } catch { Alert.alert("Error", "Network error"); }
    finally { setLeaving(false); }
  };

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={[s.modalRoot, { backgroundColor: T.bg }]}>
        {/* ── Header ── */}
        <View style={[s.modalHeader, { borderBottomColor: T.border }]}>
          <Feather name="log-out" size={20} color={T.red} />
          <Text style={[s.modalTitle, { color: T.white, marginLeft: 10 }]}>Leave Group</Text>
          <TouchableOpacity onPress={onClose} style={{ marginLeft: "auto" }} activeOpacity={0.7}>
            <Feather name="x" size={22} color={T.secondary} />
          </TouchableOpacity>
        </View>

        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ padding: 24, paddingBottom: 48 }}
          showsVerticalScrollIndicator={false}
        >
          {/* ── Confirmation text ── */}
          <Text style={{ color: T.secondary, fontSize: 15, lineHeight: 22 }}>
            Are you sure you want to leave{" "}
            <Text style={{ color: T.white, fontWeight: "700" }}>{groupName}</Text>?
          </Text>

          {/* ── Transfer required notice ── */}
          {needsTransfer && (
            <View style={{
              backgroundColor: "rgba(239,68,68,0.10)", borderColor: "rgba(239,68,68,0.35)",
              borderWidth: 1, borderRadius: 14, padding: 14, marginTop: 16,
            }}>
              <Text style={{ color: "#FF6B6B", fontSize: 13, lineHeight: 20 }}>
                👑  You're the admin. Choose a member below to hand over admin rights before you leave.
              </Text>
            </View>
          )}

          {/* ── Last member notice ── */}
          {isLastMember && (
            <View style={{
              backgroundColor: T.gold + "18", borderColor: T.gold + "45",
              borderWidth: 1, borderRadius: 14, padding: 14, marginTop: 16,
            }}>
              <Text style={{ color: T.gold, fontSize: 13, lineHeight: 20 }}>
                ⚠️  You are the only member. Leaving will permanently archive this group.
              </Text>
            </View>
          )}

          {/* ── Member picker (transfer required) ── */}
          {needsTransfer && (
            <>
              <Text style={{
                color: T.secondary, fontSize: 11, fontWeight: "700",
                textTransform: "uppercase", letterSpacing: 1.1,
                marginTop: 24, marginBottom: 10,
              }}>
                Select New Admin
              </Text>

              {otherMembers.map((member) => {
                const isSelected = selectedNewAdmin === member.userId;
                const uname = member.profile?.username ?? "Unknown";
                return (
                  <TouchableOpacity
                    key={member.userId}
                    onPress={() => setSelectedNewAdmin(member.userId)}
                    activeOpacity={0.78}
                    style={{
                      flexDirection: "row", alignItems: "center", gap: 12,
                      padding: 14, borderRadius: 14, marginBottom: 8,
                      backgroundColor: isSelected ? theme.g1 + "18" : "rgba(255,255,255,0.04)",
                      borderWidth: 1.5,
                      borderColor: isSelected ? theme.g1 + "70" : "rgba(255,255,255,0.08)",
                    }}
                  >
                    <AvatarCircle
                      userId={member.userId}
                      url={member.profile?.avatarUrl}
                      username={uname}
                      color={theme.g1}
                      size={40}
                    />
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: T.white, fontWeight: "700", fontSize: 14 }}>{uname}</Text>
                      {member.profile?.fullName ? (
                        <Text style={{ color: T.muted, fontSize: 12, marginTop: 1 }}>{member.profile.fullName}</Text>
                      ) : null}
                      <Text style={{ color: T.muted, fontSize: 11, marginTop: 2 }}>
                        {fmtN(member.allTimeSteps)} total steps
                      </Text>
                    </View>
                    {/* Radio circle */}
                    <View style={{
                      width: 24, height: 24, borderRadius: 12,
                      borderWidth: 2,
                      borderColor: isSelected ? theme.g1 : "rgba(255,255,255,0.22)",
                      backgroundColor: isSelected ? theme.g1 : "transparent",
                      alignItems: "center", justifyContent: "center",
                    }}>
                      {isSelected && <Feather name="check" size={12} color="#fff" />}
                    </View>
                  </TouchableOpacity>
                );
              })}
            </>
          )}

          {/* ── Action buttons ── */}
          <TouchableOpacity
            onPress={handleLeave}
            disabled={leaving || !canLeave}
            style={{ marginTop: 28 }}
            activeOpacity={0.82}
          >
            <View style={[s.ctaBtn, {
              backgroundColor: canLeave ? T.red : T.red + "50",
            }]}>
              {leaving
                ? <ActivityIndicator color="#FFF" size="small" />
                : <Text style={{ color: "#FFF", fontWeight: "800", fontSize: 16 }}>
                    {needsTransfer ? "Transfer Admin & Leave" : "Leave Group"}
                  </Text>
              }
            </View>
          </TouchableOpacity>

          <TouchableOpacity onPress={onClose} style={{ marginTop: 14 }} activeOpacity={0.8}>
            <Text style={{ color: T.secondary, fontWeight: "700", fontSize: 14, textAlign: "center" }}>Cancel</Text>
          </TouchableOpacity>
        </ScrollView>
      </View>
    </Modal>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  root: { flex: 1 },
  loadingWrap: { flex: 1, alignItems: "center", justifyContent: "center" },

  heroGrad: { paddingBottom: 0 },
  heroPadding: { paddingHorizontal: 16, paddingBottom: 16 },
  topBar: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 12 },
  topBarBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: "rgba(255,255,255,0.10)", borderWidth: 1, borderColor: T.border,
    alignItems: "center", justifyContent: "center",
  },
  topBarTitle: { flexShrink: 1, color: T.white, fontSize: 17, fontWeight: "800", letterSpacing: -0.3 },

  typeBadge: {
    alignSelf: "flex-start", flexDirection: "row", alignItems: "center",
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, borderWidth: 1, marginBottom: 14,
  },

  todayHeroRow: { flexDirection: "row", alignItems: "center", gap: 14 },
  todayStatCol: { flex: 1, gap: 8 },
  statCard: {
    borderRadius: 12, padding: 10, borderWidth: 1,
    backgroundColor: "rgba(255,255,255,0.05)",
    alignItems: "center",
  },
  overallHeroCol: { alignItems: "center", gap: 10 },
  overallMetaRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", justifyContent: "center" },
  membersHero: { flexDirection: "row", alignItems: "center", borderRadius: 14, padding: 14, borderWidth: 1, backgroundColor: "rgba(255,255,255,0.04)" },
  membersHeroIcon: { width: 48, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center", borderWidth: 1 },
  miniGoalBar: { height: 4, borderRadius: 2, overflow: "hidden" },

  heroActions: { flexDirection: "row", gap: 10, marginTop: 14 },
  inviteBtn: { flex: 1, borderRadius: 12, borderWidth: 1, borderColor: T.cyan + "40", overflow: "hidden" },
  inviteBtnInner: { flexDirection: "row", alignItems: "center", justifyContent: "center", paddingVertical: 12 },
  leaveBtn: {
    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center",
    paddingVertical: 12, borderRadius: 12, borderWidth: 1,
    borderColor: T.red + "45", backgroundColor: T.red + "10",
  },

  tabBar: {
    flexDirection: "row", paddingHorizontal: 12, paddingVertical: 8, gap: 6,
    backgroundColor: "rgba(10,14,30,0.95)",
    borderBottomWidth: 1, borderBottomColor: T.border,
  },
  tabItem: { flex: 1, alignItems: "center" },
  tabActiveChip: { flexDirection: "row", alignItems: "center", justifyContent: "center", paddingVertical: 7, paddingHorizontal: 6, borderRadius: 10, width: "100%" },
  tabInactiveChip: { flexDirection: "row", alignItems: "center", justifyContent: "center", paddingVertical: 7, paddingHorizontal: 6, borderRadius: 10, width: "100%", backgroundColor: "rgba(255,255,255,0.04)" },

  insightCard: {
    borderRadius: 14, padding: 14, borderWidth: 1,
    backgroundColor: T.card, overflow: "hidden",
  },
  lbRow: {
    flexDirection: "row", alignItems: "center",
    borderRadius: 14, padding: 12, borderWidth: 1, gap: 8, marginBottom: 6,
  },
  rankBadge: {
    width: 36, height: 36, borderRadius: 10,
    alignItems: "center", justifyContent: "center", borderWidth: 1,
  },
  statMini: {
    width: (SCREEN_W - 48) / 2, borderRadius: 14, padding: 14,
    borderWidth: 1, backgroundColor: T.card, overflow: "hidden",
  },
  momentumCard: { borderRadius: 14, padding: 16, borderWidth: 1, backgroundColor: T.card, overflow: "hidden" },
  emptyWrap: { alignItems: "center", paddingVertical: 48, gap: 10, paddingHorizontal: 16 },
  emptyIcon: {
    width: 56, height: 56, borderRadius: 28, borderWidth: 1,
    borderColor: T.border, backgroundColor: "rgba(0,216,255,0.08)",
    alignItems: "center", justifyContent: "center", marginBottom: 4,
  },
  emptyTitle: { color: T.secondary, fontSize: 15, fontWeight: "700" },
  emptyText: { color: T.muted, fontSize: 13, textAlign: "center", lineHeight: 20 },

  inviteCard: { flexDirection: "row", alignItems: "center", borderRadius: 14, borderWidth: 1.5, borderStyle: "dashed", padding: 16, overflow: "hidden" },
  inviteIconBig: { width: 46, height: 46, borderRadius: 23, alignItems: "center", justifyContent: "center", borderWidth: 1 },
  inviteSmallBtn: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 20 },
  memberRow: { flexDirection: "row", alignItems: "center", borderRadius: 14, padding: 12, borderWidth: 1, marginBottom: 8 },
  memberRankWrap: { width: 44, marginRight: 0, alignItems: "center" },
  memberAvatar: { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center", borderWidth: 1 },
  threeDots: { padding: 6 },
  emptySlot: { width: 76, height: 76, borderRadius: 12, borderWidth: 1, borderStyle: "dashed", alignItems: "center", justifyContent: "center" },
  adminNote: { flexDirection: "row", alignItems: "center", justifyContent: "center", paddingTop: 6 },
  historyRow: { flexDirection: "row", alignItems: "center", borderRadius: 12, padding: 14, borderWidth: 1 },
  histBadge: { flexDirection: "row", alignItems: "center", paddingHorizontal: 10, paddingVertical: 7, borderRadius: 8, borderWidth: 1 },

  modalRoot: { flex: 1 },
  modalHeader: { flexDirection: "row", alignItems: "center", padding: 20, borderBottomWidth: StyleSheet.hairlineWidth },
  modalTitle: { fontSize: 17, fontWeight: "800" },
  textInput: { borderWidth: 1.5, borderRadius: 12, padding: 14, fontSize: 16, fontWeight: "600" },
  goalChip: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 10, borderWidth: 1.5 },
  ctaBtn: { padding: 17, borderRadius: 14, alignItems: "center" },

  mpOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.80)", justifyContent: "flex-end" },
  mpSheet: {
    backgroundColor: "#0D1225", borderTopLeftRadius: 28, borderTopRightRadius: 28,
    padding: 24, paddingBottom: 40, borderWidth: 1, borderColor: T.border, overflow: "hidden",
  },
  mpHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: T.border, alignSelf: "center", marginBottom: 20 },
  mpAvatar: { width: 72, height: 72, borderRadius: 36, borderWidth: 2.5, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  mpName: { fontSize: 20, fontWeight: "800", color: T.white, textAlign: "center", marginTop: 8 },
  mpUsername: { fontSize: 13, color: T.muted, textAlign: "center", marginTop: 4 },
  mpBadge: { paddingHorizontal: 12, paddingVertical: 5, borderRadius: 8, borderWidth: 1 },
  mpStatsRow: { flexDirection: "row", alignItems: "center", backgroundColor: "rgba(0,0,0,0.3)", borderRadius: 14, padding: 16, marginBottom: 20, borderWidth: 1, borderColor: T.border },
  mpStatItem: { flex: 1, alignItems: "center" },
  mpStatVal: { fontSize: 22, fontWeight: "800" },
  mpStatLabel: { fontSize: 11, color: T.muted, marginTop: 4 },
  mpStatDivider: { width: 1, height: 36, backgroundColor: T.border },
  mpCloseBtn: { backgroundColor: "rgba(255,255,255,0.08)", borderRadius: 12, padding: 14, alignItems: "center", borderWidth: 1, borderColor: T.border },
  mpCloseBtnText: { color: T.white, fontWeight: "700", fontSize: 15 },
});
