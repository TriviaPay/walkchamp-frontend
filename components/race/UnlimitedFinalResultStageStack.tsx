/**
 * Progressive Streak final-result status cards (Image 4).
 * Backend-driven stages; exact titles/descriptions from product copy.
 */
import React, { memo } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import {
  resolveUnlimitedFinalResultStages,
  type UnlimitedFinalResultStage,
} from "@/features/unlimited/mappers/unlimitedTimezoneChange";
import type { UnlimitedChallengeResultStatus } from "@/features/unlimited/mappers/unlimitedResults";
import { rf } from "@/utils/responsive";

type Props = {
  resultStatus: UnlimitedChallengeResultStatus;
  viewerPersonallyFinished: boolean;
  finalVerificationStatus?: string | null;
  showingFinalResults?: boolean;
  /** Live race steps strip: show only the active stage (e.g. Final Results Pending). */
  currentStageOnly?: boolean;
  /** Match Live Race bottom "Race Finished" banner layout (full-width strip). */
  bottomBanner?: boolean;
  pastLivePhase?: boolean;
  registeredParticipantCount?: number | null;
  participantsFinishedCount?: number | null;
  participantsPendingCount?: number | null;
  pendingOpponentLabel?: string | null;
};

function StageIcon({ stage, compact }: { stage: UnlimitedFinalResultStage; compact?: boolean }) {
  const color = stage.accent;
  const name =
    stage.icon === "flag"
      ? "flag"
      : stage.icon === "hourglass"
        ? "clock"
        : stage.icon === "search"
          ? "search"
          : stage.icon === "check"
            ? "check-circle"
            : "award";
  return <Feather name={name as "flag"} size={compact ? 13 : 14} color={color} />;
}

export const UnlimitedFinalResultStageStack = memo(function UnlimitedFinalResultStageStack({
  resultStatus,
  viewerPersonallyFinished,
  finalVerificationStatus,
  showingFinalResults = false,
  currentStageOnly = false,
  bottomBanner = false,
  pastLivePhase = false,
  registeredParticipantCount,
  participantsFinishedCount,
  participantsPendingCount,
  pendingOpponentLabel,
}: Props) {
  const stages = resolveUnlimitedFinalResultStages({
    resultStatus,
    viewerPersonallyFinished,
    finalVerificationStatus,
    showingFinalResults,
    pastLivePhase,
    registeredParticipantCount,
    participantsFinishedCount,
    participantsPendingCount,
    pendingOpponentLabel,
  });
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
        return (
          <View
            key={stage.id}
            style={[
              styles.card,
              bottomBanner && styles.cardBottomBanner,
              { borderColor: stage.border },
              isCurrent && styles.cardCurrent,
              bottomBanner && isCurrent && { backgroundColor: `${stage.accent}12` },
            ]}
          >
            <View
              style={[
                styles.iconGlow,
                bottomBanner && styles.iconGlowBottomBanner,
                { backgroundColor: `${stage.accent}22` },
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
                numberOfLines={1}
              >
                {stage.title}
              </Text>
              <Text
                style={[styles.desc, bottomBanner && styles.descBottomBanner]}
                numberOfLines={bottomBanner ? 2 : 3}
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
    width: "100%",
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
    backgroundColor: "rgba(16,22,42,0.98)",
  },
  cardBottomBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    borderRadius: 0,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: "rgba(10,14,28,0.92)",
    width: "100%",
    minHeight: 72,
    height: 72,
  },
  iconGlowBottomBanner: {
    width: 28,
    height: 28,
    borderRadius: 14,
    marginTop: 0,
  },
  titleBottomBanner: {
    fontSize: rf(13),
    fontWeight: "800",
    marginBottom: 1,
    letterSpacing: 0.1,
  },
  descBottomBanner: {
    fontSize: rf(11),
    lineHeight: rf(14),
    fontWeight: "500",
    color: "#858A9C",
  },
  iconGlow: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  textCol: { flex: 1, minWidth: 0 },
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
