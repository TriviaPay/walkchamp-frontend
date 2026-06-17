import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Dimensions,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useColors } from "@/hooks/useColors";
import { getValidSession } from "@/services/authService";
import { Image } from "expo-image";
import CoinsStoreModal from "@/components/CoinsStoreModal";
import { getApiBase } from "@/utils/apiUrl";
import { getLocalDateStr } from "@/utils/timezone";
import { useOwnedTrackLayouts } from "@/hooks/useOwnedTrackLayouts";
import { useDispatch } from "react-redux";
import { fetchTrackThemes } from "@/store/slices/trackThemesSlice";
import type { AppDispatch } from "@/store";

// ─── Data ────────────────────────────────────────────────────────────────────

const COIN_ENTRIES = [500, 1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000, 9000, 10000];
const PLAYER_COUNTS = [2, 3, 4, 5, 6, 7, 8, 9, 10];
const STEP_TARGETS = [50, 100, 500, 1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000, 10000, 15000, 20000];

type PickerOption = { label: string; displayLabel: string; value: number };

function fmtK(n: number): string {
  if (n < 1000) return String(n);
  return `${n / 1000}k`;
}

const COIN_OPTIONS: PickerOption[] = COIN_ENTRIES.map((n) => ({
  label: fmtK(n),
  displayLabel: n < 1000 ? `${n} coins` : `${fmtK(n)} coins`,
  value: n,
}));

const STEP_OPTIONS: PickerOption[] = STEP_TARGETS.map((n) => ({
  label: fmtK(n),
  displayLabel: n < 1000 ? `${n} steps` : `${fmtK(n)} steps`,
  value: n,
}));

const SNAP_ITEM_W = 88;

// ─── Prize helpers ───────────────────────────────────────────────────────────

function fmtCoins(n: number): string {
  return n.toLocaleString();
}

function numWinners(count: number): number {
  if (count <= 2) return 1;
  if (count === 3) return 2;
  return 3;
}

function calcPrize(coinEntry: number, playerCount: number) {
  const totalPool = coinEntry * playerCount;
  const nw = numWinners(playerCount);
  const splits = nw === 1 ? [1.0] : nw === 2 ? [0.6, 0.4] : [0.5, 0.3, 0.2];
  const prizes = splits.map((r, i) => ({
    rank: i + 1,
    label: ["1st", "2nd", "3rd"][i] as string,
    coins: Math.floor(totalPool * r),
  }));
  const distributed = prizes.reduce((s, p) => s + p.coins, 0);
  if (prizes.length > 0) prizes[0].coins += totalPool - distributed;
  return { totalPool, prizes };
}

// ─── CenteredSnapPicker ───────────────────────────────────────────────────────
// Same mechanic as the Free Challenge TargetStepsCenteredPicker.

interface CenteredSnapPickerProps {
  options: PickerOption[];
  value: number;
  onChange: (v: number) => void;
  accentColor: string;
  bgColor: string;
}

const CenteredSnapPicker = React.memo(function CenteredSnapPicker({
  options, value, onChange, accentColor, bgColor,
}: CenteredSnapPickerProps) {
  const { width: screenW } = useWindowDimensions();
  const scrollRef = useRef<ScrollView>(null);
  const [containerW, setContainerW] = useState(0);
  const effectiveW = containerW > 0 ? containerW : screenW - 48;
  const sidePad = Math.max(0, (effectiveW - SNAP_ITEM_W) / 2);

  const currentIdx = useRef(Math.max(0, options.findIndex((o) => o.value === value)));
  const [selIdx, setSelIdx] = useState(currentIdx.current);

  const scrollToIdx = useCallback((idx: number, animated: boolean) => {
    scrollRef.current?.scrollTo({ x: idx * SNAP_ITEM_W, animated });
  }, []);

  useEffect(() => {
    if (containerW > 0) {
      setTimeout(() => scrollToIdx(selIdx, false), 50);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [containerW]);

  useEffect(() => {
    const idx = Math.max(0, options.findIndex((o) => o.value === value));
    if (idx !== currentIdx.current) {
      currentIdx.current = idx;
      setSelIdx(idx);
      setTimeout(() => scrollToIdx(idx, true), 50);
    }
  }, [value, options, scrollToIdx]);

  const handleScrollEnd = useCallback((offsetX: number) => {
    const idx = Math.max(0, Math.min(Math.round(offsetX / SNAP_ITEM_W), options.length - 1));
    if (idx !== currentIdx.current) {
      currentIdx.current = idx;
      setSelIdx(idx);
      onChange(options[idx].value);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
  }, [options, onChange]);

  const bracketLeft = (effectiveW - SNAP_ITEM_W) / 2;

  return (
    <View
      onLayout={(e) => setContainerW(e.nativeEvent.layout.width)}
      style={{ height: 56, marginBottom: 10, position: "relative" }}
    >
      {/* Left edge fade */}
      <LinearGradient
        colors={[bgColor, "transparent"]}
        start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }}
        style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 72, zIndex: 2 }}
        pointerEvents="none"
      />
      {/* Right edge fade */}
      <LinearGradient
        colors={["transparent", bgColor]}
        start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }}
        style={{ position: "absolute", right: 0, top: 0, bottom: 0, width: 72, zIndex: 2 }}
        pointerEvents="none"
      />
      {/* Fixed center bracket */}
      <View
        pointerEvents="none"
        style={{
          position: "absolute",
          left: bracketLeft,
          top: 4, bottom: 4,
          width: SNAP_ITEM_W,
          borderWidth: 1.5,
          borderColor: accentColor + "88",
          borderRadius: 14,
          backgroundColor: accentColor + "12",
          zIndex: 3,
        }}
      />
      <ScrollView
        ref={scrollRef}
        horizontal
        showsHorizontalScrollIndicator={false}
        snapToInterval={SNAP_ITEM_W}
        decelerationRate="fast"
        bounces={false}
        overScrollMode="never"
        contentContainerStyle={{ paddingHorizontal: sidePad, alignItems: "center" }}
        onMomentumScrollEnd={(e) => handleScrollEnd(e.nativeEvent.contentOffset.x)}
        style={{ flex: 1 }}
      >
        {options.map((opt, i) => {
          const dist = Math.abs(i - selIdx);
          const isCenter = dist === 0;
          return (
            <TouchableOpacity
              key={opt.value}
              onPress={() => {
                currentIdx.current = i;
                setSelIdx(i);
                onChange(opt.value);
                scrollToIdx(i, true);
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              }}
              activeOpacity={0.7}
              style={{ width: SNAP_ITEM_W, height: 48, alignItems: "center", justifyContent: "center" }}
            >
              <Text style={{
                fontSize: isCenter ? 15 : dist === 1 ? 14 : dist === 2 ? 12 : 11,
                fontWeight: isCenter ? "700" : dist === 1 ? "600" : "400",
                color: isCenter ? accentColor : dist === 1 ? "#C8D6F8" : dist === 2 ? "#8A9BC8" : "#5A6890",
                opacity: isCenter ? 1 : dist === 1 ? 1 : dist === 2 ? 0.75 : 0.4,
                letterSpacing: isCenter ? 0.4 : 0,
                textAlign: "center",
              }}>
                {isCenter ? opt.displayLabel : opt.label}
              </Text>
              {isCenter && (
                <View style={{
                  position: "absolute", top: 5, right: 9,
                  backgroundColor: accentColor, borderRadius: 6,
                  width: 13, height: 13, alignItems: "center", justifyContent: "center",
                  zIndex: 4,
                }}>
                  <Feather name="check" size={8} color="#000" />
                </View>
              )}
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
});

// ─── Main Modal ──────────────────────────────────────────────────────────────

export interface CoinsBattleModalProps {
  visible: boolean;
  onClose: () => void;
  onCreated: (raceId: string, isHost: boolean) => void;
}

export default function CoinsBattleModal({ visible, onClose, onCreated }: CoinsBattleModalProps) {
  const colors = useColors();
  const dispatch = useDispatch<AppDispatch>();
  const { layouts: ownedLayouts } = useOwnedTrackLayouts();
  const { width: SCREEN_W } = useWindowDimensions();
  const [coinEntry, setCoinEntry] = useState(1000);
  const [playerCount, setPlayerCount] = useState(10);
  const [targetSteps, setTargetSteps] = useState(1000);
  const [trackLayout, setTrackLayout] = useState("bg");
  const [coinBalance, setCoinBalance] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showCoinsStore, setShowCoinsStore] = useState(false);

  const shakeAnim = useRef(new Animated.Value(0)).current;

  const fetchBalance = useCallback(async () => {
    const session = await getValidSession();
    if (!session) return;
    try {
      const res = await fetch(`${getApiBase()}/api/coins/balance?localDate=${getLocalDateStr()}`, {
        headers: { Authorization: `Bearer ${session}` },
      });
      if (res.ok) {
        const data = await res.json() as { currentBalance?: number };
        setCoinBalance(data.currentBalance ?? 0);
      }
    } catch {}
  }, []);

  useEffect(() => {
    if (visible) {
      fetchBalance();
      setError(null);
      // Refresh owned tracks so newly-purchased skins appear immediately
      void dispatch(fetchTrackThemes());
    }
  }, [visible, fetchBalance, dispatch]);

  // If currently-selected track is no longer owned, reset to default
  useEffect(() => {
    if (ownedLayouts.length > 0 && !ownedLayouts.find((l) => l.id === trackLayout)) {
      setTrackLayout("bg");
    }
  }, [ownedLayouts, trackLayout]);

  const prize = calcPrize(coinEntry, playerCount);
  const hasEnough = coinBalance !== null && coinBalance >= coinEntry;

  const shake = () => {
    Animated.sequence([
      Animated.timing(shakeAnim, { toValue: 8,  duration: 60, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: -8, duration: 60, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 6,  duration: 60, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 0,  duration: 60, useNativeDriver: true }),
    ]).start();
  };

  const handleHost = async () => {
    if (!hasEnough) { shake(); return; }
    setLoading(true);
    setError(null);
    try {
      const session = await getValidSession();
      if (!session) { setError("Not authenticated"); setLoading(false); return; }
      const res = await fetch(`${getApiBase()}/api/coins-battle/host`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session}` },
        body: JSON.stringify({ coinEntryAmount: coinEntry, maxPlayers: playerCount, targetSteps, trackLayout }),
      });
      const data = await res.json() as { raceId?: string; error?: string; code?: string };
      if (!res.ok) {
        if (data.code === "ACTIVE_RACE_EXISTS") setError("You are already in an active race.");
        else if (data.code === "INSUFFICIENT_COINS") setError(`You need ${fmtCoins(coinEntry)} coins to host this battle.`);
        else setError(data.error ?? "Failed to create room");
        setLoading(false);
        return;
      }
      if (data.raceId) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        onCreated(data.raceId, true);
      }
    } catch {
      setError("Network error. Please try again.");
    }
    setLoading(false);
  };

  const PRIZE_COLORS = ["#F59E0B", "#9CA3AF", "#B45309"] as const;
  const TRACK_CARD_W = SCREEN_W * 0.33;

  return (
    <Modal
      visible={visible}
      transparent={false}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={[styles.root, { backgroundColor: colors.background }]}>
        {/* Header */}
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <Text style={[styles.headerTitle, { color: colors.foreground }]}>Coins Battle</Text>
          <TouchableOpacity onPress={onClose} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
            <Feather name="x" size={22} color={colors.foreground} />
          </TouchableOpacity>
        </View>

        <ScrollView
          style={styles.scroll}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.scrollContent}
        >
          {/* Balance bar */}
          <View style={[styles.balanceBar, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Image source={require("@/assets/images/game-coin.png")} style={styles.coinIcon} contentFit="contain" />
            <Text style={[styles.balanceText, { color: colors.mutedForeground }]}>
              Your balance:{" "}
              <Text style={{ color: hasEnough ? "#F59E0B" : "#EF4444", fontWeight: "700" }}>
                {coinBalance !== null ? `${fmtCoins(coinBalance)} coins` : "—"}
              </Text>
            </Text>
          </View>

          {/* COINS ENTRY FEE */}
          <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>COINS ENTRY FEE</Text>
          <CenteredSnapPicker
            options={COIN_OPTIONS}
            value={coinEntry}
            onChange={setCoinEntry}
            accentColor="#F59E0B"
            bgColor={colors.background}
          />

          {/* NUMBER OF PLAYERS */}
          <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>NUMBER OF PLAYERS</Text>
          <View style={styles.playerGrid}>
            {PLAYER_COUNTS.map((n) => {
              const sel = n === playerCount;
              return (
                <TouchableOpacity
                  key={n}
                  onPress={() => { Haptics.selectionAsync(); setPlayerCount(n); }}
                  activeOpacity={0.78}
                  style={[
                    styles.playerPill,
                    {
                      backgroundColor: sel ? colors.primary : colors.card,
                      borderColor: sel ? colors.primary : colors.border,
                    },
                  ]}
                >
                  <Text style={{ fontSize: 14, fontWeight: sel ? "700" : "500", color: sel ? "#000" : colors.foreground }}>{n}</Text>
                  {sel && (
                    <View style={[styles.checkBadge, { backgroundColor: colors.primary }]}>
                      <Feather name="check" size={8} color="#000" />
                    </View>
                  )}
                </TouchableOpacity>
              );
            })}
          </View>

          {/* TARGET STEPS */}
          <View style={styles.sectionLabelRow}>
            <Feather name="target" size={13} color={colors.mutedForeground} />
            <Text style={[styles.sectionLabel, { color: colors.mutedForeground, marginBottom: 0 }]}>TARGET STEPS</Text>
          </View>
          <View style={{ height: 8 }} />
          <CenteredSnapPicker
            options={STEP_OPTIONS}
            value={targetSteps}
            onChange={setTargetSteps}
            accentColor={colors.primary}
            bgColor={colors.background}
          />

          {/* TRACK BACKGROUND */}
          <Text style={[styles.sectionLabel, { color: colors.mutedForeground, marginTop: 6 }]}>TRACK BACKGROUND</Text>
          <Text style={[styles.trackHint, { color: colors.mutedForeground }]}>Swipe to choose theme</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.trackRow}
            style={styles.hScroll}
          >
            {ownedLayouts.map((layout) => {
              const sel = layout.id === trackLayout;
              return (
                <TouchableOpacity
                  key={layout.id}
                  onPress={() => { Haptics.selectionAsync(); setTrackLayout(layout.id); }}
                  style={[
                    styles.trackCard,
                    { width: TRACK_CARD_W, borderColor: sel ? colors.primary : "transparent", borderWidth: sel ? 2.5 : 0 },
                  ]}
                  activeOpacity={0.85}
                >
                  <Image source={layout.source} style={styles.trackImg} contentFit="cover" />
                  {sel && (
                    <View style={styles.trackCheckOverlay}>
                      <View style={[styles.trackCheckCircle, { backgroundColor: colors.primary }]}>
                        <Feather name="check" size={14} color="#000" />
                      </View>
                    </View>
                  )}
                  <View style={styles.trackLabel}>
                    <Text style={styles.trackLabelText} numberOfLines={1}>{layout.label}</Text>
                  </View>
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          {/* Prize Preview */}
          <View style={[styles.prizeBox, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.prizeBoxHeader}>
              <Image source={require("@/assets/images/game-coin.png")} style={{ width: 14, height: 14 }} contentFit="contain" />
              <Text style={[styles.prizeBoxTitle, { color: "#F59E0B" }]}>Prize Preview</Text>
            </View>
            <View style={styles.prizeRow}>
              <Text style={[styles.prizeLabel, { color: colors.mutedForeground }]}>Entry</Text>
              <Text style={[styles.prizeValue, { color: colors.foreground }]}>{fmtCoins(coinEntry)} coins per player</Text>
            </View>
            <View style={[styles.prizeDivider, { backgroundColor: colors.border }]} />
            <View style={styles.prizeRow}>
              <Text style={[styles.prizeLabel, { color: colors.mutedForeground }]}>Prize Pool</Text>
              <Text style={[styles.prizeValue, { color: "#22C55E", fontWeight: "700" }]}>{fmtCoins(prize.totalPool)} coins</Text>
            </View>
            <View style={[styles.prizeDivider, { backgroundColor: colors.border }]} />
            <Text style={[styles.prizeLabel, { color: colors.mutedForeground, marginBottom: 6 }]}>Reward Split</Text>
            {prize.prizes.map((p, i) => (
              <View key={p.rank} style={styles.prizeRow}>
                <Text style={[styles.prizeLabel, { color: PRIZE_COLORS[i] }]}>{p.label}</Text>
                <Text style={[styles.prizeValue, { color: PRIZE_COLORS[i], fontWeight: "700" }]}>{fmtCoins(p.coins)} coins</Text>
              </View>
            ))}
          </View>

          {/* Insufficient balance warning */}
          {!hasEnough && coinBalance !== null && (
            <Animated.View style={[styles.warningBox, { transform: [{ translateX: shakeAnim }] }]}>
              <Feather name="alert-triangle" size={14} color="#EF4444" />
              <Text style={styles.warningText}>
                You need {fmtCoins(coinEntry)} coins to host this battle.
              </Text>
              <TouchableOpacity
                style={styles.shopBtn}
                onPress={() => setShowCoinsStore(true)}
                activeOpacity={0.8}
              >
                <Text style={styles.shopBtnText}>Go to Shop</Text>
              </TouchableOpacity>
            </Animated.View>
          )}

          {error && (
            <View style={[styles.errorBox, { backgroundColor: colors.card }]}>
              <Feather name="alert-circle" size={13} color="#EF4444" />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}
        </ScrollView>

        {/* Footer */}
        <View style={[styles.footer, { borderTopColor: colors.border, paddingBottom: 32 }]}>
          <TouchableOpacity
            onPress={handleHost}
            activeOpacity={0.85}
            disabled={loading}
            style={styles.hostBtn}
          >
            <LinearGradient
              colors={hasEnough ? ["#22C55E", "#16A34A"] : [colors.border, colors.border]}
              style={styles.hostBtnGrad}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
            >
              {loading ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <>
                  <Image source={require("@/assets/images/game-coin.png")} style={{ width: 18, height: 18 }} contentFit="contain" />
                  <Text style={[styles.hostBtnText, { color: hasEnough ? "#fff" : colors.mutedForeground }]}>
                    Host Coins Battle
                  </Text>
                </>
              )}
            </LinearGradient>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={onClose}
            activeOpacity={0.7}
            style={[styles.cancelBtn, { borderColor: colors.border }]}
          >
            <Text style={[styles.cancelText, { color: colors.mutedForeground }]}>Cancel</Text>
          </TouchableOpacity>

          <Text style={[styles.footerNote, { color: colors.mutedForeground }]}>
            Coins are deducted only when the match starts. If the room is cancelled before starting, no coins are spent.
          </Text>
        </View>
      </View>

      {/* Coins Store — opened from "Go to Shop" */}
      <CoinsStoreModal
        visible={showCoinsStore}
        onClose={() => { setShowCoinsStore(false); void fetchBalance(); }}
        onCoinsAdded={() => { void fetchBalance(); }}
      />
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },

  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTitle: { fontSize: 18, fontWeight: "700" },

  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 8 },

  balanceBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: StyleSheet.hairlineWidth,
    marginBottom: 20,
  },
  coinIcon: { width: 16, height: 16 },
  balanceText: { fontSize: 13, flex: 1 },

  sectionLabel: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.8,
    textTransform: "uppercase",
    marginBottom: 6,
  },
  sectionLabelRow: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 0 },

  playerGrid: {
    flexDirection: "row",
    flexWrap: "nowrap",
    justifyContent: "space-between",
    marginBottom: 16,
    gap: 4,
  },
  playerPill: {
    flex: 1,
    paddingVertical: 9,
    borderRadius: 10,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
  },
  checkBadge: {
    position: "absolute",
    top: -5,
    right: -5,
    width: 15,
    height: 15,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },

  hScroll: { marginBottom: 16 },
  trackHint: { fontSize: 12, marginBottom: 8, marginTop: -2 },
  trackRow: { gap: 10, paddingVertical: 4 },
  trackCard: {
    height: 100,
    borderRadius: 12,
    overflow: "hidden",
    position: "relative",
  },
  trackImg: { width: "100%", height: "100%" },
  trackCheckOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.25)",
    alignItems: "center",
    justifyContent: "center",
  },
  trackCheckCircle: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
  },
  trackLabel: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: "rgba(0,0,0,0.55)",
    paddingHorizontal: 6,
    paddingVertical: 4,
  },
  trackLabelText: { fontSize: 11, fontWeight: "600", color: "#fff", textAlign: "center" },

  prizeBox: {
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 14,
    marginTop: 4,
    marginBottom: 12,
  },
  prizeBoxHeader: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 10 },
  prizeBoxTitle: { fontSize: 13, fontWeight: "700" },
  prizeRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 5 },
  prizeLabel: { fontSize: 12 },
  prizeValue: { fontSize: 12 },
  prizeDivider: { height: StyleSheet.hairlineWidth, marginVertical: 8 },

  warningBox: {
    backgroundColor: "rgba(239,68,68,0.08)",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(239,68,68,0.3)",
    padding: 12,
    marginBottom: 10,
    gap: 6,
  },
  warningText: { fontSize: 12, color: "#EF4444", lineHeight: 16 },
  shopBtn: {
    alignSelf: "flex-start",
    backgroundColor: "rgba(239,68,68,0.15)",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: "rgba(239,68,68,0.35)",
    marginTop: 2,
  },
  shopBtnText: { fontSize: 12, fontWeight: "600", color: "#F87171" },

  errorBox: {
    flexDirection: "row",
    gap: 6,
    alignItems: "center",
    borderRadius: 8,
    padding: 10,
    marginBottom: 8,
  },
  errorText: { fontSize: 12, color: "#F87171", flex: 1 },

  footer: {
    paddingHorizontal: 20,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: 10,
  },
  hostBtn: { borderRadius: 14, overflow: "hidden" },
  hostBtnGrad: {
    height: 52,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
  },
  hostBtnText: { fontSize: 16, fontWeight: "700" },
  cancelBtn: {
    height: 46,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  cancelText: { fontSize: 15, fontWeight: "600" },
  footerNote: {
    fontSize: 11,
    textAlign: "center",
    lineHeight: 16,
    paddingHorizontal: 8,
  },
});
