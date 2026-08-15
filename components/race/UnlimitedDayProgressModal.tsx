/**
 * Challenge Progress modal — Image 1 (Unlimited only).
 * Full duration day strip + circular step ring on the current day.
 * Opened from the entire Unlimited progress tile (not only the info icon).
 */
import React, { useMemo } from "react";
import {
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import Svg, { Circle } from "react-native-svg";
import { BlueShoe } from "@/components/BlueShoe";
import type { UnlimitedViewerSchedule } from "@/utils/unlimitedViewerSchedule";
import {
  buildUnlimitedDayRows,
  mergeUnlimitedHistoryWithSchedule,
  remainingDaysAfterDisplayDay,
  resolveUnlimitedDisplayDayIndex,
  type UnlimitedDayRow,
  type UnlimitedDayStatus,
} from "@/utils/unlimitedDayProgress";
import { UNLIMITED_COPY } from "@/utils/unlimitedLiveUiCopy";
import { rf } from "@/utils/responsive";

export type { UnlimitedDayStatus, UnlimitedDayRow } from "@/utils/unlimitedDayProgress";

type Props = {
  visible: boolean;
  onClose: () => void;
  schedule: UnlimitedViewerSchedule | null;
  todaySteps: number;
  historyRows?: UnlimitedDayRow[] | null;
};

/** Compact step progress ring for the current-day cell (Image 1). */
function MiniStepRing({
  progress,
  size = 28,
  stroke = 3,
  color = "#00E676",
  trackColor = "#2A3348",
}: {
  progress: number;
  size?: number;
  stroke?: number;
  color?: string;
  trackColor?: string;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = Math.min(1, Math.max(0, progress));
  return (
    <Svg width={size} height={size}>
      <Circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        stroke={trackColor}
        strokeWidth={stroke}
        fill="none"
      />
      <Circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        stroke={color}
        strokeWidth={stroke}
        fill="none"
        strokeDasharray={`${c * pct} ${c * (1 - pct)}`}
        strokeLinecap="round"
        rotation="-90"
        origin={`${size / 2}, ${size / 2}`}
      />
    </Svg>
  );
}

function DayCell({
  row,
  todaySteps,
  isCurrent,
  cellWidth,
}: {
  row: UnlimitedDayRow;
  todaySteps: number;
  isCurrent: boolean;
  cellWidth: number;
}) {
  const steps =
    typeof row.verifiedSteps === "number"
      ? row.verifiedSteps
      : isCurrent
        ? todaySteps
        : null;
  const failed = row.status === "failed";
  const passed = row.status === "passed";
  const upcoming = row.status === "upcoming";
  const validating = row.status === "validation_pending";
  const inProgress = isCurrent && !passed && !failed;
  const goal = row.dailyGoalSteps > 0 ? row.dailyGoalSteps : 1;
  const ringProgress = inProgress
    ? Math.min(1, Math.max(0, (steps ?? 0) / goal))
    : 0;

  const borderColor = failed
    ? "#FF4444"
    : inProgress || passed
      ? "#00E676"
      : "#5A6A8A";

  return (
    <View
      style={[
        styles.dayCell,
        { width: cellWidth, borderColor },
        upcoming && styles.dayCellUpcoming,
        inProgress && styles.dayCellCurrent,
        failed && styles.dayCellFailed,
      ]}
    >
      <Text style={styles.dayCellLabel} numberOfLines={1}>
        Day {row.dayNumber}
      </Text>

      {passed ? (
        <View style={[styles.dayIconCircle, styles.dayIconPassed]}>
          <Feather name="check" size={14} color="#0B0F1A" />
        </View>
      ) : failed ? (
        <View style={[styles.dayIconCircle, styles.dayIconFailed]}>
          <Feather name="x" size={14} color="#fff" />
        </View>
      ) : inProgress ? (
        <MiniStepRing progress={ringProgress} size={28} stroke={3} />
      ) : validating ? (
        <View style={[styles.dayIconCircle, styles.dayIconDashed]}>
          <Feather name="clock" size={12} color="#6B7A99" />
        </View>
      ) : (
        <View style={[styles.dayIconCircle, styles.dayIconDashed]} />
      )}

      {failed ? (
        <Text style={styles.dayMissed}>Missed</Text>
      ) : upcoming ? (
        <Text style={styles.dayStepsMuted}>Upcoming</Text>
      ) : validating && steps == null ? (
        <Text style={styles.dayStepsMuted}>Pending</Text>
      ) : steps != null ? (
        <Text style={[styles.daySteps, failed && { color: "#FF6B6B" }]} numberOfLines={1}>
          {steps.toLocaleString()}
        </Text>
      ) : (
        <Text style={styles.dayStepsMuted}>Upcoming</Text>
      )}
    </View>
  );
}

function DayStrip({
  rows,
  schedule,
  todaySteps,
  cellWidth,
  displayDay,
}: {
  rows: UnlimitedDayRow[];
  schedule: UnlimitedViewerSchedule | null;
  todaySteps: number;
  cellWidth: number;
  displayDay: number;
}) {
  return (
    <ScrollView
      horizontal
      nestedScrollEnabled
      showsHorizontalScrollIndicator={false}
      decelerationRate="normal"
      disableIntervalMomentum
      snapToInterval={cellWidth + 6}
      snapToAlignment="start"
      contentContainerStyle={styles.dayRowScroll}
    >
      {rows.map((item) => (
        <DayCell
          key={`d-${item.dayNumber}`}
          row={item}
          todaySteps={todaySteps}
          isCurrent={!!schedule && item.dayNumber === displayDay}
          cellWidth={cellWidth}
        />
      ))}
    </ScrollView>
  );
}

export function UnlimitedDayProgressModal({
  visible,
  onClose,
  schedule,
  todaySteps,
  historyRows,
}: Props) {
  const { width: winW } = useWindowDimensions();
  const sheetWidth = Math.min(winW - 32, 420);
  const rows = useMemo(() => {
    if (!schedule) {
      return historyRows && historyRows.length > 0 ? historyRows : [];
    }
    if (historyRows && historyRows.length > 0) {
      return mergeUnlimitedHistoryWithSchedule(historyRows, schedule, todaySteps);
    }
    return buildUnlimitedDayRows(schedule, todaySteps);
  }, [historyRows, schedule, todaySteps]);
  const displayDay = schedule
    ? resolveUnlimitedDisplayDayIndex(schedule, historyRows)
    : 1;
  const daysLeft = schedule
    ? remainingDaysAfterDisplayDay(schedule.durationDays, displayDay)
    : 0;
  const goal = schedule?.dailyGoalSteps ?? rows[0]?.dailyGoalSteps ?? 0;
  const pct = goal > 0 ? Math.min(1, todaySteps / goal) : 0;

  // Always horizontal-scroll so Day 1…N slots slide (7d and longer).
  const cellWidth = 56;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={[styles.sheet, { width: sheetWidth }]}>
          <TouchableOpacity
            style={styles.closeBtn}
            onPress={onClose}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            accessibilityLabel="Close"
          >
            <Feather name="x" size={20} color="#E2E8F8" />
          </TouchableOpacity>

          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.scrollContent}
          >
            {/* Image 1 header: title → shoe ring → brand → Day N of Y */}
            <Text style={styles.modalTitle}>{UNLIMITED_COPY.modalTitle}</Text>
            <View style={styles.heroIcon}>
              <View style={styles.heroRing}>
                <BlueShoe size={36} />
              </View>
            </View>
            <Text style={styles.brand}>
              {UNLIMITED_COPY.modalBrand}{" "}
              <Text style={styles.infinity}>∞</Text>
            </Text>
            {schedule ? (
              <Text style={styles.dayOf}>
                Day {displayDay} of {schedule.durationDays}
              </Text>
            ) : null}

            <View style={styles.todayCard}>
              <Text style={styles.todayLabel}>{UNLIMITED_COPY.todayGoal}</Text>
              <Text style={styles.todayValue}>
                <Text style={styles.todaySteps}>{todaySteps.toLocaleString()}</Text>
                <Text style={styles.todayGoal}> / {goal.toLocaleString()}</Text>
              </Text>
              <View style={styles.barBg}>
                <View style={[styles.barFill, { width: `${Math.round(pct * 100)}%` as `${number}%` }]} />
              </View>
              <View style={styles.remainRow}>
                <Feather name="clock" size={12} color="#8B9AC0" />
                <Text style={styles.remainText}>
                  {daysLeft} {daysLeft === 1 ? "day" : "days"} remaining
                </Text>
              </View>
            </View>

            <View style={styles.section}>
              <DayStrip
                rows={rows}
                schedule={schedule}
                todaySteps={todaySteps}
                cellWidth={cellWidth}
                displayDay={displayDay}
              />
            </View>

            <View style={styles.warnBox}>
              <Feather name="alert-triangle" size={16} color="#FF6B6B" />
              <Text style={styles.warnText}>{UNLIMITED_COPY.modalWarning}</Text>
            </View>
            <View style={styles.infoBox}>
              <Feather name="award" size={16} color="#5B9CFF" />
              <Text style={styles.infoText}>
                {UNLIMITED_COPY.modalInfoPrefix}
                <Text style={styles.infoHighlight}>{UNLIMITED_COPY.modalInfoHighlight}</Text>
                .
              </Text>
            </View>
          </ScrollView>

          <TouchableOpacity style={styles.cta} onPress={onClose} activeOpacity={0.85}>
            <Text style={styles.ctaText}>{UNLIMITED_COPY.modalCta}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    // Solid — blocks the Neon Finish track’s pentagon mesh from showing through.
    backgroundColor: "#050711",
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 16,
  },
  sheet: {
    maxWidth: 420,
    maxHeight: "90%",
    backgroundColor: "#12151F",
    borderRadius: 22,
    borderWidth: 1,
    borderColor: "rgba(0,230,118,0.2)",
    paddingTop: 16,
    paddingBottom: 14,
    paddingHorizontal: 16,
    overflow: "hidden",
  },
  closeBtn: { position: "absolute", top: 14, right: 14, zIndex: 2, padding: 4 },
  scrollContent: { paddingTop: 4, paddingBottom: 8, gap: 12 },
  modalTitle: {
    textAlign: "center",
    fontSize: rf(18),
    fontWeight: "800",
    color: "#FFFFFF",
    marginTop: 2,
    marginBottom: 4,
  },
  heroIcon: {
    alignItems: "center",
    justifyContent: "center",
    height: 88,
    marginTop: 2,
  },
  heroRing: {
    width: 76,
    height: 76,
    borderRadius: 38,
    borderWidth: 3,
    borderColor: "#00E676",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,230,118,0.08)",
  },
  brand: {
    textAlign: "center",
    fontSize: rf(17),
    fontWeight: "800",
    color: "#FFFFFF",
    marginTop: -2,
  },
  infinity: { color: "#A78BFA", fontWeight: "900" },
  dayOf: {
    textAlign: "center",
    fontSize: rf(14),
    fontWeight: "800",
    color: "#00E676",
    marginTop: -4,
  },
  todayCard: {
    backgroundColor: "#0B0E16",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.06)",
    padding: 14,
    gap: 8,
  },
  todayLabel: { fontSize: rf(12), color: "#8B9AC0", fontWeight: "600" },
  todayValue: {},
  todaySteps: { fontSize: rf(28), fontWeight: "800", color: "#00E676" },
  todayGoal: { fontSize: rf(20), fontWeight: "700", color: "#FFFFFF" },
  barBg: {
    height: 10,
    borderRadius: 999,
    backgroundColor: "#1E2436",
    overflow: "hidden",
  },
  barFill: { height: "100%", backgroundColor: "#00E676", borderRadius: 999 },
  remainRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  remainText: { fontSize: rf(12), color: "#8B9AC0", fontWeight: "600" },
  section: { gap: 6 },
  dayRowScroll: {
    flexDirection: "row",
    alignItems: "stretch",
    gap: 6,
    paddingVertical: 2,
    paddingRight: 8,
  },
  dayCell: {
    minHeight: 96,
    borderRadius: 14,
    borderWidth: 1.5,
    backgroundColor: "#0B0E16",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 8,
    paddingHorizontal: 2,
    gap: 6,
  },
  dayCellUpcoming: {
    borderColor: "#3A4258",
  },
  dayCellCurrent: {
    borderWidth: 2,
  },
  dayCellFailed: { backgroundColor: "rgba(255,68,68,0.08)" },
  dayCellLabel: { fontSize: rf(10), fontWeight: "700", color: "#C7CDDA" },
  dayIconCircle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "transparent",
  },
  dayIconPassed: { backgroundColor: "#00E676" },
  dayIconFailed: { backgroundColor: "#FF4444" },
  dayIconDashed: {
    borderWidth: 1.5,
    borderColor: "#5A6A8A",
    borderStyle: "dashed",
  },
  daySteps: { fontSize: rf(10), fontWeight: "800", color: "#00E676" },
  dayStepsMuted: { fontSize: rf(9), fontWeight: "700", color: "#6B7A99" },
  dayMissed: { fontSize: rf(10), fontWeight: "800", color: "#FF6B6B" },
  warnBox: {
    flexDirection: "row",
    gap: 10,
    alignItems: "flex-start",
    backgroundColor: "rgba(255,68,68,0.12)",
    borderWidth: 1,
    borderColor: "rgba(255,68,68,0.45)",
    borderRadius: 12,
    padding: 12,
  },
  warnText: { flex: 1, fontSize: rf(13), fontWeight: "600", color: "#FFB4B4", lineHeight: 18 },
  infoBox: {
    flexDirection: "row",
    gap: 10,
    alignItems: "flex-start",
    backgroundColor: "rgba(59,130,246,0.12)",
    borderWidth: 1,
    borderColor: "rgba(91,156,255,0.45)",
    borderRadius: 12,
    padding: 12,
  },
  infoText: { flex: 1, fontSize: rf(13), fontWeight: "600", color: "#B7D0FF", lineHeight: 18 },
  infoHighlight: { color: "#7EB6FF", fontWeight: "800" },
  cta: {
    marginTop: 10,
    height: 48,
    borderRadius: 14,
    backgroundColor: "#00E676",
    alignItems: "center",
    justifyContent: "center",
  },
  ctaText: { fontSize: rf(16), fontWeight: "900", color: "#0B0F1A" },
});
