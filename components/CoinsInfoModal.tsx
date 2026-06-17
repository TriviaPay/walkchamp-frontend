import { LinearGradient } from "expo-linear-gradient";
import React, { useState, useEffect, useCallback } from "react";
import {
  ActivityIndicator,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { TouchableOpacity } from "@/components/HapticTouchableOpacity";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { getValidSession } from "@/services/authService";
import { getLocalDateStr } from "@/utils/timezone";
import CoinIcon from "@/components/CoinIcon";
import { Image } from "react-native";
import EarnTasksSection from "@/components/EarnTasksSection";

const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? "";
const shopImage = require("@/assets/images/shop-icon.png");


interface CoinSummary {
  balance: number;
  lifetimeEarned: number;
  lifetimeSpent: number;
  todayEarned: number;
}

interface Props {
  visible: boolean;
  onClose: () => void;
  onOpenStore: () => void;
}

export default function CoinsInfoModal({ visible, onClose, onOpenStore }: Props) {
  const colors = useColors();
  const [summary, setSummary] = useState<CoinSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  const fetchSummary = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const session = await getValidSession();
      if (!session) { setError(true); return; }
      const res = await fetch(`${API_BASE}/api/coins/summary?localDate=${getLocalDateStr()}`, {
        headers: { Authorization: `Bearer ${session}` },
      });
      if (!res.ok) { setError(true); return; }
      const data = await res.json() as CoinSummary & { currentBalance?: number; earnedToday?: number };
      setSummary({
        balance: data.balance ?? data.currentBalance ?? 0,
        lifetimeEarned: data.lifetimeEarned ?? 0,
        lifetimeSpent: data.lifetimeSpent ?? 0,
        todayEarned: data.todayEarned ?? data.earnedToday ?? 0,
      });
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (visible) void fetchSummary();
  }, [visible, fetchSummary]);

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={[styles.root, { backgroundColor: colors.background }]}>
        {/* Header */}
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <View style={styles.headerLeft}>
            <CoinIcon size="medium" />
            <Text style={[styles.headerTitle, { color: colors.foreground }]}>Coins</Text>
          </View>
          <TouchableOpacity onPress={onClose} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
            <Feather name="x" size={22} color={colors.foreground} />
          </TouchableOpacity>
        </View>

        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scroll}>
          {/* Balance card */}
          <LinearGradient
            colors={["#B8860B22", "#FFD70012"]}
            style={[styles.balanceCard, { borderColor: colors.border }]}
          >
            {loading ? (
              <ActivityIndicator color={colors.gold} style={{ marginVertical: 24 }} />
            ) : error ? (
              <View style={styles.errorRow}>
                <Feather name="alert-circle" size={16} color={colors.destructive} />
                <Text style={[styles.errorText, { color: colors.destructive }]}>
                  Could not load balance.
                </Text>
                <TouchableOpacity onPress={fetchSummary}>
                  <Text style={[styles.retryText, { color: colors.primary }]}>Retry</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <>
                <Text style={[styles.balanceLabel, { color: colors.mutedForeground }]}>Your Balance</Text>
                <View style={styles.balanceBigRow}>
                  <CoinIcon size="xl" />
                  <Text style={[styles.balanceBig, { color: colors.gold }]}>
                    {(summary?.balance ?? 0).toLocaleString()}
                  </Text>
                </View>
                <View style={[styles.statsDivider, { backgroundColor: colors.border }]} />
                <View style={styles.statsRow}>
                  <View style={styles.statItem}>
                    <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>Today</Text>
                    <Text style={[styles.statValue, { color: "#4ADE80" }]}>
                      +{summary?.todayEarned ?? 0}
                    </Text>
                  </View>
                  <View style={[styles.statDivider, { backgroundColor: colors.border }]} />
                  <View style={styles.statItem}>
                    <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>Lifetime</Text>
                    <Text style={[styles.statValue, { color: colors.foreground }]}>
                      {(summary?.lifetimeEarned ?? 0).toLocaleString()}
                    </Text>
                  </View>
                  <View style={[styles.statDivider, { backgroundColor: colors.border }]} />
                  <View style={styles.statItem}>
                    <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>Spent</Text>
                    <Text style={[styles.statValue, { color: colors.destructive }]}>
                      {(summary?.lifetimeSpent ?? 0).toLocaleString()}
                    </Text>
                  </View>
                </View>
              </>
            )}
          </LinearGradient>

          {/* Get more coins */}
          <TouchableOpacity
            style={[styles.storeBtn, { backgroundColor: colors.primary + "15", borderColor: colors.primary + "50" }]}
            onPress={() => { onClose(); setTimeout(onOpenStore, 300); }}
            activeOpacity={0.8}
          >
            <Image source={shopImage} style={styles.storeBtnIcon} resizeMode="contain" />
            <Text style={[styles.storeBtnText, { color: colors.primary }]}>Buy More Coins</Text>
            <Feather name="chevron-right" size={15} color={colors.primary} />
          </TouchableOpacity>

          {/* How to earn — grouped difficulty cards */}
          <EarnTasksSection visible={visible} />

          <View style={styles.bottomPad} />
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingTop: 20, paddingBottom: 16, borderBottomWidth: StyleSheet.hairlineWidth },
  headerLeft: { flexDirection: "row", alignItems: "center", gap: 8 },
  headerTitle: { fontSize: 22, fontWeight: "800" },
  scroll: { paddingHorizontal: 20, paddingTop: 20 },
  balanceCard: { borderRadius: 20, borderWidth: 1, padding: 20, marginBottom: 14, alignItems: "center" },
  balanceLabel: { fontSize: 13, marginBottom: 6 },
  balanceBigRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  balanceBig: { fontSize: 42, fontWeight: "900" },
  statsDivider: { height: 1, width: "100%", marginVertical: 14 },
  statsRow: { flexDirection: "row", alignItems: "center", width: "100%" },
  statItem: { flex: 1, alignItems: "center", gap: 4 },
  statDivider: { width: 1, height: 32 },
  statLabel: { fontSize: 11 },
  statValue: { fontSize: 18, fontWeight: "800" },
  errorRow: { flexDirection: "row", alignItems: "center", gap: 8, padding: 12 },
  errorText: { flex: 1, fontSize: 13 },
  retryText: { fontSize: 13, fontWeight: "700" },
  storeBtn: { flexDirection: "row", alignItems: "center", gap: 10, borderRadius: 14, borderWidth: 1, paddingHorizontal: 16, paddingVertical: 14, marginBottom: 24 },
  storeBtnIcon: { width: 28, height: 28 },
  storeBtnText: { flex: 1, fontSize: 15, fontWeight: "700" },
  bottomPad: { height: 40 },
});
