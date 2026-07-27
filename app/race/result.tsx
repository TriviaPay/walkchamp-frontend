import { LinearGradient } from "expo-linear-gradient";
import { router, useLocalSearchParams } from "expo-router";
import React, { useEffect, useMemo, useRef } from "react";
import { ActivityIndicator, Animated, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeLayout } from "@/hooks/useSafeLayout";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { useRace, RaceResult } from "@/context/RaceContext";
import { formatDuration } from "@/utils/format";
import { TouchableOpacity } from "@/components/HapticTouchableOpacity";
import { rf, rs } from "@/utils/responsive";
import { useRaceResultStatus } from "@/hooks/useRaceResultStatus";
import {
  resultStatusDisplayLabel,
  type RaceVerificationStatusApi,
} from "@/services/raceVerificationApi";
import { canShowFinalRaceOutcome } from "@/services/steps/finalRaceAuthority";

function WinnerCard({
  result,
  isUser,
  colors,
  showFinalOutcome,
}: {
  result: RaceResult;
  isUser: boolean;
  colors: ReturnType<typeof useColors>;
  showFinalOutcome: boolean;
}) {
  const displayRank = result.displayRank ?? result.rank;
  const rankColors = [colors.gold, colors.silver, colors.bronze];
  const rankColor = displayRank <= 3 ? rankColors[displayRank - 1] : colors.mutedForeground;
  const icons = ["🥇", "🥈", "🥉"];
  const scaleAnim = useRef(new Animated.Value(0.8)).current;
  const isForfeited = !!result.participant.isForfeited;

  useEffect(() => {
    Animated.spring(scaleAnim, {
      toValue: 1,
      useNativeDriver: true,
      tension: 70,
      friction: 6,
      delay: displayRank * 120,
    }).start();
  }, [scaleAnim, displayRank]);

  const cardBg = isForfeited ? "#FF444412" : isUser ? `${colors.primary}15` : `${rankColor}12`;
  const cardBorder = isForfeited ? "#FF444440" : isUser ? colors.primary : `${rankColor}40`;
  const avatarColor = isForfeited ? "#FF4444" : result.participant.avatarColor;
  const nameColor = isForfeited ? "#FF4444" : isUser ? colors.primary : colors.foreground;

  const statusLabel = !showFinalOutcome
    ? result.status === "under_review"
      ? "Under review"
      : "Verifying"
    : result.status === "pending_verification"
      ? "Verifying"
      : "Won";

  const statusWarn = !showFinalOutcome || result.status === "pending_verification";

  return (
    <Animated.View
      style={[
        styles.winnerCard,
        { backgroundColor: cardBg, borderColor: cardBorder, transform: [{ scale: scaleAnim }] },
        isForfeited && { opacity: 0.8 },
      ]}
    >
      <View style={styles.winnerLeft}>
        <Text style={styles.winnerIcon}>
          {isForfeited ? "✕" : showFinalOutcome && displayRank <= 3 ? icons[displayRank - 1] : `#${displayRank}`}
        </Text>
        <View style={[styles.winnerAvatar, { backgroundColor: avatarColor + "30", borderColor: avatarColor }]}>
          <Text style={[styles.winnerAvatarText, { color: avatarColor }]}>
            {result.participant.isUser ? "Y" : result.participant.username.charAt(0).toUpperCase()}
          </Text>
        </View>
        <View>
          <View style={styles.winnerNameRow}>
            <Text style={[styles.winnerName, { color: nameColor }]} numberOfLines={1}>
              {result.participant.isUser ? "You" : `@${result.participant.username}`}
            </Text>
            <Text style={styles.winnerFlag}>{result.participant.countryFlag}</Text>
            {isForfeited && (
              <View style={[styles.tiedBadge, { backgroundColor: "#FF444425" }]}>
                <Text style={[styles.tiedBadgeText, { color: "#FF4444" }]}>FORFEITED</Text>
              </View>
            )}
            {!isForfeited && result.isTied && (
              <View style={[styles.tiedBadge, { backgroundColor: colors.warning + "25" }]}>
                <Text style={[styles.tiedBadgeText, { color: colors.warning }]}>Tied</Text>
              </View>
            )}
          </View>
          <Text style={[styles.winnerSteps, { color: colors.mutedForeground }]}>
            {showFinalOutcome
              ? `${result.participant.raceSteps.toLocaleString()} steps`
              : "Steps pending verification"}
          </Text>
        </View>
      </View>
      {!isForfeited && result.prizeAmount > 0 && (
        <View style={styles.winnerRight}>
          {showFinalOutcome ? (
            <Text style={[styles.winnerPrize, { color: rankColor }]}>
              ${result.prizeAmount.toFixed(2)}
            </Text>
          ) : (
            <Text style={[styles.winnerPrize, { color: colors.mutedForeground }]}>—</Text>
          )}
          {showFinalOutcome && result.isTied && result.tieGroupSize > 1 && (
            <Text style={[styles.tiedShareText, { color: colors.mutedForeground }]}>
              shared ÷{result.tieGroupSize}
            </Text>
          )}
          <View
            style={[
              styles.statusChip,
              { backgroundColor: statusWarn ? colors.warning + "20" : colors.success + "20" },
            ]}
          >
            <Text
              style={[
                styles.statusText,
                { color: statusWarn ? colors.warning : colors.success },
              ]}
            >
              {statusLabel}
            </Text>
          </View>
        </View>
      )}
    </Animated.View>
  );
}

export default function RaceResultScreen() {
  const colors = useColors();
  const { safeTop, safeBottom } = useSafeLayout();
  const params = useLocalSearchParams<{ raceId?: string }>();
  const {
    results,
    userFinishRank,
    totalPool,
    raceTimerSeconds,
    resetRace,
    raceMaxPlayers,
    raceId: contextRaceId,
  } = useRace();

  const raceId = (typeof params.raceId === "string" ? params.raceId : null) || contextRaceId;
  const { status: resultStatus, loading } = useRaceResultStatus(raceId, {
    enabled: !!raceId,
    pollWhilePending: true,
  });

  const featureOn = resultStatus?.featureEnabled !== false;
  const verificationStatus: RaceVerificationStatusApi =
    resultStatus?.verificationStatus ?? "verification_pending";
  const showFinal = canShowFinalRaceOutcome(
    verificationStatus === "finalized"
      ? "finalized"
      : verificationStatus === "review_required"
        ? "review_required"
        : verificationStatus === "verification_rejected"
          ? "verification_rejected"
          : verificationStatus === "verification_delayed"
            ? "verification_delayed"
            : "pending",
    { verificationFeatureEnabled: featureOn ? true : resultStatus?.featureEnabled ?? null },
  );

  const userResult = results.find((r) => r.participant.isUser);
  const finalRank = showFinal
    ? (resultStatus?.rank ?? userFinishRank)
    : null;
  const didWin = showFinal && finalRank !== null && finalRank <= 3;
  const displaySteps = showFinal
    ? (resultStatus?.steps ?? userResult?.participant.raceSteps ?? 0)
    : (resultStatus?.liveSteps ?? userResult?.participant.raceSteps ?? null);
  const statusLabel = useMemo(
    () =>
      featureOn
        ? resultStatusDisplayLabel(verificationStatus)
        : "Race Complete",
    [featureOn, verificationStatus],
  );

  const headerAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.spring(headerAnim, {
      toValue: 1,
      useNativeDriver: true,
      tension: 60,
      friction: 8,
      delay: 200,
    }).start();
  }, [headerAnim]);

  const handlePlayAgain = () => {
    resetRace();
    router.replace("/race");
  };

  const handleDone = () => {
    resetRace();
    router.dismissAll();
  };

  const heroTitle = !featureOn
    ? didWin
      ? `You Placed #${finalRank}!`
      : "Race Complete"
    : showFinal
      ? didWin
        ? `You Placed #${finalRank}!`
        : "Race Complete"
      : statusLabel;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <LinearGradient
        colors={
          didWin
            ? [`${colors.gold}15`, "transparent"]
            : [`${colors.accent}10`, "transparent"]
        }
        style={styles.glow}
      />

      <ScrollView
        contentContainerStyle={[
          styles.scroll,
          { paddingTop: safeTop + 20, paddingBottom: safeBottom + 24 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <Animated.View
          style={[
            styles.heroSection,
            {
              opacity: headerAnim,
              transform: [
                {
                  translateY: headerAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [20, 0],
                  }),
                },
              ],
            },
          ]}
        >
          <View
            style={[
              styles.heroIcon,
              {
                backgroundColor: didWin ? colors.gold + "25" : colors.card,
                borderColor: didWin ? colors.gold + "40" : colors.border,
              },
            ]}
          >
            <Text style={styles.heroEmoji}>{didWin ? "🏆" : featureOn && !showFinal ? "🛡️" : "🏃"}</Text>
          </View>
          <Text style={[styles.heroTitle, { color: colors.foreground }]}>{heroTitle}</Text>
          {loading && featureOn && !showFinal && (
            <ActivityIndicator color={colors.primary} style={{ marginTop: 8 }} />
          )}
          {didWin && userResult && showFinal && (
            <View
              style={[
                styles.prizeBanner,
                { backgroundColor: colors.gold + "15", borderColor: colors.gold + "30" },
              ]}
            >
              <Feather name="dollar-sign" size={18} color={colors.gold} />
              <Text style={[styles.prizeText, { color: colors.gold }]}>
                {resultStatus?.payoutCents != null
                  ? `$${(resultStatus.payoutCents / 100).toFixed(2)} Prize`
                  : `$${userResult.prizeAmount.toFixed(2)} Prize`}
              </Text>
              <View style={[styles.verifyChip, { backgroundColor: colors.success + "20" }]}>
                <Text style={[styles.verifyText, { color: colors.success }]}>Verified</Text>
              </View>
            </View>
          )}
          {featureOn && !showFinal && (
            <Text style={[styles.heroSub, { color: colors.mutedForeground }]}>
              {verificationStatus === "review_required"
                ? `Provisional live steps: ${(displaySteps ?? 0).toLocaleString()}. Payout on hold until review completes.`
                : verificationStatus === "verification_rejected"
                  ? "Your result could not be verified. No prize will be credited."
                  : "Final rank and prize appear after step verification finishes."}
            </Text>
          )}
          {(!featureOn || showFinal) && !didWin && (
            <Text style={[styles.heroSub, { color: colors.mutedForeground }]}>
              You finished #{finalRank ?? userResult?.rank ?? "—"} with{" "}
              {(displaySteps ?? userResult?.participant.raceSteps ?? 0).toLocaleString()}{" "}
              steps. Better luck next time!
            </Text>
          )}
        </Animated.View>

        <View style={[styles.summaryRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.summaryItem}>
            <Feather name="clock" size={16} color={colors.mutedForeground} />
            <Text style={[styles.summaryValue, { color: colors.foreground }]}>
              {formatDuration(raceTimerSeconds)}
            </Text>
            <Text style={[styles.summaryLabel, { color: colors.mutedForeground }]}>Duration</Text>
          </View>
          <View style={[styles.summaryDivider, { backgroundColor: colors.border }]} />
          <View style={styles.summaryItem}>
            <Feather name="users" size={16} color={colors.mutedForeground} />
            <Text style={[styles.summaryValue, { color: colors.foreground }]}>{raceMaxPlayers}</Text>
            <Text style={[styles.summaryLabel, { color: colors.mutedForeground }]}>Players</Text>
          </View>
          <View style={[styles.summaryDivider, { backgroundColor: colors.border }]} />
          <View style={styles.summaryItem}>
            <Feather name="dollar-sign" size={16} color={colors.gold} />
            <Text style={[styles.summaryValue, { color: colors.gold }]}>
              ${totalPool.toFixed(2)}
            </Text>
            <Text style={[styles.summaryLabel, { color: colors.mutedForeground }]}>Prize Pool</Text>
          </View>
        </View>

        <View style={[styles.breakdownCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.breakdownTitle, { color: colors.foreground }]}>Prize Breakdown</Text>
          <View style={styles.breakdownRow}>
            <Text style={[styles.breakdownLabel, { color: colors.mutedForeground }]}>
              Entry Pool / Prize Pool
            </Text>
            <Text style={[styles.breakdownValue, { color: colors.gold }]}>
              ${totalPool.toFixed(2)}
            </Text>
          </View>
        </View>

        {featureOn && !showFinal && (
          <View
            style={[
              styles.verifyNotice,
              { backgroundColor: colors.warning + "12", borderColor: colors.warning + "30" },
            ]}
          >
            <Feather name="shield" size={16} color={colors.warning} />
            <Text style={[styles.verifyNoticeText, { color: colors.warning }]}>
              {statusLabel}. Final rankings and wallet credit appear only after verification
              completes.
            </Text>
          </View>
        )}

        <Text style={[styles.sectionTitle, { color: colors.foreground }]}>
          {showFinal ? "Final Rankings" : "Participants"}
        </Text>
        {results.map((result) => (
          <WinnerCard
            key={result.participant.id}
            result={result}
            isUser={!!result.participant.isUser}
            colors={colors}
            showFinalOutcome={showFinal || !featureOn}
          />
        ))}

        <TouchableOpacity
          style={[styles.playAgainBtn, { borderRadius: 16, overflow: "hidden" }]}
          onPress={handlePlayAgain}
        >
          <LinearGradient
            colors={[colors.accent, colors.primary]}
            style={styles.playAgainGradient}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
          >
            <Feather name="refresh-cw" size={18} color={colors.primaryForeground} />
            <Text style={[styles.playAgainText, { color: colors.primaryForeground }]}>
              Play Again
            </Text>
          </LinearGradient>
        </TouchableOpacity>
        <TouchableOpacity style={styles.doneBtn} onPress={handleDone}>
          <Text style={[styles.doneBtnText, { color: colors.mutedForeground }]}>Back to Home</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  glow: { position: "absolute", top: 0, left: 0, right: 0, height: 300 },
  scroll: { paddingHorizontal: rs(20) },
  heroSection: { alignItems: "center", gap: 12, marginBottom: rs(20) },
  heroIcon: {
    width: rs(96),
    height: rs(96),
    borderRadius: 28,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  heroEmoji: { fontSize: rf(48) },
  heroTitle: {
    fontSize: rf(28),
    fontWeight: "800",
    textAlign: "center",
    letterSpacing: -0.5,
  },
  heroSub: { fontSize: rf(15), textAlign: "center" },
  prizeBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: rs(16),
    paddingVertical: rs(12),
  },
  prizeText: { fontSize: rf(22), fontWeight: "800" },
  verifyChip: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  verifyText: { fontSize: rf(11), fontWeight: "700" },
  summaryRow: {
    flexDirection: "row",
    borderRadius: 16,
    borderWidth: 1,
    padding: rs(16),
    marginBottom: rs(14),
  },
  summaryItem: { flex: 1, alignItems: "center", gap: 4 },
  summaryValue: { fontSize: rf(16), fontWeight: "700" },
  summaryLabel: { fontSize: rf(11), fontWeight: "600" },
  summaryDivider: { width: 1, alignSelf: "stretch" },
  breakdownCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: rs(16),
    marginBottom: rs(14),
    gap: 10,
  },
  breakdownTitle: { fontSize: rf(15), fontWeight: "700" },
  breakdownRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  breakdownLabel: { fontSize: rf(13) },
  breakdownValue: { fontSize: rf(15), fontWeight: "700" },
  verifyNotice: {
    flexDirection: "row",
    gap: 10,
    borderRadius: 14,
    borderWidth: 1,
    padding: rs(14),
    marginBottom: rs(14),
  },
  verifyNoticeText: { flex: 1, fontSize: rf(13), lineHeight: rf(18), fontWeight: "600" },
  sectionTitle: {
    fontSize: rf(18),
    fontWeight: "800",
    marginBottom: rs(12),
    marginTop: rs(4),
  },
  winnerCard: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderRadius: 16,
    borderWidth: 1,
    padding: rs(14),
    marginBottom: rs(10),
  },
  winnerLeft: { flexDirection: "row", alignItems: "center", gap: 10, flex: 1 },
  winnerIcon: { fontSize: rf(22), width: rs(32), textAlign: "center" },
  winnerAvatar: {
    width: rs(40),
    height: rs(40),
    borderRadius: 20,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
  },
  winnerAvatarText: { fontSize: rf(16), fontWeight: "800" },
  winnerNameRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  winnerName: { fontSize: rf(15), fontWeight: "700", maxWidth: rs(120) },
  winnerFlag: { fontSize: rf(12) },
  tiedBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  tiedBadgeText: { fontSize: rf(9), fontWeight: "800" },
  winnerSteps: { fontSize: rf(12), marginTop: 2 },
  winnerRight: { alignItems: "flex-end", gap: 4 },
  winnerPrize: { fontSize: rf(16), fontWeight: "800" },
  tiedShareText: { fontSize: rf(10) },
  statusChip: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 },
  statusText: { fontSize: rf(10), fontWeight: "700" },
  playAgainBtn: { marginTop: rs(16) },
  playAgainGradient: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: rs(14),
  },
  playAgainText: { fontSize: rf(16), fontWeight: "800" },
  doneBtn: { alignItems: "center", paddingVertical: rs(14) },
  doneBtnText: { fontSize: rf(14), fontWeight: "600" },
});
