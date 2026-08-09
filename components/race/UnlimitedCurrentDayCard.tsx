/**
 * Compact "current day" strip for the Unlimited Daily Goal Challenge Live Race
 * screen. Shows Day X of Y, today's goal progress, a live "ends in" countdown,
 * and remaining days — all derived from backend-authoritative fields via
 * `computeUnlimitedViewerSchedule` (never a raw Math.ceil on a shared UTC end
 * timestamp, and never the host's timezone).
 *
 * Before the viewer's own day starts, the same strip shows a "starts in"
 * countdown to `viewerStartAtMs` instead (per product spec §11).
 */
import React, { memo } from "react";
import { Text, TouchableOpacity, View, StyleSheet } from "react-native";
import { Feather } from "@expo/vector-icons";
import { CountdownText } from "@/components/perf/LiveClockText";
import {
  computeCountdownParts,
  formatCountdownClock,
  type UnlimitedViewerSchedule,
} from "@/utils/unlimitedViewerSchedule";
import { liveEligibilityLabel, type PrizePoolEligibilityStatus } from "@/utils/unlimitedResults";

type Props = {
  schedule: UnlimitedViewerSchedule;
  todaySteps: number;
  onPressProgress?: () => void;
  /** Prize-pool eligibility (spec §4, §15) — omit to hide the eligibility line. */
  eligibility?: PrizePoolEligibilityStatus;
  /** Shown once the viewer's own local duration has ended but results aren't final (spec §5). */
  onPressViewResults?: () => void;
};

export const UnlimitedCurrentDayCard = memo(function UnlimitedCurrentDayCard({
  schedule,
  todaySteps,
  onPressProgress,
  eligibility,
  onPressViewResults,
}: Props) {
  const beforeStart = schedule.viewerStatus === "scheduled";
  const finished =
    schedule.viewerStatus === "completed" ||
    schedule.viewerStatus === "failed" ||
    schedule.viewerStatus === "left";
  const targetMs = beforeStart ? schedule.viewerStartAtMs : schedule.currentDayEndAtMs;
  const goalReached = todaySteps >= schedule.dailyGoalSteps && schedule.dailyGoalSteps > 0;
  const eligibilityColor = eligibility === "not_eligible" ? "#FF4444" : "#8FD3FF";

  return (
    <TouchableOpacity
      style={styles.card}
      activeOpacity={onPressProgress ? 0.8 : 1}
      onPress={onPressProgress}
      disabled={!onPressProgress}
    >
      <View style={styles.row}>
        <View style={styles.dayPill}>
          <Text style={styles.dayPillText}>
            Day {schedule.currentDayIndex} of {schedule.durationDays}
          </Text>
        </View>
        {!finished ? (
          <View style={styles.timeLeftWrap}>
            <Feather name="clock" size={11} color="#8FD3FF" />
            <Text style={styles.timeLeftLabel}>
              {beforeStart ? "Starts in" : "Today ends in"}
            </Text>
            <CountdownText
              endMs={targetMs}
              format={(remainingMs) =>
                formatCountdownClock(computeCountdownParts(Date.now() + remainingMs))
              }
              style={styles.timeLeftValue}
            />
          </View>
        ) : (
          <Text style={styles.finishedLabel}>
            {schedule.viewerStatus === "completed" ? "Challenge complete" : "Challenge ended"}
          </Text>
        )}
        {onPressProgress ? <Feather name="chevron-right" size={16} color="#5A6A8A" /> : null}
      </View>

      {!beforeStart ? (
        <View style={styles.goalRow}>
          <Text style={styles.goalLabel}>Today</Text>
          <Text style={[styles.goalValue, goalReached && styles.goalValueMet]}>
            {todaySteps.toLocaleString()} / {schedule.dailyGoalSteps.toLocaleString()} steps
          </Text>
          {goalReached ? <Feather name="check-circle" size={13} color="#00E676" /> : null}
        </View>
      ) : null}

      {!finished ? (
        <Text style={styles.remainingLabel}>
          Remaining after today: {schedule.remainingDaysAfterToday}{" "}
          {schedule.remainingDaysAfterToday === 1 ? "day" : "days"}
        </Text>
      ) : null}

      {eligibility ? (
        <View style={styles.eligibilityRow}>
          <Feather
            name={eligibility === "not_eligible" ? "x-circle" : "shield"}
            size={11}
            color={eligibilityColor}
          />
          <Text style={[styles.eligibilityText, { color: eligibilityColor }]}>
            {liveEligibilityLabel(eligibility)}
          </Text>
        </View>
      ) : null}

      {finished && onPressViewResults ? (
        <TouchableOpacity style={styles.viewResultsBtn} onPress={onPressViewResults}>
          <Text style={styles.viewResultsText}>View Results</Text>
          <Feather name="arrow-right" size={13} color="#0B0F1A" />
        </TouchableOpacity>
      ) : null}
    </TouchableOpacity>
  );
});

const styles = StyleSheet.create({
  card: {
    marginHorizontal: 12,
    marginBottom: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 14,
    backgroundColor: "rgba(20,24,40,0.85)",
    borderWidth: 1,
    borderColor: "rgba(124,58,255,0.35)",
    gap: 6,
  },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  dayPill: {
    backgroundColor: "rgba(124,58,255,0.22)",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  dayPillText: { fontSize: 12, fontWeight: "800", color: "#C4B5FD" },
  timeLeftWrap: { flexDirection: "row", alignItems: "center", gap: 5, flex: 1 },
  timeLeftLabel: { fontSize: 11, color: "#8FD3FF", fontWeight: "600" },
  timeLeftValue: { fontSize: 13, color: "#fff", fontWeight: "800", fontVariant: ["tabular-nums"] },
  finishedLabel: { fontSize: 12, color: "#9AA5C0", fontWeight: "600", flex: 1 },
  goalRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  goalLabel: { fontSize: 12, color: "#8B9AC0", fontWeight: "600" },
  goalValue: { fontSize: 13, color: "#E2E8F8", fontWeight: "800" },
  goalValueMet: { color: "#00E676" },
  remainingLabel: { fontSize: 11, color: "#6B7FA8" },
  eligibilityRow: { flexDirection: "row", alignItems: "center", gap: 5 },
  eligibilityText: { fontSize: 11, fontWeight: "700" },
  viewResultsBtn: {
    marginTop: 2,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    backgroundColor: "#00E676",
    borderRadius: 10,
    paddingVertical: 9,
  },
  viewResultsText: { fontSize: 13, fontWeight: "800", color: "#0B0F1A" },
});
