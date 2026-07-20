import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import React from "react";
import { ScrollView,
  StyleSheet,
  Text,
  View} from "react-native";
import { AppAlert } from "@/components/AppAlert";
import { useSafeLayout } from "@/hooks/useSafeLayout";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useColors } from "@/hooks/useColors";
import { useRace, RACE_DEFAULTS } from "@/context/RaceContext";
import { useApp } from "@/context/AppContext";
import { TouchableOpacity } from '@/components/HapticTouchableOpacity';

const ENTRY_FEE = 1;
const MAX_PLAYERS = 10;

function InfoRow({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) {
  const colors = useColors();
  return (
    <View style={styles.infoRow}>
      <Text style={[styles.infoLabel, { color: colors.mutedForeground }]}>{label}</Text>
      <Text style={[styles.infoValue, { color: valueColor ?? colors.foreground }]}>{value}</Text>
    </View>
  ); }

function PrizeTierRow({ rank, amount, split, colors }: { rank: number; amount: number; split: string; colors: ReturnType<typeof useColors> }) {
  const rankColors = [colors.gold, colors.silver, colors.bronze];
  const icons = ["🥇", "🥈", "🥉"];
  return (
    <View style={[styles.prizeRow, { backgroundColor: rankColors[rank - 1] + "12", borderColor: rankColors[rank - 1] + "30" }]}>
      <Text style={styles.prizeIcon}>{icons[rank - 1]}</Text>
      <Text style={[styles.prizePlace, { color: rankColors[rank - 1] }]}>{rank === 1 ? "1st" : rank === 2 ? "2nd" : "3rd"} Place</Text>
      <Text style={[styles.prizeSplit, { color: colors.mutedForeground }]}>{split} of pool</Text>
      <Text style={[styles.prizeAmount, { color: rankColors[rank - 1] }]}>${amount.toFixed(2)}</Text>
    </View>
  ); }

export default function JoinRaceScreen() {
  const colors = useColors();
  const { insets, safeTop, safeBottom } = useSafeLayout();
  const { joinRace, racePhase } = useRace();
  const { walletBalance } = useApp();

  const canAfford = walletBalance >= ENTRY_FEE;
  const totalPool = MAX_PLAYERS * ENTRY_FEE;
  const winnersPool = totalPool * RACE_DEFAULTS.WINNERS_POOL_RATIO;
  const platformFee = totalPool * RACE_DEFAULTS.PLATFORM_FEE_RATIO;
  const prizeTiers = RACE_DEFAULTS.WINNER_SPLITS.map((s) =>
    parseFloat((winnersPool * s).toFixed(2))
  );

  const handleJoin = () => {
    if (!canAfford) {
      AppAlert.alert("Insufficient Balance", `You need $${ENTRY_FEE.toFixed(2)} to join a race. Please add funds to your wallet.`);
      return; }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    const success = joinRace(ENTRY_FEE, MAX_PLAYERS);
    if (success) {
      router.replace("/race/matchmaking"); } };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <LinearGradient
        colors={[`${colors.accent}12`, "transparent"]}
        style={styles.topGlow}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
      />

      {/* Header */}
      <View style={[styles.header, { paddingTop: safeTop + 12 }]}>
        <TouchableOpacity onPress={() => router.back()}>
          <Feather name="x" size={22} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>Walk Race</Text>
        <View style={{ width: 22 }} />
      </View>

      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: safeBottom + 24 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Hero */}
        <View style={styles.heroSection}>
          <LinearGradient
            colors={[`${colors.accent}20`, `${colors.primary}20`]}
            style={[styles.heroIcon, { borderColor: colors.accent + "40" }]}
          >
            <Feather name="flag" size={40} color={colors.accent} />
          </LinearGradient>
          <Text style={[styles.heroTitle, { color: colors.foreground }]}>Join a Walk Race</Text>
          <Text style={[styles.heroSub, { color: colors.mutedForeground }]}>
            Race against {MAX_PLAYERS} walkers. First 3 to reach {RACE_DEFAULTS.RACE_TARGET.toLocaleString()} steps win a share of the prize pool.
          </Text>
        </View>

        {/* Race Details */}
        <View style={[styles.detailsCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.cardTitle, { color: colors.foreground }]}>Race Details</Text>
          <InfoRow label="Entry Fee" value={`$${ENTRY_FEE.toFixed(2)} per player`} valueColor={colors.accent} />
          <View style={[styles.divider, { backgroundColor: colors.border }]} />
          <InfoRow label="Target Steps" value={`${RACE_DEFAULTS.RACE_TARGET.toLocaleString()} steps`} />
          <View style={[styles.divider, { backgroundColor: colors.border }]} />
          <InfoRow label="Players Required" value={`${MAX_PLAYERS} players`} />
          <View style={[styles.divider, { backgroundColor: colors.border }]} />
          <InfoRow label="Entry Pool / Prize Pool" value={`$${totalPool.toFixed(2)}`} valueColor={colors.gold} />
        </View>

        {/* Prize Split */}
        <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Prize Split</Text>
        <PrizeTierRow rank={1} amount={prizeTiers[0]} split="50%" colors={colors} />
        <PrizeTierRow rank={2} amount={prizeTiers[1]} split="30%" colors={colors} />
        <PrizeTierRow rank={3} amount={prizeTiers[2]} split="20%" colors={colors} />

        {/* Anti-cheat notice */}
        <View style={[styles.noticeCard, { backgroundColor: colors.warning + "12", borderColor: colors.warning + "30" }]}>
          <Feather name="shield" size={16} color={colors.warning} />
          <Text style={[styles.noticeText, { color: colors.warning }]}>
            Race steps are verified with anti-cheat checks. Suspicious activity results in disqualification. Prizes held pending verification.
          </Text>
        </View>

        {/* Wallet balance */}
        <View style={[styles.walletRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Feather name="dollar-sign" size={16} color={canAfford ? colors.primary : colors.destructive} />
          <Text style={[styles.walletLabel, { color: colors.mutedForeground }]}>Your balance:</Text>
          <Text style={[styles.walletBalance, { color: canAfford ? colors.primary : colors.destructive }]}>
            ${walletBalance.toFixed(2)}
          </Text>
          {!canAfford && (
            <Text style={[styles.insufficientText, { color: colors.destructive }]}>Insufficient</Text>
          )}
        </View>

        {/* Join Button */}
        <TouchableOpacity
          style={[styles.joinBtn, { opacity: canAfford ? 1 : 0.5 }]}
          onPress={handleJoin}
          activeOpacity={0.85}
        >
          <LinearGradient
            colors={canAfford ? [colors.accent, colors.primary] : [colors.muted, colors.muted]}
            style={styles.joinGradient}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
          >
            <Feather name="zap" size={22} color={canAfford ? colors.primaryForeground : colors.mutedForeground} />
            <Text style={[styles.joinText, { color: canAfford ? colors.primaryForeground : colors.mutedForeground }]}>
              {canAfford ? `Join Race — $${ENTRY_FEE.toFixed(2)} Entry` : "Add Funds to Join"}
            </Text>
          </LinearGradient>
        </TouchableOpacity>

        <Text style={[styles.fine, { color: colors.mutedForeground }]}>
          By joining, $1.00 will be deducted from your wallet immediately. Refunds are not available once the race starts.
        </Text>
      </ScrollView>
    </View>
  ); }

const styles = StyleSheet.create({
  container: { flex: 1 },
  topGlow: { position: "absolute", top: 0, left: 0, right: 0, height: 200 },
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 20, paddingBottom: 12, },
  headerTitle: { fontSize: 18, fontWeight: "700" },
  scroll: { paddingHorizontal: 20 },
  heroSection: { alignItems: "center", gap: 12, marginBottom: 24, paddingTop: 8 },
  heroIcon: { width: 96, height: 96, borderRadius: 28, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  heroTitle: { fontSize: 26, fontWeight: "800", letterSpacing: -0.5 },
  heroSub: { fontSize: 15, textAlign: "center", lineHeight: 22 },
  detailsCard: { borderRadius: 16, borderWidth: 1, padding: 16, marginBottom: 20 },
  cardTitle: { fontSize: 16, fontWeight: "700", marginBottom: 14 },
  infoRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingVertical: 8 },
  infoLabel: { fontSize: 14 },
  infoValue: { fontSize: 14, fontWeight: "600" },
  divider: { height: StyleSheet.hairlineWidth },
  sectionTitle: { fontSize: 17, fontWeight: "700", marginBottom: 10 },
  prizeRow: {
    flexDirection: "row", alignItems: "center", gap: 10,
    borderRadius: 14, borderWidth: 1, padding: 14, marginBottom: 8, },
  prizeIcon: { fontSize: 22 },
  prizePlace: { fontWeight: "700", fontSize: 15, width: 70 },
  prizeSplit: { flex: 1, fontSize: 13 },
  prizeAmount: { fontSize: 18, fontWeight: "800" },
  noticeCard: { flexDirection: "row", gap: 10, alignItems: "flex-start", borderRadius: 12, borderWidth: 1, padding: 14, marginBottom: 14, marginTop: 4 },
  noticeText: { flex: 1, fontSize: 13, lineHeight: 18 },
  walletRow: {
    flexDirection: "row", alignItems: "center", gap: 8,
    borderRadius: 14, borderWidth: 1, paddingHorizontal: 16, paddingVertical: 12, marginBottom: 16, },
  walletLabel: { fontSize: 14 },
  walletBalance: { fontSize: 17, fontWeight: "700", flex: 1 },
  insufficientText: { fontSize: 13, fontWeight: "600" },
  joinBtn: { borderRadius: 16, overflow: "hidden", marginBottom: 12 },
  joinGradient: { paddingVertical: 18, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10 },
  joinText: { fontSize: 18, fontWeight: "700" },
  fine: { fontSize: 12, textAlign: "center", lineHeight: 18 }, });
