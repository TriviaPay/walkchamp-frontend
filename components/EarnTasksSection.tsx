import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  TouchableOpacity,
  Animated,
  Image,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { getValidSession } from "@/services/authService";
import { getApiBase } from "@/utils/apiUrl";
import { getLocalDateStr } from "@/utils/timezone";
import CoinIcon from "@/components/CoinIcon";
import { useColors } from "@/hooks/useColors";
import { SkeletonEarnTaskCard } from "@/components/SkeletonRows";

const blueShoe = require("../assets/images/blue-shoe.png") as number;

// ── Types ─────────────────────────────────────────────────────────────────────
type TaskStatus = "available" | "in_progress" | "claimed";
type Difficulty = "easy" | "medium" | "hard" | "very_hard";

interface EarnTask {
  task_id: string;
  icon: string;
  title: string;
  description: string;
  reward_coins: number | null;
  reward_text: string | null;
  status: TaskStatus;
  progress: string | null;
  progress_pct: number | null;
}

interface TaskGroup {
  difficulty: Difficulty;
  title: string;
  badge: string;
  description: string;
  tasks: EarnTask[];
}

interface EarnTasksResponse {
  success: boolean;
  coin_balance: number;
  groups: TaskGroup[];
}

// ── Difficulty config ─────────────────────────────────────────────────────────
const DIFF_CONFIG: Record<Difficulty, { accent: string; badgeBg: string; icon: string }> = {
  easy:      { accent: "#22C55E", badgeBg: "#14532D", icon: "zap" },
  medium:    { accent: "#3B82F6", badgeBg: "#1E3A5F", icon: "trending-up" },
  hard:      { accent: "#F59E0B", badgeBg: "#78350F", icon: "award" },
  very_hard: { accent: "#A855F7", badgeBg: "#4C1D95", icon: "star" },
};

// Task IDs that use the blue shoe image instead of an emoji
const SHOE_TASKS = new Set(["walk_any_steps_today", "walk_20k"]);

// ── Task row ─────────────────────────────────────────────────────────────────
function TaskRow({ task, accent, isLast }: { task: EarnTask; accent: string; isLast: boolean }) {
  const colors = useColors();
  const isClaimed  = task.status === "claimed";
  const isProgress = task.status === "in_progress";
  const isCompound = !!task.reward_text;

  // progress bar fill: use progress_pct (0-100) from the server, clamped
  const fillPct = Math.min(100, Math.max(0, task.progress_pct ?? 0));

  return (
    <View style={[
      row.wrap,
      { borderBottomColor: colors.border },
      isLast && row.wrapLast,
      isClaimed && row.wrapClaimed,
    ]}>
      {/* Icon — blue shoe PNG for walk tasks, emoji for everything else */}
      {SHOE_TASKS.has(task.task_id) ? (
        <Image source={blueShoe} style={row.shoeImg} resizeMode="contain" />
      ) : (
        <Text style={row.icon}>{task.icon}</Text>
      )}

      {/* Title + desc + progress */}
      <View style={row.mid}>
        <Text
          style={[row.title, { color: isClaimed ? "#6B7280" : colors.foreground }]}
          numberOfLines={1}
        >
          {task.title}
        </Text>
        <Text style={[row.desc, { color: colors.mutedForeground }]} numberOfLines={2}>{task.description}</Text>

        {isProgress && task.progress && (
          <View style={row.progressRow}>
            <View style={[row.progressBar, { backgroundColor: accent + "25" }]}>
              <View style={[row.progressFill, { backgroundColor: accent, width: `${fillPct}%` as `${number}%` }]} />
            </View>
            <Text style={[row.progressTxt, { color: accent }]}>{task.progress}</Text>
          </View>
        )}

        {isCompound && !isClaimed && (
          <View style={row.compoundRow}>
            {task.reward_text!.split(" • ").map((part, i) => (
              <View key={i} style={row.compoundPart}>
                <Text style={[row.compoundTxt, { color: accent }]}>{part}</Text>
                <CoinIcon size="xs" />
              </View>
            ))}
          </View>
        )}
      </View>

      {/* Right: reward or claimed */}
      <View style={row.right}>
        {isClaimed ? (
          <View style={[row.claimedBadge, { backgroundColor: "#22C55E20", borderColor: "#22C55E50" }]}>
            <Feather name="check" size={11} color="#22C55E" />
            <Text style={row.claimedTxt}>Claimed</Text>
          </View>
        ) : isCompound ? (
          <Feather name="chevron-right" size={14} color="#6B7280" style={{ marginTop: 2 }} />
        ) : (
          <View style={row.rewardRow}>
            <Text style={[row.rewardNum, { color: accent }]}>
              +{task.reward_coins?.toLocaleString()}
            </Text>
            <CoinIcon size="xs" />
          </View>
        )}
      </View>
    </View>
  );
}

const row = StyleSheet.create({
  wrap:         { flexDirection: "row", alignItems: "flex-start", paddingHorizontal: 14, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, gap: 10 },
  wrapLast:     { borderBottomWidth: 0 },
  wrapClaimed:  { opacity: 0.65 },
  icon:         { fontSize: 20, width: 28, textAlign: "center", marginTop: 1 },
  shoeImg:      { width: 28, height: 28, marginTop: 1 },
  mid:          { flex: 1, gap: 2 },
  title:        { fontSize: 13, fontWeight: "700" },
  desc:         { fontSize: 11, color: "#6B7280", lineHeight: 15 },
  progressRow:  { gap: 4, marginTop: 4 },
  progressBar:  { height: 3, borderRadius: 2, overflow: "hidden" },
  progressFill: { height: "100%", borderRadius: 2 },
  progressTxt:  { fontSize: 10, fontWeight: "700" },
  compoundRow:  { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 4 },
  compoundPart: { flexDirection: "row", alignItems: "center", gap: 2 },
  compoundTxt:  { fontSize: 10, fontWeight: "700" },
  right:        { alignItems: "flex-end", paddingTop: 2 },
  rewardRow:    { flexDirection: "row", alignItems: "center", gap: 3 },
  rewardNum:    { fontSize: 14, fontWeight: "900" },
  claimedBadge: { flexDirection: "row", alignItems: "center", gap: 3, backgroundColor: "#14532D", paddingHorizontal: 7, paddingVertical: 3, borderRadius: 8 },
  claimedTxt:   { fontSize: 10, fontWeight: "700", color: "#22C55E" },
});

// ── Group card ────────────────────────────────────────────────────────────────
function GroupCard({ group, defaultExpanded }: { group: TaskGroup; defaultExpanded: boolean }) {
  const colors = useColors();
  const cfg = DIFF_CONFIG[group.difficulty];
  const [expanded, setExpanded] = useState(defaultExpanded);
  const anim = useRef(new Animated.Value(defaultExpanded ? 1 : 0)).current;

  const toggle = () => {
    const toVal = expanded ? 0 : 1;
    setExpanded(!expanded);
    Animated.timing(anim, { toValue: toVal, duration: 200, useNativeDriver: false }).start();
  };

  const claimedCount = group.tasks.filter(t => t.status === "claimed").length;
  const total = group.tasks.length;

  return (
    <View style={[card.wrap, { borderColor: cfg.accent + "30", backgroundColor: colors.card }]}>
      {/* Header */}
      <TouchableOpacity style={card.header} onPress={toggle} activeOpacity={0.8}>
        <View style={[card.badge, { backgroundColor: cfg.accent + "22" }]}>
          <Text style={[card.badgeTxt, { color: cfg.accent }]}>{group.badge}</Text>
        </View>
        <View style={card.headerMid}>
          <Text style={[card.title, { color: colors.foreground }]}>{group.title}</Text>
          <Text style={[card.desc, { color: colors.mutedForeground }]}>{group.description}</Text>
        </View>
        <View style={card.headerRight}>
          <Text style={[card.progress, { color: cfg.accent }]}>{claimedCount}/{total}</Text>
          <Feather
            name={expanded ? "chevron-up" : "chevron-down"}
            size={16}
            color={cfg.accent}
          />
        </View>
      </TouchableOpacity>

      {/* Tasks */}
      {expanded && (
        <View style={[card.tasks, { borderTopColor: cfg.accent + "20" }]}>
          {group.tasks.map((task, i) => (
            <TaskRow
              key={task.task_id}
              task={task}
              accent={cfg.accent}
              isLast={i === group.tasks.length - 1}
            />
          ))}
        </View>
      )}
    </View>
  );
}

const card = StyleSheet.create({
  wrap:       { borderRadius: 14, borderWidth: 1, overflow: "hidden", marginBottom: 12 },
  header:     { flexDirection: "row", alignItems: "center", gap: 10, padding: 14 },
  badge:      { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, flexShrink: 0 },
  badgeTxt:   { fontSize: 9, fontWeight: "900", letterSpacing: 0.8 },
  headerMid:  { flex: 1, gap: 2 },
  title:      { fontSize: 14, fontWeight: "800" },
  desc:       { fontSize: 11, color: "#6B7280", lineHeight: 15 },
  headerRight:{ alignItems: "flex-end", gap: 4 },
  progress:   { fontSize: 11, fontWeight: "700" },
  tasks:      { borderTopWidth: 1 },
});

// ── Main export ───────────────────────────────────────────────────────────────
interface Props { visible: boolean }

export default function EarnTasksSection({ visible }: Props) {
  const colors = useColors();
  const [groups, setGroups] = useState<TaskGroup[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError]   = useState(false);

  const fetchTasks = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const session = await getValidSession();
      if (!session) { setError(true); return; }
      const localDate = getLocalDateStr();
      const res = await fetch(`${getApiBase()}/api/coins/earn-tasks?localDate=${localDate}`, {
        headers: { Authorization: `Bearer ${session}` },
      });
      if (!res.ok) { setError(true); return; }
      const data = await res.json() as EarnTasksResponse;
      if (data.success && Array.isArray(data.groups)) setGroups(data.groups);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (visible) void fetchTasks();
  }, [visible, fetchTasks]);

  if (loading && groups.length === 0) {
    return (
      <View style={{ gap: 10 }}>
        {Array.from({ length: 3 }).map((_, i) => (
          <SkeletonEarnTaskCard key={i} />
        ))}
      </View>
    );
  }

  if (error && groups.length === 0) {
    return (
      <View style={s.center}>
        <Feather name="alert-circle" size={28} color="#EF4444" />
        <Text style={[s.errorTxt, { color: colors.destructive }]}>
          Could not load coin tasks.
        </Text>
        <TouchableOpacity onPress={fetchTasks} style={[s.retryBtn, { backgroundColor: "#22C55E18", borderColor: "#22C55E40", borderWidth: 1 }]}>
          <Feather name="refresh-cw" size={13} color="#22C55E" />
          <Text style={s.retryTxt}>Tap to retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View>
      <View style={s.sectionHeader}>
        <Text style={[s.sectionTitle, { color: colors.foreground }]}>How to Earn Coins</Text>
        {loading && <ActivityIndicator size="small" color="#22C55E" style={{ marginLeft: 8 }} />}
        {!loading && (
          <TouchableOpacity onPress={fetchTasks} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Feather name="refresh-cw" size={14} color="#6B7280" />
          </TouchableOpacity>
        )}
      </View>
      <Text style={[s.sectionSub, { color: colors.mutedForeground }]}>
        Complete walking, race, social, and streak challenges to earn free coins.
      </Text>

      {groups.map((group, i) => (
        <GroupCard
          key={group.difficulty}
          group={group}
          defaultExpanded={i < 2}
        />
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  sectionHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 4 },
  sectionTitle:  { fontSize: 17, fontWeight: "800" },
  sectionSub:    { fontSize: 12, color: "#6B7280", marginBottom: 14, lineHeight: 17 },
  center:        { alignItems: "center", justifyContent: "center", paddingVertical: 40, gap: 10 },
  loadingTxt:    { fontSize: 13, color: "#6B7280" },
  errorTxt:      { fontSize: 14, fontWeight: "600", textAlign: "center" },
  retryBtn:      { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 4, backgroundColor: "#0B2A1A", paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10 },
  retryTxt:      { fontSize: 13, color: "#22C55E", fontWeight: "700" },
});
