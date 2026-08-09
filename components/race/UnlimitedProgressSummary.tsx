/**
 * Compact "Daily Progress Summary" strip (spec §14) shown above the day-by-day
 * history in both the Unlimited Daily Progress modal and the Unlimited Results
 * screen. Values are derived from `buildUnlimitedDaySummary` (backend-aggregate
 * driven — never an independent frontend pass/fail count used as prize
 * authority, see utils/unlimitedResults.ts).
 */
import React, { memo } from "react";
import { StyleSheet, Text, View } from "react-native";
import type { UnlimitedDaySummary } from "@/utils/unlimitedDayProgress";
import { liveEligibilityLabel, type PrizePoolEligibilityStatus } from "@/utils/unlimitedResults";

type Props = {
  summary: UnlimitedDaySummary;
  eligibility: PrizePoolEligibilityStatus;
  /** True once results are fully final — swaps "Still Eligible" wording for the settled label. */
  resultsFinal?: boolean;
};

export const UnlimitedProgressSummary = memo(function UnlimitedProgressSummary({
  summary,
  eligibility,
  resultsFinal = false,
}: Props) {
  const eligibilityText = resultsFinal
    ? eligibility === "eligible"
      ? "Prize Pool Eligible"
      : "Prize Pool Not Eligible"
    : liveEligibilityLabel(eligibility);
  const eligibilityColor =
    eligibility === "not_eligible" ? "#FF4444" : eligibility === "eligible" ? "#00E676" : "#8FD3FF";

  return (
    <View style={styles.card}>
      <Text style={styles.heading}>Challenge Progress</Text>
      <View style={styles.grid}>
        <Stat label="Completed" value={`${summary.completedCount} / ${summary.durationDays}`} />
        <Stat label="Passed" value={String(summary.passedCount)} valueColor="#00E676" />
        <Stat label="Failed" value={String(summary.failedCount)} valueColor={summary.failedCount > 0 ? "#FF4444" : undefined} />
        <Stat label="Remaining" value={String(summary.remainingCount)} />
      </View>
      <View style={styles.eligibilityRow}>
        <Text style={styles.eligibilityLabel}>Eligibility</Text>
        <Text style={[styles.eligibilityValue, { color: eligibilityColor }]}>{eligibilityText}</Text>
      </View>
    </View>
  );
});

function Stat({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) {
  return (
    <View style={styles.stat}>
      <Text style={[styles.statValue, valueColor ? { color: valueColor } : null]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 14,
    backgroundColor: "rgba(20,24,40,0.85)",
    borderWidth: 1,
    borderColor: "rgba(124,58,255,0.3)",
    padding: 14,
    gap: 10,
    marginBottom: 10,
  },
  heading: { fontSize: 13, fontWeight: "800", color: "#E2E8F8" },
  grid: { flexDirection: "row", justifyContent: "space-between" },
  stat: { alignItems: "center", flex: 1 },
  statValue: { fontSize: 16, fontWeight: "800", color: "#fff" },
  statLabel: { fontSize: 10.5, color: "#8B9AC0", marginTop: 2, fontWeight: "600" },
  eligibilityRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.08)",
    paddingTop: 8,
  },
  eligibilityLabel: { fontSize: 12, color: "#8B9AC0", fontWeight: "600" },
  eligibilityValue: { fontSize: 13, fontWeight: "800" },
});
