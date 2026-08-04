import TargetStepsSliderPicker from "@/components/TargetStepsSliderPicker";
import PlayersSliderPicker from "@/components/PlayersSliderPicker";
import StartTimePickerModal, {
  getNextPresetIndexForNow,
  resolveInitialPresetIndex,
} from "@/components/StartTimePickerModal";
import {
  formatPlayerLabel,
  getDefaultPlayerCount,
  isValidPlayerCount,
} from "@/utils/players";
import {
  getTargetStepOptions,
  getDefaultTargetSteps,
  formatStepLabel,
  isValidTargetSteps,
  type TargetStepDuration,
} from "@/utils/targetSteps";
import { LinearGradient } from "expo-linear-gradient";
import { BlueShoe } from "@/components/BlueShoe";
import { RaceJoinBadge, JoinProgressOverlay } from "@/components/RaceJoinBadge";
import {
  RaceStartingSoonCard,
  type RaceStartingSoonChallengeType,
  type RaceStartingSoonPhase,
} from "@/components/RaceStartingSoonCard";
import { LiveClockText } from "@/components/perf/LiveClockText";
import { ensureMatchStepPermissionsReady } from "@/services/permissions/matchPermissionGate";
import { requestHomeStepSetup } from "@/services/permissions/homePermissionFlow";
import { router, useFocusEffect } from "expo-router";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import DateTimePicker, { type DateTimePickerEvent } from "@react-native-community/datetimepicker";
import {
  ActivityIndicator,
  Animated,
  AppState,
  DeviceEventEmitter,
  Easing,
  FlatList,
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
import { ProfileAvatar } from "@/components/ProfileAvatar";
import { useAvatarCache } from "@/hooks/useAvatarCache";
import * as Clipboard from "expo-clipboard";
import * as ImagePicker from "expo-image-picker";
import { useSafeLayout } from "@/hooks/useSafeLayout";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "@/utils/haptics";
import { useColors } from "@/hooks/useColors";
import { useTheme } from "@/context/ThemeContext";
import { useSound } from "@/context/SoundContext";
import { useTabBarHeight } from "@/hooks/useTabBarHeight";
import { useIncrementalStepDisplay } from "@/hooks/useIncrementalStepDisplay";
import { useWalkContext, TrackingStatus } from "@/context/WalkContext";
import { useStepSourceGuard } from "@/hooks/useStepSourceGuard";
import {
  ENABLE_CASH_CHALLENGES,
  ENABLE_LEGACY_CASH_RACE_CARDS,
  isUnlimitedGoalFrontendEnabled,
  isWalkTrendingChallengesPreviewEnabled,
} from "@/config/featureFlags";
import {
  UNLIMITED_GOAL_CHALLENGE_TYPE,
  UNLIMITED_GOAL_DEFAULT_DAILY_STEPS,
  UNLIMITED_GOAL_DESCRIPTION,
  UNLIMITED_GOAL_DURATION_DAYS,
  UNLIMITED_GOAL_ENTRY_AMOUNT_DOLLARS,
  UNLIMITED_GOAL_PLATFORM_FEE_CENTS,
  formatDurationDaysLabel,
  isUnlimitedGoalChallenge,
  isValidUnlimitedDailyGoalSteps,
  isValidUnlimitedDurationDays,
  isValidUnlimitedEntryFeeCents,
  type UnlimitedGoalDurationDays,
} from "@/utils/unlimitedGoal";
import {
  previewUnlimitedGoalPaymentQuote,
  type UnlimitedGoalPaymentQuote,
} from "@/services/unlimitedGoalApi";
import { UnlimitedGoalFeeBreakdown } from "@/components/UnlimitedGoalFeeBreakdown";
import { CreateChallengeFlow } from "@/components/CreateChallengeFlow";
import { TrendingChallengesPreview } from "@/components/trending/TrendingChallengesPreview";
import { fetchAvailableChallengeCount } from "@/services/trendingChallengesApi";
import { fetchAvailableUnlimitedChallenges, fetchMyOpenUnlimitedChallenges } from "@/services/unlimitedChallengesListApi";
import { mergeUpcomingRoomsById } from "@/utils/unlimitedChallengeRooms";
import { saveHostedUnlimitedChallenge } from "@/utils/hostedUnlimitedCache";
import { CHALLENGE_LEFT_EVENT } from "@/utils/challengeLocalEvents";
import { PremiumStepSlider } from "@/components/PremiumStepSlider";
import {
  USD_FIXED_ENTRY_DOLLARS,
  clampUsdFixedEntryDollars,
  formatUsdFixedCashChallengeLabel,
  isValidUsdFixedEntryDollars,
  usdFixedEntryDollarsToCents,
  type CreateChallengeDraft,
  type HostPayloadMeta,
} from "@/utils/createChallengeFlow";
import { trackEvent } from "@/services/analytics";
import { resolveDisplayTodaySteps } from "@/utils/liveRaceDisplay";
import { useApp } from "@/context/AppContext";
import { useAuth } from "@/context/AuthContext";
import { useRace } from "@/context/RaceContext";
import { formatDistance, formatCalories, stepsToDistance, formatWalletAmount } from "@/utils/format";
import { getApiBase } from "@/utils/apiUrl";
import { STEP_SYNC_CONFIG } from "@/config/stepSyncConfig";
import MyTitlesModal, { type ActiveTitle, difficultyColor } from "@/components/MyTitlesModal";
import { TitleBadge } from "@/components/TitleBadge";
import WearableSetupModal from "@/components/WearableSetupModal";
import { usePresence } from "@/context/PresenceContext";
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
import {
  TRACK_LAYOUT_OPTIONS,
  type TrackLayoutId,
  FREE_TRACK_CODES,
  isTrackLayoutId,
} from "@/constants/trackLayouts";
import { fetchCoinBalance, selectCurrentCoinBalance } from "@/store/slices/coinsSlice";
import { raceProgressActions } from "@/store/slices/raceProgressSlice";
import { store } from "@/store";
import { activeChallengeSync } from "@/services/activeChallengeSync";
import CoinsInfoModal from "@/components/CoinsInfoModal";
import CoinsStoreModal from "@/components/CoinsStoreModal";
import ActiveRaceModal, { type ActiveRaceInfo, isSponsoredActiveRaceConflict, normalizeActiveRaceInfo } from "@/components/ActiveRaceModal";
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
import { FaqAccordionList } from "@/components/FaqAccordionList";
import { PrivacyPolicyDocument } from "@/components/PrivacyPolicyDocument";
import { TermsAndConditionsDocument } from "@/components/TermsAndConditionsDocument";
import { clampDailyProgress } from "@/utils/stepProgress";
import CoinsBattleModal from "@/components/CoinsBattleModal";
import { screenCache } from "@/utils/screenCache";
import { buildMatchmakingParams } from "@/utils/waitingRoomSeed";
import { apiFetchAllowed, markApiFetched } from "@/utils/apiRequestCoordinator";
import { useScreenMountPerf } from "@/hooks/useScreenMountPerf";
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

/** Instant track theme for live-detail re-entry (avoids default bg flash). */
function liveRaceNavParams(
  raceId: string,
  userId?: string | null,
): { id: string; trackLayout?: string } {
  const cached = screenCache.getSync<{ race?: { trackLayout?: string } }>(
    `live-race-detail:v1:${userId || "anon"}:${raceId}`,
  );
  // Legacy unscoped key (pre multi-account) — read-only fallback.
  const legacy =
    cached ??
    screenCache.getSync<{ race?: { trackLayout?: string } }>(
      `live-race-detail:v1:${raceId}`,
    );
  const layout = legacy?.race?.trackLayout;
  if (isTrackLayoutId(layout)) return { id: raceId, trackLayout: layout };
  return { id: raceId };
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
    gradientColors: ["#064E3B", "#059669", "#047857"] as [string, string, string],
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
    gradientColors: ["#4C0519", "#BE123C"] as [string, string],
    lightAccent: "#FB7185",
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

/** Host payload entry type for cash amounts — variable $3–$25 uses paid_usd. */
function cashHostEntryType(fee: number): string {
  if (fee === 0) return "free";
  if (fee === -1) return "coins_battle";
  if (fee === 1) return "paid_1";
  if (isValidUsdFixedEntryDollars(fee)) return "paid_usd";
  if (fee === 5) return "paid_5";
  return "paid_usd";
}

function cashHostBody(fee: number, maxPlayers: number, targetSteps: number, trackLayout: string) {
  const entryType = cashHostEntryType(fee);
  if (entryType === "paid_usd") {
    const dollars = clampUsdFixedEntryDollars(fee);
    const entryFeeCents = usdFixedEntryDollarsToCents(dollars);
    return {
      entryType: "paid_usd",
      challengeFormat: "fixed",
      maxPlayers,
      maxParticipants: maxPlayers,
      targetSteps,
      trackLayout,
      customEntryAmountCents: entryFeeCents,
      entryFeeCents,
    };
  }
  return { entryType, maxPlayers, targetSteps, trackLayout };
}

function cashChallengeBlockedMessage(serverError?: string): string {
  if (serverError?.includes("Coin-entry challenges are disabled")) {
    return "Coin-entry challenges are turned off on the API server. Enable FEATURE_COIN_ENTRY_CHALLENGES on the backend deployment.";
  }
  if (serverError?.includes("Cash features are disabled") || serverError?.includes("CASH_FEATURES_DISABLED")) {
    return "Cash features are disabled on the API. Set CASH_FEATURES_ENABLED=true and FEATURE_CASH_FEATURES=true (plus REAL_MONEY_* / PAYMENTS_LIVE_MODE per Coolify checklist).";
  }
  if (serverError?.includes("disabled for this build")) {
    return "Cash challenges are turned off on the API server. Enable cash challenges on the backend deployment (CASH_FEATURES_ENABLED / FEATURE_CASH_FEATURES).";
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

type GoalPeriodType = TargetStepDuration;
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

const PLAYER_COUNTS = [2, 3, 4, 5, 6, 7, 8, 9, 10]; // legacy quick-race modal

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

/** Local calendar day at noon — avoids timezone edge cases shifting the selected day. */
function toLocalCalendarDate(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12, 0, 0, 0);
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
        <Text style={{ color: colors.primary, fontWeight: "800" }}>{formatCount(counts.online)}</Text>
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
  return (
    <View style={{ flex: 1 }}>
      <View style={[spStyles.header, { borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={onBack} hitSlop={12} accessibilityRole="button" accessibilityLabel="Go back">
          <Feather name="arrow-left" size={22} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={[spStyles.headerTitle, { color: colors.foreground }]}>FAQ</Text>
        <View style={{ width: 22 }} />
      </View>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={[spStyles.body, { paddingBottom: safeBottom + 40 }]}>
        <FaqAccordionList intro="Frequently asked questions about Walk Champ." />
      </ScrollView>
    </View>
  );
}

/** Opens inside My Profile modal so the Walk tab never flashes under a dismissed RN Modal. */
function PrivacySubpage({ colors, onBack }: { colors: ReturnType<typeof useColors>; onBack: () => void }) {
  const { safeBottom } = useSafeLayout();
  return (
    <View style={{ flex: 1 }}>
      <View style={[spStyles.header, { borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={onBack} hitSlop={12} accessibilityRole="button" accessibilityLabel="Go back">
          <Feather name="arrow-left" size={22} color={colors.foreground} />
        </TouchableOpacity>
        <View style={{ flex: 1, alignItems: "center" }}>
          <Text style={[spStyles.headerTitle, { color: colors.foreground }]}>Privacy Policy</Text>
          <Text style={{ fontSize: 11, color: colors.mutedForeground, marginTop: 2, fontWeight: "600" }}>
            Last Updated: July 21, 2026
          </Text>
        </View>
        <View style={{ width: 22 }} />
      </View>
      <PrivacyPolicyDocument contentBottomPad={safeBottom + 24} />
    </View>
  );
}

/** Opens inside My Profile modal so the Walk tab never flashes under a dismissed RN Modal. */
function TermsSubpage({ colors, onBack }: { colors: ReturnType<typeof useColors>; onBack: () => void }) {
  const { safeBottom } = useSafeLayout();
  return (
    <View style={{ flex: 1 }}>
      <View style={[spStyles.header, { borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={onBack} hitSlop={12} accessibilityRole="button" accessibilityLabel="Go back">
          <Feather name="arrow-left" size={22} color={colors.foreground} />
        </TouchableOpacity>
        <View style={{ flex: 1, alignItems: "center" }}>
          <Text style={[spStyles.headerTitle, { color: colors.foreground }]}>Terms and Conditions</Text>
          <Text style={{ fontSize: 11, color: colors.mutedForeground, marginTop: 2, fontWeight: "600" }}>
            Last Updated: July 21, 2026
          </Text>
        </View>
        <View style={{ width: 22 }} />
      </View>
      <TermsAndConditionsDocument contentBottomPad={safeBottom + 24} />
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
  "#006B3F", "#00B4FF", "#FFD700",
  "#FF6B35", "#A855F7", "#F472B6",
];

// ─────────────────────────────────────────────────────────────────────────────
function ProfileModal({ visible, onClose, onNavigate, animationType = "slide", user, totalEarned, walletCurrency, userRank, todaySteps, allTimeSteps, currentStreak, logout, colors }: {
  visible: boolean; onClose: () => void;
  /** Close modal without slide-down animation, then navigate (avoids Walk tab flash). */
  onNavigate: (href: string) => void;
  animationType?: "none" | "slide" | "fade";
  user: ReturnType<typeof useAuth>["user"];
  totalEarned: number;
  walletCurrency: string;
  userRank: number;
  todaySteps: number; allTimeSteps: number; currentStreak: number;
  logout: () => Promise<void>;
  colors: ReturnType<typeof useColors>; }) {
  const { safeBottom } = useSafeLayout();
  const { refreshUserProfile, updateUser } = useAuth();
  const { beginLocalAvatarPick, applyAvatarUploadSuccess, applyAvatarRemoved } = useAvatarCache();
  const { requestStepPermission, completeStepSetup } = useWalkContext();
  const { refreshWallet } = useApp();
  const ac = user?.avatarColor ?? colors.primary;

  // Avatar + server stats
  const [profileStats,    setProfileStats]    = useState<ServerProfileStats | null>(null);
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
  const [profilePage, setProfilePage] = useState<"main" | "help" | "faq" | "privacy" | "terms">("main");
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
        const { applyOngoingNotificationPreference } = await import(
          "@/services/ongoingNotificationPreference"
        );
        await applyOngoingNotificationPreference(true);
      } else {
        await optOutNotifications();
        await setNotificationPreferences(false);
        setPushEnabled(false);
        const { applyOngoingNotificationPreference } = await import(
          "@/services/ongoingNotificationPreference"
        );
        await applyOngoingNotificationPreference(false);
      }
    } catch {
      // ignore
    }
    setPushLoading(false);
  }, [pushEnabled, pushLoading]);

  useEffect(() => {
    if (!visible) { setIsEditing(false); return; }
    void refreshWallet({ silent: true });
    if (!apiFetchAllowed("walk_profile_modal", 90_000)) return;
    markApiFetched("walk_profile_modal");
    void (async () => {
      const res = await authFetch("/api/profile/me").catch(() => null);
      if (!res?.ok) return;
      const json = await res.json().catch(() => ({}));
      const stats = json.data?.stats ?? null;
      if (stats) {
        const profileId = json.data?.profile?.id ?? null;
        const title: ActiveTitle | null = json.data?.active_title ?? null;
        setProfileStats({ ...stats, activeTitle: title });
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
  }, [visible, todaySteps, refreshWallet]);

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
        if (p.avatarColor) setAvatarColor(p.avatarColor); }
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
    beginLocalAvatarPick(uri);
    setUploadingAvatar(true);
    const result = await uploadProfileAvatar(uri, mimeType);
    if (result) {
      applyAvatarUploadSuccess(result);
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
    applyAvatarRemoved(result.avatarVersion ?? 0);
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
    <Modal visible={visible} animationType={animationType} presentationStyle="pageSheet"
      onRequestClose={() => { if (profilePage !== "main") { setProfilePage("main"); } else { onClose(); } }}>
      <SafeAreaView
        edges={["top", "left", "right", "bottom"]}
        style={[pmStyles.container, { backgroundColor: colors.background }]}
      >
        <View style={[pmStyles.handle, { backgroundColor: colors.border }]} />

        {profilePage !== "main" ? (
          profilePage === "help" ? <HelpSubpage colors={colors} onBack={() => setProfilePage("main")} /> :
          profilePage === "faq" ? <FAQSubpage colors={colors} onBack={() => setProfilePage("main")} /> :
          profilePage === "privacy" ? <PrivacySubpage colors={colors} onBack={() => setProfilePage("main")} /> :
          <TermsSubpage colors={colors} onBack={() => setProfilePage("main")} />
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
                <ProfileAvatar
                  userId={user?.id}
                  profileImageUrl={user?.profileImageUrl}
                  avatarVersion={user?.avatarVersion}
                  avatarColor={ac}
                  displayName={user?.fullName ?? "W"}
                  size={84}
                  borderWidth={3}
                />
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
              { label: "Login Streak", value: `${profileStats?.dayStreak ?? currentStreak ?? 0}d`,               color: colors.destructive },
              { label: "Global Rank",  value: `#${profileRank}`,                                                  color: colors.gold },
              { label: "Total Earnings", value: formatWalletAmount(totalEarned, walletCurrency),                  color: "#FFD700" },
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
                  ? `${Platform.OS === "ios" ? "Apple Health" : "Health Connect"} is connected`
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
              onPress={() => onNavigate("/profile/invite-friends")}
            >
              <View style={[pmStyles.toggleIcon, { backgroundColor: colors.gold + "18" }]}>
                <Feather name="gift" size={17} color={colors.gold} />
              </View>
              <Text style={[pmStyles.toggleLabel, { color: colors.foreground }]}>Invite Friends</Text>
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
              style={[pmStyles.toggleRow, { borderBottomColor: colors.border, borderBottomWidth: StyleSheet.hairlineWidth }]}
              onPress={() => setProfilePage("privacy")}
              accessibilityRole="button"
              accessibilityLabel="Privacy Policy"
            >
              <View style={[pmStyles.toggleIcon, { backgroundColor: colors.neonBlue + "18" }]}>
                <Feather name="shield" size={17} color={colors.neonBlue} />
              </View>
              <Text style={[pmStyles.toggleLabel, { color: colors.foreground }]}>Privacy Policy</Text>
              <Feather name="chevron-right" size={16} color={colors.mutedForeground} />
            </TouchableOpacity>
            <TouchableOpacity
              style={[pmStyles.toggleRow]}
              onPress={() => setProfilePage("terms")}
              accessibilityRole="button"
              accessibilityLabel="Terms and Conditions"
            >
              <View style={[pmStyles.toggleIcon, { backgroundColor: colors.mutedForeground + "18" }]}>
                <Feather name="file-text" size={17} color={colors.mutedForeground} />
              </View>
              <Text style={[pmStyles.toggleLabel, { color: colors.foreground }]}>Terms and Conditions</Text>
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
            void completeStepSetup({ allowAll: true });
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
          ...(user?.profileImageUrl ? [{ label: "Remove Photo", icon: "trash-2", destructive: true, onPress: handleRemovePhoto }] : []),
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
  // Toggles (rows sit inside settingsList — no per-row border; list owns the card border)
  toggleRow:   { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 16, paddingVertical: 12 },
  toggleIcon:  { width: 34, height: 34, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  toggleLabel: { flex: 1, fontSize: 15, fontWeight: "500" },
  // Actions — Setup Tracking reference card
  actionBtn:       { flexDirection: "row", alignItems: "center", gap: 12, borderRadius: 14, borderWidth: 1, padding: 16 },
  actionBtnText:   { flex: 1, fontSize: 15, fontWeight: "600" },
  // Grouped settings — same border/radius as Setup Tracking card
  settingsList:    { borderRadius: 14, borderWidth: 1, overflow: "hidden" },
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
  useScreenMountPerf("Walk");
  const colors = useColors();
  const { isDark } = useTheme();
  const { width: screenWidth } = useWindowDimensions();
  const [nextRaceCarouselWidth, setNextRaceCarouselWidth] = useState(0);
  const [activeNextRaceIndex, setActiveNextRaceIndex] = useState(0);
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
    completeStepSetup,
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
  const { userRank, walletBalance, totalEarned, walletCurrency, refreshWallet } = useApp();
  const { user, logout, loading: authLoading, sessionToken } = useAuth();
  /** Set before navigating to Waiting Room while a Walk pageSheet is still covering. */
  const pendingDismissRaceCoverModalsRef = useRef(false);
  const navToMatchmaking = useCallback(
    (opts: Omit<Parameters<typeof buildMatchmakingParams>[0], "user">) => {
      // Returning from Waiting Room should not flash Walk cover sheets.
      pendingDismissRaceCoverModalsRef.current = true;
      router.push({
        pathname: "/race/matchmaking",
        params: buildMatchmakingParams({ ...opts, user }),
      });
    },
    [user],
  );
  const dbWalk = useTodayWalkSteps(user?.id);
  const tabBarHeight = useTabBarHeight();
  const modalScrollPad = { paddingBottom: safeBottom + rs(40) };
  const { joinRace, setActiveRace, setRaceTargetSteps, racePhase, userRaceSteps, walkRaceStepsDisplay, raceId: activeRaceId } = useRace();
  const raceStepsOnWalk = racePhase === "in_race" ? userRaceSteps : walkRaceStepsDisplay;
  const showRaceStepsOnWalk = raceStepsOnWalk > 0;
  const { counts, formatCount } = usePresence();
  const dispatch = useDispatch<AppDispatch>();
  const themes = useSelector((s: RootState) => s.trackThemes.themes);
  const themesPurchaseLoading = useSelector((s: RootState) => s.trackThemes.purchaseLoading);
  const serverSelectedThemeCode = useSelector((s: RootState) => s.trackThemes.selectedThemeCode);
  const themesLoading = useSelector((s: RootState) => s.trackThemes.loading);
  const coinBalance = useSelector(selectCurrentCoinBalance);
  const canonicalTodaySteps = useSelector((s: RootState) =>
    s.raceProgress.userId === user?.id
      ? Math.max(0, Math.floor(s.raceProgress.todaySteps))
      : 0,
  );
  const liveTodaySteps = resolveDisplayTodaySteps(contextTodaySteps, canonicalTodaySteps);
  const [purchaseConfirmModal, setPurchaseConfirmModal] = useState<{ code: string; name: string; price: number } | null>(null);
  const [showCoinsInfo, setShowCoinsInfo] = useState(false);
  const [showCoinStore, setShowCoinStore] = useState(false);
  const showCoinStoreRef = useRef(showCoinStore);
  showCoinStoreRef.current = showCoinStore;
  const { guardRewardAction, verificationLevel } = useStepSourceGuard({
    onSetupRequired: () => requestHomeStepSetup(),
  });
  const [walkFocused, setWalkFocused] = useState(true);

  const handleCloseCoinStore = useCallback(() => {
    setShowCoinStore(false);
    dispatch(fetchCoinBalance());
  }, [dispatch]);

  const handleCoinStorePurchase = useCallback(() => {
    dispatch(fetchCoinBalance());
    dispatch(fetchTrackThemes());
  }, [dispatch]);

  const statusConf = (() => {
    const base = STATUS_CONFIG[trackingStatus];
    // Use theme primary green so Light Mode gets a stronger #00C853; Dark stays #00E676.
    if (trackingStatus === "walking") {
      return { ...base, color: colors.primary };
    }
    return base;
  })();
  const dotAnim = useRef(new Animated.Value(1)).current;
  const bannerAnim = useRef(new Animated.Value(0)).current;
  const bannerVisible = useRef(false);
  const btnFillAnim = useRef(new Animated.Value(0)).current;
  const createFillAnim = useRef(new Animated.Value(0)).current;

  const [showProfile, setShowProfile] = useState(false);
  const [profileModalAnimated, setProfileModalAnimated] = useState(true);
  const navigateFromProfile = useCallback((href: string) => {
    // Dismiss My Profile instantly so the destination screen isn't covered by
    // the native Modal layer, and so Walk doesn't flash during a slide-down.
    setProfileModalAnimated(false);
    setShowProfile(false);
    router.push(href as never);
    setTimeout(() => setProfileModalAnimated(true), 250);
  }, []);
  const [setupModal, setSetupModal] = useState<{ fee: number; label: string; gradients: readonly string[] } | null>(null);
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
  const [challengeTargetSteps, setChallengeTargetSteps] = useState(getDefaultTargetSteps("daily"));
  const [stepsPickerDraft, setStepsPickerDraft] = useState(getDefaultTargetSteps("daily"));
  const [challengeMaxPlayers, setChallengeMaxPlayers] = useState(getDefaultPlayerCount());
  const [playersPickerDraft, setPlayersPickerDraft] = useState(getDefaultPlayerCount());
  const [activePicker, setActivePicker] = useState<"entryFee" | "coinAmount" | "usdAmount" | "goalType" | "steps" | "players" | "unlimitedAmount" | "unlimitedGoal" | "unlimitedDuration" | null>(null);
  const [challengeEntryMode, setChallengeEntryMode] = useState<"free" | "coins" | "usd" | "unlimited_goal">(
    isUnlimitedGoalFrontendEnabled() ? "unlimited_goal" : "free",
  );
  const [challengeUsdAmount, setChallengeUsdAmount] = useState(3);
  const [unlimitedEntryDollars, setUnlimitedEntryDollars] = useState<number>(UNLIMITED_GOAL_ENTRY_AMOUNT_DOLLARS[0]!);
  const [unlimitedDailyGoalSteps, setUnlimitedDailyGoalSteps] = useState(UNLIMITED_GOAL_DEFAULT_DAILY_STEPS);
  const [unlimitedDurationDays, setUnlimitedDurationDays] = useState<UnlimitedGoalDurationDays>(7);
  const [unlimitedPaymentQuote, setUnlimitedPaymentQuote] = useState<UnlimitedGoalPaymentQuote | null>(null);
  const [setupPaymentQuote, setSetupPaymentQuote] = useState<CashChallengePaymentQuote | null>(null);
  const [createPaymentQuote, setCreatePaymentQuote] = useState<CashChallengePaymentQuote | null>(null);
  const [confirmPaymentQuote, setConfirmPaymentQuote] = useState<CashChallengePaymentQuote | null>(null);
  const [confirmPaymentQuoteLoading, setConfirmPaymentQuoteLoading] = useState(false);
  const [confirmPaymentQuoteError, setConfirmPaymentQuoteError] = useState<string | null>(null);
  const [confirmQuoteRetryNonce, setConfirmQuoteRetryNonce] = useState(0);
  const confirmQuoteSeqRef = useRef(0);
  const [challengeGoalType, setChallengeGoalType] = useState<GoalPeriodType>("daily");
  const [challengeStartDate, setChallengeStartDate] = useState<Date>(() => toLocalCalendarDate(new Date()));
  const [challengeEndDate, setChallengeEndDate] = useState<Date | null>(null);
  const [challengeStartTimeIdx, setChallengeStartTimeIdx] = useState(0);
  const [challengeNowSetAt, setChallengeNowSetAt] = useState<number | null>(() => Date.now());
  const [showStartDatePicker, setShowStartDatePicker] = useState(false);
  const [showStartTimePicker, setShowStartTimePicker] = useState(false);
  const [showEndDatePicker, setShowEndDatePicker] = useState(false);

  const applyChallengeStartDate = useCallback((raw: Date) => {
    const today = toLocalCalendarDate(new Date());
    let next = toLocalCalendarDate(raw);
    if (next.getTime() < today.getTime()) next = today;
    setChallengeStartDate(next);
    // "Now" only applies to today — switch to a real clock slot for future dates
    setChallengeStartTimeIdx((prev) => {
      if (!isSameDay(next, new Date()) && TIME_PRESETS_WITH_NOW[prev]?.isNow) {
        return getNextPresetIndexForNow(TIME_PRESETS_WITH_NOW);
      }
      return prev;
    });
    if (__DEV__) {
      console.log(
        "[CreateChallengeTime] start date selected:",
        next.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }),
      );
    }
  }, []);

  const onStartDatePickerChange = useCallback((event: DateTimePickerEvent, date?: Date) => {
    // Android: close the system dialog first so the selection is not lost to unmount races
    if (Platform.OS === "android") {
      setShowStartDatePicker(false);
      if (event.type !== "set" || !date) return;
      applyChallengeStartDate(date);
      return;
    }
    if (date) applyChallengeStartDate(date);
  }, [applyChallengeStartDate]);

  const challengeIsNowStart =
    challengeModal &&
    isSameDay(challengeStartDate, new Date()) &&
    (TIME_PRESETS_WITH_NOW[challengeStartTimeIdx]?.isNow === true);

  // Keep end date locked to start + duration. For "Now", recompute from Date.now()
  // on a silent 1s interval — only setState when the minute (endMs) actually changes
  // so Walk does not re-render every second for clock labels (those use LiveClockText).
  useEffect(() => {
    const days =
      challengeEntryMode === "unlimited_goal"
        ? unlimitedDurationDays
        : challengeGoalType === "daily"
          ? 1
          : challengeGoalType === "weekly"
            ? 7
            : 30;
    let cancelled = false;

    const recompute = () => {
      if (cancelled) return;
      const now = new Date();
      const isToday = isSameDay(challengeStartDate, now);
      const preset = isToday
        ? (TIME_PRESETS_WITH_NOW[challengeStartTimeIdx] ?? TIME_PRESETS_WITH_NOW[0]!)
        : (TIME_PRESETS_FUTURE[Math.max(0, challengeStartTimeIdx - 1)] ?? TIME_PRESETS_FUTURE[0]!);
      const startWithTime = new Date(challengeStartDate);
      if (preset.isNow && isToday) {
        startWithTime.setHours(now.getHours(), now.getMinutes(), 0, 0);
      } else {
        startWithTime.setHours(
          preset.isNow ? now.getHours() : preset.hour,
          preset.isNow ? now.getMinutes() : preset.minute,
          0,
          0,
        );
      }
      const endDate = new Date(startWithTime);
      endDate.setDate(endDate.getDate() + days);
      setChallengeEndDate((prev) => {
        if (prev && prev.getTime() === endDate.getTime()) return prev;
        if (__DEV__) {
          console.log("[CreateChallengeTime] duration selected:", days, "days");
          console.log("[CreateChallengeTime] calculated end date:", endDate.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }));
          console.log("[CreateChallengeTime] calculated end time:", fmtShortTime12(endDate));
          console.log("[CreateChallengeTime] timezone:", getUserTimezone());
        }
        return endDate;
      });
    };

    recompute();
    if (!challengeIsNowStart) return () => { cancelled = true; };

    const id = setInterval(recompute, 1000);
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") recompute();
    });
    return () => {
      cancelled = true;
      clearInterval(id);
      sub.remove();
    };
  }, [challengeStartDate, challengeGoalType, challengeStartTimeIdx, challengeIsNowStart, challengeEntryMode, unlimitedDurationDays]);

  useEffect(() => {
    setChallengeTargetSteps(getDefaultTargetSteps(challengeGoalType));
  }, [challengeGoalType]);

  const pickerSlideY = useRef(new Animated.Value(500)).current;
  const [challengeCreating, setChallengeCreating] = useState(false);
  const [joinWithCodeVisible, setJoinWithCodeVisible] = useState(false);
  const [coinsBattleVisible, setCoinsBattleVisible] = useState(false);
  const [alreadyHostingModal, setAlreadyHostingModal] = useState<{ isActiveRace: boolean; raceId: string | null; entryKey: string } | null>(null);
  const [confirmEntry, setConfirmEntry] = useState<{
    fee: number;
    label: string;
    gradients: readonly string[];
    /** When true, host can change fixed-cash entry via $3–$25 slider. */
    feeEditable?: boolean;
  } | null>(null);
  const [confirmEntryAnimated, setConfirmEntryAnimated] = useState(true);
  const [confirmChecks, setConfirmChecks] = useState<boolean[]>([false, false, false]);
  const [showCreateConfirm, setShowCreateConfirm] = useState(false);
  const [createConfirmChecks, setCreateConfirmChecks] = useState<boolean[]>([false, false, false]);
  const [challengeStatuses, setChallengeStatuses] = useState<Record<string, ChallengeStatus>>({});
  const walkCacheReadyRef = useRef(false);
  const [walkCacheReady, setWalkCacheReady] = useState(false);

  // Race card hydration only needs auth — do not wait for Health Connect / steps.
  const raceReady = authReady && !!sessionToken && !!user?.id;
  const userReady = raceReady && stepsHydrated;
  const isAutoTrackingOn =
    stepPermissionStatus === "granted" || usingRealTracking;
  const stepsInitializing =
    stepsHydrated &&
    !stepsSourceReady &&
    liveTodaySteps <= 0 &&
    isAutoTrackingOn;
  const confirmedWalkSteps =
    userReady && Number.isFinite(liveTodaySteps) ? liveTodaySteps : 0;
  const displayedWalkSteps = useIncrementalStepDisplay(confirmedWalkSteps);
  const { safeSteps: safeTodaySteps, safeGoal: goalSteps, progress: goalProgress, percent: goalPercent } =
    clampDailyProgress(
      userReady && (!stepsInitializing || confirmedWalkSteps > 0)
        ? confirmedWalkSteps
        : 0,
      contextDailyGoal > 0 ? contextDailyGoal : dbWalk.goalSteps,
    );

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
    const markWalkCacheReady = () => {
      if (walkCacheReadyRef.current) return;
      walkCacheReadyRef.current = true;
      setWalkCacheReady(true);
    };
    try {
      if (!walkCacheReadyRef.current) {
        const cached = await screenCache.get<Record<string, ChallengeStatus>>(cacheKey);
        if (cached) {
          setChallengeStatuses(cached);
          markWalkCacheReady();
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
      void screenCache.set(cacheKey, map);
    } catch { /* silent — still clear skeleton below */ }
    finally {
      // Never leave Join-a-Challenge stuck on skeletons if the API fails/times out.
      markWalkCacheReady();
    }
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

  // Clear leftover Create Challenge / setup sheets when returning from Waiting Room.
  useFocusEffect(
    useCallback(() => {
      if (!pendingDismissRaceCoverModalsRef.current) return;
      pendingDismissRaceCoverModalsRef.current = false;
      setChallengeModalAnimated(false);
      setChallengeModal(false);
      setChallengeCreating(false);
      setSetupModalAnimated(false);
      setSetupModal(null);
      setConfirmEntryAnimated(false);
      setConfirmEntry(null);
    }, []),
  );

  useFocusEffect(useCallback(() => {
    if (!userReady) {
      if (__DEV__) {
        console.log(
          `[WalkScreen] skipped fetch reason=missing userId/token/authReady authReady=${authReady} tokenExists=${!!sessionToken} userId=${user?.id ?? "none"}`,
        );
      }
      return;
    }
    // Reject legacy +1 pedometer phantoms right after tab focus / screen switch.
    const { suppressLegacyStepBumps } = require("@/utils/stepAccuracy") as typeof import("@/utils/stepAccuracy");
    suppressLegacyStepBumps(8_000);
    void refreshTodayRank();
    void refetchDbWalk();
    if (usingRealTracking) {
      void refreshTodaySteps({
        rehydrateBackend: true,
        mergeNative: false,
        applyDisplay: false,
      });
      void resumeStepWatching();
    }
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

  /** Registered upcoming rooms for Next Race (same source as Available Rooms). */
  type WalkUpcomingRoom = {
    room_id: string;
    challenge_type: string;
    entry_fee: number;
    coin_entry_amount: number;
    target_steps: number;
    max_players: number;
    registered_count: number;
    scheduled_start_at: string | null;
    current_user_registered: boolean;
    host_user_id: string;
    status?: string | null;
  };
  const [registeredUpcomingRooms, setRegisteredUpcomingRooms] = useState<WalkUpcomingRoom[]>([]);
  /** Distinguish loading from confirmed empty for Next Race / Live Race card. */
  const [registeredUpcomingStatus, setRegisteredUpcomingStatus] = useState<
    "idle" | "loading" | "ready" | "error"
  >("idle");

  // Drop Next Race cards immediately on logout so stale old-user rows never linger.
  useEffect(() => {
    if (!user?.id) {
      setRegisteredUpcomingRooms([]);
      setRegisteredUpcomingStatus("idle");
    }
  }, [user?.id]);

  // Group count for the compact "Groups" entry — reuse Groups screen cache only (no new API).
  const GROUPS_CACHE_KEY = "screen_groups_overview";
  const [groupCount, setGroupCount] = useState(() => {
    const cached = screenCache.getSync<{ summary?: { total_groups?: number }; groups?: unknown[] }>(GROUPS_CACHE_KEY);
    return cached?.summary?.total_groups ?? cached?.groups?.length ?? 0;
  });
  const [availableChallengeCount, setAvailableChallengeCount] = useState(0);
  const viewAllBlinkAnim = useRef(new Animated.Value(1)).current;
  const groupsFadeAnim = useRef(new Animated.Value(0)).current;
  const groupsExploreScale = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    groupsFadeAnim.setValue(0);
    Animated.timing(groupsFadeAnim, {
      toValue: 1,
      duration: 420,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [groupsFadeAnim]);

  useEffect(() => {
    if (availableChallengeCount <= 0) {
      viewAllBlinkAnim.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(viewAllBlinkAnim, { toValue: 0.2, duration: 700, useNativeDriver: true }),
        Animated.timing(viewAllBlinkAnim, { toValue: 1, duration: 700, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [availableChallengeCount, viewAllBlinkAnim]);

  const refreshAvailableChallengeCount = useCallback(async () => {
    try {
      const count = await fetchAvailableChallengeCount({ viewerUserId: user?.id });
      setAvailableChallengeCount(count);
    } catch {
      /* keep previous count */
    }
  }, [user?.id]);

  const syncGroupCountFromCache = useCallback(async () => {
    const mem = screenCache.getSync<{ summary?: { total_groups?: number }; groups?: unknown[] }>(GROUPS_CACHE_KEY);
    if (mem) {
      setGroupCount(mem.summary?.total_groups ?? mem.groups?.length ?? 0);
      return;
    }
    const disk = await screenCache.get<{ summary?: { total_groups?: number }; groups?: unknown[] }>(GROUPS_CACHE_KEY);
    if (disk) setGroupCount(disk.summary?.total_groups ?? disk.groups?.length ?? 0);
  }, []);

  const fetchRegisteredUpcomingRooms = useCallback(async () => {
    const uid = user?.id;
    if (!uid) return;
    setRegisteredUpcomingStatus((prev) => (prev === "ready" ? prev : "loading"));
    try {
      const [
        { loadLeftUnlimitedChallengeIds, clearUnlimitedChallengeLeft },
        res,
        unlimitedWaiting,
        unlimitedMine,
        classicActive,
      ] = await Promise.all([
        import("@/utils/hostedUnlimitedCache"),
        authFetch("/api/rooms/available?tab=upcoming"),
        fetchAvailableUnlimitedChallenges({ viewerUserId: uid }),
        fetchMyOpenUnlimitedChallenges({ viewerUserId: uid }),
        import("@/services/stepProgressCoordinator").then((m) =>
          m.fetchMyActiveInProgressRaces(uid).catch(() => []),
        ),
      ]);
      // Logged out (or switched) while in flight — drop stale results.
      if (store.getState().auth.user?.id !== uid) return;
      const unlimited = mergeUpcomingRoomsById(unlimitedWaiting, unlimitedMine);
      if (!res.ok && unlimited.length === 0 && classicActive.length === 0) return;
      const leftIds = await loadLeftUnlimitedChallengeIds();
      if (store.getState().auth.user?.id !== uid) return;
      const data = res.ok
        ? ((await res.json()) as { rooms?: WalkUpcomingRoom[] })
        : { rooms: [] as WalkUpcomingRoom[] };
      const now = Date.now();
      const classicAsWalk: WalkUpcomingRoom[] = classicActive.map((r) => ({
        room_id: r.id,
        challenge_type:
          r.entryType === "coins_battle"
            ? "coins_battle"
            : r.type === "sponsored"
              ? "sponsored"
              : r.entryType === "paid_usd" || r.entryType === "cash"
                ? "paid_usd"
                : "free",
        entry_fee: 0,
        coin_entry_amount: 0,
        max_players: Math.max(1, r.currentPlayers ?? 10),
        registered_count: Math.max(1, r.currentPlayers ?? 1),
        scheduled_start_at: r.startedAt ?? new Date().toISOString(),
        target_steps: r.targetSteps ?? 1000,
        host_user_id: r.isHost ? uid : "",
        current_user_registered: true,
        status: r.status || "in_progress",
      }));
      const unlimitedAsWalk: WalkUpcomingRoom[] = unlimited.map((u) => {
        const serverReg = !!u.current_user_registered;
        if (serverReg && leftIds.has(u.room_id)) {
          void clearUnlimitedChallengeLeft(u.room_id);
        }
        return {
          room_id: u.room_id,
          challenge_type: u.challenge_type,
          entry_fee: u.entry_fee,
          coin_entry_amount: u.coin_entry_amount,
          max_players: u.max_players,
          registered_count: u.registered_count,
          scheduled_start_at: u.scheduled_start_at,
          target_steps: u.target_steps,
          host_user_id: u.host_user_id,
          current_user_registered: serverReg || (!leftIds.has(u.room_id) && !!u.current_user_registered),
          status: u.status,
        };
      });
      const merged = mergeUpcomingRoomsById(
        mergeUpcomingRoomsById(data.rooms ?? [], unlimitedAsWalk),
        classicAsWalk,
      );
      const nextRaceRooms = merged.filter((r) => {
        // Only drop leftIds when server did not confirm membership.
        const isUnlimited = isUnlimitedGoalChallenge({
          challengeType: r.challenge_type,
          maxPlayers: r.max_players,
        });
        const isMine = isUnlimited
          ? !!r.current_user_registered
          : r.current_user_registered || (!!uid && r.host_user_id === uid);
        if (!isMine) return false;
        if (leftIds.has(r.room_id) && !r.current_user_registered) return false;
        if (!r.scheduled_start_at) return false;
        const status = (r.status ?? "").toLowerCase();
        if (
          status === "completed" ||
          status === "cancelled" ||
          status === "canceled" ||
          status === "cancelled_by_platform" ||
          status === "canceled_by_platform" ||
          status === "settled"
        ) {
          return false;
        }
        const startMs = new Date(r.scheduled_start_at).getTime();
        if (!Number.isFinite(startMs)) return false;
        // Keep host/participant card through start + while Unlimited is still open/active.
        if (startMs > now) return true;
        return (
          status === "scheduled" ||
          status === "waiting" ||
          status === "open" ||
          status === "active" ||
          status === "starting" ||
          status === "settling" ||
          status === "in_progress" ||
          status === "" ||
          isUnlimited
        );
      });
      if (store.getState().auth.user?.id !== uid) return;
      console.log(
        `[NextRace] unlimited=${unlimited.length} mine=${unlimitedMine.length} merged=${merged.length} nextRace=${nextRaceRooms.length} uid=${uid ?? "none"}`,
        unlimited.map((u) => ({
          id: u.room_id,
          start: u.scheduled_start_at,
          host: u.host_user_id,
          reg: u.current_user_registered,
          status: u.status,
        })),
      );
      setRegisteredUpcomingRooms(nextRaceRooms);
      setRegisteredUpcomingStatus("ready");
    } catch {
      /* keep previous Next Race list */
      setRegisteredUpcomingStatus((prev) => (prev === "ready" ? prev : "error"));
    }
  }, [user?.id]);

  // Wait for auth only — Live Race card must not wait for steps/HC/Pusher.
  useFocusEffect(useCallback(() => {
    if (!raceReady) return;
    void fetchRegisteredUpcomingRooms();
    void syncGroupCountFromCache();
    void refreshAvailableChallengeCount();
  }, [
    raceReady,
    fetchRegisteredUpcomingRooms,
    syncGroupCountFromCache,
    refreshAvailableChallengeCount,
  ]));

  // When Walk stays focused while raceReady flips true, also refresh once.
  useEffect(() => {
    if (!raceReady) return;
    void fetchRegisteredUpcomingRooms();
    void refreshAvailableChallengeCount();
  }, [raceReady, fetchRegisteredUpcomingRooms, refreshAvailableChallengeCount]);

  useEffect(() => {
    const ch = subscribeToChannel("public-rooms-available");
    if (!ch) return;
    const refetch = () => {
      void fetchRegisteredUpcomingRooms();
      void refreshAvailableChallengeCount();
    };
    ch.bind("room:created",   refetch);
    ch.bind("room:scheduled", refetch);
    ch.bind("room:started",   refetch);
    ch.bind("room:cancelled", refetch);
    ch.bind("room:finished",  refetch);
    return () => { unsubscribeFromChannel("public-rooms-available"); };
  }, [fetchRegisteredUpcomingRooms, refreshAvailableChallengeCount]);

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
            targetSteps?: number;
            prizePoolCents?: number;
            prizePerWinnerCents?: number;
            entryCoinFee?: number;
          }>;
        };
        const evs = data.events ?? [];
        // Priority: racing > join_window > registered > available > watch_live
        let next: SponsoredCardStatus | null = null;
        for (const ev of evs) {
          if (ev.status === "in_progress" && ev.isActive) {
            next = {
              kind: "racing",
              eventId: ev.id,
              registeredCount: ev.registeredCount,
              maxSlots: ev.maxSlots,
              targetSteps: ev.targetSteps,
              prizePoolCents: ev.prizePoolCents,
              prizePerWinnerCents: ev.prizePerWinnerCents,
            };
            break;
          }
        }
        if (!next) {
          for (const ev of evs) {
            if (canOpenSponsoredWaitingRoom(ev) && ev.joinWindowOpen) {
              next = {
                kind: "join_window",
                eventId: ev.id,
                scheduledStartAt: ev.scheduledStartAt,
                registeredCount: ev.registeredCount,
                maxSlots: ev.maxSlots,
                targetSteps: ev.targetSteps,
                prizePoolCents: ev.prizePoolCents,
                prizePerWinnerCents: ev.prizePerWinnerCents,
              };
              break;
            }
          }
        }
        if (!next) {
          for (const ev of evs) {
            if (canOpenSponsoredWaitingRoom(ev)) {
              next = {
                kind: "registered",
                eventId: ev.id,
                scheduledStartAt: ev.scheduledStartAt!,
                registeredCount: ev.registeredCount,
                maxSlots: ev.maxSlots,
                targetSteps: ev.targetSteps,
                prizePoolCents: ev.prizePoolCents,
                prizePerWinnerCents: ev.prizePerWinnerCents,
              };
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
          // Dual-race: keep sponsored as companion while a free/coins race is active
          // so device totals sync into both rooms.
          if (next?.kind === "racing" && next.eventId) {
            const activeId = store.getState().raceProgress.activeRaceId;
            if (activeId && activeId !== next.eventId) {
              store.dispatch(raceProgressActions.setCompanionRaceId(next.eventId));
              void import("@/services/stepProgressCoordinator").then(({ ensureCompanionRaceNotification }) => {
                void ensureCompanionRaceNotification({
                  raceId: next.eventId,
                  userId: store.getState().auth.user?.id ?? "",
                  username: store.getState().auth.user?.username ?? undefined,
                });
              });
            } else if (!activeId) {
              store.dispatch(raceProgressActions.setCompanionRaceId(null));
            }
            try {
              activeChallengeSync.register(next.eventId);
              if (activeId) activeChallengeSync.register(activeId);
            } catch { /* ignore */ }
          } else if (next?.kind !== "racing") {
            const companion = store.getState().raceProgress.companionRaceId;
            if (companion && next?.kind !== "join_window") {
              store.dispatch(raceProgressActions.setCompanionRaceId(null));
              void import("@/services/raceProgressNotificationService").then(
                ({ raceProgressNotificationService }) => {
                  void raceProgressNotificationService.stopParallel(companion);
                },
              );
            }
          }
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
  const isUnlimitedGoalEntry =
    challengeEntryMode === "unlimited_goal" && isUnlimitedGoalFrontendEnabled();
  const coinEntryAmount = COINS_ENTRY_AMOUNTS[challengeEntryIdx] ?? COINS_ENTRY_AMOUNTS[0]!;
  const goalStepOptions = useMemo(() => getTargetStepOptions(challengeGoalType), [challengeGoalType]);
  const targetStepsForCreate = isUnlimitedGoalEntry
    ? unlimitedDailyGoalSteps
    : isValidTargetSteps(challengeGoalType, challengeTargetSteps)
    ? challengeTargetSteps
    : getDefaultTargetSteps(challengeGoalType);
  const durationDays = isUnlimitedGoalEntry
    ? unlimitedDurationDays
    : challengeGoalType === "daily"
      ? 1
      : challengeGoalType === "weekly"
        ? 7
        : 30;
  const durationDaysLabel = isUnlimitedGoalEntry
    ? formatDurationDaysLabel(unlimitedDurationDays)
    : challengeGoalType === "daily"
      ? "1 day"
      : challengeGoalType === "weekly"
        ? "7 days"
        : "30 days";

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
    if (challengeEntryMode !== "unlimited_goal" || !isUnlimitedGoalFrontendEnabled()) {
      setUnlimitedPaymentQuote(null);
      return;
    }
    setUnlimitedPaymentQuote(
      previewUnlimitedGoalPaymentQuote({
        entryFeeCents: unlimitedEntryDollars * 100,
      }),
    );
  }, [challengeEntryMode, unlimitedEntryDollars]);

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
      setConfirmPaymentQuoteLoading(false);
      setConfirmPaymentQuoteError(null);
      return;
    }
    const dollars = clampUsdFixedEntryDollars(confirmEntry.fee);
    const entryFeeCents = usdFixedEntryDollarsToCents(dollars);
    let cancelled = false;
    const seq = ++confirmQuoteSeqRef.current;
    setConfirmPaymentQuoteLoading(true);
    setConfirmPaymentQuoteError(null);
    const timer = setTimeout(() => {
    void fetchCashChallengePaymentQuote({
        entryFeeCents,
      numberOfPlayers: 10,
    })
      .then((q) => {
          if (cancelled || seq !== confirmQuoteSeqRef.current) return;
          setConfirmPaymentQuote(q);
          setConfirmPaymentQuoteLoading(false);
          setConfirmPaymentQuoteError(null);
        })
        .catch((err) => {
          if (cancelled || seq !== confirmQuoteSeqRef.current) return;
          // Keep prior quote if it still matches; otherwise summary falls back to entry fee.
          setConfirmPaymentQuote((prev) => {
            if (!prev) return null;
            const prevCents = Math.round(prev.entryFeeCents ?? prev.entryFee * 100);
            return prevCents === entryFeeCents ? prev : null;
          });
          setConfirmPaymentQuoteLoading(false);
          setConfirmPaymentQuoteError(
            err instanceof Error ? err.message : "Could not load payment summary.",
          );
        });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [confirmEntry?.fee, confirmEntry, confirmQuoteRetryNonce]);

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
  // Apply server-persisted track selection once per distinct selectedThemeCode
  // so a later purchase local-select is not overwritten by a stale refetch.
  const lastAppliedServerThemeRef = useRef<string | null>(null);
  useEffect(() => {
    if (themesLoading) return;
    if (!isTrackLayoutId(serverSelectedThemeCode)) return;
    if (lastAppliedServerThemeRef.current === serverSelectedThemeCode) return;
    lastAppliedServerThemeRef.current = serverSelectedThemeCode;
    setSelectedTrackLayout(serverSelectedThemeCode);
    setChallengeTrackLayout(serverSelectedThemeCode);
  }, [serverSelectedThemeCode, themesLoading]);
  const [activeRaceModal, setActiveRaceModal] = useState<ActiveRaceInfo | null>(null);
  const [scheduledRoomResult, setScheduledRoomResult] = useState<{
    inviteCode: string | null;
    isPrivate: boolean;
    scheduledStartAt: string;
    targetSteps: number;
    entryType: string;
    entryAmountCents: number;
    coinEntryAmount: number;
    raceId?: string;
    isHost?: boolean;
    maxPlayers?: number;
    joinedCount?: number;
    /** Modal closed — keep seed for Next Race until upcoming list includes it. */
    modalDismissed?: boolean;
  } | null>(null);

  // Waiting Room Leave → drop from Next Race immediately (incl. local create seed).
  useEffect(() => {
    const sub = DeviceEventEmitter.addListener(
      CHALLENGE_LEFT_EVENT,
      (payload: { raceId?: string }) => {
        const raceId = payload?.raceId;
        if (!raceId) return;
        setRegisteredUpcomingRooms((prev) => prev.filter((r) => r.room_id !== raceId));
        setScheduledRoomResult((prev) => (prev?.raceId === raceId ? null : prev));
        setChallengeStatuses((prev) => {
          let changed = false;
          const next: Record<string, ChallengeStatus> = {};
          for (const [key, status] of Object.entries(prev)) {
            if (status?.raceId === raceId) {
              changed = true;
              continue;
            }
            next[key] = status;
          }
          return changed ? next : prev;
        });
      },
    );
    return () => sub.remove();
  }, []);

  // Drop local Next Race seed once Available/Unlimited upcoming list has the room.
  useEffect(() => {
    const raceId = scheduledRoomResult?.raceId;
    if (!raceId) return;
    if (registeredUpcomingRooms.some((r) => r.room_id === raceId)) {
      setScheduledRoomResult(null);
    }
  }, [registeredUpcomingRooms, scheduledRoomResult?.raceId]);
  const [leavingActiveRace, setLeavingActiveRace] = useState(false);
  const pendingRaceActionRef = useRef<(() => Promise<void>) | null>(null);
  const confirmEntryJoinCallbackRef = useRef<(() => void) | null>(null);

  // Sponsored events card status
  type SponsoredCardStatus =
    | {
        kind: "racing";
        eventId: string;
        registeredCount?: number;
        maxSlots?: number;
        targetSteps?: number;
        prizePoolCents?: number;
        prizePerWinnerCents?: number;
      }
    | {
        kind: "join_window";
        eventId: string;
        scheduledStartAt: string | null;
        registeredCount: number;
        maxSlots: number;
        targetSteps?: number;
        prizePoolCents?: number;
        prizePerWinnerCents?: number;
      }
    | {
        kind: "registered";
        eventId: string;
        scheduledStartAt: string;
        registeredCount: number;
        maxSlots: number;
        targetSteps?: number;
        prizePoolCents?: number;
        prizePerWinnerCents?: number;
      }
    | { kind: "available"; eventId: string; registeredCount: number; maxSlots: number }
    | { kind: "watch_live"; eventId: string };
  const [sponsoredStatus, setSponsoredStatus] = useState<SponsoredCardStatus | null>(null);

  const openSponsoredWaitingRoom = useCallback((eventId: string) => {
    router.push({ pathname: "/sponsored-events/waiting-room", params: { id: eventId, from: "walk" } });
  }, []);

  // Sponsored may run alongside one free/coins/cash race — do not block joining
  // other challenges while registered, in the join window, or racing sponsored.
  const showSponsoredBlockAlert = useCallback(() => false, []);

  const feeToEntryType = (fee: number) => cashHostEntryType(fee);

  const entryKeyToFee = (k: string) =>
    k === "free" ? 0 : k === "paid_1" ? 1 : k === "paid_3" ? 3 : k === "coins_battle" ? -1 : k === "paid_usd" ? 3 : 5;

  const ACTIVE_OR_WAITING = ["user_hosting_active", "user_joined_active", "user_hosting_waiting", "user_joined_waiting"];

  /** Sponsored event id while racing — must not block Host / Create Challenge. */
  const sponsoredRacingId =
    sponsoredStatus?.kind === "racing" ? sponsoredStatus.eventId : null;

  const findActiveRaceForOtherChallenge = useCallback((targetEntryKey: string) => {
    for (const [ek, cs] of Object.entries(challengeStatuses)) {
      if (
        ek !== targetEntryKey &&
        cs &&
        ACTIVE_OR_WAITING.includes(cs.status) &&
        cs.raceId &&
        cs.raceId !== sponsoredRacingId
      ) {
        return { entryKey: ek, cs };
      }
    }
    return null;
  }, [challengeStatuses, sponsoredRacingId]);

  const findAnyActiveRace = useCallback(() => {
    for (const [ek, cs] of Object.entries(challengeStatuses)) {
      if (
        cs &&
        ACTIVE_OR_WAITING.includes(cs.status) &&
        cs.raceId &&
        cs.raceId !== sponsoredRacingId
      ) {
        return { entryKey: ek, cs };
      }
    }
    return null;
  }, [challengeStatuses, sponsoredRacingId]);

  const entryKeyToReminderType = useCallback((entryKey: string): RaceStartingSoonChallengeType => {
    if (entryKey === "free") return "free";
    if (entryKey === "coins_battle") return "coins";
    return "cash";
  }, []);

  const openChallengeWaitingRoom = useCallback(
    (entryKey: string, cs: ChallengeStatus) => {
      if (!cs.raceId) return;
      const fee = entryKeyToFee(entryKey);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
      setActiveRace(cs.raceId, cs.isHost);
      joinRace(fee, cs.maxPlayers, cs.isHost);
      navToMatchmaking({ raceId: cs.raceId, isHost: !!cs.isHost });
    },
    [joinRace, navToMatchmaking, setActiveRace],
  );

  type NextRaceCard = {
    key: string;
    challengeType: RaceStartingSoonChallengeType;
    phase: RaceStartingSoonPhase;
    scheduledStartAt: string;
    registeredCount: number;
    maxSlots: number;
    targetSteps?: number;
    prizePoolCents?: number;
    prizePerWinnerCents?: number;
    coinEntryAmount?: number;
    entryAmountCents?: number;
    onPressCta: () => void;
    sortMs: number;
  };

  /** Tick so Next Race drops cards / flips phase when scheduledStartAt crosses thresholds.
   *  Countdown digits live in RaceStartingSoonCard — only bump Walk state when membership or phase changes. */
  const [nextRaceNowMs, setNextRaceNowMs] = useState(() => Date.now());

  useEffect(() => {
    const collectSig = (now: number): string => {
      const parts: string[] = [];
      const pushIfUpcoming = (key: string, startIso: string | null | undefined) => {
        if (!startIso) return;
        const startMs = new Date(startIso).getTime();
        if (!(startMs > now)) return;
        const phase: RaceStartingSoonPhase =
          startMs - now < 10 * 60_000 ? "join_window" : "registered";
        parts.push(`${key}:${phase}`);
      };

      if (
        (sponsoredStatus?.kind === "registered" || sponsoredStatus?.kind === "join_window") &&
        sponsoredStatus.scheduledStartAt
      ) {
        pushIfUpcoming(`sponsored:${sponsoredStatus.eventId}`, sponsoredStatus.scheduledStartAt);
      }
      for (const [entryKey, cs] of Object.entries(challengeStatuses)) {
        if (!cs?.raceId || cs.isFinished) continue;
        const s = cs.status;
        if (s !== "user_hosting_waiting" && s !== "user_joined_waiting") continue;
        pushIfUpcoming(`challenge:${entryKey}:${cs.raceId}`, cs.scheduledStartAt);
      }
      if (scheduledRoomResult?.scheduledStartAt && scheduledRoomResult.raceId) {
        pushIfUpcoming(`scheduled:${scheduledRoomResult.raceId}`, scheduledRoomResult.scheduledStartAt);
      }
      for (const r of registeredUpcomingRooms) {
        if (!r.scheduled_start_at) continue;
        pushIfUpcoming(`upcoming:${r.room_id}`, r.scheduled_start_at);
      }
      return parts.sort().join("|");
    };

    const initialNow = Date.now();
    const initialSig = collectSig(initialNow);
    if (!initialSig) return;

    setNextRaceNowMs(initialNow);
    let lastSig = initialSig;
    const id = setInterval(() => {
      const now = Date.now();
      const sig = collectSig(now);
      if (sig !== lastSig) {
        lastSig = sig;
        setNextRaceNowMs(now);
      }
    }, 1_000);
    return () => clearInterval(id);
  }, [challengeStatuses, registeredUpcomingRooms, scheduledRoomResult, sponsoredStatus]);

  const nextRaceCards = useMemo((): NextRaceCard[] => {
    // While the first active-race fetch is in flight, keep prior cards (or none)
    // — never treat "loading" as confirmed empty.
    if (registeredUpcomingStatus === "loading" && registeredUpcomingRooms.length === 0) {
      return [];
    }
    const cards: NextRaceCard[] = [];
    const coveredRaceIds = new Set<string>();
    const now = nextRaceNowMs;

    // Sponsored — future scheduled registration only (never live/racing)
    if (
      (sponsoredStatus?.kind === "registered" || sponsoredStatus?.kind === "join_window") &&
      sponsoredStatus.scheduledStartAt
    ) {
      const startMs = new Date(sponsoredStatus.scheduledStartAt).getTime();
      if (startMs > now) {
        const msLeft = startMs - now;
        const phase: RaceStartingSoonPhase =
          msLeft < 10 * 60_000 ? "join_window" : "registered";
        cards.push({
          key: `sponsored:${sponsoredStatus.eventId}`,
          challengeType: "sponsored",
          phase,
          scheduledStartAt: sponsoredStatus.scheduledStartAt,
          registeredCount: sponsoredStatus.registeredCount ?? 0,
          maxSlots: sponsoredStatus.maxSlots ?? 10,
          targetSteps: sponsoredStatus.targetSteps,
          prizePoolCents: sponsoredStatus.prizePoolCents,
          prizePerWinnerCents: sponsoredStatus.prizePerWinnerCents,
          onPressCta: () => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
            openSponsoredWaitingRoom(sponsoredStatus.eventId);
          },
          sortMs: startMs,
        });
        coveredRaceIds.add(sponsoredStatus.eventId);
      }
    }

    for (const [entryKey, cs] of Object.entries(challengeStatuses)) {
      if (!cs || cs.isFinished || !cs.raceId) continue;
      if (coveredRaceIds.has(cs.raceId)) continue;
      const s = cs.status;
      const isWaiting = s === "user_hosting_waiting" || s === "user_joined_waiting";
      if (!isWaiting) continue;
      const startIso = cs.scheduledStartAt ?? null;
      if (!startIso) continue;
      const startMs = new Date(startIso).getTime();
      if (!(startMs > now)) continue;
      const msLeft = startMs - now;
      const phase: RaceStartingSoonPhase =
        msLeft < 10 * 60_000 ? "join_window" : "registered";
      cards.push({
        key: `challenge:${entryKey}:${cs.raceId}`,
        challengeType: entryKeyToReminderType(entryKey),
        phase,
        scheduledStartAt: startIso,
        registeredCount: cs.joinedCount ?? 1,
        maxSlots: cs.maxPlayers || 10,
        targetSteps: cs.targetSteps,
        prizePoolCents: cs.prizePoolCents,
        coinEntryAmount: cs.coinEntryAmount,
        entryAmountCents: cs.entryAmountCents,
        onPressCta: () => openChallengeWaitingRoom(entryKey, cs),
        sortMs: startMs,
      });
      coveredRaceIds.add(cs.raceId);
    }

    const srr = scheduledRoomResult;
    if (
      srr?.raceId &&
      srr.scheduledStartAt &&
      new Date(srr.scheduledStartAt).getTime() > now &&
      !coveredRaceIds.has(srr.raceId)
    ) {
      const entryKey = srr.entryType;
      const startMs = new Date(srr.scheduledStartAt).getTime();
      const msLeft = startMs - now;
      const phase: RaceStartingSoonPhase =
        msLeft < 10 * 60_000 ? "join_window" : "registered";
      const maxPlayers = srr.maxPlayers ?? 10;
      cards.push({
        key: `scheduled:${srr.raceId}`,
        challengeType: entryKeyToReminderType(entryKey),
        phase,
        scheduledStartAt: srr.scheduledStartAt,
        registeredCount: srr.joinedCount ?? 1,
        maxSlots: maxPlayers,
        targetSteps: srr.targetSteps,
        coinEntryAmount: srr.coinEntryAmount,
        entryAmountCents: srr.entryAmountCents,
        onPressCta: () => {
          openChallengeWaitingRoom(entryKey, {
            status: "user_hosting_waiting",
            raceId: srr.raceId!,
            isHost: srr.isHost ?? true,
            isParticipant: true,
            joinedCount: srr.joinedCount ?? 1,
            maxPlayers,
            targetSteps: srr.targetSteps,
            scheduledStartAt: srr.scheduledStartAt,
            entryAmountCents: srr.entryAmountCents,
            coinEntryAmount: srr.coinEntryAmount,
            canHost: false,
            canJoin: false,
            isActive: false,
            isFinished: false,
            label: "Waiting",
          });
        },
        sortMs: startMs,
      });
      coveredRaceIds.add(srr.raceId);
    }

    // Available Rooms — registered upcoming + Unlimited still racing after start.
    for (const room of registeredUpcomingRooms) {
      if (!room.scheduled_start_at || coveredRaceIds.has(room.room_id)) continue;
      const startMs = new Date(room.scheduled_start_at).getTime();
      if (!Number.isFinite(startMs)) continue;
      const status = (room.status ?? "").toLowerCase();
      const isUnlimitedRoom = isUnlimitedGoalChallenge({
        challengeType: room.challenge_type,
        maxPlayers: room.max_players,
      });
      const isLiveStatus =
        status === "active" ||
        status === "starting" ||
        status === "settling" ||
        status === "in_progress";
      const hasStarted = startMs <= now || isLiveStatus;
      // Classic + Unlimited: keep Live Race card while the race is actively running.
      if (!isUnlimitedRoom && hasStarted && !isLiveStatus) continue;

      const msLeft = startMs - now;
      const phase: RaceStartingSoonPhase =
        hasStarted && (isUnlimitedRoom || isLiveStatus)
          ? "racing"
          : msLeft < 10 * 60_000
            ? "join_window"
            : "registered";
      const challengeType: RaceStartingSoonChallengeType =
        room.challenge_type === "sponsored"
          ? "sponsored"
          : room.challenge_type === "coins_battle" || room.coin_entry_amount > 0
            ? "coins"
            : room.entry_fee > 0 || isUnlimitedRoom
              ? "cash"
              : "free";
      const isHost = !!user?.id && user.id === room.host_user_id;
      const joinFee =
        room.entry_fee > 0 || isUnlimitedRoom
          ? room.entry_fee
          : room.coin_entry_amount > 0
            ? -1
            : 0;
      cards.push({
        key: `upcoming:${room.room_id}`,
        challengeType,
        phase,
        scheduledStartAt: room.scheduled_start_at,
        registeredCount: room.registered_count ?? 1,
        maxSlots: isUnlimitedRoom ? 0 : room.max_players || 10,
        targetSteps: room.target_steps,
        prizePoolCents:
          room.entry_fee > 0
            ? Math.round(room.entry_fee * 100 * Math.max(1, room.registered_count))
            : undefined,
        coinEntryAmount: room.coin_entry_amount,
        entryAmountCents: room.entry_fee > 0 ? Math.round(room.entry_fee * 100) : undefined,
        onPressCta: () => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
          if (challengeType === "sponsored") {
            openSponsoredWaitingRoom(room.room_id);
            return;
          }
          // Live race (classic or Unlimited): go straight to Live Detail.
          if (phase === "racing") {
            router.push({
              pathname: "/race/live-detail",
              params: {
                id: room.room_id,
                ...(isUnlimitedRoom
                  ? {
                      challengeType: UNLIMITED_GOAL_CHALLENGE_TYPE,
                      capacityMode: "unlimited",
                    }
                  : {}),
              },
            });
            return;
          }
          setActiveRace(room.room_id, isHost);
          joinRace(joinFee, isUnlimitedRoom ? 0 : room.max_players, isHost);
          navToMatchmaking({
            raceId: room.room_id,
            isHost,
            initialScheduledStartAt: room.scheduled_start_at,
            initialEntryType: isUnlimitedRoom
              ? UNLIMITED_GOAL_CHALLENGE_TYPE
              : challengeType === "coins"
                ? "coins_battle"
                : challengeType === "cash"
                  ? "paid_usd"
                  : challengeType === "free"
                    ? "free"
                    : undefined,
            initialMaxPlayers: isUnlimitedRoom ? null : room.max_players,
            initialTargetSteps: room.target_steps,
            initialCurrentPlayers: room.registered_count ?? 1,
            initialDailyGoalSteps: isUnlimitedRoom ? room.target_steps : undefined,
          });
        },
        sortMs: startMs,
      });
      coveredRaceIds.add(room.room_id);
    }

    cards.sort((a, b) => a.sortMs - b.sortMs);
    return cards;
  }, [
    challengeStatuses,
    entryKeyToReminderType,
    joinRace,
    navToMatchmaking,
    nextRaceNowMs,
    openChallengeWaitingRoom,
    openSponsoredWaitingRoom,
    registeredUpcomingRooms,
    registeredUpcomingStatus,
    scheduledRoomResult,
    setActiveRace,
    sponsoredStatus,
    user?.id,
  ]);

  useEffect(() => {
    setActiveNextRaceIndex((current) =>
      Math.max(0, Math.min(current, nextRaceCards.length - 1)),
    );
  }, [nextRaceCards.length]);

  const buildActiveRaceInfoFromStatus = useCallback((entryKey: string, cs: ChallengeStatus): ActiveRaceInfo => {
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
      started_at: cs.startedAt ?? null,
      scheduled_start_at: cs.scheduledStartAt ?? null,
      registered_count: typeof cs.joinedCount === "number" ? cs.joinedCount : undefined,
      max_players: typeof cs.maxPlayers === "number" && cs.maxPlayers > 0 ? cs.maxPlayers : undefined,
    };
  }, []);

  /** Show modal immediately, then enrich start time / participant counts from the API. */
  const openActiveRaceModalFromStatus = useCallback(
    (entryKey: string, cs: ChallengeStatus) => {
      const base = buildActiveRaceInfoFromStatus(entryKey, cs);
      setActiveRaceModal(base);
      const raceId = cs.raceId;
      if (!raceId) return;
      void (async () => {
        try {
          const currentRes = await authFetch("/api/races/current-active");
          if (currentRes.ok) {
            const data = (await currentRes.json()) as {
              has_active_race?: boolean;
              active_race?: Record<string, unknown> | null;
            };
            if (data.has_active_race && data.active_race) {
              const normalized = normalizeActiveRaceInfo(data.active_race);
              if (normalized.room_id === raceId || !normalized.room_id) {
                setActiveRaceModal({
                  ...base,
                  ...normalized,
                  room_id: normalized.room_id || raceId,
                  challenge_type: normalized.challenge_type || base.challenge_type,
                  entry_fee: typeof normalized.entry_fee === "number" ? normalized.entry_fee : base.entry_fee,
                  target_steps: normalized.target_steps || base.target_steps,
                  current_user_role: normalized.current_user_role || base.current_user_role,
                  started_at: normalized.started_at ?? base.started_at,
                  scheduled_start_at: normalized.scheduled_start_at ?? base.scheduled_start_at,
                  registered_count: normalized.registered_count ?? base.registered_count,
                  max_players: normalized.max_players ?? base.max_players,
                });
                return;
              }
            }
          }
        } catch { /* fall through to race detail */ }

        try {
          const detailRes = await authFetch(`/api/races/${raceId}`);
          if (!detailRes.ok) return;
          const detail = (await detailRes.json()) as {
            race?: {
              startedAt?: string | null;
              scheduledStartAt?: string | null;
              currentPlayers?: number;
              maxPlayers?: number;
              targetSteps?: number;
              status?: string;
            };
            participants?: unknown[];
          };
          const race = detail.race;
          if (!race) return;
          const fromParticipants = Array.isArray(detail.participants) ? detail.participants.length : undefined;
          setActiveRaceModal((prev) => {
            if (!prev || prev.room_id !== raceId) return prev;
            return {
              ...prev,
              started_at: race.startedAt ?? prev.started_at,
              scheduled_start_at: race.scheduledStartAt ?? prev.scheduled_start_at,
              registered_count:
                typeof race.currentPlayers === "number"
                  ? race.currentPlayers
                  : fromParticipants ?? prev.registered_count,
              max_players:
                typeof race.maxPlayers === "number" && race.maxPlayers > 0
                  ? race.maxPlayers
                  : prev.max_players,
              target_steps:
                typeof race.targetSteps === "number" && race.targetSteps > 0
                  ? race.targetSteps
                  : prev.target_steps,
              room_status:
                race.status === "in_progress" || race.status === "completed"
                  ? "in_progress"
                  : prev.room_status,
            };
          });
        } catch { /* keep base modal data */ }
      })();
    },
    [buildActiveRaceInfoFromStatus],
  );

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
      const isIndiaUser =
        user?.countryCode === "IN" ||
        user?.country?.toLowerCase() === "india";
      const payLabel = isIndiaUser ? "Pay with Razorpay" : "Pay with Stripe";
      AppAlert.alert(
        "Insufficient Balance",
        `You need $${setupTotalPayable.toFixed(2)} to join. Add funds to your wallet.`,
        [
          {
            text: payLabel,
            onPress: () => {
              router.push({ pathname: "/(tabs)/wallet", params: { openDeposit: "1" } });
            },
          },
        ],
        { showClose: true },
      );
      return;
    }

    // Permission gate — verified Health Connect / HealthKit required for ALL challenges (incl. free)
    if (user?.id) {
      const gate = await ensureMatchStepPermissionsReady({
        userId: user.id,
        username: user.username ?? null,
        requireVerified: true,
        actionLabel: setupModal.fee === 0 ? "host or join this free challenge" : "join this challenge",
        onSetupRequired: () => requestHomeStepSetup(),
      });
      if (!gate.allowed) return;
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
            if (body1.active_race) {
              setActiveRaceModal(normalizeActiveRaceInfo(body1.active_race as Record<string, unknown>));
            }
            return;
          }
          // Room gone — fall through to host a new one
          const res2 = await authFetch(`/api/races/host`, {
            method: "POST",
            body: JSON.stringify(
              cashHostBody(setupModal.fee, playerCount, selectedTargetSteps, selectedTrackLayout),
            ),
          });
          if (!res2.ok) {
            const body2 = await res2.json().catch(() => ({})) as Record<string, unknown>;
            if (res2.status === 409 && body2.code === "ACTIVE_RACE_EXISTS") {
              pendingRaceActionRef.current = handleJoinRace;
              if (body2.active_race) {
                setActiveRaceModal(normalizeActiveRaceInfo(body2.active_race as Record<string, unknown>));
              }
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
          body: JSON.stringify(
            cashHostBody(setupModal.fee, playerCount, selectedTargetSteps, selectedTrackLayout),
          ),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({})) as Record<string, unknown>;
          if (res.status === 409 && body.code === "ACTIVE_RACE_EXISTS") {
            pendingRaceActionRef.current = handleJoinRace;
            if (body.active_race) {
              setActiveRaceModal(normalizeActiveRaceInfo(body.active_race as Record<string, unknown>));
            }
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
      navToMatchmaking({ raceId, isHost: isHosting });
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
    // Permission gate — verified tracking required for ALL joins (incl. free)
    if (user?.id) {
      const gate = await ensureMatchStepPermissionsReady({
        userId: user.id,
        username: user.username ?? null,
        requireVerified: true,
        actionLabel: "join this challenge",
        onSetupRequired: () => requestHomeStepSetup(),
      });
      if (!gate.allowed) return;
    }
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
          if (body.active_race) {
            setActiveRaceModal(normalizeActiveRaceInfo(body.active_race as Record<string, unknown>));
          }
          return;
        }
        AppAlert.alert("Could not join", (body.error as string) ?? "Room may be full or closed.");
        loadChallengeStatuses();
        return;
      }
      setActiveRace(raceId, false);
      joinRace(fee, maxPlayers, false);
      loadChallengeStatuses();
      navToMatchmaking({ raceId, isHost: false });
    } catch {
      AppAlert.alert("Error", "Could not connect. Please try again.");
    } finally {
      setFreeJoining(false);
      setJoiningEntryKey(null);
    }
  }, [setActiveRace, joinRace, loadChallengeStatuses, user?.id, user?.username, freeJoining, joiningEntryKey]);

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
    guardRewardAction(() => {
      void (async () => {
    setJoiningEntryKey("coins_battle");
    try {
      const res = await authFetch(`/api/coins-battle/${raceId}/join`, { method: "POST" });
      const data = await res.json() as { raceId?: string; error?: string; code?: string; currentPlayers?: number };
      if (!res.ok) {
        if (data.code === "ACTIVE_RACE_EXISTS") {
          const ar = (data as { active_race?: Record<string, unknown> }).active_race;
          if (ar) {
            pendingRaceActionRef.current = () => handleCoinsBattleJoin(raceId);
            setActiveRaceModal(normalizeActiveRaceInfo(ar));
          } else {
            AppAlert.alert("Already In A Race", "You are already in an active race.");
          }
        } else if (data.code === "INSUFFICIENT_COINS") {
          AppAlert.alert("Not Enough Coins", "You don't have enough coins to join this battle.");
        } else if (data.code === "ROOM_NOT_OPEN") {
          AppAlert.alert("Room Closed", "This room is no longer open.");
            } else if (data.code === "VERIFIED_STEP_SOURCE_REQUIRED") {
              requestHomeStepSetup();
        } else {
          AppAlert.alert("Join Failed", data.error ?? "Could not join the Coins Battle.");
        }
        return;
      }
      dispatch(fetchCoinBalance());
      navToMatchmaking({ raceId, isHost: false });
    } catch {
      AppAlert.alert("Error", "Network error. Please try again.");
    } finally {
      setJoiningEntryKey(null);
    }
      })();
    });
  }, [dispatch, guardRewardAction]);

  const handleStayInActiveRace = () => {
    const ar = activeRaceModal;
    setActiveRaceModal(null);
    pendingRaceActionRef.current = null;
    if (!ar) return;
    if (ar.room_status === "in_progress") {
      router.push({ pathname: "/race/live-detail", params: liveRaceNavParams(ar.room_id, user?.id) });
    } else {
      navToMatchmaking({
        raceId: ar.room_id,
        isHost: ar.current_user_role === "host",
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


  const submitCreateChallenge = async (args: {
    body: Record<string, unknown>;
    meta: HostPayloadMeta;
    draft: CreateChallengeDraft;
  }) => {
    if (challengeCreating) return;
    const { body, meta, draft } = args;
    let navigating = false;
    setChallengeCreating(true);
    try {
      if (user?.id) {
        const gate = await ensureMatchStepPermissionsReady({
          userId: user.id,
          username: user.username ?? null,
          requireVerified: true,
          actionLabel: "create this challenge",
          onSetupRequired: () => requestHomeStepSetup(),
        });
        if (!gate.allowed) {
          setChallengeCreating(false);
          return;
        }
      }

      if (meta.isUnlimited && !isUnlimitedGoalFrontendEnabled()) {
        AppAlert.alert("Unavailable", "Unlimited Challenge is disabled in this build.");
        setChallengeCreating(false);
        return;
      }
      if (meta.isUnlimited) {
        trackEvent("unlimited_challenge_create_started", { mode: "unlimited_goal" });
      }

      const entryType = meta.entryTypeApi;
      const scheduledStartAt = meta.scheduledStartAt;
      const isScheduled = scheduledStartAt !== null;

      if (meta.isUsd) {
        if (!ENABLE_CASH_CHALLENGES) {
          AppAlert.alert(
            "Cash challenges unavailable",
            "Paid cash challenges are disabled in this app build. Set EXPO_PUBLIC_ENABLE_CASH_CHALLENGES=true and rebuild.",
          );
          setChallengeCreating(false);
          return;
        }
        const required = meta.totalChargeCents / 100;
        if (walletBalance < required) {
          const isIndiaUser =
            user?.countryCode === "IN" ||
            user?.country?.toLowerCase() === "india";
          const payLabel = isIndiaUser ? "Pay with Razorpay" : "Pay with Stripe";
          AppAlert.alert(
            "Insufficient Balance",
            `You need $${required.toFixed(2)} to create this challenge. Add funds to your wallet first.`,
            [
              {
                text: payLabel,
                onPress: () => {
                  router.push({ pathname: "/(tabs)/wallet", params: { openDeposit: "1" } });
                },
              },
            ],
            { showClose: true },
          );
          setChallengeCreating(false);
          return;
        }
      }

      const hostUrl = meta.isUnlimited
        ? "/api/unlimited-challenges/host"
        : "/api/races/host";
      const res = await authFetch(hostUrl, {
        method: "POST",
        body: JSON.stringify(body),
      });

      const data = await res.json() as {
        raceId?: string;
        id?: string;
        code?: string;
        error?: string | { message?: string; code?: string };
        message?: string;
        detail?: string;
        isScheduled?: boolean;
        scheduledStartAt?: string;
        inviteCode?: string;
        challenge?: {
          id?: string;
          challengeId?: string;
          totalChargeCents?: number;
          entryFeeCents?: number;
          platformFeeCents?: number;
          inviteCode?: string | null;
          isPrivate?: boolean;
          visibility?: string;
          startAtIso?: string;
          startAtUtc?: string;
          scheduledStartAt?: string;
          dailyGoalSteps?: number;
          durationDays?: number;
          status?: string;
          title?: string;
          prizePoolCents?: number;
          participantCount?: number;
        };
        race?: {
          entryType?: string;
          targetSteps?: number;
          coinEntryAmount?: number;
          entryAmountCents?: number;
          maxPlayers?: number;
          isPrivate?: boolean;
          inviteCode?: string | null;
        };
        active_race?: {
          room_id: string;
          room_status: string;
          challenge_type: string;
          entry_fee: number;
          target_steps: number;
          current_user_role: string;
        };
      };

      if (!res.ok) {
        const nestedError =
          typeof data.error === "object" && data.error
            ? data.error
            : null;
        const serverError =
          (typeof data.error === "string" ? data.error : null) ??
          nestedError?.message ??
          data.message ??
          data.detail ??
          "";
        const serverCode = data.code ?? nestedError?.code ?? "";
        const isScheduledRoomConflict =
          /scheduled/i.test(serverCode) ||
          /already.*scheduled|scheduled.*already|scheduled (room|race)/i.test(serverError) ||
          (isScheduled && res.status === 409 && !data.active_race);

        if (isScheduledRoomConflict) {
          AppAlert.alert(
            "Cannot create room",
            "You already have a scheduled room. You can create a new future room only after your current scheduled room has been completed, cancelled, or closed.",
          );
          return;
        }

        if (res.status === 409 && data.code === "ACTIVE_RACE_EXISTS" && data.active_race) {
          const ar = data.active_race as ActiveRaceInfo & {
            room_type?: string;
            is_sponsored?: boolean;
          };
          let sponsoredBlock = isSponsoredActiveRaceConflict(ar, sponsoredRacingId);
          if (!sponsoredBlock && ar.room_id) {
            try {
              const detailRes = await authFetch(`/api/races/${ar.room_id}`);
              if (detailRes.ok) {
                const detail = (await detailRes.json()) as { race?: { type?: string } };
                if (detail.race?.type === "sponsored") sponsoredBlock = true;
              }
            } catch { /* ignore */ }
          }
          if (sponsoredBlock) {
            AppAlert.alert(
              "Server needs update",
              "You're only in a sponsored event — hosting a free challenge should be allowed. The API you're connected to is still treating sponsored as a blocking race. Redeploy/restart the backend with the latest fix, then try again.",
            );
            return;
          }
          setActiveRaceModal(normalizeActiveRaceInfo(ar as unknown as Record<string, unknown>));
          return;
        }
        AppAlert.alert("Error", cashChallengeBlockedMessage(serverError));
        return;
      }

      const unlimitedChallenge = data.challenge;
      const createdRaceId =
        data.raceId ??
        unlimitedChallenge?.id ??
        unlimitedChallenge?.challengeId ??
        data.id;
      if (!createdRaceId) {
        AppAlert.alert("Error", "Unexpected server response. Please try again.");
        return;
      }

      // Unlimited host response: challenge.totalChargeCents is the wallet debit.
      if (meta.isUnlimited) {
        const charged =
          typeof unlimitedChallenge?.totalChargeCents === "number"
            ? unlimitedChallenge.totalChargeCents
            : meta.totalChargeCents;
        if (typeof charged === "number" && charged > 0) {
          meta.totalChargeCents = charged;
          if (typeof unlimitedChallenge?.entryFeeCents === "number") {
            meta.entryFeeCents = unlimitedChallenge.entryFeeCents;
          }
          if (typeof unlimitedChallenge?.platformFeeCents === "number") {
            meta.platformFeeCents = unlimitedChallenge.platformFeeCents;
          }
        }
        void refreshWallet({ silent: true });
      }

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      if (meta.isUnlimited) {
        trackEvent("unlimited_challenge_created", { raceId: createdRaceId });
      }

      const unlimitedIsScheduled =
        meta.isUnlimited ||
        data.isScheduled === true ||
        !!(
          unlimitedChallenge?.startAtIso ||
          unlimitedChallenge?.startAtUtc ||
          unlimitedChallenge?.scheduledStartAt
        );

      if (unlimitedIsScheduled || data.isScheduled) {
        const isPrivateRoom =
          typeof unlimitedChallenge?.isPrivate === "boolean"
            ? unlimitedChallenge.isPrivate
            : unlimitedChallenge?.visibility === "private"
              ? true
              : unlimitedChallenge?.visibility === "public"
                ? false
                : (data.race?.isPrivate ?? draft.visibility === "private");
        const scheduledStartAt =
          unlimitedChallenge?.startAtIso ??
          unlimitedChallenge?.startAtUtc ??
          unlimitedChallenge?.scheduledStartAt ??
          data.scheduledStartAt ??
          meta.scheduledStartAt?.toISOString() ??
          new Date().toISOString();
        const entryAmountCents =
          unlimitedChallenge?.entryFeeCents ??
          data.race?.entryAmountCents ??
          meta.entryFeeCents;
        const dailySteps =
          unlimitedChallenge?.dailyGoalSteps ??
          data.race?.targetSteps ??
          meta.targetOrDailySteps;

        if (meta.isUnlimited) {
          void saveHostedUnlimitedChallenge(
            {
            room_id: createdRaceId,
            status: unlimitedChallenge?.status ?? "scheduled",
            challenge_type: UNLIMITED_GOAL_CHALLENGE_TYPE,
            entry_fee: entryAmountCents / 100,
            coin_entry_amount: 0,
            title:
              unlimitedChallenge?.title ??
              `Unlimited · ${dailySteps.toLocaleString()} steps/day`,
            target_steps: dailySteps,
            max_players: 0,
            registered_count: unlimitedChallenge?.participantCount ?? 1,
            scheduled_start_at: scheduledStartAt,
            challenge_duration_days: unlimitedChallenge?.durationDays ?? meta.durationDays,
            challenge_end_at: meta.endAt?.toISOString() ?? null,
            selected_track_theme_id: "bg",
            theme_name: "Unlimited",
            is_private: !!isPrivateRoom,
            requires_code: !!isPrivateRoom,
            host_user_id: user?.id ?? "",
            host_username: user?.username ?? "You",
            host_avatar_color: "#00E676",
            host_avatar_url: null,
            host_country_flag: null,
            current_user_registered: true,
            eligible_to_register: false,
            capacity_mode: "unlimited",
            platform_fee_cents: meta.platformFeeCents,
            total_charge_cents: meta.totalChargeCents,
            reward_pool:
              typeof unlimitedChallenge?.prizePoolCents === "number"
                ? unlimitedChallenge.prizePoolCents / 100
                : entryAmountCents / 100,
            },
            { resumeAfterLeave: true },
          );
        }

        setScheduledRoomResult({
          inviteCode:
            unlimitedChallenge?.inviteCode ??
            data.inviteCode ??
            null,
          isPrivate: !!isPrivateRoom,
          scheduledStartAt,
          targetSteps: dailySteps,
          entryType: data.race?.entryType ?? entryType,
          entryAmountCents,
          coinEntryAmount: data.race?.coinEntryAmount ?? draft.fixed.coinEntryAmount,
          raceId: createdRaceId,
          isHost: true,
          maxPlayers: meta.isUnlimited
            ? undefined
            : (data.race?.maxPlayers ?? meta.maxPlayers ?? draft.fixed.maxPlayers),
          joinedCount: 1,
        });
        setChallengeModal(false);
        setChallengeCreating(false);
        void loadChallengeStatuses();
        void fetchRegisteredUpcomingRooms();
        void refreshAvailableChallengeCount();
        return;
      }

      setChallengeModalAnimated(false);
      pendingDismissRaceCoverModalsRef.current = true;

      router.push({
        pathname: "/race/matchmaking",
        params: buildMatchmakingParams({
          raceId: createdRaceId,
          isHost: true,
          user,
          initialCurrentPlayers: 1,
          initialEntryType: data.race?.entryType ?? entryType,
          initialTargetSteps: data.race?.targetSteps ?? meta.targetOrDailySteps,
          initialCoinEntryAmount: data.race?.coinEntryAmount ?? draft.fixed.coinEntryAmount,
          initialMaxPlayers: meta.isUnlimited
            ? null
            : (data.race?.maxPlayers ?? meta.maxPlayers ?? draft.fixed.maxPlayers),
          initialIsPrivate: data.race?.isPrivate ?? (draft.visibility === "private"),
          initialInviteCode:
            data.race?.inviteCode ??
            data.inviteCode ??
            unlimitedChallenge?.inviteCode ??
            "",
          initialDailyGoalSteps: meta.isUnlimited ? draft.unlimited.dailyGoalSteps : undefined,
          initialDurationDays: meta.isUnlimited ? draft.unlimited.durationDays : undefined,
          initialScheduledStartAt: meta.scheduledStartAt?.toISOString() ?? undefined,
        }),
      });

      navigating = true;
      InteractionManager.runAfterInteractions(() => {
        // Instant dismiss — restore slide animation only in Modal onDismiss.
        setChallengeModal(false);
        setChallengeCreating(false);
      });
    } catch {
      if (meta.isUnlimited) {
        trackEvent("unlimited_challenge_create_failed");
      }
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
              style={[styles.coinPill, {
                backgroundColor: isDark ? colors.gold + "18" : "#FFF4D6",
                borderColor: isDark ? colors.gold + "40" : "#E6A000",
              }]}
              activeOpacity={0.78}
              accessibilityLabel="View coin details"
            >
              <CoinIcon size="small" />
              <Text style={[styles.coinPillText, { color: isDark ? colors.gold : "#B86E00" }]}>
                {coinBalance != null ? coinBalance.toLocaleString() : "--"}
              </Text>
              <Feather name="info" size={11} color={isDark ? colors.gold : "#B86E00"} style={{ opacity: 0.85, marginLeft: 1 }} />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => { setShowProfile(true); }}
              style={[styles.profileAvatar, { backgroundColor: (user?.avatarColor ?? colors.primary) + "25", borderColor: user?.avatarColor ?? colors.primary, zIndex: 20 }]}
              activeOpacity={0.7}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            >
            <ProfileAvatar
              userId={user?.id}
              profileImageUrl={user?.profileImageUrl}
              avatarVersion={user?.avatarVersion}
              avatarColor={user?.avatarColor ?? colors.primary}
              displayName={user?.fullName ?? "W"}
              size={44}
              borderWidth={0}
              style={{ borderWidth: 0 }}
            />
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
                {isAutoTrackingOn ? (
                  <>
                    <View style={[styles.trackingBadge, { backgroundColor: `${statusConf.color}20`, borderColor: `${statusConf.color}40` }]}>
                      <Animated.View style={[styles.statusDot, { backgroundColor: statusConf.color, opacity: trackingStatus === "walking" ? dotAnim : 1 }]} />
                      <Text style={[styles.statusLabel, { color: statusConf.color }]}>{statusConf.label}</Text>
                    </View>
                    <Text style={[styles.autoTrackingLabel, { color: colors.foreground }]}>
                      Auto Tracking <Text style={{ color: colors.primary, fontWeight: "700" }}>ON</Text>
                    </Text>
                    <Text style={[styles.trackingSub, { color: colors.mutedForeground }]}>
                      {verificationLevel === "verified"
                        ? "Verified Tracking — eligible for rewards and races"
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
                        ? "Phone sensor tracking may be available — tap Connect to try"
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
              {isAutoTrackingOn ? (
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
                      requestHomeStepSetup();
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
                        : "activity"
                    }
                    size={18}
                    color={colors.primary}
                  />
                </TouchableOpacity>
              )}
            </View>

            <View style={styles.stepsHero}>
              <WalkProgressIcon steps={displayedWalkSteps} goal={goalSteps} size={56} style={styles.stepsHeroIcon} />
              <View style={styles.stepsHeroText}>
                {stepsInitializing ? (
                  <>
                    <ActivityIndicator size="small" color={colors.primary} style={{ marginBottom: 6 }} />
                    <Text style={[styles.stepsHeroLabel, { color: colors.mutedForeground }]}>Loading steps…</Text>
                  </>
                ) : (
                  <>
                    <Text style={[styles.stepsHeroValue, { color: colors.foreground }]}>{displayedWalkSteps.toLocaleString()}</Text>
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


        {/* Next Race — user's active/upcoming registrations (UI only) */}
        {nextRaceCards.length > 0 && (() => {
          const nextRaceGap = rs(12);
          const availableWidth =
            nextRaceCarouselWidth > 0
              ? nextRaceCarouselWidth
              : screenWidth - rs(32);
          // Leave a small preview of the next card without making compact
          // phones too narrow for the countdown.
          const nextRaceCardW = Math.max(
            248,
            Math.min(availableWidth - rs(44), 520),
          );
          const snapInterval = nextRaceCardW + nextRaceGap;
          const carouselSideInset = Math.max(
            0,
            (availableWidth - nextRaceCardW) / 2,
          );

          const renderNextRaceCard = (card: (typeof nextRaceCards)[number], width?: number) => (
            <RaceStartingSoonCard
              key={card.key}
              challengeType={card.challengeType}
              phase={card.phase}
              scheduledStartAt={card.scheduledStartAt}
              registeredCount={card.registeredCount}
              maxSlots={card.maxSlots}
              targetSteps={card.targetSteps}
              prizePoolCents={card.prizePoolCents}
              prizePerWinnerCents={card.prizePerWinnerCents}
              coinEntryAmount={card.coinEntryAmount}
              entryAmountCents={card.entryAmountCents}
              onPressCta={card.onPressCta}
              style={width != null ? { width, marginBottom: 0 } : undefined}
            />
          );

          return (
            <View
              style={{ marginBottom: rs(8) }}
              onLayout={(event) => {
                const width = event.nativeEvent.layout.width;
                if (width > 0 && width !== nextRaceCarouselWidth) {
                  setNextRaceCarouselWidth(width);
                }
              }}
            >
              <Text style={[styles.sectionTitle, { color: colors.foreground, marginBottom: rs(10) }]}>
                🏁 Next Race 🏃‍♂️
              </Text>
              {nextRaceCards.length === 1 ? (
                renderNextRaceCard(nextRaceCards[0])
              ) : (
                <>
                <FlatList
                  data={nextRaceCards}
                  horizontal
                  keyExtractor={(card) => card.key}
                  renderItem={({ item }) => renderNextRaceCard(item, nextRaceCardW)}
                  ItemSeparatorComponent={() => <View style={{ width: nextRaceGap }} />}
                  showsHorizontalScrollIndicator={false}
                  decelerationRate="fast"
                  snapToInterval={snapInterval}
                  snapToAlignment="start"
                  disableIntervalMomentum
                  bounces={false}
                  removeClippedSubviews={false}
                  initialNumToRender={2}
                  maxToRenderPerBatch={3}
                  windowSize={3}
                  getItemLayout={(_, index) => ({
                    length: nextRaceCardW,
                    offset: snapInterval * index,
                    index,
                  })}
                  onMomentumScrollEnd={(event) => {
                    const nextIndex = Math.round(
                      event.nativeEvent.contentOffset.x / snapInterval,
                    );
                    setActiveNextRaceIndex(
                      Math.max(0, Math.min(nextRaceCards.length - 1, nextIndex)),
                    );
                  }}
                  contentContainerStyle={{
                    paddingHorizontal: carouselSideInset,
                  }}
                />
                <View style={styles.nextRacePagination} accessibilityRole="adjustable">
                  {nextRaceCards.map((card, index) => (
                    <View
                      key={`dot:${card.key}`}
                      style={[
                        styles.nextRaceDot,
                        index === activeNextRaceIndex && styles.nextRaceDotActive,
                      ]}
                    />
                  ))}
                </View>
                </>
              )}
            </View>
          );
        })()}

        {/* Race section */}
        <View style={styles.sectionRow}>
          <Text style={[styles.sectionTitle, { color: colors.foreground, marginBottom: 0 }]}>Join a Challenge</Text>
          <TouchableOpacity
            onPress={() => {
              void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              router.push("/rooms/available");
            }}
            style={styles.roomsBtn}
            activeOpacity={0.75}
            accessibilityRole="button"
            accessibilityLabel={`View all challenges${availableChallengeCount > 0 ? `, ${availableChallengeCount}` : ""}`}
          >
            <LinearGradient
              colors={["#FB7185", "#E11D48"]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.roomsBtnGradient}
            >
              <Text style={styles.roomsBtnText}>View All</Text>
              {availableChallengeCount > 0 ? (
                <View style={styles.viewAllLiveWrap} accessibilityElementsHidden>
                  <Animated.View
                    style={[
                      styles.viewAllBlinkDot,
                      { backgroundColor: "#FFFFFF", opacity: viewAllBlinkAnim },
                    ]}
                  />
                  <View style={styles.viewAllCountCircle}>
                    <Text style={styles.viewAllCountText}>
                      {availableChallengeCount > 99 ? "99+" : availableChallengeCount}
                    </Text>
              </View>
                </View>
              ) : null}
              <Feather name="chevron-right" size={12} color="#FFFFFF" />
            </LinearGradient>
          </TouchableOpacity>
        </View>

        {!walkCacheReady && <SkeletonList count={4} variant="walk" />}
        {RACE_OPTIONS.filter((opt) => showRaceOptionInJoinSection(opt.fee)).map((opt) => {
          const entryKey = feeToEntryType(opt.fee);
          const cs = challengeStatuses[entryKey];

          const openHostModal = () => {
            if (showSponsoredBlockAlert()) return;
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
              openActiveRaceModalFromStatus(otherActive.entryKey, otherActive.cs);
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
                hideChevron={opt.fee === -1 || opt.fee === 0}
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                  if (showSponsoredBlockAlert()) return;
                  const s = cs?.status;
                  if (s === "user_hosting_active" || s === "user_joined_active") {
                    if (cs?.raceId) router.push({ pathname: "/race/live-detail", params: liveRaceNavParams(cs.raceId, user?.id) });
                    return;
                  }
                  if (s === "user_hosting_waiting" || s === "user_joined_waiting") {
                    if (cs?.raceId) {
                      setActiveRace(cs.raceId, cs.isHost);
                      joinRace(opt.fee, cs.maxPlayers, cs.isHost);
                      navToMatchmaking({ raceId: cs.raceId!, isHost: !!cs.isHost });
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
                    openActiveRaceModalFromStatus(otherActive.entryKey, otherActive.cs);
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
                if (showSponsoredBlockAlert()) return;
                const s = cs?.status;
                const modeLabel = opt.fee === 0 ? "free" : `$${opt.fee}`;
                const role = cs?.isHost ? "host" : cs?.isParticipant ? "participant" : "none";
                if (s === "user_hosting_active" || s === "user_joined_active") {
                  if (__DEV__) console.log(`[Walk] Opening challenge: mode=${modeLabel} entry_fee=${opt.fee} status=${s} role=${role} raceId=${cs?.raceId ?? "none"} route=live-detail defaultView=race_track`);
                  if (cs?.raceId) router.push({ pathname: "/race/live-detail", params: liveRaceNavParams(cs.raceId, user?.id) });
                  return;
                }
                if (s === "user_hosting_waiting" || s === "user_joined_waiting") {
                  if (__DEV__) console.log(`[Walk] Opening challenge: mode=${modeLabel} entry_fee=${opt.fee} status=${s} role=${role} raceId=${cs?.raceId ?? "none"} route=matchmaking`);
                  if (cs?.raceId) {
                    setActiveRace(cs.raceId, cs.isHost);
                    joinRace(opt.fee, cs.maxPlayers, cs.isHost);
                    navToMatchmaking({ raceId: cs.raceId!, isHost: !!cs.isHost });
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
                  openActiveRaceModalFromStatus(otherActive.entryKey, otherActive.cs);
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
                start={{ x: 0, y: 0 }}
                end={opt.fee === 0 ? { x: 1, y: 1 } : { x: 1, y: 0 }}
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
                  {opt.fee !== 0 && opt.fee !== -1 ? (
                    <Feather name="chevron-right" size={18} color="rgba(255,255,255,0.8)" />
                  ) : null}
                </View>
              </LinearGradient>
              <JoinProgressOverlay isJoining={joiningEntryKey === entryKey} />
            </TouchableOpacity>
          );
        })}

        {/* Cash Prize Challenge — directly under Coins Battle */}
          {ENABLE_THREE_DOLLAR_CHALLENGE && (() => {
            const premOpt = RACE_OPTIONS.find((o) => o.fee === 3)!;
            const premKey = "paid_3";
            const premCs = challengeStatuses[premKey] ?? challengeStatuses.paid_usd;
            const premS = premCs?.status;

            const handlePremiumPress = () => {
              if (__DEV__) console.log("[PremiumChallenge] $3 card clicked");
              if (showSponsoredBlockAlert()) return;
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              if (premS === "user_hosting_active" || premS === "user_joined_active") {
                if (premCs?.raceId) router.push({ pathname: "/race/live-detail", params: liveRaceNavParams(premCs.raceId, user?.id) });
                return;
              }
              if (premS === "user_hosting_waiting" || premS === "user_joined_waiting") {
                if (premCs?.raceId) {
                  setActiveRace(premCs.raceId, premCs.isHost);
                  joinRace(3, premCs.maxPlayers, premCs.isHost);
                  navToMatchmaking({ raceId: premCs.raceId!, isHost: !!premCs.isHost });
                }
                return;
              }

              // Same active-race guard as Free / Coins Battle / Create Challenge —
              // block before confirm entry or any payment path.
              const otherActive = findActiveRaceForOtherChallenge(premKey);
              if (otherActive) {
                if (otherActive.cs.isHost) {
                  const isActiveRace = otherActive.cs.status === "user_hosting_active";
                  setAlreadyHostingModal({
                    isActiveRace,
                    raceId: otherActive.cs.raceId ?? null,
                    entryKey: otherActive.entryKey,
                  });
                  return;
                }
                const raceIdForJoin =
                  premS === "join_available" ? premCs?.raceId ?? null : null;
                pendingRaceActionRef.current = raceIdForJoin
                  ? () => handleDirectJoin(raceIdForJoin, 3, premCs!.maxPlayers, premKey)
                  : () => {
                      setConfirmChecks([false, false, false]);
                      setConfirmEntry({
                        fee: 3,
                        label: formatUsdFixedCashChallengeLabel(3),
                        gradients: premOpt.gradientColors,
                        feeEditable: true,
                      });
                      return Promise.resolve();
                    };
                openActiveRaceModalFromStatus(otherActive.entryKey, otherActive.cs);
                return;
              }

              if (premS === "join_available" && premCs?.raceId) {
                if (__DEV__) console.log("[PremiumChallenge] join flow opened", { raceId: premCs.raceId });
                void handleDirectJoin(premCs.raceId, 3, premCs.maxPlayers, premKey);
                return;
              }
              if (__DEV__) console.log("[PremiumChallenge] create flow opened");
              setConfirmChecks([false, false, false]);
              setConfirmEntry({
                fee: 3,
                label: formatUsdFixedCashChallengeLabel(3),
                gradients: premOpt.gradientColors,
                feeEditable: true,
              });
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
                    <Text style={styles.raceCardSub}>Skill-based walking challenge</Text>
                    <View style={{ flexDirection: "row", gap: 4, marginTop: 5, alignItems: "center", flexShrink: 1 }}>
                      {["$3–$25", "Step Goal", "Prize rewards"].map((chip) => (
                        <View key={chip} style={{ backgroundColor: "rgba(255,255,255,0.18)", borderRadius: 8, paddingHorizontal: 6, paddingVertical: 2, flexShrink: 1 }}>
                          <Text numberOfLines={1} style={{ color: "#FFF", fontSize: 9, fontWeight: "700" }}>{chip}</Text>
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
                  </View>
                </LinearGradient>
                <JoinProgressOverlay isJoining={joiningEntryKey === premKey} />
              </TouchableOpacity>
            );
          })()}

        {/* Create Challenge — directly under Cash Prize Challenge */}
        <TouchableOpacity
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            if (showSponsoredBlockAlert()) return;
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
              openActiveRaceModalFromStatus(anyActive.entryKey, anyActive.cs);
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

        {/* Unlimited Challenge preview — feature-flagged; stays under Create Challenge */}
        {isWalkTrendingChallengesPreviewEnabled() ? (
          <TrendingChallengesPreview />
        ) : null}

        {/* ── Premium Challenges Section ── */}
        <View>
          {/* Section header */}
          <View style={[styles.sectionRow, { marginTop: 8, marginBottom: 4 }]}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Premium Challenges</Text>
            </View>
          </View>

          {/* Sponsored Events — always available for browsing */}
          {(() => {
            const ss = sponsoredStatus;
            const isRacing     = ss?.kind === "racing";
            const isJoinWin    = ss?.kind === "join_window";
            const isRegistered = ss?.kind === "registered";
            const isAvailable  = ss?.kind === "available";
            const isWatchLive  = ss?.kind === "watch_live";

            const handleSponsoredPress = () => {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
              if (isRacing && ss)     { router.push({ pathname: "/race/live-detail", params: liveRaceNavParams(ss.eventId, user?.id) }); return; }
              if (isJoinWin && ss)    { openSponsoredWaitingRoom(ss.eventId); return; }
              if (isRegistered && ss) { openSponsoredWaitingRoom(ss.eventId); return; }
              if (isWatchLive && ss)  { router.push({ pathname: "/race/live-detail", params: liveRaceNavParams(ss.eventId, user?.id) }); return; }
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
                          <View style={[styles.newBadge, { backgroundColor: "#A855F725", borderColor: "#A855F755", borderWidth: 1 }]}>
                            <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: "#A855F7" }} />
                            <Text style={[styles.newBadgeText, { color: "#A855F7" }]}>JOINED</Text>
                          </View>
                        )}
                        {!isRacing && !isJoinWin && !isRegistered && !isWatchLive && (
                          <View style={styles.newBadge}>
                            <Text style={styles.newBadgeText}>NEW</Text>
                          </View>
                        )}
                        {isRacing && (
                          <View style={[styles.newBadge, { backgroundColor: "#00E67625", borderColor: "#00E67655", borderWidth: 1 }]}>
                            <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: "#00E676" }} />
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
        </View>

        {/* ── Communities Section ── */}
        <View>
          <View style={[styles.sectionRow, { marginTop: 8, marginBottom: 4, alignItems: "flex-start" }]}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.sectionTitle, { color: colors.foreground, marginBottom: 2 }]}>Communities</Text>
              <Text style={[styles.communitiesSectionSub, { color: colors.mutedForeground }]}>
                Walk, compete and stay motivated together
              </Text>
            </View>
          </View>

          <Animated.View style={{ opacity: groupsFadeAnim }}>
            <Pressable
            onPress={() => {
                void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                router.push("/groups");
              }}
              onPressIn={() => {
                Animated.spring(groupsExploreScale, {
                  toValue: 0.94,
                  useNativeDriver: true,
                  speed: 50,
                  bounciness: 0,
                }).start();
              }}
              onPressOut={() => {
                Animated.spring(groupsExploreScale, {
                  toValue: 1,
                  useNativeDriver: true,
                  speed: 40,
                  bounciness: 6,
                }).start();
              }}
              android_ripple={{ color: "rgba(94,234,212,0.22)", borderless: false }}
              style={styles.groupsCardWrap}
              accessibilityRole="button"
              accessibilityLabel={`Groups${groupCount > 0 ? `, ${groupCount}` : ""}`}
            >
              <LinearGradient
                colors={["#075985", "#0EA5E9", "#38BDF8"] as [string, string, string]}
                style={styles.groupsCard}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
              >
                <View style={styles.groupsLeft}>
                  <View style={styles.groupsIconWrap}>
                    <Feather name="users" size={20} color="#0369A1" />
            </View>
                  <View style={styles.groupsTextBlock}>
                    <Text style={styles.groupsTitle}>Groups</Text>
                    <Text style={styles.groupsSub} numberOfLines={2}>
                      Create or join groups with friends, family and coworkers to compete together every day.
                    </Text>
                    <View style={styles.groupsTagRow}>
                      <View style={styles.groupsTag}><Text style={styles.groupsTagText}>Friends</Text></View>
                      <View style={styles.groupsTag}><Text style={styles.groupsTagText}>Family</Text></View>
                      <View style={styles.groupsTag}><Text style={styles.groupsTagText}>Office</Text></View>
            </View>
                  </View>
                </View>

                <Animated.View style={[styles.groupsCta, { transform: [{ scale: groupsExploreScale }] }]}>
                  <View style={styles.groupsCtaBtn}>
                    <Text style={styles.groupsCtaText}>Explore</Text>
                  </View>
                </Animated.View>
              </LinearGradient>
              {groupCount > 0 ? (
                <View style={styles.groupsInviteBadge}>
                  <Text style={styles.groupsInviteBadgeText}>
                    {groupCount > 99 ? "99+" : groupCount}
                  </Text>
                </View>
              ) : null}
            </Pressable>
          </Animated.View>
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
                <CashChallengePaymentBreakdown
                  quote={setupPaymentQuote}
                  entryFeeDollars={setupModal?.fee ?? null}
                  colors={colors}
                  title="Payment Summary"
                />
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
                colors={(setupModal?.gradients ?? [colors.primary, colors.accent]) as [string, string, ...string[]]}
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
                <Text style={[styles.detailValue, { color: colors.foreground }]}>
                  {confirmEntry
                    ? (confirmEntry.feeEditable
                        ? formatUsdFixedCashChallengeLabel(confirmEntry.fee)
                        : confirmEntry.label)
                    : ""}
                </Text>
              </View>
              <View style={[styles.detailDivider, { backgroundColor: colors.border }]} />
              <View style={styles.detailRow}>
                <Text style={[styles.detailLabel, { color: colors.mutedForeground }]}>Entry Fee</Text>
                <Text style={[styles.detailValue, { color: colors.accent }]}>
                  ${clampUsdFixedEntryDollars(confirmEntry?.fee ?? 3).toFixed(2)}
                </Text>
              </View>
              {/* Host flow: allow $3–$25 entry selection. Join flow keeps room fee fixed. */}
              {confirmEntry?.feeEditable && confirmEntry.fee > 0 ? (
                <View style={{ marginTop: 12, marginBottom: 4 }}>
                  <PremiumStepSlider
                    label="Entry Fee"
                    values={USD_FIXED_ENTRY_DOLLARS}
                    selectedValue={clampUsdFixedEntryDollars(confirmEntry.fee)}
                    onValueChange={(v) => {
                      const dollars = clampUsdFixedEntryDollars(v);
                      setConfirmEntry((prev) =>
                        prev
                          ? {
                              ...prev,
                              fee: dollars,
                              label: formatUsdFixedCashChallengeLabel(dollars),
                            }
                          : prev,
                      );
                    }}
                    formatValue={(v) => `$${v}`}
                    minLabel="$3"
                    maxLabel="$25"
                    accessibilityLabel="Cash challenge entry fee"
                    accent={colors.primary}
                    labelColor={colors.foreground}
                    helperColor={colors.mutedForeground}
                    surfaceColor={colors.card}
                    borderColor={colors.border}
                    trackGradient={[colors.primary, colors.accent] as [string, string]}
                  />
                </View>
              ) : null}
              <CashChallengePaymentBreakdown
                quote={confirmPaymentQuote}
                loading={confirmPaymentQuoteLoading}
                entryFeeDollars={clampUsdFixedEntryDollars(confirmEntry?.fee ?? 3)}
                error={confirmPaymentQuoteError}
                onRetry={() => setConfirmQuoteRetryNonce((n) => n + 1)}
                colors={colors}
                title="Payment Summary"
              />
              <View style={[styles.detailDivider, { backgroundColor: colors.border }]} />
              <View style={styles.detailRow}>
                <Text style={[styles.detailLabel, { color: colors.mutedForeground }]}>Type</Text>
                <Text style={[styles.detailValue, { color: colors.foreground }]}>Skill-based race</Text>
              </View>
            </View>

            {/* Compliance checkboxes */}
            <Text style={[styles.modalSectionLabel, { color: colors.mutedForeground }]}>Please confirm all of the following:</Text>

            {[
              "I understand that the challenge cannot be cancelled after creation.",
              "I understand that leaving before the challenge starts may qualify for an entry-fee refund according to the refund policy. Leaving at or after the challenge start time provides no refund and removes me from prize eligibility.",
              "I understand that if I leave, the challenge will continue for other participants. I have read and agree to the Walk Champ Challenge Rules & Terms of Service.",
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
                colors={(confirmEntry?.gradients ?? [colors.primary, colors.accent]) as [string, string, ...string[]]}
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

      {/* ── Create Challenge Modal (guided multi-step flow) ── */}
      <Modal
        visible={challengeModal}
        animationType={challengeModalAnimated ? "slide" : "none"}
        presentationStyle="pageSheet"
        transparent={false}
        onDismiss={() => {
          setChallengeModalAnimated(true);
        }}
      >
        <CreateChallengeFlow
          colors={colors}
          walletBalance={walletBalance}
          themes={themes}
          creating={challengeCreating || !challengeModalAnimated}
          onClose={() => {
            setChallengeModalAnimated(false);
            setChallengeModal(false);
          }}
          onCreate={(args) => {
            void submitCreateChallenge(args);
          }}
        />
      </Modal>

      {/* Profile Modal */}
      <ProfileModal
        visible={showProfile}
        animationType={profileModalAnimated ? "slide" : "none"}
        onClose={() => {
          setShowProfile(false);
          setProfileModalAnimated(true);
        }}
        onNavigate={navigateFromProfile}
        user={user}
        totalEarned={totalEarned}
        walletCurrency={walletCurrency}
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
            router.push({ pathname: "/race/live-detail", params: liveRaceNavParams(info.raceId, user?.id) });
          } else {
            setActiveRace(info.raceId, true);
            joinRace(entryKeyToFee(info.entryKey), 10, true);
            navToMatchmaking({ raceId: info.raceId!, isHost: true });
          }
        }}
      />

      <JoinWithCodeModal
        visible={joinWithCodeVisible}
        onClose={() => setJoinWithCodeVisible(false)}
        onJoined={(result: JoinWithCodeResult) => {
          setJoinWithCodeVisible(false);
          setChallengeModalAnimated(false);
          setChallengeModal(false);
          setActiveRace(result.room_id, false);
          joinRace(result.entry_fee, result.max_players, false);
          pendingDismissRaceCoverModalsRef.current = true;
          router.push({
            pathname: "/race/matchmaking",
            params: buildMatchmakingParams({
              raceId: result.room_id,
              isHost: false,
              user,
              participants: result.participants,
              initialCurrentPlayers: result.participants?.length,
            }),
          });
        }}
      />

      <CoinsBattleModal
        visible={coinsBattleVisible}
        onClose={() => setCoinsBattleVisible(false)}
        onCreated={(raceId, isHost) => {
          setCoinsBattleVisible(false);
          dispatch(fetchCoinBalance());
          navToMatchmaking({ raceId, isHost });
        }}
      />

      {/* ── Scheduled Room Success Modal ── */}
      {scheduledRoomResult && !scheduledRoomResult.modalDismissed && (() => {
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
            onRequestClose={() => {
              setScheduledRoomResult((prev) =>
                prev ? { ...prev, modalDismissed: true } : null,
              );
            }}
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
                  onPress={() => {
                    // Hide modal but keep Next Race seed until upcoming fetch covers it.
                    setScheduledRoomResult((prev) =>
                      prev ? { ...prev, modalDismissed: true } : null,
                    );
                  }}
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
  stepsHeroText: { flex: 1, alignItems: "flex-start", justifyContent: "center", minHeight: rs(64), overflow: "visible", paddingVertical: 2 },
  stepsHeroValue: { fontSize: rf(44), fontWeight: "800", letterSpacing: -2, fontVariant: ["tabular-nums"], lineHeight: rf(56) },
  stepsHeroLabel: { fontSize: rf(13), lineHeight: rf(18), marginTop: 2 },
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
  nextRacePagination: {
    minHeight: rs(18),
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: rs(6),
    paddingTop: rs(8),
  },
  nextRaceDot: {
    width: rs(6),
    height: rs(6),
    borderRadius: rs(3),
    backgroundColor: "rgba(148,163,184,0.35)",
  },
  nextRaceDotActive: {
    width: rs(18),
    backgroundColor: "#FACC15",
  },
  roomsBtn: {
    borderRadius: 10,
    overflow: "hidden",
    shadowColor: "#F43F5E",
    shadowOpacity: 0.35,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  roomsBtnGradient: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingVertical: rs(4),
    paddingHorizontal: rs(9),
  },
  roomsBtnText: { fontSize: rf(11.5), fontWeight: "800", color: "#FFFFFF", letterSpacing: 0.15 },
  viewAllLiveWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  viewAllBlinkDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  viewAllCountCircle: {
    minWidth: rs(18),
    height: rs(18),
    borderRadius: rs(9),
    paddingHorizontal: rs(4),
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FFFFFF",
    borderWidth: 0,
  },
  viewAllCountText: {
    color: "#BE123C",
    fontSize: rf(10),
    fontWeight: "900",
    lineHeight: rf(12),
    includeFontPadding: false,
    textAlign: "center",
  },
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
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#6C00FF",
    borderRadius: 6,
    paddingHorizontal: 5,
    paddingVertical: 1,
    gap: 3,
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
  // Communities / Groups card — sky azure social identity (not Sponsored purple / not teal)
  communitiesSectionSub: {
    fontSize: rf(12),
    fontWeight: "500",
    lineHeight: rf(16),
    marginBottom: 8,
  },
  groupsCardWrap: {
    marginBottom: 10,
    borderRadius: 18,
    overflow: "hidden",
    position: "relative",
    shadowColor: "#0369A1",
    shadowOpacity: 0.2,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
    elevation: 3,
  },
  groupsCard: {
    borderRadius: 18,
    padding: rs(14),
    flexDirection: "row",
    alignItems: "center",
    overflow: "hidden",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.28)",
    gap: 10,
  },
  groupsLeft: { flex: 1, flexDirection: "row", alignItems: "center", gap: 12 },
  groupsIconWrap: {
    width: rs(44),
    height: rs(44),
    borderRadius: rs(22),
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(186,230,253,0.95)",
    flexShrink: 0,
  },
  groupsTextBlock: { flex: 1, minWidth: 0 },
  groupsTitle: { color: "#FFF", fontSize: rf(16), fontWeight: "800", marginBottom: 2 },
  groupsSub: { color: "rgba(255,255,255,0.9)", fontSize: rf(11), lineHeight: rf(15), marginBottom: 6 },
  groupsTagRow: { flexDirection: "row", flexWrap: "wrap", gap: 5 },
  groupsTag: {
    backgroundColor: "rgba(255,255,255,0.18)",
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 999,
  },
  groupsTagText: { color: "#FFF", fontSize: rf(9), fontWeight: "700" },
  groupsCta: { marginLeft: 4, flexShrink: 0 },
  groupsCtaBtn: {
    backgroundColor: "#FFF",
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#0369A1",
    shadowOpacity: 0.22,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  groupsCtaText: { color: "#0369A1", fontWeight: "800", fontSize: rf(12) },
  groupsInviteBadge: {
    position: "absolute",
    top: -6,
    right: -6,
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: "#0369A1",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 5,
    borderWidth: 2,
    borderColor: "#7DD3FC",
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
