/**
 * Challenge Progress modal — Image 3 (Unlimited only).
 * Opened from the progress card (i). Horizontal day cells; week sections for 30/60/90.
 */
import React, { useMemo } from "react";
import {
  FlatList,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { BlueShoe } from "@/components/BlueShoe";
import type { UnlimitedViewerSchedule } from "@/utils/unlimitedViewerSchedule";
import {
  buildUnlimitedDayRows,
  buildUnlimitedDayWeekSections,
  type UnlimitedDayRow,
  type UnlimitedDayStatus,
} from "@/utils/unlimitedDayProgress";
import { UNLIMITED_COPY } from "@/utils/unlimitedLiveUiCopy";

export type { UnlimitedDayStatus, UnlimitedDayRow } from "@/utils/unlimitedDayProgress";

type Props = {
  visible: boolean;
  onClose: () => void;
  schedule: UnlimitedViewerSchedule | null;
  todaySteps: number;
  historyRows?: UnlimitedDayRow[] | null;
};

function DayCell({
  row,
  todaySteps,
  isCurrent,
}: {
  row: UnlimitedDayRow;
  todaySteps: number;
  isCurrent: boolean;
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
  const inProgress = row.status === "in_progress" || isCurrent;

  const borderColor = failed
    ? "#FF4444"
    : inProgress || passed
      ? "#00E676"
      : "#3A4258";
  const iconColor = failed ? "#FF4444" : passed || inProgress ? "#00E676" : "#6B7A99";

  return (
    <View
      style={[
        styles.dayCell,
        { borderColor },
        inProgress && styles.dayCellCurrent,
        failed && styles.dayCellFailed,
      ]}
    >
      <Text style={styles.dayCellLabel}>Day {row.dayNumber}</Text>
      <View
        style={[
          styles.dayIconCircle,
          failed && { backgroundColor: "#FF4444" },
          passed && { backgroundColor: "#00E676" },
          (upcoming || validating) && styles.dayIconDashed,
          inProgress && !passed && !failed && { borderColor: "#00E676", borderWidth: 2 },
        ]}
      >
        {passed ? (
          <Feather name="check" size={14} color="#0B0F1A" />
        ) : failed ? (
          <Feather name="x" size={14} color="#fff" />
        ) : inProgress ? (
          <Feather name="loader" size={12} color={iconColor} />
        ) : (
          <View style={styles.dayIconDot} />
        )}
      </View>
      {steps != null && !upcoming ? (
        <Text style={[styles.daySteps, failed && { color: "#FF6B6B" }]}>
          {steps.toLocaleString()}
        </Text>
      ) : (
        <Text style={[styles.dayStepsMuted, failed && { color: "#FF6B6B" }]}>
          {failed ? "Missed" : validating ? "Pending" : "Upcoming"}
        </Text>
      )}
    </View>
  );
}

export function UnlimitedDayProgressModal({
  visible,
  onClose,
  schedule,
  todaySteps,
  historyRows,
}: Props) {
  const rows = useMemo(() => {
    if (historyRows && historyRows.length > 0) return historyRows;
    return schedule ? buildUnlimitedDayRows(schedule, todaySteps) : [];
  }, [historyRows, schedule, todaySteps]);
  const sections = useMemo(() => buildUnlimitedDayWeekSections(rows), [rows]);
  const daysLeft = schedule?.remainingDaysAfterToday ?? 0;
  const goal = schedule?.dailyGoalSteps ?? rows[0]?.dailyGoalSteps ?? 0;
  const pct = goal > 0 ? Math.min(1, todaySteps / goal) : 0;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
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
                Day {schedule.currentDayIndex} of {schedule.durationDays}
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

            {sections.map((section, sIdx) => (
              <View key={section.title ?? `s-${sIdx}`} style={styles.section}>
                {section.title ? <Text style={styles.weekHeader}>{section.title}</Text> : null}
                <FlatList
                  horizontal
                  data={section.data}
                  keyExtractor={(item) => `d-${item.dayNumber}`}
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.dayRow}
                  initialNumToRender={10}
                  windowSize={5}
                  renderItem={({ item }) => (
                    <DayCell
                      row={item}
                      todaySteps={todaySteps}
                      isCurrent={!!schedule && item.dayNumber === schedule.currentDayIndex}
                    />
                  )}
                />
              </View>
            ))}

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
    backgroundColor: "rgba(0,0,0,0.78)",
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 16,
  },
  sheet: {
    width: "100%",
    maxWidth: 420,
    maxHeight: "90%",
    backgroundColor: "#12151F",
    borderRadius: 22,
    borderWidth: 1,
    borderColor: "rgba(0,230,118,0.2)",
    paddingTop: 16,
    paddingBottom: 14,
    paddingHorizontal: 16,
  },
  closeBtn: { position: "absolute", top: 14, right: 14, zIndex: 2, padding: 4 },
  scrollContent: { paddingTop: 8, paddingBottom: 8, gap: 12 },
  heroIcon: { alignItems: "center", marginTop: 4 },
  heroRing: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 3,
    borderColor: "#00E676",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,230,118,0.08)",
  },
  brand: {
    textAlign: "center",
    fontSize: 17,
    fontWeight: "800",
    color: "#FFFFFF",
    marginTop: 8,
  },
  infinity: { color: "#A78BFA", fontWeight: "900" },
  dayOf: {
    textAlign: "center",
    fontSize: 14,
    fontWeight: "800",
    color: "#00E676",
    marginTop: 2,
  },
  todayCard: {
    backgroundColor: "#0B0E16",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.06)",
    padding: 14,
    gap: 8,
  },
  todayLabel: { fontSize: 12, color: "#8B9AC0", fontWeight: "600" },
  todayValue: {},
  todaySteps: { fontSize: 28, fontWeight: "800", color: "#00E676" },
  todayGoal: { fontSize: 20, fontWeight: "700", color: "#FFFFFF" },
  barBg: {
    height: 8,
    borderRadius: 999,
    backgroundColor: "#1E2436",
    overflow: "hidden",
  },
  barFill: { height: "100%", backgroundColor: "#00E676", borderRadius: 999 },
  remainRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  remainText: { fontSize: 12, color: "#8B9AC0", fontWeight: "600" },
  section: { gap: 6 },
  weekHeader: {
    fontSize: 11,
    fontWeight: "800",
    color: "#C4B5FD",
    textTransform: "uppercase",
    letterSpacing: 0.3,
  },
  dayRow: { gap: 8, paddingVertical: 2 },
  dayCell: {
    width: 72,
    minHeight: 96,
    borderRadius: 14,
    borderWidth: 1.5,
    backgroundColor: "#0B0E16",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 8,
    paddingHorizontal: 4,
    gap: 6,
  },
  dayCellCurrent: {
    borderWidth: 2,
    shadowColor: "#00E676",
    shadowOpacity: 0.35,
    shadowRadius: 8,
    elevation: 3,
  },
  dayCellFailed: { backgroundColor: "rgba(255,68,68,0.08)" },
  dayCellLabel: { fontSize: 11, fontWeight: "700", color: "#C7CDDA" },
  dayIconCircle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "transparent",
  },
  dayIconDashed: {
    borderWidth: 1.5,
    borderColor: "#5A6A8A",
    borderStyle: "dashed",
  },
  dayIconDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#5A6A8A",
  },
  daySteps: { fontSize: 12, fontWeight: "800", color: "#00E676" },
  dayStepsMuted: { fontSize: 11, fontWeight: "700", color: "#6B7A99" },
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
  warnText: { flex: 1, fontSize: 13, fontWeight: "600", color: "#FFB4B4", lineHeight: 18 },
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
  infoText: { flex: 1, fontSize: 13, fontWeight: "600", color: "#B7D0FF", lineHeight: 18 },
  infoHighlight: { color: "#7EB6FF", fontWeight: "800" },
  cta: {
    marginTop: 10,
    height: 48,
    borderRadius: 14,
    backgroundColor: "#00E676",
    alignItems: "center",
    justifyContent: "center",
  },
  ctaText: { fontSize: 16, fontWeight: "900", color: "#0B0F1A" },
});
