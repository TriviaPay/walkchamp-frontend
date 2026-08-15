/**
 * Unlimited Live Race progress strip — compact calendar + day/goal layout
 * matching product Images 1 (eligible) & 2 (LOST). Unlimited-gated by caller.
 * Entire tile opens Challenge Progress (not only the info icon).
 */
import React, { memo } from "react";
import { Image, Text, TouchableOpacity, View, StyleSheet } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useTheme } from "@/context/ThemeContext";
import type { UnlimitedViewerSchedule } from "@/utils/unlimitedViewerSchedule";
import type { PrizePoolEligibilityStatus } from "@/utils/unlimitedResults";
import {
  UNLIMITED_COPY,
  isUnlimitedPrizeLost,
  missedDayFooterCopy,
  resolveUnlimitedMissedDayIndex,
} from "@/utils/unlimitedLiveUiCopy";
import {
  remainingDaysAfterDisplayDay,
  resolveUnlimitedDisplayDayIndex,
  type UnlimitedDayRow,
} from "@/utils/unlimitedDayProgress";
import { resolveStreakDetailUiBranch } from "@/utils/unlimitedStreakParticipation";
import { rf } from "@/utils/responsive";
import { streakIconSource } from "@/utils/brandImages";

type Props = {
  schedule: UnlimitedViewerSchedule;
  todaySteps: number;
  /** Opens Challenge Progress — wired to the whole tile. */
  onPressInfo?: () => void;
  eligibility?: PrizePoolEligibilityStatus;
  historyRows?: UnlimitedDayRow[] | null;
  qualificationStatus?: string | null;
  onPressViewResults?: () => void;
  viewerResultsReady?: boolean | null;
  viewerResultReasonCode?: string | null;
  resultsStatus?: string | null;
};

/** Compact calendar tile — green header + current day number (1–99). */
function CalendarGoalIcon({ dayNumber }: { dayNumber: number }) {
  const day = Math.max(1, Math.min(99, Math.floor(dayNumber || 1)));
  const twoDigit = day >= 10;
  return (
    <View style={cal.tile}>
      <View style={cal.header}>
        <View style={cal.ring} />
        <View style={cal.ring} />
      </View>
      <View style={cal.body}>
        <Text
          style={[cal.dayNum, twoDigit && cal.dayNumTwoDigit]}
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.7}
        >
          {day}
        </Text>
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
    paddingHorizontal: 2,
  },
  dayNum: {
    fontSize: rf(18),
    color: "#A78BFA",
    fontWeight: "900",
    marginTop: -1,
    textAlign: "center",
    includeFontPadding: false,
  },
  dayNumTwoDigit: {
    fontSize: rf(15),
    letterSpacing: -0.5,
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
  viewerResultsReady,
  viewerResultReasonCode,
  resultsStatus,
}: Props) {
  const { isDark } = useTheme();
  const uiBranch = resolveStreakDetailUiBranch({
    viewerResultsReady,
    viewerResultReasonCode,
    viewerStatus: schedule.viewerStatus,
    resultsStatus,
  });
  const beforeStart = schedule.viewerStatus === "scheduled";
  const left = schedule.viewerStatus === "left";
  const finished = uiBranch === "final" || left || schedule.viewerStatus === "completed";
  const lost = uiBranch === "broken" || isUnlimitedPrizeLost({
    eligibility,
    qualificationStatus,
    viewerStatus: schedule.viewerStatus,
  });
  const missedDay = resolveUnlimitedMissedDayIndex({
    historyRows,
    schedule,
    eligibility,
  });
  const displayDay = resolveUnlimitedDisplayDayIndex(schedule, historyRows);
  const daysLeft = remainingDaysAfterDisplayDay(schedule.durationDays, displayDay);
  const displaySteps = beforeStart ? 0 : todaySteps;
  const footerLabel = lost
    ? missedDayFooterCopy(missedDay)
    : UNLIMITED_COPY.missADayOut;

  const body = (
    <>
      <View style={styles.row}>
        <CalendarGoalIcon dayNumber={displayDay} />

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
              <Image
                source={streakIconSource({ completed: !lost, isDark })}
                style={{ width: 14, height: 14 }}
                resizeMode="contain"
              />
              <Text style={styles.daysLeft}>
                {daysLeft} {daysLeft === 1 ? "day" : "days"} left
              </Text>
            </View>
          ) : null}
          {/* Eligible mock: miss-a-day sits under flame on the right */}
          {!lost ? (
            <TouchableOpacity
              onPress={onPressInfo}
              disabled={!onPressInfo}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              style={styles.rightFooter}
              accessibilityRole="button"
              accessibilityLabel="View challenge progress"
            >
              <Text style={styles.footerText} numberOfLines={1}>
                {footerLabel}
              </Text>
              <Feather name="info" size={16} color="#4DA3FF" />
            </TouchableOpacity>
          ) : null}
        </View>
      </View>

      {/* LOST mock: full-width muted footer under the row */}
      {lost ? (
        <TouchableOpacity
          onPress={onPressInfo}
          disabled={!onPressInfo}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          style={styles.lostFooter}
          accessibilityRole="button"
          accessibilityLabel="View challenge progress"
        >
          <Text style={styles.lostFooterText} numberOfLines={1}>
            {footerLabel}
          </Text>
          <Feather name="info" size={16} color="#4DA3FF" />
        </TouchableOpacity>
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

      {lost && onPressViewResults ? (
        <TouchableOpacity style={styles.viewResultsBtn} onPress={onPressViewResults}>
          <Text style={styles.viewResultsText}>View Results</Text>
          <Feather name="arrow-right" size={13} color="#0B0F1A" />
        </TouchableOpacity>
      ) : finished && onPressViewResults ? (
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
    fontSize: rf(13),
    fontWeight: "700",
    color: "#E2E8F8",
  },
  stepsLine: {
    marginTop: 1,
  },
  stepsNow: {
    fontSize: rf(18),
    fontWeight: "800",
    color: "#00E676",
  },
  stepsGoal: {
    fontSize: rf(15),
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
    fontSize: rf(9),
    fontWeight: "900",
    color: "#FFFFFF",
    letterSpacing: 0.2,
  },
  flameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
  },
  daysLeft: {
    fontSize: rf(12),
    fontWeight: "800",
    color: "#FFB020",
  },
  rightFooter: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 2,
    minHeight: 28,
    paddingVertical: 4,
  },
  footerText: {
    fontSize: rf(11),
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
    fontSize: rf(11),
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
  viewResultsText: { fontSize: rf(13), fontWeight: "800", color: "#0B0F1A" },
});
