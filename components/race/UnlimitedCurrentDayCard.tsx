/**
 * Unlimited Live Race progress strip — compact calendar + day/goal layout
 * matching product Images 1 (eligible) & 2 (LOST). Unlimited-gated by caller.
 * Entire tile opens Challenge Progress (not only the info icon).
 */
import React, { memo } from "react";
import { Text, TouchableOpacity, View, StyleSheet } from "react-native";
import { Feather } from "@expo/vector-icons";
import type { UnlimitedViewerSchedule } from "@/utils/unlimitedViewerSchedule";
import type { PrizePoolEligibilityStatus } from "@/utils/unlimitedResults";
import {
  UNLIMITED_COPY,
  isUnlimitedPrizeLost,
  missedDayFooterCopy,
  resolveUnlimitedMissedDayIndex,
} from "@/utils/unlimitedLiveUiCopy";
import type { UnlimitedDayRow } from "@/utils/unlimitedDayProgress";

type Props = {
  schedule: UnlimitedViewerSchedule;
  todaySteps: number;
  /** Opens Challenge Progress — wired to the whole tile. */
  onPressInfo?: () => void;
  eligibility?: PrizePoolEligibilityStatus;
  historyRows?: UnlimitedDayRow[] | null;
  qualificationStatus?: string | null;
  onPressViewResults?: () => void;
};

/** Compact calendar tile from the mock (green header + star). */
function CalendarGoalIcon() {
  return (
    <View style={cal.tile}>
      <View style={cal.header}>
        <View style={cal.ring} />
        <View style={cal.ring} />
      </View>
      <View style={cal.body}>
        <Text style={cal.star}>★</Text>
      </View>
    </View>
  );
}

const cal = StyleSheet.create({
  tile: {
    width: 48,
    height: 48,
    borderRadius: 12,
    overflow: "hidden",
    borderWidth: 1.5,
    borderColor: "rgba(124,58,255,0.7)",
    backgroundColor: "#1A1030",
  },
  header: {
    height: 13,
    backgroundColor: "#00E676",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  ring: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: "rgba(255,255,255,0.9)",
  },
  body: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#0E0A18",
  },
  star: {
    fontSize: 18,
    color: "#A78BFA",
    fontWeight: "900",
    marginTop: -1,
  },
});

export const UnlimitedCurrentDayCard = memo(function UnlimitedCurrentDayCard({
  schedule,
  todaySteps,
  onPressInfo,
  eligibility,
  historyRows,
  qualificationStatus,
  onPressViewResults,
}: Props) {
  const beforeStart = schedule.viewerStatus === "scheduled";
  const finished =
    schedule.viewerStatus === "completed" ||
    schedule.viewerStatus === "failed" ||
    schedule.viewerStatus === "left";
  const lost = isUnlimitedPrizeLost({
    eligibility,
    qualificationStatus,
    viewerStatus: schedule.viewerStatus,
  });
  const missedDay = resolveUnlimitedMissedDayIndex({
    historyRows,
    schedule,
    eligibility,
  });
  const daysLeft = schedule.remainingDaysAfterToday;
  const displaySteps = beforeStart ? 0 : todaySteps;
  const footerLabel = lost
    ? missedDayFooterCopy(missedDay)
    : UNLIMITED_COPY.missADayOut;

  const body = (
    <>
      <View style={styles.row}>
        <CalendarGoalIcon />

        <View style={styles.mid}>
          {/* Day N of Y is intentionally omitted here — shown in Challenge Progress only. */}
          {!beforeStart ? (
            <>
              <Text style={styles.goalLabel} numberOfLines={1}>
                {UNLIMITED_COPY.todayGoal}
              </Text>
              <Text style={styles.stepsLine} numberOfLines={1}>
                <Text style={styles.stepsNow}>{displaySteps.toLocaleString()}</Text>
                <Text style={styles.stepsGoal}>
                  {" "}/ {schedule.dailyGoalSteps.toLocaleString()}
                </Text>
              </Text>
            </>
          ) : (
            <Text style={styles.goalLabel} numberOfLines={1}>
              Starts at your local midnight
            </Text>
          )}
        </View>

        <View style={styles.right}>
          {lost ? (
            <View style={styles.lostBadge}>
              <Text style={styles.lostBadgeText}>{UNLIMITED_COPY.lostBadge}</Text>
            </View>
          ) : null}
          {!finished ? (
            <View style={styles.flameRow}>
              <Text style={styles.flameEmoji}>🔥</Text>
              <Text style={styles.daysLeft}>
                {daysLeft} {daysLeft === 1 ? "day" : "days"} left
              </Text>
            </View>
          ) : null}
          {/* Eligible mock: miss-a-day sits under flame on the right */}
          {!lost ? (
            <View style={styles.rightFooter}>
              <Text style={styles.footerText} numberOfLines={1}>
                {footerLabel}
              </Text>
              <Feather name="info" size={12} color="#4DA3FF" />
            </View>
          ) : null}
        </View>
      </View>

      {/* LOST mock: full-width muted footer under the row */}
      {lost ? (
        <View style={styles.lostFooter}>
          <Text style={styles.lostFooterText} numberOfLines={1}>
            {footerLabel}
          </Text>
          <Feather name="info" size={12} color="#4DA3FF" />
        </View>
      ) : null}
    </>
  );

  return (
    <View style={styles.card}>
      {onPressInfo ? (
        <TouchableOpacity
          onPress={onPressInfo}
          activeOpacity={0.85}
          accessibilityLabel="Challenge progress details"
          accessibilityRole="button"
        >
          {body}
        </TouchableOpacity>
      ) : (
        body
      )}

      {finished && onPressViewResults ? (
        <TouchableOpacity style={styles.viewResultsBtn} onPress={onPressViewResults}>
          <Text style={styles.viewResultsText}>View Results</Text>
          <Feather name="arrow-right" size={13} color="#0B0F1A" />
        </TouchableOpacity>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  card: {
    marginHorizontal: 12,
    marginTop: 0,
    marginBottom: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
    minHeight: 64,
    borderRadius: 16,
    backgroundColor: "#12151C",
    borderWidth: 1,
    borderColor: "rgba(124,58,255,0.45)",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  mid: {
    flex: 1,
    minWidth: 0,
    justifyContent: "center",
    gap: 3,
  },
  goalLabel: {
    fontSize: 13,
    fontWeight: "700",
    color: "#E2E8F8",
  },
  stepsLine: {
    marginTop: 1,
  },
  stepsNow: {
    fontSize: 18,
    fontWeight: "800",
    color: "#00E676",
  },
  stepsGoal: {
    fontSize: 15,
    fontWeight: "600",
    color: "#C7CDDA",
  },
  right: {
    alignItems: "flex-end",
    justifyContent: "center",
    gap: 4,
    maxWidth: "42%",
  },
  lostBadge: {
    backgroundColor: "#FF3B3B",
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  lostBadgeText: {
    fontSize: 9,
    fontWeight: "900",
    color: "#FFFFFF",
    letterSpacing: 0.2,
  },
  flameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
  },
  flameEmoji: {
    fontSize: 13,
  },
  daysLeft: {
    fontSize: 12,
    fontWeight: "800",
    color: "#FFB020",
  },
  rightFooter: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: 2,
  },
  footerText: {
    fontSize: 11,
    fontWeight: "600",
    color: "#A8B0C4",
  },
  lostFooter: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 4,
    marginTop: 8,
  },
  lostFooterText: {
    fontSize: 11,
    fontWeight: "600",
    color: "#8B9AC0",
    flexShrink: 1,
    textAlign: "right",
  },
  viewResultsBtn: {
    marginTop: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    backgroundColor: "#00E676",
    borderRadius: 10,
    paddingVertical: 8,
  },
  viewResultsText: { fontSize: 13, fontWeight: "800", color: "#0B0F1A" },
});
