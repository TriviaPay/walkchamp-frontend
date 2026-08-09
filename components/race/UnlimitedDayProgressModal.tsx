/**
 * Daily Progress modal for Unlimited Daily Goal Challenges.
 *
 * Per-day historical step totals (e.g. "Day 1 ✓ 10,231") are NOT currently
 * exposed by any frontend-reachable endpoint — GET /unlimited-challenges/:id
 * and .../leaderboard only return an aggregate `completedDays` count plus the
 * viewer's CURRENT day row (see Backend/src/lib/unlimitedLiveProgress.ts).
 * This view therefore renders per-day STATUS (passed / in_progress / upcoming /
 * failed / validation_pending) from those backend-authoritative aggregates,
 * and shows the live step count only for the in-progress day. A future backend
 * endpoint returning full per-day history would let each passed row show its
 * exact step total — see the "Backend follow-up" note in the implementation
 * report.
 *
 * For 30/60/90-day challenges the day list is virtualized via FlatList and
 * grouped into "Week N" sections (see buildUnlimitedDayWeekSections).
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
  /** Backend participant.qualificationStatus — drives the summary's eligibility line. */
  qualificationStatus?: string | null;
  /** Global result status (defaults to "challenge_in_progress" while the modal is opened from Live Race). */
  resultStatus?: UnlimitedChallengeResultStatus;
};

export function UnlimitedDayProgressModal({
  visible,
  onClose,
  schedule,
  todaySteps,
  qualificationStatus,
  resultStatus = "challenge_in_progress",
}: Props) {
  const rows = useMemo(
    () => (schedule ? buildUnlimitedDayRows(schedule, todaySteps) : []),
    [schedule, todaySteps],
  );
  const sections = useMemo(() => buildUnlimitedDayWeekSections(rows), [rows]);
  const flatRows = useMemo(
    () =>
      sections.flatMap((section) =>
        section.title ? [{ kind: "header" as const, title: section.title }, ...section.data.map((d) => ({ kind: "day" as const, row: d }))] : section.data.map((d) => ({ kind: "day" as const, row: d })),
      ),
    [sections],
  );
  const summary = useMemo(() => buildUnlimitedDaySummary(rows), [rows]);
  const eligibility = resolvePrizePoolEligibilityStatus({ resultStatus, qualificationStatus });
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

          {schedule ? <UnlimitedProgressSummary summary={summary} eligibility={eligibility} /> : null}

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
                  {isCurrent && schedule ? (
                    <Text style={styles.stepsText}>
                      {todaySteps.toLocaleString()} / {schedule.dailyGoalSteps.toLocaleString()}
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
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  stateText: { fontSize: 10, fontWeight: "700" },
  stepsText: { fontSize: 12, color: "#8B9AC0", flex: 1, textAlign: "right" },
  closeBtn: {
    marginTop: 14,
    backgroundColor: "rgba(124,58,255,0.18)",
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: "center",
  },
  closeBtnText: { color: "#C4B5FD", fontWeight: "700", fontSize: 14 },
});
