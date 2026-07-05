import React from "react";
import { View, Text, StyleSheet } from "react-native";
import type { CashChallengePaymentQuote } from "@/services/cashChallengeApi";
import { formatUsdFromDollars } from "@/services/cashChallengeApi";

type Props = {
  quote: CashChallengePaymentQuote | null;
  colors: {
    foreground: string;
    mutedForeground: string;
    primary: string;
    border: string;
    card: string;
    gold?: string;
  };
  title?: string;
  showPool?: boolean;
};

export function CashChallengePaymentBreakdown({
  quote,
  colors,
  title = "Payment Breakdown",
  showPool = false,
}: Props) {
  if (!quote) return null;

  const rows = [
    ...(showPool
      ? [
          { label: "Entry Fee", value: `${formatUsdFromDollars(quote.entryFee)} per player`, accent: false },
          { label: "Players", value: String(quote.numberOfPlayers), accent: false },
          { label: "Entry Pool / Prize Pool", value: formatUsdFromDollars(quote.prizePool), accent: true },
        ]
      : []),
    { label: "Entry Fee", value: formatUsdFromDollars(quote.entryFee), accent: false },
    {
      label: "Tax / Payment Processing Fee",
      value: formatUsdFromDollars(quote.paymentProcessingFee),
      accent: false,
    },
    {
      label: "Platform Service Fee",
      value: formatUsdFromDollars(quote.platformServiceFee),
      accent: false,
    },
    { label: "Total Payable", value: formatUsdFromDollars(quote.totalPayable), accent: true },
  ];

  const uniqueRows = showPool
    ? rows
    : rows.filter((r, i, arr) => arr.findIndex((x) => x.label === r.label) === i);

  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <Text style={[styles.title, { color: colors.foreground }]}>{title}</Text>
      {uniqueRows.map((row, i) => (
        <View key={`${row.label}-${i}`}>
          {i > 0 && <View style={[styles.divider, { backgroundColor: colors.border }]} />}
          <View style={styles.row}>
            <Text style={[styles.label, { color: colors.mutedForeground }]}>{row.label}</Text>
            <Text
              style={[
                styles.value,
                { color: row.accent ? colors.primary : colors.foreground },
                row.label === "Total Payable" && styles.total,
              ]}
            >
              {row.value}
            </Text>
          </View>
        </View>
      ))}
      {!quote.canAfford && (
        <Text style={[styles.insufficient, { color: "#EF4444" }]}>
          Insufficient balance. You need {formatUsdFromDollars(quote.totalPayable)}.
        </Text>
      )}
    </View>
  );
}

export function CashChallengeRewardSplit({
  quote,
  colors,
}: {
  quote: CashChallengePaymentQuote | null;
  colors: { foreground: string; mutedForeground: string; primary: string; border: string; card: string };
}) {
  if (!quote || quote.rewardSplit.length === 0) return null;
  const rankEmojis = ["🥇", "🥈", "🥉"];
  return (
    <View style={{ marginTop: 8 }}>
      <Text style={[styles.title, { color: colors.mutedForeground, marginBottom: 8 }]}>Reward Split</Text>
      {quote.rewardSplit.map((slot, i) => (
        <View
          key={slot.rank}
          style={[styles.splitRow, { backgroundColor: colors.card, borderColor: colors.border }]}
        >
          <Text style={{ fontSize: 20 }}>{rankEmojis[i] ?? "🏅"}</Text>
          <View style={{ flex: 1 }}>
            <Text style={{ fontWeight: "700", color: colors.foreground }}>{slot.label}</Text>
            <Text style={{ fontSize: 12, color: colors.mutedForeground }}>{slot.percentage}% of pool</Text>
          </View>
          <Text style={{ fontWeight: "900", color: colors.primary }}>{formatUsdFromDollars(slot.amount)}</Text>
        </View>
      ))}
    </View>
  );
}

export function CashChallengeRefundBreakdown({
  breakdown,
  colors,
}: {
  breakdown: {
    amountPaid: number;
    entryFee: number;
    paymentProcessingFee: number;
    platformServiceFee: number;
    walletRefundAmount: number;
  };
  colors: {
    foreground: string;
    mutedForeground: string;
    primary: string;
    border: string;
    card: string;
    success?: string;
  };
}) {
  const rows = [
    { label: "Amount Paid", value: formatUsdFromDollars(breakdown.amountPaid), accent: false },
    { label: "Entry Fee", value: formatUsdFromDollars(breakdown.entryFee), accent: false },
    { label: "Tax / Payment Processing Fee", value: formatUsdFromDollars(breakdown.paymentProcessingFee), accent: false },
    { label: "Platform Service Fee", value: formatUsdFromDollars(breakdown.platformServiceFee), accent: false },
    { label: "Refund to Wallet", value: formatUsdFromDollars(breakdown.walletRefundAmount), accent: true },
  ];

  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <Text style={[styles.title, { color: colors.foreground }]}>Refund Breakdown</Text>
      {rows.map((row, i) => (
        <View key={row.label}>
          {i > 0 && <View style={[styles.divider, { backgroundColor: colors.border }]} />}
          <View style={styles.row}>
            <Text style={[styles.label, { color: colors.mutedForeground }]}>{row.label}</Text>
            <Text
              style={[
                styles.value,
                {
                  color: row.label === "Refund to Wallet"
                    ? colors.success ?? colors.primary
                    : row.accent
                      ? colors.primary
                      : colors.foreground,
                },
                row.label === "Refund to Wallet" && styles.total,
              ]}
            >
              {row.value}
            </Text>
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 14, borderWidth: 1, padding: 14, marginBottom: 12 },
  title: { fontSize: 13, fontWeight: "700", marginBottom: 8 },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 6 },
  label: { fontSize: 13, flex: 1, paddingRight: 8 },
  value: { fontSize: 14, fontWeight: "600" },
  total: { fontSize: 16, fontWeight: "800" },
  divider: { height: 1 },
  insufficient: { marginTop: 10, fontSize: 12, fontWeight: "600" },
  splitRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
  },
});
