import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import {
  View,
  Text,
  ScrollView,
  FlatList,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
  Modal,
  TextInput,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { SkeletonHistoryChart } from "@/components/SkeletonRows";
import { router, useFocusEffect } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { useSafeLayout } from "@/hooks/useSafeLayout";
import { useColors } from "@/hooks/useColors";
import { authFetch } from "@/utils/authFetch";
import { getLocalDateStr } from "@/utils/timezone";
import { useWalkContext } from "@/context/WalkContext";
import { getTodayKey } from "@/utils/format";
import { TouchableOpacity } from "@/components/HapticTouchableOpacity";


type Range = "week" | "month" | "three_months" | "year";
type DistanceUnit = "km" | "mi";

interface DayData {
  date: string;
  dayLabel: string;
  dateLabel: string;
  steps: number;
  distanceMeters: number;
  distanceDisplay: string;
  caloriesBurned: number;
  activeMinutes: number;
  goalSteps: number;
  goalCompleted: boolean;
  progressPercent: number;
  status: "goal" | "above_50" | "below_50" | "rest";
}

interface LifetimeStats {
  totalSteps: number;
  totalDistanceMeters: number;
  distanceDisplay: string;
  caloriesBurned: number;
  activeMinutes: number;
  activeDays: number;
  bestDaySteps: number;
  joinedAt: string | null;
  joinedLabel: string | null;
}

const RANGES: { key: Range; label: string }[] = [
  { key: "week", label: "Week" },
  { key: "month", label: "Month" },
  { key: "three_months", label: "3M" },
  { key: "year", label: "Year" },
];

const RANGE_DAYS: Record<Range, number> = { week: 7, month: 30, three_months: 90, year: 365 };

const GOAL_PRESETS = [2000, 5000, 7500, 10000, 12000, 15000];

const BAR_WIDTH = 44;
const BAR_GAP = 10;
const ITEM_WIDTH = BAR_WIDTH + BAR_GAP;
const CHART_H = 220;
const LABEL_H = 44;
const MAX_BAR_H = 185;

function barColor(d: DayData): string {
  if (d.steps === 0) return "#2A2D3E";
  if (d.goalCompleted) return "#00E676";
  if (d.progressPercent >= 50) return "#FF9800";
  return "#FF4560";
}

function fmtK(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n % 1000 === 0 ? 0 : 1)}k`;
  return String(n);
}

function fmtDist(meters: number, unit: DistanceUnit): string {
  if (unit === "mi") {
    // Always show miles — no feet conversion (avoids confusion with Walk tab)
    const miles = meters / 1609.344;
    return `${miles.toFixed(2)} mi`;
  }
  return meters >= 1000 ? `${(meters / 1000).toFixed(1)} km` : `${meters} m`;
}

function fmtGoalLabel(n: number): string {
  return fmtK(n);
}

// ── Live overlay helper (module-level, no closure deps) ─────────────────────
// Replaces today's DB entry with the live pedometer value when it is higher.
// Called both when server data arrives AND whenever todaySteps updates, so the
// displayed steps are always max(db, live) — no race condition possible.
function applyLiveOverlay(days: DayData[], todayStr: string, liveSteps: number): DayData[] {
  if (liveSteps <= 0) return days;
  return days.map((d): DayData => {
    if (d.date !== todayStr || liveSteps <= d.steps) return d;
    const progress = d.goalSteps > 0 ? Math.min(100, Math.round((liveSteps / d.goalSteps) * 100)) : 0;
    return {
      ...d,
      steps: liveSteps,
      distanceMeters: Math.round(liveSteps * 0.762),
      caloriesBurned: Math.round(liveSteps * 0.04),
      activeMinutes: Math.ceil(liveSteps / 120),
      progressPercent: progress,
      goalCompleted: liveSteps >= d.goalSteps,
      status: liveSteps >= d.goalSteps ? "goal" : progress >= 50 ? "above_50" : "below_50",
    };
  });
}

export default function StepHistoryScreen() {
  const { safeTop, safeBottom } = useSafeLayout();
  const colors = useColors();
  const chartRef = useRef<FlatList<DayData>>(null);

  const [range, setRange] = useState<Range>("week");
  // Raw data straight from the server — never modified by the live overlay
  const [rawDays, setRawDays] = useState<DayData[]>([]);
  const [goalSteps, setGoalSteps] = useState(10000);
  const [distanceUnit, setDistanceUnit] = useState<DistanceUnit>("km");
  const [lifetime, setLifetime] = useState<LifetimeStats | null>(null);
  const [selected, setSelected] = useState<DayData | null>(null);
  // Three distinct UI states: loading (first load), refreshing (pull-to-refresh/focus), error, authError
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(false);
  const [sessionExpired, setSessionExpired] = useState(false);

  // Goal modal state
  const [goalModalVisible, setGoalModalVisible] = useState(false);
  const [goalInput, setGoalInput] = useState("");
  const [goalInputError, setGoalInputError] = useState("");
  const [savingGoal, setSavingGoal] = useState(false);

  // refreshTodayRank is fetchTodayFromBackend — calling it syncs the new goal
  // into WalkContext so the Walk tab updates immediately without requiring a restart.
  const { refreshTodayRank, todaySteps } = useWalkContext();

  const todayStr = getLocalDateStr();

  // allDays is always rawDays with the live pedometer value overlaid on today.
  // Recomputes instantly whenever either the server data OR todaySteps changes —
  // no useEffect race condition possible.
  const allDays = useMemo(
    () => applyLiveOverlay(rawDays, todayStr, todaySteps),
    [rawDays, todayStr, todaySteps],
  );

  const periodDays = useMemo(() => allDays.slice(-RANGE_DAYS[range]), [allDays, range]);

  const periodSummary = useMemo(() => {
    const totalSteps = periodDays.reduce((s, d) => s + d.steps, 0);
    const totalDist = periodDays.reduce((s, d) => s + d.distanceMeters, 0);
    const totalCals = periodDays.reduce((s, d) => s + d.caloriesBurned, 0);
    const totalMins = periodDays.reduce((s, d) => s + d.activeMinutes, 0);
    return { totalSteps, totalDist, totalCals, totalMins };
  }, [periodDays]);

  const maxSteps = useMemo(
    () => Math.max(goalSteps, ...allDays.map((d) => d.steps), 1),
    [allDays, goalSteps],
  );

  // ── Core data fetch ─────────────────────────────────────────────────────────
  // authFetch handles token refresh + retry automatically.
  // Session expired is ONLY set when the API responds with 401/403 after retry.
  // Network errors / server errors → generic error state (not session expired).
  const fetchHistory = useCallback(async (silent = false) => {
    if (!silent) {
      setError(false);
      setSessionExpired(false);
    }
    try {
      const res = await authFetch(`/api/walk/history?localDate=${encodeURIComponent(getTodayKey())}`);

      // Only treat 401/403 (post-refresh) as auth errors
      if (res.status === 401 || res.status === 403) {
        setSessionExpired(true);
        return;
      }
      if (!res.ok) {
        setError(true);
        return;
      }

      const body = await res.json() as {
        goalSteps: number;
        distanceUnit: DistanceUnit;
        days: DayData[];
        lifetime: LifetimeStats;
      };

      const loaded = body.days ?? [];
      setRawDays(loaded);
      setGoalSteps(body.goalSteps ?? 10000);
      setDistanceUnit(body.distanceUnit ?? "km");
      setLifetime(body.lifetime ?? null);
      // Select today's bar using the live-overlaid version so the panel shows
      // the correct step count immediately (not the stale DB value).
      const overlaid = applyLiveOverlay(loaded, todayStr, todaySteps);
      const todayBar = overlaid.find((d) => d.date === todayStr) ?? overlaid[overlaid.length - 1] ?? null;
      setSelected(todayBar);
      // Clear error/auth-error on success
      setError(false);
      setSessionExpired(false);
    } catch {
      // Network/parse errors: show generic error, NOT session expired
      setError(true);
    }
  }, [todayStr, todaySteps]);

  // ── Initial load ─────────────────────────────────────────────────────────────
  useEffect(() => {
    setLoading(true);
    fetchHistory().finally(() => setLoading(false));
  }, [fetchHistory]);

  // ── Refetch every time the screen comes into focus ────────────────────────
  // This ensures Walking History always shows the latest data from the backend,
  // matching whatever the Walk tab just synced.
  useFocusEffect(
    useCallback(() => {
      // Skip the very first focus (initial load handles it)
      if (!loading) {
        fetchHistory(true); // silent = keep existing data visible while refreshing
      }
    }, [loading, fetchHistory]),
  );

  // ── Keep selected panel in sync when today's live steps update ──────────────
  // allDays recomputes automatically (useMemo) but `selected` is a snapshot state.
  // When today is selected and allDays[today] changes (live steps increased),
  // refresh the panel without losing the user's manual selection for other days.
  useEffect(() => {
    if (!selected || selected.date !== todayStr) return;
    const todayBar = allDays.find((d) => d.date === todayStr);
    if (todayBar && todayBar.steps !== selected.steps) {
      setSelected(todayBar);
    }
  }, [allDays, selected, todayStr]);

  // ── Scroll to today ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (allDays.length > 0) {
      setTimeout(() => {
        chartRef.current?.scrollToIndex({
          index: allDays.length - 1,
          animated: false,
          viewPosition: 1,
        });
      }, 150);
    }
  }, [allDays]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await fetchHistory();
    setRefreshing(false);
  };

  // ── Save preferences to backend ─────────────────────────────────────────────
  const savePreferences = useCallback(async (goal: number, unit: DistanceUnit) => {
    try {
      await authFetch(`/api/user/preferences`, {
        method: "PATCH",
        body: JSON.stringify({ dailyStepGoal: goal, distanceUnit: unit }),
      });
    } catch {
      // fire and forget — preferences update will be retried on next visit
    }
  }, []);

  // ── Save goal ────────────────────────────────────────────────────────────────
  const handleSaveGoal = useCallback(async () => {
    const trimmed = goalInput.trim();
    const val = parseInt(trimmed, 10);
    if (isNaN(val) || val < 500 || val > 100000 || !/^\d+$/.test(trimmed)) {
      setGoalInputError("Enter a whole number between 500 and 100,000");
      return;
    }
    setSavingGoal(true);
    setGoalInputError("");
    await savePreferences(val, distanceUnit);
    setGoalSteps(val);
    setSavingGoal(false);
    setGoalModalVisible(false);
    // Sync new goal into WalkContext so Walk tab updates immediately
    refreshTodayRank().catch(() => {});
    // Refetch to get updated goal reflected in chart
    setLoading(true);
    await fetchHistory();
    setLoading(false);
  }, [goalInput, distanceUnit, savePreferences, fetchHistory]);

  // ── Unit toggle ──────────────────────────────────────────────────────────────
  const handleUnitToggle = useCallback(async (unit: DistanceUnit) => {
    setDistanceUnit(unit);
    await savePreferences(goalSteps, unit);
    setLoading(true);
    await fetchHistory();
    setLoading(false);
  }, [goalSteps, savePreferences, fetchHistory]);

  // ── Chart rendering ─────────────────────────────────────────────────────────
  const goalLineBottom = (goalSteps / maxSteps) * MAX_BAR_H;

  const renderBar = useCallback(({ item: day, index }: { item: DayData; index: number }) => {
    const isSelected = day.date === selected?.date;
    const isToday = day.date === todayStr;
    const bc = barColor(day);

    // Rest days: small visible stub so the date is clearly rendered (not blank)
    const barH = day.steps > 0
      ? Math.max(4, (day.steps / maxSteps) * MAX_BAR_H)
      : 5;

    return (
      <TouchableOpacity
        activeOpacity={0.72}
        onPress={() => setSelected(day)}
        style={{
          width: BAR_WIDTH,
          marginRight: index < allDays.length - 1 ? BAR_GAP : 0,
          alignItems: "center",
          height: CHART_H + LABEL_H,
          justifyContent: "flex-end",
        }}
      >
        <View style={{ width: BAR_WIDTH, height: CHART_H, justifyContent: "flex-end" }}>
          {/* Goal line tick */}
          <View style={{
            position: "absolute",
            bottom: goalLineBottom,
            left: 0,
            right: 0,
            height: 1.5,
            backgroundColor: "#FFD70070",
          }} />
          {/* Selected column highlight */}
          {isSelected && (
            <View style={{
              position: "absolute",
              bottom: 0,
              width: BAR_WIDTH,
              height: CHART_H,
              backgroundColor: "#FFFFFF0A",
              borderRadius: 6,
            }} />
          )}
          {/* Bar */}
          <View style={{
            width: isSelected ? BAR_WIDTH : BAR_WIDTH - 4,
            alignSelf: "center",
            height: barH,
            backgroundColor: isSelected ? "#FFFFFF" : bc,
            borderRadius: 5,
            opacity: day.steps === 0 ? 0.35 : 1,
          }} />
          {/* Step count label above the bar */}
          {day.steps > 0 && (
            <Text
              style={{
                position: "absolute",
                bottom: barH + 4,
                width: BAR_WIDTH,
                textAlign: "center",
                fontSize: 10,
                fontWeight: "700",
                color: isSelected ? "#FFFFFF" : bc,
              }}
              numberOfLines={1}
            >
              {fmtK(day.steps)}
            </Text>
          )}
        </View>

        {/* Day + date labels */}
        <View style={{ height: LABEL_H, alignItems: "center", paddingTop: 5, gap: 2 }}>
          <Text style={{
            fontSize: 11,
            fontWeight: isToday || isSelected ? "800" : "500",
            color: isToday ? colors.primary : isSelected ? "#FFFFFF" : "#555870",
          }}>
            {day.dayLabel}
          </Text>
          <Text style={{
            fontSize: 10,
            color: isToday
              ? colors.primary + "BB"
              : isSelected
                ? "#AAAACC"
                : "#3D3F56",
          }}>
            {day.dateLabel}
          </Text>
        </View>
      </TouchableOpacity>
    );
  }, [allDays.length, maxSteps, goalLineBottom, selected, todayStr, colors.primary]);

  const keyExtractor = useCallback((item: DayData) => item.date, []);
  const getItemLayout = useCallback((_: ArrayLike<DayData> | null | undefined, index: number) => ({
    length: ITEM_WIDTH,
    offset: ITEM_WIDTH * index,
    index,
  }), []);

  const selectedPercent = selected
    ? selected.goalSteps > 0
      ? Math.min(100, Math.round((selected.steps / selected.goalSteps) * 100))
      : 0
    : 0;

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <View style={[S.root, { paddingTop: safeTop, paddingBottom: safeBottom }]}>
      {/* Header */}
      <View style={S.header}>
        <TouchableOpacity
          onPress={() => router.back()}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          style={S.backBtn}
        >
          <Feather name="chevron-left" size={26} color="#FFFFFF" />
        </TouchableOpacity>
        <Text style={S.headerTitle}>Walking History</Text>
        <View style={{ width: 38 }} />
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: 32, paddingHorizontal: 16 }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor={colors.primary}
          />
        }
      >
        {/* ── Initial loading state ── */}
        {loading && allDays.length === 0 && (
          <SkeletonHistoryChart />
        )}

        {/* ── Session expired (real auth failure only) ── */}
        {!loading && sessionExpired && (
          <View style={S.centered}>
            <Feather name="lock" size={40} color={colors.mutedForeground} />
            <Text style={[S.emptyTitle, { color: colors.foreground }]}>Session expired</Text>
            <Text style={[S.emptySub, { color: colors.mutedForeground }]}>
              Please sign in again to view your walking history.
            </Text>
            <TouchableOpacity
              onPress={() => router.replace("/(auth)/login" as never)}
              style={[S.retryBtn, { backgroundColor: colors.primary + "20", borderColor: colors.primary + "60" }]}
            >
              <Text style={{ color: colors.primary, fontWeight: "700" }}>Sign in again</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* ── Network/server error ── */}
        {!loading && !sessionExpired && error && allDays.length === 0 && (
          <View style={S.centered}>
            <Text style={{ fontSize: 40 }}>⚠️</Text>
            <Text style={[S.emptyTitle, { color: colors.foreground }]}>
              Unable to load walking history
            </Text>
            <Text style={[S.emptySub, { color: colors.mutedForeground }]}>
              Pull to refresh or tap retry.
            </Text>
            <TouchableOpacity
              onPress={() => {
                setLoading(true);
                setError(false);
                fetchHistory().finally(() => setLoading(false));
              }}
              style={[S.retryBtn, { backgroundColor: colors.primary + "20", borderColor: colors.primary + "60" }]}
            >
              <Text style={{ color: colors.primary, fontWeight: "700" }}>Try again</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* ── Empty state ── */}
        {!loading && !sessionExpired && !error && allDays.length === 0 && (
          <View style={S.centered}>
            <Text style={{ fontSize: 48 }}>🚶</Text>
            <Text style={[S.emptyTitle, { color: colors.foreground }]}>No walking history yet</Text>
            <Text style={[S.emptySub, { color: colors.mutedForeground }]}>
              Start walking to see your progress here
            </Text>
          </View>
        )}

        {/* ── Main content (shown even while silently refreshing) ── */}
        {!sessionExpired && allDays.length > 0 && (
          <>
            {/* ── Card 1: Daily Steps chart ── */}
            <View style={[S.card, { backgroundColor: colors.card, borderColor: colors.border, paddingHorizontal: 0 }]}>
              {/* Chart header */}
              <View style={[S.chartHeader, { paddingHorizontal: 16 }]}>
                <Text style={[S.chartTitle, { color: colors.foreground }]}>Daily Steps</Text>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  {/* km/mi unit toggle */}
                  <View style={[S.unitToggle, { borderColor: colors.border }]}>
                    {(["km", "mi"] as DistanceUnit[]).map((u) => (
                      <TouchableOpacity
                        key={u}
                        onPress={() => handleUnitToggle(u)}
                        style={[
                          S.unitBtn,
                          distanceUnit === u && {
                            backgroundColor: colors.primary + "30",
                          },
                        ]}
                      >
                        <Text style={{
                          fontSize: 10,
                          fontWeight: "700",
                          color: distanceUnit === u ? colors.primary : "#555870",
                        }}>
                          {u}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>

                  {/* ── Set Goal button — prominent gold pill ── */}
                  <TouchableOpacity
                    onPress={() => {
                      setGoalInput(String(goalSteps));
                      setGoalInputError("");
                      setGoalModalVisible(true);
                    }}
                    accessibilityLabel="Set daily step goal"
                    style={S.goalEditBtn}
                  >
                    <Feather name="target" size={11} color="#FFD700" style={{ marginRight: 4 }} />
                    <Text style={S.goalEditTxt}>
                      Goal: {fmtGoalLabel(goalSteps)}
                    </Text>
                    <Feather name="edit-2" size={10} color="#FFD700" style={{ marginLeft: 3 }} />
                  </TouchableOpacity>
                </View>
              </View>

              {/* Selected day details */}
              {selected && (
                <View style={[S.selectedDayRow, { borderBottomColor: colors.border, paddingHorizontal: 16 }]}>
                  <View style={{ flex: 1 }}>
                    <Text style={[S.selectedDayDate, { color: colors.mutedForeground }]}>
                      {selected.dayLabel}, {selected.dateLabel}
                    </Text>
                    <View style={{ flexDirection: "row", alignItems: "baseline", gap: 4 }}>
                      <Text style={[S.selectedDaySteps, { color: colors.foreground }]}>
                        {selected.steps.toLocaleString()}
                      </Text>
                      <Text style={{ fontSize: 12, color: colors.mutedForeground }}>steps</Text>
                    </View>
                    <View style={{ flexDirection: "row", gap: 10, marginTop: 4, flexWrap: "wrap" }}>
                      <Text style={{ fontSize: 11, color: colors.accent }}>
                        {fmtDist(selected.distanceMeters, distanceUnit)}
                      </Text>
                      <Text style={{ fontSize: 11, color: colors.gold }}>
                        {selected.caloriesBurned} cal
                      </Text>
                      <Text style={{ fontSize: 11, color: colors.primary }}>
                        {selected.activeMinutes}m active
                      </Text>
                    </View>
                  </View>

                  {/* Dynamic percentage badge */}
                  <View style={[S.pctBadge, {
                    backgroundColor: selected.goalCompleted
                      ? "#00E67618"
                      : selectedPercent >= 50
                        ? "#FF980018"
                        : "#FF456018",
                    borderColor: selected.goalCompleted
                      ? "#00E67650"
                      : selectedPercent >= 50
                        ? "#FF980050"
                        : "#FF456050",
                  }]}>
                    <Text style={[S.pctBadgeTxt, {
                      color: selected.goalCompleted
                        ? "#00E676"
                        : selectedPercent >= 50
                          ? "#FF9800"
                          : "#FF4560",
                    }]}>
                      {selected.goalCompleted ? "✓ Goal" : `${selectedPercent}%`}
                    </Text>
                    <Text style={{ fontSize: 9, color: colors.mutedForeground, marginTop: 1, textAlign: "center" }}>
                      of {fmtGoalLabel(selected.goalSteps)}
                    </Text>
                  </View>
                </View>
              )}

              {/* Scrollable bar chart */}
              <FlatList
                ref={chartRef}
                data={allDays}
                horizontal
                keyExtractor={keyExtractor}
                renderItem={renderBar}
                getItemLayout={getItemLayout}
                showsHorizontalScrollIndicator={false}
                decelerationRate="fast"
                removeClippedSubviews
                initialNumToRender={20}
                maxToRenderPerBatch={30}
                windowSize={5}
                contentContainerStyle={{
                  paddingHorizontal: 8,
                  paddingTop: 12,
                  paddingBottom: 4,
                }}
                onScrollToIndexFailed={(info) => {
                  setTimeout(() => {
                    chartRef.current?.scrollToIndex({
                      index: info.highestMeasuredFrameIndex,
                      animated: false,
                      viewPosition: 1,
                    });
                  }, 100);
                }}
              />

            </View>

            {/* ── Card 2: Period range summary ── */}
            <View style={[S.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
              {/* Range tabs */}
              <View style={S.inCardFilterRow}>
                {RANGES.map(({ key, label }) => (
                  <TouchableOpacity
                    key={key}
                    onPress={() => setRange(key)}
                    style={[
                      S.inCardFilterBtn,
                      range === key && {
                        backgroundColor: colors.primary + "22",
                        borderColor: colors.primary + "80",
                      },
                    ]}
                  >
                    <Text style={[
                      S.inCardFilterTxt,
                      { color: range === key ? colors.primary : "#555870" },
                    ]}>
                      {label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              {/* Steps count */}
              <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 6, marginBottom: 4 }}>
                <Text style={[S.periodSteps, { color: colors.foreground }]}>
                  {periodSummary.totalSteps.toLocaleString()}
                </Text>
                <Text style={[S.periodStepsLabel, { color: colors.mutedForeground }]}>steps</Text>
              </View>

              {/* Metric pills */}
              <View style={S.pillRow}>
                <MetricPill
                  icon="map-pin"
                  label={fmtDist(periodSummary.totalDist, distanceUnit)}
                  color={colors.accent}
                />
                <MetricPill
                  icon="zap"
                  label={`${fmtK(periodSummary.totalCals)} cal`}
                  color={colors.gold}
                />
                <MetricPill
                  icon="clock"
                  label={`${periodSummary.totalMins}m`}
                  color={colors.primary}
                />
              </View>
            </View>

            {/* ── Card 3: Lifetime Summary ── */}
            {lifetime && (
              <View style={[S.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <View style={{
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "space-between",
                  marginBottom: 4,
                }}>
                  <Text style={[S.sectionTitle, { color: colors.foreground }]}>Lifetime Summary</Text>
                  {lifetime.joinedLabel && (
                    <Text style={{ fontSize: 10, color: colors.mutedForeground }}>
                      {lifetime.joinedLabel}
                    </Text>
                  )}
                </View>

                <View style={S.lifetimeGrid}>
                  <LifetimeTile emoji="🚶" label="All-Time Steps" value={fmtK(lifetime.totalSteps)} colors={colors} />
                  <LifetimeTile
                    emoji="📍"
                    label="Distance"
                    value={lifetime.distanceDisplay || fmtDist(lifetime.totalDistanceMeters, distanceUnit)}
                    colors={colors}
                  />
                  <LifetimeTile emoji="⚡" label="Calories" value={fmtK(lifetime.caloriesBurned)} colors={colors} />
                  <LifetimeTile emoji="⏱" label="Active Mins" value={fmtK(lifetime.activeMinutes)} colors={colors} />
                  <LifetimeTile emoji="🔥" label="Active Days" value={String(lifetime.activeDays)} colors={colors} />
                  <LifetimeTile emoji="🏆" label="Best Day" value={fmtK(lifetime.bestDaySteps)} colors={colors} />
                </View>
              </View>
            )}
          </>
        )}
      </ScrollView>

      {/* ── Set Daily Goal modal ── */}
      <Modal
        visible={goalModalVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setGoalModalVisible(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          style={S.modalOverlay}
        >
          <TouchableOpacity
            style={StyleSheet.absoluteFill}
            onPress={() => setGoalModalVisible(false)}
            activeOpacity={1}
          />
          <View style={[S.modalSheet, { backgroundColor: colors.card, borderColor: colors.border, paddingBottom: safeBottom + 24 }]}>
            <View style={S.modalHandle} />
            <Text style={[S.modalTitle, { color: colors.foreground }]}>Set Daily Goal</Text>
            <Text style={[S.modalSub, { color: colors.mutedForeground }]}>
              Current goal: {goalSteps.toLocaleString()} steps
            </Text>

            {/* Preset buttons */}
            <View style={S.presetRow}>
              {GOAL_PRESETS.map((preset) => (
                <TouchableOpacity
                  key={preset}
                  onPress={() => {
                    setGoalInput(String(preset));
                    setGoalInputError("");
                  }}
                  style={[
                    S.presetBtn,
                    {
                      borderColor: goalInput === String(preset) ? colors.primary : colors.border,
                      backgroundColor: goalInput === String(preset) ? colors.primary + "20" : "transparent",
                    },
                  ]}
                >
                  <Text style={{
                    fontSize: 12,
                    fontWeight: "700",
                    color: goalInput === String(preset) ? colors.primary : colors.mutedForeground,
                  }}>
                    {fmtK(preset)}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Custom input */}
            <View style={{ marginBottom: 12 }}>
              <TextInput
                value={goalInput}
                onChangeText={(t) => {
                  setGoalInput(t);
                  setGoalInputError("");
                }}
                keyboardType="number-pad"
                placeholder="Custom (e.g. 8000)"
                placeholderTextColor={colors.mutedForeground}
                style={[S.goalInput, {
                  color: colors.foreground,
                  borderColor: goalInputError ? "#FF4560" : colors.border,
                  backgroundColor: colors.background,
                }]}
              />
              {!!goalInputError && (
                <Text style={{ fontSize: 11, color: "#FF4560", marginTop: 4 }}>
                  {goalInputError}
                </Text>
              )}
            </View>

            {/* Distance unit toggle */}
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 20 }}>
              <Text style={{ fontSize: 12, color: colors.mutedForeground }}>Distance unit:</Text>
              {(["km", "mi"] as DistanceUnit[]).map((u) => (
                <TouchableOpacity
                  key={u}
                  onPress={() => setDistanceUnit(u)}
                  style={[
                    S.unitBtnLg,
                    {
                      borderColor: distanceUnit === u ? colors.primary : colors.border,
                      backgroundColor: distanceUnit === u ? colors.primary + "20" : "transparent",
                    },
                  ]}
                >
                  <Text style={{
                    fontSize: 13,
                    fontWeight: "700",
                    color: distanceUnit === u ? colors.primary : colors.mutedForeground,
                  }}>
                    {u === "km" ? "Kilometers" : "Miles"}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <View style={{ flexDirection: "row", gap: 10 }}>
              <TouchableOpacity
                onPress={() => setGoalModalVisible(false)}
                style={[S.modalCancelBtn, { borderColor: colors.border }]}
              >
                <Text style={{ color: colors.mutedForeground, fontWeight: "700" }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleSaveGoal}
                disabled={savingGoal}
                style={[S.modalSaveBtn, { backgroundColor: "#FFD700", opacity: savingGoal ? 0.6 : 1 }]}
              >
                {savingGoal
                  ? <ActivityIndicator size="small" color="#000" />
                  : <Text style={{ color: "#000", fontWeight: "800", fontSize: 15 }}>Save Goal</Text>
                }
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function MetricPill({ icon, label, color }: { icon: string; label: string; color: string }) {
  return (
    <View style={[S.pill, { backgroundColor: color + "18", borderColor: color + "30" }]}>
      <Feather name={icon as never} size={11} color={color} />
      <Text style={[S.pillTxt, { color }]}>{label}</Text>
    </View>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <View style={S.legendItem}>
      <View style={[S.legendDot, { backgroundColor: color }]} />
      <Text style={S.legendLabel}>{label}</Text>
    </View>
  );
}

function LifetimeTile({
  emoji, label, value, colors,
}: {
  emoji: string;
  label: string;
  value: string;
  colors: ReturnType<typeof useColors>;
}) {
  return (
    <View style={[S.lifetimeTile, { backgroundColor: colors.background, borderColor: colors.border }]}>
      <Text style={{ fontSize: 18, lineHeight: 24 }}>{emoji}</Text>
      <Text style={[S.lifetimeTileValue, { color: colors.foreground }]}>{value}</Text>
      <Text style={[S.lifetimeTileLabel, { color: colors.mutedForeground }]}>{label}</Text>
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const S = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#0A0B14" },

  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  backBtn: { width: 38, height: 38, alignItems: "center", justifyContent: "center" },
  headerTitle: { fontSize: 18, fontWeight: "800", color: "#FFFFFF", letterSpacing: 0.2 },

  centered: { paddingTop: 80, alignItems: "center", gap: 14 },
  loadingTxt: { fontSize: 14, marginTop: 6 },
  emptyTitle: { fontSize: 18, fontWeight: "700", textAlign: "center" },
  emptySub: { fontSize: 14, textAlign: "center", paddingHorizontal: 32, lineHeight: 20 },
  retryBtn: {
    marginTop: 4,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
  },

  card: {
    borderRadius: 18,
    borderWidth: 1,
    padding: 16,
    marginBottom: 14,
  },

  inCardFilterRow: { flexDirection: "row", gap: 6, marginBottom: 14 },
  inCardFilterBtn: {
    flex: 1,
    paddingVertical: 7,
    borderRadius: 10,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#2A2D3E",
  },
  inCardFilterTxt: { fontSize: 12, fontWeight: "700" },

  periodSteps: {
    fontSize: 42,
    fontWeight: "800",
    letterSpacing: -1.5,
    lineHeight: 46,
    fontVariant: ["tabular-nums"],
  },
  periodStepsLabel: { fontSize: 14, marginBottom: 6 },

  pillRow: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
    borderWidth: 1,
  },
  pillTxt: { fontSize: 12, fontWeight: "600" },
  goalBarTrack: { height: 6, borderRadius: 3, overflow: "hidden" },
  goalBarFill: { height: 6, borderRadius: 3 },

  chartHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingBottom: 10,
  },
  chartTitle: { fontSize: 15, fontWeight: "700" },

  unitToggle: {
    flexDirection: "row",
    borderRadius: 8,
    borderWidth: 1,
    overflow: "hidden",
  },
  unitBtn: { paddingHorizontal: 8, paddingVertical: 4 },

  // ── Prominent gold goal pill ──
  goalEditBtn: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: "#FFD700",
    backgroundColor: "#FFD70012",
  },
  goalEditTxt: {
    fontSize: 12,
    fontWeight: "800",
    color: "#FFD700",
    letterSpacing: 0.2,
  },

  selectedDayRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingBottom: 12,
    marginBottom: 4,
    borderBottomWidth: 1,
  },
  selectedDayDate: { fontSize: 10, marginBottom: 2 },
  selectedDaySteps: {
    fontSize: 28,
    fontWeight: "800",
    letterSpacing: -1,
    fontVariant: ["tabular-nums"],
  },

  pctBadge: {
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 6,
    alignItems: "center",
    minWidth: 60,
  },
  pctBadgeTxt: { fontSize: 14, fontWeight: "800" },

  legendRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingTop: 8,
    paddingBottom: 4,
  },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 5, marginRight: 14 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendLabel: { fontSize: 10, color: "#555870" },

  sectionTitle: { fontSize: 15, fontWeight: "700" },

  lifetimeGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 12,
  },
  lifetimeTile: {
    width: "30.5%",
    borderRadius: 12,
    borderWidth: 1,
    padding: 10,
    gap: 3,
  },
  lifetimeTileValue: { fontSize: 15, fontWeight: "800", letterSpacing: -0.5 },
  lifetimeTileLabel: { fontSize: 9, fontWeight: "600", letterSpacing: 0.2 },

  // Modal
  modalOverlay: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "#00000088",
  },
  modalSheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: 1,
    padding: 24,
    paddingBottom: 40,
  },
  modalHandle: {
    width: 36,
    height: 4,
    backgroundColor: "#FFFFFF30",
    borderRadius: 2,
    alignSelf: "center",
    marginBottom: 16,
  },
  modalTitle: { fontSize: 18, fontWeight: "800", marginBottom: 4 },
  modalSub: { fontSize: 13, marginBottom: 16 },

  presetRow: {
    flexDirection: "row",
    gap: 8,
    flexWrap: "wrap",
    marginBottom: 14,
  },
  presetBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
  },
  goalInput: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    fontVariant: ["tabular-nums"],
  },

  unitBtnLg: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: "center",
  },

  modalCancelBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "center",
  },
  modalSaveBtn: {
    flex: 2,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: "center",
  },
});
