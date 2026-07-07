import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Pressable,
  ActivityIndicator,
  Alert,
  Animated,
  Image,
  Modal,
  Share,
  RefreshControl,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { Feather } from "@expo/vector-icons";
import { useFocusEffect, useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import { isSponsoredRegistrationOpen, canOpenSponsoredWaitingRoom } from "@/utils/sponsoredEventRegistration";
import {
  isSponsoredEventVisible,
  parseSponsoredEventsResponse,
  type SponsoredEventDto,
} from "@/utils/sponsoredEventsApi";
import { useAppDispatch } from "@/store/hooks";
import { fetchCoinBalance } from "@/store/slices/coinsSlice";
import { rf, rs } from "@/utils/responsive";
import { SkeletonList } from "@/components/SkeletonRows";
import { authFetch } from "@/utils/authFetch";
import { getBadgeColor } from "@/utils/mockData";
import { subscribeToChannel, SPONSORED_EVENTS_CHANNEL, EVENTS } from "@/services/realtimeService";
import { getApiBase } from "@/utils/apiUrl";
import { PublicProfileModal } from "@/components/PublicProfileModal";
import type { PublicProfileInitialData } from "@/components/PublicProfileModal";

const COIN_IMG     = require("@/assets/images/game-coin.png");
const BLUE_SHOE_IMG = require("@/assets/images/blue-shoe.png");

// ── Color palettes ─────────────────────────────────────────────────────────────
const PALETTES = [
  {
    grad:   ["#0e0025", "#1d004e", "#091832"] as [string, string, string],
    glow1:  "#7C3AFF", glow2: "#C47BFF",
    border: "#7B30FF55", shadow: "#7C3AFF",
    bar:    ["#7C3AFF", "#C47BFF"] as [string, string],
    reg:    ["#5B21B6", "#7C3AFF", "#C47BFF"] as [string, string, string],
  },
  {
    grad:   ["#001a1a", "#003344", "#050f1a"] as [string, string, string],
    glow1:  "#00B4FF", glow2: "#00E5C8",
    border: "#00B4FF45", shadow: "#00B4FF",
    bar:    ["#00B4FF", "#00E5C8"] as [string, string],
    reg:    ["#007ACC", "#00B4FF", "#00E5C8"] as [string, string, string],
  },
  {
    grad:   ["#1a0e00", "#2e1800", "#0f100a"] as [string, string, string],
    glow1:  "#FF8C00", glow2: "#FFD700",
    border: "#FF8C0045", shadow: "#FF8C00",
    bar:    ["#FF6B35", "#FFD700"] as [string, string],
    reg:    ["#E06000", "#FF8C00", "#FFD700"] as [string, string, string],
  },
];
function paletteFor(scheduledStartAt: string | null): typeof PALETTES[0] {
  if (!scheduledStartAt) return PALETTES[0];
  const day = new Date(scheduledStartAt).getDay(); // 0=Sun, 6=Sat
  if (day === 6) return PALETTES[0]; // Saturday → purple
  if (day === 0) return PALETTES[1]; // Sunday  → teal/cyan
  return PALETTES[0];
}

// ── Types ──────────────────────────────────────────────────────────────────────
interface RegisteredUser {
  userId: string;
  username: string;
  avatarUrl: string | null;
  avatarColor: string;
  countryFlag: string | null;
  badge: string;
}
interface SponsoredEvent extends SponsoredEventDto {}

// ── Countdown ──────────────────────────────────────────────────────────────────
function useCountdown(iso: string | null): string {
  const [label, setLabel] = useState("");
  useEffect(() => {
    if (!iso) { setLabel(""); return; }
    const tick = () => {
      const diff = new Date(iso).getTime() - Date.now();
      if (diff <= 0) { setLabel("Starting now"); return; }
      const d = Math.floor(diff / 86400000);
      const h = Math.floor((diff % 86400000) / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      if (d > 0) setLabel(`${d}d ${h}h ${m}m`);
      else if (h > 0) setLabel(`${h}h ${m}m ${s}s`);
      else setLabel(`${m}m ${s}s`);
    };
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [iso]);
  return label;
}

// ── Status chip ────────────────────────────────────────────────────────────────
function statusConfig(ev: SponsoredEvent) {
  if (ev.status === "in_progress") return { text: "🔴 LIVE",      color: "#00E676", bg: "#00E67620" };
  if (ev.status === "completed")   return { text: "✓ DONE",       color: "#888",    bg: "#88888820" };
  if (ev.status === "cancelled")   return { text: "✕ CANCELLED",  color: "#FF5555", bg: "#FF555520" };
  if (ev.isFull)                   return { text: "⚡ FULL",       color: "#FF9800", bg: "#FF980020" };
  if (ev.isRegistered)             return { text: "✓ REGISTERED", color: "#A78BFA", bg: "#A78BFA25" };
  if (isSponsoredRegistrationOpen(ev)) return { text: "OPEN",      color: "#00E5FF", bg: "#00E5FF20" };
  if (ev.status === "scheduled")   return { text: "CLOSED",       color: "#888",    bg: "#88888820" };
  return                                  { text: "CLOSED",       color: "#888",    bg: "#88888820" };
}

// ── Prize info banner (collapsible) ───────────────────────────────────────────
function PrizeBanner() {
  const [open, setOpen] = useState(false);
  const anim = useRef(new Animated.Value(0)).current;

  const toggle = () => {
    const toVal = open ? 0 : 1;
    setOpen(!open);
    Animated.timing(anim, { toValue: toVal, duration: 230, useNativeDriver: false }).start();
  };

  const maxH = anim.interpolate({ inputRange: [0, 1], outputRange: [0, 260] });

  return (
    <View style={pb.wrap}>
      {/* Top accent strip */}
      <View style={pb.accentBar} />
      <View style={pb.body}>
        {/* Header row */}
        <TouchableOpacity style={pb.header} onPress={toggle} activeOpacity={0.75}>
          <View style={pb.iconWrap}>
            <Feather name="info" size={15} color="#F59E0B" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={pb.title}>How Prizes Work</Text>
            <Text style={pb.subtitle}>Amazon Gift Cards · 2 winners per race</Text>
          </View>
          <Feather name={open ? "chevron-up" : "chevron-down"} size={16} color="rgba(255,255,255,0.35)" />
        </TouchableOpacity>

        {/* Collapsed preview — prize chips */}
        {!open && (
          <View style={pb.previewRow}>
            <View style={[pb.prizeChip, { borderColor: "#F59E0B40" }]}>
              <Text style={pb.prizeChipLabel}>🥇 1st</Text>
              <Text style={pb.prizeChipVal}>$5 Gift Card</Text>
            </View>
            <View style={[pb.prizeChip, { borderColor: "#D4A20040" }]}>
              <Text style={pb.prizeChipLabel}>🥈 2nd</Text>
              <Text style={pb.prizeChipVal}>$5 Gift Card</Text>
            </View>
          </View>
        )}

        {/* Expanded details */}
        <Animated.View style={{ maxHeight: maxH, overflow: "hidden" }}>
          <View style={pb.expanded}>
            {/* Amazon branding row */}
            <View style={pb.amazonRow}>
              <Image source={require("@/assets/images/amazon-gift-card.jpeg")} style={pb.amazonCardImg} resizeMode="contain" />
              <View style={{ flex: 1 }}>
                <Text style={pb.amazonTitle}>amazon.com gift card</Text>
                <Text style={pb.amazonSub}>$5 value · Delivered via email</Text>
              </View>
              <View style={pb.amazonAmount}>
                <Text style={pb.amazonAmountText}>$5</Text>
              </View>
            </View>

            <View style={pb.divider} />

            {/* Rules list */}
            <View style={pb.ruleRow}>
              <Text style={pb.ruleDot}>🏆</Text>
              <Text style={pb.ruleText}>Top <Text style={{ color: "#F59E0B", fontWeight: "800" }}>2 finishers</Text> each receive a $5 Amazon gift card</Text>
            </View>
            <View style={pb.ruleRow}>
              <Text style={pb.ruleDot}>⚡</Text>
              <Text style={pb.ruleText}>Race to <Text style={{ color: "#6EE7B7", fontWeight: "800" }}>10,000 steps</Text> — fastest walkers win</Text>
            </View>
            <View style={pb.ruleRow}>
              <Text style={pb.ruleDot}>🔒</Text>
              <Text style={pb.ruleText}>Event needs ≥ 2 players to start — otherwise full coin refund</Text>
            </View>
          </View>
        </Animated.View>
      </View>
    </View>
  );
}
const pb = StyleSheet.create({
  wrap: {
    marginBottom: rs(18),
    borderRadius: 18, overflow: "hidden",
    borderWidth: 1.5, borderColor: "#F59E0B35",
    backgroundColor: "#0F0D08",
    shadowColor: "#F59E0B", shadowOpacity: 0.18,
    shadowRadius: 14, shadowOffset: { width: 0, height: 4 }, elevation: 6,
  },
  accentBar: { height: 3, backgroundColor: "#F59E0B" },
  body: { backgroundColor: "#0F0D08" },
  header: {
    flexDirection: "row", alignItems: "center", gap: rs(10),
    paddingHorizontal: rs(14), paddingTop: rs(12), paddingBottom: rs(10),
  },
  iconWrap: {
    width: rs(30), height: rs(30), borderRadius: 15,
    backgroundColor: "#F59E0B18", borderWidth: 1, borderColor: "#F59E0B35",
    alignItems: "center", justifyContent: "center",
  },
  title: { fontSize: rf(13.5), fontWeight: "800", color: "#FFF" },
  subtitle: { fontSize: rf(10.5), color: "rgba(255,255,255,0.38)", marginTop: 1 },
  previewRow: {
    flexDirection: "row", gap: rs(7),
    paddingHorizontal: rs(14), paddingBottom: rs(12),
  },
  prizeChip: {
    flex: 1, alignItems: "center", gap: 3,
    backgroundColor: "#F59E0B10", borderWidth: 1,
    borderRadius: 10, paddingVertical: rs(8),
  },
  prizeChipLabel: { fontSize: rf(9.5), color: "rgba(255,255,255,0.45)", fontWeight: "600" },
  prizeChipVal: { fontSize: rf(11), fontWeight: "800", color: "#F59E0B" },
  expanded: { paddingHorizontal: rs(14), paddingBottom: rs(14), gap: rs(2) },
  amazonRow: {
    flexDirection: "row", alignItems: "center", gap: rs(10),
    backgroundColor: "#FF990010", borderWidth: 1, borderColor: "#FF990028",
    borderRadius: 12, padding: rs(12), marginBottom: rs(12),
  },
  amazonCardImg: { width: rs(52), height: rs(52), borderRadius: 8 },
  amazonBadge: {
    width: rs(36), height: rs(36), borderRadius: 18,
    backgroundColor: "#FF9900", alignItems: "center", justifyContent: "center",
  },
  amazonA: { fontSize: rf(18), fontWeight: "900", color: "#000", lineHeight: 22 },
  amazonSmile: { fontSize: rf(9), color: "#000", marginTop: -6 },
  amazonTitle: { fontSize: rf(12.5), fontWeight: "800", color: "#FF9900" },
  amazonSub: { fontSize: rf(10), color: "rgba(255,255,255,0.38)", marginTop: 1 },
  amazonAmount: {
    backgroundColor: "#FF9900", borderRadius: 8,
    paddingHorizontal: rs(8), paddingVertical: rs(4),
  },
  amazonAmountText: { fontSize: rf(14), fontWeight: "900", color: "#000" },
  divider: { height: 1, backgroundColor: "rgba(255,255,255,0.06)", marginVertical: rs(10) },
  ruleRow: { flexDirection: "row", gap: rs(8), alignItems: "flex-start", paddingVertical: rs(4) },
  ruleDot: { fontSize: rf(13), width: rs(20) },
  ruleText: { flex: 1, fontSize: rf(12), color: "rgba(255,255,255,0.5)", lineHeight: 18 },
});

// ── Animated glow orb ──────────────────────────────────────────────────────────
function GlowOrb({ color, style }: { color: string; style: object }) {
  const anim = useRef(new Animated.Value(0.25)).current;
  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(anim, { toValue: 0.65, duration: 2200, useNativeDriver: true }),
        Animated.timing(anim, { toValue: 0.25, duration: 2200, useNativeDriver: true }),
      ])
    ).start();
  }, [anim]);
  return <Animated.View style={[style, { backgroundColor: color, opacity: anim }]} />;
}

// ── Calendar date badge ────────────────────────────────────────────────────────
const MONTHS = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];
function CalendarBadge({ iso, accentColor }: { iso: string | null; accentColor: string }) {
  if (!iso) return (
    <View style={[cal.box, { borderColor: accentColor + "55", backgroundColor: accentColor + "15" }]}>
      <Text style={[cal.mon, { color: accentColor }]}>🏆</Text>
    </View>
  );
  const d = new Date(iso);
  return (
    <View style={[cal.box, { borderColor: accentColor + "55", backgroundColor: accentColor + "12" }]}>
      <Text style={[cal.mon, { color: accentColor }]}>{MONTHS[d.getMonth()]}</Text>
      <Text style={[cal.day, { color: "#FFF" }]}>{d.getDate()}</Text>
    </View>
  );
}
const cal = StyleSheet.create({
  box: {
    width: rs(48), height: rs(54), borderRadius: 12, borderWidth: 1,
    alignItems: "center", justifyContent: "center", flexShrink: 0,
  },
  mon: { fontSize: rf(9), fontWeight: "800", letterSpacing: 1 },
  day: { fontSize: rf(23), fontWeight: "900", lineHeight: 29 },
});

// ── Avatar with fallback ───────────────────────────────────────────────────────
function AvatarWithFallback({
  userId, avatarColor, username, size, style,
}: {
  userId: string; avatarColor: string; username: string;
  size: number; style?: object;
}) {
  const [failed, setFailed] = useState(false);
  const uri = `${getApiBase()}/api/profile/avatar/${userId}`;
  return (
    <View style={[{ width: size, height: size, borderRadius: size / 2, overflow: "hidden" }, style]}>
      {!failed ? (
        <Image
          source={{ uri }}
          style={{ width: size, height: size }}
          onError={() => setFailed(true)}
        />
      ) : (
        <View style={{ width: size, height: size, backgroundColor: avatarColor, alignItems: "center", justifyContent: "center" }}>
          <Text style={{ fontSize: size * 0.42, fontWeight: "800", color: "#FFF" }}>
            {username.charAt(0).toUpperCase()}
          </Text>
        </View>
      )}
    </View>
  );
}

// ── User row (registrant) ──────────────────────────────────────────────────────
interface UserRowProps { user: RegisteredUser; accentColor: string; onPress: () => void }
function UserRow({ user, accentColor, onPress }: UserRowProps) {
  const badgeColor = getBadgeColor(user.badge);
  return (
    <View style={ur.row}>
      <TouchableOpacity onPress={onPress} activeOpacity={0.75} style={[ur.avatarWrap, { borderColor: accentColor + "70" }]}>
        <AvatarWithFallback
          userId={user.userId}
          avatarColor={user.avatarColor}
          username={user.username}
          size={rs(40)}
        />
      </TouchableOpacity>
      <View style={{ flex: 1 }}>
        <View style={ur.nameRow}>
          <Text style={ur.username} numberOfLines={1}>@{user.username}</Text>
          {user.countryFlag ? <Text style={ur.flag}>{user.countryFlag}</Text> : null}
        </View>
        <View style={[ur.badgePill, { backgroundColor: badgeColor + "20", borderColor: badgeColor + "55" }]}>
          <Text style={[ur.badgeText, { color: badgeColor }]}>{user.badge}</Text>
        </View>
      </View>
    </View>
  );
}
const ur = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: rs(10), marginBottom: rs(10) },
  avatarWrap: { borderRadius: rs(21), borderWidth: 1.5, overflow: "hidden", flexShrink: 0 },
  nameRow: { flexDirection: "row", alignItems: "center", gap: rs(5), flexWrap: "wrap" },
  username: { fontSize: rf(13.5), fontWeight: "700", color: "#FFF" },
  flag: { fontSize: rf(14) },
  badgePill: {
    alignSelf: "flex-start", borderWidth: 1, borderRadius: 10,
    paddingHorizontal: 7, paddingVertical: 2, marginTop: 3,
  },
  badgeText: { fontSize: rf(10), fontWeight: "700" },
});

// ── Custom Register Modal ──────────────────────────────────────────────────────
interface RegisterModalProps {
  visible: boolean;
  ev: SponsoredEvent | null;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}
function RegisterModal({ visible, ev, busy, onConfirm, onCancel }: RegisterModalProps) {
  if (!ev) return null;
  const title = ev.title.replace(/\s*\([A-Za-z]+\s+\d+\)\s*$/, "").trim();
  const startDate = ev.scheduledStartAt ? new Date(ev.scheduledStartAt) : null;
  const dateStr = startDate ? startDate.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" }) : "";
  const timeStr = startDate ? startDate.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) : "";
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <Pressable style={m.backdrop} onPress={onCancel}>
        <Pressable onPress={() => {}} style={m.card}>
          <LinearGradient colors={["#12003A", "#0A001E"]} style={m.grad} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}>
            {/* Title */}
            <Text style={m.label}>Register for Race</Text>
            <Text style={m.eventTitle}>{title}</Text>
            {dateStr ? <Text style={m.dateText}>{dateStr}  ·  {timeStr}</Text> : null}

            <View style={m.divider} />

            {/* Coin deduction box */}
            <View style={m.coinBox}>
              <Image source={COIN_IMG} style={{ width: 28, height: 28 }} resizeMode="contain" />
              <View style={{ flex: 1 }}>
                <Text style={m.coinAmount}>{ev.entryCoinFee.toLocaleString()} coins deducted</Text>
                <Text style={m.coinSub}>Charged immediately from your wallet</Text>
              </View>
            </View>

            {/* Refund guarantee */}
            <View style={m.refundRow}>
              <Feather name="shield" size={14} color="#00E5C8" />
              <Text style={m.refundText}>Full refund if you leave before the race starts</Text>
            </View>

            <View style={m.divider} />

            {/* Buttons */}
            <View style={m.btnRow}>
              <TouchableOpacity style={m.cancelBtn} onPress={onCancel} activeOpacity={0.8} disabled={busy}>
                <Text style={m.cancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={m.confirmBtn} onPress={onConfirm} activeOpacity={0.82} disabled={busy}>
                <LinearGradient colors={["#7C3AFF", "#C47BFF"]} style={m.confirmGrad} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}>
                  {busy ? (
                    <ActivityIndicator size="small" color="#FFF" />
                  ) : (
                    <>
                      <Feather name="user-plus" size={14} color="#FFF" />
                      <Text style={m.confirmText}>Register Now</Text>
                    </>
                  )}
                </LinearGradient>
              </TouchableOpacity>
            </View>
          </LinearGradient>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// ── Custom Leave Modal ─────────────────────────────────────────────────────────
interface LeaveModalProps {
  visible: boolean;
  ev: SponsoredEvent | null;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}
function LeaveModal({ visible, ev, busy, onConfirm, onCancel }: LeaveModalProps) {
  if (!ev) return null;
  const title = ev.title.replace(/\s*\([A-Za-z]+\s+\d+\)\s*$/, "").trim();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <Pressable style={m.backdrop} onPress={onCancel}>
        <Pressable onPress={() => {}} style={m.card}>
          <LinearGradient colors={["#12003A", "#0A001E"]} style={m.grad} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}>
            {/* Title */}
            <Text style={m.label}>Leave Race</Text>
            <Text style={m.eventTitle}>{title}</Text>

            <View style={m.divider} />

            {/* Refund box */}
            <View style={[m.coinBox, { backgroundColor: "rgba(0,229,200,0.08)", borderColor: "#00E5C840" }]}>
              <Image source={COIN_IMG} style={{ width: 28, height: 28 }} resizeMode="contain" />
              <View style={{ flex: 1 }}>
                <Text style={[m.coinAmount, { color: "#00E5C8" }]}>{ev.entryCoinFee.toLocaleString()} coins refunded</Text>
                <Text style={m.coinSub}>Returned to your wallet immediately</Text>
              </View>
            </View>

            <View style={m.divider} />

            {/* Buttons */}
            <View style={m.btnRow}>
              <TouchableOpacity style={[m.confirmBtn, { flex: 1 }]} onPress={onCancel} activeOpacity={0.8} disabled={busy}>
                <LinearGradient colors={["#2A1060", "#1A0840"]} style={m.confirmGrad} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}>
                  <Text style={[m.confirmText, { color: "#C4B5FD" }]}>Stay In</Text>
                </LinearGradient>
              </TouchableOpacity>
              <TouchableOpacity style={m.leaveConfirmBtn} onPress={onConfirm} activeOpacity={0.82} disabled={busy}>
                {busy ? (
                  <ActivityIndicator size="small" color="#FF7777" />
                ) : (
                  <>
                    <Feather name="log-out" size={14} color="#FF7777" />
                    <Text style={m.leaveConfirmText}>Leave · Get Coins Back</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          </LinearGradient>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const m = StyleSheet.create({
  backdrop: {
    flex: 1, backgroundColor: "rgba(0,0,0,0.75)",
    alignItems: "center", justifyContent: "center",
    paddingHorizontal: rs(24),
  },
  card: { width: "100%", borderRadius: 24, overflow: "hidden" },
  grad: { padding: rs(22) },
  label: { fontSize: rf(11), fontWeight: "700", color: "rgba(255,255,255,0.4)", letterSpacing: 1, textTransform: "uppercase", marginBottom: rs(6) },
  eventTitle: { fontSize: rf(18), fontWeight: "900", color: "#FFF", lineHeight: 24 },
  dateText: { fontSize: rf(12), color: "rgba(255,255,255,0.45)", marginTop: 4 },
  divider: { height: 1, backgroundColor: "rgba(255,255,255,0.08)", marginVertical: rs(16) },
  coinBox: {
    flexDirection: "row", alignItems: "center", gap: rs(12),
    backgroundColor: "rgba(255,179,0,0.10)", borderWidth: 1, borderColor: "#FFB30040",
    borderRadius: 14, padding: rs(14),
  },
  coinAmount: { fontSize: rf(15), fontWeight: "800", color: "#FFD700" },
  coinSub: { fontSize: rf(11), color: "rgba(255,255,255,0.4)", marginTop: 2 },
  refundRow: { flexDirection: "row", alignItems: "center", gap: rs(8), marginTop: rs(10) },
  refundText: { fontSize: rf(12), color: "#00E5C8", fontWeight: "600", flex: 1, lineHeight: 18 },
  btnRow: { flexDirection: "row", gap: rs(10) },
  cancelBtn: {
    flex: 1, backgroundColor: "rgba(255,255,255,0.07)", borderWidth: 1, borderColor: "rgba(255,255,255,0.12)",
    borderRadius: 14, paddingVertical: rs(14), alignItems: "center", justifyContent: "center",
  },
  cancelText: { fontSize: rf(14), fontWeight: "700", color: "rgba(255,255,255,0.6)" },
  confirmBtn: { flex: 1.4, borderRadius: 14, overflow: "hidden" },
  confirmGrad: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: rs(7), paddingVertical: rs(14) },
  confirmText: { fontSize: rf(14), fontWeight: "800", color: "#FFF" },
  leaveConfirmBtn: {
    flex: 1.6, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: rs(7),
    backgroundColor: "rgba(255,68,68,0.12)", borderWidth: 1, borderColor: "#FF444440",
    borderRadius: 14, paddingVertical: rs(14),
  },
  leaveConfirmText: { fontSize: rf(13.5), fontWeight: "700", color: "#FF7777" },
});

// ── Event Card ─────────────────────────────────────────────────────────────────
interface CardProps {
  ev: SponsoredEvent;
  index: number;
  coinBalance: number;
  onRegister:    (id: string) => void;
  onLeave:       (id: string) => void;
  onShare:       (ev: SponsoredEvent) => void;
  onAvatarPress: (user: RegisteredUser) => void;
  busy: boolean;
}

function EventCard({ ev, index, coinBalance, onRegister, onLeave, onShare, onAvatarPress, busy }: CardProps) {
  const router       = useRouter();
  const pal          = paletteFor(ev.scheduledStartAt);
  const countdown    = useCountdown(ev.scheduledStartAt);
  const endCountdown = useCountdown(ev.endsAt ?? null);
  const sc           = statusConfig(ev);
  const slotPct    = ev.maxSlots > 0 ? ev.registeredCount / ev.maxSlots : 0;
  const almostFull = slotPct >= 0.8 && slotPct < 1;
  const registrationOpen = isSponsoredRegistrationOpen(ev);
  const waitingRoomOpen = canOpenSponsoredWaitingRoom(ev);
  const noCoins    = registrationOpen && coinBalance < ev.entryCoinFee;

  const startDate = ev.scheduledStartAt ? new Date(ev.scheduledStartAt) : null;
  const dayStr    = startDate
    ? startDate.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" })
    : "";
  const timeStr   = startDate
    ? startDate.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
    : "";

  const displayTitle = ev.title.replace(/\s*\([A-Za-z]+\s+\d+\)\s*$/, "").trim();

  return (
    <View style={[card.wrap, { borderColor: pal.border, shadowColor: pal.shadow }]}>
      <LinearGradient colors={pal.grad} style={card.grad} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}>
        <GlowOrb color={pal.glow1} style={card.glow1} />
        <GlowOrb color={pal.glow2} style={card.glow2} />

        {/* ── Header row ── */}
        <View style={card.headerRow}>
          <CalendarBadge iso={ev.scheduledStartAt} accentColor={pal.glow1} />
          <View style={{ flex: 1 }}>
            <Text style={card.title} numberOfLines={2}>{displayTitle}</Text>
            {dayStr ? <Text style={card.dateText}>{dayStr}  ·  {timeStr}</Text> : null}
          </View>
          <View style={card.headerRight}>
            <View style={[card.statusChip, { backgroundColor: sc.bg, borderColor: sc.color + "55" }]}>
              <Text style={[card.statusText, { color: sc.color }]}>{sc.text}</Text>
            </View>
            <TouchableOpacity
              onPress={() => onShare(ev)}
              activeOpacity={0.7}
              style={card.shareBtn}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Feather name="share-2" size={15} color="rgba(255,255,255,0.6)" />
            </TouchableOpacity>
          </View>
        </View>

        {/* ── Stat pills ── */}
        <View style={card.pillRow}>
          <View style={card.pill}>
            <Image source={BLUE_SHOE_IMG} style={{ width: 14, height: 14 }} resizeMode="contain" />
            <Text style={card.pillVal}>{ev.targetSteps.toLocaleString()}</Text>
            <Text style={card.pillLbl}>steps</Text>
          </View>
          <View style={[card.pill, { backgroundColor: "#FF990015", borderWidth: 1, borderColor: "#FF990030" }]}>
            <Text style={card.pillIcon}>🎁</Text>
            <Text style={[card.pillVal, { color: "#FF9900" }]}>$5</Text>
            <Text style={card.pillLbl}>each winner</Text>
          </View>
          <View style={[card.pill, { backgroundColor: "#FFFFFF08" }]}>
            <Image source={COIN_IMG} style={{ width: 13, height: 13 }} resizeMode="contain" />
            <Text style={[card.pillVal, { color: "#FFB300" }]}>{ev.entryCoinFee.toLocaleString()}</Text>
            <Text style={card.pillLbl}>entry</Text>
          </View>
        </View>

        {/* ── Countdown — prominent row ── */}
        {countdown && ev.status !== "cancelled" && ev.status !== "in_progress" && ev.status !== "completed" ? (
          <View style={[card.countdownRow, { backgroundColor: pal.glow1 + "20", borderColor: pal.glow1 + "50" }]}>
            <Feather name="clock" size={14} color={pal.glow1} />
            <Text style={card.countdownLabel}>Starts in</Text>
            <Text style={[card.countdownTime, { color: "#FFF" }]}>{countdown}</Text>
          </View>
        ) : null}

        {/* ── Slots ── */}
        <View style={card.slotsRow}>
          <Text style={card.slotsLabel}>{ev.registeredCount}/{ev.maxSlots} slots filled</Text>
          {almostFull && (
            <View style={card.almostBadge}>
              <Text style={card.almostText}>Almost full!</Text>
            </View>
          )}
        </View>
        <View style={card.track}>
          <LinearGradient
            colors={almostFull ? ["#FF6B35", "#FFB300"] : pal.bar}
            style={[card.fill, { width: `${Math.min(100, slotPct * 100)}%` as `${number}%` }]}
            start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
          />
        </View>

        {/* ── Registered users ── */}
        {ev.registeredUsers.length > 0 ? (
          <View style={card.registrantsWrap}>
            <Text style={[card.registrantsTitle, { color: pal.glow2 }]}>
              {ev.registeredUsers.length} Registered
            </Text>
            {ev.registeredUsers.map((u, i) => (
              <UserRow key={i} user={u} accentColor={pal.glow1} onPress={() => onAvatarPress(u)} />
            ))}
          </View>
        ) : ev.status === "scheduled" ? (
          <Text style={card.beFirst}>Be the first to register!</Text>
        ) : null}

        {/* ── Action area ── */}
        <View style={{ marginTop: rs(14) }}>
          {ev.status === "in_progress" ? (
            <View style={{ gap: rs(8) }}>
              {/* Time remaining countdown */}
              {endCountdown ? (
                <View style={[card.countdownRow, { backgroundColor: "#00E67615", borderColor: "#00E67640" }]}>
                  <Feather name="clock" size={14} color="#00E676" />
                  <Text style={card.countdownLabel}>Ends in</Text>
                  <Text style={[card.countdownTime, { color: "#00E676" }]}>{endCountdown}</Text>
                </View>
              ) : null}
              <View style={[card.staticBtn, { backgroundColor: "#00E67610", borderColor: "#00E67625" }]}>
                <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: "#00E676" }} />
                <Text style={[card.staticBtnText, { color: "#00E676" }]}>Race In Progress</Text>
              </View>
              {ev.isActive ? (
                <TouchableOpacity
                  style={card.watchLiveBtn}
                  onPress={() => router.push({ pathname: "/race/live-detail", params: { id: ev.id } })}
                  activeOpacity={0.82}
                >
                  <LinearGradient colors={["#7C3AFF", "#C47BFF"]} style={card.watchLiveBtnGrad} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}>
                    <Feather name="zap" size={15} color="#FFF" />
                    <Text style={card.watchLiveBtnText}>🏃 Continue Racing</Text>
                  </LinearGradient>
                </TouchableOpacity>
              ) : ev.canRegister ? (
                <>
                  <TouchableOpacity
                    style={card.registerBtn}
                    onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); onRegister(ev.id); }}
                    disabled={busy}
                    activeOpacity={0.82}
                  >
                    <LinearGradient colors={pal.reg} style={card.registerGrad} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}>
                      {busy ? <ActivityIndicator color="#FFF" size="small" /> : (
                        <>
                          <Feather name="zap" size={15} color="#FFF" />
                          <Text style={card.registerText}>Register & Join Now</Text>
                        </>
                      )}
                    </LinearGradient>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={card.watchLiveBtn}
                    onPress={() => router.push({ pathname: "/race/live-detail", params: { id: ev.id } })}
                    activeOpacity={0.82}
                  >
                    <LinearGradient colors={["#00C853", "#007A33"]} style={card.watchLiveBtnGrad} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}>
                      <Feather name="radio" size={15} color="#FFF" />
                      <Text style={card.watchLiveBtnText}>Watch Live</Text>
                    </LinearGradient>
                  </TouchableOpacity>
                </>
              ) : (
                <TouchableOpacity
                  style={card.watchLiveBtn}
                  onPress={() => router.push({ pathname: "/race/live-detail", params: { id: ev.id } })}
                  activeOpacity={0.82}
                >
                  <LinearGradient colors={["#00C853", "#007A33"]} style={card.watchLiveBtnGrad} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}>
                    <Feather name="radio" size={15} color="#FFF" />
                    <Text style={card.watchLiveBtnText}>Watch Live</Text>
                  </LinearGradient>
                </TouchableOpacity>
              )}
            </View>

          ) : ev.status === "completed" || ev.status === "cancelled" ? (
            <View style={[card.staticBtn, { backgroundColor: "#22222230", borderColor: "#33333345" }]}>
              <Text style={[card.staticBtnText, { color: "#666" }]}>
                {ev.status === "completed" ? "Race Finished" : "Cancelled · Entry Fees Refunded"}
              </Text>
            </View>

          ) : ev.isRegistered ? (
            <View style={{ gap: rs(10) }}>
              {/* Join Waiting Room — PRIMARY action when window is open; else show registered banner */}
              {waitingRoomOpen ? (
                <>
                  <TouchableOpacity
                    style={[card.registerBtn, { marginBottom: 0 }]}
                    onPress={() => router.push({ pathname: "/sponsored-events/waiting-room", params: { id: ev.id, from: "sponsored-events" } })}
                    activeOpacity={0.82}
                  >
                    <LinearGradient colors={["#4C1D95", "#7C3AFF", "#A855F7"]} style={[card.registerGrad, { gap: rs(10) }]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}>
                      <Feather name="users" size={17} color="#FFF" />
                      <View style={{ flex: 1 }}>
                        <Text style={[card.registerText, { fontSize: rf(15) }]}>Join Waiting Room</Text>
                        <Text style={{ fontSize: rf(10), color: "rgba(255,255,255,0.7)", marginTop: 1 }}>Race starts automatically · no action needed</Text>
                      </View>
                      <View style={{ backgroundColor: "rgba(255,255,255,0.2)", borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3 }}>
                        <Text style={{ fontSize: rf(11), fontWeight: "800", color: "#FFF" }}>{ev.registeredCount}/{ev.maxSlots}</Text>
                      </View>
                    </LinearGradient>
                  </TouchableOpacity>
                  {/* Registered note — small secondary */}
                  <View style={{ flexDirection: "row", alignItems: "center", gap: rs(6), paddingHorizontal: rs(4), opacity: 0.65 }}>
                    <Feather name="check-circle" size={12} color="#A78BFA" />
                    <Text style={{ fontSize: rf(10.5), color: "#C4B5FD" }}>You're registered · {ev.entryCoinFee.toLocaleString()} coins deducted</Text>
                  </View>
                  {/* Leave — small tertiary */}
                  <TouchableOpacity
                    style={[card.leaveBtn, { paddingVertical: rs(10) }]}
                    onPress={() => onLeave(ev.id)}
                    disabled={busy}
                    activeOpacity={0.8}
                  >
                    {busy ? <ActivityIndicator size="small" color="#FF7777" /> : (
                      <>
                        <Feather name="log-out" size={13} color="#FF8888" />
                        <Text style={[card.leaveBtnText, { fontSize: rf(12) }]}>Leave & Refund {ev.entryCoinFee.toLocaleString()} coins</Text>
                      </>
                    )}
                  </TouchableOpacity>
                </>
              ) : (
                <>
                  {/* Registered banner */}
                  <View style={card.registeredBanner}>
                    <LinearGradient
                      colors={["rgba(124,58,255,0.35)", "rgba(196,123,255,0.20)"]}
                      style={card.registeredBannerGrad}
                      start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
                    >
                      <Feather name="check-circle" size={20} color="#C47BFF" />
                      <View style={{ flex: 1 }}>
                        <Text style={card.registeredTitle}>You're Registered!</Text>
                        <Text style={card.registeredSub}>{ev.entryCoinFee.toLocaleString()} coins deducted from wallet</Text>
                      </View>
                    </LinearGradient>
                  </View>
                  {/* Leave button */}
                  <TouchableOpacity
                    style={card.leaveBtn}
                    onPress={() => onLeave(ev.id)}
                    disabled={busy}
                    activeOpacity={0.8}
                  >
                    {busy ? (
                      <ActivityIndicator size="small" color="#FF7777" />
                    ) : (
                      <>
                        <Feather name="log-out" size={14} color="#FF8888" />
                        <View style={{ flex: 1 }}>
                          <Text style={card.leaveBtnText}>Leave Race</Text>
                          <Text style={card.leaveBtnSub}>{ev.entryCoinFee.toLocaleString()} coins refunded immediately</Text>
                        </View>
                      </>
                    )}
                  </TouchableOpacity>
                </>
              )}
            </View>

          ) : noCoins ? (
            <View style={{ borderRadius: 14, overflow: "hidden", borderWidth: 1.5, borderColor: "#FF555560" }}>
              <LinearGradient
                colors={["#FF22221F", "#88111128"]}
                style={{ flexDirection: "row", alignItems: "center", gap: rs(10), paddingVertical: rs(13), paddingHorizontal: rs(14) }}
                start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
              >
                <Image source={COIN_IMG} style={{ width: 24, height: 24 }} resizeMode="contain" />
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: rf(14), fontWeight: "800", color: "#FF8888", letterSpacing: 0.1 }}>
                    Need {(ev.entryCoinFee - coinBalance).toLocaleString()} more coins
                  </Text>
                </View>
                <Feather name="shopping-bag" size={15} color="#FF7777" />
              </LinearGradient>
            </View>

          ) : ev.isFull ? (
            <View style={[card.staticBtn, { backgroundColor: "#FF980015", borderColor: "#FF980030" }]}>
              <Text style={[card.staticBtnText, { color: "#FF9800" }]}>Event Full</Text>
            </View>

          ) : registrationOpen ? (
            <TouchableOpacity
              style={card.registerBtn}
              onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); onRegister(ev.id); }}
              disabled={busy}
              activeOpacity={0.82}
            >
              <LinearGradient colors={pal.reg} style={card.registerGrad} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}>
                {busy ? (
                  <ActivityIndicator size="small" color="#FFF" />
                ) : (
                  <>
                    <Feather name="user-plus" size={18} color="#FFF" />
                    <View style={{ flex: 1 }}>
                      <Text style={card.registerText}>Register Now</Text>
                      <Text style={card.registerSub}>{ev.entryCoinFee.toLocaleString()} coins deducted immediately</Text>
                    </View>
                  </>
                )}
              </LinearGradient>
            </TouchableOpacity>

          ) : (
            <View style={[card.staticBtn, { backgroundColor: "#22222225", borderColor: "#33333335" }]}>
              <Text style={[card.staticBtnText, { color: "#444" }]}>Registration Closed</Text>
            </View>
          )}
        </View>
      </LinearGradient>
    </View>
  );
}

// ── Main Screen ────────────────────────────────────────────────────────────────
export default function SponsoredEventsScreen() {
  const router = useRouter();
  const dispatch = useAppDispatch();
  const [events, setEvents]               = useState<SponsoredEvent[]>([]);
  const [coinBalance, setCoinBalance]      = useState(0);
  const [loading, setLoading]              = useState(true);
  const [refreshing, setRefreshing]        = useState(false);
  const [generating, setGenerating]        = useState(false);
  const [fetchError, setFetchError]        = useState<string | null>(null);
  const [registeringId, setRegisteringId]  = useState<string | null>(null);
  const [leavingId, setLeavingId]          = useState<string | null>(null);

  // Modal state
  const [registerModal, setRegisterModal] = useState<{ visible: boolean; ev: SponsoredEvent | null }>({ visible: false, ev: null });
  const [leaveModal, setLeaveModal]       = useState<{ visible: boolean; ev: SponsoredEvent | null }>({ visible: false, ev: null });
  const [profileModal, setProfileModal]   = useState<{
    visible: boolean; userId: string | null; initialData?: PublicProfileInitialData;
  }>({ visible: false, userId: null });

  const fetchEvents = useCallback(async () => {
    try {
      setFetchError(null);
      const res = await authFetch("/api/sponsored-events");
      const raw = await res.json().catch(() => ({}));
      if (!res.ok) {
        const err = (raw as { error?: string }).error ?? `Could not load events (${res.status})`;
        setFetchError(err);
        return;
      }
      const { events: list, coinBalance: balance } = parseSponsoredEventsResponse(raw);
      setEvents(list);
      setCoinBalance(balance);
      if (__DEV__) {
        console.log(`[SponsoredEvents] fetched count=${list.length} coinBalance=${balance}`);
      }
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : "Could not load sponsored events");
      if (__DEV__) console.log("[SponsoredEvents] fetch failed", err);
    } finally {
      setLoading(false);
    }
  }, []);

  const autoGenerate = useCallback(async () => {
    setGenerating(true);
    try {
      await authFetch("/api/sponsored-events/generate-weekend", { method: "POST" });
      await fetchEvents();
    } catch { /* silent */ }
    finally { setGenerating(false); }
  }, [fetchEvents]);

  useFocusEffect(useCallback(() => {
    setLoading(true);
    fetchEvents();
  }, [fetchEvents]));

  useEffect(() => {
    if (!loading && events.length === 0 && !fetchError) {
      autoGenerate();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, events.length, fetchError]);

  // Real-time updates
  useEffect(() => {
    const ch = subscribeToChannel(SPONSORED_EVENTS_CHANNEL);
    if (!ch) return;
    ch.bind(EVENTS.SPONSORED_EVENT_REGISTRATION_UPDATED,
      (_d: { room_id: string; registered_count: number; max_slots: number }) => { fetchEvents(); }
    );
    ch.bind(EVENTS.SPONSORED_EVENT_STARTED, (d: { room_id: string }) => {
      setEvents((prev) => prev.map((ev) => ev.id === d.room_id ? { ...ev, status: "in_progress" } : ev));
    });
    ch.bind(EVENTS.SPONSORED_EVENT_CANCELLED, (d: { room_id: string }) => {
      setEvents((prev) => prev.map((ev) => ev.id === d.room_id ? { ...ev, status: "cancelled" } : ev));
    });
    ch.bind(EVENTS.SPONSORED_EVENT_CREATED, () => fetchEvents());
    return () => {
      ch.unbind(EVENTS.SPONSORED_EVENT_REGISTRATION_UPDATED)
        .unbind(EVENTS.SPONSORED_EVENT_STARTED)
        .unbind(EVENTS.SPONSORED_EVENT_CANCELLED)
        .unbind(EVENTS.SPONSORED_EVENT_CREATED);
    };
  }, [fetchEvents]);

  // ── Handlers ──────────────────────────────────────────────────────────────
  const handleAvatarPress = useCallback((user: RegisteredUser) => {
    setProfileModal({
      visible: true,
      userId: user.userId,
      initialData: {
        username: user.username,
        countryFlag: user.countryFlag,
        avatarColor: user.avatarColor,
      },
    });
  }, []);

  const handleShare = useCallback(async (ev: SponsoredEvent) => {
    const title = ev.title.replace(/\s*\([A-Za-z]+\s+\d+\)\s*$/, "").trim();
    const prize = `$${(ev.prizePoolCents / 100).toFixed(0)}`;
    const startDate = ev.scheduledStartAt ? new Date(ev.scheduledStartAt) : null;
    const dateStr = startDate
      ? startDate.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })
      : "";
    const timeStr = startDate
      ? startDate.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
      : "";
    const link = `https://walkchamp.app/events/${ev.id}`;
    try {
      await Share.share({
        title: `${title} — WalkChamp`,
        message: [
          `🏆 ${title} — WalkChamp`,
          ``,
          `Walk ${ev.targetSteps.toLocaleString()} steps to win ${prize}.`,
          dateStr ? `📅 ${dateStr} at ${timeStr}` : "",
          `💰 ${ev.entryCoinFee.toLocaleString()} coin entry`,
          ``,
          `Join here → ${link}`,
        ].filter(Boolean).join("\n"),
      });
    } catch { /* dismissed */ }
  }, []);

  const handleRegister = (roomId: string) => {
    const ev = events.find((e) => e.id === roomId);
    if (!ev) return;
    setRegisterModal({ visible: true, ev });
  };

  const confirmRegister = async () => {
    const ev = registerModal.ev;
    if (!ev) return;
    setRegisteringId(ev.id);
    try {
      const res  = await authFetch(`/api/sponsored-events/${ev.id}/register`, { method: "POST" });
      const data = await res.json() as { success?: boolean; error?: string; coinBalance?: number };
      setRegisterModal({ visible: false, ev: null });
      if (!res.ok) {
        Alert.alert("Registration Failed", data.error ?? "Please try again.");
        return;
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      if (data.coinBalance !== undefined) setCoinBalance(data.coinBalance);
      dispatch(fetchCoinBalance());
      fetchEvents();
      // Navigate to the right destination based on race state
      if (ev.status === "in_progress") {
        router.push({ pathname: "/race/live-detail", params: { id: ev.id } });
      } else {
        // Scheduled — take user to waiting room immediately after registering
        router.push({ pathname: "/sponsored-events/waiting-room", params: { id: ev.id, from: "sponsored-events" } });
      }
    } catch {
      setRegisterModal({ visible: false, ev: null });
      Alert.alert("Error", "Registration failed. Please try again.");
    } finally {
      setRegisteringId(null);
    }
  };

  const handleLeave = (roomId: string) => {
    const ev = events.find((e) => e.id === roomId);
    if (!ev) return;
    setLeaveModal({ visible: true, ev });
  };

  const confirmLeave = async () => {
    const ev = leaveModal.ev;
    if (!ev) return;
    setLeavingId(ev.id);
    try {
      const res  = await authFetch(`/api/sponsored-events/${ev.id}/cancel-registration`, { method: "POST" });
      const data = await res.json() as { success?: boolean; error?: string; coinBalance?: number };
      setLeaveModal({ visible: false, ev: null });
      if (!res.ok) { Alert.alert("Error", data.error ?? "Failed to leave."); return; }
      if (data.coinBalance !== undefined) setCoinBalance(data.coinBalance);
      dispatch(fetchCoinBalance());
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      fetchEvents();
    } catch {
      setLeaveModal({ visible: false, ev: null });
      Alert.alert("Error", "Failed to leave. Please try again.");
    } finally {
      setLeavingId(null);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────
  // Only show events that are live or haven't started yet — hide past/completed/cancelled
  const now = Date.now();
  const visibleEvents = events.filter((ev) => isSponsoredEventVisible(ev, now));
  const upcomingCount = visibleEvents.filter((e) => e.status === "scheduled").length;

  return (
    <SafeAreaView style={sc.root} edges={["top", "bottom"]}>
      {/* Header */}
      <LinearGradient colors={["#100030", "#050010"]} style={sc.header} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}>
        <TouchableOpacity onPress={() => router.back()} style={sc.backBtn}>
          <Feather name="arrow-left" size={22} color="#fff" />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={sc.headerTitle}>Sponsored Events</Text>
          <Text style={sc.headerSub}>Weekend 10K races · Real prizes</Text>
        </View>
        <View style={sc.balancePill}>
          <Image source={COIN_IMG} style={{ width: 17, height: 17 }} resizeMode="contain" />
          <Text style={sc.balanceText}>{coinBalance.toLocaleString()}</Text>
        </View>
      </LinearGradient>

      {(loading || generating) ? (
        <View style={[sc.list, { paddingTop: rs(8) }]}>
          <SkeletonList count={4} variant="event" />
        </View>
      ) : events.length === 0 ? (
        <View style={sc.centered}>
          <Text style={{ fontSize: 52 }}>🏆</Text>
          <Text style={sc.emptyTitle}>{fetchError ? "Could Not Load Events" : "No Events Yet"}</Text>
          <Text style={sc.emptyBody}>
            {fetchError ?? "Weekend races are being set up. Tap to refresh."}
          </Text>
          <TouchableOpacity style={sc.refreshBtn} onPress={() => { setLoading(true); void fetchEvents(); }} activeOpacity={0.8}>
            <Feather name="refresh-cw" size={14} color="#FFF" />
            <Text style={sc.refreshText}>Refresh</Text>
          </TouchableOpacity>
        </View>
      ) : visibleEvents.length === 0 ? (
        <View style={sc.centered}>
          <Text style={{ fontSize: 52 }}>🏆</Text>
          <Text style={sc.emptyTitle}>No Upcoming Events</Text>
          <Text style={sc.emptyBody}>Past weekend races have ended. Pull to refresh for the latest schedule.</Text>
          <TouchableOpacity style={sc.refreshBtn} onPress={() => { setLoading(true); void fetchEvents(); }} activeOpacity={0.8}>
            <Feather name="refresh-cw" size={14} color="#FFF" />
            <Text style={sc.refreshText}>Refresh</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={sc.list}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => { setRefreshing(true); void fetchEvents().finally(() => setRefreshing(false)); }}
              tintColor="#A855F7"
            />
          }
        >
          <PrizeBanner />
          {upcomingCount > 0 && (
            <View style={sc.sectionRow}>
              <View style={sc.sectionLine} />
              <Text style={sc.sectionLabel}>UPCOMING RACES</Text>
              <View style={sc.sectionLine} />
            </View>
          )}
          {visibleEvents.map((ev, i) => (
            <EventCard
              key={ev.id}
              ev={ev}
              index={i}
              coinBalance={coinBalance}
              onRegister={handleRegister}
              onLeave={handleLeave}
              onShare={handleShare}
              onAvatarPress={handleAvatarPress}
              busy={registeringId === ev.id || leavingId === ev.id}
            />
          ))}
          <View style={sc.rules}>
            <Text style={sc.rulesTitle}>📜 How It Works</Text>
            <Text style={sc.rulesBody}>
              {"• Register and coins are deducted immediately.\n" +
                "• Leave before the race starts to get a full refund.\n" +
                "• Race to 10,000 steps — top 2 finishers each win a $5 Amazon Gift Card.\n" +
                "• Tie? The $10 prize is split equally among ALL tied finishers\n  (e.g. 3-way tie → $3.33 each, 4-way tie → $2.50 each).\n" +
                "• Event cancelled (< 2 players)? Full coin refund instantly."}
            </Text>
          </View>
        </ScrollView>
      )}

      {/* Custom modals */}
      <RegisterModal
        visible={registerModal.visible}
        ev={registerModal.ev}
        busy={registeringId !== null}
        onConfirm={confirmRegister}
        onCancel={() => setRegisterModal({ visible: false, ev: null })}
      />
      <LeaveModal
        visible={leaveModal.visible}
        ev={leaveModal.ev}
        busy={leavingId !== null}
        onConfirm={confirmLeave}
        onCancel={() => setLeaveModal({ visible: false, ev: null })}
      />
      <PublicProfileModal
        visible={profileModal.visible}
        userId={profileModal.userId}
        initialData={profileModal.initialData}
        onClose={() => setProfileModal({ visible: false, userId: null })}
      />
    </SafeAreaView>
  );
}

// ── Card styles ────────────────────────────────────────────────────────────────
const card = StyleSheet.create({
  wrap: {
    borderRadius: 22, overflow: "hidden", marginBottom: rs(16),
    borderWidth: 1,
    shadowOpacity: 0.35, shadowRadius: 18, shadowOffset: { width: 0, height: 5 }, elevation: 8,
  },
  grad: { padding: rs(16), overflow: "hidden" },
  glow1: { position: "absolute", width: 140, height: 140, borderRadius: 70, top: -50, right: -20 },
  glow2: { position: "absolute", width: 85,  height: 85,  borderRadius: 42, bottom: -25, left: 8 },

  headerRow: { flexDirection: "row", alignItems: "flex-start", gap: rs(10), marginBottom: rs(14) },
  headerRight: { alignItems: "flex-end", gap: rs(7), flexShrink: 0 },
  title: { fontSize: rf(16), fontWeight: "800", color: "#FFF", lineHeight: 22 },
  dateText: { fontSize: rf(11.5), color: "rgba(255,255,255,0.5)", marginTop: 3 },
  statusChip: {
    borderWidth: 1, borderRadius: 12, flexShrink: 0,
    paddingHorizontal: rs(8), paddingVertical: 4,
  },
  statusText: { fontSize: rf(9.5), fontWeight: "800", letterSpacing: 0.3 },
  shareBtn: {
    width: 30, height: 30, borderRadius: 15,
    backgroundColor: "rgba(255,255,255,0.08)",
    borderWidth: 1, borderColor: "rgba(255,255,255,0.15)",
    alignItems: "center", justifyContent: "center",
  },

  pillRow: { flexDirection: "row", gap: rs(7), marginBottom: rs(14) },
  pill: {
    flex: 1, flexDirection: "row", alignItems: "center", gap: 4,
    backgroundColor: "rgba(255,255,255,0.07)",
    borderRadius: 10, paddingHorizontal: rs(8), paddingVertical: rs(8),
  },
  pillIcon: { fontSize: 12 },
  pillVal: { fontSize: rf(13), fontWeight: "800", color: "#FFF" },
  pillLbl: { fontSize: rf(8.5), color: "rgba(255,255,255,0.35)" },

  countdownRow: {
    flexDirection: "row", alignItems: "center", gap: rs(8),
    borderWidth: 1, borderRadius: 12,
    paddingHorizontal: rs(12), paddingVertical: rs(10),
    marginBottom: rs(12),
  },
  countdownLabel: { fontSize: rf(12), color: "rgba(255,255,255,0.6)", fontWeight: "600" },
  countdownTime: { fontSize: rf(16), fontWeight: "900", letterSpacing: 0.3, flex: 1, textAlign: "right" },

  slotsRow: {
    flexDirection: "row", alignItems: "center",
    justifyContent: "space-between", marginBottom: rs(6),
  },
  slotsLabel: { fontSize: rf(12), color: "rgba(255,255,255,0.6)", fontWeight: "600" },
  almostBadge: {
    backgroundColor: "#FF6B3520", borderWidth: 1, borderColor: "#FF6B3550",
    borderRadius: 8, paddingHorizontal: 7, paddingVertical: 2,
  },
  almostText: { fontSize: rf(9.5), color: "#FF9060", fontWeight: "700" },
  track: { height: 5, backgroundColor: "rgba(255,255,255,0.08)", borderRadius: 3, overflow: "hidden", marginBottom: rs(14) },
  fill: { height: "100%", borderRadius: 3 },

  registrantsWrap: {
    paddingTop: rs(12),
    borderTopWidth: 1, borderTopColor: "rgba(255,255,255,0.09)",
    marginBottom: rs(2),
  },
  registrantsTitle: {
    fontSize: rf(10.5), fontWeight: "800", letterSpacing: 0.6,
    marginBottom: rs(10), textTransform: "uppercase",
  },
  beFirst: {
    paddingTop: rs(12),
    borderTopWidth: 1, borderTopColor: "rgba(255,255,255,0.07)",
    fontSize: rf(12), color: "rgba(255,255,255,0.25)", textAlign: "center",
    marginBottom: rs(2),
  },

  // Registered banner — high contrast gradient
  registeredBanner: { borderRadius: 14, overflow: "hidden", borderWidth: 1.5, borderColor: "#7C3AFF60" },
  registeredBannerGrad: { flexDirection: "row", alignItems: "center", gap: rs(12), paddingVertical: rs(13), paddingHorizontal: rs(14) },
  registeredTitle: { fontSize: rf(15), fontWeight: "800", color: "#EDE9FE" },
  registeredSub: { fontSize: rf(11), color: "rgba(196,123,255,0.65)", marginTop: 2 },

  leaveBtn: {
    flexDirection: "row", alignItems: "center",
    gap: rs(10), backgroundColor: "rgba(255,50,50,0.18)",
    borderWidth: 1.5, borderColor: "#FF4444",
    borderRadius: 14,
    paddingVertical: rs(11), paddingHorizontal: rs(14),
  },
  leaveBtnText: { fontSize: rf(14), fontWeight: "800", color: "#FF5555" },
  leaveBtnSub: { fontSize: rf(10.5), color: "rgba(255,120,120,0.70)", marginTop: 1 },

  watchLiveBtn: { borderRadius: 14, overflow: "hidden" },
  watchLiveBtnGrad: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: rs(8), paddingVertical: rs(14) },
  watchLiveBtnText: { fontSize: rf(14), fontWeight: "800", color: "#FFF", letterSpacing: 0.2 },

  registerBtn: { borderRadius: 14, overflow: "hidden" },
  registerGrad: {
    flexDirection: "row", alignItems: "center",
    gap: rs(10), paddingVertical: rs(14), paddingHorizontal: rs(16),
  },
  registerText: { fontSize: rf(14), fontWeight: "800", color: "#FFF" },
  registerSub: { fontSize: rf(10.5), color: "rgba(255,255,255,0.6)", marginTop: 1 },

  staticBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: rs(6), borderWidth: 1, borderRadius: 14,
    paddingVertical: rs(12), paddingHorizontal: rs(14),
  },
  staticBtnText: { fontSize: rf(13), fontWeight: "700" },
});

// ── Screen styles ──────────────────────────────────────────────────────────────
const sc = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#060012" },
  header: {
    flexDirection: "row", alignItems: "center", gap: rs(12),
    paddingHorizontal: rs(16), paddingVertical: rs(14), paddingBottom: rs(16),
  },
  backBtn: {
    width: rs(36), height: rs(36), borderRadius: 18,
    backgroundColor: "rgba(255,255,255,0.08)", alignItems: "center", justifyContent: "center",
  },
  headerTitle: { fontSize: rf(19), fontWeight: "800", color: "#FFF", letterSpacing: 0.2 },
  headerSub: { fontSize: rf(11), color: "rgba(255,255,255,0.45)", marginTop: 2 },
  balancePill: {
    flexDirection: "row", alignItems: "center", gap: 5,
    backgroundColor: "#FFB30018", borderWidth: 1, borderColor: "#FFB30045",
    borderRadius: 20, paddingHorizontal: rs(10), paddingVertical: rs(5),
  },
  balanceText: { fontSize: rf(13), fontWeight: "700", color: "#FFD700" },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", gap: rs(14), paddingHorizontal: rs(36) },
  loadingText: { color: "rgba(255,255,255,0.4)", fontSize: rf(14) },
  emptyTitle: { fontSize: rf(20), fontWeight: "800", color: "#FFF", textAlign: "center" },
  emptyBody:  { fontSize: rf(13), color: "rgba(255,255,255,0.4)", textAlign: "center", lineHeight: 22 },
  refreshBtn: {
    flexDirection: "row", alignItems: "center", gap: 7,
    backgroundColor: "#7C3AFF", borderRadius: 14,
    paddingHorizontal: rs(20), paddingVertical: rs(10), marginTop: rs(4),
  },
  refreshText: { fontSize: rf(13), fontWeight: "700", color: "#FFF" },
  list: { paddingHorizontal: rs(14), paddingTop: rs(4), paddingBottom: rs(40) },
  sectionRow: { flexDirection: "row", alignItems: "center", gap: rs(10), marginBottom: rs(14) },
  sectionLine: { flex: 1, height: 1, backgroundColor: "rgba(255,255,255,0.07)" },
  sectionLabel: { fontSize: rf(10), fontWeight: "800", color: "rgba(255,255,255,0.25)", letterSpacing: 1.5 },
  rules: {
    backgroundColor: "rgba(255,255,255,0.04)", borderRadius: 18,
    padding: rs(18), marginTop: rs(4),
  },
  rulesTitle: { fontSize: rf(14), fontWeight: "800", color: "#FFF", marginBottom: rs(10) },
  rulesBody:  { fontSize: rf(12.5), color: "rgba(255,255,255,0.45)", lineHeight: 22 },
});
