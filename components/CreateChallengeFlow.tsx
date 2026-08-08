/**
 * Guided multi-step Create Challenge flow — premium UI.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  AppState,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import DateTimePicker, { type DateTimePickerEvent } from "@react-native-community/datetimepicker";
import { Feather } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { SafeAreaView } from "react-native-safe-area-context";
import Animated, {
  FadeInLeft,
  FadeInRight,
  FadeOutLeft,
  FadeOutRight,
} from "react-native-reanimated";
import { TouchableOpacity } from "@/components/HapticTouchableOpacity";
import CoinIcon from "@/components/CoinIcon";
import StartTimePickerModal, {
  getNextPresetIndexForNow,
  resolveInitialPresetIndex,
} from "@/components/StartTimePickerModal";
import { UnlimitedGoalFeeBreakdown } from "@/components/UnlimitedGoalFeeBreakdown";
import { CreateChallengeCheckoutStep } from "@/components/CreateChallengeCheckoutStep";
import {
  CashChallengePaymentBreakdown,
} from "@/components/CashChallengePaymentBreakdown";
import { PremiumStepSlider } from "@/components/PremiumStepSlider";
import { fetchCashChallengePaymentQuote, type CashChallengePaymentQuote } from "@/services/cashChallengeApi";
import { previewUnlimitedGoalPaymentQuote, type UnlimitedGoalPaymentQuote } from "@/services/unlimitedGoalApi";
import { ENABLE_CASH_CHALLENGES, isUnlimitedGoalFrontendEnabled } from "@/config/featureFlags";
import { trackEvent } from "@/services/analytics";
import {
  TRACK_LAYOUT_OPTIONS,
  FREE_TRACK_CODES,
} from "@/constants/trackLayouts";
import { getDeviceTimezone } from "@/utils/timezone";
import { rf, rs } from "@/utils/responsive";
import * as Haptics from "@/utils/haptics";
import {
  COINS_ENTRY_AMOUNTS,
  TIME_PRESETS_FUTURE,
  TIME_PRESETS_WITH_NOW,
  USD_FIXED_ENTRY_DOLLARS,
  buildHostPayload,
  canContinueStep,
  clampUsdFixedEntryDollars,
  createDefaultDraft,
  durationDaysFromGoalType,
  footerPrimaryLabel,
  getStepBlockReason,
  isSameDay,
  resolveChallengeFormat,
  toLocalCalendarDate,
  pickerDateToLocalCalendarDay,
  localTomorrowCalendarDate,
  ensureUnlimitedMidnightSchedule,
  getUnlimitedMidnightTimeIdx,
  usdFixedEntryDollarsToCents,
  type CreateChallengeDraft,
  type CreateStep,
  type EntryTypeUi,
  type HostPayloadMeta,
} from "@/utils/createChallengeFlow";
import {
  UNLIMITED_GOAL_DURATION_DAYS,
  UNLIMITED_GOAL_ENTRY_AMOUNT_DOLLARS,
  UNLIMITED_GOAL_PLATFORM_FEE_CENTS,
  formatDurationDaysLabel,
  getUnlimitedDailyGoalStepOptions,
} from "@/utils/unlimitedGoal";
import {
  formatStepLabel,
  formatStepShortLabel,
  getDefaultTargetSteps,
  getTargetStepOptions,
  type TargetStepDuration,
} from "@/utils/targetSteps";
import { formatPlayerLabel, getPlayerOptions } from "@/utils/players";
import {
  applyAutoNowMode,
  CREATE_CHALLENGE_AUTO_NOW_CLOCK_MS,
  CREATE_CHALLENGE_CLOCK_INTERVAL_MS,
  selectEffectiveChallengeSchedule,
} from "@/utils/createChallengeSchedule";
import { CREATE_CHALLENGE_TOTAL_STEPS, ROOM_CARD_RADIUS, adaptCreateChallengeAccentForTheme, getCreateChallengeChrome, selectCreateChallengeAccentTheme, type CreateChallengeAccentTheme, type CreateChallengeChrome } from "@/constants/createChallengeTheme";
import { useTheme } from "@/context/ThemeContext";

type ThemeLike = { code: string; owned?: boolean };
type Colors = ReturnType<typeof import("@/hooks/useColors").useColors>;

type Props = {
  colors: Colors;
  walletBalance: number;
  themes: ThemeLike[];
  creating: boolean;
  onClose: () => void;
  onCreate: (args: {
    body: Record<string, unknown>;
    meta: HostPayloadMeta;
    draft: CreateChallengeDraft;
  }) => void | Promise<void>;
};

function StepProgress({
  step,
  roomTheme,
  chrome,
}: {
  step: CreateStep;
  roomTheme: CreateChallengeAccentTheme;
  chrome: CreateChallengeChrome;
}) {
  const steps = [1, 2, 3, 4, 5] as CreateStep[];
  return (
    <View
      style={styles.progressBlock}
      accessibilityLabel={`Step ${step} of ${CREATE_CHALLENGE_TOTAL_STEPS}`}
    >
      <View style={styles.dotsCentered}>
        {steps.map((s, i) => {
          const done = s < step;
          const current = s === step;
          const active = s <= step;
          return (
            <React.Fragment key={s}>
              {i > 0 ? (
                active ? (
                  <LinearGradient
                    colors={[...roomTheme.gradient]}
                    start={{ x: 0, y: 0.5 }}
                    end={{ x: 1, y: 0.5 }}
                    style={styles.dotLine}
                  />
                ) : (
                  <View style={[styles.dotLine, { backgroundColor: chrome.connectorInactive }]} />
                )
              ) : null}
              <View
                style={[
                  styles.dot,
                  {
                    backgroundColor: done
                      ? roomTheme.progressDone
                      : current
                        ? roomTheme.progressCurrent
                        : "transparent",
                    borderColor: active
                      ? current
                        ? roomTheme.progressCurrent
                        : roomTheme.progressDone
                      : chrome.progressUpcoming,
                    shadowColor: roomTheme.secondary,
                    shadowOpacity: current ? 0.45 : 0,
                    shadowRadius: 5,
                    elevation: current ? 3 : 0,
                  },
                ]}
                accessibilityLabel={
                  current
                    ? `Current step ${s}`
                    : done
                      ? `Completed step ${s}`
                      : `Upcoming step ${s}`
                }
              />
            </React.Fragment>
          );
        })}
      </View>
      <Text style={[styles.stepCount, { color: chrome.textSecondary }]}>
        Step {step} of {CREATE_CHALLENGE_TOTAL_STEPS}
      </Text>
    </View>
  );
}

const CHALLENGE_TYPE_PILLS = {
  unlimited: ["Unlimited Players", "Daily Goal", "Equal Prize Split"] as const,
  fixed: ["2–10 Players", "Up to 3 Winners"] as const,
};

export function CreateChallengeFlow({
  colors,
  walletBalance,
  themes,
  creating,
  onClose,
  onCreate,
}: Props) {
  const { width: winW } = useWindowDimensions();
  const narrow = winW < 360;
  const [step, setStep] = useState<CreateStep>(1);
  const [dir, setDir] = useState<"forward" | "back">("forward");
  const [draft, setDraft] = useState<CreateChallengeDraft>(() => createDefaultDraft("bg"));
  const [showStartDatePicker, setShowStartDatePicker] = useState(false);
  const [showStartTimePicker, setShowStartTimePicker] = useState(false);
  const [cashQuote, setCashQuote] = useState<CashChallengePaymentQuote | null>(null);
  const [cashQuoteLoading, setCashQuoteLoading] = useState(false);
  const [unlimitedQuote, setUnlimitedQuote] = useState<UnlimitedGoalPaymentQuote | null>(null);
  /** Shared Create Challenge clock — drives auto_now Start/End on Steps 4–5. */
  const [deviceNow, setDeviceNow] = useState(() => new Date());
  const cashQuoteSeqRef = useRef(0);

  const { isDark } = useTheme();
  const chrome = useMemo(
    () => getCreateChallengeChrome(colors, isDark),
    [colors, isDark],
  );
  const roomTheme = useMemo(
    () =>
      adaptCreateChallengeAccentForTheme(
        selectCreateChallengeAccentTheme(draft.visibility),
        isDark,
      ),
    [draft.visibility, isDark],
  );
  const accent = roomTheme.primary;
  const format = resolveChallengeFormat(draft);
  const isUnlimited = format === "unlimited_goal";
  const unlimitedEnabled = isUnlimitedGoalFrontendEnabled();
  const timezone = getDeviceTimezone();
  const dailyGoalOptions = useMemo(() => getUnlimitedDailyGoalStepOptions(), []);

  const tickClock = useCallback(() => {
    setDeviceNow(new Date());
  }, []);

  const durationDays = isUnlimited
    ? draft.unlimited.durationDays
    : durationDaysFromGoalType(draft.fixed.goalType);

  // AppState-aware clock — 1s on Steps 4–5 while auto_now so Start/End stay minute-accurate.
  // Pause while system date/time pickers are open — Android DateTimePicker re-opens on
  // every parent re-render (onChange identity / value tick) and snaps back to today.
  useEffect(() => {
    tickClock();
    let interval: ReturnType<typeof setInterval> | null = null;
    const pickerOpen = showStartDatePicker || showStartTimePicker;
    const autoNowFast =
      !pickerOpen &&
      (step === 4 || step === 5) &&
      (draft.startMode ?? "auto_now") === "auto_now";
    const period = autoNowFast
      ? CREATE_CHALLENGE_AUTO_NOW_CLOCK_MS
      : CREATE_CHALLENGE_CLOCK_INTERVAL_MS;
    const startInterval = () => {
      if (interval || pickerOpen) return;
      interval = setInterval(tickClock, period);
    };
    const stopInterval = () => {
      if (!interval) return;
      clearInterval(interval);
      interval = null;
    };
    if (AppState.currentState === "active" && !pickerOpen) startInterval();
    const sub = AppState.addEventListener("change", (next) => {
      if (next === "active" && !pickerOpen) {
        tickClock();
        startInterval();
      } else {
        stopInterval();
      }
    });
    return () => {
      stopInterval();
      sub.remove();
    };
  }, [tickClock, step, draft.startMode, showStartDatePicker, showStartTimePicker]);

  // Refresh clock when entering schedule/review or when duration changes.
  useEffect(() => {
    if (step === 4 || step === 5) tickClock();
  }, [step, durationDays, tickClock]);

  // If Unlimited is disabled, fall back Fixed so Step 2 never looks empty.
  useEffect(() => {
    if (!unlimitedEnabled && draft.usdFormat === "unlimited_goal") {
      setDraft((prev) => ({ ...prev, usdFormat: "fixed" }));
    }
  }, [unlimitedEnabled, draft.usdFormat]);

  const liveSchedule = useMemo(
    () =>
      selectEffectiveChallengeSchedule({
        draft,
        durationDays,
        timezone,
        deviceNow,
        isUnlimited,
      }),
    [draft, durationDays, timezone, deviceNow, isUnlimited],
  );

  const patch = useCallback((partial: Partial<CreateChallengeDraft>) => {
    setDraft((prev) => ({ ...prev, ...partial }));
  }, []);

  const patchFixed = useCallback((partial: Partial<CreateChallengeDraft["fixed"]>) => {
    setDraft((prev) => ({ ...prev, fixed: { ...prev.fixed, ...partial } }));
  }, []);

  const patchUnlimited = useCallback((partial: Partial<CreateChallengeDraft["unlimited"]>) => {
    setDraft((prev) => ({ ...prev, unlimited: { ...prev.unlimited, ...partial } }));
  }, []);

  useEffect(() => {
    if (draft.entryType !== "usd" || isUnlimited || !ENABLE_CASH_CHALLENGES) {
      setCashQuote(null);
      setCashQuoteLoading(false);
      return;
    }
    const entryFeeCents = usdFixedEntryDollarsToCents(draft.fixed.usdAmountDollars);
    const numberOfPlayers = draft.fixed.maxPlayers;
    let cancelled = false;
    const seq = ++cashQuoteSeqRef.current;
    setCashQuoteLoading(true);
    const timer = setTimeout(() => {
      void fetchCashChallengePaymentQuote({ entryFeeCents, numberOfPlayers })
        .then((q) => {
          if (cancelled || seq !== cashQuoteSeqRef.current) return;
          setCashQuote(q);
          setCashQuoteLoading(false);
        })
        .catch(() => {
          if (cancelled || seq !== cashQuoteSeqRef.current) return;
          setCashQuote(null);
          setCashQuoteLoading(false);
        });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [draft.entryType, draft.fixed.usdAmountDollars, draft.fixed.maxPlayers, isUnlimited]);

  useEffect(() => {
    if (!isUnlimited || !unlimitedEnabled) {
      setUnlimitedQuote(null);
      return;
    }
    setUnlimitedQuote(
      previewUnlimitedGoalPaymentQuote({
        entryFeeCents: draft.unlimited.entryDollars * 100,
      }),
    );
  }, [isUnlimited, unlimitedEnabled, draft.unlimited.entryDollars]);

  useEffect(() => {
    if (isUnlimited) return;
    if (!getTargetStepOptions(draft.fixed.goalType).includes(draft.fixed.targetSteps)) {
      patchFixed({ targetSteps: getDefaultTargetSteps(draft.fixed.goalType) });
    }
  }, [draft.fixed.goalType, draft.fixed.targetSteps, isUnlimited, patchFixed]);

  const setEntryType = (entryType: EntryTypeUi) => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setDraft((prev) => {
      const nextUsdFormat =
        entryType === "usd"
          ? unlimitedEnabled
            ? "unlimited_goal"
            : "fixed"
          : "fixed";
      const next: CreateChallengeDraft = {
        ...prev,
        entryType,
        usdFormat: nextUsdFormat,
        rulesAccepted: false,
        unlimitedRulesAccepted: false,
      };
      if (nextUsdFormat === "unlimited_goal") {
        return ensureUnlimitedMidnightSchedule(next, new Date());
      }
      return next;
    });
  };

  const goNext = () => {
    if (step >= CREATE_CHALLENGE_TOTAL_STEPS) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    tickClock();
    setDir("forward");
    setStep((s) => (s + 1) as CreateStep);
  };
  const goBack = () => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (step > 1) {
      setDir("back");
      setStep((s) => (s - 1) as CreateStep);
    } else {
      onClose();
    }
  };

  useEffect(() => {
    const events = {
      1: "create_challenge_step_1_viewed",
      2: "create_challenge_step_2_viewed",
      3: "create_challenge_step_3_viewed",
      4: "create_challenge_step_4_viewed",
      5: "create_challenge_step_5_viewed",
    } as const;
    trackEvent(events[step]);
    if (step === 5) trackEvent("challenge_review_opened");
  }, [step]);

  useEffect(() => {
    if (__DEV__ && (step === 4 || step === 5)) {
      const reason = getStepBlockReason(step, draft, deviceNow);
      if (reason) {
        console.debug("[CreateChallenge] step blocked:", reason);
        if (step === 4) trackEvent("challenge_review_blocked", { reason });
      }
    }
  }, [step, draft, deviceNow]);

  const handleCreate = () => {
    if (creating) return;
    tickClock();
    const now = new Date();
    setDeviceNow(now);
    const built = buildHostPayload(draft, timezone, now);
    if (!built.ok) return;
    void onCreate({ body: built.body, meta: built.meta, draft });
  };

  const continueEnabled = canContinueStep(step, draft, deviceNow) && !creating;
  const reviewBuilt = buildHostPayload(draft, timezone, deviceNow);
  const createEnabled =
    step === 5 &&
    reviewBuilt.ok &&
    !creating &&
    (reviewBuilt.meta.isFree ||
      reviewBuilt.meta.isCoins ||
      (reviewBuilt.meta.isUsd &&
        walletBalance >=
          (reviewBuilt.meta.isUnlimited
            ? (unlimitedQuote?.totalChargeCents ?? reviewBuilt.meta.totalChargeCents) / 100
            : (cashQuote?.totalPayable ?? reviewBuilt.meta.totalChargeCents / 100))));

  const primaryLabel = footerPrimaryLabel(
    step,
    draft,
    isUnlimited
      ? unlimitedQuote?.totalChargeCents
      : cashQuote
        ? Math.round(cashQuote.totalPayable * 100)
        : undefined,
  );

  const onPrimary = () => {
    if (step < 5) {
      goNext();
    } else {
      handleCreate();
    }
  };

  const startDateLabel = liveSchedule.startDisplayDate;
  const startTimeLabel = liveSchedule.startDisplayTime;

  const ownedLayouts = TRACK_LAYOUT_OPTIONS.filter((layout) => {
    const themeData = themes.find((t) => t.code === layout.id);
    return themeData?.owned ?? FREE_TRACK_CODES.has(layout.id);
  });

  const applyStartDate = useCallback((raw: Date) => {
    const now = new Date();
    const today = toLocalCalendarDate(now);
    let next = pickerDateToLocalCalendarDay(raw);
    setDraft((prev) => {
      const unlimited =
        prev.entryType === "usd" &&
        prev.usdFormat === "unlimited_goal" &&
        isUnlimitedGoalFrontendEnabled();

      if (unlimited) {
        const tomorrow = localTomorrowCalendarDate(now);
        if (next.getTime() < tomorrow.getTime()) next = tomorrow;
        return {
          ...prev,
          startDate: next,
          startTimeIdx: getUnlimitedMidnightTimeIdx(),
          startMode: "user_selected",
        };
      }

      if (next.getTime() < today.getTime()) next = today;
      let timeIdx = prev.startTimeIdx;
      let startMode = prev.startMode ?? "auto_now";
      if (!isSameDay(next, now)) {
        if (TIME_PRESETS_WITH_NOW[timeIdx]?.isNow) {
          timeIdx = getNextPresetIndexForNow(TIME_PRESETS_WITH_NOW, now);
        }
        startMode = "user_selected";
      } else if (TIME_PRESETS_WITH_NOW[timeIdx]?.isNow) {
        startMode = "auto_now";
        timeIdx = 0;
      } else {
        startMode = "user_selected";
      }
      return { ...prev, startDate: next, startTimeIdx: timeIdx, startMode };
    });
    tickClock();
  }, [tickClock]);

  const onStartDatePickerChange = useCallback(
    (event: DateTimePickerEvent, date?: Date) => {
      if (Platform.OS === "android") {
        setShowStartDatePicker(false);
        if (event.type === "dismissed") return;
        const ts = event.nativeEvent?.timestamp;
        const picked =
          date ?? (typeof ts === "number" && Number.isFinite(ts) ? new Date(ts) : undefined);
        if (picked) applyStartDate(picked);
        return;
      }
      if (date) applyStartDate(date);
    },
    [applyStartDate],
  );

  const restoreAutoNow = () => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setDraft((prev) => applyAutoNowMode(prev, new Date()));
    tickClock();
  };

  const entering = dir === "forward" ? FadeInLeft.duration(240) : FadeInRight.duration(240);
  const exiting = dir === "forward" ? FadeOutLeft.duration(180) : FadeOutRight.duration(180);

  const roomSeg = (side: "public" | "private") => {
    const selected = draft.visibility === side;
    const theme = adaptCreateChallengeAccentForTheme(
      selectCreateChallengeAccentTheme(side),
      isDark,
    );
    return (
      <TouchableOpacity
        key={side}
        accessibilityRole="button"
        accessibilityState={{ selected }}
        accessibilityLabel={
          selected
            ? `${side === "public" ? "Public Room" : "Private Room"}, selected`
            : `${side === "public" ? "Public Room" : "Private Room"}, not selected`
        }
        onPress={() => {
          void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          patch({ visibility: side });
        }}
        activeOpacity={0.9}
        style={[
          styles.roomSegPressable,
          selected && { transform: [{ scale: 1.01 }] },
        ]}
      >
        <View
          style={[
            styles.roomCardShell,
            {
              borderColor: selected ? theme.border : chrome.border,
              shadowColor: selected ? theme.secondary : "transparent",
              shadowOpacity: selected ? 0.18 : 0,
              shadowRadius: selected ? 8 : 0,
              elevation: selected ? 3 : 0,
            },
          ]}
        >
          {selected ? (
            <LinearGradient
              colors={[...theme.gradientSelected]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={StyleSheet.absoluteFillObject}
            />
          ) : (
            <View
              style={[
                StyleSheet.absoluteFillObject,
                styles.roomCardUnselectedBg,
                { backgroundColor: chrome.cardUnselected },
              ]}
            />
          )}

          <View
            style={[
              styles.roomCardContent,
              !selected && { opacity: chrome.unselectedContentOpacity },
            ]}
          >
            <View
              style={[
                styles.roomIcon,
                {
                  backgroundColor: selected
                    ? theme.iconBackground
                    : chrome.surfaceSubtle,
                },
              ]}
            >
              <Feather
                name={side === "public" ? "globe" : "lock"}
                size={16}
                color={selected ? theme.iconColor : chrome.textMuted}
              />
            </View>
            <Text
              style={{
                fontSize: rf(13),
                fontWeight: "800",
                color: selected ? chrome.text : chrome.unselectedTitle,
              }}
            >
              {side === "public" ? "Public Room" : "Private Room"}
            </Text>
            <Text
              style={{
                fontSize: rf(10),
                color: selected ? chrome.textSecondary : chrome.unselectedDesc,
                marginTop: 2,
                lineHeight: 13,
              }}
            >
              {side === "public"
                ? "Eligible players can discover and join."
                : "Only invited players can join."}
            </Text>
          </View>

          {selected ? (
            <View
              style={[styles.checkAbs, { backgroundColor: theme.checkBg }]}
              pointerEvents="none"
            >
              <Feather name="check" size={10} color={theme.checkIcon} />
            </View>
          ) : null}
        </View>
      </TouchableOpacity>
    );
  };

  type EntryOption = {
    mode: EntryTypeUi;
    label: string;
    badge: string;
    icon?: React.ComponentProps<typeof Feather>["name"];
    coin?: boolean;
    enabled: boolean;
  };
  const entryOptions: EntryOption[] = (
    [
      { mode: "usd", label: "USD", badge: "Cash entry", icon: "dollar-sign", enabled: ENABLE_CASH_CHALLENGES },
      { mode: "coins", label: "Coins", badge: "Coin entry", coin: true, enabled: true },
      { mode: "free", label: "Free", badge: "No entry fee", icon: "gift", enabled: true },
    ] satisfies EntryOption[]
  ).filter((o) => o.enabled);

  const unlimitedSelected = draft.usdFormat === "unlimited_goal";
  const fixedSelected = draft.usdFormat === "fixed";

  return (
    <SafeAreaView edges={["top", "left", "right", "bottom"]} style={[styles.wrap, { backgroundColor: chrome.bg }]}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={goBack}
          accessibilityLabel={step === 1 ? "Close create challenge" : "Back"}
          style={[styles.iconBtn, { backgroundColor: chrome.headerBtn, borderColor: chrome.borderBtn }]}
        >
          <Feather name="arrow-left" size={18} color={chrome.textSecondary} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={[styles.title, { color: chrome.text }]}>Create Challenge</Text>
          <Text style={[styles.subtitle, { color: chrome.textSubtitle }]}>
            Set the rules, invite players, and start walking.
          </Text>
        </View>
        <TouchableOpacity
          onPress={onClose}
          accessibilityLabel="Close"
          style={[styles.iconBtn, { backgroundColor: chrome.headerBtn, borderColor: chrome.borderBtn }]}
        >
          <Feather name="x" size={18} color={chrome.textSecondary} />
        </TouchableOpacity>
      </View>

      <StepProgress step={step} roomTheme={roomTheme} chrome={chrome} />

      <ScrollView
        contentContainerStyle={styles.body}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <Animated.View key={`step-${step}`} entering={entering} exiting={exiting}>
          {/* ── STEP 1 ── */}
          {step === 1 && (
            <>
              <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>Who can join?</Text>
              <View style={[styles.roomRow, narrow && { flexDirection: "column" }]}>
                {roomSeg("public")}
                {roomSeg("private")}
              </View>

              <Text style={[styles.sectionLabel, { color: colors.mutedForeground, marginTop: 14 }]}>
                Choose an entry type
              </Text>
              <View style={styles.entryRow}>
                {entryOptions.map((opt) => {
                  const selected = draft.entryType === opt.mode;
                  return (
                    <TouchableOpacity
                      key={opt.mode}
                      accessibilityRole="button"
                      accessibilityState={{ selected }}
                      accessibilityLabel={`${opt.label}, ${opt.badge}`}
                      onPress={() => setEntryType(opt.mode)}
                      style={[
                        styles.entrySeg,
                        {
                          borderColor: selected ? roomTheme.border : chrome.border,
                          backgroundColor: selected ? roomTheme.softBackground : chrome.surfaceSubtle,
                        },
                      ]}
                    >
                      {opt.coin ? (
                        <CoinIcon size="small" />
                      ) : (
                        <Feather
                          name={opt.icon!}
                          size={16}
                          color={selected ? roomTheme.iconColor : colors.mutedForeground}
                        />
                      )}
                      <Text
                        style={{
                          fontSize: rf(13),
                          fontWeight: "800",
                          color: selected ? roomTheme.valueText : colors.foreground,
                          marginTop: 6,
                        }}
                      >
                        {opt.label}
                      </Text>
                      <Text
                        style={{
                          fontSize: rf(9),
                          fontWeight: "600",
                          color: colors.mutedForeground,
                          marginTop: 2,
                        }}
                        numberOfLines={1}
                      >
                        {opt.badge}
                      </Text>
                      {selected ? (
                        <View style={[styles.checkAbs, { backgroundColor: roomTheme.checkBg }]}>
                          <Feather name="check" size={10} color={roomTheme.checkIcon} />
                        </View>
                      ) : null}
                    </TouchableOpacity>
                  );
                })}
              </View>
            </>
          )}

          {/* ── STEP 2 — Challenge type only ── */}
          {step === 2 && (
            <View style={styles.stack}>
              {draft.entryType !== "usd" ? (
                <View style={[styles.glassCard, { borderColor: chrome.border, backgroundColor: chrome.card }]}>
                  <Text style={[styles.cardTitle, { color: chrome.text }]}>
                    {draft.entryType === "free" ? "Free Challenge" : "Coins Battle"}
                  </Text>
                  <Text style={[styles.cardHelper, { color: chrome.textSecondary }]}>
                    {draft.entryType === "free"
                      ? "Fixed players format. 2–10 players compete toward a step goal with no entry fee."
                      : "Fixed players format. 2–10 players enter with coins. Top finishers share the prize pool."}
                  </Text>
                  <View style={[styles.badgeRow, { marginTop: 10 }]}>
                    {["Fixed Players", "2–10 Players", "Up to 3 Winners"].map((b) => (
                      <View
                        key={b}
                        style={[
                          styles.miniBadge,
                          { borderColor: roomTheme.pillBorder, backgroundColor: roomTheme.pillBg },
                        ]}
                      >
                        <Text style={{ fontSize: rf(9), fontWeight: "700", color: roomTheme.pillText }}>{b}</Text>
                      </View>
                    ))}
                  </View>
                </View>
              ) : (
                <>
                  <Text style={[styles.sectionLabel, { color: chrome.textSection }]}>
                    Choose a Cash Challenge Type
                  </Text>

                  <View style={styles.typeStack}>
                    {/* Unlimited Players — selected accent follows room theme */}
                    <TouchableOpacity
                      accessibilityRole="button"
                      accessibilityState={{
                        selected: unlimitedSelected,
                        disabled: !unlimitedEnabled,
                      }}
                      accessibilityLabel={
                        unlimitedSelected
                          ? "Daily Goal Challenge, selected"
                          : "Daily Goal Challenge, not selected"
                      }
                      disabled={!unlimitedEnabled}
                      onPress={() => {
                        if (!unlimitedEnabled) return;
                        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                        setDraft((prev) =>
                          ensureUnlimitedMidnightSchedule(
                            { ...prev, usdFormat: "unlimited_goal", rulesAccepted: false },
                            new Date(),
                          ),
                        );
                        trackEvent("cash_challenge_unlimited_selected");
                      }}
                      activeOpacity={0.88}
                      style={!unlimitedEnabled ? { opacity: 0.55 } : undefined}
                    >
                      <LinearGradient
                        colors={
                          unlimitedSelected
                            ? [...roomTheme.gradientBorder]
                            : [chrome.border, chrome.border]
                        }
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 1 }}
                        style={[
                          styles.formatCardOuter,
                          unlimitedSelected && {
                            shadowColor: roomTheme.secondary,
                            shadowOpacity: 0.22,
                            shadowRadius: 10,
                            elevation: 6,
                            transform: [{ scale: 1.01 }],
                          },
                        ]}
                      >
                        <LinearGradient
                          colors={
                            unlimitedSelected
                              ? [...roomTheme.gradientSelected]
                              : [chrome.cardUnselected, chrome.cardUnselected]
                          }
                          start={{ x: 0, y: 0 }}
                          end={{ x: 1, y: 1 }}
                          style={[
                            styles.formatCardInner,
                            !unlimitedSelected && { opacity: chrome.unselectedContentOpacity },
                          ]}
                        >
                          <View style={styles.formatTop}>
                            <LinearGradient
                              colors={[...roomTheme.gradientIcon]}
                              start={{ x: 0, y: 0 }}
                              end={{ x: 1, y: 1 }}
                              style={[
                                styles.formatIconSm,
                                !unlimitedSelected && { opacity: 0.72 },
                              ]}
                            >
                              <Text
                                style={{
                                  fontSize: rf(16),
                                  fontWeight: "800",
                                  color: unlimitedSelected ? "#FFF" : chrome.unselectedTitle,
                                }}
                              >
                                ∞
                              </Text>
                            </LinearGradient>
                            <View style={{ flex: 1, minWidth: 0 }}>
                              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                                <Text
                                  style={[
                                    styles.cardTitleSm,
                                    {
                                      color: unlimitedSelected ? chrome.text : chrome.unselectedTitle,
                                    },
                                  ]}
                                >
                                  Daily Goal Challenge
                                </Text>
                                <View style={styles.newBadge}>
                                  <Text style={styles.newBadgeText}>NEW</Text>
                                </View>
                              </View>
                              <Text
                                style={[
                                  styles.cardHelperSm,
                                  {
                                    color: unlimitedSelected
                                      ? chrome.textSecondary
                                      : "rgba(180,187,208,0.62)",
                                  },
                                ]}
                                numberOfLines={2}
                              >
                                {unlimitedEnabled
                                  ? "No player limit. Complete the daily goal every day to qualify."
                                  : "Unavailable in this build. Choose Fixed Players."}
                              </Text>
                            </View>
                            {unlimitedSelected ? (
                              <View
                                style={[styles.checkCircle, { backgroundColor: roomTheme.checkBg }]}
                              >
                                <Feather name="check" size={12} color={roomTheme.checkIcon} />
                              </View>
                            ) : null}
                          </View>
                          <View
                            style={[
                              styles.badgeRow,
                              { opacity: unlimitedSelected ? 1 : chrome.unselectedPillOpacity },
                            ]}
                          >
                            {CHALLENGE_TYPE_PILLS.unlimited.map((label) => (
                              <View
                                key={label}
                                style={[
                                  styles.miniBadge,
                                  {
                                    borderColor: unlimitedSelected ? roomTheme.pillBorder : chrome.border,
                                    backgroundColor: unlimitedSelected
                                      ? roomTheme.pillBg
                                      : chrome.surfaceSubtle,
                                  },
                                ]}
                              >
                                <Text
                                  style={{
                                    fontSize: rf(9),
                                    fontWeight: "700",
                                    color: unlimitedSelected
                                      ? roomTheme.pillText
                                      : chrome.textMuted,
                                  }}
                                >
                                  {label}
                                </Text>
                              </View>
                            ))}
                          </View>
                        </LinearGradient>
                      </LinearGradient>
                    </TouchableOpacity>

                    {/* Fixed Players — selected accent follows room theme */}
                    <TouchableOpacity
                      accessibilityRole="button"
                      accessibilityState={{ selected: fixedSelected }}
                      accessibilityLabel={
                        fixedSelected
                          ? "24-Hour Sprint, selected"
                          : "24-Hour Sprint, not selected"
                      }
                      onPress={() => {
                        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                        patch({ usdFormat: "fixed", unlimitedRulesAccepted: false });
                        trackEvent("cash_challenge_fixed_selected");
                      }}
                      activeOpacity={0.88}
                    >
                      <LinearGradient
                        colors={
                          fixedSelected
                            ? [...roomTheme.gradientBorder]
                            : [chrome.border, chrome.border]
                        }
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 1 }}
                        style={[
                          styles.formatCardOuter,
                          fixedSelected && {
                            shadowColor: roomTheme.secondary,
                            shadowOpacity: 0.22,
                            shadowRadius: 10,
                            elevation: 6,
                            transform: [{ scale: 1.01 }],
                          },
                        ]}
                      >
                        <LinearGradient
                          colors={
                            fixedSelected
                              ? [...roomTheme.gradientSelected]
                              : [chrome.cardUnselected, chrome.cardUnselected]
                          }
                          start={{ x: 0, y: 0 }}
                          end={{ x: 1, y: 1 }}
                          style={[
                            styles.formatCardInner,
                            !fixedSelected && { opacity: chrome.unselectedContentOpacity },
                          ]}
                        >
                          <View style={styles.formatTop}>
                            <LinearGradient
                              colors={[...roomTheme.gradientIcon]}
                              start={{ x: 0, y: 0 }}
                              end={{ x: 1, y: 1 }}
                              style={[styles.formatIconSm, !fixedSelected && { opacity: 0.72 }]}
                            >
                              <Feather
                                name="clock"
                                size={15}
                                color={fixedSelected ? roomTheme.iconColor : chrome.textMuted}
                              />
                            </LinearGradient>
                            <View style={{ flex: 1, minWidth: 0 }}>
                              <Text
                                style={[
                                  styles.cardTitleSm,
                                  {
                                    color: fixedSelected ? chrome.text : chrome.unselectedTitle,
                                  },
                                ]}
                              >
                                ⚡ 24-Hour Sprint
                              </Text>
                              <Text
                                style={[
                                  styles.cardHelperSm,
                                  {
                                    color: fixedSelected
                                      ? chrome.textSecondary
                                      : "rgba(180,187,208,0.62)",
                                  },
                                ]}
                                numberOfLines={2}
                              >
                                Choose 2–10 players. Top finishers share the prize pool.
                              </Text>
                            </View>
                            {fixedSelected ? (
                              <View
                                style={[styles.checkCircle, { backgroundColor: roomTheme.checkBg }]}
                              >
                                <Feather name="check" size={12} color={roomTheme.checkIcon} />
                              </View>
                            ) : null}
                          </View>
                          <View
                            style={[
                              styles.badgeRow,
                              { opacity: fixedSelected ? 1 : chrome.unselectedPillOpacity },
                            ]}
                          >
                            {CHALLENGE_TYPE_PILLS.fixed.map((label) => (
                              <View
                                key={label}
                                style={[
                                  styles.miniBadge,
                                  {
                                    borderColor: fixedSelected ? roomTheme.pillBorder : chrome.border,
                                    backgroundColor: fixedSelected
                                      ? roomTheme.pillBg
                                      : chrome.surfaceSubtle,
                                  },
                                ]}
                              >
                                <Text
                                  style={{
                                    fontSize: rf(9),
                                    fontWeight: "700",
                                    color: fixedSelected ? roomTheme.pillText : chrome.textMuted,
                                  }}
                                >
                                  {label}
                                </Text>
                              </View>
                            ))}
                          </View>
                        </LinearGradient>
                      </LinearGradient>
                    </TouchableOpacity>
                  </View>
                </>
              )}
            </View>
          )}

          {/* ── STEP 3 — Entry & goal ── */}
          {step === 3 && (
            <View style={styles.stack}>
              {draft.entryType === "free" && (
                <View style={styles.fieldBlock}>
                  <Text style={[styles.sectionLabel, { color: chrome.textSection }]}>Target Steps</Text>
                  <PremiumStepSlider
                    hideLabel
                    helperText="Steps required to complete the challenge"
                    values={getTargetStepOptions(draft.fixed.goalType)}
                    selectedValue={draft.fixed.targetSteps}
                    onValueChange={(v) => patchFixed({ targetSteps: v })}
                    formatValue={(v) => formatStepLabel(v)}
                    minLabel={formatStepShortLabel(getTargetStepOptions(draft.fixed.goalType)[0]!)}
                    maxLabel={formatStepShortLabel(
                      getTargetStepOptions(draft.fixed.goalType).at(-1)!,
                    )}
                    accessibilityLabel="Target steps"
                    accent={roomTheme.primary}
                    labelColor={chrome.text}
                    helperColor={chrome.textSecondary}
                    surfaceColor={chrome.cardEntry}
                    borderColor={chrome.borderDaily}
                    trackInactive={chrome.trackInactive}
                    trackGradient={roomTheme.gradientTrack}
                  />
                </View>
              )}

              {draft.entryType === "coins" && (
                <>
                  <View style={styles.fieldBlock}>
                    <Text style={[styles.sectionLabel, { color: chrome.textSection }]}>Coin Entry</Text>
                    <PremiumStepSlider
                      hideLabel
                      helperText="Coins per player"
                      values={COINS_ENTRY_AMOUNTS}
                      selectedValue={draft.fixed.coinEntryAmount}
                      onValueChange={(v) => patchFixed({ coinEntryAmount: v })}
                      formatValue={(v) => (v >= 1000 ? `${v / 1000}k` : String(v))}
                      accessibilityLabel="Coin entry amount"
                      accent={roomTheme.primary}
                      labelColor={chrome.text}
                      helperColor={chrome.textSecondary}
                      surfaceColor={chrome.cardEntry}
                      borderColor={chrome.borderEntry}
                      trackInactive={chrome.trackInactive}
                      trackGradient={roomTheme.gradientTrack}
                    />
                  </View>
                  <View style={styles.fieldBlock}>
                    <Text style={[styles.sectionLabel, { color: chrome.textSection }]}>Target Steps</Text>
                    <PremiumStepSlider
                      hideLabel
                      helperText="Steps required to complete the challenge"
                      values={getTargetStepOptions(draft.fixed.goalType)}
                      selectedValue={draft.fixed.targetSteps}
                      onValueChange={(v) => patchFixed({ targetSteps: v })}
                      formatValue={(v) => formatStepLabel(v)}
                      minLabel={formatStepShortLabel(getTargetStepOptions(draft.fixed.goalType)[0]!)}
                      maxLabel={formatStepShortLabel(
                        getTargetStepOptions(draft.fixed.goalType).at(-1)!,
                      )}
                      accessibilityLabel="Target steps"
                      accent={roomTheme.primary}
                      labelColor={chrome.text}
                      helperColor={chrome.textSecondary}
                      surfaceColor={chrome.cardEntry}
                      borderColor={chrome.borderDaily}
                      trackInactive={chrome.trackInactive}
                      trackGradient={roomTheme.gradientTrack}
                    />
                  </View>
                </>
              )}

              {draft.entryType === "usd" && isUnlimited && (
                <>
                  <View style={styles.fieldBlock}>
                    <Text style={[styles.sectionLabel, { color: chrome.textSection }]}>Entry Amount</Text>
                    <PremiumStepSlider
                      hideLabel
                      helperText="Entry fee per participant"
                      values={UNLIMITED_GOAL_ENTRY_AMOUNT_DOLLARS}
                      selectedValue={draft.unlimited.entryDollars}
                      onValueChange={(v) => {
                        patchUnlimited({ entryDollars: v });
                        trackEvent("challenge_entry_amount_changed", { dollars: v });
                      }}
                      formatValue={(v) => `$${v.toLocaleString()}`}
                      minLabel="$10"
                      maxLabel="$1,000"
                      accessibilityLabel="Unlimited entry amount"
                      accent={roomTheme.primary}
                      labelColor={chrome.text}
                      helperColor={chrome.textSecondary}
                      surfaceColor={chrome.cardEntry}
                      borderColor={chrome.borderEntry}
                      trackInactive={chrome.trackInactive}
                      trackGradient={roomTheme.gradientTrack}
                      valuePillBg={roomTheme.valuePillBg}
                      valuePillBorder={roomTheme.valuePillBorder}
                      valuePillText={roomTheme.valuePillText}
                      leading={
                        <LinearGradient
                          colors={[...roomTheme.gradientIcon]}
                          style={styles.sliderIconTile}
                          start={{ x: 0, y: 0 }}
                          end={{ x: 1, y: 1 }}
                        >
                          <Feather name="dollar-sign" size={16} color={roomTheme.iconColor} />
                        </LinearGradient>
                      }
                    />
                  </View>
                  <View style={styles.fieldBlock}>
                    <Text style={[styles.sectionLabel, { color: chrome.textSection }]}>Daily Step Goal</Text>
                    <PremiumStepSlider
                      hideLabel
                      helperText="Steps required each challenge day"
                      values={dailyGoalOptions}
                      selectedValue={draft.unlimited.dailyGoalSteps}
                      onValueChange={(v) => {
                        patchUnlimited({ dailyGoalSteps: v });
                        trackEvent("challenge_daily_goal_changed", { steps: v });
                      }}
                      formatValue={(v) => `${v.toLocaleString()}`}
                      minLabel="3,000"
                      maxLabel="20,000"
                      accessibilityLabel="Daily step goal"
                      accent={roomTheme.primary}
                      labelColor={chrome.text}
                      helperColor={chrome.textSecondary}
                      surfaceColor={chrome.cardEntry}
                      borderColor={chrome.borderDaily}
                      trackInactive={chrome.trackInactive}
                      trackGradient={roomTheme.gradientTrack}
                      valuePillBg={roomTheme.valuePillBg}
                      valuePillBorder={roomTheme.valuePillBorder}
                      valuePillText={roomTheme.valuePillText}
                      footerNote="Meet your step goal every day to remain eligible for the prize pool."
                      leading={
                        <LinearGradient
                          colors={[...roomTheme.gradientIcon]}
                          style={styles.sliderIconTile}
                          start={{ x: 0, y: 0 }}
                          end={{ x: 1, y: 1 }}
                        >
                          <Feather name="activity" size={15} color={roomTheme.iconColor} />
                        </LinearGradient>
                      }
                    />
                  </View>
                </>
              )}

              {draft.entryType === "usd" && !isUnlimited && (
                <>
                  <View style={styles.fieldBlock}>
                    <PremiumStepSlider
                      label="Entry Fee"
                      helperText="Cash entry per player"
                      values={USD_FIXED_ENTRY_DOLLARS}
                      selectedValue={clampUsdFixedEntryDollars(draft.fixed.usdAmountDollars)}
                      onValueChange={(v) =>
                        patchFixed({ usdAmountDollars: clampUsdFixedEntryDollars(v) })
                      }
                      formatValue={(v) => `$${v}`}
                      minLabel="$3"
                      maxLabel="$25"
                      accessibilityLabel="Cash challenge entry fee"
                      accent={roomTheme.primary}
                      labelColor={chrome.text}
                      helperColor={chrome.textSecondary}
                      surfaceColor={chrome.cardEntry}
                      borderColor={chrome.borderEntry}
                      trackInactive={chrome.trackInactive}
                      trackGradient={roomTheme.gradientTrack}
                    />
                  </View>
                  <View style={styles.fieldBlock}>
                    <Text style={[styles.sectionLabel, { color: chrome.textSection }]}>Target Steps</Text>
                    <PremiumStepSlider
                      hideLabel
                      helperText="Steps required to complete the challenge"
                      values={getTargetStepOptions(draft.fixed.goalType)}
                      selectedValue={draft.fixed.targetSteps}
                      onValueChange={(v) => patchFixed({ targetSteps: v })}
                      formatValue={(v) => formatStepLabel(v)}
                      minLabel={formatStepShortLabel(getTargetStepOptions(draft.fixed.goalType)[0]!)}
                      maxLabel={formatStepShortLabel(
                        getTargetStepOptions(draft.fixed.goalType).at(-1)!,
                      )}
                      accessibilityLabel="Target steps"
                      accent={roomTheme.primary}
                      labelColor={chrome.text}
                      helperColor={chrome.textSecondary}
                      surfaceColor={chrome.cardEntry}
                      borderColor={chrome.borderDaily}
                      trackInactive={chrome.trackInactive}
                      trackGradient={roomTheme.gradientTrack}
                    />
                  </View>
                </>
              )}
            </View>
          )}

          {/* ── STEP 4 — Participants & schedule ── */}
          {step === 4 && (
            <View style={styles.stack}>
              {!isUnlimited ? (
                <PremiumStepSlider
                  label="Players"
                  helperText="Maximum participants"
                  values={getPlayerOptions()}
                  selectedValue={draft.fixed.maxPlayers}
                  onValueChange={(v) => patchFixed({ maxPlayers: v })}
                  formatValue={(v) => formatPlayerLabel(v)}
                  accessibilityLabel="Player count"
                  accent={roomTheme.primary}
                  labelColor={chrome.text}
                  helperColor={chrome.textSecondary}
                  surfaceColor={chrome.card}
                  borderColor={chrome.border}
                  trackInactive={chrome.trackInactive}
                  trackGradient={roomTheme.gradientTrack}
                  valuePillBg={roomTheme.valuePillBg}
                  valuePillBorder={roomTheme.valuePillBorder}
                  valuePillText={roomTheme.valuePillText}
                />
              ) : (
                <View style={[styles.infoRow, { borderColor: colors.border, backgroundColor: chrome.card }]}>
                  <View style={[styles.formatIconSm, { backgroundColor: roomTheme.iconBackground }]}>
                    <Feather name="users" size={14} color={roomTheme.iconColor} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.cardTitleSm, { color: colors.foreground }]}>Participants</Text>
                    <Text style={[styles.cardHelperSm, { color: colors.mutedForeground }]}>
                      No maximum participant limit
                    </Text>
                  </View>
                  <Text style={{ fontSize: rf(12), fontWeight: "800", color: roomTheme.valueText }}>
                    Challenge
                  </Text>
                </View>
              )}

              {!isUnlimited ? (
                <PremiumStepSlider
                  label="Duration"
                  helperText="Challenge length"
                  values={[1, 7, 30]}
                  selectedValue={durationDaysFromGoalType(draft.fixed.goalType)}
                  onValueChange={(days) => {
                    const goalType: TargetStepDuration =
                      days === 1 ? "daily" : days === 7 ? "weekly" : "monthly";
                    patchFixed({
                      goalType,
                      targetSteps: getDefaultTargetSteps(goalType),
                    });
                  }}
                  formatValue={(d) => (d === 1 ? "1 Day" : `${d} Days`)}
                  accessibilityLabel="Challenge duration"
                  accent={roomTheme.primary}
                  labelColor={chrome.text}
                  helperColor={chrome.textSecondary}
                  surfaceColor={chrome.card}
                  borderColor={chrome.border}
                  trackInactive={chrome.trackInactive}
                  trackGradient={roomTheme.gradientTrack}
                  valuePillBg={roomTheme.valuePillBg}
                  valuePillBorder={roomTheme.valuePillBorder}
                  valuePillText={roomTheme.valuePillText}
                />
              ) : (
                <PremiumStepSlider
                  label="Duration"
                  helperText="Challenge length"
                  values={UNLIMITED_GOAL_DURATION_DAYS}
                  selectedValue={draft.unlimited.durationDays}
                  onValueChange={(d) => {
                    patchUnlimited({ durationDays: d as typeof draft.unlimited.durationDays });
                    trackEvent("challenge_duration_changed", { days: d });
                  }}
                  formatValue={(d) => formatDurationDaysLabel(d)}
                  minLabel="7 days"
                  maxLabel="90 days"
                  accessibilityLabel="Unlimited duration"
                  accent={roomTheme.primary}
                  labelColor={chrome.text}
                  helperColor={chrome.textSecondary}
                  surfaceColor={chrome.card}
                  borderColor={chrome.border}
                  trackInactive={chrome.trackInactive}
                  trackGradient={roomTheme.gradientTrack}
                  valuePillBg={roomTheme.valuePillBg}
                  valuePillBorder={roomTheme.valuePillBorder}
                  valuePillText={roomTheme.valuePillText}
                />
              )}

              <View style={styles.scheduleBlock}>
              <View style={[styles.schedulePanel, { borderColor: colors.border, backgroundColor: chrome.card }]} accessibilityLabel="Schedule">
                <View style={styles.scheduleRow}>
                  <View style={[styles.formatIconSm, { backgroundColor: roomTheme.iconBackground }]}>
                    <Feather name="calendar" size={14} color={roomTheme.iconColor} />
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={[styles.cardTitleSm, { color: colors.foreground }]}>Start</Text>
                    <Text style={[styles.scheduleLockHelper, { color: colors.mutedForeground }]}>
                      {liveSchedule.helperLabel}
                    </Text>
                  </View>
                  <TouchableOpacity
                    accessibilityLabel={`Start date ${startDateLabel}`}
                    onPress={() => setShowStartDatePicker(true)}
                    style={[styles.scheduleChip, { borderColor: roomTheme.border, backgroundColor: chrome.chipBg }]}
                  >
                    <Text style={[styles.scheduleChipLabel, { color: colors.mutedForeground }]}>Date</Text>
                    <Text style={[styles.scheduleChipValue, { color: roomTheme.valueText }]}>{startDateLabel}</Text>
                  </TouchableOpacity>
                  {isUnlimited ? (
                    <View
                      accessibilityLabel="Start time, fixed at 12:00 AM"
                      style={[styles.scheduleChip, styles.scheduleChipLocked, { backgroundColor: chrome.chipBg, borderColor: colors.border }]}
                    >
                      <Text style={[styles.scheduleChipLabel, { color: colors.mutedForeground }]}>Time</Text>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                        <Text style={[styles.scheduleChipValue, { color: colors.mutedForeground }]}>
                          12:00 AM
                        </Text>
                        <Feather name="lock" size={11} color={colors.mutedForeground} />
                      </View>
                    </View>
                  ) : (
                    <TouchableOpacity
                      accessibilityLabel={`Start time ${startTimeLabel}`}
                      onPress={() => {
                        if (isSameDay(draft.startDate, deviceNow)) {
                          const current = TIME_PRESETS_WITH_NOW[draft.startTimeIdx];
                          if (!current?.isNow) {
                            patch({
                              startTimeIdx: resolveInitialPresetIndex(
                                TIME_PRESETS_WITH_NOW,
                                draft.startTimeIdx,
                                true,
                              ),
                            });
                          }
                        }
                        setShowStartTimePicker(true);
                      }}
                      style={[styles.scheduleChip, { borderColor: roomTheme.border, backgroundColor: chrome.chipBg }]}
                    >
                      <Text style={[styles.scheduleChipLabel, { color: colors.mutedForeground }]}>Time</Text>
                      <Text style={[styles.scheduleChipValue, { color: roomTheme.valueText }]}>{startTimeLabel}</Text>
                    </TouchableOpacity>
                  )}
                </View>

                <View style={[styles.scheduleDivider, { backgroundColor: colors.border }]} />

                <View style={styles.scheduleEndRow}>
                  <View style={[styles.formatIconSm, { backgroundColor: chrome.surfaceSubtle }]}>
                    <Feather name="lock" size={14} color={colors.mutedForeground} />
                  </View>
                  <View style={styles.scheduleEndCopy}>
                    <Text style={[styles.cardTitleSm, { color: colors.foreground }]}>End</Text>
                    <Text style={[styles.scheduleLockHelper, { color: colors.mutedForeground }]}>
                      {isUnlimited
                        ? "Locked · start date + duration"
                        : "Locked · calculated from\nstart and duration"}
                    </Text>
                  </View>
                  <View style={styles.scheduleEndChipsRight}>
                    <View
                      accessibilityLabel="End date, calculated automatically"
                      style={[styles.scheduleChip, styles.scheduleChipLocked, { backgroundColor: chrome.chipBg, borderColor: colors.border }]}
                    >
                      <Text style={[styles.scheduleChipLabel, { color: colors.mutedForeground }]}>End Date</Text>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                        <Text style={[styles.scheduleChipValue, { color: colors.mutedForeground }]}>
                          {liveSchedule.endDisplayDate}
                        </Text>
                        {isUnlimited ? (
                          <Feather name="lock" size={11} color={colors.mutedForeground} />
                        ) : null}
                      </View>
                    </View>
                    <View
                      accessibilityLabel="End time, fixed at 12:00 AM"
                      style={[styles.scheduleChip, styles.scheduleChipLocked, { backgroundColor: chrome.chipBg, borderColor: colors.border }]}
                    >
                      <Text style={[styles.scheduleChipLabel, { color: colors.mutedForeground }]}>End Time</Text>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                        <Text style={[styles.scheduleChipValue, { color: colors.mutedForeground }]}>
                          {isUnlimited ? "12:00 AM" : liveSchedule.endDisplayTime}
                        </Text>
                        <Feather name="lock" size={11} color={colors.mutedForeground} />
                      </View>
                    </View>
                  </View>
                </View>
              </View>
              <Text style={[styles.tzLine, { color: colors.mutedForeground }]}>
                {isUnlimited
                  ? `Challenge begins at 12:00 AM · Timezone: ${timezone}`
                  : `Calculated automatically from duration · Timezone: ${timezone}`}
              </Text>
              {!isUnlimited && !liveSchedule.isValid && liveSchedule.validationMessage ? (
                <View style={styles.scheduleInvalidBox}>
                  <Text style={styles.scheduleInvalidText}>{liveSchedule.validationMessage}</Text>
                  <View style={styles.scheduleInvalidActions}>
                    <TouchableOpacity
                      onPress={() => setShowStartTimePicker(true)}
                      style={[styles.scheduleRecoveryBtn, { borderColor: roomTheme.border }]}
                    >
                      <Text style={{ color: roomTheme.valueText, fontWeight: "700", fontSize: rf(12) }}>
                        Choose New Time
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={restoreAutoNow}
                      style={[styles.scheduleRecoveryBtn, { borderColor: roomTheme.border }]}
                    >
                      <Text style={{ color: roomTheme.valueText, fontWeight: "700", fontSize: rf(12) }}>
                        Use Current Time
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ) : !isUnlimited && liveSchedule.startMode === "user_selected" ? (
                <TouchableOpacity onPress={restoreAutoNow} style={{ paddingHorizontal: 2, marginTop: 2 }}>
                  <Text style={{ fontSize: rf(11), fontWeight: "700", color: roomTheme.valueText }}>
                    Use current time
                  </Text>
                </TouchableOpacity>
              ) : null}
              </View>

              {!isUnlimited && draft.entryType === "usd" && (cashQuote || cashQuoteLoading) && (
                <CashChallengePaymentBreakdown
                  quote={cashQuote}
                  loading={cashQuoteLoading}
                  entryFeeDollars={draft.fixed.usdAmountDollars}
                  colors={colors}
                  title="Payment Summary"
                />
              )}

              {isUnlimited && (
                <View style={[styles.glassCardCompact, { borderColor: colors.border, backgroundColor: chrome.card }]}>
                  <Text style={[styles.cardTitleSm, { color: colors.foreground }]}>Equal Prize Split</Text>
                  <Text style={[styles.cardHelperSm, { color: colors.mutedForeground }]}>
                    Everyone who completes the daily goal on every required day shares the final prize pool equally.
                  </Text>
                </View>
              )}

              {isUnlimited && (
                <UnlimitedGoalFeeBreakdown
                  quote={
                    unlimitedQuote ?? {
                      entryFeeCents: draft.unlimited.entryDollars * 100,
                      platformFeeCents: UNLIMITED_GOAL_PLATFORM_FEE_CENTS,
                      totalChargeCents:
                        draft.unlimited.entryDollars * 100 + UNLIMITED_GOAL_PLATFORM_FEE_CENTS,
                      currency: "usd" as const,
                    }
                  }
                  colors={colors}
                  title="Payment Summary"
                  compact
                />
              )}
            </View>
          )}

          {/* ── STEP 5 — Compact checkout ── */}
          {step === 5 && (
            <>
              <CreateChallengeCheckoutStep
                colors={colors}
                draft={draft}
                roomTheme={roomTheme}
                isUnlimited={isUnlimited}
                liveSchedule={liveSchedule}
                timezone={timezone}
                ownedLayouts={ownedLayouts}
                unlimitedQuote={unlimitedQuote}
                cashQuote={cashQuote}
                cashQuoteLoading={cashQuoteLoading}
                createEnabled={!!createEnabled}
                blockReason={getStepBlockReason(5, draft, deviceNow)}
                onPatch={patch}
                onEdit={() => {
                  setDir("back");
                  setStep(1);
                }}
              />
              {reviewBuilt.ok &&
                reviewBuilt.meta.isUsd &&
                walletBalance < reviewBuilt.meta.totalChargeCents / 100 && (
                  <Text style={{ fontSize: rf(12), color: "#F87171", marginTop: 4 }}>
                    Insufficient wallet balance. Add funds before creating.
                  </Text>
                )}
            </>
          )}
        </Animated.View>
      </ScrollView>

      {/* Sticky footer */}
      <View style={[styles.sticky, { borderTopColor: chrome.border, backgroundColor: chrome.bg }]}>
        <TouchableOpacity
          style={[
            styles.secondaryBtn,
            { borderColor: chrome.borderBack, backgroundColor: chrome.backBtnBg },
          ]}
          onPress={goBack}
          disabled={creating}
          accessibilityLabel="Back"
        >
          <Text style={{ fontSize: rf(14), fontWeight: "700", color: chrome.text }}>Back</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.primaryBtn}
          disabled={step < 5 ? !continueEnabled : !createEnabled}
          onPress={onPrimary}
          accessibilityLabel={primaryLabel}
        >
          {(step < 5 ? continueEnabled : createEnabled) ? (
            <LinearGradient
              colors={[...roomTheme.gradientCta]}
              style={[
                styles.primaryGrad,
                styles.primaryShadow,
                { shadowColor: roomTheme.secondary },
              ]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
            >
              {creating ? (
                <ActivityIndicator color="#FFF" />
              ) : (
                <Text style={styles.primaryText} numberOfLines={1}>
                  {primaryLabel}
                </Text>
              )}
            </LinearGradient>
          ) : (
            <View style={[styles.primaryGrad, { backgroundColor: chrome.disabledBtn }]}>
              <Text style={[styles.primaryText, { color: chrome.disabledText }]} numberOfLines={1}>
                {primaryLabel}
              </Text>
            </View>
          )}
        </TouchableOpacity>
      </View>

      {showStartDatePicker &&
        (Platform.OS === "android" ? (
          <DateTimePicker
            value={toLocalCalendarDate(draft.startDate)}
            mode="date"
            display="default"
            minimumDate={
              isUnlimited
                ? localTomorrowCalendarDate(new Date())
                : toLocalCalendarDate(new Date())
            }
            onChange={onStartDatePickerChange}
          />
        ) : (
          <Pressable style={styles.pickerOverlay} onPress={() => setShowStartDatePicker(false)}>
            <View style={[styles.pickerSheet, { backgroundColor: colors.card }]}>
              <DateTimePicker
                value={toLocalCalendarDate(draft.startDate)}
                mode="date"
                display="spinner"
                minimumDate={
                  isUnlimited
                    ? localTomorrowCalendarDate(new Date())
                    : toLocalCalendarDate(new Date())
                }
                onChange={onStartDatePickerChange}
              />
              <TouchableOpacity onPress={() => setShowStartDatePicker(false)} style={{ padding: 16, alignItems: "center" }}>
                <Text style={{ color: accent, fontWeight: "800" }}>Done</Text>
              </TouchableOpacity>
            </View>
          </Pressable>
        ))}

      <StartTimePickerModal
        visible={showStartTimePicker && !isUnlimited}
        accent={accent}
        isToday={isSameDay(draft.startDate, deviceNow)}
        presets={isSameDay(draft.startDate, deviceNow) ? TIME_PRESETS_WITH_NOW : TIME_PRESETS_FUTURE}
        selectedIndex={
          isSameDay(draft.startDate, deviceNow)
            ? draft.startTimeIdx
            : Math.max(0, draft.startTimeIdx - 1)
        }
        onClose={() => setShowStartTimePicker(false)}
        onConfirm={(idx) => {
          const isToday = isSameDay(draft.startDate, deviceNow);
          let globalIdx = isToday ? idx : idx + 1;
          if (isToday) {
            const preset = TIME_PRESETS_WITH_NOW[globalIdx];
            const now = new Date();
            const nowMin = now.getHours() * 60 + now.getMinutes();
            if (preset?.isNow) {
              setDraft((prev) => applyAutoNowMode(prev, now));
              setShowStartTimePicker(false);
              tickClock();
              return;
            }
            if (preset && preset.hour * 60 + preset.minute <= nowMin) {
              globalIdx = getNextPresetIndexForNow(TIME_PRESETS_WITH_NOW, now);
            }
          }
          setDraft((prev) => ({
            ...prev,
            startTimeIdx: globalIdx,
            startMode: "user_selected",
          }));
          setShowStartTimePicker(false);
          tickClock();
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: rs(8),
    paddingHorizontal: rs(14),
    paddingTop: rs(10),
    paddingBottom: rs(4),
  },
  headerCenter: { flex: 1, alignItems: "center", paddingTop: 2 },
  title: {
    fontSize: rf(18),
    fontWeight: "800",
    letterSpacing: -0.3,
    textAlign: "center",
  },
  subtitle: {
    fontSize: rf(12),
    marginTop: rs(3),
    textAlign: "center",
    lineHeight: rs(16),
  },
  iconBtn: {
    width: rs(36),
    height: rs(36),
    borderRadius: rs(10),
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
  },
  progressBlock: {
    alignItems: "center",
    paddingHorizontal: rs(20),
    paddingTop: rs(4),
    paddingBottom: rs(6),
    gap: rs(4),
  },
  dotsCentered: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 2,
  },
  dotLine: { width: 22, height: 2, borderRadius: 1, marginHorizontal: 4 },
  stepCount: {
    fontSize: rf(11),
    fontWeight: "600",
        textAlign: "center",
  },
  body: {
    paddingHorizontal: rs(14),
    paddingBottom: rs(24),
    gap: rs(12),
  },
  stack: {
    gap: rs(14),
    rowGap: rs(14),
  },
  typeStack: {
    gap: rs(14),
    rowGap: rs(14),
  },
  fieldBlock: {
    gap: rs(8),
  },
  sectionLabel: {
    fontSize: rf(11),
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 1.5,
    marginBottom: 0,
    marginTop: 0,
  },
  roomRow: { flexDirection: "row", gap: 8 },
  roomSegPressable: {
    flex: 1,
  },
  roomCardShell: {
    flex: 1,
    minHeight: 108,
    borderRadius: ROOM_CARD_RADIUS,
    borderWidth: 1.5,
    overflow: "hidden",
      },
  roomCardUnselectedBg: {
      },
  roomCardContent: {
    paddingHorizontal: 18,
    paddingVertical: 18,
    minHeight: 108,
    justifyContent: "flex-start",
  },
  roomIcon: {
    width: 32,
    height: 32,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 10,
  },
  entryRow: { flexDirection: "row", gap: 8 },
  entrySeg: {
    flex: 1,
    borderRadius: 14,
    borderWidth: 1.5,
    paddingVertical: 12,
    paddingHorizontal: 8,
    alignItems: "center",
    minHeight: 88,
  },
  checkAbs: {
    position: "absolute",
    top: 8,
    right: 8,
    width: 16,
    height: 16,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  glassCard: {
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 14,
        gap: 4,
  },
  glassCardCompact: {
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 12,
        gap: 4,
  },
  cardTitle: { fontSize: rf(14), fontWeight: "800" },
  cardTitleSm: { fontSize: rf(13), fontWeight: "800" },
  cardHelper: { fontSize: rf(12), lineHeight: 17, marginTop: 2 },
  cardHelperSm: { fontSize: rf(11), lineHeight: 14, marginTop: 4 },
  formatCard: {
    borderRadius: 14,
    borderWidth: 1.5,
        paddingHorizontal: 16,
    paddingVertical: 14,
    overflow: "hidden",
        gap: 10,
  },
  formatCardOuter: {
    borderRadius: 14,
    padding: 1.5,
  },
  formatCardInner: {
    borderRadius: 12.5,
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 10,
    overflow: "hidden",
  },
  formatCardGlowUnlimited: {
    shadowColor: "#8437FF",
    shadowOpacity: 0.22,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 0 },
    elevation: 6,
  },
  formatCardGlowFixed: {
    shadowColor: "#00C6FF",
    shadowOpacity: 0.16,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 0 },
    elevation: 5,
  },
  formatCardSelected: {
    borderColor: "#C33EFF",
  },
  formatTop: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  formatIcon: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  formatIconSm: {
    width: 30,
    height: 30,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  checkCircle: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
  },
  sliderIconTile: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  newBadge: {
        borderRadius: 5,
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  newBadgeText: { fontSize: rf(8), fontWeight: "900", color: "#05111B" },
  badgeRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 2 },
  miniBadge: {
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  infoRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 14,
      },
  warnLine: { fontSize: rf(10), lineHeight: 13, marginTop: -2, marginBottom: 2 },
  scheduleBlock: {
    gap: 8,
  },
  schedulePanel: {
    borderRadius: 12,
    borderWidth: 1,
        overflow: "hidden",
  },
  scheduleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  scheduleEndRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  scheduleEndCopy: {
    flex: 1,
    minWidth: 0,
    paddingRight: 4,
  },
  scheduleLockHelper: {
    fontSize: rf(11),
    lineHeight: 15,
    marginTop: 3,
  },
  scheduleInvalidBox: {
    marginTop: 8,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(255,159,28,0.45)",
    backgroundColor: "rgba(255,159,28,0.08)",
    gap: 10,
  },
  scheduleInvalidText: {
    fontSize: rf(12),
    lineHeight: 17,
    color: "#FFB84D",
    fontWeight: "600",
  },
  scheduleInvalidActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  scheduleRecoveryBtn: {
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  scheduleEndChipsRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    flexShrink: 0,
  },
  scheduleEndBlock: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 10,
  },
  scheduleEndHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
  },
  scheduleEndChips: {
    flexDirection: "row",
    gap: 8,
    paddingLeft: 38,
  },
  scheduleDivider: {
    height: StyleSheet.hairlineWidth,
    marginHorizontal: 12,
  },
  scheduleChip: {
    minWidth: 64,
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  scheduleChipLocked: {
    borderColor: "rgba(255,255,255,0.08)",
    opacity: 0.9,
  },
  scheduleChipLabel: {
    fontSize: rf(8),
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.3,
  },
  scheduleChipValue: {
    fontSize: rf(11),
    fontWeight: "800",
    marginTop: 1,
  },
  scheduleGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  scheduleCard: {
    width: "48%",
    flexGrow: 1,
    borderRadius: 14,
    borderWidth: 1,
    padding: 12,
      },
  scheduleLabel: { fontSize: rf(10), fontWeight: "600" },
  scheduleValue: { fontSize: rf(13), fontWeight: "800", marginTop: 4 },
  tzLine: { fontSize: rf(10), paddingHorizontal: 2 },
  sticky: {
    flexDirection: "row",
    gap: 10,
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  secondaryBtn: {
    flex: 0.42,
    borderRadius: 12,
    borderWidth: 1,
    paddingVertical: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryBtn: {
    flex: 1,
    borderRadius: 12,
    overflow: "hidden",
  },
  primaryGrad: {
    paddingVertical: 12,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 44,
  },
  primaryShadow: {
    shadowColor: "#000",
    shadowOpacity: 0.28,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
  },
  primaryText: {
    color: "#FFF",
    fontSize: rf(14),
    fontWeight: "800",
  },
  summaryHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 4,
  },
  roomReviewBadge: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: 8,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 5,
    marginBottom: 8,
  },
  summaryRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    paddingVertical: 5,
  },
  checkRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    borderRadius: 14,
    borderWidth: 1,
    padding: 12,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 1,
  },
  pickerOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "flex-end",
  },
  pickerSheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingBottom: 20,
  },
});
