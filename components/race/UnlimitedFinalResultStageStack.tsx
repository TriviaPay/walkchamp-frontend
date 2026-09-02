/**
 * Progressive Streak final-result status cards (Image 4).
 * Prefers backend viewer.finalFlowStatus + viewer.finalFlow when present.
 */
import React, { memo, useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Feather, MaterialCommunityIcons } from "@expo/vector-icons";
import {
  buildCurrentFinalFlowStageFromBackend,
  buildFinalFlowStagesFromBackend,
  type FinalResultStatus,
  type RaceFinalStatus,
  type UnlimitedFinalFlow,
  type UnlimitedFinalFlowStatus,
} from "@/features/unlimited/mappers/unlimitedFinalFlow";
import {
  resolveUnlimitedFinalResultStages,
  type UnlimitedFinalResultStage,
} from "@/features/unlimited/mappers/unlimitedTimezoneChange";
import type { UnlimitedChallengeResultStatus } from "@/features/unlimited/mappers/unlimitedResults";
import { rf } from "@/utils/responsive";

type Props = {
  /** Backend-owned flow — preferred when present. */
  finalFlowStatus?: UnlimitedFinalFlowStatus | null;
  finalFlow?: UnlimitedFinalFlow | null;
  finalResultStatus?: FinalResultStatus | string | null;
  raceFinalStatus?: RaceFinalStatus | string | null;
  /** When true, backend announced final results — show completed stage only. */
  resultsAnnounced?: boolean;
  resultStatus: UnlimitedChallengeResultStatus;
  viewerPersonallyFinished: boolean;
  finalVerificationStatus?: string | null;
  showingFinalResults?: boolean;
  /** Live race steps strip: show only the active stage (e.g. Final Results Pending). */
  currentStageOnly?: boolean;
  /** Match Live Race bottom "Race Finished" banner layout (full-width strip). */
  bottomBanner?: boolean;
  pastLivePhase?: boolean;
  verificationPending?: boolean | null;
  registeredParticipantCount?: number | null;
  participantsFinishedCount?: number | null;
  participantsPendingCount?: number | null;
  pendingOpponentLabel?: string | null;
};

function StageIcon({
  stage,
  compact,
}: {
  stage: UnlimitedFinalResultStage;
  compact?: boolean;
}) {
  const color = stage.accent;
  const size = compact ? 15 : 17;

  // Reference flow: solid green circle + white checkmark.
  if (stage.icon === "check" || stage.id === "results_ready") {
    const dim = compact ? 20 : 22;
    return (
      <View
        style={{
          width: dim,
          height: dim,
          borderRadius: dim / 2,
          backgroundColor: color,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Feather name="check" size={compact ? 11 : 12} color="#FFFFFF" />
      </View>
    );
  }

  if (stage.icon === "trophy" || stage.id === "challenge_completed") {
    return (
      <MaterialCommunityIcons
        name="trophy"
        size={size + 1}
        color={color}
      />
    );
  }

  if (stage.icon === "flag" || stage.id === "final_day_completed") {
    return <MaterialCommunityIcons name="flag" size={size} color={color} />;
  }

  if (stage.icon === "search" || stage.id === "verifying_final_results") {
    return <MaterialCommunityIcons name="magnify" size={size + 1} color={color} />;
  }

  if (stage.icon === "users") {
    return <MaterialCommunityIcons name="account-group" size={size} color={color} />;
  }

  if (stage.icon === "hourglass") {
    return <Feather name="clock" size={compact ? 13 : 14} color={color} />;
  }

  return <Feather name="flag" size={compact ? 13 : 14} color={color} />;
}

export const UnlimitedFinalResultStageStack = memo(function UnlimitedFinalResultStageStack({
  finalFlowStatus,
  finalFlow,
  finalResultStatus,
  raceFinalStatus,
  resultsAnnounced = false,
  resultStatus,
  viewerPersonallyFinished,
  finalVerificationStatus,
  showingFinalResults = false,
  currentStageOnly = false,
  bottomBanner = false,
  pastLivePhase = false,
  verificationPending,
  registeredParticipantCount,
  participantsFinishedCount,
  participantsPendingCount,
  pendingOpponentLabel,
}: Props) {
  const stages = useMemo(() => {
    const backendStatus = resultsAnnounced
      ? ("challenge_completed" as const)
      : finalFlowStatus;
    const fromBackend = currentStageOnly
      ? buildCurrentFinalFlowStageFromBackend(backendStatus, finalFlow)
      : buildFinalFlowStagesFromBackend(backendStatus, finalFlow);
    if (fromBackend.length > 0) return fromBackend;
    // Avoid stepping through client-derived stages while backend contract is loading.
    if (currentStageOnly && (finalResultStatus || raceFinalStatus)) return [];
    const derived = resolveUnlimitedFinalResultStages({
      resultStatus,
      viewerPersonallyFinished,
      finalVerificationStatus,
      showingFinalResults: resultsAnnounced || showingFinalResults,
      pastLivePhase,
      verificationPending,
      finalResultStatus,
      raceFinalStatus,
      registeredParticipantCount,
      participantsFinishedCount,
      participantsPendingCount,
      pendingOpponentLabel,
    });
    if (!currentStageOnly) return derived;
    const current = derived[derived.length - 1];
    return current ? [current] : [];
  }, [
    finalFlowStatus,
    finalFlow,
    finalResultStatus,
    raceFinalStatus,
    resultsAnnounced,
    currentStageOnly,
    resultStatus,
    viewerPersonallyFinished,
    finalVerificationStatus,
    showingFinalResults,
    pastLivePhase,
    verificationPending,
    registeredParticipantCount,
    participantsFinishedCount,
    participantsPendingCount,
    pendingOpponentLabel,
  ]);

  if (stages.length === 0) return null;
  const visibleStages =
    currentStageOnly && stages.length > 0 ? [stages[stages.length - 1]!] : stages;
  const currentId = stages[stages.length - 1]?.id;

  return (
    <View
      style={[styles.wrap, bottomBanner && styles.wrapBottomBanner]}
      accessibilityRole="summary"
    >
      {visibleStages.map((stage) => {
        const isCurrent = stage.id === currentId;
        const cardBg = stage.highlightBg ?? "rgba(10,14,28,0.92)";
        const iconBg = stage.iconBg ?? `${stage.accent}28`;
        return (
          <View
            key={stage.id}
            style={[
              styles.card,
              bottomBanner && styles.cardBottomBanner,
              { borderColor: stage.border },
              isCurrent && styles.cardCurrent,
              isCurrent && {
                backgroundColor: cardBg,
                shadowColor: stage.accent,
              },
              bottomBanner && isCurrent && styles.cardBottomBannerCurrent,
            ]}
          >
            <View
              style={[
                styles.iconGlow,
                bottomBanner && styles.iconGlowBottomBanner,
                (stage.icon === "check" || stage.id === "results_ready") && styles.iconGlowCheck,
                { backgroundColor: iconBg, borderColor: `${stage.accent}55` },
              ]}
            >
              <StageIcon stage={stage} compact={bottomBanner} />
            </View>
            <View style={styles.textCol}>
              <Text
                style={[
                  styles.title,
                  bottomBanner && styles.titleBottomBanner,
                  { color: stage.accent },
                ]}
                numberOfLines={bottomBanner ? 2 : 1}
                adjustsFontSizeToFit={bottomBanner}
                minimumFontScale={0.82}
                ellipsizeMode="tail"
              >
                {stage.title}
              </Text>
              <Text
                style={[styles.desc, bottomBanner && styles.descBottomBanner]}
                numberOfLines={bottomBanner ? 2 : 3}
                ellipsizeMode="tail"
              >
                {stage.description}
              </Text>
            </View>
          </View>
        );
      })}
    </View>
  );
});

const styles = StyleSheet.create({
  wrap: {
    width: "100%",
    gap: 6,
    marginTop: 0,
    marginBottom: 0,
  },
  wrapBottomBanner: {
    flex: 1,
    width: "100%",
    minWidth: 0,
    alignSelf: "stretch",
    gap: 0,
  },
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 8,
    paddingHorizontal: 10,
    backgroundColor: "rgba(10,14,28,0.92)",
  },
  cardCurrent: {
    borderWidth: 1.5,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
    elevation: 4,
  },
  cardBottomBanner: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    borderRadius: 0,
    borderLeftWidth: 0,
    borderRightWidth: 0,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: "rgba(10,14,28,0.92)",
    width: "100%",
    minWidth: 0,
    minHeight: 72,
    maxHeight: 96,
  },
  cardBottomBannerCurrent: {
    borderTopWidth: 1.5,
    borderBottomWidth: 1.5,
  },
  iconGlowBottomBanner: {
    width: 30,
    height: 30,
    borderRadius: 8,
    marginTop: 0,
    flexShrink: 0,
  },
  titleBottomBanner: {
    fontSize: rf(12),
    fontWeight: "800",
    marginBottom: 2,
    letterSpacing: 0,
    flexShrink: 1,
  },
  descBottomBanner: {
    fontSize: rf(10),
    lineHeight: rf(13),
    fontWeight: "500",
    color: "rgba(226,232,248,0.82)",
    flexShrink: 1,
  },
  iconGlow: {
    width: 30,
    height: 30,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  iconGlowCheck: {
    backgroundColor: "transparent",
    borderWidth: 0,
  },
  textCol: { flex: 1, minWidth: 0, flexShrink: 1 },
  title: {
    fontSize: rf(12),
    fontWeight: "800",
    marginBottom: 1,
  },
  desc: {
    fontSize: rf(10),
    color: "rgba(226,232,248,0.78)",
    lineHeight: rf(13),
  },
});
