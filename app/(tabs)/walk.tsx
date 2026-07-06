import { LinearGradient } from "expo-linear-gradient";
import { BlueShoe } from "@/components/BlueShoe";
import { RaceJoinBadge, JoinProgressOverlay } from "@/components/RaceJoinBadge";
import { router, useFocusEffect } from "expo-router";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import DateTimePicker from "@react-native-community/datetimepicker";
import {
  ActivityIndicator,
  Animated,
  Easing,
  Image,
  InteractionManager,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  Share,
  useWindowDimensions,
  View} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { AppAlert } from "@/components/AppAlert";
import { AvatarPickerSheet } from "@/components/AvatarPickerSheet";
import * as Clipboard from "expo-clipboard";
import * as ImagePicker from "expo-image-picker";
import { useSafeLayout } from "@/hooks/useSafeLayout";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "@/utils/haptics";
import { useColors } from "@/hooks/useColors";
import { useTheme } from "@/context/ThemeContext";
import { useSound } from "@/context/SoundContext";
import { useTabBarHeight } from "@/hooks/useTabBarHeight";
import { useWalkContext, TrackingStatus } from "@/context/WalkContext";
import { useStepSourceGuard } from "@/hooks/useStepSourceGuard";
import { ENABLE_CASH_CHALLENGES, ENABLE_LEGACY_CASH_RACE_CARDS } from "@/config/featureFlags";
import { useApp } from "@/context/AppContext";
import { useAuth } from "@/context/AuthContext";
import { useRace } from "@/context/RaceContext";
import { formatDistance, formatCalories, stepsToDistance } from "@/utils/format";
import { getApiBase } from "@/utils/apiUrl";
import { STEP_SYNC_CONFIG } from "@/config/stepSyncConfig";
import MyTitlesModal, { type ActiveTitle, difficultyColor } from "@/components/MyTitlesModal";
import { TitleBadge } from "@/components/TitleBadge";
import WearableSetupModal from "@/components/WearableSetupModal";
import { usePresence } from "@/context/PresenceContext";
import { useUnread } from "@/context/UnreadContext";
import { getStoredSession } from "@/services/authService";
import { authFetch } from "@/utils/authFetch";
import { isSponsoredRegistrationOpen, canOpenSponsoredWaitingRoom } from "@/utils/sponsoredEventRegistration";
import { STORAGE_KEYS, storageGet, storageSet } from "@/utils/storage";
import {
  getNotificationPreferences,
  setNotificationPreferences,
  requestNotificationPermission,
  optInNotifications,
  optOutNotifications,
  registerDeviceWithBackend,
} from "@/services/notificationService";
import { TouchableOpacity } from '@/components/HapticTouchableOpacity';
import { androidHCService } from "@/services/steps/androidHealthConnectService";
import { rf, rs } from "@/utils/responsive";
import { useDispatch, useSelector } from "react-redux";
import type { RootState, AppDispatch } from "@/store";
import { fetchTrackThemes, purchaseTrackTheme, clearPurchaseError } from "@/store/slices/trackThemesSlice";
import { TRACK_LAYOUT_OPTIONS, type TrackLayoutId, FREE_TRACK_CODES } from "@/constants/trackLayouts";
import { fetchCoinBalance } from "@/store/slices/coinsSlice";
import CoinsInfoModal from "@/components/CoinsInfoModal";
import CoinsStoreModal from "@/components/CoinsStoreModal";
import ActiveRaceModal, { type ActiveRaceInfo } from "@/components/ActiveRaceModal";
import AlreadyHostingModal from "@/components/AlreadyHostingModal";
import CoinIcon from "@/components/CoinIcon";
import DraggableShopIcon from "@/components/DraggableShopIcon";
import {
  ChallengeCategoryCard,
  ENABLE_CHALLENGE_CATEGORY_CARDS,
  type ChallengeStatus,
} from "@/components/ChallengeCategoryCard";
import JoinWithCodeModal, { type JoinWithCodeResult } from "@/components/JoinWithCodeModal";
import {
  fetchCashChallengePaymentQuote,
  type CashChallengePaymentQuote,
} from "@/services/cashChallengeApi";
import {
  CashChallengePaymentBreakdown,
  CashChallengeRewardSplit,
} from "@/components/CashChallengePaymentBreakdown";
import { WalkProgressIcon } from "@/components/WalkProgressIcon";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { clampDailyProgress } from "@/utils/stepProgress";
import CoinsBattleModal from "@/components/CoinsBattleModal";
import { screenCache } from "@/utils/screenCache";
import { SkeletonList, SkeletonInlineEditForm } from "@/components/SkeletonRows";
import { subscribeToChannel, unsubscribeFromChannel } from "@/services/realtimeService";
import { useTodayWalkSteps } from "@/hooks/useTodayWalkSteps";
import { getTodayKey } from "@/utils/format";
import {
  deleteProfileAvatar,
  profileAvatarImageUri,
  uploadProfileAvatar,
} from "@/services/mediaApi";

/** Set to true to re-enable the floating draggable shop icon on the Walk tab. */
const SHOP_ON_WALK_TAB = true;

/** User-scoped screenCache key for challenge/race card statuses. */
function walkChallengeCacheKey(userId: string): string {
  return `screen_walk_challenges:${userId}`;
}

const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? "";

// iOS can report HEIC as the mimeType even when quality<1 converts data to JPEG.
function normalizeMime(mime: string | null | undefined): string {
  if (!mime) return "image/jpeg";
  const lower = mime.toLowerCase();
  if (lower === "image/heic" || lower === "image/heif") return "image/jpeg";
  return lower;
}

const STATUS_CONFIG: Record<TrackingStatus, { label: string; icon: string; color: string }> = {
  idle: { label: "Idle", icon: "pause-circle", color: "#7B7E97" },
  walking: { label: "Walking", icon: "activity", color: "#00E676" },
  paused: { label: "Paused", icon: "pause", color: "#FF9800" },
  syncing: { label: "Syncing", icon: "refresh-cw", color: "#00B4FF" }, };

const RACE_OPTIONS = [
  {
    fee: 0,
    label: "Free Challenge",
    subtitle: "No entry fee · Walk & compete for fun",
    gradientColors: ["#064E3B", "#059669"] as [string, string],
    lightAccent: "#10B981",
    icon: "gift",
    iconImage: undefined as (ReturnType<typeof require> | undefined), },
  {
    fee: 1,
    label: "$1 Challenge",
    subtitle: "Entry fee · Skill-based walking challenge",
    gradientColors: ["#00E676", "#00B4FF"] as [string, string],
    lightAccent: "#06B6D4",
    icon: "zap",
    iconImage: undefined as (ReturnType<typeof require> | undefined), },
  {
    fee: 3,
    label: "$3 Challenge",
    subtitle: "Larger reward pool · Skill-based walking challenge",
    gradientColors: ["#00B4FF", "#4C6EF5"] as [string, string],
    lightAccent: "#6366F1",
    icon: "trending-up",
    iconImage: undefined as (ReturnType<typeof require> | undefined), },
  {
    fee: 5,
    label: "$5 Challenge",
    subtitle: "Premium entry · Largest reward pool",
    gradientColors: ["#FFD700", "#FF6B35"] as [string, string],
    lightAccent: "#F59E0B",
    icon: "award",
    iconImage: undefined as (ReturnType<typeof require> | undefined), },
  {
    fee: -1,
    label: "Coins Battle",
    subtitle: "Bet coins · Winner takes the prize pool",
    gradientColors: ["#7C2D12", "#D97706"] as [string, string],
    lightAccent: "#F59E0B",
    icon: "disc",
    iconImage: require("@/assets/images/game-coin.png") as ReturnType<typeof require>, },
];


// ── Challenge Entry Options ───────────────────────────────────────────────────
/** Cash Prize Challenge premium card — gated by cash challenges flag. */
const ENABLE_THREE_DOLLAR_CHALLENGE = ENABLE_CASH_CHALLENGES;

/** Main Join section: Free + Coins Battle; legacy $1/$3/$5 only when explicitly enabled. */
function showRaceOptionInJoinSection(fee: number): boolean {
  if (fee === 0 || fee === -1) return true;
  return fee > 0 && ENABLE_LEGACY_CASH_RACE_CARDS && ENABLE_CASH_CHALLENGES;
}

function isPaidCashFee(fee: number): boolean {
  return fee > 0;
}

function cashChallengeBlockedMessage(serverError?: string): string {
  if (serverError?.includes("Coin-entry challenges are disabled")) {
    return "Coin-entry challenges are turned off on the API server. Enable FEATURE_COIN_ENTRY_CHALLENGES on the backend deployment.";
  }
  if (serverError?.includes("disabled for this build")) {
    return "Cash challenges are turned off on the API server. The app is using your OVH URL — enable cash challenges on the backend deployment (ENABLE_CASH_CHALLENGES).";
  }
  return serverError ?? "Please try again.";
}

type ChallengeEntryCategory = "free" | "coins_battle" | "paid_cash";
interface ChallengeEntryOption { label: string; type: ChallengeEntryCategory; value: number }

const ACTIVE_ENTRY_OPTIONS: ChallengeEntryOption[] = [
  { label: "Free", type: "free", value: 0 },
  ...[500, 1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000, 9000, 10000].map((v): ChallengeEntryOption => ({
    label: `${v.toLocaleString()} coins`, type: "coins_battle", value: v,
  })),
];

/** Preserved for future re-activation — not shown while ENABLE_CASH_CHALLENGES is false */
const FUTURE_CASH_ENTRY_OPTIONS: ChallengeEntryOption[] = [
  { label: "$1", type: "paid_cash", value: 1 },
  { label: "$3", type: "paid_cash", value: 3 },
  { label: "$5", type: "paid_cash", value: 5 },
];

const ENTRY_OPTIONS: ChallengeEntryOption[] = ENABLE_CASH_CHALLENGES
  ? [...ACTIVE_ENTRY_OPTIONS, ...FUTURE_CASH_ENTRY_OPTIONS]
  : ACTIVE_ENTRY_OPTIONS;

const STEP_TARGETS = [
  50, 100, 500, 1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000, 9000, 10000,
  12000, 15000, 20000, 25000, 30000, 40000, 50000, 75000, 100000, 150000,
  200000, 250000, 300000, 400000, 500000, 750000, 1000000,
];

const GOAL_STEP_TARGETS: Record<"daily" | "weekly" | "monthly", number[]> = {
  daily:   [500, 1000, 2000, 5000, 10000, 15000, 20000],
  weekly:  [10000, 20000, 35000, 50000, 70000, 100000],
  monthly: [50000, 100000, 150000, 200000, 300000, 500000],
};
type GoalPeriodType = keyof typeof GOAL_STEP_TARGETS;
const USD_ENTRY_AMOUNTS = [3, 5, 10, 15, 20, 25];
const COINS_ENTRY_AMOUNTS = [500, 1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000, 9000, 10000];
function fmtStepLabel(n: number): string {
  if (n < 1000) return String(n);
  const k = n / 1000;
  return Number.isInteger(k) ? `${k}k` : `${k.toFixed(1)}k`;
}

// ── Target Steps horizontal picker ───────────────────────────────────────────
type StepOption = { label: string; displayLabel: string; value: number };

const STEP_OPTIONS: StepOption[] = STEP_TARGETS.map((n) => ({
  label: fmtStepLabel(n),
  displayLabel: n < 1000 ? `${n} steps` : `${fmtStepLabel(n)} steps`,
  value: n,
}));

// SNAP_ITEM_W: uniform width for every slot — drives snapToInterval + offset math
const SNAP_ITEM_W = 82;

const TargetStepsCenteredPicker = React.memo(function TargetStepsCenteredPicker({
  value, onChange, disabled = false,
}: { value: number; onChange: (v: number) => void; disabled?: boolean }) {
  const pickerColors = useColors();
  const { width: screenWidth } = useWindowDimensions();
  const scrollRef = useRef<ScrollView>(null);
  const [containerW, setContainerW] = useState(0);
  // Use measured container width; fall back to screenWidth minus typical modal padding
  const effectiveW = containerW > 0 ? containerW : screenWidth - 48;
  const sidePad = Math.max(0, (effectiveW - SNAP_ITEM_W) / 2);

  const currentIdx = useRef(Math.max(0, STEP_OPTIONS.findIndex((o) => o.value === value)));
  const [selIdx, setSelIdx] = useState(currentIdx.current);

  const scrollToIdx = useCallback((idx: number, animated: boolean) => {
    const x = idx * SNAP_ITEM_W;
    if (__DEV__) console.log("[TargetStepsCenteredPicker] scroll x:", x, "snapped index:", idx);
    scrollRef.current?.scrollTo({ x, animated });
  }, []);

  // Scroll once we have the real container width
  useEffect(() => {
    if (containerW > 0) {
      setTimeout(() => scrollToIdx(selIdx, false), 50);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [containerW]);

  // Sync when value prop changes externally (e.g. modal reopens with saved state)
  useEffect(() => {
    const idx = Math.max(0, STEP_OPTIONS.findIndex((o) => o.value === value));
    if (idx !== currentIdx.current) {
      currentIdx.current = idx;
      setSelIdx(idx);
      setTimeout(() => scrollToIdx(idx, true), 50);
    }
  }, [value, scrollToIdx]);

  // Only update state here — snapToInterval has already positioned the scroll,
  // so we must NOT call scrollToIdx again or it triggers a second animation (stutter).
  const handleScrollEnd = useCallback((offsetX: number) => {
    const idx = Math.max(0, Math.min(Math.round(offsetX / SNAP_ITEM_W), STEP_OPTIONS.length - 1));
    if (idx !== currentIdx.current) {
      currentIdx.current = idx;
      setSelIdx(idx);
      onChange(STEP_OPTIONS[idx].value);
      if (__DEV__) console.log("[TargetStepsCenteredPicker] selected value:", STEP_OPTIONS[idx].value, "index:", idx);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
  }, [onChange]);

  return (
    <View
      onLayout={(e) => setContainerW(e.nativeEvent.layout.width)}
      style={{ height: 56, marginBottom: 10, position: "relative" }}
    >
      {/* Left edge fade */}
      <LinearGradient
        colors={[pickerColors.background, "transparent"]}
        start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }}
        style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 70, zIndex: 2 }}
        pointerEvents="none"
      />
      {/* Right edge fade */}
      <LinearGradient
        colors={["transparent", pickerColors.background]}
        start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }}
        style={{ position: "absolute", right: 0, top: 0, bottom: 0, width: 70, zIndex: 2 }}
        pointerEvents="none"
      />
      {/* Center bracket — always fixed in the middle */}
      <View
        pointerEvents="none"
        style={{
          position: "absolute",
          left: (effectiveW - SNAP_ITEM_W) / 2,
          top: 4, bottom: 4,
          width: SNAP_ITEM_W,
          borderWidth: 1.5,
          borderColor: pickerColors.accent + "8C",
          borderRadius: 14,
          backgroundColor: pickerColors.accent + "12",
          zIndex: 3,
        }}
      />
      <ScrollView
        ref={scrollRef}
        horizontal
        showsHorizontalScrollIndicator={false}
        scrollEnabled={!disabled}
        snapToInterval={SNAP_ITEM_W}
        decelerationRate="fast"
        bounces={false}
        overScrollMode="never"
        contentContainerStyle={{ paddingHorizontal: sidePad, alignItems: "center" }}
        onMomentumScrollEnd={(e) => handleScrollEnd(e.nativeEvent.contentOffset.x)}
        style={{ flex: 1 }}
      >
        {STEP_OPTIONS.map((opt, i) => {
          const dist = Math.abs(i - selIdx);
          const isCenter = dist === 0;
          return (
            <TouchableOpacity
              key={opt.value}
              onPress={() => {
                if (disabled) return;
                currentIdx.current = i;
                setSelIdx(i);
                onChange(opt.value);
                scrollToIdx(i, true);
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              }}
              activeOpacity={0.7}
              style={{ width: SNAP_ITEM_W, height: 48, alignItems: "center", justifyContent: "center" }}
            >
              <Text style={{
                fontSize: isCenter ? 15 : dist === 1 ? 14 : dist === 2 ? 12 : 11,
                fontWeight: isCenter ? "700" : dist === 1 ? "600" : "400",
                color: isCenter ? pickerColors.accent : dist === 1 ? pickerColors.foreground : dist === 2 ? pickerColors.mutedForeground : pickerColors.mutedForeground,
                opacity: isCenter ? 1 : dist === 1 ? 1 : dist === 2 ? 0.75 : 0.4,
                letterSpacing: isCenter ? 0.4 : 0,
                textAlign: "center",
              }}>
                {isCenter ? opt.displayLabel : opt.label}
              </Text>
              {isCenter && (
                <View style={{
                  position: "absolute", top: 5, right: 9,
                  backgroundColor: pickerColors.accent, borderRadius: 6,
                  width: 13, height: 13, alignItems: "center", justifyContent: "center",
                  zIndex: 4,
                }}>
                  <Feather name="check" size={8} color="#000" />
                </View>
              )}
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
});

const PLAYER_COUNTS = [2, 3, 4, 5, 6, 7, 8, 9, 10];

// ── Scheduling helpers ────────────────────────────────────────────────────────
function fmtShortDate(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
function fmtShortDayName(d: Date): string {
  return d.toLocaleDateString("en-US", { weekday: "short" });
}
function fmtShortTime12(d: Date): string {
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}
function getUserTimezone(): string {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { return "UTC"; }
}

interface DateOption { label: string; value: number }
function buildDateOptions(): DateOption[] {
  const today = new Date();
  return Array.from({ length: 31 }, (_, i) => {
    const d = new Date(today);
    d.setDate(d.getDate() + i);
    const dateStr = fmtShortDate(d);
    let label: string;
    if (i === 0) label = `Today · ${dateStr}`;
    else if (i === 1) label = `Tomorrow · ${dateStr}`;
    else label = `${fmtShortDayName(d)} · ${dateStr}`;
    return { label, value: i };
  });
}

interface TimePreset { label: string; hour: number; minute: number; isNow?: boolean }
const TIME_PRESETS_WITH_NOW: TimePreset[] = [
  { label: "Now",       hour: -1, minute:  0, isNow: true },
  { label: "12:00 AM",  hour:  0, minute:  0 },
  { label: "12:30 AM",  hour:  0, minute: 30 },
  { label: "1:00 AM",   hour:  1, minute:  0 },
  { label: "1:30 AM",   hour:  1, minute: 30 },
  { label: "2:00 AM",   hour:  2, minute:  0 },
  { label: "2:30 AM",   hour:  2, minute: 30 },
  { label: "3:00 AM",   hour:  3, minute:  0 },
  { label: "3:30 AM",   hour:  3, minute: 30 },
  { label: "4:00 AM",   hour:  4, minute:  0 },
  { label: "4:30 AM",   hour:  4, minute: 30 },
  { label: "5:00 AM",   hour:  5, minute:  0 },
  { label: "5:30 AM",   hour:  5, minute: 30 },
  { label: "6:00 AM",   hour:  6, minute:  0 },
  { label: "6:30 AM",   hour:  6, minute: 30 },
  { label: "7:00 AM",   hour:  7, minute:  0 },
  { label: "7:30 AM",   hour:  7, minute: 30 },
  { label: "8:00 AM",   hour:  8, minute:  0 },
  { label: "8:30 AM",   hour:  8, minute: 30 },
  { label: "9:00 AM",   hour:  9, minute:  0 },
  { label: "9:30 AM",   hour:  9, minute: 30 },
  { label: "10:00 AM",  hour: 10, minute:  0 },
  { label: "10:30 AM",  hour: 10, minute: 30 },
  { label: "11:00 AM",  hour: 11, minute:  0 },
  { label: "11:30 AM",  hour: 11, minute: 30 },
  { label: "12:00 PM",  hour: 12, minute:  0 },
  { label: "12:30 PM",  hour: 12, minute: 30 },
  { label: "1:00 PM",   hour: 13, minute:  0 },
  { label: "1:30 PM",   hour: 13, minute: 30 },
  { label: "2:00 PM",   hour: 14, minute:  0 },
  { label: "2:30 PM",   hour: 14, minute: 30 },
  { label: "3:00 PM",   hour: 15, minute:  0 },
  { label: "3:30 PM",   hour: 15, minute: 30 },
  { label: "4:00 PM",   hour: 16, minute:  0 },
  { label: "4:30 PM",   hour: 16, minute: 30 },
  { label: "5:00 PM",   hour: 17, minute:  0 },
  { label: "5:30 PM",   hour: 17, minute: 30 },
  { label: "6:00 PM",   hour: 18, minute:  0 },
  { label: "6:30 PM",   hour: 18, minute: 30 },
  { label: "7:00 PM",   hour: 19, minute:  0 },
  { label: "7:30 PM",   hour: 19, minute: 30 },
  { label: "8:00 PM",   hour: 20, minute:  0 },
  { label: "8:30 PM",   hour: 20, minute: 30 },
  { label: "9:00 PM",   hour: 21, minute:  0 },
  { label: "9:30 PM",   hour: 21, minute: 30 },
  { label: "10:00 PM",  hour: 22, minute:  0 },
  { label: "10:30 PM",  hour: 22, minute: 30 },
  { label: "11:00 PM",  hour: 23, minute:  0 },
  { label: "11:30 PM",  hour: 23, minute: 30 },
];
const TIME_PRESETS_FUTURE = TIME_PRESETS_WITH_NOW.filter((p) => !p.isNow);

function buildScheduledStartAt(days: number, timeIdx: number): Date | null {
  const preset = TIME_PRESETS_WITH_NOW[timeIdx];
  if (!preset) return null;
  if (preset.isNow && days === 0) return null;
  const now = new Date();
  const d = new Date(now);
  d.setDate(d.getDate() + days);
  if (preset.isNow) {
    d.setHours(now.getHours(), now.getMinutes(), 0, 0);
  } else {
    d.setHours(preset.hour, preset.minute, 0, 0);
  }
  return d;
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function buildScheduledStartAtFromDate(startDate: Date, timeIdx: number): Date | null {
  const preset = TIME_PRESETS_WITH_NOW[timeIdx];
  if (!preset) return null;
  const today = new Date();
  const isTodayDate = isSameDay(startDate, today);
  if (preset.isNow && isTodayDate) return null;
  const d = new Date(startDate);
  if (preset.isNow) {
    d.setHours(today.getHours(), today.getMinutes(), 0, 0);
  } else {
    d.setHours(preset.hour, preset.minute, 0, 0);
  }
  return d;
}

interface DurationOption { label: string; value: number }
function buildDurationOptions(startAt: Date | null): DurationOption[] {
  const instant: DurationOption = {
    label: startAt
      ? "Instant · race finishes when winners complete"
      : "Instant · race finishes first",
    value: 0,
  };
  const days: DurationOption[] = Array.from({ length: 30 }, (_, i) => {
    const n = i + 1;
    if (startAt) {
      const endDate = new Date(startAt);
      endDate.setDate(endDate.getDate() + n);
      return { label: `${n} day${n === 1 ? "" : "s"} · ends ${fmtShortDate(endDate)}, ${fmtShortTime12(endDate)}`, value: n };
    }
    return { label: `${n} day${n === 1 ? "" : "s"}`, value: n };
  });
  return [instant, ...days];
}

function StatCard({ icon, value, label, color, bg }: { icon: string; value: string; label: string; color: string; bg: string }) {
  const colors = useColors();
  return (
    <View style={[styles.statCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={[styles.statIconBox, { backgroundColor: bg }]}>
        <Feather name={icon as never} size={14} color={color} />
      </View>
      <Text style={[styles.statValue, { color: colors.foreground }]}>{value}</Text>
      <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>{label}</Text>
    </View>
  ); }

function PresenceBar({ colors }: { colors: ReturnType<typeof useColors> }) {
  const { counts, formatCount } = usePresence();
  const pulseAnim = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 0.4, duration: 700, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 700, useNativeDriver: true }),
      ])
    ).start(); }, [pulseAnim]);
  const watchLabel = counts.racing > 0 ? "Watch Live" : "Watch History";
  return (
    <TouchableOpacity
      onPress={() => router.navigate("/(tabs)/live")}
      activeOpacity={0.8}
      style={[styles.presenceBar, { backgroundColor: colors.card, borderColor: colors.border }]}
    >
      <Animated.View style={[styles.presenceLiveDot, { backgroundColor: "#FF4444", opacity: pulseAnim }]} />
      <Text style={[styles.presenceText, { color: colors.foreground }]} numberOfLines={1}>
        <Text style={{ color: "#00E676", fontWeight: "800" }}>{formatCount(counts.online)}</Text>
        <Text style={{ color: colors.mutedForeground }}> online  </Text>
        <Text style={{ color: "#00B4FF", fontWeight: "700" }}>{formatCount(counts.walking)}</Text>
        <Text style={{ color: colors.mutedForeground }}> walking  </Text>
        <Text style={{ color: "#FF4560", fontWeight: "700" }}>{formatCount(counts.racing)}</Text>
        <Text style={{ color: colors.mutedForeground }}> racing live</Text>
      </Text>
      <Text style={[styles.presenceWatchLabel, { color: colors.primary }]}>{watchLabel}</Text>
      <Feather name="chevron-right" size={14} color={colors.primary} />
    </TouchableOpacity>
  ); }

function PrizeRow({ rank, amount, split, colors }: { rank: number; amount: number; split: string; colors: ReturnType<typeof useColors> }) {
  const icons = ["🥇", "🥈", "🥉"];
  const rankColors = [colors.gold, colors.silver, colors.bronze];
  return (
    <View style={[styles.prizeRow, { backgroundColor: rankColors[rank - 1] + "15", borderColor: rankColors[rank - 1] + "30" }]}>
      <Text style={styles.prizeIcon}>{icons[rank - 1]}</Text>
      <Text style={[styles.prizePlace, { color: rankColors[rank - 1] }]}>
        {rank === 1 ? "1st" : rank === 2 ? "2nd" : "3rd"}
      </Text>
      <Text style={[styles.prizeSplit, { color: colors.mutedForeground }]}>{split} of pool</Text>
      <Text style={[styles.prizeAmt, { color: rankColors[rank - 1] }]}>${amount.toFixed(2)}</Text>
    </View>
  ); }

interface ChallengeHistoryItem {
  id: string; title: string; type: string; entryType: string; targetSteps: number;
  participantStatus: string; rank: number | null; prizeAmountCents: number; completedAt: string | null;
}

interface ServerProfileStats {
  level: number;
  levelTitle: string;
  xp: number;
  currentLevelXP: number;
  nextLevelXP: number;
  progressPercent: number;
  allTimeSteps?: number;
  dayStreak?: number;
  totalRaces?: number;
  racesWon?: number;
  top3Finishes?: number;
  winRate?: number;
  coinsEarned?: number;
  globalRank?: number;
  avatarUrl?: string | null;
  activeTitle?: ActiveTitle | null; }

async function fetchProfileStats(): Promise<ServerProfileStats | null> {
  try {
    const res = await authFetch(`/api/profile/me`);
    if (!res.ok) return null;
    const json = await res.json();
    const stats     = json.data?.stats ?? null;
    const profileId = json.data?.profile?.id ?? null;
    // Always use the proxy endpoint — OCI URL requires private bucket access
    const avatarVersion: number = json.data?.profile?.avatarVersion ?? 0;
    const avatarUrl = profileId
      ? profileAvatarImageUri(profileId, avatarVersion)
      : null;
    const activeTitle: ActiveTitle | null = json.data?.active_title ?? null;
    return stats ? { ...stats, avatarUrl, activeTitle } : null;
  } catch {
    return null;
  }
}

async function fetchProfileData(): Promise<{ fullName: string; username: string; country: string; countryFlag: string; countryCode?: string; avatarColor?: string } | null> {
  try {
    const res = await authFetch(`/api/profile/me`);
    if (!res.ok) return null;
    const json = await res.json();
    return json.data?.profile ?? null;
  } catch {
    return null;
  }
}

async function updateProfileData(updates: { fullName?: string; username?: string; avatarColor?: string }): Promise<{ success: boolean; error?: string }> {
  try {
    const res = await authFetch(`/api/profile/me`, {
      method: "PUT",
      body: JSON.stringify(updates),
    });
    const json = await res.json();
    if (!res.ok) return { success: false, error: json.error ?? "Failed to save." };
    return { success: true };
  } catch {
    return { success: false, error: "Network error. Please try again." };
  }
}


// Profile avatar upload — @/services/mediaApi

// ── Inline profile sub-pages ─────────────────────────────────────────────────
// Rendered inside ProfileModal so navigation never touches the root router.
function HelpSubpage({ colors, onBack }: { colors: ReturnType<typeof useColors>; onBack: () => void }) {
  const { safeBottom } = useSafeLayout();
  const EMAIL = "support@walkchamp.app";
  const openEmail = (subject: string) => {
    Linking.openURL(`mailto:${EMAIL}?subject=${encodeURIComponent(subject)}`)
      .catch(() => AppAlert.alert("Email Support", `Please email us at:\n${EMAIL}`));
  };
  const contacts = [
    { icon: "mail" as const,           label: "Email Support",  sub: EMAIL,                       onPress: () => openEmail("Walk Champ Support") },
    { icon: "alert-circle" as const,   label: "Report a Bug",   sub: "Describe what went wrong",  onPress: () => openEmail("Walk Champ Bug Report") },
    { icon: "message-square" as const, label: "Give Feedback",  sub: "Help us improve the app",   onPress: () => openEmail("Walk Champ Feedback") },
  ];
  const tips = [
    { q: "Steps not tracking?",      a: "Grant Step permissions. Go to Profile → Wearable Setup." },
    { q: "Challenge not showing?",   a: "Pull to refresh on the Live tab. Check your internet connection." },
    { q: "Coins balance wrong?",     a: "Coin rewards are applied after race finalization. Wait a few minutes then refresh." },
    { q: "App crashing?",            a: "Force-close and reopen the app. Contact support with your username and device model if it persists." },
    { q: "Can't deposit or withdraw?", a: "Withdrawals require identity verification. Contact support for assistance." },
  ];
  return (
    <View style={{ flex: 1 }}>
      <View style={[spStyles.header, { borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={onBack} hitSlop={12}><Feather name="arrow-left" size={22} color={colors.foreground} /></TouchableOpacity>
        <Text style={[spStyles.headerTitle, { color: colors.foreground }]}>Help & Support</Text>
        <View style={{ width: 22 }} />
      </View>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={[spStyles.body, { paddingBottom: safeBottom + 40 }]}>
        <Text style={[spStyles.sectionLabel, { color: colors.foreground }]}>Contact Us</Text>
        <View style={[spStyles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          {contacts.map((item, i) => (
            <TouchableOpacity key={item.label} activeOpacity={0.7} onPress={item.onPress}
              style={[spStyles.row, i < contacts.length - 1 && { borderBottomColor: colors.border, borderBottomWidth: StyleSheet.hairlineWidth }]}>
              <View style={[spStyles.rowIcon, { backgroundColor: colors.primary + "15" }]}><Feather name={item.icon} size={17} color={colors.primary} /></View>
              <View style={{ flex: 1 }}>
                <Text style={[spStyles.rowLabel, { color: colors.foreground }]}>{item.label}</Text>
                <Text style={[spStyles.rowSub, { color: colors.mutedForeground }]}>{item.sub}</Text>
              </View>
              <Feather name="chevron-right" size={16} color={colors.mutedForeground} />
            </TouchableOpacity>
          ))}
        </View>
        <Text style={[spStyles.sectionLabel, { color: colors.foreground }]}>Quick Troubleshooting</Text>
        <View style={[spStyles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          {tips.map((item, i) => (
            <View key={item.q} style={[spStyles.troubleRow, i < tips.length - 1 && { borderBottomColor: colors.border, borderBottomWidth: StyleSheet.hairlineWidth }]}>
              <Text style={[spStyles.troubleQ, { color: colors.foreground }]}>{item.q}</Text>
              <Text style={[spStyles.troubleA, { color: colors.mutedForeground }]}>{item.a}</Text>
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

function FAQSubpage({ colors, onBack }: { colors: ReturnType<typeof useColors>; onBack: () => void }) {
  const { safeBottom } = useSafeLayout();
  const [expanded, setExpanded] = useState<number | null>(null);
  const items = [
    { q: "How does Walk Champ track steps?", a: "Walk Champ reads your daily steps from Apple Health (iOS) or Health Connect (Android). Steps are synced automatically and stored securely on our servers." },
    { q: "How do I connect Apple Health?", a: "Go to Profile → Wearable Setup and follow the step-by-step guide." },
    { q: "How do Free Challenges work?", a: "Free challenges are step-racing competitions with no entry fee. Finish first to win coins. Join one from the Walk tab." },
    { q: "How do Coins Battle challenges work?", a: "Coins Battle challenges require a coin entry fee. The prize pool is distributed to the top finishers — 100% to 1st in a 2-player race, 60%/40% for 3 players, 50%/30%/20% for 4+." },
    { q: "How do Groups work?", a: "Groups let you compete with friends or teammates. Join or create a group in the Groups section. Daily group step totals are tracked separately from the global leaderboard." },
    { q: "How do coins work?", a: "Coins are virtual in-app items earned by walking, completing challenges, streaks, and winning races. Coins have no cash value and cannot be withdrawn." },
    { q: "Can I withdraw coins?", a: "No. Coins are virtual in-app items. They cannot be withdrawn or exchanged for real money." },
    { q: "How do I delete my account?", a: "Go to Profile → Delete Account. Confirm the action. Once deleted, your account and all data are permanently removed." },
    { q: "How do I contact support?", a: "Go to Profile → Help & Troubleshooting to email us or report an issue directly from the app." },
  ];
  return (
    <View style={{ flex: 1 }}>
      <View style={[spStyles.header, { borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={onBack} hitSlop={12}><Feather name="arrow-left" size={22} color={colors.foreground} /></TouchableOpacity>
        <Text style={[spStyles.headerTitle, { color: colors.foreground }]}>FAQ</Text>
        <View style={{ width: 22 }} />
      </View>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={[spStyles.body, { paddingBottom: safeBottom + 40 }]}>
        {items.map((item, i) => (
          <TouchableOpacity key={i} activeOpacity={0.75}
            style={[spStyles.faqItem, { backgroundColor: colors.card, borderColor: expanded === i ? colors.primary + "50" : colors.border }]}
            onPress={() => setExpanded(p => p === i ? null : i)}>
            <View style={spStyles.faqHeader}>
              <Text style={[spStyles.faqQ, { color: colors.foreground, flex: 1 }]}>{item.q}</Text>
              <Feather name={expanded === i ? "chevron-up" : "chevron-down"} size={16} color={colors.mutedForeground} />
            </View>
            {expanded === i && <Text style={[spStyles.faqA, { color: colors.mutedForeground }]}>{item.a}</Text>}
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  );
}

function LegalSubpage({ colors, onBack }: { colors: ReturnType<typeof useColors>; onBack: () => void }) {
  const { safeBottom } = useSafeLayout();
  const [openSec, setOpenSec] = useState<string | null>(null);
  const sections = [
    { id: "platform", icon: "activity" as const, title: "Skill-Based Activity Platform", body: "Walk Champ Global is a skill-based race and activity platform. All races are competitions where your result is determined entirely by your physical performance (steps). Walk Champ is NOT a gambling platform — outcomes are determined by your activity, not by chance." },
    { id: "fairplay", icon: "flag" as const, title: "Fair Play & Anti-Fraud Policy", body: "Strictly prohibited: falsified step counts, third-party apps to inflate steps, multiple accounts for unfair advantage, and coordinating with participants to manipulate results. Violations result in immediate account suspension and permanent ban." },
    { id: "coins", icon: "zap" as const, title: "Coins Battles", body: "Coins Battles are skill-based races where participants wager Walk Champ coins. The participant with the highest verified step count wins the prize pool. Coins are deducted when the race begins. Walk Champ coins have no guaranteed monetary value." },
    { id: "privacy", icon: "lock" as const, title: "Privacy & Data", body: "Walk Champ collects step count data and session metadata solely for operating the race platform and preventing fraud. We do not sell your personal data to third parties. Payout details are encrypted and visible only to authorized payment processing staff." },
    { id: "contact", icon: "mail" as const, title: "Contact & Disputes", body: "Questions, disputes, or compliance concerns:\n\nEmail: legal@walkchamp.app\nSupport: support@walkchamp.app\n\nDisputes regarding race results must be submitted within 7 days of race completion. Walk Champ's decision on disputes is final." },
  ];
  return (
    <View style={{ flex: 1 }}>
      <View style={[spStyles.header, { borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={onBack} hitSlop={12}><Feather name="arrow-left" size={22} color={colors.foreground} /></TouchableOpacity>
        <Text style={[spStyles.headerTitle, { color: colors.foreground }]}>Terms & Privacy</Text>
        <View style={{ width: 22 }} />
      </View>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={[spStyles.body, { paddingBottom: safeBottom + 40 }]}>
        {sections.map(s => (
          <View key={s.id} style={[spStyles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <TouchableOpacity style={spStyles.sectionHeader} activeOpacity={0.75} onPress={() => setOpenSec(p => p === s.id ? null : s.id)}>
              <View style={[spStyles.rowIcon, { backgroundColor: colors.primary + "18" }]}><Feather name={s.icon} size={17} color={colors.primary} /></View>
              <Text style={[spStyles.rowLabel, { flex: 1, color: colors.foreground }]}>{s.title}</Text>
              <Feather name={openSec === s.id ? "chevron-up" : "chevron-down"} size={16} color={colors.mutedForeground} />
            </TouchableOpacity>
            {openSec === s.id && (
              <View style={[spStyles.sectionBody, { borderTopColor: colors.border }]}>
                <Text style={[spStyles.sectionText, { color: colors.mutedForeground }]}>{s.body}</Text>
              </View>
            )}
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const spStyles = StyleSheet.create({
  header:       { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: StyleSheet.hairlineWidth },
  headerTitle:  { fontSize: 17, fontWeight: "700" },
  body:         { paddingHorizontal: 16, paddingTop: 16, gap: 12 },
  sectionLabel: { fontSize: 15, fontWeight: "800" },
  card:         { borderRadius: 14, borderWidth: 1, overflow: "hidden" },
  row:          { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 14, gap: 14 },
  rowIcon:      { width: 34, height: 34, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  rowLabel:     { fontSize: 14, fontWeight: "600" },
  rowSub:       { fontSize: 12, marginTop: 1 },
  troubleRow:   { paddingHorizontal: 16, paddingVertical: 12, gap: 4 },
  troubleQ:     { fontSize: 14, fontWeight: "600" },
  troubleA:     { fontSize: 13, lineHeight: 18 },
  faqItem:      { borderRadius: 14, borderWidth: 1, padding: 16, gap: 10 },
  faqHeader:    { flexDirection: "row", alignItems: "center", gap: 10 },
  faqQ:         { fontSize: 14, fontWeight: "600", lineHeight: 20 },
  faqA:         { fontSize: 13, lineHeight: 20 },
  sectionHeader:{ flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 14, paddingVertical: 13 },
  sectionBody:  { borderTopWidth: StyleSheet.hairlineWidth, paddingHorizontal: 14, paddingVertical: 12 },
  sectionText:  { fontSize: 13, lineHeight: 20 },
});

const AVATAR_COLORS = [
  "#00E676", "#00B4FF", "#06B6D4", "#FFD700",
  "#FF6B35", "#A855F7", "#F472B6", "#34D399",
];

// ─────────────────────────────────────────────────────────────────────────────
function ProfileModal({ visible, onClose, user, walletBalance, userRank, todaySteps, allTimeSteps, currentStreak, logout, colors }: {
  visible: boolean; onClose: () => void;
  user: ReturnType<typeof useAuth>["user"];
  walletBalance: number; userRank: number;
  todaySteps: number; allTimeSteps: number; currentStreak: number;
  logout: () => Promise<void>;
  colors: ReturnType<typeof useColors>; }) {
  const { safeBottom } = useSafeLayout();
  const { refreshUserProfile, updateUser } = useAuth();
  const { requestStepPermission } = useWalkContext();
  const ac = user?.avatarColor ?? colors.primary;

  // Avatar + server stats
  const [profileStats,    setProfileStats]    = useState<ServerProfileStats | null>(null);
  const [avatarUrl,       setAvatarUrl]       = useState<string | null>(null);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);

  // Titles
  const [activeTitle,     setActiveTitle]     = useState<ActiveTitle | null>(null);
  const [showTitlesModal, setShowTitlesModal] = useState(false);

  // New data state
  const [challengeHistory,  setChallengeHistory]  = useState<ChallengeHistoryItem[]>([]);
  const [last7Days,         setLast7Days]         = useState<{ date: string; steps: number }[]>([]);
  const [stepSourceInfo,    setStepSourceInfo]    = useState<{ platform: string; permissionStatus: string; setupCompleted: boolean } | null>(null);
  const [showWearableSetup, setShowWearableSetup] = useState(false);
  const [deleteLoading,     setDeleteLoading]     = useState(false);

  // Sign-out confirmation overlay (rendered inside the modal so it works on iOS)
  const [showSignOutConfirm, setShowSignOutConfirm] = useState(false);
  const confirmOpacity = useRef(new Animated.Value(0)).current;
  const confirmScale   = useRef(new Animated.Value(0.92)).current;

  // Delete-account confirmation overlay
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const deleteConfirmOpacity = useRef(new Animated.Value(0)).current;
  const deleteConfirmScale   = useRef(new Animated.Value(0.92)).current;

  // Inline sub-page state — reset to "main" whenever the modal closes
  const [profilePage, setProfilePage] = useState<"main" | "help" | "faq" | "legal">("main");
  useEffect(() => { if (!visible) setProfilePage("main"); }, [visible]);

  // Local rank from profile fetch (real all-time global rank from the API)
  const [profileRank, setProfileRank] = useState<number>(userRank);

  useEffect(() => {
    if (showSignOutConfirm) {
      Animated.parallel([
        Animated.timing(confirmOpacity, { toValue: 1, duration: 180, useNativeDriver: true }),
        Animated.spring(confirmScale,   { toValue: 1,  friction: 8, tension: 100, useNativeDriver: true }),
      ]).start();
    } else {
      confirmOpacity.setValue(0);
      confirmScale.setValue(0.92);
    }
  }, [showSignOutConfirm, confirmOpacity, confirmScale]);

  useEffect(() => {
    if (showDeleteConfirm) {
      Animated.parallel([
        Animated.timing(deleteConfirmOpacity, { toValue: 1, duration: 180, useNativeDriver: true }),
        Animated.spring(deleteConfirmScale,   { toValue: 1,  friction: 8, tension: 100, useNativeDriver: true }),
      ]).start();
    } else {
      deleteConfirmOpacity.setValue(0);
      deleteConfirmScale.setValue(0.92);
    }
  }, [showDeleteConfirm, deleteConfirmOpacity, deleteConfirmScale]);

  // Inline edit state
  const [isEditing,     setIsEditing]     = useState(false);
  const [editLoading,   setEditLoading]   = useState(false);
  const [saving,        setSaving]        = useState(false);
  const [fullName,      setFullName]      = useState("");
  const [username,      setUsername]      = useState("");
  const [country,       setCountry]       = useState("");
  const [countryFlag,   setCountryFlag]   = useState("");
  const [usernameError, setUsernameError] = useState("");
  const [avatarColor,   setAvatarColor]   = useState(AVATAR_COLORS[0]);

  const [showAvatarPicker, setShowAvatarPicker] = useState(false);

  // Settings toggles
  const { soundEnabled, setSoundEnabled } = useSound();
  const { isDark: darkTheme, toggleTheme } = useTheme();

  // Push notification toggle
  const [pushEnabled, setPushEnabled] = useState<boolean>(true);
  const [pushLoading, setPushLoading] = useState(false);

  useEffect(() => {
    if (!visible) return;
    void getNotificationPreferences().then((enabled) => setPushEnabled(enabled)).catch(() => {});
  }, [visible]);

  const handlePushToggle = useCallback(async () => {
    if (pushLoading) return;
    setPushLoading(true);
    try {
      if (!pushEnabled) {
        const granted = await requestNotificationPermission();
        if (!granted) {
          AppAlert.alert(
            "Permission Required",
            "Push notifications are blocked. Please enable them in Settings.",
            [{ text: "Open Settings", onPress: () => Linking.openSettings() }, { text: "Cancel" }]
          );
          setPushLoading(false);
          return;
        }
        await optInNotifications();
        await setNotificationPreferences(true);
        await registerDeviceWithBackend();
        setPushEnabled(true);
      } else {
        await optOutNotifications();
        await setNotificationPreferences(false);
        setPushEnabled(false);
      }
    } catch {
      // ignore
    }
    setPushLoading(false);
  }, [pushEnabled, pushLoading]);

  useEffect(() => {
    if (!visible) { setIsEditing(false); return; }
    void (async () => {
      const res = await authFetch("/api/profile/me").catch(() => null);
      if (!res?.ok) return;
      const json = await res.json().catch(() => ({}));
      const stats = json.data?.stats ?? null;
      if (stats) {
        const profileId = json.data?.profile?.id ?? null;
        const avatarVersion: number = json.data?.profile?.avatarVersion ?? 0;
        const url = profileId
          ? profileAvatarImageUri(profileId, avatarVersion)
          : null;
        const title: ActiveTitle | null = json.data?.active_title ?? null;
        setProfileStats({ ...stats, avatarUrl: url, activeTitle: title });
        setAvatarUrl(url);
        setActiveTitle(title);
        if (typeof stats.globalRank === "number") setProfileRank(stats.globalRank);
      }
      if (Array.isArray(json.data?.challengeHistory)) setChallengeHistory(json.data.challengeHistory);
      {
        // Always build a guaranteed 7-day window (oldest→newest), filling gaps
        // with 0 so the chart is never empty. Today's bar uses the local step
        // count when it exceeds what the server has (session not yet synced).
        const todayKey = new Date().toISOString().slice(0, 10);
        const backendDays: { date: string; steps: number }[] =
          Array.isArray(json.data?.last7Days) ? json.data.last7Days : [];
        const backendMap = new Map(
          backendDays.map((d: { date: string; steps: number }) => [d.date, d.steps])
        );
        const complete7Days = Array.from({ length: 7 }, (_, i) => {
          const d = new Date();
          d.setDate(d.getDate() - (6 - i)); // i=0 → 6 days ago, i=6 → today
          const key = d.toISOString().slice(0, 10);
          const serverSteps = backendMap.get(key) ?? 0;
          return {
            date: key,
            steps: key === todayKey ? Math.max(serverSteps, todaySteps) : serverSteps,
          };
        });
        setLast7Days(complete7Days);
      }
      if (json.data?.stepSource !== undefined) setStepSourceInfo(json.data.stepSource);
    })();
  }, [visible]);

  // Sync avatar URL from Redux whenever the user uploads a new photo on any screen
  useEffect(() => {
    if (uploadingAvatar) return;
    if (user?.id && user?.profileImageUrl) {
      setAvatarUrl(profileAvatarImageUri(user.id, user?.avatarVersion ?? 0));
    } else if (!user?.profileImageUrl) {
      setAvatarUrl(null); } }, [user?.id, user?.profileImageUrl, user?.avatarVersion, uploadingAvatar]);

  // Load editable fields when edit panel opens
  useEffect(() => {
    if (!isEditing) return;
    setEditLoading(true);
    fetchProfileData().then((p) => {
      if (p) {
        setFullName(p.fullName ?? "");
        setUsername(p.username ?? "");
        setCountry(p.country ?? "");
        setCountryFlag(p.countryFlag ?? "");
        if (p.avatarColor && AVATAR_COLORS.includes(p.avatarColor)) setAvatarColor(p.avatarColor); }
      setEditLoading(false); }); }, [isEditing]);

  const validateUsername = useCallback((val: string) => {
    if (!val) { setUsernameError(""); return; }
    const re = /^[a-zA-Z][a-zA-Z0-9_]{5,13}$/;
    setUsernameError(re.test(val) ? "" : "6–14 chars, start with a letter, letters/numbers/_ only"); }, []);

  const handleSave = async () => {
    if (usernameError) return;
    setSaving(true);
    const result = await updateProfileData({ fullName, username, avatarColor });
    setSaving(false);
    if (!result.success) { AppAlert.alert("Error", result.error ?? "Failed to save."); return; }
    await refreshUserProfile();
    AppAlert.alert("Saved!", "Your profile has been updated.", [{ text: "OK", onPress: () => setIsEditing(false) }]); };

  const handlePickAndUpload = async (uri: string, mimeType?: string) => {
    setAvatarUrl(uri);
    setUploadingAvatar(true);
    const result = await uploadProfileAvatar(uri, mimeType);
    if (result) {
      setAvatarUrl(result.imageUri);
      updateUser({
        profileImageUrl: result.avatarUrl || result.displayUrl,
        avatarVersion: result.avatarVersion,
      });
      refreshUserProfile().catch(() => {});
    } else {
      AppAlert.alert("Error", "Could not upload photo. Please try again.");
    }
    setUploadingAvatar(false);
  };

  // AvatarPickerSheet dismisses with a 450 ms delay on iOS (200 ms slide-out
  // animation + 250 ms buffer) before invoking these handlers, ensuring the
  // view hierarchy is fully settled before the system picker is presented.
  // The parent ProfileModal stays open — the picker is presented from it.
  const handleTakePhoto = async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      AppAlert.alert(
        "Camera Permission Required",
        "Walk Champ needs camera access to take a photo. Please allow it when prompted or enable it in Settings.",
        [
          { text: "Not Now", style: "cancel" },
          { text: "Open Settings", onPress: () => Linking.openSettings() },
        ]
      );
      return;
    }
    try {
      // allowsEditing crashes silently on iOS with New Architecture (newArchEnabled: true) in Expo SDK 54
      const result = await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], allowsEditing: Platform.OS !== "ios", aspect: [1, 1], quality: 0.8, exif: false });
      if (!result.canceled && result.assets[0]) await handlePickAndUpload(result.assets[0].uri, normalizeMime(result.assets[0].mimeType));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.toLowerCase().includes("camera not available")) {
        AppAlert.alert("Camera Unavailable", "Your device does not have an accessible camera.");
      } else {
        AppAlert.alert("Error", "Could not open camera. Please try again.");
      }
    }
  };

  const handleChoosePhoto = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    // "limited" = user granted access to selected photos only (iOS 14+) — still valid
    if (!perm.granted && (perm.status as string) !== "limited") {
      AppAlert.alert(
        "Photo Library Permission Required",
        "Walk Champ needs access to your photo library. Please allow it when prompted or enable it in Settings.",
        [
          { text: "Not Now", style: "cancel" },
          { text: "Open Settings", onPress: () => Linking.openSettings() },
        ]
      );
      return;
    }
    try {
      // allowsEditing crashes silently on iOS with New Architecture (newArchEnabled: true) in Expo SDK 54
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], allowsEditing: Platform.OS !== "ios", aspect: [1, 1], quality: 0.8, exif: false });
      if (!result.canceled && result.assets[0]) await handlePickAndUpload(result.assets[0].uri, normalizeMime(result.assets[0].mimeType));
    } catch (err: unknown) {
      AppAlert.alert("Error", "Could not open photo library. Please try again.");
    }
  };

  const handleRemovePhoto = async () => {
    setUploadingAvatar(true);
    const result = await deleteProfileAvatar();
    setAvatarUrl(null);
    updateUser({
      profileImageUrl: null,
      avatarVersion: result.avatarVersion ?? 0,
    });
    refreshUserProfile().catch(() => {});
    setUploadingAvatar(false);
  };

  const handleAvatarPress = () => {
    setShowAvatarPicker(true); };

  const handleDeleteAccount = useCallback(() => {
    setShowDeleteConfirm(true);
  }, []);

  const dismissDeleteConfirm = useCallback((confirmed: boolean) => {
    Animated.timing(deleteConfirmOpacity, { toValue: 0, duration: 130, useNativeDriver: true }).start(() => {
      setShowDeleteConfirm(false);
      if (!confirmed) return;
      setDeleteLoading(true);
      void (async () => {
        try {
          const res = await authFetch("/api/me/account", { method: "DELETE" });
          if (res.ok) {
            onClose();
            await logout();
          } else {
            const j = await res.json().catch(() => ({})) as { error?: string };
            AppAlert.alert("Error", j.error ?? "Failed to delete account. Please contact support.");
          }
        } catch {
          AppAlert.alert("Error", "Network error. Please try again.");
        } finally {
          setDeleteLoading(false);
        }
      })();
    });
  }, [deleteConfirmOpacity, logout, onClose]);

  const handleLogout = () => {
    setShowSignOutConfirm(true);
  };

  const dismissSignOutConfirm = (confirmed: boolean) => {
    Animated.timing(confirmOpacity, { toValue: 0, duration: 130, useNativeDriver: true }).start(() => {
      setShowSignOutConfirm(false);
      if (confirmed) { onClose(); logout(); }
    });
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet"
      onRequestClose={() => { if (profilePage !== "main") { setProfilePage("main"); } else { onClose(); } }}>
      <SafeAreaView
        edges={["top", "left", "right", "bottom"]}
        style={[pmStyles.container, { backgroundColor: colors.background }]}
      >
        <View style={[pmStyles.handle, { backgroundColor: colors.border }]} />

        {profilePage !== "main" ? (
          profilePage === "help" ? <HelpSubpage colors={colors} onBack={() => setProfilePage("main")} /> :
          profilePage === "faq"  ? <FAQSubpage  colors={colors} onBack={() => setProfilePage("main")} /> :
                                   <LegalSubpage colors={colors} onBack={() => setProfilePage("main")} />
        ) : (<>

        {/* Header: X close | title | edit pencil/X */}
        <View style={[pmStyles.header, { borderBottomColor: colors.border }]}>
          <TouchableOpacity onPress={onClose} hitSlop={12}>
            <Feather name="x" size={22} color={colors.foreground} />
          </TouchableOpacity>
          <Text style={[pmStyles.headerTitle, { color: colors.foreground }]}>My Profile</Text>
          <TouchableOpacity
            hitSlop={12}
            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setIsEditing((e) => !e); setUsernameError(""); }}
            style={[pmStyles.editToggleBtn, { backgroundColor: isEditing ? colors.primary + "20" : "transparent", borderColor: isEditing ? colors.primary : colors.border }]}
          >
            <Feather name={isEditing ? "x" : "edit-2"} size={17} color={isEditing ? colors.primary : colors.mutedForeground} />
          </TouchableOpacity>
        </View>

        <ScrollView
          contentContainerStyle={[pmStyles.body, { paddingBottom: safeBottom + rs(48) }]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* Avatar */}
          <View style={pmStyles.avatarSection}>
            <TouchableOpacity onPress={handleAvatarPress} disabled={uploadingAvatar} activeOpacity={0.8} style={pmStyles.avatarWrapper}>
              <View style={[pmStyles.avatar, { backgroundColor: ac + "25", borderColor: ac }]}>
                {avatarUrl ? (
                  <Image source={{ uri: avatarUrl }} style={pmStyles.avatarImg} />
                ) : (
                  <Text style={[pmStyles.avatarText, { color: ac }]}>{(user?.fullName ?? "W").charAt(0).toUpperCase()}</Text>
                )}
                {uploadingAvatar && (
                  <View style={pmStyles.avatarOverlay}>
                    <ActivityIndicator size="small" color="#fff" />
                  </View>
                )}
              </View>
              <View style={[pmStyles.avatarCameraBtn, { backgroundColor: colors.primary, borderColor: colors.background }]}>
                <Feather name="camera" size={11} color="#000" />
              </View>
            </TouchableOpacity>
            <Text style={[pmStyles.fullName, { color: colors.foreground }]}>{user?.fullName ?? "Walker"}</Text>
            <Text style={[pmStyles.username, { color: colors.mutedForeground }]}>@{user?.username ?? "user"}</Text>
            <View style={pmStyles.flagRow}>
              <Text style={pmStyles.flag}>{user?.countryFlag ?? "🌍"}</Text>
              <Text style={[pmStyles.country, { color: colors.mutedForeground }]}>{user?.country ?? "Global"}</Text>
            </View>
          </View>

          {/* ── Inline Edit Panel ── */}
          {isEditing && (
            <View style={[pmStyles.editPanel, { backgroundColor: colors.card, borderColor: colors.border }]}>
              {editLoading ? (
                <SkeletonInlineEditForm />
              ) : (
                <>
                  {/* Full Name */}
                  <View style={pmStyles.editField}>
                    <Text style={[pmStyles.editLabel, { color: colors.mutedForeground }]}>FULL NAME</Text>
                    <TextInput
                      style={[pmStyles.editInput, { backgroundColor: colors.background, borderColor: colors.border, color: colors.foreground }]}
                      value={fullName}
                      onChangeText={setFullName}
                      placeholder="Your full name"
                      placeholderTextColor={colors.mutedForeground}
                      maxLength={100}
                      autoCapitalize="words"
                    />
                  </View>
                  {/* Username */}
                  <View style={pmStyles.editField}>
                    <Text style={[pmStyles.editLabel, { color: colors.mutedForeground }]}>USERNAME</Text>
                    <View style={[pmStyles.editInputRow, { backgroundColor: colors.background, borderColor: usernameError ? colors.destructive : colors.border }]}>
                      <Text style={[pmStyles.atSign, { color: colors.mutedForeground }]}>@</Text>
                      <TextInput
                        style={[pmStyles.editInputInner, { color: colors.foreground }]}
                        value={username}
                        onChangeText={(v) => { setUsername(v); validateUsername(v); }}
                        placeholder="username"
                        placeholderTextColor={colors.mutedForeground}
                        maxLength={14}
                        autoCapitalize="none"
                        autoCorrect={false}
                      />
                    </View>
                    <Text style={[pmStyles.editHint, { color: usernameError ? colors.destructive : colors.mutedForeground }]}>
                      {usernameError || "6–14 chars · letters, numbers, underscores"}
                    </Text>
                  </View>
                  {/* Country (read-only) */}
                  <View style={[pmStyles.editCountryRow, { backgroundColor: colors.background, borderColor: colors.border }]}>
                    <Text style={{ fontSize: 26 }}>{countryFlag}</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={[pmStyles.editLabel, { color: colors.mutedForeground }]}>COUNTRY</Text>
                      <Text style={[{ fontSize: 15, fontWeight: "600", color: colors.foreground }]}>{country || "Not set"}</Text>
                    </View>
                    <Text style={[pmStyles.editHint, { color: colors.mutedForeground, textAlign: "right" }]}>Contact support{"\n"}to change</Text>
                  </View>
                  {/* Profile Color */}
                  <View style={pmStyles.editField}>
                    <Text style={[pmStyles.editLabel, { color: colors.mutedForeground }]}>PROFILE COLOR</Text>
                    <View style={pmStyles.editColorRow}>
                      {AVATAR_COLORS.map((c) => (
                        <TouchableOpacity
                          key={c}
                          onPress={() => setAvatarColor(c)}
                          style={[
                            pmStyles.editColorDot,
                            { backgroundColor: c },
                            avatarColor === c && { borderWidth: 3, borderColor: "#fff", shadowColor: c, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.9, shadowRadius: 6, elevation: 6 },
                          ]}
                        />
                      ))}
                    </View>
                    <Text style={[pmStyles.editHint, { color: colors.mutedForeground }]}>
                      Appears as your ring in Live Races &amp; leaderboards
                    </Text>
                  </View>
                  {/* Actions */}
                  <View style={pmStyles.editActions}>
                    <TouchableOpacity
                      style={[pmStyles.editCancelBtn, { borderColor: colors.border }]}
                      onPress={() => { setIsEditing(false); setUsernameError(""); }}
                    >
                      <Text style={[pmStyles.editCancelText, { color: colors.mutedForeground }]}>Cancel</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[pmStyles.editSaveBtn, { backgroundColor: colors.primary, opacity: saving || !!usernameError ? 0.5 : 1 }]}
                      onPress={handleSave}
                      disabled={saving || !!usernameError}
                    >
                      {saving ? <ActivityIndicator size="small" color="#000" /> : <Text style={pmStyles.editSaveText}>Save</Text>}
                    </TouchableOpacity>
                  </View>
                </>
              )}
            </View>
          )}

          {/* Achievements card — tap to open My Titles */}
          <TouchableOpacity
            style={[pmStyles.achievementsCard, { backgroundColor: colors.card, borderColor: colors.primary + "35" }]}
            onPress={() => setShowTitlesModal(true)}
            activeOpacity={0.75}
          >
            <View style={[pmStyles.achievementsIcon, { backgroundColor: colors.primary + "20" }]}>
              <Feather name="award" size={20} color={colors.primary} />
            </View>
            <View style={pmStyles.achievementsInfo}>
              <Text style={[pmStyles.achievementsLabel, { color: colors.foreground }]}>Achievements</Text>
              {activeTitle ? (
                <View style={{ flexDirection: "row", alignItems: "center", gap: 5, marginTop: 1 }}>
                  <TitleBadge code={activeTitle.code} difficulty={activeTitle.difficulty} size={16} />
                  <Text style={[pmStyles.achievementsSubtext, { color: difficultyColor(activeTitle.difficulty, colors) }]}>
                    {activeTitle.title}
                  </Text>
                </View>
              ) : (
                <Text style={[pmStyles.achievementsSubtext, { color: colors.mutedForeground }]}>Tap to view &amp; equip titles</Text>
              )}
            </View>
            <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
          </TouchableOpacity>

          {/* ── Stats Row 1: Race stats ── */}
          <View style={pmStyles.statsGrid}>
            {([
              { label: "Races Played",   value: (profileStats?.totalRaces ?? 0).toString(), color: colors.primary },
              { label: "Race Wins 🏆",   value: (profileStats?.racesWon   ?? 0).toString(), color: colors.gold },
              { label: "Win Rate",       value: `${profileStats?.winRate ?? 0}%`,            color: colors.accent },
            ]).map((s) => (
              <View key={s.label} style={[pmStyles.statCard, { backgroundColor: colors.card, borderColor: s.color + "40" }]}>
                <Text style={[pmStyles.statValue, { color: s.color }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>{s.value}</Text>
                <Text style={[pmStyles.statLabel, { color: colors.mutedForeground }]}>{s.label}</Text>
              </View>
            ))}
          </View>

          {/* ── Stats Row 2: Step/activity stats ── */}
          <View style={pmStyles.statsGrid}>
            {([
              { label: "Total Steps",  value: (profileStats?.allTimeSteps ?? allTimeSteps ?? 0).toLocaleString(), color: colors.primary },
              { label: "Day Streak",   value: `${profileStats?.dayStreak ?? currentStreak ?? 0}d`,               color: colors.destructive },
              { label: "Global Rank",  value: `#${profileRank}`,                                                  color: colors.gold },
              { label: "Coins Earned", value: (profileStats?.coinsEarned ?? 0).toLocaleString(),                  color: "#FFD700" },
            ]).map((s) => (
              <View key={s.label} style={[pmStyles.statCard, { backgroundColor: colors.card, borderColor: s.color + "30" }]}>
                <Text style={[pmStyles.statValue, { color: s.color }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>{s.value}</Text>
                <Text style={[pmStyles.statLabel, { color: colors.mutedForeground }]}>{s.label}</Text>
              </View>
            ))}
          </View>

          {/* ── Wearable / Step Tracking Status ── */}
          <TouchableOpacity
            style={[pmStyles.actionBtn, {
              backgroundColor: stepSourceInfo?.permissionStatus === "connected" ? "#00E67610" :
                               stepSourceInfo?.permissionStatus === "denied"    ? colors.destructive + "10" : colors.card,
              borderColor:     stepSourceInfo?.permissionStatus === "connected" ? "#00E67635" :
                               stepSourceInfo?.permissionStatus === "denied"    ? colors.destructive + "30" : colors.border,
            }]}
            onPress={() => setShowWearableSetup(true)}
            activeOpacity={0.8}
          >
            <View style={[pmStyles.toggleIcon, { backgroundColor: stepSourceInfo?.permissionStatus === "connected" ? "#00E67618" : colors.primary + "18" }]}>
              <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor:
                stepSourceInfo?.permissionStatus === "connected" ? "#00E676" :
                stepSourceInfo?.permissionStatus === "denied"    ? colors.destructive : "#FFD700" }} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[pmStyles.actionBtnText, { color: colors.foreground }]}>
                {stepSourceInfo?.permissionStatus === "connected" ? "Step tracking connected" :
                 stepSourceInfo?.permissionStatus === "denied"    ? "Steps permission denied" : "Set up step tracking"}
              </Text>
              <Text style={{ fontSize: 12, color: colors.mutedForeground, marginTop: 1 }}>
                {stepSourceInfo?.permissionStatus === "connected"
                  ? `${Platform.OS === "ios" ? "Apple Health" : "Health Connect"} is syncing`
                  : `Tap to connect ${Platform.OS === "ios" ? "Apple Health" : "Health Connect"}`}
              </Text>
            </View>
            <Feather name="chevron-right" size={16} color={colors.mutedForeground} />
          </TouchableOpacity>


          {/* ── Preferences ── */}
          <View style={[pmStyles.settingsList, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={[pmStyles.toggleRow, { borderBottomColor: colors.border, borderBottomWidth: StyleSheet.hairlineWidth }]}>
              <View style={[pmStyles.toggleIcon, { backgroundColor: colors.accent + "18" }]}>
                <Feather name="volume-2" size={17} color={colors.accent} />
              </View>
              <Text style={[pmStyles.toggleLabel, { color: colors.foreground }]}>Vibration</Text>
              <Switch value={soundEnabled} onValueChange={(v) => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setSoundEnabled(v); }}
                trackColor={{ false: colors.border, true: colors.primary + "80" }}
                thumbColor={soundEnabled ? colors.primary : colors.mutedForeground}
                ios_backgroundColor={colors.border}
              />
            </View>
            <View style={[pmStyles.toggleRow, { borderBottomColor: colors.border, borderBottomWidth: StyleSheet.hairlineWidth }]}>
              <View style={[pmStyles.toggleIcon, { backgroundColor: colors.neonBlue + "18" }]}>
                <Feather name={darkTheme ? "moon" : "sun"} size={17} color={colors.neonBlue} />
              </View>
              <Text style={[pmStyles.toggleLabel, { color: colors.foreground }]}>{darkTheme ? "Dark Mode" : "Light Mode"}</Text>
              <Switch value={darkTheme} onValueChange={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); toggleTheme(); }}
                trackColor={{ false: colors.border, true: colors.neonBlue + "80" }}
                thumbColor={darkTheme ? colors.neonBlue : colors.mutedForeground}
                ios_backgroundColor={colors.border}
              />
            </View>
            <View style={[pmStyles.toggleRow]}>
              <View style={[pmStyles.toggleIcon, { backgroundColor: colors.accent + "18" }]}>
                <Feather name="bell" size={17} color={colors.accent} />
              </View>
              <Text style={[pmStyles.toggleLabel, { color: colors.foreground }]}>Push Notifications</Text>
              {pushLoading
                ? <ActivityIndicator size="small" color={colors.accent} />
                : <Switch value={pushEnabled} onValueChange={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); void handlePushToggle(); }}
                    trackColor={{ false: colors.border, true: colors.accent + "80" }}
                    thumbColor={pushEnabled ? colors.accent : colors.mutedForeground}
                    ios_backgroundColor={colors.border}
                  />}
            </View>
          </View>

          {/* ── Wallet & Rewards ── */}
          <View style={[pmStyles.settingsList, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <TouchableOpacity
              style={[pmStyles.toggleRow]}
              onPress={async () => {
                const url = process.env.EXPO_PUBLIC_APP_INVITE_URL ?? "https://walkchamp.app/invite";
                try {
                  await Share.share({ title: "Join Walk Champ", message: `Join me on Walk Champ!\n${url}`, url });
                } catch {}
              }}
            >
              <View style={[pmStyles.toggleIcon, { backgroundColor: colors.gold + "18" }]}>
                <Feather name="gift" size={17} color={colors.gold} />
              </View>
              <Text style={[pmStyles.toggleLabel, { color: colors.foreground }]}>Invite Friends & Earn</Text>
              <Feather name="chevron-right" size={16} color={colors.mutedForeground} />
            </TouchableOpacity>
          </View>

          {/* ── Support & Legal ── */}
          <View style={[pmStyles.settingsList, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <TouchableOpacity
              style={[pmStyles.toggleRow, { borderBottomColor: colors.border, borderBottomWidth: StyleSheet.hairlineWidth }]}
              onPress={() => setProfilePage("help")}
            >
              <View style={[pmStyles.toggleIcon, { backgroundColor: colors.primary + "18" }]}>
                <Feather name="help-circle" size={17} color={colors.primary} />
              </View>
              <Text style={[pmStyles.toggleLabel, { color: colors.foreground }]}>Help & Troubleshooting</Text>
              <Feather name="chevron-right" size={16} color={colors.mutedForeground} />
            </TouchableOpacity>
            <TouchableOpacity
              style={[pmStyles.toggleRow, { borderBottomColor: colors.border, borderBottomWidth: StyleSheet.hairlineWidth }]}
              onPress={() => setProfilePage("faq")}
            >
              <View style={[pmStyles.toggleIcon, { backgroundColor: colors.accent + "18" }]}>
                <Feather name="message-circle" size={17} color={colors.accent} />
              </View>
              <Text style={[pmStyles.toggleLabel, { color: colors.foreground }]}>FAQ</Text>
              <Feather name="chevron-right" size={16} color={colors.mutedForeground} />
            </TouchableOpacity>
            <TouchableOpacity
              style={[pmStyles.toggleRow]}
              onPress={() => setProfilePage("legal")}
            >
              <View style={[pmStyles.toggleIcon, { backgroundColor: colors.mutedForeground + "18" }]}>
                <Feather name="file-text" size={17} color={colors.mutedForeground} />
              </View>
              <Text style={[pmStyles.toggleLabel, { color: colors.foreground }]}>Terms & Privacy</Text>
              <Feather name="chevron-right" size={16} color={colors.mutedForeground} />
            </TouchableOpacity>
          </View>

          {/* ── Account ── */}
          <View style={[pmStyles.settingsList, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <TouchableOpacity
              style={[pmStyles.toggleRow, { borderBottomColor: colors.border, borderBottomWidth: StyleSheet.hairlineWidth }]}
              onPress={handleLogout}
            >
              <View style={[pmStyles.toggleIcon, { backgroundColor: colors.destructive + "18" }]}>
                <Feather name="log-out" size={17} color={colors.destructive} />
              </View>
              <Text style={[pmStyles.toggleLabel, { color: colors.destructive }]}>Sign Out</Text>
              <Feather name="chevron-right" size={16} color={colors.destructive} />
            </TouchableOpacity>
            <TouchableOpacity
              style={[pmStyles.toggleRow]}
              onPress={handleDeleteAccount}
              disabled={deleteLoading}
            >
              <View style={[pmStyles.toggleIcon, { backgroundColor: colors.destructive + "10" }]}>
                {deleteLoading
                  ? <ActivityIndicator size="small" color={colors.destructive} />
                  : <Feather name="trash-2" size={17} color={colors.destructive} />}
              </View>
              <Text style={[pmStyles.toggleLabel, { color: colors.destructive, opacity: 0.8 }]}>Delete Account</Text>
              <Feather name="chevron-right" size={16} color={colors.destructive} />
            </TouchableOpacity>
          </View>
        </ScrollView>

        {/* ── Sign-out confirmation overlay (inside modal — works on iOS) ── */}
        {showSignOutConfirm && (
          <Animated.View style={[soStyles.overlay, { opacity: confirmOpacity }]}>
            <Pressable style={StyleSheet.absoluteFill} onPress={() => dismissSignOutConfirm(false)} />
            <Animated.View style={[soStyles.card, { backgroundColor: colors.card, borderColor: colors.border, transform: [{ scale: confirmScale }] }]}>
              <View style={soStyles.body}>
                <Text style={[soStyles.title, { color: colors.foreground }]}>Sign Out</Text>
                <Text style={[soStyles.message, { color: colors.mutedForeground }]}>Are you sure you want to sign out?</Text>
              </View>
              <View style={[soStyles.divider, { backgroundColor: colors.border }]} />
              <View style={soStyles.buttons}>
                <Pressable
                  style={[soStyles.btn, soStyles.btnHalf, { backgroundColor: colors.background, borderColor: colors.border, borderWidth: 1 }]}
                  onPress={() => dismissSignOutConfirm(false)}
                >
                  <Text style={[soStyles.btnText, { color: colors.foreground }]}>Cancel</Text>
                </Pressable>
                <Pressable
                  style={[soStyles.btn, soStyles.btnHalf, { backgroundColor: colors.destructive }]}
                  onPress={() => dismissSignOutConfirm(true)}
                >
                  <Text style={[soStyles.btnText, { color: "#fff" }]}>Sign Out</Text>
                </Pressable>
              </View>
            </Animated.View>
          </Animated.View>
        )}

        {showDeleteConfirm && (
          <Animated.View style={[soStyles.overlay, { opacity: deleteConfirmOpacity }]}>
            <Pressable style={StyleSheet.absoluteFill} onPress={() => dismissDeleteConfirm(false)} />
            <Animated.View style={[soStyles.card, { backgroundColor: colors.card, borderColor: colors.border, transform: [{ scale: deleteConfirmScale }] }]}>
              <View style={soStyles.body}>
                <Text style={[soStyles.title, { color: colors.foreground }]}>Delete Account</Text>
                <Text style={[soStyles.message, { color: colors.mutedForeground }]}>
                  This permanently erases your profile, steps, coins, races, and achievements. There is no recovery option.
                </Text>
              </View>
              <View style={[soStyles.divider, { backgroundColor: colors.border }]} />
              <View style={soStyles.buttons}>
                <Pressable
                  style={[soStyles.btn, soStyles.btnHalf, { backgroundColor: colors.background, borderColor: colors.border, borderWidth: 1 }]}
                  onPress={() => dismissDeleteConfirm(false)}
                  disabled={deleteLoading}
                >
                  <Text style={[soStyles.btnText, { color: colors.foreground }]}>Cancel</Text>
                </Pressable>
                <Pressable
                  style={[soStyles.btn, soStyles.btnHalf, { backgroundColor: colors.destructive }]}
                  onPress={() => dismissDeleteConfirm(true)}
                  disabled={deleteLoading}
                >
                  {deleteLoading
                    ? <ActivityIndicator size="small" color="#fff" />
                    : <Text style={[soStyles.btnText, { color: "#fff" }]}>Delete</Text>}
                </Pressable>
              </View>
            </Animated.View>
          </Animated.View>
        )}
        </>)}

      <WearableSetupModal
        visible={showWearableSetup}
        onClose={() => setShowWearableSetup(false)}
        last7Days={last7Days}
        onComplete={(platform, permissionStatus) => {
          setStepSourceInfo({ platform, permissionStatus, setupCompleted: permissionStatus === "connected" });
          if (permissionStatus === "connected") {
            void requestStepPermission();
          }
        }}
      />
      <MyTitlesModal
        visible={showTitlesModal}
        onClose={() => setShowTitlesModal(false)}
        onSaved={(title) => setActiveTitle(title)}
      />
      <AvatarPickerSheet
        visible={showAvatarPicker}
        onClose={() => setShowAvatarPicker(false)}
        options={[
          { label: "Take Photo", icon: "camera", onPress: handleTakePhoto },
          { label: "Choose from Library", icon: "image", onPress: handleChoosePhoto },
          ...(avatarUrl ? [{ label: "Remove Photo", icon: "trash-2", destructive: true, onPress: handleRemovePhoto }] : []),
        ]}
      />
      </SafeAreaView>
    </Modal>
  ); }

const soStyles = StyleSheet.create({
  overlay:  { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.55)", alignItems: "center", justifyContent: "center", paddingHorizontal: 36, zIndex: 999 },
  card:     { width: "100%", maxWidth: 340, borderRadius: 18, borderWidth: 1, overflow: "hidden" },
  body:     { paddingHorizontal: 22, paddingTop: 24, paddingBottom: 18, alignItems: "center" },
  title:    { fontSize: 17, fontWeight: "700", textAlign: "center", letterSpacing: 0.1 },
  message:  { fontSize: 14, textAlign: "center", marginTop: 7, lineHeight: 20 },
  divider:  { height: 1 },
  buttons:  { flexDirection: "row", padding: 12, gap: 8 },
  btn:      { paddingVertical: 12, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  btnHalf:  { flex: 1 },
  btnText:  { fontSize: 15, fontWeight: "600" },
});

const pmStyles = StyleSheet.create({
  container:      { flex: 1 },
  handle:         { width: 40, height: 4, borderRadius: 2, alignSelf: "center", marginTop: 10, marginBottom: 4 },
  header:         { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 1 },
  headerTitle:    { fontSize: 17, fontWeight: "700" },
  editToggleBtn:  { width: 34, height: 34, borderRadius: 17, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  body:           { padding: 20, gap: 14 },
  avatarSection:  { alignItems: "center", gap: 5, paddingVertical: 8, position: "relative" },
  avatarWrapper:  { position: "relative" },
  avatar:         { width: 84, height: 84, borderRadius: 42, borderWidth: 3, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  avatarImg:      { width: 78, height: 78, borderRadius: 39 },
  avatarOverlay:  { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(0,0,0,0.42)", borderRadius: 39 },
  avatarCameraBtn:{ position: "absolute", bottom: 1, right: 1, width: 26, height: 26, borderRadius: 13, borderWidth: 2, alignItems: "center", justifyContent: "center" },
  avatarText:     { fontSize: 34, fontWeight: "900" },
  fullName:       { fontSize: 22, fontWeight: "800", marginTop: 4 },
  username:       { fontSize: 14 },
  flagRow:        { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 2 },
  flag:           { fontSize: 18 },
  country:        { fontSize: 13 },
  // Inline edit panel
  editPanel:       { borderRadius: 16, borderWidth: 1, padding: 16, gap: 14 },
  editField:       { gap: 6 },
  editLabel:       { fontSize: 11, fontWeight: "700", letterSpacing: 0.8, textTransform: "uppercase" },
  editInput:       { borderRadius: 12, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15 },
  editInputRow:    { flexDirection: "row", alignItems: "center", borderRadius: 12, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 12, gap: 4 },
  atSign:          { fontSize: 15 },
  editInputInner:  { flex: 1, fontSize: 15 },
  editHint:        { fontSize: 11, lineHeight: 15 },
  editCountryRow:  { flexDirection: "row", alignItems: "center", gap: 12, borderRadius: 12, borderWidth: 1, padding: 14 },
  editColorRow:    { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  editColorDot:    { width: 36, height: 36, borderRadius: 18 },
  editActions:     { flexDirection: "row", gap: 10 },
  editCancelBtn:   { flex: 1, paddingVertical: 12, borderRadius: 12, borderWidth: 1, alignItems: "center" },
  editCancelText:  { fontSize: 14, fontWeight: "600" },
  editSaveBtn:     { flex: 2, paddingVertical: 12, borderRadius: 12, alignItems: "center" },
  editSaveText:    { fontSize: 14, fontWeight: "700" },
  // Achievements card
  achievementsCard:    { flexDirection: "row", alignItems: "center", gap: 12, borderRadius: 14, borderWidth: 1, padding: 14 },
  achievementsIcon:    { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  achievementsInfo:    { flex: 1, gap: 3 },
  achievementsLabel:   { fontSize: 14, fontWeight: "700" },
  achievementsSubtext: { fontSize: 12 },
  // Stats
  statsGrid:   { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  statCard:    { flex: 1, borderRadius: 12, borderWidth: 1, padding: 12, gap: 4 },
  statValue:   { fontSize: 18, fontWeight: "800" },
  statLabel:   { fontSize: 11 },
  // Toggles
  toggleRow:   { flexDirection: "row", alignItems: "center", gap: 12, borderRadius: 14, borderWidth: 1, paddingHorizontal: 16, paddingVertical: 12 },
  toggleIcon:  { width: 34, height: 34, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  toggleLabel: { flex: 1, fontSize: 15, fontWeight: "500" },
  // Actions
  actionBtn:       { flexDirection: "row", alignItems: "center", gap: 12, borderRadius: 14, borderWidth: 1, padding: 16 },
  actionBtnText:   { flex: 1, fontSize: 15, fontWeight: "600" },
  // Grouped settings list
  settingsList:    { borderRadius: 16, borderWidth: 1, overflow: "hidden" },
  // Challenge history
  historyCard:     { borderRadius: 16, borderWidth: 1, overflow: "hidden" },
  historyTitle:    { fontSize: 14, fontWeight: "700", paddingHorizontal: 16, paddingTop: 14, paddingBottom: 10 },
  historyRow:      { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 12, gap: 12 },
  historyRowTitle: { fontSize: 14, fontWeight: "600" },
  historyRowMeta:  { fontSize: 12, marginTop: 1 }, });

export default function WalkScreen() {
  return (
    <ErrorBoundary>
      <WalkScreenContent />
    </ErrorBoundary>
  );
}

function WalkScreenContent() {
  const colors = useColors();
  const { isDark } = useTheme();
  const { insets, safeTop, safeBottom } = useSafeLayout();
  const {
    trackingStatus,
    session,
    todaySteps: contextTodaySteps,
    allTimeSteps,
    currentStreak,
    togglePause,
    milestoneReached,
    clearMilestone,
    usingRealTracking,
    stepPermissionStatus,
    hcAvailability,
    requestStepPermission,
    todayActiveMinutes,
    todayDailyRank,
    todayDailyGoal: contextDailyGoal,
    refreshTodayRank,
    resumeStepWatching,
    refreshTodaySteps,
    stepsHydrated,
    stepsSourceReady,
    authReady,
  } = useWalkContext();
  const { guardRewardAction, canJoinRewardRaces, verificationLevel } = useStepSourceGuard();
  const { userRank, walletBalance } = useApp();
  const { user, logout, loading: authLoading, sessionToken } = useAuth();
  const dbWalk = useTodayWalkSteps(user?.id);
  const tabBarHeight = useTabBarHeight();
  const modalScrollPad = { paddingBottom: safeBottom + rs(40) };
  const { joinRace, setActiveRace, setRaceTargetSteps, racePhase, userRaceSteps, walkRaceStepsDisplay, raceId: activeRaceId } = useRace();
  const raceStepsOnWalk = racePhase === "in_race" ? userRaceSteps : walkRaceStepsDisplay;
  const showRaceStepsOnWalk = raceStepsOnWalk > 0;
  const { counts, formatCount } = usePresence();
  const { pendingGroupInvites } = useUnread();
  const dispatch = useDispatch<AppDispatch>();
  const themes = useSelector((s: RootState) => s.trackThemes.themes);
  const themeCoinBalance = useSelector((s: RootState) => s.trackThemes.coinBalance);
  const themesPurchaseLoading = useSelector((s: RootState) => s.trackThemes.purchaseLoading);
  const coinBalance = useSelector((s: RootState) => s.coins.balance?.currentBalance ?? themeCoinBalance);
  const canonicalTodaySteps = useSelector((s: RootState) =>
    s.raceProgress.userId === user?.id
      ? Math.max(0, Math.floor(s.raceProgress.todaySteps))
      : 0,
  );
  const liveTodaySteps = Math.max(
    Number.isFinite(contextTodaySteps) ? contextTodaySteps : 0,
    canonicalTodaySteps,
  );
  const [purchaseConfirmModal, setPurchaseConfirmModal] = useState<{ code: string; name: string; price: number } | null>(null);
  const [showCoinsInfo, setShowCoinsInfo] = useState(false);
  const [showCoinStore, setShowCoinStore] = useState(false);
  const showCoinStoreRef = useRef(showCoinStore);
  showCoinStoreRef.current = showCoinStore;
  const [showStepSetup, setShowStepSetup] = useState(false);
  const [walkFocused, setWalkFocused] = useState(true);

  const handleCloseCoinStore = useCallback(() => {
    setShowCoinStore(false);
    dispatch(fetchCoinBalance());
  }, [dispatch]);

  const handleCoinStorePurchase = useCallback(() => {
    dispatch(fetchCoinBalance());
    dispatch(fetchTrackThemes());
  }, [dispatch]);

  const statusConf = STATUS_CONFIG[trackingStatus];
  const dotAnim = useRef(new Animated.Value(1)).current;
  const bannerAnim = useRef(new Animated.Value(0)).current;
  const bannerVisible = useRef(false);
  const btnFillAnim = useRef(new Animated.Value(0)).current;
  const createFillAnim = useRef(new Animated.Value(0)).current;

  const [showProfile, setShowProfile] = useState(false);
  const [setupModal, setSetupModal] = useState<{ fee: number; label: string; gradients: [string, string] } | null>(null);
  const [setupModalAnimated, setSetupModalAnimated] = useState(true);
  const [playerCount, setPlayerCount] = useState<number>(10);
  const [challengeModal, setChallengeModal] = useState(false);
  const openCreateChallengeModal = useCallback(() => {
    setChallengeCreating(false);
    setChallengeModalAnimated(true);
    setChallengeModal(true);
  }, []);
  const [challengeModalAnimated, setChallengeModalAnimated] = useState(true);
  const [roomType, setRoomType] = useState<"public" | "private">("private");
  const [challengeEntryIdx, setChallengeEntryIdx] = useState(0);
  const [challengeTargetIdx, setChallengeTargetIdx] = useState(2);
  const [challengeMaxPlayers, setChallengeMaxPlayers] = useState(10);
  const [activePicker, setActivePicker] = useState<"entryFee" | "coinAmount" | "usdAmount" | "goalType" | "steps" | "players" | "startTime" | null>(null);
  const [challengeEntryMode, setChallengeEntryMode] = useState<"free" | "coins" | "usd">("free");
  const [challengeUsdAmount, setChallengeUsdAmount] = useState(3);
  const [setupPaymentQuote, setSetupPaymentQuote] = useState<CashChallengePaymentQuote | null>(null);
  const [createPaymentQuote, setCreatePaymentQuote] = useState<CashChallengePaymentQuote | null>(null);
  const [confirmPaymentQuote, setConfirmPaymentQuote] = useState<CashChallengePaymentQuote | null>(null);
  const [challengeGoalType, setChallengeGoalType] = useState<GoalPeriodType>("daily");
  const [challengeStartDate, setChallengeStartDate] = useState<Date>(() => new Date());
  const [challengeEndDate, setChallengeEndDate] = useState<Date | null>(null);
  const [challengeStartTimeIdx, setChallengeStartTimeIdx] = useState(0);
  const [showStartDatePicker, setShowStartDatePicker] = useState(false);
  const [showEndDatePicker, setShowEndDatePicker] = useState(false);
  // Always keep end date locked to start + duration (1/7/30 days), preserving the selected start time
  useEffect(() => {
    const days = challengeGoalType === "daily" ? 1 : challengeGoalType === "weekly" ? 7 : 30;
    const now = new Date();
    const isToday = isSameDay(challengeStartDate, now);
    const preset = isToday
      ? (TIME_PRESETS_WITH_NOW[challengeStartTimeIdx] ?? TIME_PRESETS_WITH_NOW[0]!)
      : (TIME_PRESETS_FUTURE[Math.max(0, challengeStartTimeIdx - 1)] ?? TIME_PRESETS_FUTURE[0]!);
    const startWithTime = new Date(challengeStartDate);
    if (preset.isNow && isToday) {
      startWithTime.setHours(now.getHours(), now.getMinutes(), 0, 0);
    } else {
      startWithTime.setHours(preset.isNow ? now.getHours() : preset.hour, preset.isNow ? now.getMinutes() : preset.minute, 0, 0);
    }
    const endDate = new Date(startWithTime);
    endDate.setDate(endDate.getDate() + days);
    setChallengeEndDate(endDate);
    if (__DEV__) {
      console.log("[CreateChallengeTime] duration selected:", days, "days");
      console.log("[CreateChallengeTime] calculated end date:", endDate.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }));
      console.log("[CreateChallengeTime] calculated end time:", fmtShortTime12(endDate));
      console.log("[CreateChallengeTime] timezone:", getUserTimezone());
    }
  }, [challengeStartDate, challengeGoalType, challengeStartTimeIdx]);
  const pickerSlideY = useRef(new Animated.Value(500)).current;
  const [challengeCreating, setChallengeCreating] = useState(false);
  const [joinWithCodeVisible, setJoinWithCodeVisible] = useState(false);
  const [coinsBattleVisible, setCoinsBattleVisible] = useState(false);
  const [alreadyHostingModal, setAlreadyHostingModal] = useState<{ isActiveRace: boolean; raceId: string | null; entryKey: string } | null>(null);
  const [confirmEntry, setConfirmEntry] = useState<{ fee: number; label: string; gradients: [string, string] } | null>(null);
  const [confirmEntryAnimated, setConfirmEntryAnimated] = useState(true);
  const [confirmChecks, setConfirmChecks] = useState<boolean[]>([false, false, false]);
  const [showCreateConfirm, setShowCreateConfirm] = useState(false);
  const [createConfirmChecks, setCreateConfirmChecks] = useState<boolean[]>([false, false, false]);
  const [challengeStatuses, setChallengeStatuses] = useState<Record<string, ChallengeStatus>>({});
  const walkCacheReadyRef = useRef(false);
  const [walkCacheReady, setWalkCacheReady] = useState(false);

  const userReady = authReady && !!sessionToken && !!user?.id && stepsHydrated;
  const stepsInitializing =
    stepsHydrated &&
    !stepsSourceReady &&
    contextTodaySteps <= 0 &&
    (stepPermissionStatus === "granted" || usingRealTracking);
  const { safeSteps: safeTodaySteps, safeGoal: goalSteps, progress: goalProgress, percent: goalPercent } =
    clampDailyProgress(
      userReady && !stepsInitializing && Number.isFinite(liveTodaySteps)
        ? liveTodaySteps
        : 0,
      contextDailyGoal > 0 ? contextDailyGoal : dbWalk.goalSteps,
    );

  useFocusEffect(useCallback(() => {
    if (!userReady || !usingRealTracking) return;
    const syncInterval = setInterval(() => {
      void refreshTodaySteps({ rehydrateBackend: false, mergeNative: true });
    }, STEP_SYNC_CONFIG.WALK_LOCAL_RECONCILE_POLL_MS);
    return () => clearInterval(syncInterval);
  }, [refreshTodaySteps, userReady, usingRealTracking]));

  useEffect(() => {
    if (!user?.id) {
      setChallengeStatuses({});
      walkCacheReadyRef.current = false;
      setWalkCacheReady(false);
      return;
    }
    const cacheKey = walkChallengeCacheKey(user.id);
    const cached = screenCache.getSync<Record<string, ChallengeStatus>>(cacheKey);
    if (cached) {
      setChallengeStatuses(cached);
      walkCacheReadyRef.current = true;
      setWalkCacheReady(true);
    } else {
      setChallengeStatuses({});
      walkCacheReadyRef.current = false;
      setWalkCacheReady(false);
    }
    if (__DEV__) {
      console.log(
        `[WalkScreen] mounted userId=${user.id} localDate=${getTodayKey()} authReady=${authReady} tokenExists=${!!sessionToken}`,
      );
    }
  }, [user?.id, authReady, sessionToken]);


  useEffect(() => {
    if (trackingStatus === "walking") {
      const pulse = Animated.loop(
        Animated.sequence([
          Animated.timing(dotAnim, { toValue: 0.3, duration: 600, useNativeDriver: true }),
          Animated.timing(dotAnim, { toValue: 1, duration: 600, useNativeDriver: true }),
        ])
      );
      pulse.start();

      if (!bannerVisible.current) {
        bannerVisible.current = true;
        Animated.sequence([
          Animated.timing(bannerAnim, { toValue: 1, duration: 350, useNativeDriver: true }),
          Animated.delay(3000),
          Animated.timing(bannerAnim, { toValue: 0, duration: 350, useNativeDriver: true }),
        ]).start(() => { bannerVisible.current = false; }); }

      return () => pulse.stop(); } }, [trackingStatus, dotAnim, bannerAnim]);

  useEffect(() => {
    if (milestoneReached) {
      const t = setTimeout(clearMilestone, 3000);
      return () => clearTimeout(t); } }, [milestoneReached, clearMilestone]);

  const loadChallengeStatuses = useCallback(async () => {
    if (!user?.id || !sessionToken) return;
    const cacheKey = walkChallengeCacheKey(user.id);
    try {
      if (!walkCacheReadyRef.current) {
        const cached = await screenCache.get<Record<string, ChallengeStatus>>(cacheKey);
        if (cached) {
          setChallengeStatuses(cached);
          walkCacheReadyRef.current = true;
          setWalkCacheReady(true);
        }
      }
      const res = await authFetch(`/api/challenges/available`);
      if (!res.ok) return;
      const data = await res.json();
      const map: Record<string, ChallengeStatus> = {};
      for (const c of (data.challenges ?? [])) {
        map[c.entryType] = c;
      }
      setChallengeStatuses(map);
      if (!walkCacheReadyRef.current) {
        walkCacheReadyRef.current = true;
        setWalkCacheReady(true);
      }
      void screenCache.set(cacheKey, map);
    } catch { /* silent */ }
  }, [sessionToken, user?.id]);

  // Initial load handled by useFocusEffect below (avoids duplicate fetch on mount + focus).

  // When a race ends (racePhase → "idle"), immediately clear any stale HOSTING /
  // JOINED status so the challenge cards revert to "Host / Join" without waiting
  // for the next 5-second poll.  Then trigger a fresh fetch in the background.
  const prevRacePhaseRef = useRef<string>(racePhase);
  useEffect(() => {
    const prev = prevRacePhaseRef.current;
    prevRacePhaseRef.current = racePhase;
    if (
      racePhase === "idle" &&
      (prev === "finished" || prev === "in_race" || prev === "waiting")
    ) {
      setChallengeStatuses({});
      loadChallengeStatuses();
    }
    if (
      (racePhase === "finished" || racePhase === "idle") &&
      (prev === "in_race" || prev === "finished")
    ) {
      void refreshTodaySteps();
      void resumeStepWatching();
    }
  }, [racePhase, loadChallengeStatuses, refreshTodaySteps, resumeStepWatching]);

  // Consolidated focus loader — fires one batch of fetches and starts the
  // 5-second background-refresh interval while the Walk tab is focused.
  // The interval is cancelled automatically on blur, preventing background
  // network traffic when the user is on a different tab.
  const refetchDbWalk = dbWalk.refetch;

  useFocusEffect(useCallback(() => {
    if (!userReady) {
      if (__DEV__) {
        console.log(
          `[WalkScreen] skipped fetch reason=missing userId/token/authReady authReady=${authReady} tokenExists=${!!sessionToken} userId=${user?.id ?? "none"}`,
        );
      }
      return;
    }
    void (async () => {
      await refreshTodayRank();
      void refetchDbWalk();
      if (usingRealTracking) {
        await refreshTodaySteps({ rehydrateBackend: true });
        await resumeStepWatching();
      }
    })();
    if (!showCoinStoreRef.current) {
      dispatch(fetchTrackThemes());
      dispatch(fetchCoinBalance());
    }
    loadChallengeStatuses();
    const pollInterval = setInterval(loadChallengeStatuses, STEP_SYNC_CONFIG.WALK_CHALLENGE_POLL_MS);
    return () => clearInterval(pollInterval);
  }, [
    authReady,
    dispatch,
    loadChallengeStatuses,
    refetchDbWalk,
    refreshTodayRank,
    refreshTodaySteps,
    resumeStepWatching,
    sessionToken,
    user?.id,
    userReady,
    usingRealTracking,
  ]));

  // Animate picker sheet in/out
  useEffect(() => {
    Animated.spring(pickerSlideY, {
      toValue: activePicker !== null ? 0 : 500,
      useNativeDriver: true,
      friction: 9,
      tension: 120,
    }).start();
  }, [activePicker, pickerSlideY]);

  // Reset shop icon opacity to full every time Walk tab is focused
  useFocusEffect(useCallback(() => {
    setWalkFocused(false);          // toggle to ensure useEffect re-fires
    const t = setTimeout(() => setWalkFocused(true), 0);
    return () => clearTimeout(t);
  }, []));

  // ── Room counts (badge on Rooms button) ───────────────────────────────────
  const [roomCounts, setRoomCounts] = useState<{ current: number; upcoming: number; total: number }>({ current: 0, upcoming: 0, total: 0 });
  const roomPulseAnim = useRef(new Animated.Value(1)).current;

  const fetchRoomCounts = useCallback(async () => {
    try {
      const res = await authFetch("/api/rooms/counts");
      if (!res.ok) return;
      const data = await res.json() as { currentRoomsCount: number; upcomingRoomsCount: number; totalRoomsCount: number };
      setRoomCounts({ current: data.currentRoomsCount, upcoming: data.upcomingRoomsCount, total: data.totalRoomsCount });
    } catch {}
  }, []);

  useFocusEffect(useCallback(() => {
    void fetchRoomCounts();
  }, [fetchRoomCounts]));

  useEffect(() => {
    const ch = subscribeToChannel("public-rooms-available");
    if (!ch) return;
    const refetch = () => { void fetchRoomCounts(); };
    ch.bind("room:created",   refetch);
    ch.bind("room:scheduled", refetch);
    ch.bind("room:started",   refetch);
    ch.bind("room:cancelled", refetch);
    ch.bind("room:finished",  refetch);
    return () => { unsubscribeFromChannel("public-rooms-available"); };
  }, [fetchRoomCounts]);

  useEffect(() => {
    if (roomCounts.total <= 0) { roomPulseAnim.stopAnimation(); roomPulseAnim.setValue(1); return; }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(roomPulseAnim, { toValue: 0.25, duration: 900, useNativeDriver: true }),
        Animated.timing(roomPulseAnim, { toValue: 1,    duration: 900, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [roomCounts.total, roomPulseAnim]);

  // Fetch sponsored events status for the Walk tab card; poll every 30 s while on tab
  useFocusEffect(useCallback(() => {
    let cancelled = false;
    const fetchSponsoredStatus = async () => {
      try {
        const res = await authFetch("/api/sponsored-events");
        if (!res.ok || cancelled) return;
        const data = await res.json() as {
          events: Array<{
            id: string; status: string;
            isRegistered: boolean; isActive: boolean; joinWindowOpen: boolean;
            canRegister: boolean;
            scheduledStartAt: string | null;
            registeredCount: number; maxSlots: number;
          }>;
        };
        const evs = data.events ?? [];
        // Priority: racing > join_window > registered > available > watch_live
        let next: SponsoredCardStatus | null = null;
        for (const ev of evs) {
          if (ev.status === "in_progress" && ev.isActive) {
            next = { kind: "racing", eventId: ev.id };
            break;
          }
        }
        if (!next) {
          for (const ev of evs) {
            if (canOpenSponsoredWaitingRoom(ev) && ev.joinWindowOpen) {
              next = { kind: "join_window", eventId: ev.id, registeredCount: ev.registeredCount, maxSlots: ev.maxSlots };
              break;
            }
          }
        }
        if (!next) {
          for (const ev of evs) {
            if (canOpenSponsoredWaitingRoom(ev)) {
              next = { kind: "registered", eventId: ev.id, scheduledStartAt: ev.scheduledStartAt!, registeredCount: ev.registeredCount, maxSlots: ev.maxSlots };
              break;
            }
          }
        }
        if (!next) {
          for (const ev of evs) {
            if (isSponsoredRegistrationOpen(ev)) {
              next = { kind: "available", eventId: ev.id, registeredCount: ev.registeredCount, maxSlots: ev.maxSlots };
              break;
            }
          }
        }
        if (!next) {
          for (const ev of evs) {
            // Only show watch_live for users who never registered — forfeited users
            // still have isRegistered=true so they are correctly excluded here.
            if (ev.status === "in_progress" && !ev.isActive && !ev.isRegistered) {
              next = { kind: "watch_live", eventId: ev.id };
              break;
            }
          }
        }
        if (!cancelled) {
          setSponsoredStatus(next);
        }
      } catch { /* silent */ }
    };
    fetchSponsoredStatus();
    const interval = setInterval(fetchSponsoredStatus, 30_000);
    return () => { cancelled = true; clearInterval(interval); };
  }, []));

  const distance = stepsToDistance(safeTodaySteps);
  // Use backend-confirmed active minutes; derive from steps as a live estimate when not yet available
  const activeMins = todayActiveMinutes > 0
    ? todayActiveMinutes
    : (safeTodaySteps > 0 ? Math.max(1, Math.ceil(safeTodaySteps / 120)) : 0);

  const computedPool = setupPaymentQuote?.prizePool ?? (setupModal?.fee ?? 1) * playerCount;
  const computedWinnerCount = playerCount <= 2 ? 1 : playerCount === 3 ? 2 : 3;
  const computedPrizes =
    setupPaymentQuote?.rewardSplit.map((s) => s.amount) ??
    (() => {
      const splits =
        computedWinnerCount === 1 ? [1.0] : computedWinnerCount === 2 ? [0.6, 0.4] : [0.5, 0.3, 0.2];
      return splits.map((s) => parseFloat((computedPool * s).toFixed(2)));
    })();
  const isFreeRace = (setupModal?.fee ?? -1) === 0;
  const setupTotalPayable = setupPaymentQuote?.totalPayable ?? setupModal?.fee ?? 1;
  const canAfford = isFreeRace || walletBalance >= setupTotalPayable;
  const selectedEntry: ChallengeEntryOption = ENTRY_OPTIONS[challengeEntryIdx] ?? ENTRY_OPTIONS[0]!;
  const isCoinsBattleEntry = challengeEntryMode === "coins";
  const isUsdEntry = challengeEntryMode === "usd";
  const coinEntryAmount = COINS_ENTRY_AMOUNTS[challengeEntryIdx] ?? COINS_ENTRY_AMOUNTS[0]!;
  const goalStepOptions = GOAL_STEP_TARGETS[challengeGoalType];
  const clampedTargetIdx = Math.min(challengeTargetIdx, goalStepOptions.length - 1);
  const targetStepsForCreate = goalStepOptions[clampedTargetIdx]!;
  const durationDays = challengeGoalType === "daily" ? 1 : challengeGoalType === "weekly" ? 7 : 30;
  const durationDaysLabel = challengeGoalType === "daily" ? "1 day" : challengeGoalType === "weekly" ? "7 days" : "30 days";

  useEffect(() => {
    if (!setupModal || setupModal.fee <= 0) {
      setSetupPaymentQuote(null);
      return;
    }
    let cancelled = false;
    void fetchCashChallengePaymentQuote({
      entryFeeCents: Math.round(setupModal.fee * 100),
      numberOfPlayers: playerCount,
    })
      .then((q) => {
        if (!cancelled) setSetupPaymentQuote(q);
      })
      .catch(() => {
        if (!cancelled) setSetupPaymentQuote(null);
      });
    return () => {
      cancelled = true;
    };
  }, [setupModal?.fee, playerCount, setupModal]);

  useEffect(() => {
    if (challengeEntryMode !== "usd") {
      setCreatePaymentQuote(null);
      return;
    }
    let cancelled = false;
    void fetchCashChallengePaymentQuote({
      entryFeeCents: challengeUsdAmount * 100,
      numberOfPlayers: challengeMaxPlayers,
    })
      .then((q) => {
        if (!cancelled) setCreatePaymentQuote(q);
      })
      .catch(() => {
        if (!cancelled) setCreatePaymentQuote(null);
      });
    return () => {
      cancelled = true;
    };
  }, [challengeEntryMode, challengeUsdAmount, challengeMaxPlayers]);

  useEffect(() => {
    if (!confirmEntry || confirmEntry.fee <= 0) {
      setConfirmPaymentQuote(null);
      return;
    }
    let cancelled = false;
    void fetchCashChallengePaymentQuote({
      entryFeeCents: Math.round(confirmEntry.fee * 100),
      numberOfPlayers: 10,
    })
      .then((q) => {
        if (!cancelled) setConfirmPaymentQuote(q);
      })
      .catch(() => {
        if (!cancelled) setConfirmPaymentQuote(null);
      });
    return () => {
      cancelled = true;
    };
  }, [confirmEntry?.fee, confirmEntry]);

  const [freeJoining, setFreeJoining] = useState(false);
  const [joiningEntryKey, setJoiningEntryKey] = useState<string | null>(null);

  // Left-to-right fill animation on host/join button while API is in flight
  useEffect(() => {
    if (freeJoining) {
      btnFillAnim.setValue(0);
      Animated.timing(btnFillAnim, {
        toValue: 1,
        duration: 1800,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: false,
      }).start();
    } else {
      btnFillAnim.setValue(0);
    }
  }, [freeJoining, btnFillAnim]);

  // Left-to-right fill animation on create-room button while API is in flight
  useEffect(() => {
    if (challengeCreating) {
      createFillAnim.setValue(0);
      Animated.timing(createFillAnim, {
        toValue: 1,
        duration: 1800,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: false,
      }).start();
    } else {
      createFillAnim.setValue(0);
    }
  }, [challengeCreating, createFillAnim]);
  const [selectedTargetSteps, setSelectedTargetSteps] = useState(1000);
  const [selectedTrackLayout, setSelectedTrackLayout] = useState<TrackLayoutId>("bg");
  const [challengeTrackLayout, setChallengeTrackLayout] = useState<TrackLayoutId>("bg");
  const [activeRaceModal, setActiveRaceModal] = useState<ActiveRaceInfo | null>(null);
  const [scheduledRoomResult, setScheduledRoomResult] = useState<{
    inviteCode: string | null;
    isPrivate: boolean;
    scheduledStartAt: string;
    targetSteps: number;
    entryType: string;
    entryAmountCents: number;
    coinEntryAmount: number;
  } | null>(null);
  const [leavingActiveRace, setLeavingActiveRace] = useState(false);
  const pendingRaceActionRef = useRef<(() => Promise<void>) | null>(null);
  const confirmEntryJoinCallbackRef = useRef<(() => void) | null>(null);

  // Sponsored events card status
  type SponsoredCardStatus =
    | { kind: "racing"; eventId: string }
    | { kind: "join_window"; eventId: string; registeredCount: number; maxSlots: number }
    | { kind: "registered"; eventId: string; scheduledStartAt: string; registeredCount: number; maxSlots: number }
    | { kind: "available"; eventId: string; registeredCount: number; maxSlots: number }
    | { kind: "watch_live"; eventId: string };
  const [sponsoredStatus, setSponsoredStatus] = useState<SponsoredCardStatus | null>(null);

  const feeToEntryType = (fee: number) =>
    fee === 0 ? "free" : fee === 1 ? "paid_1" : fee === 3 ? "paid_3" : fee === -1 ? "coins_battle" : "paid_5";

  const entryKeyToFee = (k: string) =>
    k === "free" ? 0 : k === "paid_1" ? 1 : k === "paid_3" ? 3 : k === "coins_battle" ? -1 : 5;

  const ACTIVE_OR_WAITING = ["user_hosting_active", "user_joined_active", "user_hosting_waiting", "user_joined_waiting"];

  const findActiveRaceForOtherChallenge = useCallback((targetEntryKey: string) => {
    for (const [ek, cs] of Object.entries(challengeStatuses)) {
      if (ek !== targetEntryKey && cs && ACTIVE_OR_WAITING.includes(cs.status) && cs.raceId) {
        return { entryKey: ek, cs };
      }
    }
    return null;
  }, [challengeStatuses]);

  const findAnyActiveRace = useCallback(() => {
    for (const [ek, cs] of Object.entries(challengeStatuses)) {
      if (cs && ACTIVE_OR_WAITING.includes(cs.status) && cs.raceId) {
        return { entryKey: ek, cs };
      }
    }
    return null;
  }, [challengeStatuses]);

  const buildActiveRaceInfoFromStatus = useCallback((entryKey: string, cs: { status: string; raceId: string | null; isHost: boolean; targetSteps?: number }): ActiveRaceInfo => {
    const isActiveRace = cs.status === "user_hosting_active" || cs.status === "user_joined_active";
    return {
      room_id: cs.raceId!,
      room_status: isActiveRace ? "in_progress" : "open",
      challenge_type: entryKey,
      entry_fee: entryKeyToFee(entryKey),
      target_steps: cs.targetSteps ?? 1000,
      current_user_role: cs.isHost ? "host" : "participant",
      can_leave: true,
      next_screen: isActiveRace ? "race_track" : "waiting_room",
    };
  }, []);

  const saveRaceTrackLayout = useCallback(async (raceId: string) => {
    const current = (await storageGet<Record<string, TrackLayoutId>>(STORAGE_KEYS.RACE_TRACK_LAYOUTS)) ?? {};
    await storageSet(STORAGE_KEYS.RACE_TRACK_LAYOUTS, {
      ...current,
      [raceId]: selectedTrackLayout, }); }, [selectedTrackLayout]);

  const handleJoinRace = async () => {
    if (!setupModal || freeJoining) return;
    let navigating = false;
    const entryKey = feeToEntryType(setupModal.fee);
    const status = challengeStatuses[entryKey];

    if (isPaidCashFee(setupModal.fee) && !ENABLE_CASH_CHALLENGES) {
      AppAlert.alert(
        "Cash challenges unavailable",
        "Paid cash challenges are disabled in this app build. Set EXPO_PUBLIC_ENABLE_CASH_CHALLENGES=true and rebuild.",
      );
      return;
    }

    if (setupModal.fee !== 0 && !canAfford) {
      AppAlert.alert(
        "Insufficient Balance",
        `You need $${setupTotalPayable.toFixed(2)} to join. Add funds to your wallet.`,
      );
      return;
    }

    setFreeJoining(true);
    try {
      let raceId: string;
      let isHosting: boolean;

      if (status?.status === "join_available" && status.raceId) {
        // Try to join the existing open room
        const res = await authFetch(`/api/races/${status.raceId}/join`, { method: "POST" });
        if (res.ok) {
          raceId = status.raceId;
          isHosting = false;
        } else {
          const body1 = await res.json().catch(() => ({})) as Record<string, unknown>;
          if (res.status === 409 && body1.code === "ACTIVE_RACE_EXISTS") {
            pendingRaceActionRef.current = handleJoinRace;
            setActiveRaceModal(body1.active_race as ActiveRaceInfo);
            return;
          }
          // Room gone — fall through to host a new one
          const res2 = await authFetch(`/api/races/host`, {
            method: "POST",
            body: JSON.stringify({ entryType: entryKey, maxPlayers: playerCount, targetSteps: selectedTargetSteps, trackLayout: selectedTrackLayout }),
          });
          if (!res2.ok) {
            const body2 = await res2.json().catch(() => ({})) as Record<string, unknown>;
            if (res2.status === 409 && body2.code === "ACTIVE_RACE_EXISTS") {
              pendingRaceActionRef.current = handleJoinRace;
              setActiveRaceModal(body2.active_race as ActiveRaceInfo);
              return;
            }
            AppAlert.alert("Could not join", cashChallengeBlockedMessage(body2.error as string | undefined));
            return;
          }
          const data2 = await res2.json();
          raceId = data2.raceId;
          isHosting = true;
        }
      } else {
        // Host a brand-new room
        const res = await authFetch(`/api/races/host`, {
          method: "POST",
          body: JSON.stringify({ entryType: entryKey, maxPlayers: playerCount, targetSteps: selectedTargetSteps, trackLayout: selectedTrackLayout }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({})) as Record<string, unknown>;
          if (res.status === 409 && body.code === "ACTIVE_RACE_EXISTS") {
            pendingRaceActionRef.current = handleJoinRace;
            setActiveRaceModal(body.active_race as ActiveRaceInfo);
            return;
          }
          AppAlert.alert("Could not create room", cashChallengeBlockedMessage(body.error as string | undefined));
          return;
        }
        const data = await res.json();
        raceId = data.raceId;
        isHosting = true;
      }

      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
      if (isHosting) await saveRaceTrackLayout(raceId);
      setActiveRace(raceId, isHosting);
      setRaceTargetSteps(selectedTargetSteps);
      joinRace(setupModal.fee, playerCount, isHosting);
      loadChallengeStatuses();

      // Instant-close the modal then navigate — same pattern as Create Challenge.
      // setupModal stays open (covering the Walk tab) while matchmaking mounts,
      // then vanishes with no slide animation onto the already-rendered screen.
      navigating = true;
      setSetupModalAnimated(false);
      router.push({ pathname: "/race/matchmaking", params: { raceId, isHost: isHosting ? "true" : "false" } });
      InteractionManager.runAfterInteractions(() => {
        setSetupModal(null);
        setFreeJoining(false);
        // setupModalAnimated restored via onDismiss on the Modal
      });
    } catch {
      AppAlert.alert("Error", "Could not connect. Please try again.");
    } finally {
      // Only reset on error paths — success path resets inside InteractionManager
      // so the button keeps showing "Creating room…" until the modal is gone
      if (!navigating) setFreeJoining(false);
    }
  };

  // Direct join: skips the player-count modal and immediately joins the existing open room
  const doDirectJoin = useCallback(async (raceId: string, fee: number, maxPlayers: number, entryKey: string) => {
    if (freeJoining || joiningEntryKey) return;
    setFreeJoining(true);
    setJoiningEntryKey(entryKey);
    try {
      const endpoint = fee > 0
        ? `/api/races/${raceId}/join-paid`
        : `/api/races/${raceId}/join`;
      const res = await authFetch(endpoint, { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as Record<string, unknown>;
        if (res.status === 409 && body.code === "ACTIVE_RACE_EXISTS") {
          // User already consented — re-try join directly after resolving conflict
          pendingRaceActionRef.current = () => doDirectJoin(raceId, fee, maxPlayers, entryKey);
          setActiveRaceModal(body.active_race as ActiveRaceInfo);
          return;
        }
        AppAlert.alert("Could not join", (body.error as string) ?? "Room may be full or closed.");
        loadChallengeStatuses();
        return;
      }
      setActiveRace(raceId, false);
      joinRace(fee, maxPlayers, false);
      loadChallengeStatuses();
      router.push({ pathname: "/race/matchmaking", params: { raceId, isHost: "false" } });
    } catch {
      AppAlert.alert("Error", "Could not connect. Please try again.");
    } finally {
      setFreeJoining(false);
      setJoiningEntryKey(null);
    }
  }, [setActiveRace, joinRace, loadChallengeStatuses]);

  // Paid joins use the same confirm → join flow as host create (no pre-join step-source gate).
  const handleDirectJoin = useCallback(async (raceId: string, fee: number, maxPlayers: number, entryKey: string): Promise<void> => {
    if (fee > 0) {
      const opt = RACE_OPTIONS.find((o) => o.fee === fee);
      confirmEntryJoinCallbackRef.current = () => void doDirectJoin(raceId, fee, maxPlayers, entryKey);
      setConfirmChecks([false, false, false]);
      setConfirmEntry({
        fee,
        label: opt?.label ?? `$${fee} Challenge`,
        gradients: opt?.gradientColors ?? ["#7C3AED", "#9333EA"],
      });
      return;
    }
    await doDirectJoin(raceId, fee, maxPlayers, entryKey);
  }, [doDirectJoin]);

  const handleCoinsBattleJoin = useCallback(async (raceId: string) => {
    // Coins battles require verified tracking
    if (!canJoinRewardRaces) {
      guardRewardAction(() => { /* guarded */ });
      return;
    }
    setJoiningEntryKey("coins_battle");
    try {
      const res = await authFetch(`/api/coins-battle/${raceId}/join`, { method: "POST" });
      const data = await res.json() as { raceId?: string; error?: string; code?: string; currentPlayers?: number };
      if (!res.ok) {
        if (data.code === "ACTIVE_RACE_EXISTS") {
          AppAlert.alert("Already In A Race", "You are already in an active race.");
        } else if (data.code === "INSUFFICIENT_COINS") {
          AppAlert.alert("Not Enough Coins", "You don't have enough coins to join this battle.");
        } else if (data.code === "ROOM_NOT_OPEN") {
          AppAlert.alert("Room Closed", "This room is no longer open.");
        } else {
          AppAlert.alert("Join Failed", data.error ?? "Could not join the Coins Battle.");
        }
        return;
      }
      dispatch(fetchCoinBalance());
      router.push({ pathname: "/race/matchmaking", params: { raceId, isHost: "false" } });
    } catch {
      AppAlert.alert("Error", "Network error. Please try again.");
    } finally {
      setJoiningEntryKey(null);
    }
  }, [dispatch, canJoinRewardRaces, guardRewardAction]);

  const handleStayInActiveRace = () => {
    const ar = activeRaceModal;
    setActiveRaceModal(null);
    pendingRaceActionRef.current = null;
    if (!ar) return;
    if (ar.room_status === "in_progress") {
      router.push({ pathname: "/race/live-detail", params: { id: ar.room_id } });
    } else {
      router.push({
        pathname: "/race/matchmaking",
        params: { raceId: ar.room_id, isHost: ar.current_user_role === "host" ? "true" : "false" },
      });
    }
  };

  const handleLeaveAndContinueActiveRace = async () => {
    const ar = activeRaceModal;
    if (!ar) return;
    setLeavingActiveRace(true);
    try {
      const res = await authFetch(`/api/races/${ar.room_id}/leave`, {
        method: "POST",
        body: JSON.stringify({ reason: "join_another_race" }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as Record<string, string>;
        AppAlert.alert("Could not leave", body.error ?? "Please try again.");
        return;
      }
      setActiveRace(null, false);
      setActiveRaceModal(null);
      const pending = pendingRaceActionRef.current;
      pendingRaceActionRef.current = null;
      if (pending) await pending();
    } catch {
      AppAlert.alert("Error", "Could not leave. Please try again.");
    } finally {
      setLeavingActiveRace(false);
    }
  };

  const handleCancelActiveRaceModal = () => {
    setActiveRaceModal(null);
    pendingRaceActionRef.current = null;
  };


  const handleCreateChallenge = async () => {
    if (challengeCreating) return;
    let navigating = false;
    setChallengeCreating(true);
    try {
      const entryType = challengeEntryMode === "free" ? "free"
        : challengeEntryMode === "coins" ? "coins_battle"
        : "paid_usd";
      const scheduledStartAt = buildScheduledStartAtFromDate(challengeStartDate, challengeStartTimeIdx);
      const isScheduled = scheduledStartAt !== null;

      // Validate: selected time must not be in the past
      if (scheduledStartAt !== null && scheduledStartAt.getTime() <= Date.now()) {
        AppAlert.alert("Invalid Time", "Please select a future start time.");
        setChallengeCreating(false);
        return;
      }

      if (challengeEntryMode === "usd") {
        if (!ENABLE_CASH_CHALLENGES) {
          AppAlert.alert(
            "Cash challenges unavailable",
            "Paid cash challenges are disabled in this app build. Set EXPO_PUBLIC_ENABLE_CASH_CHALLENGES=true and rebuild.",
          );
          setChallengeCreating(false);
          return;
        }
        const required = createPaymentQuote?.totalPayable ?? challengeUsdAmount;
        if (walletBalance < required) {
          AppAlert.alert(
            "Insufficient Balance",
            `You need $${required.toFixed(2)} to create this challenge. Add funds to your wallet first.`,
          );
          setChallengeCreating(false);
          return;
        }
      }

      const timezone = getUserTimezone();

      const body: Record<string, unknown> = {
        entryType,
        maxPlayers: challengeMaxPlayers,
        targetSteps: targetStepsForCreate,
        trackLayout: challengeTrackLayout,
        isPrivate: roomType === "private",
        timezone,
        goalType: challengeGoalType,
        ...(challengeEntryMode === "coins" ? { coinEntryAmount } : {}),
        ...(challengeEntryMode === "usd" ? { customEntryAmountCents: challengeUsdAmount * 100 } : {}),
        ...(isScheduled ? { scheduledStartAtIso: scheduledStartAt!.toISOString() } : {}),
        ...(challengeEndDate ? { challengeEndAtIso: challengeEndDate.toISOString() } : {}),
        challengeDurationDays: durationDays,
      };

      const res = await authFetch(`/api/races/host`, {
        method: "POST",
        body: JSON.stringify(body),
      });

      const data = await res.json() as {
        raceId?: string;
        code?: string;
        error?: string;
        isScheduled?: boolean;
        scheduledStartAt?: string;
        inviteCode?: string;
        race?: { entryType?: string; targetSteps?: number; coinEntryAmount?: number; entryAmountCents?: number; maxPlayers?: number; isPrivate?: boolean; inviteCode?: string | null };
        active_race?: { room_id: string; room_status: string; challenge_type: string; entry_fee: number; target_steps: number; current_user_role: string };
      };

      if (!res.ok) {
        if (res.status === 409 && data.code === "ACTIVE_RACE_EXISTS" && data.active_race) {
          const ar = data.active_race;
          setActiveRaceModal({
            room_id: ar.room_id,
            room_status: ar.room_status as "open" | "in_progress",
            challenge_type: ar.challenge_type,
            entry_fee: ar.entry_fee,
            target_steps: ar.target_steps,
            current_user_role: ar.current_user_role as "host" | "participant",
            can_leave: true,
            next_screen: "/(tabs)/walk",
          });
          return;
        }
        AppAlert.alert("Error", cashChallengeBlockedMessage(data.error));
        return;
      }

      if (!data.raceId) {
        AppAlert.alert("Error", "Unexpected server response. Please try again.");
        return;
      }

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

      if (data.isScheduled) {
        const isPrivateRoom = data.race?.isPrivate ?? (roomType === "private");
        setScheduledRoomResult({
          inviteCode: data.inviteCode ?? null,
          isPrivate: isPrivateRoom,
          scheduledStartAt: data.scheduledStartAt ?? new Date().toISOString(),
          targetSteps: data.race?.targetSteps ?? STEP_TARGETS[challengeTargetIdx],
          entryType: data.race?.entryType ?? entryType,
          entryAmountCents: data.race?.entryAmountCents ?? 0,
          coinEntryAmount: data.race?.coinEntryAmount ?? 0,
        });
        setChallengeModal(false);
        setChallengeStartDate(new Date());
        setChallengeEndDate(null);
        setChallengeStartTimeIdx(0);
        setChallengeCreating(false);
        return;
      }

      // Instant room — navigate to matchmaking lobby
      setChallengeModalAnimated(false);

      router.push({
        pathname: "/race/matchmaking",
        params: {
          raceId: data.raceId,
          isHost: "true",
          initialEntryType: data.race?.entryType ?? entryType,
          initialTargetSteps: String(data.race?.targetSteps ?? STEP_TARGETS[challengeTargetIdx]),
          initialCoinEntryAmount: String(data.race?.coinEntryAmount ?? 0),
          initialMaxPlayers: String(data.race?.maxPlayers ?? challengeMaxPlayers),
          initialIsPrivate: String(data.race?.isPrivate ?? (roomType === "private")),
          initialInviteCode: data.race?.inviteCode ?? data.inviteCode ?? "",
        },
      });

      navigating = true;
      InteractionManager.runAfterInteractions(() => {
        setChallengeModal(false);
        setShowCreateConfirm(false);
        setCreateConfirmChecks([false, false, false]);
        setChallengeCreating(false);
        setChallengeModalAnimated(true);
      });
    } catch {
      AppAlert.alert("Error", "Network error. Please try again.");
    } finally {
      if (!navigating) setChallengeCreating(false);
    }
  };

  if (authLoading || !userReady) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background, paddingTop: safeTop, paddingBottom: tabBarHeight }]}>
        <View style={{ padding: 24 }}>
          <SkeletonList count={5} />
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingTop: safeTop, paddingBottom: tabBarHeight }]}>
      {/* Auto-detected banner */}
      <Animated.View
        style={[styles.banner, { top: safeTop, backgroundColor: colors.primary, opacity: bannerAnim, transform: [{ translateY: bannerAnim.interpolate({ inputRange: [0, 1], outputRange: [-60, 0] }) }] }]}
        pointerEvents="none"
      >
        <Feather name="activity" size={14} color={colors.primaryForeground} />
        <Text style={[styles.bannerText, { color: colors.primaryForeground }]}>Walking detected. Tracking started automatically.</Text>
      </Animated.View>

      {/* Milestone banner */}
      {milestoneReached && (
        <View style={[styles.milestoneBanner, { top: safeTop + 8, backgroundColor: colors.gold + "20", borderColor: colors.gold + "40" }]}>
          <Text style={styles.milestoneEmoji}>🎉</Text>
          <BlueShoe size={16} />
          <Text style={[styles.milestoneText, { color: colors.gold }]}>{milestoneReached.toLocaleString()} steps milestone!</Text>
        </View>
      )}

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.scroll, { paddingTop: 16, paddingBottom: safeBottom + 40 }]}
      >
        {/* Header */}
        <View style={styles.pageHeader}>
          <View style={styles.pageTitleRow}>
            <Text style={[styles.pageTitle, { color: colors.foreground }]}>Walk Champ</Text>
          </View>
          <View style={styles.headerRight}>
            {/* Coin pill — tappable to open Coins Info */}
            <TouchableOpacity
              onPress={() => setShowCoinsInfo(true)}
              style={[styles.coinPill, { backgroundColor: colors.gold + "18", borderColor: colors.gold + "40" }]}
              activeOpacity={0.78}
              accessibilityLabel="View coin details"
            >
              <CoinIcon size="small" />
              <Text style={[styles.coinPillText, { color: colors.gold }]}>
                {coinBalance != null ? coinBalance.toLocaleString() : "--"}
              </Text>
              <Feather name="info" size={11} color={colors.gold} style={{ opacity: 0.8, marginLeft: 1 }} />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => { setShowProfile(true); }}
              style={[styles.profileAvatar, { backgroundColor: (user?.avatarColor ?? colors.primary) + "25", borderColor: user?.avatarColor ?? colors.primary, zIndex: 20 }]}
              activeOpacity={0.7}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            >
            {user?.id && user?.profileImageUrl ? (
              <Image source={{ uri: profileAvatarImageUri(user.id, user?.avatarVersion ?? 0) }} style={styles.profileAvatarImg} />
            ) : (
              <Text style={[styles.profileAvatarText, { color: user?.avatarColor ?? colors.primary }]}>
                {(user?.fullName ?? "W").charAt(0).toUpperCase()}
              </Text>
            )}
          </TouchableOpacity>
          </View>
        </View>

        {/* Online presence bar */}
        <PresenceBar colors={colors} />

        {/* Tracking card — tappable to open Walking History */}
        <TouchableOpacity
          activeOpacity={0.88}
          onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.push("/walk/step-history"); }}
          style={styles.trackingCardWrap}
        >
          <LinearGradient
            colors={[`${statusConf.color}18`, `${statusConf.color}08`]}
            style={[styles.trackingCard, { borderColor: `${statusConf.color}30` }]}
          >
            <View style={styles.trackingHeader}>
              <View style={styles.trackingLeft}>
                {stepPermissionStatus === "granted" ? (
                  <>
                    <View style={[styles.trackingBadge, { backgroundColor: `${statusConf.color}20`, borderColor: `${statusConf.color}40` }]}>
                      <Animated.View style={[styles.statusDot, { backgroundColor: statusConf.color, opacity: trackingStatus === "walking" ? dotAnim : 1 }]} />
                      <Text style={[styles.statusLabel, { color: statusConf.color }]}>{statusConf.label}</Text>
                    </View>
                    <Text style={[styles.autoTrackingLabel, { color: colors.foreground }]}>
                      Auto Tracking <Text style={{ color: colors.primary, fontWeight: "700" }}>ON</Text>
                      {verificationLevel === "limited" && (
                        <Text style={{ color: "#F59E0B", fontWeight: "600", fontSize: 11 }}> · Limited</Text>
                      )}
                    </Text>
                    <Text style={[styles.trackingSub, { color: colors.mutedForeground }]}>
                      {verificationLevel === "verified"
                        ? "Verified Tracking — eligible for rewards and races"
                        : verificationLevel === "limited"
                          ? "Limited Tracking — display only, not eligible for rewards"
                          : "Steps count automatically when you walk"}
                    </Text>
                  </>
                ) : (
                  <>
                    <View style={[styles.trackingBadge, { backgroundColor: "#7B7E9720", borderColor: "#7B7E9740" }]}>
                      <View style={[styles.statusDot, { backgroundColor: "#7B7E97" }]} />
                      <Text style={[styles.statusLabel, { color: "#7B7E97" }]}>Idle</Text>
                    </View>
                    <Text style={[styles.autoTrackingLabel, { color: colors.foreground }]}>
                      Auto Tracking <Text style={{ color: "#7B7E97", fontWeight: "700" }}>OFF</Text>
                    </Text>
                    <Text style={[styles.trackingSub, { color: colors.mutedForeground }]}>
                      {Platform.OS === "android" && stepPermissionStatus === "unavailable" && hcAvailability === "not_supported"
                        ? "Limited phone sensor tracking may be available — tap Connect to try"
                        : Platform.OS === "android" && stepPermissionStatus === "unavailable" && hcAvailability === "not_installed"
                          ? "Install Health Connect from Google Play, then return to grant Steps permission"
                        : Platform.OS === "android" && stepPermissionStatus === "unavailable" && hcAvailability === "needs_update"
                          ? "Update Health Connect from Google Play, then return to grant Steps permission"
                          : Platform.OS === "android" && stepPermissionStatus === "unavailable"
                            ? "Tap Connect to set up step tracking"
                            : stepPermissionStatus === "denied"
                              ? "Tap Connect to request Steps permission again in Walk Champ"
                              : "Tap Connect to allow Walk Champ to read your steps from Health Connect"}
                    </Text>
                  </>
                )}
              </View>
              {stepPermissionStatus === "granted" ? (
                <TouchableOpacity
                  style={[styles.pauseBtn, { backgroundColor: trackingStatus === "walking" ? colors.warning + "20" : colors.primary + "20", borderColor: trackingStatus === "walking" ? colors.warning + "40" : colors.primary + "40" }]}
                  onPress={(e) => { e.stopPropagation(); Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); router.push("/walk/step-history"); }}
                >
                  <Feather name="settings" size={18} color={trackingStatus === "walking" ? colors.warning : colors.primary} />
                </TouchableOpacity>
              ) : (
                <TouchableOpacity
                  style={[styles.pauseBtn, { backgroundColor: colors.primary + "20", borderColor: colors.primary + "40" }]}
                  onPress={(e) => {
                    e.stopPropagation();
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                    if (Platform.OS === "android") {
                      setShowStepSetup(true);
                      return;
                    }
                    requestStepPermission();
                  }}
                >
                  <Feather
                    name={
                      Platform.OS === "android" && stepPermissionStatus === "unavailable" &&
                      (hcAvailability === "needs_update" || hcAvailability === "not_installed")
                        ? "download"
                        : "unlock"
                    }
                    size={18}
                    color={colors.primary}
                  />
                </TouchableOpacity>
              )}
            </View>

            <View style={styles.stepsHero}>
              <WalkProgressIcon steps={safeTodaySteps} goal={goalSteps} size={56} style={styles.stepsHeroIcon} />
              <View style={styles.stepsHeroText}>
                {stepsInitializing ? (
                  <>
                    <ActivityIndicator size="small" color={colors.primary} style={{ marginBottom: 6 }} />
                    <Text style={[styles.stepsHeroLabel, { color: colors.mutedForeground }]}>Loading steps…</Text>
                  </>
                ) : (
                  <>
                    <Text style={[styles.stepsHeroValue, { color: colors.foreground }]}>{safeTodaySteps.toLocaleString()}</Text>
                    <Text style={[styles.stepsHeroLabel, { color: colors.mutedForeground }]}>steps today</Text>
                  </>
                )}
              </View>
            </View>

            {showRaceStepsOnWalk ? (
              <View style={[styles.raceStepsRow, { borderTopColor: colors.border }]}>
                <Feather name="flag" size={14} color={colors.primary} />
                <Text style={[styles.raceStepsLabel, { color: colors.mutedForeground }]}>
                  {racePhase === "in_race" ? "Race steps" : "Last race steps"}
                </Text>
                <Text style={[styles.raceStepsValue, { color: colors.primary }]}>
                  {raceStepsOnWalk.toLocaleString()}
                </Text>
              </View>
            ) : null}

            <View style={styles.goalRow}>
              <Text style={[styles.goalText, { color: colors.mutedForeground }]}>Goal: {goalSteps.toLocaleString()} steps</Text>
              <Text style={[styles.goalPercent, { color: colors.primary }]}>{goalPercent}%</Text>
            </View>
            <View style={[styles.goalBar, { backgroundColor: colors.border }]}>
              <LinearGradient
                colors={[colors.primary, colors.accent]}
                style={[styles.goalFill, { width: `${Math.min(100, Math.max(0, goalPercent))}%` }]}
                start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
              />
            </View>
          </LinearGradient>
        </TouchableOpacity>

        {/* Stats grid */}
        <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>Today</Text>
        <View style={styles.statsGrid}>
          <StatCard icon="map-pin" value={formatDistance(distance)} label="Distance" color={colors.accent} bg={colors.accent + "18"} />
          <StatCard icon="zap" value={formatCalories(safeTodaySteps * 0.04)} label="Calories" color={colors.gold} bg={colors.gold + "18"} />
          <StatCard icon="clock" value={`${activeMins}m`} label="Active min" color={colors.primary} bg={colors.primary + "18"} />
          <StatCard icon="bar-chart-2" value={todayDailyRank !== null ? `#${todayDailyRank}` : "–"} label="Daily rank" color={colors.accent} bg={colors.accent + "18"} />
        </View>


        {/* Race section */}
        <View style={styles.sectionRow}>
          <Text style={[styles.sectionTitle, { color: colors.foreground, marginBottom: 0 }]}>Join a Challenge</Text>
          <TouchableOpacity
            onPress={() => router.push("/rooms/available")}
            style={[styles.roomsBtn, { backgroundColor: colors.primary + "18" }]}
            activeOpacity={0.7}
          >
            <Text style={[styles.roomsBtnText, { color: colors.primary }]}>Rooms</Text>
            {roomCounts.total > 0 && (
              <View style={[styles.roomsBadge, { backgroundColor: colors.primary + "25", borderColor: colors.primary + "55" }]}>
                <Animated.View style={[styles.roomsBadgeDot, { backgroundColor: colors.primary, opacity: roomPulseAnim }]} />
                <Text style={[styles.roomsBadgeText, { color: colors.primary }]}>{roomCounts.total}</Text>
              </View>
            )}
            <Feather name="chevron-right" size={13} color={colors.primary} />
          </TouchableOpacity>
        </View>

        {/* Sponsored waiting room lockout banner */}
        {(sponsoredStatus?.kind === "registered" || sponsoredStatus?.kind === "join_window") && (
          <TouchableOpacity
            onPress={() => router.push({ pathname: "/sponsored-events/waiting-room", params: { id: sponsoredStatus.eventId } })}
            activeOpacity={0.85}
            style={{ marginBottom: 10, borderRadius: 12, overflow: "hidden" }}
          >
            <LinearGradient
              colors={["#2D0072", "#5B21B6"]}
              style={{ flexDirection: "row", alignItems: "center", padding: 12, gap: 10 }}
              start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
            >
              <Feather name="lock" size={16} color="#C4B5FD" />
              <View style={{ flex: 1 }}>
                <Text style={{ color: "#E9D5FF", fontWeight: "700", fontSize: 13 }}>In Sponsored Waiting Room</Text>
                <Text style={{ color: "#A78BFA", fontSize: 11, marginTop: 1 }}>Leave the waiting room to host or join other races.</Text>
              </View>
              <Feather name="chevron-right" size={15} color="#A78BFA" />
            </LinearGradient>
          </TouchableOpacity>
        )}

        {!walkCacheReady && <SkeletonList count={4} variant="walk" />}
        {RACE_OPTIONS.filter((opt) => showRaceOptionInJoinSection(opt.fee)).map((opt) => {
          const entryKey = feeToEntryType(opt.fee);
          const cs = challengeStatuses[entryKey];

          const openHostModal = () => {
            const _wss = sponsoredStatus;
            if (_wss?.kind === "registered" || _wss?.kind === "join_window") {
              AppAlert.alert("In Sponsored Waiting Room", "Leave the sponsored event waiting room first to host or join other challenges.", [
                { text: "Open Waiting Room", onPress: () => router.push({ pathname: "/sponsored-events/waiting-room", params: { id: _wss.eventId } }) },
                { text: "Cancel", style: "cancel" },
              ]);
              return;
            }
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            const otherActive = findActiveRaceForOtherChallenge(entryKey);
            if (otherActive) {
              if (otherActive.cs.isHost) {
                const isActiveRace = otherActive.cs.status === "user_hosting_active";
                setAlreadyHostingModal({ isActiveRace, raceId: otherActive.cs.raceId ?? null, entryKey: otherActive.entryKey });
                return;
              }
              pendingRaceActionRef.current = opt.fee === 0
                ? () => { setPlayerCount(10); setSetupModal({ fee: 0, label: opt.label, gradients: opt.gradientColors }); return Promise.resolve(); }
                : opt.fee === -1
                  ? () => { setCoinsBattleVisible(true); return Promise.resolve(); }
                  : () => { setConfirmChecks([false, false, false]); setConfirmEntry({ fee: opt.fee, label: opt.label, gradients: opt.gradientColors }); return Promise.resolve(); };
              setActiveRaceModal(buildActiveRaceInfoFromStatus(otherActive.entryKey, otherActive.cs));
              return;
            }
            if (opt.fee === 0) {
              setPlayerCount(10);
              setSetupModal({ fee: 0, label: opt.label, gradients: opt.gradientColors });
            } else if (opt.fee === -1) {
              setCoinsBattleVisible(true);
            } else {
              setConfirmChecks([false, false, false]);
              setConfirmEntry({ fee: opt.fee, label: opt.label, gradients: opt.gradientColors });
            }
          };

          if (ENABLE_CHALLENGE_CATEGORY_CARDS) {
            return (
              <ChallengeCategoryCard
                key={opt.fee}
                fee={opt.fee}
                label={opt.label}
                subtitle={opt.subtitle}
                icon={opt.icon}
                iconImage={opt.iconImage}
                gradientColors={opt.gradientColors}
                lightAccent={opt.lightAccent}
                entryKey={entryKey}
                cs={cs}
                isJoining={joiningEntryKey === entryKey}
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                  const _wss = sponsoredStatus;
                  if (_wss?.kind === "registered" || _wss?.kind === "join_window") {
                    AppAlert.alert("In Sponsored Waiting Room", "Leave the sponsored event waiting room first to host or join other challenges.", [
                      { text: "Open Waiting Room", onPress: () => router.push({ pathname: "/sponsored-events/waiting-room", params: { id: _wss.eventId } }) },
                      { text: "Cancel", style: "cancel" },
                    ]);
                    return;
                  }
                  const s = cs?.status;
                  if (s === "user_hosting_active" || s === "user_joined_active") {
                    if (cs?.raceId) router.push({ pathname: "/race/live-detail", params: { id: cs.raceId } });
                    return;
                  }
                  if (s === "user_hosting_waiting" || s === "user_joined_waiting") {
                    if (cs?.raceId) {
                      setActiveRace(cs.raceId, cs.isHost);
                      joinRace(opt.fee, cs.maxPlayers, cs.isHost);
                      router.push({ pathname: "/race/matchmaking", params: { raceId: cs.raceId, isHost: cs.isHost ? "true" : "false" } });
                    }
                    return;
                  }
                  if (s === "active_other") {
                    router.navigate("/live");
                    return;
                  }
                  const otherActive = findActiveRaceForOtherChallenge(entryKey);
                  if (otherActive) {
                    const raceIdForJoin = s === "join_available" ? cs?.raceId ?? null : null;
                    pendingRaceActionRef.current = raceIdForJoin
                      ? entryKey === "coins_battle"
                        ? () => handleCoinsBattleJoin(raceIdForJoin)
                        : () => handleDirectJoin(raceIdForJoin, opt.fee, cs!.maxPlayers, entryKey)
                      : opt.fee === 0
                        ? () => { setPlayerCount(10); setSetupModal({ fee: 0, label: opt.label, gradients: opt.gradientColors }); return Promise.resolve(); }
                        : opt.fee === -1
                          ? () => { setCoinsBattleVisible(true); return Promise.resolve(); }
                          : () => { setConfirmChecks([false, false, false]); setConfirmEntry({ fee: opt.fee, label: opt.label, gradients: opt.gradientColors }); return Promise.resolve(); };
                    setActiveRaceModal(buildActiveRaceInfoFromStatus(otherActive.entryKey, otherActive.cs));
                    return;
                  }
                  if (s === "join_available" && cs?.raceId) {
                    if (entryKey === "coins_battle") {
                      handleCoinsBattleJoin(cs.raceId);
                    } else {
                      handleDirectJoin(cs.raceId, opt.fee, cs.maxPlayers, entryKey);
                    }
                    return;
                  }
                  openHostModal();
                }}
                onHostNew={openHostModal}
                onWatchLive={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  router.navigate("/live");
                }}
              />
            );
          }

          const statusLabel = cs?.label ?? "Host";
          return (
            <TouchableOpacity
              key={opt.fee}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                const _wss = sponsoredStatus;
                if (_wss?.kind === "registered" || _wss?.kind === "join_window") {
                  AppAlert.alert("In Sponsored Waiting Room", "Leave the sponsored event waiting room first to host or join other challenges.", [
                    { text: "Open Waiting Room", onPress: () => router.push({ pathname: "/sponsored-events/waiting-room", params: { id: _wss.eventId } }) },
                    { text: "Cancel", style: "cancel" },
                  ]);
                  return;
                }
                const s = cs?.status;
                const modeLabel = opt.fee === 0 ? "free" : `$${opt.fee}`;
                const role = cs?.isHost ? "host" : cs?.isParticipant ? "participant" : "none";
                if (s === "user_hosting_active" || s === "user_joined_active") {
                  if (__DEV__) console.log(`[Walk] Opening challenge: mode=${modeLabel} entry_fee=${opt.fee} status=${s} role=${role} raceId=${cs?.raceId ?? "none"} route=live-detail defaultView=race_track`);
                  if (cs?.raceId) router.push({ pathname: "/race/live-detail", params: { id: cs.raceId } });
                  return;
                }
                if (s === "user_hosting_waiting" || s === "user_joined_waiting") {
                  if (__DEV__) console.log(`[Walk] Opening challenge: mode=${modeLabel} entry_fee=${opt.fee} status=${s} role=${role} raceId=${cs?.raceId ?? "none"} route=matchmaking`);
                  if (cs?.raceId) {
                    setActiveRace(cs.raceId, cs.isHost);
                    joinRace(opt.fee, cs.maxPlayers, cs.isHost);
                    router.push({ pathname: "/race/matchmaking", params: { raceId: cs.raceId, isHost: cs.isHost ? "true" : "false" } });
                  }
                  return;
                }
                if (s === "active_other") {
                  if (__DEV__) console.log(`[Walk] Opening challenge: mode=${modeLabel} entry_fee=${opt.fee} status=${s} role=${role} route=live_tab`);
                  router.navigate("/live");
                  return;
                }
                const otherActive = findActiveRaceForOtherChallenge(entryKey);
                if (otherActive) {
                  if (__DEV__) console.log(`[WalkChallengePress] target=${entryKey} currentActiveRace=${otherActive.entryKey} isSameRaceType=false action=show_active_race_modal`);
                  const raceIdForJoin = s === "join_available" ? cs?.raceId ?? null : null;
                  const pendingAction: () => Promise<void> = raceIdForJoin
                    ? entryKey === "coins_battle"
                      ? () => handleCoinsBattleJoin(raceIdForJoin)
                      : () => handleDirectJoin(raceIdForJoin, opt.fee, cs!.maxPlayers, entryKey)
                    : opt.fee === 0
                      ? () => { setPlayerCount(10); setSetupModal({ fee: 0, label: opt.label, gradients: opt.gradientColors }); return Promise.resolve(); }
                      : opt.fee === -1
                        ? () => { setCoinsBattleVisible(true); return Promise.resolve(); }
                        : () => { setConfirmChecks([false, false, false]); setConfirmEntry({ fee: opt.fee, label: opt.label, gradients: opt.gradientColors }); return Promise.resolve(); };
                  pendingRaceActionRef.current = pendingAction;
                  setActiveRaceModal(buildActiveRaceInfoFromStatus(otherActive.entryKey, otherActive.cs));
                  return;
                }
                if (s === "join_available" && cs?.raceId) {
                  if (__DEV__) console.log(`[Walk] Opening challenge: mode=${modeLabel} entry_fee=${opt.fee} status=${s} role=${role} raceId=${cs.raceId} route=matchmaking_join`);
                  if (entryKey === "coins_battle") {
                    handleCoinsBattleJoin(cs.raceId);
                  } else {
                    handleDirectJoin(cs.raceId, opt.fee, cs.maxPlayers, entryKey);
                  }
                  return;
                }
                if (__DEV__) console.log(`[Walk] Opening challenge: mode=${modeLabel} entry_fee=${opt.fee} status=${s ?? "host_available"} role=${role} route=setup_modal`);
                openHostModal();
              }}
              activeOpacity={0.88}
              style={styles.raceCardWrap}
            >
              <LinearGradient
                colors={opt.gradientColors}
                style={styles.raceCardGradient}
                start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
              >
                <View style={[styles.raceCardIcon, { backgroundColor: "rgba(255,255,255,0.18)" }]}>
                  <Feather name={opt.icon as never} size={22} color="#FFF" />
                </View>
                <View style={styles.raceCardText}>
                  <Text style={styles.raceCardLabel}>{opt.label}</Text>
                  <Text style={styles.raceCardSub}>{opt.subtitle}</Text>
                </View>
                <View style={styles.raceCardRight}>
                  <RaceJoinBadge
                    status={cs?.status}
                    joinedCount={cs?.joinedCount}
                    maxPlayers={cs?.maxPlayers ?? 10}
                    label={statusLabel}
                  />
                  <Feather name="chevron-right" size={18} color="rgba(255,255,255,0.8)" />
                </View>
              </LinearGradient>
              <JoinProgressOverlay isJoining={joiningEntryKey === entryKey} />
            </TouchableOpacity>
          );
        })}

        {/* ── Groups Card ── */}
        <TouchableOpacity
          activeOpacity={0.88}
          onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); router.push("/groups"); }}
          style={[styles.groupsCardWrap, { position: "relative" }]}
        >
          <LinearGradient
            colors={["#4C0519", "#BE123C", "#831843"] as [string, string, string]}
            style={styles.groupsCard}
            start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
          >
            {/* Glowing nodes background */}
            <View style={styles.groupsGlowNode1} />
            <View style={styles.groupsGlowNode2} />
            <View style={styles.groupsGlowNode3} />

            {/* Left: icon + text */}
            <View style={styles.groupsLeft}>
              <LinearGradient colors={["#F43F5E", "#FB7185"]} style={styles.groupsIconWrap} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}>
                <Feather name="users" size={20} color="#FFF" />
              </LinearGradient>
              <View style={styles.groupsTextBlock}>
                <Text style={styles.groupsTitle}>Groups</Text>
                <Text style={styles.groupsSub}>Compete daily with friends, family, or coworkers.</Text>
                <View style={styles.groupsTagRow}>
                  <View style={styles.groupsTag}><Text style={styles.groupsTagText}>Friends</Text></View>
                  <View style={styles.groupsTag}><Text style={styles.groupsTagText}>Family</Text></View>
                  <View style={styles.groupsTag}><Text style={styles.groupsTagText}>Office</Text></View>
                </View>
              </View>
            </View>

            {/* Right: CTA */}
            <View style={styles.groupsCta}>
              <LinearGradient colors={["#F43F5E", "#BE123C"]} style={styles.groupsCtaBtn} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}>
                <Text style={styles.groupsCtaText}>View</Text>
              </LinearGradient>
            </View>
          </LinearGradient>
          {pendingGroupInvites > 0 && (
            <View style={styles.groupsInviteBadge}>
              <Text style={styles.groupsInviteBadgeText}>{pendingGroupInvites}</Text>
            </View>
          )}
        </TouchableOpacity>

        {/* ── Premium Challenges Section ── */}
        <View>
          {/* Section header */}
          <View style={[styles.sectionRow, { marginTop: 8, marginBottom: 4 }]}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Premium Challenges</Text>
            </View>
          </View>

          {/* Cash Prize Challenge ($3 card) */}
          {ENABLE_THREE_DOLLAR_CHALLENGE && (() => {
            const premOpt = RACE_OPTIONS.find((o) => o.fee === 3)!;
            const premKey = "paid_3";
            const premCs = challengeStatuses[premKey];
            const premS = premCs?.status;

            const handlePremiumPress = () => {
              if (__DEV__) console.log("[PremiumChallenge] $3 card clicked");
              const _wss = sponsoredStatus;
              if (_wss?.kind === "registered" || _wss?.kind === "join_window") {
                AppAlert.alert("In Sponsored Waiting Room", "Leave the sponsored event waiting room first to host or join other challenges.", [
                  { text: "Open Waiting Room", onPress: () => router.push({ pathname: "/sponsored-events/waiting-room", params: { id: _wss.eventId } }) },
                  { text: "Cancel", style: "cancel" },
                ]);
                return;
              }
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              if (premS === "user_hosting_active" || premS === "user_joined_active") {
                if (premCs?.raceId) router.push({ pathname: "/race/live-detail", params: { id: premCs.raceId } });
                return;
              }
              if (premS === "user_hosting_waiting" || premS === "user_joined_waiting") {
                if (premCs?.raceId) {
                  setActiveRace(premCs.raceId, premCs.isHost);
                  joinRace(3, premCs.maxPlayers, premCs.isHost);
                  router.push({ pathname: "/race/matchmaking", params: { raceId: premCs.raceId, isHost: premCs.isHost ? "true" : "false" } });
                }
                return;
              }
              if (premS === "join_available" && premCs?.raceId) {
                if (__DEV__) console.log("[PremiumChallenge] join flow opened", { raceId: premCs.raceId });
                void handleDirectJoin(premCs.raceId, 3, premCs.maxPlayers, premKey);
                return;
              }
              if (__DEV__) console.log("[PremiumChallenge] create flow opened");
              setConfirmChecks([false, false, false]);
              setConfirmEntry({ fee: 3, label: "$3 Premium Challenge", gradients: premOpt.gradientColors });
            };

            const premStatusLabel =
              premS === "user_hosting_active" || premS === "user_joined_active" ? "Live" :
              premS === "user_hosting_waiting" || premS === "user_joined_waiting" ? "Waiting" :
              premS === "join_available" ? "Join" : "Host";

            return (
              <TouchableOpacity
                onPress={handlePremiumPress}
                activeOpacity={0.88}
                style={styles.raceCardWrap}
              >
                <LinearGradient
                  colors={premOpt.gradientColors}
                  style={styles.raceCardGradient}
                  start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
                >
                  <View style={[styles.raceCardIcon, { backgroundColor: "rgba(255,255,255,0.18)" }]}>
                    <Feather name="award" size={22} color="#FFF" />
                  </View>
                  <View style={[styles.raceCardText, { flex: 1 }]}>
                    <Text style={styles.raceCardLabel}>Cash Prize Challenge</Text>
                    <Text style={styles.raceCardSub}>Skill-based walking challenge · Prize rewards</Text>
                    <View style={{ flexDirection: "row", gap: 5, marginTop: 5, flexWrap: "wrap" }}>
                      {["$3 entry", "Step goal"].map((chip) => (
                        <View key={chip} style={{ backgroundColor: "rgba(255,255,255,0.18)", borderRadius: 8, paddingHorizontal: 7, paddingVertical: 2 }}>
                          <Text style={{ color: "#FFF", fontSize: 10, fontWeight: "700" }}>{chip}</Text>
                        </View>
                      ))}
                    </View>
                  </View>
                  <View style={styles.raceCardRight}>
                    <RaceJoinBadge
                      status={premCs?.status}
                      joinedCount={premCs?.joinedCount}
                      maxPlayers={premCs?.maxPlayers ?? 10}
                      label={premStatusLabel}
                    />
                    <Feather name="chevron-right" size={18} color="rgba(255,255,255,0.8)" />
                  </View>
                </LinearGradient>
                <JoinProgressOverlay isJoining={joiningEntryKey === premKey} />
              </TouchableOpacity>
            );
          })()}

          {/* Sponsored Events */}
          {(() => {
            const ss = sponsoredStatus;
            const isRacing     = ss?.kind === "racing";
            const isJoinWin    = ss?.kind === "join_window";
            const isRegistered = ss?.kind === "registered";
            const isAvailable  = ss?.kind === "available";
            const isWatchLive  = ss?.kind === "watch_live";

            const handleSponsoredPress = () => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
              if (isRacing && ss)     { router.push({ pathname: "/race/live-detail", params: { id: ss.eventId } }); return; }
              if (isJoinWin && ss)    { router.push({ pathname: "/sponsored-events/waiting-room", params: { id: ss.eventId } }); return; }
              if (isRegistered && ss) { router.push({ pathname: "/sponsored-events/waiting-room", params: { id: ss.eventId } }); return; }
              if (isWatchLive && ss)  { router.push({ pathname: "/race/live-detail", params: { id: ss.eventId } }); return; }
              router.push("/sponsored-events");
            };

            const ctaColors: [string, string] = isRacing
              ? ["#006633", "#00E676"]
              : (isJoinWin || isRegistered)
                ? ["#5B21B6", "#A855F7"]
                : isWatchLive
                  ? ["#006633", "#00C853"]
                  : ["#6C00FF", "#B44DFF"];

            const ctaLabel = isRacing
              ? "🏃 Racing"
              : isWatchLive
                ? "Watch Live"
                : "View";

            const subText = isRacing
              ? "You're racing right now!"
              : isJoinWin
                ? "Race starts in under 10 min — tap to join!"
                : isRegistered
                  ? "You're in! Tap to open the waiting room."
                  : isAvailable
                    ? "Enter with 5,000 coins · Win real prizes"
                    : isWatchLive
                      ? "A race is live now! Watch or register to join."
                      : "Weekend 10K races. Register with coins. Win sponsored prizes.";

            const iconColor  = isRacing ? "#6EE7B7" : (isJoinWin || isRegistered || isAvailable) ? "#C7D2FE" : "#C7D2FE";
            const badgeStyle = isRacing
              ? { backgroundColor: "rgba(0,200,83,0.2)", borderColor: "#00E67650" }
              : (isJoinWin || isRegistered)
                ? { backgroundColor: "rgba(168,85,247,0.25)", borderColor: "#A855F750" }
                : { backgroundColor: "rgba(99,102,241,0.25)", borderColor: "#818CF850" };

            return (
              <TouchableOpacity
                activeOpacity={0.88}
                onPress={handleSponsoredPress}
                style={styles.sponsoredCardWrap}
              >
                <LinearGradient
                  colors={isRacing
                    ? ["#001A0D", "#003322", "#0F172A"] as [string, string, string]
                    : isJoinWin
                      ? ["#1E0B4B", "#3B1080", "#0F172A"] as [string, string, string]
                      : ["#1E1B4B", "#3730A3", "#0F172A"] as [string, string, string]
                  }
                  style={styles.sponsoredCard}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                >
                  <View style={styles.sponsoredGlow1} />
                  <View style={styles.sponsoredGlow2} />
                  <View style={styles.sponsoredLeft}>
                    <View style={[styles.sponsoredIconWrap, badgeStyle]}>
                      <Feather
                        name={isRacing ? "activity" : (isJoinWin || isRegistered) ? "users" : isAvailable ? "user-plus" : "award"}
                        size={24}
                        color={iconColor}
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <View style={styles.sponsoredTitleRow}>
                        <Text style={styles.sponsoredTitle}>Sponsored Events</Text>
                        {isRegistered && (
                          <View style={[styles.newBadge, { backgroundColor: "#A855F725", borderColor: "#A855F755" }]}>
                            <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: "#A855F7", marginRight: 3 }} />
                            <Text style={[styles.newBadgeText, { color: "#A855F7" }]}>JOINED</Text>
                          </View>
                        )}
                        {!isRacing && !isJoinWin && !isRegistered && !isWatchLive && (
                          <View style={styles.newBadge}>
                            <Text style={styles.newBadgeText}>NEW</Text>
                          </View>
                        )}
                        {isRacing && (
                          <View style={[styles.newBadge, { backgroundColor: "#00E67625", borderColor: "#00E67655" }]}>
                            <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: "#00E676", marginRight: 3 }} />
                            <Text style={[styles.newBadgeText, { color: "#00E676" }]}>LIVE</Text>
                          </View>
                        )}
                      </View>
                      <Text style={styles.sponsoredSub} numberOfLines={2}>{subText}</Text>
                      {!isRacing && !isJoinWin && !isRegistered && !isWatchLive && (
                        <View style={styles.sponsoredBadgesRow}>
                          <View style={styles.sponsoredBadge}>
                            <Image source={require("@/assets/images/game-coin.png")} style={{ width: 11, height: 11 }} resizeMode="contain" />
                            <Text style={styles.sponsoredBadgeText}>5,000 entry</Text>
                          </View>
                          <View style={[styles.sponsoredBadge, styles.sponsoredSlotBadge]}>
                            <Text style={[styles.sponsoredBadgeText, { color: "#00E5FF" }]}>⚡ Limited slots</Text>
                          </View>
                        </View>
                      )}
                    </View>
                  </View>
                  <View style={styles.sponsoredRight}>
                    <LinearGradient
                      colors={ctaColors}
                      style={[styles.sponsoredCta, isRacing && { minWidth: 70 }]}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 1 }}
                    >
                      <Text style={styles.sponsoredCtaText}>{ctaLabel}</Text>
                    </LinearGradient>
                  </View>
                </LinearGradient>
              </TouchableOpacity>
            );
          })()}

          {/* Create Challenge */}
          <TouchableOpacity
            onPress={() => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              const _wss = sponsoredStatus;
              if (_wss?.kind === "registered" || _wss?.kind === "join_window") {
                AppAlert.alert("In Sponsored Waiting Room", "Leave the sponsored event waiting room first to host or join other challenges.", [
                  { text: "Open Waiting Room", onPress: () => router.push({ pathname: "/sponsored-events/waiting-room", params: { id: _wss.eventId } }) },
                  { text: "Cancel", style: "cancel" },
                ]);
                return;
              }
              const anyActive = findAnyActiveRace();
              if (anyActive) {
                if (anyActive.cs.isHost) {
                  const isActiveRace = anyActive.cs.status === "user_hosting_active";
                  setAlreadyHostingModal({ isActiveRace, raceId: anyActive.cs.raceId ?? null, entryKey: anyActive.entryKey });
                  return;
                }
                pendingRaceActionRef.current = () => {
                  openCreateChallengeModal();
                  return Promise.resolve();
                };
                setActiveRaceModal(buildActiveRaceInfoFromStatus(anyActive.entryKey, anyActive.cs));
                return;
              }
              openCreateChallengeModal();
            }}
            activeOpacity={0.88}
            style={[styles.friendsCard, { backgroundColor: colors.card, borderColor: "#A855F730" }]}
          >
            <View style={[styles.friendsIcon, { backgroundColor: "#A855F720" }]}>
              <Feather name="flag" size={22} color="#A855F7" />
            </View>
            <View style={styles.friendsText}>
              <Text style={[styles.friendsLabel, { color: colors.foreground }]}>Create Challenge</Text>
              <Text style={[styles.friendsSub, { color: colors.mutedForeground }]}>Create public or private challenge</Text>
            </View>
            <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
          </TouchableOpacity>
        </View>
      </ScrollView>

      {/* ── Race Setup Modal ── */}
      <Modal visible={!!setupModal} animationType={setupModalAnimated ? "slide" : "none"} presentationStyle="pageSheet" transparent={false} onDismiss={() => setSetupModalAnimated(true)}>
        <SafeAreaView edges={["top", "left", "right", "bottom"]} style={[styles.modalWrap, { backgroundColor: colors.background }]}>
          <View style={[styles.modalHeader, { borderBottomColor: colors.border }]}>
            <Text style={[styles.modalTitle, { color: colors.foreground }]}>
              {(setupModal?.fee ?? 0) === 0
                ? "Host Free Challenge"
                : `Host Challenge — $${(setupModal?.fee ?? 0).toFixed(2)} Entry`}
            </Text>
            <TouchableOpacity onPress={() => setSetupModal(null)}>
              <Feather name="x" size={22} color={colors.foreground} />
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={[styles.modalBody, modalScrollPad]} showsVerticalScrollIndicator={false}>
            {/* Player count selector */}
            <Text style={[styles.modalSectionLabel, { color: colors.mutedForeground }]}>Number of Players</Text>
            <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 8 }}>
              {[2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => {
                const active = playerCount === n;
                return (
                  <TouchableOpacity
                    key={n}
                    onPress={() => setPlayerCount(n)}
                    activeOpacity={0.78}
                    style={{
                      flex: 1,
                      marginHorizontal: 2,
                      paddingVertical: 8,
                      borderRadius: 10,
                      borderWidth: 1.5,
                      alignItems: "center",
                      justifyContent: "center",
                      backgroundColor: active ? colors.primary : colors.card,
                      borderColor: active ? colors.primary : colors.border,
                      shadowColor: active ? colors.primary : "transparent",
                      shadowOpacity: active ? 0.45 : 0,
                      shadowRadius: active ? 6 : 0,
                      elevation: active ? 4 : 0,
                    }}
                  >
                    <Text style={{ fontSize: 14, fontWeight: active ? "700" : "500", color: active ? "#000" : colors.foreground }}>{n}</Text>
                    {active && (
                      <View style={{ position: "absolute", top: -5, right: -5, backgroundColor: colors.primary, borderRadius: 8, width: 14, height: 14, alignItems: "center", justifyContent: "center" }}>
                        <Feather name="check" size={9} color="#000" />
                      </View>
                    )}
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* Target Steps */}
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 8 }}>
              <Feather name="target" size={13} color="#9AA4C7" />
              <Text style={[styles.modalSectionLabel, { color: colors.mutedForeground, marginBottom: 0 }]}>TARGET STEPS</Text>
            </View>
            <TargetStepsCenteredPicker
              value={selectedTargetSteps}
              onChange={(v) => {
                setSelectedTargetSteps(v);
                if (__DEV__) console.log("[CreateChallenge] target_steps payload:", v);
              }}
            />

            {/* Race details */}
            <View style={[styles.detailCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              {isFreeRace ? (
                <>
                  <View style={styles.detailRow}>
                    <Text style={[styles.detailLabel, { color: colors.mutedForeground }]}>Entry Fee</Text>
                    <Text style={[styles.detailValue, { color: colors.primary }]}>Free</Text>
                  </View>
                  <View style={[styles.detailDivider, { backgroundColor: colors.border }]} />
                  <View style={styles.detailRow}>
                    <Text style={[styles.detailLabel, { color: colors.mutedForeground }]}>Prizes</Text>
                    <Text style={[styles.detailValue, { color: colors.mutedForeground }]}>Coins &amp; badges only</Text>
                  </View>
                </>
              ) : (
                <>
                  {[
                    { label: "Entry Fee", value: `$${(setupModal?.fee ?? 1).toFixed(2)} per player`, color: colors.accent },
                    { label: "Players", value: String(playerCount), color: colors.foreground },
                    { label: "Entry Pool / Prize Pool", value: `$${computedPool.toFixed(2)}`, color: colors.gold },
                  ].map((row, i) => (
                    <View key={i}>
                      {i > 0 && <View style={[styles.detailDivider, { backgroundColor: colors.border }]} />}
                      <View style={styles.detailRow}>
                        <Text style={[styles.detailLabel, { color: colors.mutedForeground }]}>{row.label}</Text>
                        <Text style={[styles.detailValue, { color: row.color }]}>{row.value}</Text>
                      </View>
                    </View>
                  ))}
                </>
              )}
            </View>
            {!isFreeRace && (
              <>
                <CashChallengeRewardSplit quote={setupPaymentQuote} colors={colors} />
                <CashChallengePaymentBreakdown quote={setupPaymentQuote} colors={colors} />
              </>
            )}

            {/* Wallet balance — paid only */}
            {!isFreeRace && (
              <View style={[styles.balanceRow, { backgroundColor: colors.card, borderColor: canAfford ? colors.primary + "40" : colors.destructive + "40" }]}>
                <Feather name="dollar-sign" size={16} color={canAfford ? colors.primary : colors.destructive} />
                <Text style={[styles.balanceLabel, { color: colors.mutedForeground }]}>Your balance</Text>
                <Text style={[styles.balanceValue, { color: canAfford ? colors.primary : colors.destructive }]}>
                  ${walletBalance.toFixed(2)}
                </Text>
                {!canAfford && <Text style={[styles.insufficientText, { color: colors.destructive }]}>Insufficient</Text>}
              </View>
            )}

            {/* Track Background */}
            <View style={styles.trackBgHeader}>
              <Text style={[styles.modalSectionLabel, { color: colors.mutedForeground }]}>Track Background</Text>
              <Text style={[styles.trackBgHint, { color: colors.mutedForeground }]}>Swipe to choose theme</Text>
            </View>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.trackLayoutRow}
              style={styles.trackLayoutScroll}
            >
              {(() => {
                const ownedLayouts = TRACK_LAYOUT_OPTIONS.filter((layout) => {
                  const themeData = themes.find((t) => t.code === layout.id);
                  return themeData?.owned ?? FREE_TRACK_CODES.has(layout.id);
                });
                return ownedLayouts.map((layout) => {
                  const active = selectedTrackLayout === layout.id;
                  return (
                    <TouchableOpacity
                      key={layout.id}
                      activeOpacity={0.86}
                      onPress={() => setSelectedTrackLayout(layout.id)}
                      style={[
                        styles.trackLayoutCard,
                        {
                          backgroundColor: colors.card,
                          borderColor: active ? colors.primary : colors.border,
                        },
                      ]}
                    >
                      <Image source={layout.source} resizeMode="cover" style={styles.trackLayoutImage} />
                      <LinearGradient colors={["transparent", "rgba(0,0,0,0.78)"]} style={styles.trackLayoutOverlay} />
                      <View style={styles.trackLayoutFooter}>
                        <Text style={styles.trackLayoutTitle} numberOfLines={1}>{layout.label}</Text>
                        <View
                          style={[
                            styles.trackLayoutCheck,
                            {
                              backgroundColor: active ? colors.primary : "rgba(255,255,255,0.12)",
                              borderColor: active ? colors.primary : "rgba(255,255,255,0.32)",
                            },
                          ]}
                        >
                          {active && <Feather name="check" size={12} color="#000" />}
                        </View>
                      </View>
                    </TouchableOpacity>
                  );
                });
              })()}
            </ScrollView>

            {/* Buttons */}
            <TouchableOpacity
              style={[styles.joinBtn, { opacity: canAfford ? 1 : 0.5 }]}
              onPress={handleJoinRace}
              disabled={freeJoining}
              activeOpacity={0.85}
            >
              <LinearGradient
                colors={setupModal?.gradients ?? [colors.primary, colors.accent]}
                style={styles.joinGradient}
                start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
              >
                {/* Left-to-right fill that sweeps across while the API is in flight */}
                <Animated.View
                  pointerEvents="none"
                  style={{
                    position: "absolute", left: 0, top: 0, bottom: 0,
                    width: btnFillAnim.interpolate({ inputRange: [0, 1], outputRange: ["0%", "100%"] }),
                    backgroundColor: "rgba(255,255,255,0.12)",
                  }}
                />
                {(freeJoining || !setupModalAnimated)
                  ? <ActivityIndicator size="small" color="#FFF" />
                  : <Feather name="flag" size={20} color="#FFF" />}
                <Text style={styles.joinBtnText}>
                  {(freeJoining || !setupModalAnimated)
                    ? "Creating room…"
                    : isFreeRace
                      ? "Host Free Challenge"
                      : canAfford
                        ? `Host Challenge — $${setupModal?.fee.toFixed(2)} Entry`
                        : "Add Funds to Host"}
                </Text>
              </LinearGradient>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.cancelBtn, { borderColor: colors.border }]}
              onPress={() => setSetupModal(null)}
            >
              <Text style={[styles.cancelBtnText, { color: colors.mutedForeground }]}>Cancel</Text>
            </TouchableOpacity>

            <Text style={[styles.finePrint, { color: colors.mutedForeground }]}>
              {isFreeRace
                ? "Free challenges award coins and badges. No cash prizes. Open to all eligible registered users."
                : "Entry fee and separate service fees are charged when you confirm. $3 goes to the prize pool; tax/processing and platform fees are additional. Refunds return the entry fee to your wallet if you leave before the race starts."}
            </Text>
          </ScrollView>

          {/* ── Inline Purchase Overlay (rendered inside Modal, no stacking issues) ── */}
          {purchaseConfirmModal && (
            <View style={styles.purchaseOverlayInModal}>
              <View style={[styles.purchaseCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Text style={[styles.purchaseTitle, { color: colors.foreground }]}>Unlock Track Theme</Text>
                <Text style={[styles.purchaseName, { color: colors.primary }]}>{purchaseConfirmModal.name}</Text>
                <View style={styles.purchasePriceRow}>
                  <CoinIcon size="large" />
                  <Text style={[styles.purchasePrice, { color: "#FFD700" }]}>{purchaseConfirmModal.price.toLocaleString()}</Text>
                </View>
                <View style={styles.purchaseBalanceRow}>
                  <Text style={[styles.purchaseBalance, { color: colors.mutedForeground }]}>Your balance:</Text>
                  <CoinIcon size={14} />
                  <Text style={[styles.purchaseBalance, { color: "#FFD700" }]}>{(coinBalance ?? 0).toLocaleString()}</Text>
                </View>
                {(coinBalance ?? 0) < purchaseConfirmModal.price && (
                  <View style={[styles.purchaseInsufficient, { backgroundColor: colors.destructive + "15" }]}>
                    <Feather name="alert-circle" size={14} color={colors.destructive} />
                    <Text style={[styles.purchaseInsufficientText, { color: colors.destructive }]}>
                      Not enough coins. Purchase coins from the store.
                    </Text>
                  </View>
                )}
                {(coinBalance ?? 0) < purchaseConfirmModal.price && (
                  <TouchableOpacity
                    style={[styles.openStoreBtn, { backgroundColor: colors.primary + "18", borderColor: colors.primary + "55" }]}
                    onPress={() => {
                      dispatch(clearPurchaseError());
                      setPurchaseConfirmModal(null);
                      setTimeout(() => setShowCoinStore(true), 200);
                    }}
                  >
                    <Image source={require("@/assets/images/shop-icon.png")} style={styles.openStoreImg} resizeMode="contain" />
                    <Text style={[styles.openStoreBtnText, { color: colors.primary }]}>Open Store</Text>
                  </TouchableOpacity>
                )}
                <View style={styles.purchaseBtns}>
                  <TouchableOpacity
                    style={[styles.purchaseCancelBtn, { borderColor: colors.border }]}
                    onPress={() => { dispatch(clearPurchaseError()); setPurchaseConfirmModal(null); }}
                  >
                    <Text style={[styles.purchaseCancelText, { color: colors.foreground }]}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.purchaseConfirmBtn, {
                      backgroundColor: (coinBalance ?? 0) >= purchaseConfirmModal.price ? "#FFD700" : colors.border,
                      opacity: themesPurchaseLoading ? 0.6 : 1,
                    }]}
                    disabled={!!themesPurchaseLoading || (coinBalance ?? 0) < purchaseConfirmModal.price}
                    onPress={async () => {
                      const item = purchaseConfirmModal;
                      if (!item) return;
                      const result = await dispatch(purchaseTrackTheme(item.code));
                      if (purchaseTrackTheme.fulfilled.match(result)) {
                        dispatch(fetchCoinBalance());
                        dispatch(fetchTrackThemes());
                        setSelectedTrackLayout(item.code as TrackLayoutId);
                        setPurchaseConfirmModal(null);
                        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                        AppAlert.alert("Unlocked!", "Track theme unlocked successfully.");
                      } else {
                        AppAlert.alert("Failed", "Unable to unlock this theme. Please try again.");
                      }
                    }}
                  >
                    {themesPurchaseLoading ? (
                      <ActivityIndicator size="small" color="#000" />
                    ) : (
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
                        <Text style={styles.purchaseConfirmText}>Unlock for</Text>
                        <CoinIcon size={15} />
                        <Text style={styles.purchaseConfirmText}>{purchaseConfirmModal.price}</Text>
                      </View>
                    )}
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          )}
        </SafeAreaView>
      </Modal>

      {/* ── Confirm Challenge Entry Modal ── */}
      <Modal visible={!!confirmEntry} animationType={confirmEntryAnimated ? "slide" : "none"} presentationStyle="pageSheet" transparent={false} onDismiss={() => setConfirmEntryAnimated(true)}>
        <SafeAreaView edges={["top", "left", "right", "bottom"]} style={[styles.modalWrap, { backgroundColor: colors.background }]}>
          <View style={[styles.modalHeader, { borderBottomColor: colors.border }]}>
            <Text style={[styles.modalTitle, { color: colors.foreground }]}>Confirm Challenge Entry</Text>
            <TouchableOpacity onPress={() => { confirmEntryJoinCallbackRef.current = null; setConfirmEntry(null); }}>
              <Feather name="x" size={22} color={colors.foreground} />
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={[styles.modalBody, modalScrollPad]} showsVerticalScrollIndicator={false}>
            {/* Entry summary */}
            <View style={[styles.detailCard, { backgroundColor: colors.card, borderColor: colors.border, marginBottom: 20 }]}>
              <View style={styles.detailRow}>
                <Text style={[styles.detailLabel, { color: colors.mutedForeground }]}>Challenge</Text>
                <Text style={[styles.detailValue, { color: colors.foreground }]}>{confirmEntry?.label}</Text>
              </View>
              <View style={[styles.detailDivider, { backgroundColor: colors.border }]} />
              <View style={styles.detailRow}>
                <Text style={[styles.detailLabel, { color: colors.mutedForeground }]}>Entry Fee</Text>
                <Text style={[styles.detailValue, { color: colors.accent }]}>${confirmEntry?.fee.toFixed(2)}</Text>
              </View>
              <CashChallengePaymentBreakdown quote={confirmPaymentQuote} colors={colors} title="Payment Breakdown" />
              <View style={[styles.detailDivider, { backgroundColor: colors.border }]} />
              <View style={styles.detailRow}>
                <Text style={[styles.detailLabel, { color: colors.mutedForeground }]}>Type</Text>
                <Text style={[styles.detailValue, { color: colors.foreground }]}>Skill-based race</Text>
              </View>
            </View>

            {/* Compliance checkboxes */}
            <Text style={[styles.modalSectionLabel, { color: colors.mutedForeground }]}>Please confirm all of the following:</Text>

            {[
              "I understand this is a skill-based race. My result depends entirely on my activity performance — outcomes are not based on chance.",
              "I understand that the total payable amount (entry fee + tax/processing + platform service fee) is charged when I confirm. If I leave before the race starts, my entry fee is refunded to my wallet.",
              "I have read and agree to the Walk Champ Challenge Rules & Terms of Service.",
            ].map((text, i) => (
              <TouchableOpacity
                key={i}
                style={[styles.confirmCheckRow, { backgroundColor: colors.card, borderColor: confirmChecks[i] ? colors.primary + "60" : colors.border }]}
                onPress={() => {
                  const next = [...confirmChecks];
                  next[i] = !next[i];
                  setConfirmChecks(next); }}
                activeOpacity={0.8}
              >
                <View style={[styles.confirmCheckBox, { backgroundColor: confirmChecks[i] ? colors.primary : colors.background, borderColor: confirmChecks[i] ? colors.primary : colors.border }]}>
                  {confirmChecks[i] && <Feather name="check" size={13} color="#000" />}
                </View>
                <Text style={[styles.confirmCheckText, { color: colors.foreground }]}>{text}</Text>
              </TouchableOpacity>
            ))}

            {/* Proceed button */}
            <TouchableOpacity
              style={[styles.joinBtn, { opacity: confirmChecks.every(Boolean) ? 1 : 0.4 }]}
              disabled={!confirmChecks.every(Boolean)}
              onPress={() => {
                if (!confirmEntry) return;
                const { fee, label, gradients } = confirmEntry;
                if (confirmEntryJoinCallbackRef.current) {
                  // Join flow: run the pending join, don't open setup modal
                  const cb = confirmEntryJoinCallbackRef.current;
                  confirmEntryJoinCallbackRef.current = null;
                  setConfirmEntry(null);
                  cb();
                } else {
                  // Host flow: instant-close so Walk tab never shows between the two pageSheet modals
                  setConfirmEntryAnimated(false);
                  setConfirmEntry(null);
                  setPlayerCount(10);
                  setSetupModal({ fee, label, gradients });
                }
              }}
              activeOpacity={0.85}
            >
              <LinearGradient
                colors={confirmEntry?.gradients ?? [colors.primary, colors.accent]}
                style={styles.joinGradient}
                start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
              >
                <Feather name="check-circle" size={20} color="#FFF" />
                <Text style={styles.joinBtnText}>
                  {confirmPaymentQuote
                    ? `Join & Pay $${confirmPaymentQuote.totalPayable.toFixed(2)}`
                    : "Confirm & Continue"}
                </Text>
              </LinearGradient>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.cancelBtn, { borderColor: colors.border }]}
              onPress={() => { confirmEntryJoinCallbackRef.current = null; setConfirmEntry(null); }}
            >
              <Text style={[styles.cancelBtnText, { color: colors.mutedForeground }]}>Cancel</Text>
            </TouchableOpacity>

            <Text style={[styles.finePrint, { color: colors.mutedForeground }]}>
              Walk Champ is a skill-based race platform. Results are determined by your activity performance — not by chance.
            </Text>
          </ScrollView>
        </SafeAreaView>
      </Modal>

      {/* ── Create Challenge Modal ── */}
      <Modal visible={challengeModal} animationType={challengeModalAnimated ? "slide" : "none"} presentationStyle="pageSheet" transparent={false} onDismiss={() => { setChallengeModalAnimated(true); setActivePicker(null); setShowCreateConfirm(false); setCreateConfirmChecks([false, false, false]); setChallengeStartDate(new Date()); setChallengeEndDate(null); setChallengeStartTimeIdx(0); setShowStartDatePicker(false); setShowEndDatePicker(false); setChallengeEntryMode("free"); setChallengeGoalType("daily"); setChallengeTargetIdx(0); }}>
        <SafeAreaView edges={["top", "left", "right", "bottom"]} style={[styles.modalWrap, { backgroundColor: colors.background }]}>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingTop: 20, paddingBottom: 16 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
              <LinearGradient
                colors={roomType === "public" ? [colors.accent, colors.primary] : ["#6D28D9", "#4C1D95"]}
                style={{ width: 50, height: 50, borderRadius: 16, alignItems: "center", justifyContent: "center" }}
                start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
              >
                <Feather name={roomType === "private" ? "shield" : "globe"} size={22} color="#FFF" />
              </LinearGradient>
              <View>
                <Text style={{ fontSize: rf(22), fontWeight: "800", color: colors.foreground, letterSpacing: -0.3 }}>Create Challenge</Text>
                <Text style={{ fontSize: rf(12), color: colors.mutedForeground, marginTop: 2 }}>Set up your challenge. Invite others. Get racing.</Text>
              </View>
            </View>
            <TouchableOpacity
              onPress={() => { setChallengeModal(false); setShowCreateConfirm(false); setCreateConfirmChecks([false, false, false]); }}
              style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: colors.border, alignItems: "center", justifyContent: "center" }}
            >
              <Feather name="x" size={17} color={colors.mutedForeground} />
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={[styles.modalBody, modalScrollPad]} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
            {showCreateConfirm ? (() => {
              const entryLabel = challengeEntryMode === "free" ? "Free" : challengeEntryMode === "coins" ? `${coinEntryAmount.toLocaleString()} coins` : `$${challengeUsdAmount}`;
              const label = `${entryLabel} ${roomType === "public" ? "Public" : "Private"} Challenge`;
              const gradients: [string, string] = roomType === "public" ? [colors.accent, colors.primary] : ["#A855F7", "#7C3AED"];
              const isUsdConfirm = challengeEntryMode === "usd";
              const confirmChecks = isUsdConfirm ? createConfirmChecks : createConfirmChecks;
              const confirmItems = isUsdConfirm
                ? [
                    "I understand this is a skill-based race. My result depends entirely on my activity performance — outcomes are not based on chance.",
                    "I understand that the total payable amount (entry fee + tax/processing + platform service fee) is charged when I confirm. If I leave before the race starts, my entry fee is refunded to my wallet.",
                    "I have read and agree to the Walk Champ Challenge Rules & Terms of Service.",
                  ]
                : [
                    "I understand this is a skill-based race. My result depends entirely on my activity performance — outcomes are not based on chance.",
                    "I understand that coins are deducted when the race begins. If I leave the lobby before the race starts, no coins are deducted.",
                    "I have read and agree to the Walk Champ Challenge Rules & Terms of Service.",
                  ];
              const canConfirmHost =
                confirmChecks.every(Boolean) &&
                (!isUsdConfirm || (createPaymentQuote?.canAfford ?? walletBalance >= (createPaymentQuote?.totalPayable ?? challengeUsdAmount)));
              return (
                <>
                  {/* Summary card */}
                  <View style={[styles.detailCard, { backgroundColor: colors.card, borderColor: colors.border, marginBottom: 20 }]}>
                    <View style={styles.detailRow}>
                      <Text style={[styles.detailLabel, { color: colors.mutedForeground }]}>Challenge</Text>
                      <Text style={[styles.detailValue, { color: colors.foreground }]}>{label}</Text>
                    </View>
                    <View style={[styles.detailDivider, { backgroundColor: colors.border }]} />
                    <View style={styles.detailRow}>
                      <Text style={[styles.detailLabel, { color: colors.mutedForeground }]}>Entry</Text>
                      <Text style={[styles.detailValue, { color: colors.accent }]}>{entryLabel}</Text>
                    </View>
                    <View style={[styles.detailDivider, { backgroundColor: colors.border }]} />
                    <View style={styles.detailRow}>
                      <Text style={[styles.detailLabel, { color: colors.mutedForeground }]}>Type</Text>
                      <Text style={[styles.detailValue, { color: colors.foreground }]}>Skill-based race</Text>
                    </View>
                  </View>

                  {isUsdConfirm && createPaymentQuote && (
                    <>
                      <View style={[styles.detailCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                        {[
                          { label: "Entry Fee", value: `$${challengeUsdAmount} per player`, color: colors.accent },
                          { label: "Players", value: String(challengeMaxPlayers), color: colors.foreground },
                          { label: "Entry Pool / Prize Pool", value: `$${createPaymentQuote.prizePool.toFixed(2)}`, color: colors.gold },
                        ].map((row, i) => (
                          <View key={i}>
                            {i > 0 && <View style={[styles.detailDivider, { backgroundColor: colors.border }]} />}
                            <View style={styles.detailRow}>
                              <Text style={[styles.detailLabel, { color: colors.mutedForeground }]}>{row.label}</Text>
                              <Text style={[styles.detailValue, { color: row.color }]}>{row.value}</Text>
                            </View>
                          </View>
                        ))}
                      </View>
                      <CashChallengeRewardSplit quote={createPaymentQuote} colors={colors} />
                      <CashChallengePaymentBreakdown quote={createPaymentQuote} colors={colors} />
                    </>
                  )}

                  <Text style={[styles.modalSectionLabel, { color: colors.mutedForeground }]}>Please confirm all of the following:</Text>

                  {confirmItems.map((text, i) => (
                    <TouchableOpacity
                      key={i}
                      style={[styles.confirmCheckRow, { backgroundColor: colors.card, borderColor: createConfirmChecks[i] ? colors.primary + "60" : colors.border }]}
                      onPress={() => {
                        const next = [...createConfirmChecks];
                        next[i] = !next[i];
                        setCreateConfirmChecks(next);
                      }}
                      activeOpacity={0.8}
                    >
                      <View style={[styles.confirmCheckBox, { backgroundColor: createConfirmChecks[i] ? colors.primary : colors.background, borderColor: createConfirmChecks[i] ? colors.primary : colors.border }]}>
                        {createConfirmChecks[i] && <Feather name="check" size={13} color="#000" />}
                      </View>
                      <Text style={[styles.confirmCheckText, { color: colors.foreground }]}>{text}</Text>
                    </TouchableOpacity>
                  ))}

                  <TouchableOpacity
                    style={[styles.joinBtn, { opacity: canConfirmHost ? 1 : 0.4, marginTop: 8 }]}
                    disabled={!canConfirmHost || challengeCreating}
                    onPress={handleCreateChallenge}
                    activeOpacity={0.85}
                  >
                    <LinearGradient
                      colors={gradients}
                      style={styles.joinGradient}
                      start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
                    >
                      {/* Left-to-right fill that sweeps across while the API is in flight */}
                      <Animated.View
                        pointerEvents="none"
                        style={{
                          position: "absolute", left: 0, top: 0, bottom: 0,
                          width: createFillAnim.interpolate({ inputRange: [0, 1], outputRange: ["0%", "100%"] }),
                          backgroundColor: "rgba(255,255,255,0.22)",
                        }}
                      />
                      {(challengeCreating || !challengeModalAnimated)
                        ? <ActivityIndicator size="small" color="#FFF" />
                        : <Feather name="check-circle" size={20} color="#FFF" />}
                      <Text style={styles.joinBtnText}>
                        {(challengeCreating || !challengeModalAnimated)
                          ? "Creating room…"
                          : isUsdConfirm && createPaymentQuote
                            ? `Confirm Payment — $${createPaymentQuote.totalPayable.toFixed(2)}`
                            : "Confirm & Create Room"}
                      </Text>
                    </LinearGradient>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[styles.cancelBtn, { borderColor: colors.border }]}
                    onPress={() => { setShowCreateConfirm(false); setCreateConfirmChecks([false, false, false]); }}
                  >
                    <Text style={[styles.cancelBtnText, { color: colors.mutedForeground }]}>← Back</Text>
                  </TouchableOpacity>

                  <Text style={[styles.finePrint, { color: colors.mutedForeground }]}>
                    Walk Champ is a skill-based race platform. Results are determined by your activity performance — not by chance.
                  </Text>
                </>
              );
            })() : (
            <>
                {/* ── Room Type Toggle ── */}
                <View style={{ flexDirection: "row", gap: 12, marginBottom: 8 }}>
                  {(["public", "private"] as const).map((t) => {
                    const active = roomType === t;
                    const isPrivate = t === "private";
                    const accentCol = isPrivate ? "#A855F7" : colors.accent;
                    return (
                      <TouchableOpacity
                        key={t}
                        style={{ flex: 1, overflow: "hidden", borderRadius: 16, borderWidth: 1.5, borderColor: active ? accentCol : colors.border }}
                        onPress={() => setRoomType(t)}
                        activeOpacity={0.82}
                      >
                        {active && isPrivate ? (
                          <LinearGradient
                            colors={["#3B1B6B", "#1E0B40"]}
                            start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
                            style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 13 }}
                          >
                            <Feather name="shield" size={17} color="#C084FC" />
                            <Text style={{ fontSize: rf(14), fontWeight: "800", color: "#E9D5FF" }}>Private Room</Text>
                          </LinearGradient>
                        ) : (
                          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 14, backgroundColor: active ? accentCol + "18" : colors.card }}>
                            <Feather name={isPrivate ? "lock" : "globe"} size={17} color={active ? accentCol : colors.mutedForeground} />
                            <Text style={{ fontSize: rf(14), fontWeight: "700", color: active ? accentCol : colors.mutedForeground }}>
                              {isPrivate ? "Private Room" : "Public Room"}
                            </Text>
                          </View>
                        )}
                      </TouchableOpacity>
                    );
                  })}
                </View>
                <Text style={{ fontSize: rf(12), color: colors.mutedForeground, marginBottom: 20, lineHeight: 17 }}>
                  {roomType === "public"
                    ? "Open to all eligible players. Anyone matching your settings can join."
                    : "Invite-only · Share a room code with friends to play together privately."}
                </Text>

                {/* ── PRIVATE: Join with Code — premium style ── */}
                {roomType === "private" && (
                  <>
                    <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 14, gap: 10 }}>
                      <View style={{ flex: 1, height: 1, backgroundColor: "#A855F720" }} />
                      <Text style={{ color: "#A855F770", fontSize: rf(10), fontWeight: "700", letterSpacing: 1.2 }}>OR JOIN EXISTING</Text>
                      <View style={{ flex: 1, height: 1, backgroundColor: "#A855F720" }} />
                    </View>
                    <TouchableOpacity
                      style={{ overflow: "hidden", borderRadius: 14, marginBottom: 20, borderWidth: 1, borderColor: "#A855F755" }}
                      onPress={() => setJoinWithCodeVisible(true)}
                      activeOpacity={0.8}
                    >
                      <LinearGradient
                        colors={["#2D1052", "#1E0B40"]}
                        start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
                        style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, paddingVertical: 15 }}
                      >
                        <Feather name="key" size={16} color="#C084FC" />
                        <Text style={{ color: "#E9D5FF", fontWeight: "700", fontSize: rf(14), letterSpacing: 0.1 }}>Enter with Room Code</Text>
                        <Feather name="arrow-right" size={14} color="#A855F780" />
                      </LinearGradient>
                    </TouchableOpacity>
                  </>
                )}

                {/* ── Settings Card (redesigned to match design) ── */}
                {(() => {
                  const accent = roomType === "public" ? colors.accent : "#A855F7";
                  const today = new Date();
                  const isToday = isSameDay(challengeStartDate, today);
                  const nowMinutes = new Date().getHours() * 60 + new Date().getMinutes();
                  const rawPreset = isToday
                    ? (TIME_PRESETS_WITH_NOW[challengeStartTimeIdx] ?? TIME_PRESETS_WITH_NOW[0])
                    : (TIME_PRESETS_FUTURE[Math.max(0, challengeStartTimeIdx - 1)] ?? TIME_PRESETS_FUTURE[0]);
                  const effectiveTimePreset =
                    isToday && !rawPreset.isNow && rawPreset.hour * 60 + rawPreset.minute <= nowMinutes
                      ? TIME_PRESETS_WITH_NOW[0]
                      : rawPreset;
                  const timeLabel = effectiveTimePreset.label;
                  const startDateLabel = isToday
                    ? "Today"
                    : challengeStartDate.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
                  const endDateLabel = challengeEndDate
                    ? challengeEndDate.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })
                    : "—";
                  const endTimeLabel = challengeEndDate ? fmtShortTime12(challengeEndDate) : "—";
                  const iconBg = { width: rs(34), height: rs(34), borderRadius: 10, backgroundColor: accent + "20", alignItems: "center" as const, justifyContent: "center" as const };
                  const entryModeIcon = challengeEntryMode === "coins" ? "zap" : challengeEntryMode === "usd" ? "dollar-sign" : "gift";
                  const entryModeLabel = challengeEntryMode === "free" ? "Free" : challengeEntryMode === "coins" ? "Coins" : "USD Entry";
                  const goalTypeLabel = challengeGoalType === "daily" ? "1 Day" : challengeGoalType === "weekly" ? "7 Days" : "30 Days";
                  return (
                    <View style={{ borderRadius: 16, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, marginBottom: 14, overflow: "hidden" }}>
                      {/* Entry Type row */}
                      <TouchableOpacity style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 14, paddingVertical: 10, gap: 12 }} onPress={() => setActivePicker("entryFee")} activeOpacity={0.75}>
                        <View style={iconBg}><Feather name={entryModeIcon as never} size={15} color={accent} /></View>
                        <View style={{ flex: 1 }}>
                          <Text style={{ fontSize: rf(13), fontWeight: "700", color: colors.foreground }}>Entry Type</Text>
                          <Text style={{ fontSize: rf(10), color: colors.mutedForeground }}>Challenge entry</Text>
                        </View>
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: accent + "15", borderRadius: 16, paddingHorizontal: 10, paddingVertical: 5, borderWidth: 1, borderColor: accent + "40" }}>
                          <Text style={{ fontSize: rf(12), fontWeight: "700", color: accent }}>{entryModeLabel}</Text>
                          <Feather name="chevron-down" size={11} color={accent} />
                        </View>
                      </TouchableOpacity>
                      {/* Coin Amount row */}
                      {challengeEntryMode === "coins" && <>
                        <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginHorizontal: 14 }} />
                        <TouchableOpacity style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 14, paddingVertical: 10, gap: 12 }} onPress={() => setActivePicker("coinAmount")} activeOpacity={0.75}>
                          <View style={iconBg}><Feather name="zap" size={15} color={accent} /></View>
                          <View style={{ flex: 1 }}>
                            <Text style={{ fontSize: rf(13), fontWeight: "700", color: colors.foreground }}>Coin Amount</Text>
                            <Text style={{ fontSize: rf(10), color: colors.mutedForeground }}>Coins per player</Text>
                          </View>
                          <View style={{ flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: accent + "15", borderRadius: 16, paddingHorizontal: 10, paddingVertical: 5, borderWidth: 1, borderColor: accent + "40" }}>
                            <Text style={{ fontSize: rf(12), fontWeight: "700", color: accent }}>{(COINS_ENTRY_AMOUNTS[challengeEntryIdx] ?? COINS_ENTRY_AMOUNTS[0]!).toLocaleString()} coins</Text>
                            <Feather name="chevron-down" size={11} color={accent} />
                          </View>
                        </TouchableOpacity>
                      </>}
                      {/* USD Amount row */}
                      {challengeEntryMode === "usd" && <>
                        <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginHorizontal: 14 }} />
                        <TouchableOpacity style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 14, paddingVertical: 10, gap: 12 }} onPress={() => setActivePicker("usdAmount")} activeOpacity={0.75}>
                          <View style={iconBg}><Feather name="dollar-sign" size={15} color={accent} /></View>
                          <View style={{ flex: 1 }}>
                            <Text style={{ fontSize: rf(13), fontWeight: "700", color: colors.foreground }}>Entry Amount</Text>
                            <Text style={{ fontSize: rf(10), color: colors.mutedForeground }}>USD per player</Text>
                          </View>
                          <View style={{ flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: accent + "15", borderRadius: 16, paddingHorizontal: 10, paddingVertical: 5, borderWidth: 1, borderColor: accent + "40" }}>
                            <Text style={{ fontSize: rf(12), fontWeight: "700", color: accent }}>${challengeUsdAmount}</Text>
                            <Feather name="chevron-down" size={11} color={accent} />
                          </View>
                        </TouchableOpacity>
                      </>}
                      {/* Target Steps row */}
                      <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginHorizontal: 14 }} />
                      <TouchableOpacity style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 14, paddingVertical: 10, gap: 12 }} onPress={() => setActivePicker("steps")} activeOpacity={0.75}>
                        <View style={iconBg}><Feather name="activity" size={15} color={accent} /></View>
                        <View style={{ flex: 1 }}>
                          <Text style={{ fontSize: rf(13), fontWeight: "700", color: colors.foreground }}>Target Steps</Text>
                          <Text style={{ fontSize: rf(10), color: colors.mutedForeground }}>Steps to complete in {durationDaysLabel}</Text>
                        </View>
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: accent + "15", borderRadius: 16, paddingHorizontal: 10, paddingVertical: 5, borderWidth: 1, borderColor: accent + "40" }}>
                          <Text style={{ fontSize: rf(12), fontWeight: "700", color: accent }}>{fmtStepLabel(targetStepsForCreate)} steps</Text>
                          <Feather name="chevron-down" size={11} color={accent} />
                        </View>
                      </TouchableOpacity>
                      {/* Players row */}
                      <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginHorizontal: 14 }} />
                      <TouchableOpacity style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 14, paddingVertical: 10, gap: 12 }} onPress={() => setActivePicker("players")} activeOpacity={0.75}>
                        <View style={iconBg}><Feather name="users" size={15} color={accent} /></View>
                        <View style={{ flex: 1 }}>
                          <Text style={{ fontSize: rf(13), fontWeight: "700", color: colors.foreground }}>Players</Text>
                          <Text style={{ fontSize: rf(10), color: colors.mutedForeground }}>Max participants</Text>
                        </View>
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: accent + "15", borderRadius: 16, paddingHorizontal: 10, paddingVertical: 5, borderWidth: 1, borderColor: accent + "40" }}>
                          <Text style={{ fontSize: rf(12), fontWeight: "700", color: accent }}>{challengeMaxPlayers} players</Text>
                          <Feather name="chevron-down" size={11} color={accent} />
                        </View>
                      </TouchableOpacity>
                      {/* Challenge Duration row */}
                      <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginHorizontal: 14 }} />
                      <TouchableOpacity style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 14, paddingVertical: 10, gap: 12 }} onPress={() => setActivePicker("goalType")} activeOpacity={0.75}>
                        <View style={iconBg}><Feather name="clock" size={15} color={accent} /></View>
                        <View style={{ flex: 1 }}>
                          <Text style={{ fontSize: rf(13), fontWeight: "700", color: colors.foreground }}>Challenge Duration</Text>
                          <Text style={{ fontSize: rf(10), color: colors.mutedForeground }}>Challenge length</Text>
                        </View>
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: accent + "15", borderRadius: 16, paddingHorizontal: 10, paddingVertical: 5, borderWidth: 1, borderColor: accent + "40" }}>
                          <Text style={{ fontSize: rf(12), fontWeight: "700", color: accent }}>{goalTypeLabel}</Text>
                          <Feather name="chevron-down" size={11} color={accent} />
                        </View>
                      </TouchableOpacity>

                      {/* Start row — date + time inline */}
                      <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginHorizontal: 14 }} />
                      <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 14, paddingVertical: 10, gap: 10 }}>
                        <View style={iconBg}><Feather name="calendar" size={15} color={accent} /></View>
                        <Text style={{ fontSize: rf(13), fontWeight: "700", color: colors.foreground, width: 42 }}>Start</Text>
                        <View style={{ flex: 1, flexDirection: "row", gap: 6, justifyContent: "flex-end" }}>
                          <TouchableOpacity
                            style={{ alignItems: "center", backgroundColor: accent + "12", borderRadius: 10, borderWidth: 1, borderColor: accent + "40", paddingHorizontal: 10, paddingVertical: 6 }}
                            onPress={() => setShowStartDatePicker(true)}
                            activeOpacity={0.78}
                          >
                            <Text style={{ fontSize: rf(9), color: colors.mutedForeground }}>Date</Text>
                            <Text style={{ fontSize: rf(12), fontWeight: "700", color: accent, marginTop: 1 }}>{startDateLabel}</Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={{ alignItems: "center", backgroundColor: accent + "12", borderRadius: 10, borderWidth: 1, borderColor: accent + "40", paddingHorizontal: 10, paddingVertical: 6 }}
                            onPress={() => {
                              if (isToday) {
                                const _now = new Date();
                                const _nowMin = _now.getHours() * 60 + _now.getMinutes();
                                const _sel = TIME_PRESETS_WITH_NOW[challengeStartTimeIdx];
                                if (!_sel || _sel.isNow || _sel.hour * 60 + _sel.minute <= _nowMin) {
                                  const nextIdx = TIME_PRESETS_WITH_NOW.findIndex(
                                    (p) => !p.isNow && p.hour * 60 + p.minute > _nowMin + 29
                                  );
                                  if (nextIdx >= 0) setChallengeStartTimeIdx(nextIdx);
                                }
                              }
                              setActivePicker("startTime");
                            }}
                            activeOpacity={0.78}
                          >
                            <Text style={{ fontSize: rf(9), color: colors.mutedForeground }}>Time</Text>
                            <Text style={{ fontSize: rf(12), fontWeight: "700", color: accent, marginTop: 1 }}>{timeLabel}</Text>
                          </TouchableOpacity>
                        </View>
                      </View>

                      {/* End Date/Time row — locked, auto-calculated from start + duration */}
                      <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginHorizontal: 14 }} />
                      <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 14, paddingVertical: 10, gap: 10 }}>
                        <View style={{ width: rs(34), height: rs(34), borderRadius: 10, backgroundColor: colors.border + "60", alignItems: "center", justifyContent: "center" }}>
                          <Feather name="lock" size={15} color={colors.mutedForeground} />
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={{ fontSize: rf(13), fontWeight: "700", color: colors.foreground }}>End Date</Text>
                          <Text style={{ fontSize: rf(10), color: colors.mutedForeground }}>Locked · based on start + duration</Text>
                        </View>
                        <View style={{ flexDirection: "row", gap: 6, opacity: 0.6 }}>
                          <View style={{ alignItems: "center", backgroundColor: colors.border + "40", borderRadius: 10, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 10, paddingVertical: 6 }}>
                            <Text style={{ fontSize: rf(9), color: colors.mutedForeground }}>End Date</Text>
                            <Text style={{ fontSize: rf(12), fontWeight: "700", color: colors.foreground, marginTop: 1 }}>{endDateLabel}</Text>
                          </View>
                          <View style={{ alignItems: "center", backgroundColor: colors.border + "40", borderRadius: 10, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 10, paddingVertical: 6 }}>
                            <Text style={{ fontSize: rf(9), color: colors.mutedForeground }}>End Time</Text>
                            <Text style={{ fontSize: rf(12), fontWeight: "700", color: colors.foreground, marginTop: 1 }}>{endTimeLabel}</Text>
                          </View>
                        </View>
                      </View>
                    </View>
                  );
                })()}

                {/* Info chip */}
                <View style={{ flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: colors.card, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, marginBottom: 16, borderWidth: 1, borderColor: colors.border }}>
                  <Feather name="info" size={14} color="#00B4FF" />
                  <Text style={{ fontSize: rf(12), color: colors.mutedForeground, flex: 1 }}>
                    Minimum <Text style={{ color: "#00B4FF", fontWeight: "700" }}>2 players</Text> required to start a challenge.
                  </Text>
                </View>

                {/* Prize preview — Coins */}
                {challengeEntryMode === "coins" && (() => {
                  const totalCoins = coinEntryAmount * challengeMaxPlayers;
                  const winnerCount = challengeMaxPlayers <= 2 ? 1 : challengeMaxPlayers === 3 ? 2 : 3;
                  const splits = winnerCount === 1 ? [1.0] : winnerCount === 2 ? [0.6, 0.4] : [0.5, 0.3, 0.2];
                  const prizes = splits.map((s) => Math.floor(totalCoins * s));
                  const accentCol = roomType === "public" ? colors.accent : "#A855F7";
                  const rankEmojis = ["🥇", "🥈", "🥉"];
                  const rankLabels = ["1st Place", "2nd Place", "3rd Place"];
                  return (
                    <>
                      <View style={[styles.detailCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                        {[
                          { label: "Entry", value: `${coinEntryAmount.toLocaleString()} coins / player`, color: accentCol },
                          { label: "Max Prize Pool", value: `${totalCoins.toLocaleString()} coins`, color: "#FFD700" },
                          { label: "Winners", value: winnerCount === 1 ? "Top 1 player" : `Top ${winnerCount} players`, color: colors.mutedForeground },
                        ].map((row, i) => (
                          <View key={i}>
                            {i > 0 && <View style={[styles.detailDivider, { backgroundColor: colors.border }]} />}
                            <View style={styles.detailRow}>
                              <Text style={[styles.detailLabel, { color: colors.mutedForeground }]}>{row.label}</Text>
                              <Text style={[styles.detailValue, { color: row.color }]}>{row.value}</Text>
                            </View>
                          </View>
                        ))}
                      </View>
                      <Text style={[styles.modalSectionLabel, { color: colors.mutedForeground }]}>Reward Split</Text>
                      {prizes.map((amt, i) => {
                        const splitPct = winnerCount === 1 ? "100%" : winnerCount === 2 ? (i === 0 ? "60%" : "40%") : (["50%", "30%", "20%"][i]);
                        return (
                          <View key={i} style={[styles.detailCard, { backgroundColor: colors.card, borderColor: colors.border, marginBottom: 8, flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12 }]}>
                            <Text style={{ fontSize: rf(22) }}>{rankEmojis[i]}</Text>
                            <View style={{ flex: 1 }}>
                              <Text style={{ fontSize: rf(13), fontWeight: "700", color: colors.foreground }}>{rankLabels[i]}</Text>
                              <Text style={{ fontSize: rf(11), color: colors.mutedForeground }}>{splitPct} of pool</Text>
                            </View>
                            <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
                              <CoinIcon size="small" />
                              <Text style={{ fontSize: rf(15), fontWeight: "900", color: "#FFD700" }}>{amt.toLocaleString()}</Text>
                            </View>
                          </View>
                        );
                      })}
                    </>
                  );
                })()}

                {/* Prize preview — USD */}
                {challengeEntryMode === "usd" && createPaymentQuote && (() => {
                  const accentCol = roomType === "public" ? colors.accent : "#A855F7";
                  return (
                  <>
                    <View style={[styles.detailCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                      {[
                        { label: "Entry Fee", value: `$${challengeUsdAmount} / player`, color: accentCol },
                        { label: "Players", value: String(challengeMaxPlayers), color: colors.foreground },
                        { label: "Entry Pool / Prize Pool", value: `$${createPaymentQuote.prizePool.toFixed(2)}`, color: "#22C55E" },
                      ].map((row, i) => (
                        <View key={i}>
                          {i > 0 && <View style={[styles.detailDivider, { backgroundColor: colors.border }]} />}
                          <View style={styles.detailRow}>
                            <Text style={[styles.detailLabel, { color: colors.mutedForeground }]}>{row.label}</Text>
                            <Text style={[styles.detailValue, { color: row.color }]}>{row.value}</Text>
                          </View>
                        </View>
                      ))}
                    </View>
                    <CashChallengeRewardSplit quote={createPaymentQuote} colors={colors} />
                    <CashChallengePaymentBreakdown quote={createPaymentQuote} colors={colors} />
                  </>
                  );
                })()}
                {challengeEntryMode === "usd" && !createPaymentQuote && (
                  <ActivityIndicator color={colors.primary} style={{ marginVertical: 12 }} />
                )}

                {/* Track Background */}
                <View style={styles.trackBgHeader}>
                  <Text style={[styles.modalSectionLabel, { color: colors.mutedForeground }]}>Track Background</Text>
                  <Text style={[styles.trackBgHint, { color: colors.mutedForeground }]}>Swipe to choose theme</Text>
                </View>
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.trackLayoutRow}
                  style={styles.trackLayoutScroll}
                >
                  {(() => {
                    const ownedLayouts = TRACK_LAYOUT_OPTIONS.filter((layout) => {
                      const themeData = themes.find((t) => t.code === layout.id);
                      return themeData?.owned ?? FREE_TRACK_CODES.has(layout.id);
                    });
                    const activeColor = roomType === "public" ? colors.accent : "#A855F7";
                    return ownedLayouts.map((layout) => {
                      const active = challengeTrackLayout === layout.id;
                      return (
                        <TouchableOpacity
                          key={layout.id}
                          activeOpacity={0.86}
                          onPress={() => setChallengeTrackLayout(layout.id)}
                          style={[styles.trackLayoutCard, {
                            backgroundColor: colors.card,
                            borderColor: active ? activeColor : colors.border,
                          }]}
                        >
                          <Image source={layout.source} resizeMode="cover" style={styles.trackLayoutImage} />
                          <LinearGradient colors={["transparent", "rgba(0,0,0,0.78)"]} style={styles.trackLayoutOverlay} />
                          <View style={styles.trackLayoutFooter}>
                            <Text style={styles.trackLayoutTitle} numberOfLines={1}>{layout.label}</Text>
                            <View style={[styles.trackLayoutCheck, {
                              backgroundColor: active ? activeColor : "rgba(255,255,255,0.12)",
                              borderColor: active ? activeColor : "rgba(255,255,255,0.32)",
                            }]}>
                              {active && <Feather name="check" size={12} color="#000" />}
                            </View>
                          </View>
                        </TouchableOpacity>
                      );
                    });
                  })()}
                </ScrollView>

                {challengeEntryMode === "usd" && (
                  <Text style={[styles.paidAckText, { color: colors.mutedForeground }]}>
                    ⓘ Total payable (entry + tax/processing + platform service fee) is charged when you confirm. Entry fee is refunded to your wallet if you leave before the race starts.
                  </Text>
                )}

                {/* Create button */}
                <TouchableOpacity
                  style={[styles.joinBtn, { opacity: challengeCreating ? 0.7 : 1 }]}
                  onPress={() => {
                    if (isUsdEntry) {
                      setCreateConfirmChecks([false, false, false]);
                      setShowCreateConfirm(true);
                    } else {
                      handleCreateChallenge();
                    }
                  }}
                  activeOpacity={0.85}
                  disabled={challengeCreating}
                >
                  <LinearGradient
                    colors={roomType === "public" ? [colors.accent, colors.primary] : ["#A855F7", "#7C3AED"]}
                    style={styles.joinGradient}
                    start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
                  >
                    {(challengeCreating || !challengeModalAnimated) ? (
                      <ActivityIndicator size="small" color="#FFF" />
                    ) : (
                      <Feather name={roomType === "public" ? "globe" : "lock"} size={20} color="#FFF" />
                    )}
                    <View style={{ alignItems: "center" }}>
                      <Text style={styles.joinBtnText}>
                        {(challengeCreating || !challengeModalAnimated)
                          ? "Creating room…"
                          : `Create ${roomType === "public" ? "Public" : "Private"} Room`}
                      </Text>
                      {!(challengeCreating || !challengeModalAnimated) && (
                        <Text style={{ color: "rgba(255,255,255,0.65)", fontSize: rf(11), marginTop: 2 }}>
                          {roomType === "public" ? "Open to all eligible players" : "Invite only room"}
                        </Text>
                      )}
                    </View>
                  </LinearGradient>
                </TouchableOpacity>

                <TouchableOpacity style={[styles.cancelBtn, { borderColor: colors.border }]} onPress={() => setChallengeModal(false)}>
                  <Text style={[styles.cancelBtnText, { color: colors.mutedForeground }]}>Cancel</Text>
                </TouchableOpacity>
            </>
            )}
          </ScrollView>

          {/* ── Picker overlay — lives INSIDE the pageSheet so iOS can render it ── */}
          {activePicker !== null && (
            <Pressable
              style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.52)", justifyContent: "flex-end" }}
              onPress={() => setActivePicker(null)}
            >
              <Animated.View
                style={{ backgroundColor: colors.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingBottom: 40, maxHeight: "80%", transform: [{ translateY: pickerSlideY }] }}
              >
                <Pressable onPress={() => {}}>
                  <View style={{ width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border, alignSelf: "center", marginTop: 12, marginBottom: 2 }} />
                  <Text style={{ fontSize: rf(16), fontWeight: "700", color: colors.foreground, textAlign: "center", paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.border }}>
                    {activePicker === "entryFee" ? "Entry Type"
                      : activePicker === "coinAmount" ? "Coin Amount"
                      : activePicker === "usdAmount" ? "Entry Amount ($)"
                      : activePicker === "goalType" ? "Goal Type"
                      : activePicker === "steps" ? "Target Steps"
                      : activePicker === "players" ? "Players"
                      : "Start Time"}
                  </Text>
                  <ScrollView showsVerticalScrollIndicator={activePicker === "startTime"} indicatorStyle="white" keyboardShouldPersistTaps="handled">
                    {activePicker === "entryFee" && (() => {
                      const acc = roomType === "public" ? colors.accent : "#A855F7";
                      const modeOptions = [
                        { mode: "free" as const, icon: "gift" as const, label: "Free", desc: "No entry fee · Walk & compete for fun" },
                        { mode: "coins" as const, icon: "zap" as const, label: "Coins", desc: "Enter with coins · Winner takes the coin pool" },
                        { mode: "usd" as const, icon: "dollar-sign" as const, label: "USD Entry", desc: "Skill-based challenge · Entry fee · Prize rewards" },
                      ];
                      return (
                        <View style={{ padding: rs(12), gap: rs(10) }}>
                          {modeOptions.map((opt) => {
                            const sel = challengeEntryMode === opt.mode;
                            return (
                              <TouchableOpacity key={opt.mode} activeOpacity={0.72}
                                onPress={() => { setChallengeEntryMode(opt.mode); setActivePicker(null); }}
                                style={{ flexDirection: "row", alignItems: "center", gap: rs(12), padding: rs(14), borderRadius: rs(14), borderWidth: 1.5, borderColor: sel ? acc : colors.border, backgroundColor: sel ? acc + "14" : colors.background }}>
                                <View style={{ width: rs(40), height: rs(40), borderRadius: rs(12), backgroundColor: sel ? acc + "22" : colors.border + "30", alignItems: "center", justifyContent: "center" }}>
                                  <Feather name={opt.icon} size={rs(20)} color={sel ? acc : colors.mutedForeground} />
                                </View>
                                <View style={{ flex: 1 }}>
                                  <Text style={{ fontSize: rf(15), fontWeight: "700", color: sel ? acc : colors.foreground }}>{opt.label}</Text>
                                  <Text style={{ fontSize: rf(12), color: colors.mutedForeground, marginTop: 2 }}>{opt.desc}</Text>
                                </View>
                                {sel && <Feather name="check-circle" size={rs(20)} color={acc} />}
                              </TouchableOpacity>
                            );
                          })}
                        </View>
                      );
                    })()}
                    {activePicker === "coinAmount" && (() => {
                      const acc = roomType === "public" ? colors.accent : "#A855F7";
                      return (
                        <View style={{ padding: rs(12), flexDirection: "row", flexWrap: "wrap", gap: rs(8) }}>
                          {COINS_ENTRY_AMOUNTS.map((amt, idx) => {
                            const sel = challengeEntryIdx === idx;
                            const display = amt >= 1000 ? `${(amt / 1000 % 1 === 0 ? amt / 1000 : (amt / 1000).toFixed(1))}k` : String(amt);
                            return (
                              <TouchableOpacity key={amt} activeOpacity={0.72}
                                onPress={() => { setChallengeEntryIdx(idx); setActivePicker(null); }}
                                style={{ width: "48%", flexDirection: "row", alignItems: "center", gap: rs(8), padding: rs(12), borderRadius: rs(12), borderWidth: 1.5, borderColor: sel ? acc : colors.border, backgroundColor: sel ? acc + "14" : colors.background }}>
                                <CoinIcon size="small" />
                                <Text style={{ flex: 1, fontSize: rf(14), fontWeight: sel ? "800" : "500", color: sel ? acc : colors.foreground }}>{display}</Text>
                                {sel && <Feather name="check" size={rs(14)} color={acc} />}
                              </TouchableOpacity>
                            );
                          })}
                        </View>
                      );
                    })()}
                    {activePicker === "usdAmount" && USD_ENTRY_AMOUNTS.map((amt) => {
                      const isActive = challengeUsdAmount === amt;
                      const acc = roomType === "public" ? colors.accent : "#A855F7";
                      return (
                        <TouchableOpacity key={amt} activeOpacity={0.72}
                          onPress={() => { setChallengeUsdAmount(amt); setActivePicker(null); }}
                          style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 24, paddingVertical: 17, borderBottomWidth: 1, borderBottomColor: colors.border + "55", backgroundColor: isActive ? acc + "12" : "transparent" }}>
                          <Text style={{ fontSize: rf(15), color: isActive ? acc : colors.foreground, fontWeight: isActive ? "700" : "500" }}>${amt}</Text>
                          {isActive && <Feather name="check-circle" size={17} color={acc} />}
                        </TouchableOpacity>
                      );
                    })}
                    {activePicker === "goalType" && (() => {
                      const acc = roomType === "public" ? colors.accent : "#A855F7";
                      const goalOptions = [
                        { type: "daily" as const, label: "1 Day", desc: "Challenge runs for one day" },
                        { type: "weekly" as const, label: "7 Days", desc: "Challenge runs for one week" },
                        { type: "monthly" as const, label: "30 Days", desc: "Challenge runs for one month" },
                      ];
                      return (
                        <View style={{ padding: rs(12), gap: rs(10) }}>
                          {goalOptions.map((opt) => {
                            const sel = challengeGoalType === opt.type;
                            return (
                              <TouchableOpacity key={opt.type} activeOpacity={0.72}
                                onPress={() => {
                                  setChallengeGoalType(opt.type);
                                  setChallengeTargetIdx(0);
                                  setActivePicker(null);
                                  // End date auto-recalculated by useEffect
                                }}
                                style={{ flexDirection: "row", alignItems: "center", gap: rs(12), padding: rs(14), borderRadius: rs(14), borderWidth: 1.5, borderColor: sel ? acc : colors.border, backgroundColor: sel ? acc + "14" : colors.background }}>
                                <View style={{ flex: 1 }}>
                                  <Text style={{ fontSize: rf(15), fontWeight: "700", color: sel ? acc : colors.foreground }}>{opt.label}</Text>
                                  <Text style={{ fontSize: rf(12), color: colors.mutedForeground, marginTop: 2 }}>{opt.desc}</Text>
                                </View>
                                {sel && <Feather name="check-circle" size={rs(20)} color={acc} />}
                              </TouchableOpacity>
                            );
                          })}
                        </View>
                      );
                    })()}
                    {activePicker === "steps" && goalStepOptions.map((steps, i) => {
                      const isActive = clampedTargetIdx === i;
                      const acc = roomType === "public" ? colors.accent : "#A855F7";
                      return (
                        <TouchableOpacity key={steps} activeOpacity={0.72}
                          onPress={() => { setChallengeTargetIdx(i); setActivePicker(null); }}
                          style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 24, paddingVertical: 17, borderBottomWidth: 1, borderBottomColor: colors.border + "55", backgroundColor: isActive ? acc + "12" : "transparent" }}>
                          <Text style={{ fontSize: rf(15), color: isActive ? acc : colors.foreground, fontWeight: isActive ? "700" : "500" }}>{fmtStepLabel(steps)} steps</Text>
                          {isActive && <Feather name="check-circle" size={17} color={acc} />}
                        </TouchableOpacity>
                      );
                    })}
                    {activePicker === "players" && PLAYER_COUNTS.map((n) => {
                      const isActive = challengeMaxPlayers === n;
                      const acc = roomType === "public" ? colors.accent : "#A855F7";
                      return (
                        <TouchableOpacity key={n} activeOpacity={0.72}
                          onPress={() => { setChallengeMaxPlayers(n); setActivePicker(null); }}
                          style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 24, paddingVertical: 17, borderBottomWidth: 1, borderBottomColor: colors.border + "55", backgroundColor: isActive ? acc + "12" : "transparent" }}>
                          <Text style={{ fontSize: rf(15), color: isActive ? acc : colors.foreground, fontWeight: isActive ? "700" : "500" }}>{n} players</Text>
                          {isActive && <Feather name="check-circle" size={17} color={acc} />}
                        </TouchableOpacity>
                      );
                    })}
                    {activePicker === "startTime" && (() => {
                      const now = new Date();
                      const isToday = isSameDay(challengeStartDate, now);
                      const nowMin = now.getHours() * 60 + now.getMinutes();
                      const presets = isToday ? TIME_PRESETS_WITH_NOW : TIME_PRESETS_FUTURE;
                      return presets
                        .map((preset, i) => {
                          const globalIdx = isToday ? i : i + 1;
                          // Hide past non-Now slots when today is selected
                          if (isToday && !preset.isNow && preset.hour * 60 + preset.minute <= nowMin) {
                            return null;
                          }
                          const isActive = challengeStartTimeIdx === globalIdx;
                          const acc = roomType === "public" ? colors.accent : "#A855F7";
                          return (
                            <TouchableOpacity key={preset.label} activeOpacity={0.72}
                              onPress={() => {
                                setChallengeStartTimeIdx(globalIdx);
                                setActivePicker(null);
                                if (__DEV__) {
                                  console.log("[CreateChallengeTime] start time selected:", preset.label);
                                }
                              }}
                              style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 24, paddingVertical: 17, borderBottomWidth: 1, borderBottomColor: colors.border + "55", backgroundColor: isActive ? acc + "12" : "transparent" }}>
                              <View>
                                <Text style={{ fontSize: rf(15), color: isActive ? acc : colors.foreground, fontWeight: isActive ? "700" : "500" }}>{preset.label}</Text>
                                {preset.isNow && <Text style={{ fontSize: rf(11), color: colors.mutedForeground, marginTop: 2 }}>Starts right away · no scheduled time</Text>}
                              </View>
                              {isActive && <Feather name="check-circle" size={17} color={acc} />}
                            </TouchableOpacity>
                          );
                        })
                        .filter(Boolean);
                    })()}
                  </ScrollView>
                </Pressable>
              </Animated.View>
            </Pressable>
          )}

          {/* ── Native Start Date Picker ── */}
          {showStartDatePicker && (() => {
            const accent = roomType === "public" ? colors.accent : "#A855F7";
            const minDate = new Date();
            const maxDate = new Date(); maxDate.setDate(maxDate.getDate() + 30);
            return (
              <Pressable
                style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.65)", justifyContent: "flex-end" }}
                onPress={() => setShowStartDatePicker(false)}
              >
                <Pressable onPress={() => {}}>
                  <View style={{ backgroundColor: colors.card, borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingBottom: 36 }}>
                    <View style={{ width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border, alignSelf: "center", marginTop: 14, marginBottom: 4 }} />
                    <Text style={{ fontSize: rf(17), fontWeight: "700", color: colors.foreground, textAlign: "center", paddingVertical: 12 }}>Select Start Date</Text>
                    <DateTimePicker
                      value={challengeStartDate}
                      mode="date"
                      display={Platform.OS === "ios" ? "inline" : "default"}
                      minimumDate={minDate}
                      maximumDate={maxDate}
                      themeVariant={isDark ? "dark" : "light"}
                      accentColor={accent}
                      onChange={(_, date) => {
                        if (date) {
                          setChallengeStartDate(date);
                          // end date is fully handled by the useEffect — no manual recalc needed
                          const isNowToday = isSameDay(date, new Date());
                          if (!isNowToday && challengeStartTimeIdx === 0) {
                            setChallengeStartTimeIdx(4);
                          }
                          if (__DEV__) {
                            console.log("[CreateChallengeTime] start date selected:", date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }));
                          }
                        }
                        if (Platform.OS === "android") setShowStartDatePicker(false);
                      }}
                    />
                    {Platform.OS === "ios" && (
                      <TouchableOpacity
                        style={{ marginHorizontal: 24, paddingVertical: 15, backgroundColor: accent, borderRadius: 16, alignItems: "center" }}
                        onPress={() => setShowStartDatePicker(false)}
                      >
                        <Text style={{ color: "#FFF", fontWeight: "700", fontSize: rf(16) }}>Done</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                </Pressable>
              </Pressable>
            );
          })()}

        </SafeAreaView>
      </Modal>

      {/* Profile Modal */}
      <ProfileModal
        visible={showProfile}
        onClose={() => setShowProfile(false)}
        user={user}
        walletBalance={walletBalance}
        userRank={userRank}
        todaySteps={safeTodaySteps}
        allTimeSteps={allTimeSteps}
        currentStreak={currentStreak}
        logout={logout}
        colors={colors}
      />

      {/* Draggable floating shop icon — set SHOP_ON_WALK_TAB=true to re-enable */}
      {SHOP_ON_WALK_TAB && (
        <DraggableShopIcon
          tabBarHeight={tabBarHeight}
          onOpenStore={() => setShowCoinStore(true)}
          focused={walkFocused}
        />
      )}

      {/* Coins Info Modal */}
      <CoinsInfoModal
        visible={showCoinsInfo}
        onClose={() => setShowCoinsInfo(false)}
        onOpenStore={() => { setShowCoinsInfo(false); router.push("/(tabs)/shop"); }}
      />

      {/* Coins Store Modal */}
      <CoinsStoreModal
        visible={showCoinStore}
        onClose={handleCloseCoinStore}
        onCoinsAdded={handleCoinStorePurchase}
      />

      <WearableSetupModal
        visible={showStepSetup}
        onClose={() => setShowStepSetup(false)}
        onComplete={(_platform, permissionStatus) => {
          setShowStepSetup(false);
          if (permissionStatus === "connected") {
            void resumeStepWatching();
          }
        }}
      />

      {/* Active Race Conflict Modal */}
      <ActiveRaceModal
        visible={!!activeRaceModal}
        activeRace={activeRaceModal}
        leaving={leavingActiveRace}
        onStay={handleStayInActiveRace}
        onLeaveAndContinue={handleLeaveAndContinueActiveRace}
        onCancel={handleCancelActiveRaceModal}
      />

      <AlreadyHostingModal
        visible={!!alreadyHostingModal}
        onDismiss={() => setAlreadyHostingModal(null)}
        onGoToRoom={() => {
          const info = alreadyHostingModal;
          setAlreadyHostingModal(null);
          if (!info?.raceId) return;
          if (info.isActiveRace) {
            router.push({ pathname: "/race/live-detail", params: { id: info.raceId } });
          } else {
            setActiveRace(info.raceId, true);
            joinRace(entryKeyToFee(info.entryKey), 10, true);
            router.push({ pathname: "/race/matchmaking", params: { raceId: info.raceId, isHost: "true" } });
          }
        }}
      />

      <JoinWithCodeModal
        visible={joinWithCodeVisible}
        onClose={() => setJoinWithCodeVisible(false)}
        onJoined={(result: JoinWithCodeResult) => {
          setJoinWithCodeVisible(false);
          setChallengeModal(false);
          setActiveRace(result.room_id, false);
          joinRace(result.entry_fee, result.max_players, false);
          router.push({ pathname: "/race/matchmaking", params: { raceId: result.room_id, isHost: "false" } });
        }}
      />

      <CoinsBattleModal
        visible={coinsBattleVisible}
        onClose={() => setCoinsBattleVisible(false)}
        onCreated={(raceId, isHost) => {
          setCoinsBattleVisible(false);
          dispatch(fetchCoinBalance());
          router.push({ pathname: "/race/matchmaking", params: { raceId, isHost: isHost ? "true" : "false" } });
        }}
      />

      {/* ── Scheduled Room Success Modal ── */}
      {scheduledRoomResult && (() => {
        const srr = scheduledRoomResult;
        const startLabel = new Date(srr.scheduledStartAt).toLocaleString("en-US", {
          month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
        });
        const entryLabel =
          srr.entryType === "free" ? "Free"
          : srr.entryType === "coins_battle" ? `${srr.coinEntryAmount.toLocaleString()} coins`
          : `$${(srr.entryAmountCents / 100).toFixed(0)}`;
        const shareMsg = srr.isPrivate
          ? `Join my Walk Champ private challenge!\n\nRoom Code: ${srr.inviteCode}\nStarts: ${startLabel}\nTarget: ${srr.targetSteps.toLocaleString()} steps\nEntry: ${entryLabel}\n\nOpen Walk Champ and use Join with Code.`
          : `Join my Walk Champ challenge!\n\nStarts: ${startLabel}\nTarget: ${srr.targetSteps.toLocaleString()} steps\nEntry: ${entryLabel}\n\nOpen Walk Champ and find it in Upcoming Rooms.`;

        return (
          <Modal
            visible={true}
            animationType="fade"
            transparent={true}
            onRequestClose={() => setScheduledRoomResult(null)}
          >
            <View style={srStyles.overlay}>
              <View style={[srStyles.sheet, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Text style={srStyles.emoji}>🗓️</Text>
                <Text style={[srStyles.title, { color: colors.foreground }]}>Room Scheduled!</Text>
                <Text style={[srStyles.sub, { color: colors.mutedForeground }]}>
                  {srr.isPrivate ? "Your private" : "Your public"} challenge has been scheduled for{" "}
                  <Text style={{ color: colors.foreground, fontWeight: "700" }}>{startLabel}</Text>.{"\n"}
                  It will appear in Upcoming Rooms.
                </Text>

                {srr.isPrivate && srr.inviteCode ? (
                  <>
                    <View style={[srStyles.codeBox, { backgroundColor: colors.background, borderColor: "#00E67640" }]}>
                      <Text style={[srStyles.codeLabel, { color: colors.mutedForeground }]}>Room Code</Text>
                      <Text style={[srStyles.codeValue, { color: "#00E676" }]}>{srr.inviteCode}</Text>
                    </View>
                    <TouchableOpacity
                      style={[srStyles.actionBtn, { backgroundColor: "#00E67618", borderColor: "#00E676" }]}
                      onPress={async () => {
                        await Clipboard.setStringAsync(srr.inviteCode!);
                        AppAlert.alert("Copied", "Room code copied to clipboard.");
                      }}
                      activeOpacity={0.75}
                    >
                      <Feather name="copy" size={16} color="#00E676" />
                      <Text style={[srStyles.actionBtnText, { color: "#00E676" }]}>Copy Code</Text>
                    </TouchableOpacity>
                  </>
                ) : null}

                <TouchableOpacity
                  style={[srStyles.actionBtn, { backgroundColor: colors.background, borderColor: colors.border }]}
                  onPress={async () => { try { await Share.share({ message: shareMsg }); } catch {} }}
                  activeOpacity={0.75}
                >
                  <Feather name="share-2" size={16} color={colors.foreground} />
                  <Text style={[srStyles.actionBtnText, { color: colors.foreground }]}>
                    {srr.isPrivate ? "Share Invite" : "Share Challenge"}
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={srStyles.doneBtn}
                  onPress={() => setScheduledRoomResult(null)}
                  activeOpacity={0.8}
                >
                  <Text style={srStyles.doneBtnText}>Done</Text>
                </TouchableOpacity>
              </View>
            </View>
          </Modal>
        );
      })()}
    </View>
  ); }

const styles = StyleSheet.create({
  container: { flex: 1 },
  banner: {
    position: "absolute", top: 0, left: 0, right: 0, zIndex: 100,
    flexDirection: "row", alignItems: "center", gap: 8,
    paddingHorizontal: rs(16), paddingVertical: rs(10), },
  bannerText: { fontSize: rf(13), fontWeight: "500", flex: 1 },
  milestoneBanner: {
    position: "absolute", top: 50, left: 20, right: 20, zIndex: 99,
    flexDirection: "row", alignItems: "center", gap: 8,
    borderRadius: 12, borderWidth: 1, paddingHorizontal: rs(16), paddingVertical: rs(12), },
  milestoneEmoji: { fontSize: rf(18) },
  milestoneText: { fontSize: rf(15), fontWeight: "700" },
  scroll: { paddingHorizontal: rs(20) },
  pageHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 16 },
  pageTitleRow: { flexDirection: "row", alignItems: "center" },
  pageTitle: { fontSize: rf(26), fontWeight: "800", letterSpacing: -0.5 },
  headerRight: { flexDirection: "row", alignItems: "center", gap: 10 },
  coinPill: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: rs(10), paddingVertical: rs(5), borderRadius: 20, borderWidth: 1 },
  coinPillText: { fontSize: rf(13), fontWeight: "800" },
  profileAvatar:    { width: rs(42), height: rs(42), borderRadius: rs(21), borderWidth: 2, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  profileAvatarImg:  { width: rs(42), height: rs(42), borderRadius: rs(21) },
  profileAvatarText: { fontSize: rf(17), fontWeight: "800" },
  trackingCardWrap: { marginBottom: 8 },
  trackingCard: { borderRadius: 20, borderWidth: 1, padding: rs(14), marginBottom: 8, gap: 8 },
  trackingHeader: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between" },
  trackingLeft: { gap: 4, flex: 1 },
  trackingBadge: { flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start", paddingHorizontal: rs(10), paddingVertical: rs(5), borderRadius: 20, borderWidth: 1 },
  statusDot: { width: 7, height: 7, borderRadius: 4 },
  statusLabel: { fontSize: rf(12), fontWeight: "700", letterSpacing: 0.5 },
  autoTrackingLabel: { fontSize: rf(14), fontWeight: "700", marginTop: 2 },
  trackingSub: { fontSize: rf(11) },
  pauseBtn: { width: rs(36), height: rs(36), borderRadius: 10, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  stepsHero: { flexDirection: "row", alignItems: "center", gap: 14 },
  stepsHeroIcon: { flexShrink: 0 },
  stepsHeroText: { flex: 1, alignItems: "flex-start" },
  stepsHeroValue: { fontSize: rf(44), fontWeight: "800", letterSpacing: -2, fontVariant: ["tabular-nums"] },
  stepsHeroLabel: { fontSize: rf(13), marginTop: -2 },
  raceStepsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingTop: 8,
    marginTop: 4,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  raceStepsLabel: { fontSize: rf(12), flex: 1 },
  raceStepsValue: { fontSize: rf(16), fontWeight: "800", fontVariant: ["tabular-nums"] },
  goalRow: { flexDirection: "row", justifyContent: "space-between" },
  goalText: { fontSize: rf(11) },
  goalPercent: { fontSize: rf(11), fontWeight: "700" },
  goalBar: { height: 4, borderRadius: 2, overflow: "hidden" },
  goalFill: { height: 4, borderRadius: 2 },
  sectionLabel: { fontSize: rf(10), fontWeight: "600", letterSpacing: 0.6, textTransform: "uppercase", marginBottom: 6, marginTop: 2 },
  statsGrid: { flexDirection: "row", flexWrap: "nowrap", gap: 7, marginBottom: 16 },
  statCard: { flex: 1, borderRadius: 12, borderWidth: 1, padding: rs(10), gap: 5, alignItems: "center" },
  statIconBox: { width: rs(28), height: rs(28), borderRadius: 9, alignItems: "center", justifyContent: "center" },
  statValue: { fontSize: rf(15), fontWeight: "700", letterSpacing: -0.3 },
  statLabel: { fontSize: rf(10), textAlign: "center" },
  sectionTitle: { fontSize: rf(18), fontWeight: "700", marginBottom: 12 },
  sectionRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 },
  roomsBtn: { flexDirection: "row", alignItems: "center", gap: 4, paddingVertical: rs(5), paddingHorizontal: rs(10), borderRadius: 10 },
  roomsBtnText: { fontSize: rf(13), fontWeight: "700" },
  roomsBadge: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: rs(7), paddingVertical: rs(2), borderRadius: 8, borderWidth: 1 },
  roomsBadgeDot: { width: 5, height: 5, borderRadius: 3 },
  roomsBadgeText: { fontSize: rf(11), fontWeight: "800" },
  raceCardWrap: { borderRadius: 18, overflow: "hidden", marginBottom: 10 },
  raceCardGradient: { flexDirection: "row", alignItems: "center", gap: 14, paddingHorizontal: rs(18), paddingVertical: rs(18) },
  raceCardIcon: { width: rs(46), height: rs(46), borderRadius: 13, alignItems: "center", justifyContent: "center" },
  raceCardText: { flex: 1 },
  raceCardLabel: { fontSize: rf(17), fontWeight: "800", color: "#FFF" },
  raceCardSub: { fontSize: rf(12), color: "rgba(255,255,255,0.78)", marginTop: 2 },
  raceCardRight: { alignItems: "flex-end", gap: 6 },
  raceCardPool: { fontSize: rf(11), fontWeight: "700", color: "rgba(255,255,255,0.85)" },
  statusBadgePill: { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: "rgba(255,255,255,0.22)", borderRadius: 8, paddingHorizontal: rs(8), paddingVertical: 4, borderWidth: 1, borderColor: "rgba(255,255,255,0.35)" },
  statusBadgePillText: { fontSize: rf(10), fontWeight: "800", color: "#FFF" },
  activeDot: { width: 6, height: 6, borderRadius: 3 },
  friendsCard: { flexDirection: "row", alignItems: "center", gap: 14, borderRadius: 18, borderWidth: 1, padding: rs(18), marginBottom: 10 },
  friendsIcon: { width: rs(46), height: rs(46), borderRadius: 13, alignItems: "center", justifyContent: "center" },
  friendsText: { flex: 1 },
  friendsLabel: { fontSize: rf(17), fontWeight: "700" },
  friendsSub: { fontSize: rf(12), marginTop: 2 },
  modalWrap: { flex: 1 },
  modalHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: rs(20), paddingTop: rs(20), paddingBottom: rs(16), borderBottomWidth: 1 },
  modalTitle: { fontSize: rf(20), fontWeight: "700" },
  modalBody: { paddingHorizontal: rs(20), paddingTop: 10, paddingBottom: rs(24), gap: 6 },
  modalSectionLabel: { fontSize: rf(13), fontWeight: "600", marginBottom: 2, marginTop: 2 },
  playerRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  playerBtn: { width: "18%", borderRadius: 10, borderWidth: 1, paddingVertical: rs(8), alignItems: "center", gap: 1 },
  playerBtnText: { fontSize: rf(15), fontWeight: "800" },
  playerBtnSub: { fontSize: rf(9), fontWeight: "500" },
  playerBtnPool: { fontSize: rf(9) },
  detailCard: { borderRadius: 14, borderWidth: 1, padding: rs(10) },
  detailRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: rs(6) },
  detailLabel: { fontSize: rf(12) },
  detailValue: { fontSize: rf(12), fontWeight: "600" },
  detailDivider: { height: 1 },
  prizeRow: { flexDirection: "row", alignItems: "center", gap: 8, borderRadius: 10, borderWidth: 1, paddingHorizontal: rs(10), paddingVertical: rs(7) },
  prizeIcon: { fontSize: rf(16) },
  prizePlace: { fontSize: rf(13), fontWeight: "700", width: 36 },
  prizeSplit: { flex: 1, fontSize: rf(12) },
  prizeAmt: { fontSize: rf(14), fontWeight: "800" },
  balanceRow: { flexDirection: "row", alignItems: "center", gap: 8, borderRadius: 12, borderWidth: 1, paddingHorizontal: rs(12), paddingVertical: rs(8) },
  balanceLabel: { flex: 1, fontSize: rf(13) },
  balanceValue: { fontSize: rf(14), fontWeight: "700" },
  insufficientText: { fontSize: rf(12), fontWeight: "600" },
  joinBtn: { borderRadius: 16, overflow: "hidden", marginTop: 4 },
  joinGradient: { paddingVertical: rs(14), flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10 },
  joinBtnText: { fontSize: rf(15), fontWeight: "700", color: "#FFF" },
  cancelBtn: { borderRadius: 14, borderWidth: 1, paddingVertical: rs(10), alignItems: "center" },
  cancelBtnText: { fontSize: rf(14), fontWeight: "600" },
  finePrint: { fontSize: rf(10), textAlign: "center", lineHeight: 14 },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { paddingHorizontal: rs(14), paddingVertical: rs(9), borderRadius: 12, borderWidth: 1 },
  chipText: { fontSize: rf(14), fontWeight: "600" },
  privatePool: { borderRadius: 12, borderWidth: 1, padding: rs(14), flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  privatePoolLabel: { fontSize: rf(13) },
  privatePoolValue: { fontSize: rf(16), fontWeight: "700" },
  roomCreated: { borderRadius: 16, borderWidth: 1, padding: rs(20), alignItems: "center", gap: 8 },
  roomCreatedEmoji: { fontSize: rf(32) },
  roomCreatedTitle: { fontSize: rf(20), fontWeight: "800" },
  roomCreatedSub: { fontSize: rf(14), textAlign: "center", lineHeight: 20 },
  roomCodeBox: { borderRadius: 14, borderWidth: 1, padding: rs(16), alignItems: "center", gap: 4 },
  roomCodeLabel: { fontSize: rf(13) },
  roomCodeValue: { fontSize: rf(32), fontWeight: "800", letterSpacing: 4 },
  roomInfoCard: { borderRadius: 14, borderWidth: 1, padding: rs(14) },
  shareBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, borderRadius: 14, borderWidth: 1, paddingVertical: rs(14) },
  shareBtnText: { fontSize: rf(15), fontWeight: "700" },
  roomNote: { fontSize: rf(12), textAlign: "center", lineHeight: 17 },
  presenceBar: { flexDirection: "row", alignItems: "center", gap: 6, borderRadius: 12, borderWidth: 1, paddingHorizontal: rs(14), paddingVertical: rs(10), marginBottom: 10 },
  presenceLiveDot: { width: 7, height: 7, borderRadius: 4, flexShrink: 0 },
  presenceText: { flex: 1, fontSize: rf(12) },
  presenceWatchLabel: { fontSize: rf(12), fontWeight: "700", flexShrink: 0 },
  roomTypeToggle: { flexDirection: "row", gap: 10 },
  roomTypeBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: 14, borderWidth: 1, paddingVertical: rs(14) },
  roomTypeBtnText: { fontSize: rf(14), fontWeight: "700" },
  roomTypeHint: { fontSize: rf(12), lineHeight: 17 },
  helperCard: { flexDirection: "row", gap: 8, alignItems: "flex-start", borderRadius: 12, borderWidth: 1, padding: rs(12) },
  helperText: { flex: 1, fontSize: rf(12), lineHeight: 17 },
  shareRow: { flexDirection: "row", gap: 10 },
  lobbyPlayersCard: { borderRadius: 14, borderWidth: 1, padding: rs(14), gap: 8 },
  lobbyHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 2 },
  lobbyTitle: { fontSize: rf(15), fontWeight: "700" },
  lobbyCount: { fontSize: rf(22), fontWeight: "800" },
  lobbyPlayerRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: rs(8) },
  lobbyAvatar: { width: rs(32), height: rs(32), borderRadius: rs(16), borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
  lobbyAvatarText: { fontSize: rf(12), fontWeight: "800" },
  lobbyPlayerName: { flex: 1, fontSize: rf(14), fontWeight: "600" },
  lobbyPlayerFlag: { fontSize: rf(16) },
  hostBadge: { paddingHorizontal: rs(8), paddingVertical: 3, borderRadius: 8, borderWidth: 1 },
  hostBadgeText: { fontSize: rf(10), fontWeight: "800", letterSpacing: 0.5 },
  waitingText: { fontSize: rf(12), textAlign: "center", paddingTop: 4 },
  confirmCheckRow: {
    flexDirection: "row", alignItems: "flex-start", gap: 12,
    borderRadius: 12, borderWidth: 1, padding: rs(14), },
  confirmCheckBox: {
    width: rs(22), height: rs(22), borderRadius: 6, borderWidth: 2,
    alignItems: "center", justifyContent: "center", flexShrink: 0, marginTop: 1, },
  confirmCheckText: { flex: 1, fontSize: rf(13), lineHeight: 19 },

  trackBgHeader: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between" },
  trackBgHint: { fontSize: rf(11) },
  trackLayoutScroll: { marginHorizontal: -rs(20) },
  trackLayoutRow: { flexDirection: "row", gap: 10, paddingHorizontal: rs(20), paddingVertical: 4 },
  trackLayoutCard: { width: rs(140), height: rs(88), borderRadius: 12, borderWidth: 2, overflow: "hidden" },
  trackLayoutImage: { width: "100%", height: "100%" },
  trackLayoutOverlay: { position: "absolute", left: 0, right: 0, top: 0, bottom: 0 },
  trackLayoutFooter: { position: "absolute", left: 9, right: 9, bottom: 8, flexDirection: "row", alignItems: "center", gap: 8 },
  trackLayoutTitle: { flex: 1, color: "#FFFFFF", fontSize: rf(12), fontWeight: "800" },
  trackLayoutCheck: { width: rs(22), height: rs(22), borderRadius: rs(11), borderWidth: 1, alignItems: "center", justifyContent: "center" },
  trackLockBadge: { position: "absolute", top: 6, right: 6, backgroundColor: "rgba(0,0,0,0.82)", borderRadius: 8, paddingHorizontal: 6, paddingVertical: 3, flexDirection: "row", alignItems: "center", gap: 3, borderWidth: 1, borderColor: "#FFD70055" },
  trackLockIcon: { fontSize: rf(11) },
  trackLockPrice: { color: "#FFD700", fontSize: rf(11), fontWeight: "800" },
  trackBuyBtn: { width: rs(26), height: rs(26), borderRadius: rs(13), borderWidth: 1.5, borderColor: "#FFD700AA", backgroundColor: "#FFD70030", alignItems: "center", justifyContent: "center" },
  // Purchase modal (inline overlay inside setup modal)
  purchaseOverlayInModal: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.72)", alignItems: "center", justifyContent: "center", padding: rs(24), zIndex: 20 },
  purchaseCard: { width: "100%", borderRadius: 20, borderWidth: 1, padding: rs(24), alignItems: "center", gap: 10 },
  purchaseTitle: { fontSize: rf(18), fontWeight: "700" },
  purchaseName: { fontSize: rf(22), fontWeight: "900" },
  purchasePriceRow: { flexDirection: "row", alignItems: "center", gap: 8, marginVertical: 4 },
  purchasePrice: { fontSize: rf(36), fontWeight: "900" },
  purchaseBalanceRow: { flexDirection: "row", alignItems: "center", gap: 5, marginBottom: 4 },
  purchaseBalance: { fontSize: rf(13) },
  purchaseInsufficient: { flexDirection: "row", alignItems: "center", gap: 8, borderRadius: 10, padding: rs(10), width: "100%" },
  purchaseInsufficientText: { flex: 1, fontSize: rf(12) },
  purchaseBtns: { flexDirection: "row", gap: 10, width: "100%", marginTop: 6 },
  purchaseCancelBtn: { flex: 1, borderRadius: 12, borderWidth: 1, paddingVertical: rs(14), alignItems: "center" },
  purchaseCancelText: { fontSize: rf(15), fontWeight: "600" },
  purchaseConfirmBtn: { flex: 1.5, borderRadius: 12, paddingVertical: rs(14), alignItems: "center", justifyContent: "center" },
  purchaseConfirmText: { fontSize: rf(14), fontWeight: "800", color: "#000" },
  paidAckText: { fontSize: rf(11), textAlign: "center", lineHeight: 16 },
  joinWithCodeRow: { flexDirection: "row", alignItems: "center", gap: 8, marginVertical: 4 },
  joinWithCodeDivider: { flex: 1, height: 1 },
  joinWithCodeOr: { fontSize: rf(12), fontWeight: "500" },
  joinWithCodeBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: 12, borderWidth: 1, paddingVertical: rs(12), paddingHorizontal: rs(16) },
  joinWithCodeBtnText: { fontSize: rf(14), fontWeight: "700", color: "#A855F7" },
  historyEntry: { flexDirection: "row", alignItems: "center", borderRadius: 16, borderWidth: 1, paddingHorizontal: rs(16), paddingVertical: rs(14), marginBottom: 12 },
  historyIcon: { width: rs(38), height: rs(38), borderRadius: 11, alignItems: "center", justifyContent: "center" },
  historyTitle: { fontSize: rf(15), fontWeight: "700" },
  historySub: { fontSize: rf(12), marginTop: 1 },
  // Open Store button (inside purchase modal)
  openStoreBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, borderRadius: 12, borderWidth: 1, paddingVertical: rs(11), paddingHorizontal: rs(20), width: "100%" },
  openStoreImg: { width: rs(24), height: rs(24) },
  openStoreBtnText: { fontSize: rf(14), fontWeight: "700" },
  // Sponsored Events card
  sponsoredCardWrap: {
    marginBottom: 10,
    borderRadius: 20,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "#6C00FF50",
    shadowColor: "#6C00FF",
    shadowOpacity: 0.45,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 5 },
    elevation: 10,
  },
  sponsoredCard: {
    flexDirection: "row",
    alignItems: "center",
    padding: rs(14),
    gap: rs(10),
    overflow: "hidden",
  },
  sponsoredGlow1: {
    position: "absolute",
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: "#6C00FF",
    opacity: 0.25,
    top: -30,
    right: 60,
  },
  sponsoredGlow2: {
    position: "absolute",
    width: 70,
    height: 70,
    borderRadius: 35,
    backgroundColor: "#00B4FF",
    opacity: 0.2,
    bottom: -20,
    left: 30,
  },
  sponsoredLeft: { flex: 1, flexDirection: "row", alignItems: "flex-start", gap: rs(10) },
  sponsoredIconWrap: {
    width: rs(44),
    height: rs(44),
    borderRadius: 14,
    backgroundColor: "#FFD70020",
    borderWidth: 1,
    borderColor: "#FFD70050",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  sponsoredCoinImg: { width: rs(28), height: rs(28) },
  sponsoredTitleRow: { flexDirection: "row", alignItems: "center", gap: rs(6), marginBottom: 3 },
  sponsoredTitle: { fontSize: rf(15.5), fontWeight: "800", color: "#FFF" },
  newBadge: {
    backgroundColor: "#6C00FF",
    borderRadius: 6,
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  newBadgeText: { fontSize: rf(9), fontWeight: "800", color: "#FFF", letterSpacing: 0.5 },
  sponsoredSub: { fontSize: rf(11), color: "rgba(255,255,255,0.55)", lineHeight: 16, marginBottom: rs(8) },
  sponsoredBadgesRow: { flexDirection: "row", flexWrap: "wrap", gap: rs(5) },
  sponsoredBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "rgba(255,255,255,0.07)",
    borderRadius: 8,
    paddingHorizontal: rs(7),
    paddingVertical: 3,
  },
  sponsoredPrizeBadge: { backgroundColor: "rgba(255,215,0,0.12)" },
  sponsoredSlotBadge: { backgroundColor: "rgba(0,229,255,0.10)" },
  sponsoredBadgeText: { fontSize: rf(10), fontWeight: "700", color: "rgba(255,255,255,0.75)" },
  sponsoredRight: { alignItems: "center", gap: 2, flexShrink: 0 },
  sponsoredCta: {
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 9,
    alignItems: "center",
  },
  sponsoredCtaText: { fontSize: 12, fontWeight: "800", color: "#FFF", textAlign: "center" },
  // Groups card
  groupsCardWrap: { marginBottom: 10 },
  groupsCard: {
    borderRadius: 18,
    padding: 16,
    flexDirection: "row",
    alignItems: "center",
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "#FFFFFF10",
    shadowOpacity: 0.3,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  groupsGlowNode1: {
    position: "absolute",
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: "#A855F730",
    top: -20,
    right: 40,
  },
  groupsGlowNode2: {
    position: "absolute",
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: "#06B6D420",
    bottom: -10,
    left: 60,
  },
  groupsGlowNode3: {
    position: "absolute",
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#10B98118",
    top: 10,
    right: 10,
  },
  groupsLeft: { flex: 1, flexDirection: "row", alignItems: "center", gap: 12 },
  groupsIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  groupsTextBlock: { flex: 1 },
  groupsTitle: { color: "#FFF", fontSize: 16, fontWeight: "800", marginBottom: 2 },
  groupsSub: { color: "#FFFFFFAA", fontSize: 11, lineHeight: 15, marginBottom: 6 },
  groupsTagRow: { flexDirection: "row", gap: 5 },
  groupsTag: { backgroundColor: "#FFFFFF15", paddingHorizontal: 7, paddingVertical: 3, borderRadius: 6 },
  groupsTagText: { color: "#FFFFFFCC", fontSize: 9, fontWeight: "700" },
  groupsCta: { marginLeft: 8 },
  groupsCtaBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 10,
  },
  groupsCtaText: { color: "#FFF", fontWeight: "800", fontSize: 12 },
  groupsInviteBadge: {
    position: "absolute",
    top: -6,
    right: -6,
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: "#EF4444",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 5,
    borderWidth: 2,
    borderColor: "#000",
    zIndex: 10,
  },
  groupsInviteBadgeText: { color: "#FFF", fontSize: 11, fontWeight: "800" },
});

const srStyles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "#00000080", alignItems: "center", justifyContent: "center", paddingHorizontal: rs(24) },
  sheet: { width: "100%", borderRadius: 24, borderWidth: 1, padding: rs(24), alignItems: "center", gap: 14, maxWidth: 420 },
  emoji: { fontSize: rf(40) },
  title: { fontSize: rf(22), fontWeight: "800", letterSpacing: -0.3 },
  sub: { fontSize: rf(14), textAlign: "center", lineHeight: 21 },
  codeBox: { width: "100%", borderRadius: 14, borderWidth: 1.5, paddingVertical: rs(14), paddingHorizontal: rs(16), alignItems: "center", gap: 4 },
  codeLabel: { fontSize: rf(12), fontWeight: "600", letterSpacing: 0.5, textTransform: "uppercase" },
  codeValue: { fontSize: rf(34), fontWeight: "800", letterSpacing: 5 },
  actionBtn: { width: "100%", flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, borderRadius: 14, borderWidth: 1.5, paddingVertical: rs(14) },
  actionBtnText: { fontSize: rf(15), fontWeight: "700" },
  doneBtn: { width: "100%", borderRadius: 14, paddingVertical: rs(14), alignItems: "center", backgroundColor: "#00B4FF" },
  doneBtnText: { fontSize: rf(15), fontWeight: "800", color: "#FFF" },
});
