import React from "react";
import { View, Text, StyleSheet, ActivityIndicator, Pressable } from "react-native";
import type { CashChallengePaymentQuote } from "@/services/cashChallengeApi";
import { formatUsdFromDollars, refundBreakdownFromQuote } from "@/services/cashChallengeApi";
import { rf } from "@/utils/responsive";

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
  /** Small loading indicator in the fee area while a new quote is fetched. */
  loading?: boolean;
  /** Always show summary for this entry fee even if the quote request is pending/failed. */
  entryFeeDollars?: number | null;
  error?: string | null;
  onRetry?: () => void;
};

function quoteMatchesEntry(
  quote: CashChallengePaymentQuote | null,
  entryFeeDollars: number | null | undefined,
): quote is CashChallengePaymentQuote {
  if (!quote) return false;
  if (typeof entryFeeDollars !== "number" || !Number.isFinite(entryFeeDollars)) return true;
  const expectedCents = Math.round(entryFeeDollars * 100);
  return Math.round(quote.entryFeeCents ?? quote.entryFee * 100) === expectedCents;
}

export function CashChallengePaymentBreakdown({
  quote,
  colors,
  title = "Payment Summary",
  showPool = false,
  loading = false,
  entryFeeDollars,
  error = null,
  onRetry,
}: Props) {
  const hasEntry =
    typeof entryFeeDollars === "number" && Number.isFinite(entryFeeDollars) && entryFeeDollars > 0;
  const matchedQuote = quoteMatchesEntry(quote, entryFeeDollars) ? quote : null;

  if (!matchedQuote && !loading && !hasEntry && !error) return null;

  if (!matchedQuote) {
    return (
      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <View style={styles.titleRow}>
          <Text style={[styles.title, { color: colors.foreground, marginBottom: 0 }]}>{title}</Text>
          {loading ? <ActivityIndicator size="small" color={colors.primary} /> : null}
        </View>
        {hasEntry ? (
          <>
            <View style={styles.row}>
              <Text style={[styles.label, { color: colors.mutedForeground }]}>Entry Fee</Text>
              <Text style={[styles.value, { color: colors.foreground }]}>
                {formatUsdFromDollars(entryFeeDollars)}
              </Text>
            </View>
            <View style={[styles.divider, { backgroundColor: colors.border }]} />
            <View style={styles.row}>
              <Text style={[styles.label, { color: colors.mutedForeground }]}>
                Tax / Payment Processing Fee
              </Text>
              <Text style={[styles.value, { color: colors.mutedForeground }]}>
                {loading ? "…" : "—"}
              </Text>
            </View>
            <View style={[styles.divider, { backgroundColor: colors.border }]} />
            <View style={styles.row}>
              <Text style={[styles.label, { color: colors.mutedForeground }]}>
                Platform Service Fee
              </Text>
              <Text style={[styles.value, { color: colors.mutedForeground }]}>
                {loading ? "…" : "—"}
              </Text>
            </View>
            <View style={[styles.divider, { backgroundColor: colors.border }]} />
            <View style={styles.row}>
              <Text style={[styles.label, { color: colors.mutedForeground }]}>Total Payable</Text>
              <Text style={[styles.value, styles.total, { color: colors.mutedForeground }]}>
                {loading ? "…" : "—"}
              </Text>
            </View>
          </>
        ) : (
          <View style={styles.loadingRow}>
            <ActivityIndicator size="small" color={colors.primary} />
            <Text style={[styles.label, { color: colors.mutedForeground }]}>Updating fees…</Text>
          </View>
        )}
        {error ? (
          <View style={styles.errorBlock}>
            <Text style={styles.errorText}>{error}</Text>
            {onRetry ? (
              <Pressable onPress={onRetry} style={styles.retryBtn} accessibilityRole="button">
                <Text style={[styles.retryText, { color: colors.primary }]}>Retry</Text>
              </Pressable>
            ) : null}
          </View>
        ) : loading && hasEntry ? (
          <Text style={[styles.hint, { color: colors.mutedForeground }]}>Updating fees…</Text>
        ) : null}
      </View>
    );
  }

  const rows = [
    ...(showPool
      ? [
          { label: "Entry Fee", value: `${formatUsdFromDollars(matchedQuote.entryFee)} per player`, accent: false },
          { label: "Players", value: String(matchedQuote.numberOfPlayers), accent: false },
          { label: "Entry Pool / Prize Pool", value: formatUsdFromDollars(matchedQuote.prizePool), accent: true },
        ]
      : []),
    { label: "Entry Fee", value: formatUsdFromDollars(matchedQuote.entryFee), accent: false },
    {
      label: "Tax / Payment Processing Fee",
      value: formatUsdFromDollars(matchedQuote.paymentProcessingFee),
      accent: false,
    },
    {
      label: "Platform Service Fee",
      value: formatUsdFromDollars(matchedQuote.platformServiceFee),
      accent: false,
    },
    { label: "Total Payable", value: formatUsdFromDollars(matchedQuote.totalPayable), accent: true },
  ];

  const uniqueRows = showPool
    ? rows
    : rows.filter((r, i, arr) => arr.findIndex((x) => x.label === r.label) === i);

  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={styles.titleRow}>
        <Text style={[styles.title, { color: colors.foreground, marginBottom: 0 }]}>{title}</Text>
        {loading ? <ActivityIndicator size="small" color={colors.primary} /> : null}
      </View>
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
      {!matchedQuote.canAfford && (
        <Text style={[styles.insufficient, { color: "#EF4444" }]}>
          Insufficient balance. You need {formatUsdFromDollars(matchedQuote.totalPayable)}.
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
          <Text style={{ fontSize: rf(20) }}>{rankEmojis[i] ?? "🏅"}</Text>
          <View style={{ flex: 1 }}>
            <Text style={{ fontWeight: "700", color: colors.foreground }}>{slot.label}</Text>
            <Text style={{ fontSize: rf(12), color: colors.mutedForeground }}>{slot.percentage}% of pool</Text>
          </View>
          <Text style={{ fontWeight: "900", color: colors.primary }}>{formatUsdFromDollars(slot.amount)}</Text>
        </View>
      ))}
    </View>
  );
}

export function CashChallengeRefundBreakdown({
  breakdown,
  quote,
  colors,
}: {
  breakdown?: {
    amountPaid?: number;
    entryFee?: number;
    paymentProcessingFee?: number;
    platformServiceFee?: number;
    walletRefundAmount?: number;
  };
  quote?: CashChallengePaymentQuote | null;
  colors: {
    foreground: string;
    mutedForeground: string;
    primary: string;
    border: string;
    card: string;
    success?: string;
  };
}) {
  const resolved = quote
    ? refundBreakdownFromQuote(quote)
    : {
        amountPaid: breakdown?.amountPaid ?? 0,
        entryFee: breakdown?.entryFee ?? 0,
        paymentProcessingFee: breakdown?.paymentProcessingFee ?? 0,
        platformServiceFee: breakdown?.platformServiceFee ?? 0,
        walletRefundAmount: breakdown?.walletRefundAmount ?? breakdown?.entryFee ?? 0,
      };

  const rows = [
    { label: "Amount Paid", value: formatUsdFromDollars(resolved.amountPaid), accent: false },
    { label: "Entry Fee", value: formatUsdFromDollars(resolved.entryFee), accent: false },
    { label: "Tax / Payment Processing Fee", value: formatUsdFromDollars(resolved.paymentProcessingFee), accent: false },
    { label: "Platform Service Fee", value: formatUsdFromDollars(resolved.platformServiceFee), accent: false },
    { label: "Refund to Wallet", value: formatUsdFromDollars(resolved.walletRefundAmount), accent: true },
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
  title: { fontSize: rf(13), fontWeight: "700", marginBottom: 8 },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
    gap: 8,
  },
  loadingRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8 },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 6 },
  label: { fontSize: rf(13), flex: 1, paddingRight: 8 },
  value: { fontSize: rf(14), fontWeight: "600" },
  total: { fontSize: rf(16), fontWeight: "800" },
  divider: { height: 1 },
  insufficient: { marginTop: 10, fontSize: rf(12), fontWeight: "600" },
  hint: { marginTop: 8, fontSize: rf(12), fontWeight: "500" },
  errorBlock: { marginTop: 10, gap: 6 },
  errorText: { color: "#EF4444", fontSize: rf(12), fontWeight: "600" },
  retryBtn: { alignSelf: "flex-start", paddingVertical: 4 },
  retryText: { fontSize: rf(13), fontWeight: "700" },
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
