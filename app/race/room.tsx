import { LinearGradient } from "expo-linear-gradient";
import { getApiBase } from "@/utils/apiUrl";
import { router } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Animated,
  FlatList,
  Image,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  View} from "react-native";
import { AppAlert } from "@/components/AppAlert";
import { useSafeLayout } from "@/hooks/useSafeLayout";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";
import { useRace, RACE_DEFAULTS, RaceParticipant } from "@/context/RaceContext";

import { formatDuration } from "@/utils/format";
import { TouchableOpacity } from '@/components/HapticTouchableOpacity';
import { rf, rs } from "@/utils/responsive";

const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? "";

// ── Helpers ───────────────────────────────────────────────────────────────────

function getRaceConfig(entryFee: number, playersJoined: number, maxPlayers: number) {
  const isFree = entryFee === 0;
  const players = Math.max(playersJoined, maxPlayers);

  let title: string;
  let icon: string;
  if (entryFee === 0) { title = "Free Challenge"; icon = "🎁"; }
  else if (entryFee === 1) { title = "$1 Challenge"; icon = "⚡"; }
  else if (entryFee === 3) { title = "$3 Challenge"; icon = "📈"; }
  else if (entryFee === 5) { title = "$5 Champion Race"; icon = "💎"; }
  else { title = `$${entryFee} Challenge`; icon = "💰"; }

  const spectators = isFree
    ? 245 + Math.floor(Math.random() * 100)
    : Math.round(150 + players * 180);

  const totalPool = parseFloat((entryFee * players).toFixed(2));
  const winnersPool = parseFloat((totalPool * 0.7).toFixed(2));
  const platformFee = parseFloat((totalPool * 0.3).toFixed(2));
  // Winner count: 2-3 players → 1 winner; 4 players → 2 winners; 5+ → 3 winners
  const nW = playersJoined <= 3 ? 1 : playersJoined === 4 ? 2 : 3;
  const splits = nW === 1 ? [1.0] : nW === 2 ? [0.6, 0.4] : [0.5, 0.3, 0.2];
  const prizes = splits.map((s) => parseFloat((winnersPool * s).toFixed(2)));

  return { title, icon, fullTitle: `${icon} ${title}`, isFree, spectators, totalPool, winnersPool, platformFee, prizes, nWinners: nW }; }

// ── Sub-components ────────────────────────────────────────────────────────────

function ParticipantRow({ participant, rank, colors, userAvatarUrl, targetSteps }: {
  participant: RaceParticipant; rank: number;
  colors: ReturnType<typeof useColors>;
  userAvatarUrl?: string | null;
  targetSteps: number; }) {
  const progress = Math.min(participant.raceSteps / Math.max(targetSteps, 1), 1);
  const rankColors = [colors.gold, colors.silver, colors.bronze];
  const isTop3 = rank <= 3;
  const isUser = participant.isUser;
  const isForfeited = !!participant.isForfeited;

  const avatarColor = isForfeited ? "#FF4444" : participant.avatarColor;

  return (
    <View style={[
      styles.participantRow,
      { backgroundColor: isForfeited ? "#FF444408" : isUser ? `${colors.primary}12` : colors.card, borderColor: isForfeited ? "#FF444440" : isUser ? colors.primary : colors.border },
      (participant.isFinished || isForfeited) && { opacity: 0.75 },
    ]}>
      <View style={[styles.rankBox, isTop3 && participant.isFinished && !isForfeited && { backgroundColor: rankColors[rank - 1] + "20" }]}>
        {isForfeited ? (
          <Text style={[styles.rankText, { color: "#FF4444" }]}>✕</Text>
        ) : participant.isFinished && rank <= 3 ? (
          <Text style={[styles.rankText, { color: rankColors[rank - 1] }]}>{rank === 1 ? "🥇" : rank === 2 ? "🥈" : "🥉"}</Text>
        ) : (
          <Text style={[styles.rankText, { color: isUser ? colors.primary : colors.mutedForeground }]}>#{rank}</Text>
        )}
      </View>
      <View style={[styles.avatar, { backgroundColor: avatarColor + "25", borderColor: avatarColor }]}>
        {isUser && userAvatarUrl && !isForfeited ? (
          <Image source={{ uri: userAvatarUrl }} style={[styles.avatarImage, isForfeited && { opacity: 0.5 }]} />
        ) : (
          <Text style={[styles.avatarText, { color: avatarColor }]}>
            {participant.username.charAt(0).toUpperCase()}
          </Text>
        )}
      </View>
      <View style={styles.participantInfo}>
        <View style={styles.nameRow}>
          <Text style={[styles.username, { color: isForfeited ? "#FF4444" : isUser ? colors.primary : colors.foreground }]} numberOfLines={1}>
            {isUser ? "You" : `@${participant.username}`}
          </Text>
          <Text style={styles.flagText}>{participant.countryFlag}</Text>
          {isForfeited && (
            <View style={[styles.finishedChip, { backgroundColor: "#FF444420" }]}>
              <Text style={[styles.finishedText, { color: "#FF4444" }]}>Forfeited</Text>
            </View>
          )}
          {!isForfeited && participant.isFinished && (
            <View style={[styles.finishedChip, { backgroundColor: colors.success + "20" }]}>
              <Text style={[styles.finishedText, { color: colors.success }]}>Finished</Text>
            </View>
          )}
        </View>
        <View style={[styles.progressBar, { backgroundColor: colors.border }]}>
          <LinearGradient
            colors={isForfeited ? ["#FF4444", "#FF444480"] : isUser ? [colors.primary, colors.accent] : [participant.avatarColor, participant.avatarColor + "80"]}
            style={[styles.progressFill, { width: `${progress * 100}%` }]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
          />
        </View>
        <Text style={[styles.stepsSmall, { color: colors.mutedForeground }]}>
          {participant.raceSteps.toLocaleString()} / {targetSteps.toLocaleString()} steps
        </Text>
      </View>
      <Text style={[styles.stepsText, { color: isForfeited ? "#FF4444" : isUser ? colors.primary : colors.foreground }]}>
        {participant.raceSteps.toLocaleString()}
      </Text>
    </View>
  ); }

interface PrizeModalProps {
  visible: boolean;
  onClose: () => void;
  colors: ReturnType<typeof useColors>;
  isFree: boolean;
  entryFee: number;
  playersJoined: number;
  maxPlayers: number;
  totalPool: number;
  winnersPool: number;
  platformFee: number;
  prizes: number[]; }

function PrizeBreakdownModal({ visible, onClose, colors, isFree, entryFee, playersJoined, maxPlayers, totalPool, winnersPool, platformFee, prizes }: PrizeModalProps) {
  const players = Math.max(playersJoined, 2);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <TouchableOpacity style={styles.modalBackdrop} onPress={onClose} activeOpacity={1} />
        <View style={[styles.modalSheet, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={[styles.modalHandle, { backgroundColor: colors.border }]} />

          <View style={[styles.modalHeader, { borderBottomColor: colors.border }]}>
            <Text style={[styles.modalTitle, { color: colors.foreground }]}>
              {isFree ? "🎁 Reward Info" : "🏆 Prize Breakdown"}
            </Text>
            <TouchableOpacity onPress={onClose} style={[styles.modalCloseBtn, { backgroundColor: colors.background }]}>
              <Feather name="x" size={18} color={colors.foreground} />
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={styles.modalContent} showsVerticalScrollIndicator={false}>
            {isFree ? (
              <>
                <BreakdownRow label="Entry Fee" value="Free" valueColor={colors.success} colors={colors} />
                <BreakdownRow label="Prize Type" value="Badges & Ranking" valueColor={colors.primary} colors={colors} />
                <BreakdownRow label="Cash Prize" value="None" valueColor={colors.mutedForeground} colors={colors} />
                <BreakdownRow label="Result Based On" value="Verified Steps" valueColor={colors.foreground} colors={colors} />
                <View style={[styles.modalDivider, { backgroundColor: colors.border }]} />
                <View style={[styles.rewardNote, { backgroundColor: colors.primary + "10", borderColor: colors.primary + "30" }]}>
                  <Feather name="info" size={14} color={colors.primary} />
                  <Text style={[styles.rewardNoteText, { color: colors.mutedForeground }]}>
                    Free challenges award badges and leaderboard rank. No wallet funds are involved.
                  </Text>
                </View>
              </>
            ) : (
              <>
                <BreakdownRow label="Entry Fee" value={`$${entryFee.toFixed(2)}`} valueColor={colors.foreground} colors={colors} />
                <BreakdownRow label="Players Joined" value={`${players}`} valueColor={colors.foreground} colors={colors} />
                <View style={[styles.modalDivider, { backgroundColor: colors.border }]} />
                <BreakdownRow label="Total Pool" value={`$${totalPool.toFixed(2)}`} valueColor={colors.foreground} colors={colors} bold />
                <BreakdownRow label="Winners Pool (70%)" value={`$${winnersPool.toFixed(2)}`} valueColor={colors.success} colors={colors} />
                <BreakdownRow label="Platform Fee (30%)" value={`$${platformFee.toFixed(2)}`} valueColor={colors.mutedForeground} colors={colors} />
                <View style={[styles.modalDivider, { backgroundColor: colors.border }]} />
                {prizes[0] !== undefined && <BreakdownRow label={`🥇 1st Place (${prizes.length === 1 ? "100" : prizes.length === 2 ? "60" : "50"}%)`} value={`$${prizes[0].toFixed(2)}`} valueColor={colors.gold} colors={colors} bold />}
                {prizes[1] !== undefined && <BreakdownRow label={`🥈 2nd Place (${prizes.length === 2 ? "40" : "30"}%)`} value={`$${prizes[1].toFixed(2)}`} valueColor={colors.silver} colors={colors} />}
                {prizes[2] !== undefined && <BreakdownRow label="🥉 3rd Place (20%)" value={`$${prizes[2].toFixed(2)}`} valueColor={colors.bronze} colors={colors} />}
              </>
            )}

            <View style={[styles.disclaimer, { backgroundColor: colors.background, borderColor: colors.border }]}>
              <Feather name="shield" size={12} color={colors.mutedForeground} />
              <Text style={[styles.disclaimerText, { color: colors.mutedForeground }]}>
                Rewards are subject to activity verification. Suspicious activity may result in disqualification.
              </Text>
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  ); }

function BreakdownRow({ label, value, valueColor, colors, bold }: { label: string; value: string; valueColor: string; colors: ReturnType<typeof useColors>; bold?: boolean }) {
  return (
    <View style={styles.breakdownRow}>
      <Text style={[styles.breakdownLabel, { color: colors.mutedForeground }]}>{label}</Text>
      <Text style={[styles.breakdownValue, { color: valueColor, fontWeight: bold ? "700" : "500" }]}>{value}</Text>
    </View>
  ); }

// ── Main screen ───────────────────────────────────────────────────────────────

export default function RaceRoomScreen() {
  const colors = useColors();
  const { safeTop, safeBottom } = useSafeLayout();
  const { user } = useAuth();
  const userAvatarUrl = user?.id && user?.profileImageUrl ? `${getApiBase()}/api/profile/avatar/${user.id}?v=${user?.avatarVersion ?? ''}` : null;
  const {
    racePhase, raceEntryFee, raceMaxPlayers, playersJoined,
    participants, countdown, raceTimerSeconds, userRaceSteps,
    prizeTiers, raceTargetSteps, } = useRace();

  const countdownScale = useRef(new Animated.Value(1)).current;
  const [showPrizeModal, setShowPrizeModal] = useState(false);
  const [spectatorCount] = useState(() => Math.floor(Math.random() * 800) + 200);

  const config = getRaceConfig(raceEntryFee, playersJoined, raceMaxPlayers);
  const activePrizes = prizeTiers.length > 0 ? prizeTiers : config.prizes;
  const players = Math.max(playersJoined, 2);
  const totalPool = parseFloat((raceEntryFee * players).toFixed(2));
  const winnersPool = parseFloat((totalPool * 0.7).toFixed(2));
  const platformFeeAmt = parseFloat((totalPool * 0.3).toFixed(2));

  useEffect(() => {
    if (racePhase === "finished") {
      router.replace("/race/result"); } }, [racePhase]);

  useEffect(() => {
    if (racePhase === "countdown") {
      Animated.sequence([
        Animated.timing(countdownScale, { toValue: 1.4, duration: 150, useNativeDriver: true }),
        Animated.spring(countdownScale, { toValue: 1, useNativeDriver: true }),
      ]).start(); } }, [countdown, racePhase, countdownScale]);

  const sortedParticipants = [...participants].sort((a, b) => {
    if (a.isFinished && b.isFinished) return (a.finishRank ?? 99) - (b.finishRank ?? 99);
    if (a.isFinished) return -1;
    if (b.isFinished) return 1;
    return b.raceSteps - a.raceSteps; });

  const userProgress = Math.min(userRaceSteps / Math.max(raceTargetSteps, 1), 1);
  const userRank = sortedParticipants.findIndex((p) => p.isUser) + 1;

  const handleBack = () => {
    if (racePhase === "in_race") {
      AppAlert.alert(
        "Leave race view?",
        "Your race continues in the background. You won't lose your progress.",
        [
          { text: "Stay", style: "cancel" },
          { text: "Leave View", style: "default", onPress: () => router.replace("/(tabs)/walk") },
        ]
      ); } else {
      router.replace("/(tabs)/walk"); } };

  // ── Countdown phase ──
  if (racePhase === "countdown") {
    return (
      <View style={[styles.countdownContainer, { backgroundColor: colors.background }]}>
        <LinearGradient colors={[`${colors.accent}20`, "transparent"]} style={styles.countdownGlow} />
        <TouchableOpacity
          style={[styles.countdownBack, { top: safeTop + 12, backgroundColor: colors.card }]}
          onPress={handleBack}
        >
          <Feather name="arrow-left" size={20} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={[styles.countdownLabel, { color: colors.mutedForeground }]}>Race starting in</Text>
        <Animated.Text style={[styles.countdownNumber, { color: colors.primary, transform: [{ scale: countdownScale }] }]}>
          {countdown}
        </Animated.Text>
        <Text style={[styles.countdownReady, { color: colors.foreground }]}>Get Ready!</Text>
        <Text style={[styles.countdownTarget, { color: colors.mutedForeground }]}>
          Target: {raceTargetSteps.toLocaleString()} steps
        </Text>
      </View>
    ); }

  // ── Active race / finished ──
  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>

      {/* ── Header ── */}
      <View style={[styles.header, { paddingTop: safeTop + 8, backgroundColor: colors.card, borderBottomColor: colors.border }]}>

        {/* Row 1: Back · Title · Prize badge */}
        <View style={styles.headerRow1}>
          <TouchableOpacity style={[styles.backBtn, { backgroundColor: colors.background }]} onPress={handleBack}>
            <Feather name="arrow-left" size={20} color={colors.foreground} />
          </TouchableOpacity>
          <Text style={[styles.raceTitle, { color: colors.foreground }]} numberOfLines={1}>
            {config.fullTitle}
          </Text>
          <TouchableOpacity
            onPress={() => setShowPrizeModal(true)}
            style={[
              styles.prizeBadge,
              {
                backgroundColor: config.isFree ? colors.success + "18" : colors.gold + "18",
                borderColor: config.isFree ? colors.success + "40" : colors.gold + "40", },
            ]}
            activeOpacity={0.75}
          >
            {config.isFree ? (
              <Text style={[styles.prizeBadgeText, { color: colors.success }]}>Free 🎁</Text>
            ) : (
              <Text style={[styles.prizeBadgeText, { color: colors.gold }]}>
                ${activePrizes[0]?.toFixed(0)} 🏆
              </Text>
            )}
          </TouchableOpacity>
        </View>

        {/* Row 2: LIVE · timer · separator · spectators */}
        <View style={styles.headerRow2}>
          <View style={[styles.liveBadge, { backgroundColor: colors.destructive + "20", borderColor: colors.destructive + "40" }]}>
            <View style={[styles.liveDot, { backgroundColor: colors.destructive }]} />
            <Text style={[styles.liveText, { color: colors.destructive }]}>LIVE</Text>
          </View>
          <Feather name="clock" size={12} color={colors.mutedForeground} />
          <Text style={[styles.timerText, { color: colors.foreground }]}>{formatDuration(raceTimerSeconds)}</Text>
          <Text style={[styles.dot, { color: colors.mutedForeground }]}>·</Text>
          <Feather name="eye" size={12} color={colors.mutedForeground} />
          <Text style={[styles.spectatorText, { color: colors.mutedForeground }]}>
            {spectatorCount.toLocaleString()} watching
          </Text>
        </View>
      </View>

      {/* ── Race info bar ── */}
      <TouchableOpacity
        style={[styles.infoBar, { backgroundColor: colors.primary + "08", borderBottomColor: colors.border }]}
        onPress={() => setShowPrizeModal(true)}
        activeOpacity={0.8}
      >
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.infoBarContent}
        >
          <Feather name="flag" size={11} color={colors.primary} />
          <Text style={[styles.infoItem, { color: colors.foreground }]}>
            Target: <Text style={{ color: colors.primary, fontWeight: "700" }}>{raceTargetSteps.toLocaleString()} steps</Text>
          </Text>
          <Text style={[styles.infoSep, { color: colors.border }]}>|</Text>

          {config.isFree ? (
            <>
              <Text style={[styles.infoItem, { color: colors.success }]}>🎁 Free Entry</Text>
              <Text style={[styles.infoSep, { color: colors.border }]}>|</Text>
              <Text style={[styles.infoItem, { color: colors.mutedForeground }]}>Badges & rank only</Text>
            </>
          ) : (
            <>
              <Text style={[styles.infoItem, { color: colors.accent }]}>
                ${raceEntryFee} entry
              </Text>
              <Text style={[styles.infoSep, { color: colors.border }]}>|</Text>
              <Text style={[styles.infoItem, { color: colors.mutedForeground }]}>
                Pool <Text style={{ color: colors.foreground, fontWeight: "700" }}>${winnersPool.toFixed(2)}</Text>
              </Text>
              <Text style={[styles.infoSep, { color: colors.border }]}>|</Text>
              <Text style={[styles.infoItem, { color: colors.gold }]}>
                🥇 ${activePrizes[0]?.toFixed(2)}
              </Text>
              <Text style={[styles.infoSep, { color: colors.border }]}>·</Text>
              <Text style={[styles.infoItem, { color: colors.silver }]}>
                🥈 ${activePrizes[1]?.toFixed(2)}
              </Text>
              <Text style={[styles.infoSep, { color: colors.border }]}>·</Text>
              <Text style={[styles.infoItem, { color: colors.bronze }]}>
                🥉 ${activePrizes[2]?.toFixed(2)}
              </Text>
            </>
          )}
          <Text style={[styles.infoSep, { color: colors.border }]}>|</Text>
          <Feather name="info" size={11} color={colors.mutedForeground} />
        </ScrollView>
      </TouchableOpacity>

      {/* ── User progress hero ── */}
      <LinearGradient
        colors={[`${colors.primary}15`, `${colors.accent}08`]}
        style={[styles.heroCard, { borderBottomColor: colors.border }]}
      >
        <View style={styles.heroRow}>
          <View>
            <Text style={[styles.heroSteps, { color: colors.primary }]}>{userRaceSteps.toLocaleString()}</Text>
            <Text style={[styles.heroLabel, { color: colors.mutedForeground }]}>your steps</Text>
          </View>
          <View style={styles.heroRight}>
            <Text style={[styles.heroRank, { color: colors.foreground }]}>Rank #{userRank}</Text>
            <Text style={[styles.heroTarget, { color: colors.mutedForeground }]}>
              {Math.max(0, raceTargetSteps - userRaceSteps).toLocaleString()} steps to finish
            </Text>
          </View>
        </View>
        <View style={[styles.heroProgressTrack, { backgroundColor: colors.border }]}>
          <LinearGradient
            colors={[colors.primary, colors.accent]}
            style={[styles.heroProgressFill, { width: `${userProgress * 100}%` }]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
          />
        </View>
        <View style={styles.heroProgressLabels}>
          <Text style={[styles.heroProgressLabel, { color: colors.mutedForeground }]}>0</Text>
          <Text style={[styles.heroProgressLabel, { color: colors.primary }]}>{Math.round(userProgress * 100)}%</Text>
          <Text style={[styles.heroProgressLabel, { color: colors.mutedForeground }]}>
            {raceTargetSteps.toLocaleString()}
          </Text>
        </View>
      </LinearGradient>

      {/* ── Anti-cheat notice ── */}
      <View style={[styles.antiCheatBar, { backgroundColor: colors.success + "12", borderBottomColor: colors.border }]}>
        <Feather name="shield" size={12} color={colors.success} />
        <Text style={[styles.antiCheatText, { color: colors.success }]}>Anti-cheat monitoring active</Text>
      </View>

      {/* ── Participant leaderboard ── */}
      <FlatList
        data={sortedParticipants}
        keyExtractor={(item) => item.id}
        renderItem={({ item, index }) => (
          <ParticipantRow participant={item} rank={index + 1} colors={colors} userAvatarUrl={userAvatarUrl} targetSteps={raceTargetSteps} />
        )}
        contentContainerStyle={[styles.list, { paddingBottom: safeBottom + 20 }]}
        showsVerticalScrollIndicator={false}
      />

      {/* ── Prize breakdown modal ── */}
      <PrizeBreakdownModal
        visible={showPrizeModal}
        onClose={() => setShowPrizeModal(false)}
        colors={colors}
        isFree={config.isFree}
        entryFee={raceEntryFee}
        playersJoined={players}
        maxPlayers={raceMaxPlayers}
        totalPool={totalPool}
        winnersPool={winnersPool}
        platformFee={platformFeeAmt}
        prizes={activePrizes}
      />
    </View>
  ); }

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1 },

  // Countdown
  countdownContainer: { flex: 1, alignItems: "center", justifyContent: "center", gap: 16 },
  countdownGlow: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 },
  countdownBack: {
    position: "absolute", left: 16, width: rs(40), height: rs(40),
    borderRadius: 12, alignItems: "center", justifyContent: "center", },
  countdownLabel: { fontSize: rf(16) },
  countdownNumber: { fontSize: rf(120), fontWeight: "800", letterSpacing: -4 },
  countdownReady: { fontSize: rf(28), fontWeight: "800" },
  countdownTarget: { fontSize: rf(15) },

  // Header
  header: {
    paddingHorizontal: rs(14), paddingBottom: rs(10), borderBottomWidth: 1, gap: 8, },
  headerRow1: { flexDirection: "row", alignItems: "center", gap: 10 },
  backBtn: {
    width: rs(36), height: rs(36), borderRadius: 10,
    alignItems: "center", justifyContent: "center", flexShrink: 0, },
  raceTitle: { flex: 1, fontSize: rf(16), fontWeight: "700", letterSpacing: -0.3 },
  prizeBadge: {
    flexShrink: 0, borderRadius: 10, borderWidth: 1,
    paddingHorizontal: rs(10), paddingVertical: rs(5), },
  prizeBadgeText: { fontSize: rf(13), fontWeight: "700" },
  headerRow2: { flexDirection: "row", alignItems: "center", gap: 6 },
  liveBadge: {
    flexDirection: "row", alignItems: "center", gap: 5,
    paddingHorizontal: rs(8), paddingVertical: rs(3), borderRadius: 20, borderWidth: 1, },
  liveDot: { width: 6, height: 6, borderRadius: 3 },
  liveText: { fontSize: rf(10), fontWeight: "700", letterSpacing: 0.8 },
  timerText: { fontSize: rf(15), fontWeight: "700", fontVariant: ["tabular-nums"] },
  dot: { fontSize: rf(14) },
  spectatorText: { fontSize: rf(12) },

  // Info bar
  infoBar: { borderBottomWidth: 1 },
  infoBarContent: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: rs(14), paddingVertical: rs(8), },
  infoItem: { fontSize: rf(12) },
  infoSep: { fontSize: rf(12), paddingHorizontal: 2 },

  // Hero
  heroCard: { paddingHorizontal: rs(20), paddingVertical: rs(14), gap: 10, borderBottomWidth: 1 },
  heroRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  heroSteps: { fontSize: rf(40), fontWeight: "800", letterSpacing: -1 },
  heroLabel: { fontSize: rf(13) },
  heroRight: { alignItems: "flex-end" },
  heroRank: { fontSize: rf(18), fontWeight: "700" },
  heroTarget: { fontSize: rf(13), marginTop: 4 },
  heroProgressTrack: { height: 8, borderRadius: 4, overflow: "hidden" },
  heroProgressFill: { height: 8, borderRadius: 4 },
  heroProgressLabels: { flexDirection: "row", justifyContent: "space-between" },
  heroProgressLabel: { fontSize: rf(11) },

  // Anti-cheat
  antiCheatBar: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: rs(16), paddingVertical: rs(7), borderBottomWidth: StyleSheet.hairlineWidth, },
  antiCheatText: { fontSize: rf(12), fontWeight: "500" },

  // List
  list: { paddingHorizontal: rs(16), paddingTop: 10, gap: 8 },
  participantRow: {
    flexDirection: "row", alignItems: "center", gap: 10,
    borderRadius: 14, borderWidth: 1, padding: rs(12), },
  rankBox: { width: rs(34), height: rs(34), borderRadius: 10, alignItems: "center", justifyContent: "center" },
  rankText: { fontSize: rf(13), fontWeight: "700" },
  avatar: { width: rs(34), height: rs(34), borderRadius: rs(17), borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
  avatarImage: { width: rs(34), height: rs(34), borderRadius: rs(17) },
  avatarText: { fontSize: rf(13), fontWeight: "800" },
  participantInfo: { flex: 1, gap: 4 },
  nameRow: { flexDirection: "row", alignItems: "center", gap: 5 },
  username: { fontSize: rf(13), fontWeight: "600", maxWidth: 110 },
  flagText: { fontSize: rf(13) },
  finishedChip: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  finishedText: { fontSize: rf(10), fontWeight: "700" },
  progressBar: { height: 4, borderRadius: 2, overflow: "hidden" },
  progressFill: { height: 4, borderRadius: 2 },
  stepsSmall: { fontSize: rf(10) },
  stepsText: { fontSize: rf(14), fontWeight: "700", minWidth: 44, textAlign: "right" },

  // Prize modal
  modalOverlay: { flex: 1, justifyContent: "flex-end" },
  modalBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.55)" },
  modalSheet: {
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    borderWidth: 1, borderBottomWidth: 0, maxHeight: "80%", },
  modalHandle: { width: 40, height: 4, borderRadius: 2, alignSelf: "center", marginTop: 10, marginBottom: 2 },
  modalHeader: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: rs(20), paddingVertical: rs(14), borderBottomWidth: 1, },
  modalTitle: { fontSize: rf(17), fontWeight: "700" },
  modalCloseBtn: { width: rs(32), height: rs(32), borderRadius: 10, alignItems: "center", justifyContent: "center" },
  modalContent: { paddingHorizontal: rs(20), paddingTop: 12, paddingBottom: 32, gap: 4 },
  modalDivider: { height: 1, marginVertical: 10 },
  breakdownRow: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingVertical: rs(8), },
  breakdownLabel: { fontSize: rf(14) },
  breakdownValue: { fontSize: rf(14) },
  rewardNote: {
    flexDirection: "row", alignItems: "flex-start", gap: 8,
    borderRadius: 12, borderWidth: 1, padding: rs(12), marginTop: 8, },
  rewardNoteText: { flex: 1, fontSize: rf(13), lineHeight: 18 },
  disclaimer: {
    flexDirection: "row", alignItems: "flex-start", gap: 8,
    borderRadius: 12, borderWidth: 1, padding: rs(12), marginTop: 12, },
  disclaimerText: { flex: 1, fontSize: rf(12), lineHeight: 17 }, });
