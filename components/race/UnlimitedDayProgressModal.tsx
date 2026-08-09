/**
 * Daily Progress modal for Unlimited Daily Goal Challenges.
 *
 * When `historyRows` from GET .../daily-history are provided, each day shows
 * its verified step total. Otherwise falls back to aggregate schedule status
 * with live steps only on the in-progress day.
 */
import React, { useMemo } from "react";
import {
  FlatList,
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import type { UnlimitedViewerSchedule } from "@/utils/unlimitedViewerSchedule";
import { formatDateKeyLabel } from "@/utils/unlimitedViewerSchedule";
import {
  buildUnlimitedDayRows,
  buildUnlimitedDaySummary,
  buildUnlimitedDayWeekSections,
  type UnlimitedDayRow,
  type UnlimitedDayStatus,
} from "@/utils/unlimitedDayProgress";
import { UnlimitedProgressSummary } from "@/components/race/UnlimitedProgressSummary";
import { resolvePrizePoolEligibilityStatus, type UnlimitedChallengeResultStatus } from "@/utils/unlimitedResults";

export type { UnlimitedDayStatus, UnlimitedDayRow } from "@/utils/unlimitedDayProgress";

const STATUS_META: Record<UnlimitedDayStatus, { label: string; color: string; icon: string }> = {
  passed: { label: "Passed", color: "#00E676", icon: "check-circle" },
  in_progress: { label: "LIVE", color: "#FF6B35", icon: "activity" },
  upcoming: { label: "Upcoming", color: "#5A6A8A", icon: "circle" },
  failed: { label: "Failed", color: "#FF4444", icon: "x-circle" },
  validation_pending: { label: "Validating", color: "#FFAA00", icon: "clock" },
};

type Props = {
  visible: boolean;
  onClose: () => void;
  schedule: UnlimitedViewerSchedule | null;
  todaySteps: number;
  /** Authoritative rows from daily-history when loaded. */
  historyRows?: UnlimitedDayRow[] | null;
  /** Backend participant.qualificationStatus — drives the summary's eligibility line. */
  qualificationStatus?: string | null;
  prizePoolEligibilityStatus?: string | null;
  /** Global result status (defaults to "challenge_in_progress" while the modal is opened from Live Race). */
  resultStatus?: UnlimitedChallengeResultStatus;
};

export function UnlimitedDayProgressModal({
  visible,
  onClose,
  schedule,
  todaySteps,
  historyRows,
  qualificationStatus,
  prizePoolEligibilityStatus,
  resultStatus = "challenge_in_progress",
}: Props) {
  const rows = useMemo(() => {
    if (historyRows && historyRows.length > 0) return historyRows;
    return schedule ? buildUnlimitedDayRows(schedule, todaySteps) : [];
  }, [historyRows, schedule, todaySteps]);
  const sections = useMemo(() => buildUnlimitedDayWeekSections(rows), [rows]);
  const flatRows = useMemo(
    () =>
      sections.flatMap((section) =>
        section.title ? [{ kind: "header" as const, title: section.title }, ...section.data.map((d) => ({ kind: "day" as const, row: d }))] : section.data.map((d) => ({ kind: "day" as const, row: d })),
      ),
    [sections],
  );
  const summary = useMemo(() => buildUnlimitedDaySummary(rows), [rows]);
  const eligibility = resolvePrizePoolEligibilityStatus({
    resultStatus,
    qualificationStatus,
    prizePoolEligibilityStatus,
  });
  const disqualified = schedule?.viewerStatus === "failed";

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <View style={styles.header}>
            <Text style={styles.title}>Challenge Progress</Text>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Feather name="x" size={20} color="#8B9AC0" />
            </TouchableOpacity>
          </View>

          <Text style={styles.note}>
            {disqualified
              ? "Daily goal missed — you are no longer qualified."
              : "Complete your daily step goal every day to qualify."}
          </Text>

          {schedule || rows.length > 0 ? (
            <UnlimitedProgressSummary summary={summary} eligibility={eligibility} />
          ) : null}

          <FlatList
            data={flatRows}
            keyExtractor={(item, index) =>
              item.kind === "header" ? `h:${item.title}` : `d:${item.row.dayNumber}:${index}`
            }
            style={{ maxHeight: 340 }}
            initialNumToRender={16}
            windowSize={7}
            removeClippedSubviews
            renderItem={({ item }) => {
              if (item.kind === "header") {
                return <Text style={styles.weekHeader}>{item.title}</Text>;
              }
              const row = item.row;
              const meta = STATUS_META[row.status];
              const isCurrent = schedule && row.dayNumber === schedule.currentDayIndex;
              const steps =
                typeof row.verifiedSteps === "number"
                  ? row.verifiedSteps
                  : isCurrent
                    ? todaySteps
                    : null;
              return (
                <View style={styles.dayRow}>
                  <View style={styles.dayNumberWrap}>
                    <Text style={styles.dayNumber}>Day {row.dayNumber}</Text>
                    <Text style={styles.dayDate}>{formatDateKeyLabel(row.localDate)}</Text>
                  </View>
                  <View style={[styles.stateBadge, { borderColor: meta.color }]}>
                    <Feather name={meta.icon as never} size={11} color={meta.color} />
                    <Text style={[styles.stateText, { color: meta.color }]}>{meta.label}</Text>
                  </View>
                  {steps != null ? (
                    <Text style={styles.stepsText}>
                      {steps.toLocaleString()} / {row.dailyGoalSteps.toLocaleString()}
                    </Text>
                  ) : (
                    <View style={{ flex: 1 }} />
                  )}
                </View>
              );
            }}
          />

          <TouchableOpacity style={styles.closeBtn} onPress={onClose}>
            <Text style={styles.closeBtnText}>Close</Text>
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
    paddingHorizontal: 20,
  },
  card: {
    width: "100%",
    maxWidth: 420,
    backgroundColor: "#0F1117",
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: "rgba(124,58,255,0.35)",
    padding: 20,
  },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 6 },
  title: { fontSize: 17, fontWeight: "800", color: "#fff" },
  note: { fontSize: 12, color: "#8B9AC0", marginBottom: 12, lineHeight: 17 },
  weekHeader: {
    fontSize: 11.5,
    fontWeight: "800",
    color: "#C4B5FD",
    paddingVertical: 8,
    textTransform: "uppercase",
    letterSpacing: 0.3,
  },
  dayRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    minHeight: 44,
    paddingVertical: 4,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.06)",
  },
  dayNumberWrap: { width: 74 },
  dayNumber: { fontSize: 13, fontWeight: "700", color: "#E2E8F8" },
  dayDate: { fontSize: 10.5, color: "#5A6A8A", marginTop: 1 },
  stateBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  stateText: { fontSize: 10.5, fontWeight: "800" },
  stepsText: { flex: 1, textAlign: "right", fontSize: 12, fontWeight: "700", color: "#C7CDDA" },
  closeBtn: {
    marginTop: 14,
    height: 44,
    borderRadius: 12,
    backgroundColor: "#1A1D2E",
    alignItems: "center",
    justifyContent: "center",
  },
  closeBtnText: { color: "#E2E8F8", fontWeight: "800", fontSize: 14 },
});
