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
  verificationPending?: boolean | null;
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
  verificationPending,
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
    verificationPending,
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
    backgroundColor: "rgba(16,22,42,0.98)",
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
  iconGlowBottomBanner: {
    width: 28,
    height: 28,
    borderRadius: 14,
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
    color: "#858A9C",
    flexShrink: 1,
  },
  iconGlow: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
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
