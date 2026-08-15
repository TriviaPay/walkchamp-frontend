/**
 * Fee / payment rows for Unlimited Challenge — entry + platform fee (+ optional tax).
 */

import React from "react";
import { StyleSheet, Text, View } from "react-native";
import type { UnlimitedGoalPaymentQuote } from "@/services/unlimitedGoalApi";
import { formatUsdFromCents } from "@/utils/unlimitedGoal";
import { CHECKOUT_GOLD, CHECKOUT_PRIZE_POOL_NOTE } from "@/utils/createChallengeCheckout";
import { rf } from "@/utils/responsive";
import { InrHint } from "@/components/InrHint";

type Props = {
  quote: UnlimitedGoalPaymentQuote | null;
  colors: {
    foreground: string;
    mutedForeground: string;
    primary: string;
    border: string;
    card: string;
  };
  title?: string;
  compact?: boolean;
};

/** Fee rows for Unlimited Challenge — aligned with Fixed Payment Summary labels. */
export function UnlimitedGoalFeeBreakdown({
  quote,
  colors,
  title = "Payment Summary",
  compact = false,
}: Props) {
  if (!quote) return null;

  const rows = [
    { label: "Entry Fee", value: formatUsdFromCents(quote.entryFeeCents), usd: quote.entryFeeCents / 100, accent: false },
    {
      label: "Tax / Payment Processing Fee",
      value: formatUsdFromCents(0),
      usd: 0,
      accent: false,
    },
    {
      label: "Platform Service Fee",
      value: formatUsdFromCents(quote.platformFeeCents),
      usd: quote.platformFeeCents / 100,
      accent: false,
    },
    {
      label: "Total Payable",
      value: formatUsdFromCents(quote.totalChargeCents),
      usd: quote.totalChargeCents / 100,
      accent: true,
    },
  ];

  return (
    <View
      style={[
        styles.card,
        compact && styles.cardCompact,
        { backgroundColor: colors.card, borderColor: colors.border },
      ]}
    >
      <Text style={[styles.title, compact && styles.titleCompact, { color: colors.foreground }]}>
        {title}
      </Text>
      {rows.map((row, i) => (
        <View key={row.label}>
          {i > 0 ? (
            <View
              style={[
                styles.divider,
                compact && styles.dividerCompact,
                { backgroundColor: colors.border },
              ]}
            />
          ) : null}
          <View style={styles.row}>
            <Text style={[styles.label, compact && styles.labelCompact, { color: colors.mutedForeground }]}>
              {row.label}
            </Text>
            <Text
              style={[
                styles.value,
                compact && styles.valueCompact,
                { color: row.accent ? colors.primary : colors.foreground },
                row.accent && styles.total,
              ]}
            >
              {row.value}
              <InrHint
                usd={row.usd}
                style={[styles.value, compact && styles.valueCompact, row.accent && styles.total]}
                color={row.accent ? colors.primary : colors.foreground}
              />
            </Text>
          </View>
        </View>
      ))}
      <Text style={styles.prizeNote}>{CHECKOUT_PRIZE_POOL_NOTE}</Text>
      {quote.canAfford === false ? (
        <Text style={styles.insufficient}>
          Insufficient balance. You need {formatUsdFromCents(quote.totalChargeCents)}.
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginTop: 4,
  },
  cardCompact: {
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginTop: 0,
  },
  title: {
    fontSize: rf(13),
    fontWeight: "800",
    marginBottom: 8,
  },
  titleCompact: {
    fontSize: rf(12),
    marginBottom: 6,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    marginVertical: 8,
  },
  dividerCompact: {
    marginVertical: 6,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  label: {
    fontSize: rf(12),
    fontWeight: "600",
    flexShrink: 1,
  },
  labelCompact: {
    fontSize: rf(11),
  },
  value: {
    fontSize: rf(13),
    fontWeight: "700",
  },
  valueCompact: {
    fontSize: rf(12),
  },
  total: {
    fontSize: rf(14),
    fontWeight: "800",
  },
  prizeNote: {
    marginTop: 10,
    fontSize: rf(11),
    fontWeight: "700",
    color: CHECKOUT_GOLD,
  },
  insufficient: {
    marginTop: 8,
    fontSize: rf(11),
    fontWeight: "600",
    color: "#EF4444",
  },
});
