/**
 * Unlimited Daily Goal Challenge — Results screen.
 *
 * PRODUCT RULE (see utils/unlimitedResults.ts): never shows final winners /
 * rank / payout / prize share until the BACKEND's global
 * `challenge.status`/`settlementStatus` says settlement is finished — the
 * logged-in participant (or anyone else) finishing their own local challenge
 * duration only ever produces the "waiting_for_participants" state here.
 *
 * Reuses the existing Unlimited detail endpoint + Pusher channel; no backend
 * changes, no new API routes.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { useSafeLayout } from "@/hooks/useSafeLayout";
import { useAuth } from "@/context/AuthContext";
import {
  fetchUnlimitedResultsData,
  fetchUnlimitedOwnPrizeShareCents,
  fetchUnlimitedDailyHistory,
  type UnlimitedResultsData,
} from "@/services/unlimitedResultsApi";
import {
  computeUnlimitedViewerSchedule,
  formatDateKeyLabel,
} from "@/utils/unlimitedViewerSchedule";
import { getDeviceTimezone } from "@/utils/timezone";
import {
  buildUnlimitedDayRows,
  buildUnlimitedDaySummary,
  buildUnlimitedDayWeekSections,
  dayRowsFromDailyHistory,
  type UnlimitedDayRow,
} from "@/utils/unlimitedDayProgress";
import {
  resolveUnlimitedResultStatus,
  resolvePrizePoolEligibilityStatus,
  resultsScreenCopy,
  prizePoolEligibilityLabel,
  prizePoolEligibilityIcon,
  finalEligibilityMessage,
  type UnlimitedChallengeResultStatus,
  type PrizePoolEligibilityStatus,
} from "@/utils/unlimitedResults";
import { UnlimitedProgressSummary } from "@/components/race/UnlimitedProgressSummary";
import { subscribeToChannel, unsubscribeFromChannel, CHANNELS } from "@/services/realtimeService";

const POLL_MS = 20_000;

export default function UnlimitedResultsScreen() {
  const params = useLocalSearchParams<{ challengeId?: string }>();
  const challengeId = typeof params.challengeId === "string" ? params.challengeId : null;
  const { user } = useAuth();
  const { safeTop, safeBottom } = useSafeLayout();

  const [data, setData] = useState<UnlimitedResultsData | null>(null);
  const [historyRows, setHistoryRows] = useState<UnlimitedDayRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [ownPrizeShareCents, setOwnPrizeShareCents] = useState<number | null>(null);
  const [showEligibleList, setShowEligibleList] = useState(false);
  const [showNotEligibleList, setShowNotEligibleList] = useState(false);

  const load = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!challengeId) return;
      if (!opts?.silent) setLoading((prev) => (data ? prev : true));
      const [result, history] = await Promise.all([
        fetchUnlimitedResultsData(challengeId),
        fetchUnlimitedDailyHistory(challengeId, user?.id),
      ]);
      if (result) setData(result);
      const mappedHistory = dayRowsFromDailyHistory(history, {
        todaySteps: result?.participants.find((p) => p.userId === user?.id)?.currentSteps,
      });
      if (mappedHistory) setHistoryRows(mappedHistory);
      setLoading(false);
      setRefreshing(false);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [challengeId, user?.id],
  );

  useEffect(() => {
    void load();
  }, [load]);

  // Realtime: settlement flips waiting → validating → ready via `challenge_completed`
  // (see Backend/src/lib/unlimitedChallengeSettlement.ts). Polling is the fallback.
  useEffect(() => {
    if (!challengeId) return;
    const channelName = CHANNELS.unlimitedChallenge(challengeId);
    const channel = subscribeToChannel(channelName);
    const onRealtimeRefresh = () => void load({ silent: true });
    channel?.bind("challenge_completed", onRealtimeRefresh);
    channel?.bind("challenge_cancelled", onRealtimeRefresh);
    channel?.bind("progress_updated", onRealtimeRefresh);
    channel?.bind("results_status_changed", onRealtimeRefresh);
    return () => {
      channel?.unbind("challenge_completed", onRealtimeRefresh);
      channel?.unbind("challenge_cancelled", onRealtimeRefresh);
      channel?.unbind("progress_updated", onRealtimeRefresh);
      channel?.unbind("results_status_changed", onRealtimeRefresh);
      unsubscribeFromChannel(channelName);
    };
  }, [challengeId, load]);

  // Fallback poll — avoids aggressive repeated calls, only while not yet final.
  const resultStatusRef = useRef<UnlimitedChallengeResultStatus>("challenge_in_progress");
  useEffect(() => {
    if (!challengeId) return;
    const interval = setInterval(() => {
      if (resultStatusRef.current !== "results_ready") void load({ silent: true });
    }, POLL_MS);
    return () => clearInterval(interval);
  }, [challengeId, load]);

  const currentParticipant = useMemo(
    () => data?.participants.find((p) => p.userId === user?.id) ?? null,
    [data, user?.id],
  );

  const schedule = useMemo(() => {
    if (!data) return null;
    return computeUnlimitedViewerSchedule(
      {
        startAtUtc: data.race.scheduledStartAt ?? data.race.startedAt ?? null,
        challengeTimezone: data.race.challengeTimezone ?? null,
        durationDays: data.race.challengeDurationDays ?? null,
        dailyGoalSteps: data.race.targetSteps,
        challengeStatus: data.race.status,
      },
      {
        liveDay: currentParticipant
          ? {
              timezone: currentParticipant.timezone,
              dayNumber: currentParticipant.dayNumber,
              localDate: currentParticipant.challengeDayKey,
              dailyGoalSteps: currentParticipant.dailyGoalSteps,
              qualificationStatus: currentParticipant.qualificationStatus,
              completedDays: currentParticipant.completedDays,
            }
          : null,
        fallbackTimezone: getDeviceTimezone(),
      },
    );
  }, [data, currentParticipant]);

  const resultStatus: UnlimitedChallengeResultStatus = useMemo(() => {
    if (!data) return "challenge_in_progress";
    const personallyFinished =
      schedule?.viewerStatus === "completed" ||
      schedule?.viewerStatus === "failed" ||
      schedule?.viewerStatus === "left";
    return resolveUnlimitedResultStatus({
      resultsStatus: data.race.resultsStatus,
      challengeStatus: data.race.rawStatus ?? data.race.status,
      settlementStatus: data.race.settlementStatus,
      viewerPersonallyFinished: personallyFinished,
    });
  }, [data, schedule]);
  resultStatusRef.current = resultStatus;

  const eligibility: PrizePoolEligibilityStatus = useMemo(
    () =>
      resolvePrizePoolEligibilityStatus({
        resultStatus,
        qualificationStatus: currentParticipant?.qualificationStatus,
        prizePoolEligibilityStatus:
          currentParticipant?.prizePoolEligibilityStatus ?? data?.race.prizePoolEligibilityStatus,
      }),
    [resultStatus, currentParticipant, data?.race.prizePoolEligibilityStatus],
  );

  const dayRows = useMemo(() => {
    if (historyRows && historyRows.length > 0) return historyRows;
    return schedule ? buildUnlimitedDayRows(schedule, currentParticipant?.currentSteps ?? 0) : [];
  }, [historyRows, schedule, currentParticipant]);
  const daySummary = useMemo(() => buildUnlimitedDaySummary(dayRows), [dayRows]);
  const weekSections = useMemo(() => buildUnlimitedDayWeekSections(dayRows), [dayRows]);

  useEffect(() => {
    if (resultStatus === "results_ready" && eligibility === "eligible" && challengeId) {
      void fetchUnlimitedOwnPrizeShareCents(challengeId).then(setOwnPrizeShareCents);
    }
  }, [resultStatus, eligibility, challengeId]);

  const eligibleParticipants = useMemo(
    () => (data?.participants ?? []).filter((p) => (p.qualificationStatus ?? "").toLowerCase() === "qualified"),
    [data],
  );
  const notEligibleParticipants = useMemo(
    () =>
      (data?.participants ?? []).filter((p) => {
        const q = (p.qualificationStatus ?? "").toLowerCase();
        return q === "disqualified" || q === "left" || (resultStatus === "results_ready" && q !== "qualified");
      }),
    [data, resultStatus],
  );

  const copy = resultsScreenCopy(resultStatus, {
    registeredParticipantCount: data?.race.registeredParticipantCount,
    participantsFinishedCount: data?.race.participantsFinishedCount,
    participantsPendingCount: data?.race.participantsPendingCount,
  });
  const durationDays = data?.race.challengeDurationDays ?? schedule?.durationDays ?? 0;

  if (loading && !data) {
    return (
      <View style={[styles.screen, styles.centerFill]}>
        <ActivityIndicator size="large" color="#7C3AFF" />
      </View>
    );
  }

  if (!data) {
    return (
      <View style={[styles.screen, styles.centerFill, { paddingTop: safeTop }]}>
        <Text style={styles.errorText}>Couldn't load challenge results.</Text>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Text style={styles.backBtnText}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={[styles.screen, { paddingTop: safeTop }]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Feather name="arrow-left" size={22} color="#E2E8F8" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{copy.title}</Text>
        <View style={{ width: 22 }} />
      </View>

      <FlatList
        data={weekSections}
        keyExtractor={(section, i) => section.title ?? `flat-${i}`}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              void load();
            }}
            tintColor="#7C3AFF"
          />
        }
        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: safeBottom + 24 }}
        ListHeaderComponent={
          <View>
            <StatusHeaderCard
              resultStatus={resultStatus}
              statusHeadline={copy.statusHeadline}
              message={copy.message}
              secondaryText={copy.secondaryText}
              durationDays={durationDays}
              completedDays={daySummary.completedCount}
              participantCount={data.race.currentPlayers}
              qualifiedParticipantCount={data.race.qualifiedParticipantCount ?? null}
              prizePoolCents={data.race.prizePoolCents}
              eligibility={eligibility}
              ownPrizeShareCents={ownPrizeShareCents}
            />
            <UnlimitedProgressSummary
              summary={daySummary}
              eligibility={eligibility}
              resultsFinal={resultStatus === "results_ready"}
            />
            {resultStatus === "results_ready" ? (
              <ParticipantLists
                eligible={eligibleParticipants}
                notEligible={notEligibleParticipants}
                durationDays={durationDays}
                showEligible={showEligibleList}
                setShowEligible={setShowEligibleList}
                showNotEligible={showNotEligibleList}
                setShowNotEligible={setShowNotEligibleList}
              />
            ) : null}
            <Text style={styles.dayHistoryTitle}>Daily Progress History</Text>
          </View>
        }
        renderItem={({ item: section }) => (
          <View>
            {section.title ? <Text style={styles.weekHeader}>{section.title}</Text> : null}
            {section.data.map((row) => (
              <DayHistoryRow key={row.dayNumber} row={row} />
            ))}
          </View>
        )}
        initialNumToRender={4}
        windowSize={5}
        removeClippedSubviews
      />
    </View>
  );
}

function StatusHeaderCard(props: {
  resultStatus: UnlimitedChallengeResultStatus;
  statusHeadline: string;
  message: string;
  secondaryText: string | null;
  durationDays: number;
  completedDays: number;
  participantCount: number;
  qualifiedParticipantCount: number | null;
  prizePoolCents: number;
  eligibility: PrizePoolEligibilityStatus;
  ownPrizeShareCents: number | null;
}) {
  const {
    resultStatus,
    statusHeadline,
    message,
    secondaryText,
    durationDays,
    completedDays,
    participantCount,
    qualifiedParticipantCount,
    prizePoolCents,
    eligibility,
    ownPrizeShareCents,
  } = props;

  return (
    <View style={styles.statusCard}>
      <View style={styles.statusBadgeRow}>
        {resultStatus === "steps_validation_in_progress" ? (
          <ActivityIndicator size="small" color="#FFAA00" style={{ marginRight: 6 }} />
        ) : (
          <Feather
            name={resultStatus === "results_ready" ? "check-circle" : "clock"}
            size={16}
            color={resultStatus === "results_ready" ? "#00E676" : "#FFAA00"}
          />
        )}
        <Text style={styles.statusBadgeText}>{statusHeadline}</Text>
      </View>
      <Text style={styles.statusMessage}>{message}</Text>
      {secondaryText ? <Text style={styles.statusSecondary}>{secondaryText}</Text> : null}

      <View style={styles.statusGrid}>
        {resultStatus === "waiting_for_participants" ? (
          <StatRow label="Your Progress" value={`${completedDays} / ${durationDays} days completed`} />
        ) : null}
        {resultStatus === "steps_validation_in_progress" ? (
          <>
            <StatRow label="Participants" value={String(participantCount)} />
            <StatRow label="Challenge" value={`${durationDays} Days`} />
            <StatRow label="Validation" value="In Progress" />
          </>
        ) : null}
        <StatRow
          label="Your Validation Status"
          value={resultStatus === "results_ready" ? "Complete" : "Waiting"}
        />
        <StatRow
          label="Prize Pool Status"
          value={
            resultStatus === "results_ready" ? prizePoolEligibilityLabel(eligibility) : "Pending"
          }
          valueColor={
            resultStatus === "results_ready"
              ? eligibility === "eligible"
                ? "#00E676"
                : eligibility === "not_eligible"
                  ? "#FF4444"
                  : undefined
              : undefined
          }
        />
        {resultStatus !== "results_ready" ? (
          <StatRow label="Prize Pool Results" value="Coming Soon" />
        ) : null}
      </View>

      {resultStatus === "results_ready" ? (
        <View style={styles.finalBlock}>
          <View style={styles.finalEligibilityRow}>
            <Feather
              name={prizePoolEligibilityIcon(eligibility)}
              size={18}
              color={eligibility === "eligible" ? "#00E676" : eligibility === "not_eligible" ? "#FF4444" : "#FFAA00"}
            />
            <Text
              style={[
                styles.finalEligibilityText,
                { color: eligibility === "eligible" ? "#00E676" : eligibility === "not_eligible" ? "#FF4444" : "#FFAA00" },
              ]}
            >
              {prizePoolEligibilityLabel(eligibility).toUpperCase()}
            </Text>
          </View>
          <Text style={styles.finalMessage}>{finalEligibilityMessage(eligibility)}</Text>
          <StatRow label="Days Passed" value={`${completedDays} / ${durationDays}`} />
          {prizePoolCents > 0 ? (
            <StatRow label="Prize Pool" value={formatCents(prizePoolCents)} />
          ) : null}
          {qualifiedParticipantCount != null ? (
            <StatRow label="Qualified Participants" value={String(qualifiedParticipantCount)} />
          ) : null}
          {eligibility === "eligible" && ownPrizeShareCents != null ? (
            <StatRow label="Your Prize Share" value={formatCents(ownPrizeShareCents)} valueColor="#FFD700" />
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

function StatRow({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) {
  return (
    <View style={styles.statRow}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={[styles.statValue, valueColor ? { color: valueColor } : null]}>{value}</Text>
    </View>
  );
}

function ParticipantLists(props: {
  eligible: UnlimitedResultsData["participants"];
  notEligible: UnlimitedResultsData["participants"];
  durationDays: number;
  showEligible: boolean;
  setShowEligible: (v: boolean) => void;
  showNotEligible: boolean;
  setShowNotEligible: (v: boolean) => void;
}) {
  const { eligible, notEligible, durationDays, showEligible, setShowEligible, showNotEligible, setShowNotEligible } =
    props;
  return (
    <View style={{ gap: 10 }}>
      <CollapsibleSection
        title={`Prize Pool Eligible (${eligible.length})`}
        expanded={showEligible}
        onToggle={() => setShowEligible(!showEligible)}
      >
        {eligible.length === 0 ? (
          <Text style={styles.emptyListText}>No eligible participants yet.</Text>
        ) : (
          eligible.map((p, i) => (
            <View key={p.id} style={styles.participantRow}>
              <Text style={styles.participantRank}>#{i + 1}</Text>
              <View style={[styles.participantAvatar, { backgroundColor: (p.avatarColor ?? "#00E676") + "30" }]}>
                <Text style={[styles.participantAvatarText, { color: p.avatarColor ?? "#00E676" }]}>
                  {p.username.charAt(0).toUpperCase()}
                </Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.participantName} numberOfLines={1}>
                  {p.username}
                </Text>
                <Text style={styles.participantSub}>
                  {p.completedDays ?? 0}/{durationDays} days · {(p.totalChallengeSteps ?? p.currentSteps).toLocaleString()} steps
                </Text>
              </View>
              <Feather name="check-circle" size={16} color="#00E676" />
            </View>
          ))
        )}
      </CollapsibleSection>

      <CollapsibleSection
        title={`Not Eligible (${notEligible.length})`}
        expanded={showNotEligible}
        onToggle={() => setShowNotEligible(!showNotEligible)}
      >
        {notEligible.length === 0 ? (
          <Text style={styles.emptyListText}>Everyone qualified.</Text>
        ) : (
          notEligible.map((p) => {
            const passed = Math.max(0, Math.min(p.completedDays ?? 0, durationDays));
            const failed = Math.max(0, durationDays - passed);
            return (
              <View key={p.id} style={styles.participantRow}>
                <View style={[styles.participantAvatar, { backgroundColor: (p.avatarColor ?? "#5A6A8A") + "30" }]}>
                  <Text style={[styles.participantAvatarText, { color: p.avatarColor ?? "#5A6A8A" }]}>
                    {p.username.charAt(0).toUpperCase()}
                  </Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.participantName} numberOfLines={1}>
                    {p.username}
                  </Text>
                  <Text style={styles.participantSub}>
                    {passed}/{durationDays} days passed · {failed} missed
                  </Text>
                </View>
                <Feather name="x-circle" size={16} color="#FF4444" />
              </View>
            );
          })
        )}
      </CollapsibleSection>
    </View>
  );
}

function CollapsibleSection({
  title,
  expanded,
  onToggle,
  children,
}: {
  title: string;
  expanded: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.collapsible}>
      <TouchableOpacity style={styles.collapsibleHeader} onPress={onToggle}>
        <Text style={styles.collapsibleTitle}>{title}</Text>
        <Feather name={expanded ? "chevron-up" : "chevron-down"} size={16} color="#8B9AC0" />
      </TouchableOpacity>
      {expanded ? <View style={styles.collapsibleBody}>{children}</View> : null}
    </View>
  );
}

const DAY_STATUS_META: Record<string, { label: string; color: string; icon: string }> = {
  passed: { label: "Passed", color: "#00E676", icon: "check-circle" },
  in_progress: { label: "In Progress", color: "#FF6B35", icon: "activity" },
  upcoming: { label: "Upcoming", color: "#5A6A8A", icon: "circle" },
  failed: { label: "Failed", color: "#FF4444", icon: "x-circle" },
  validation_pending: { label: "Validation Pending", color: "#FFAA00", icon: "clock" },
};

function DayHistoryRow({ row }: { row: ReturnType<typeof buildUnlimitedDayRows>[number] }) {
  const meta = DAY_STATUS_META[row.status];
  return (
    <View style={[styles.dayHistoryRow, row.status === "failed" && styles.dayHistoryRowFailed]}>
      <View style={{ width: 86 }}>
        <Text style={styles.dayHistoryDay}>Day {row.dayNumber}</Text>
        <Text style={styles.dayHistoryDate}>{formatDateKeyLabel(row.localDate)}</Text>
      </View>
      <View style={{ flex: 1 }}>
        {row.verifiedSteps != null ? (
          <Text style={styles.dayHistorySteps}>
            {row.verifiedSteps.toLocaleString()} / {row.dailyGoalSteps.toLocaleString()}
          </Text>
        ) : row.status === "passed" || row.status === "failed" ? (
          <Text style={styles.dayHistorySteps}>Goal: {row.dailyGoalSteps.toLocaleString()}</Text>
        ) : null}
      </View>
      <View style={[styles.dayStatusBadge, { borderColor: meta.color }]}>
        <Feather name={meta.icon as never} size={11} color={meta.color} />
        <Text style={[styles.dayStatusText, { color: meta.color }]}>{meta.label}</Text>
      </View>
    </View>
  );
}

function formatCents(cents: number): string {
  const dollars = cents / 100;
  return "$" + (dollars % 1 === 0 ? dollars.toFixed(0) : dollars.toFixed(2));
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#0B0F1A" },
  centerFill: { alignItems: "center", justifyContent: "center", gap: 14 },
  errorText: { color: "#8B9AC0", fontSize: 14 },
  backBtn: { backgroundColor: "#7C3AFF", borderRadius: 12, paddingHorizontal: 22, paddingVertical: 11 },
  backBtnText: { color: "#fff", fontWeight: "700" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  headerTitle: { fontSize: 17, fontWeight: "800", color: "#fff" },
  statusCard: {
    borderRadius: 18,
    backgroundColor: "rgba(20,24,40,0.9)",
    borderWidth: 1.5,
    borderColor: "rgba(124,58,255,0.35)",
    padding: 18,
    marginBottom: 14,
    gap: 10,
  },
  statusBadgeRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  statusBadgeText: { fontSize: 16, fontWeight: "800", color: "#fff" },
  statusMessage: { fontSize: 13.5, color: "#C8D0E8", lineHeight: 19 },
  statusSecondary: { fontSize: 12, color: "#8B9AC0", lineHeight: 17 },
  statusGrid: { marginTop: 6, gap: 8 },
  statRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  statLabel: { fontSize: 12.5, color: "#8B9AC0", fontWeight: "600" },
  statValue: { fontSize: 13.5, color: "#E2E8F8", fontWeight: "800" },
  finalBlock: {
    marginTop: 8,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.08)",
    gap: 8,
  },
  finalEligibilityRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  finalEligibilityText: { fontSize: 15, fontWeight: "900", letterSpacing: 0.3 },
  finalMessage: { fontSize: 12.5, color: "#C8D0E8", lineHeight: 18, marginBottom: 4 },
  dayHistoryTitle: { fontSize: 14, fontWeight: "800", color: "#E2E8F8", marginBottom: 8, marginTop: 4 },
  weekHeader: {
    fontSize: 11.5,
    fontWeight: "800",
    color: "#C4B5FD",
    paddingVertical: 8,
    textTransform: "uppercase",
    letterSpacing: 0.3,
  },
  dayHistoryRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 4,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.06)",
  },
  dayHistoryRowFailed: { backgroundColor: "rgba(255,68,68,0.06)", borderRadius: 8 },
  dayHistoryDay: { fontSize: 13, fontWeight: "700", color: "#E2E8F8" },
  dayHistoryDate: { fontSize: 10.5, color: "#5A6A8A", marginTop: 1 },
  dayHistorySteps: { fontSize: 12, color: "#8B9AC0" },
  dayStatusBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  dayStatusText: { fontSize: 10, fontWeight: "700" },
  collapsible: {
    borderRadius: 14,
    backgroundColor: "rgba(20,24,40,0.85)",
    borderWidth: 1,
    borderColor: "rgba(124,58,255,0.25)",
    overflow: "hidden",
  },
  collapsibleHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  collapsibleTitle: { fontSize: 13, fontWeight: "800", color: "#E2E8F8" },
  collapsibleBody: { paddingHorizontal: 14, paddingBottom: 10, gap: 8 },
  emptyListText: { fontSize: 12, color: "#5A6A8A", fontStyle: "italic" },
  participantRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  participantRank: { fontSize: 12, fontWeight: "800", color: "#8B9AC0", width: 24 },
  participantAvatar: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
  },
  participantAvatarText: { fontSize: 13, fontWeight: "800" },
  participantName: { fontSize: 13, fontWeight: "700", color: "#E2E8F8" },
  participantSub: { fontSize: 11, color: "#8B9AC0", marginTop: 1 },
});
