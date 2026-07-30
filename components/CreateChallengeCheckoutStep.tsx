/**
 * Compact Create Challenge Step 5 — checkout-style review & payment.
 * Presentation only: does not alter payloads, fees, or enablement rules.
 */

import React, { memo, useMemo } from "react";
import { Image, ScrollView, StyleSheet, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { TouchableOpacity } from "@/components/HapticTouchableOpacity";
import { UnlimitedDailyGoalRuleCard } from "@/components/UnlimitedDailyGoalRuleCard";
import {
  CashChallengePaymentBreakdown,
  CashChallengeRewardSplit,
} from "@/components/CashChallengePaymentBreakdown";
import type { CashChallengePaymentQuote } from "@/services/cashChallengeApi";
import { formatUsd } from "@/services/cashChallengeApi";
import type { UnlimitedGoalPaymentQuote } from "@/services/unlimitedGoalApi";
import type { CreateChallengeAccentTheme } from "@/constants/createChallengeTheme";
import { useTheme } from "@/context/ThemeContext";
import type { CreateChallengeDraft } from "@/utils/createChallengeFlow";
import type { ChallengeReviewSchedule } from "@/utils/createChallengeSchedule";
import {
  CHECKOUT_CARD_GAP,
  CHECKOUT_CARD_PAD_H,
  CHECKOUT_CARD_PAD_V,
  CHECKOUT_CARD_RADIUS,
  CHECKOUT_GOLD,
  CHECKOUT_REVIEW_TITLE,
  buildCompactChallengeSummary,
  buildUnlimitedPaymentRows,
  checkoutAckLines,
  getTrackDisplayLabel,
  isRulesAccepted,
} from "@/utils/createChallengeCheckout";
import { UNLIMITED_GOAL_PLATFORM_FEE_CENTS } from "@/utils/unlimitedGoal";
import type { StepBlockReason } from "@/utils/createChallengeFlow";
import { rf, rs } from "@/utils/responsive";
import * as Haptics from "@/utils/haptics";

/** Dark-theme gold kept; light uses deeper amber for contrast on pale surfaces. */
const CHECKOUT_GOLD_LIGHT = "#A16207";

type Colors = {
  foreground: string;
  mutedForeground: string;
  border: string;
  card: string;
  primary: string;
  muted?: string;
};

type TrackLayout = {
  id: string;
  label: string;
  source: number;
};

type Props = {
  colors: Colors;
  draft: CreateChallengeDraft;
  roomTheme: CreateChallengeAccentTheme;
  isUnlimited: boolean;
  liveSchedule: ChallengeReviewSchedule;
  timezone: string;
  ownedLayouts: TrackLayout[];
  unlimitedQuote: UnlimitedGoalPaymentQuote | null;
  cashQuote: CashChallengePaymentQuote | null;
  cashQuoteLoading?: boolean;
  createEnabled: boolean;
  blockReason: StepBlockReason | null;
  onPatch: (partial: Partial<CreateChallengeDraft>) => void;
  onEdit: () => void;
};

type FeatherName = React.ComponentProps<typeof Feather>["name"];

function SummaryIcon({
  name,
  color,
}: {
  name: FeatherName;
  color: string;
}) {
  return (
    <View style={[styles.summaryIcon, { backgroundColor: color + "22" }]}>
      <Feather name={name} size={12} color={color} />
    </View>
  );
}

function CreateChallengeCheckoutStepInner({
  colors,
  draft,
  roomTheme,
  isUnlimited,
  liveSchedule,
  timezone,
  ownedLayouts,
  unlimitedQuote,
  cashQuote,
  cashQuoteLoading = false,
  onPatch,
  onEdit,
}: Props) {
  const { isDark } = useTheme();
  const accentLink = isDark ? CHECKOUT_GOLD : CHECKOUT_GOLD_LIGHT;
  const trackLabel = getTrackDisplayLabel(draft.trackLayout);
  const iconColor = roomTheme.iconColor;

  const summary = useMemo(
    () =>
      buildCompactChallengeSummary({
        draft,
        schedule: liveSchedule,
        timezone,
        trackLabel,
      }),
    [draft, liveSchedule, timezone, trackLabel],
  );

  const payment = useMemo(() => {
    if (!isUnlimited) return null;
    const entryFeeCents = unlimitedQuote?.entryFeeCents ?? draft.unlimited.entryDollars * 100;
    const platformFeeCents =
      unlimitedQuote?.platformFeeCents ?? UNLIMITED_GOAL_PLATFORM_FEE_CENTS;
    const totalChargeCents =
      unlimitedQuote?.totalChargeCents ?? entryFeeCents + platformFeeCents;
    return buildUnlimitedPaymentRows({
      entryFeeCents,
      platformFeeCents,
      totalChargeCents,
      formatUsd,
    });
  }, [draft.unlimited.entryDollars, isUnlimited, unlimitedQuote]);

  const accepted = isRulesAccepted(draft);
  const ack = checkoutAckLines(draft);
  const accent = roomTheme.primary;

  const toggleAck = () => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (isUnlimited) {
      onPatch({ unlimitedRulesAccepted: !draft.unlimitedRulesAccepted });
    } else {
      onPatch({ rulesAccepted: !draft.rulesAccepted });
    }
  };

  return (
    <View style={styles.stack}>
      {/* Track — compact horizontal scroller */}
      <View style={styles.trackSection}>
        <Text style={[styles.eyebrow, { color: colors.mutedForeground }]}>Track</Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.trackRow}
        >
          {ownedLayouts.map((layout) => {
            const active = draft.trackLayout === layout.id;
            return (
              <TouchableOpacity
                key={layout.id}
                onPress={() => {
                  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  onPatch({ trackLayout: layout.id });
                }}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                accessibilityLabel={layout.label}
                style={[
                  styles.trackCard,
                  {
                    borderColor: active ? roomTheme.border : colors.border,
                    shadowColor: active ? roomTheme.secondary : "transparent",
                  },
                  active && styles.trackCardActive,
                ]}
              >
                <Image source={layout.source} style={styles.trackImage} resizeMode="cover" />
                <LinearGradient
                  colors={["transparent", "rgba(0,0,0,0.82)"]}
                  style={StyleSheet.absoluteFillObject}
                />
                <Text style={styles.trackCardLabel} numberOfLines={1}>
                  {layout.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>

      {/* Compact challenge summary with neon icons */}
      <View
        style={[styles.card, { borderColor: colors.border, backgroundColor: colors.card }]}
        accessible
        accessibilityLabel={summary.accessibilityLabel}
      >
        <View style={styles.summaryHeader}>
          <Text style={[styles.summaryTitle, { color: colors.foreground }]} numberOfLines={1}>
            {CHECKOUT_REVIEW_TITLE}
          </Text>
          <TouchableOpacity onPress={onEdit} accessibilityRole="button" accessibilityLabel="Edit challenge">
            <Text style={{ fontSize: rf(12), fontWeight: "700", color: roomTheme.valueText }}>Edit</Text>
          </TouchableOpacity>
        </View>

        <View
          style={[
            styles.roomBadge,
            { borderColor: roomTheme.border, backgroundColor: roomTheme.softBackground },
          ]}
        >
          <Feather name={summary.roomIcon} size={12} color={roomTheme.iconColor} />
          <Text style={{ fontSize: rf(11), fontWeight: "800", color: roomTheme.valueText }}>
            {summary.roomBadge}
          </Text>
        </View>

        <View style={styles.twoCol}>
          <View style={styles.iconLine}>
            <SummaryIcon name="dollar-sign" color={iconColor} />
            <Text style={[styles.colText, { color: colors.foreground }]} numberOfLines={1}>
              {summary.entryLine}
            </Text>
          </View>
          <View style={[styles.iconLine, styles.iconLineRight]}>
            <SummaryIcon name="users" color={iconColor} />
            <Text style={[styles.colTextRight, { color: colors.foreground }]} numberOfLines={1}>
              {summary.capacityLine}
            </Text>
          </View>
        </View>
        <View style={styles.twoCol}>
          <View style={styles.iconLine}>
            <SummaryIcon name="activity" color={iconColor} />
            <Text style={[styles.colText, { color: colors.mutedForeground }]} numberOfLines={1}>
              {summary.goalLine}
            </Text>
          </View>
          <View style={[styles.iconLine, styles.iconLineRight]}>
            <SummaryIcon name="clock" color={iconColor} />
            <Text style={[styles.colTextRight, { color: colors.mutedForeground }]} numberOfLines={1}>
              {summary.durationLine}
            </Text>
          </View>
        </View>

        <View style={styles.iconLine}>
          <SummaryIcon name="calendar" color={iconColor} />
          <Text style={[styles.scheduleLine, { color: colors.foreground }]}>{summary.startsLine}</Text>
        </View>
        <View style={styles.iconLine}>
          <SummaryIcon name="flag" color={iconColor} />
          <Text style={[styles.scheduleLineMuted, { color: colors.mutedForeground }]}>
            {summary.endsLine}
          </Text>
        </View>
      </View>

      {/* Payment */}
      {isUnlimited && payment ? (
        <View
          style={[styles.card, styles.paymentCard, { borderColor: colors.border, backgroundColor: colors.card }]}
          accessibilityLabel={`Payment Summary. Entry Fee ${payment.entryValue}. Tax ${payment.taxValue}. Platform Service Fee ${payment.platformFeeValue}. Total Payable ${payment.totalValue}.`}
        >
          <Text style={[styles.cardTitle, { color: colors.foreground }]}>Payment Summary</Text>
          <View style={styles.payRow}>
            <Text style={[styles.payLabel, { color: colors.mutedForeground }]}>{payment.entryLabel}</Text>
            <Text style={[styles.payValue, { color: colors.foreground }]}>{payment.entryValue}</Text>
          </View>
          <View style={styles.payRow}>
            <Text style={[styles.payLabel, { color: colors.mutedForeground }]}>{payment.taxLabel}</Text>
            <Text style={[styles.payValue, { color: colors.foreground }]}>{payment.taxValue}</Text>
          </View>
          <View style={styles.payRow}>
            <Text style={[styles.payLabel, { color: colors.mutedForeground }]}>{payment.platformFeeLabel}</Text>
            <Text style={[styles.payValue, { color: colors.foreground }]}>
              {payment.platformFeeValue}
            </Text>
          </View>
          <View style={[styles.payDivider, { backgroundColor: colors.border }]} />
          <View style={styles.payRow}>
            <Text style={[styles.payLabel, styles.payTotalLabel, { color: colors.foreground }]}>
              {payment.totalLabel}
            </Text>
            <Text style={[styles.payTotal, { color: accent }]}>{payment.totalValue}</Text>
          </View>
          <Text style={[styles.prizeNote, { color: accentLink }]}>{payment.prizePoolNote}</Text>
        </View>
      ) : null}

      {!isUnlimited && draft.entryType === "usd" && (cashQuote || cashQuoteLoading) ? (
        <View style={{ gap: CHECKOUT_CARD_GAP }}>
          <CashChallengeRewardSplit quote={cashQuote} colors={colors} />
          <CashChallengePaymentBreakdown
            quote={cashQuote}
            loading={cashQuoteLoading}
            entryFeeDollars={draft.fixed.usdAmountDollars}
            colors={colors}
            title="Payment Summary"
          />
        </View>
      ) : null}

      {isUnlimited ? (
        <UnlimitedDailyGoalRuleCard
          visibility={draft.visibility}
          attentionActive={!draft.unlimitedRulesAccepted}
          mutedForeground={colors.mutedForeground}
          foreground={colors.foreground}
        />
      ) : null}

      {/* Multi-line acknowledgment */}
      <TouchableOpacity
        style={[
          styles.ackCard,
          {
            borderColor: accepted ? accent + "60" : colors.border,
            backgroundColor: colors.muted ?? colors.card,
          },
        ]}
        onPress={toggleAck}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: accepted }}
        accessibilityLabel={ack.accessibilityLabel}
      >
        <View
          style={[
            styles.checkbox,
            {
              backgroundColor: accepted ? roomTheme.checkBg : "transparent",
              borderColor: accepted ? roomTheme.border : colors.border,
            },
          ]}
        >
          {accepted ? <Feather name="check" size={12} color={roomTheme.checkIcon} /> : null}
        </View>
        <View style={styles.ackCopy}>
          <Text style={[styles.ackLine, { color: colors.foreground }]}>{ack.line1}</Text>
          <Text style={[styles.ackLine, { color: colors.mutedForeground }]}>{ack.line2}</Text>
          <Text style={[styles.ackTerms, { color: accentLink }]}>{ack.terms}</Text>
        </View>
      </TouchableOpacity>
    </View>
  );
}

export const CreateChallengeCheckoutStep = memo(CreateChallengeCheckoutStepInner);

const styles = StyleSheet.create({
  stack: {
    width: "100%",
    gap: CHECKOUT_CARD_GAP,
    paddingBottom: 8,
  },
  trackSection: {
    width: "100%",
    gap: 8,
    marginBottom: 4,
  },
  trackRow: {
    flexDirection: "row",
    gap: 8,
    paddingRight: 4,
  },
  trackCard: {
    width: 108,
    height: 68,
    borderRadius: 12,
    overflow: "hidden",
    borderWidth: 1.5,
  },
  trackCardActive: {
    shadowOpacity: 0.4,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 0 },
    elevation: 5,
  },
  trackImage: {
    ...StyleSheet.absoluteFillObject,
    width: "100%",
    height: "100%",
  },
  trackCardLabel: {
    position: "absolute",
    left: 8,
    right: 8,
    bottom: 6,
    color: "#fff",
    fontSize: rf(10),
    fontWeight: "800",
  },
  card: {
    borderRadius: CHECKOUT_CARD_RADIUS,
    borderWidth: 1,
    paddingHorizontal: CHECKOUT_CARD_PAD_H,
    paddingVertical: CHECKOUT_CARD_PAD_V,
    gap: 6,
  },
  paymentCard: {
    gap: 4,
  },
  eyebrow: {
    fontSize: rf(10),
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 1.2,
  },
  summaryHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  summaryTitle: {
    flex: 1,
    fontSize: rf(15),
    fontWeight: "800",
    lineHeight: rs(20),
  },
  roomBadge: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: 6,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 9,
    paddingVertical: 4,
    marginTop: 2,
    marginBottom: 4,
  },
  twoCol: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  iconLine: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    minWidth: 0,
  },
  iconLineRight: {
    justifyContent: "flex-end",
  },
  summaryIcon: {
    width: 22,
    height: 22,
    borderRadius: 7,
    alignItems: "center",
    justifyContent: "center",
  },
  colText: {
    flexShrink: 1,
    fontSize: rf(12),
    fontWeight: "700",
  },
  colTextRight: {
    flexShrink: 1,
    fontSize: rf(12),
    fontWeight: "700",
    textAlign: "right",
  },
  scheduleLine: {
    flexShrink: 1,
    fontSize: rf(12),
    fontWeight: "700",
  },
  scheduleLineMuted: {
    flexShrink: 1,
    fontSize: rf(11),
    fontWeight: "500",
  },
  cardTitle: {
    fontSize: rf(13),
    fontWeight: "800",
    marginBottom: 4,
  },
  payRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 3,
    gap: 8,
  },
  payLabel: {
    flex: 1,
    fontSize: rf(12),
    fontWeight: "600",
  },
  payValue: {
    fontSize: rf(13),
    fontWeight: "700",
  },
  payDivider: {
    height: StyleSheet.hairlineWidth,
    marginVertical: 6,
  },
  payTotalLabel: {
    fontWeight: "800",
  },
  payTotal: {
    fontSize: rf(16),
    fontWeight: "800",
  },
  prizeNote: {
    marginTop: 8,
    fontSize: rf(11),
    fontWeight: "700",
  },
  ackCard: {
    borderRadius: CHECKOUT_CARD_RADIUS,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 6,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 2,
  },
  ackCopy: {
    flex: 1,
    gap: 3,
    minWidth: 0,
  },
  ackLine: {
    fontSize: rf(12),
    lineHeight: rs(17),
    fontWeight: "600",
  },
  ackTerms: {
    marginTop: 2,
    fontSize: rf(11),
    fontWeight: "800",
  },
});
