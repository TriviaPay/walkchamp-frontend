import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Image,
  Modal,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { Feather, Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { authFetch } from "@/utils/authFetch";
import { getApiBase } from "@/utils/apiUrl";
import { rf, rs } from "@/utils/responsive";
import { useAuth } from "@/context/AuthContext";
import { AppAlert } from "@/components/AppAlert";
import { TRACK_LAYOUT_OPTIONS } from "@/constants/trackLayouts";
import { PublicProfileModal, type PublicProfileInitialData } from "@/components/PublicProfileModal";
import CoinIcon from "@/components/CoinIcon";

const BG = "#080B14";
const GREEN = "#00E676";
const CASH_BLUE = "#0EA5E9";
const PURPLE = "#9333EA";
const GOLD = "#F59E0B";
const GOLD_DARK = "#B45309";

interface UpcomingRoom {
  room_id: string;
  status: string;
  challenge_type: string;
  entry_fee: number;
  coin_entry_amount: number;
  title: string;
  target_steps: number;
  max_players: number;
  registered_count: number;
  scheduled_start_at: string | null;
  challenge_duration_days: number;
  challenge_end_at: string | null;
  selected_track_theme_id: string;
  theme_name: string;
  is_private: boolean;
  requires_code: boolean;
  host_user_id: string;
  host_username: string;
  host_avatar_color: string;
  host_avatar_url: string | null;
  host_country_flag: string | null;
  current_user_registered: boolean;
  eligible_to_register: boolean;
}

function useCountdown(scheduledStartAt: string | null): string {
  const [label, setLabel] = React.useState("");
  React.useEffect(() => {
    if (!scheduledStartAt) { setLabel(""); return; }
    const update = () => {
      const diffMs = new Date(scheduledStartAt).getTime() - Date.now();
      if (diffMs <= 0) { setLabel("Starting now"); return; }
      const d = Math.floor(diffMs / 86400000);
      const h = Math.floor((diffMs % 86400000) / 3600000);
      const m = Math.floor((diffMs % 3600000) / 60000);
      if (d > 0) setLabel(`Starts in ${d}d ${h}h`);
      else if (h > 0) setLabel(`Starts in ${h}h ${m}m`);
      else setLabel(`Starts in ${m}m`);
    };
    update();
    const id = setInterval(update, 30000);
    return () => clearInterval(id);
  }, [scheduledStartAt]);
  return label;
}

function fmtDateTime(iso: string | null) {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function DetailCard({
  room, currentUserId, onRegister, onCancel, onCancelRoom, onViewHost, registering,
}: {
  room: UpcomingRoom;
  currentUserId: string | undefined;
  onRegister: (r: UpcomingRoom) => void;
  onCancel: (r: UpcomingRoom) => void;
  onCancelRoom: (r: UpcomingRoom) => void;
  onViewHost: (r: UpcomingRoom) => void;
  registering: boolean;
}) {
  const countdown   = useCountdown(room.scheduled_start_at);
  const isFull      = room.registered_count >= room.max_players;
  const isSponsored = room.challenge_type === "sponsored";
  const isCoins     = !isSponsored && room.challenge_type === "coins_battle";
  const isCash      = !isSponsored && !isCoins && room.entry_fee > 0;
  const isHost      = !isSponsored && !!currentUserId && currentUserId === room.host_user_id;
  const accent      = isSponsored ? "#7C3AFF" : isCash ? CASH_BLUE : isCoins ? GOLD : GREEN;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const trackSource = (TRACK_LAYOUT_OPTIONS.find((t) => t.id === room.selected_track_theme_id)?.source ?? require("@/assets/images/bg.png")) as any;

  const entryLabel = isSponsored ? "Sponsored" : isCash ? `$${room.entry_fee.toFixed(2)}` : isCoins ? `${room.coin_entry_amount.toLocaleString()} coins` : "Free";
  const entryColor = isSponsored ? "#C47BFF" : isCash ? GOLD : isCoins ? GOLD : GREEN;

  // Prize pool — 20% platform fee for cash, 0% for coins
  const prizePoolDollars = isCash ? Math.round(room.entry_fee * room.registered_count * 0.80) : 0;
  const prizePoolCoins   = isCoins ? room.coin_entry_amount * room.registered_count : 0;
  const hasPrizePool     = (isCash && prizePoolDollars > 0) || (isCoins && prizePoolCoins > 0);

  const gradColors = isSponsored
    ? (["#7C3AFF", "#C47BFF"] as const)
    : isCash ? ([CASH_BLUE, "#0369A1"] as const)
    : isCoins ? ([GOLD, GOLD_DARK] as const)
    : ([GREEN, "#00C853"] as const);

  return (
    <View style={[dc.wrap, { borderColor: accent + "50" }]}>
      <Image source={trackSource} style={dc.bgImage} resizeMode="cover" />
      <View style={dc.overlay} />
      <LinearGradient colors={["transparent", "rgba(0,0,0,0.94)"]} style={dc.bottomGrad} />
      <LinearGradient colors={[accent + "DD", "transparent"]} style={dc.topGlow} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} />

      <View style={dc.content}>
        {/* Header badges */}
        <View style={dc.headerRow}>
          <View style={dc.titleGroup}>
            <View style={[
              dc.typeBadge,
              { backgroundColor: accent + "30", borderColor: accent },
              (isCash || isCoins) && dc.typeBadgeHighlight,
            ]}>
              {isSponsored ? <Text style={{ fontSize: rf(10) }}>🏆</Text>
                : isCash ? <Feather name="dollar-sign" size={10} color={accent} />
                : isCoins ? <CoinIcon size={12} />
                : <Ionicons name="walk-outline" size={11} color={accent} />}
              <Text style={[dc.typeBadgeText, { color: accent }]}>
                {isSponsored ? "WALKCHAMP" : isCash ? "CASH CHALLENGE" : isCoins ? "COINS BATTLE" : "FREE CHALLENGE"}
              </Text>
            </View>
            <View style={dc.scheduledBadge}>
              <Feather name="calendar" size={9} color="#00B4FF" />
              <Text style={dc.scheduledBadgeText}>Scheduled</Text>
            </View>
          </View>
          <View style={dc.headerRight}>
            {room.requires_code ? (
              <View style={[dc.visBadge, { backgroundColor: PURPLE + "28", borderColor: PURPLE + "65" }]}>
                <Feather name="lock" size={8} color={PURPLE} />
                <Text style={[dc.visBadgeText, { color: PURPLE }]}>Private</Text>
              </View>
            ) : (
              <View style={[dc.visBadge, { backgroundColor: GREEN + "18", borderColor: GREEN + "45" }]}>
                <Feather name="globe" size={8} color={GREEN} />
                <Text style={[dc.visBadgeText, { color: GREEN }]}>Public</Text>
              </View>
            )}
            <View style={dc.playerPill}>
              <Feather name="users" size={10} color="#8B9AC0" />
              <Text style={dc.playerText}>{room.registered_count}/{room.max_players}</Text>
            </View>
          </View>
        </View>

        {/* Host row — tappable → profile modal */}
        <TouchableOpacity
          style={dc.hostRow}
          onPress={() => !isSponsored && onViewHost(room)}
          activeOpacity={isSponsored ? 1 : 0.7}
          disabled={isSponsored}
        >
          {room.host_avatar_url ? (
            <Image
              source={{ uri: `${getApiBase()}/api/profile/avatar/${room.host_user_id}` }}
              style={dc.hostAvatar}
            />
          ) : (
            <View style={[dc.hostAvatar, { backgroundColor: room.host_avatar_color ?? (accent + "88") }]}>
              <Text style={dc.hostInitial}>{(isSponsored ? "W" : (room.host_username[0] ?? "?")).toUpperCase()}</Text>
            </View>
          )}
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
              {isHost && (
                <View style={dc.hostBadge}>
                  <Feather name="star" size={8} color="#FFD700" />
                  <Text style={dc.hostBadgeText}>HOST</Text>
                </View>
              )}
              <Text style={dc.hostName} numberOfLines={1}>@{isSponsored ? "WalkChamp" : room.host_username}</Text>
              {room.host_country_flag ? <Text style={{ fontSize: rf(13) }}>{room.host_country_flag}</Text> : null}
            </View>
            <Text style={dc.hostLabel}>Room host</Text>
          </View>
        </TouchableOpacity>

        {/* Countdown section */}
        <View style={dc.countdownSection}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 7 }}>
            <Feather name="clock" size={15} color={accent} />
            <Text style={[dc.countdownBig, { color: accent }]}>{countdown || "Starting soon"}</Text>
          </View>
          {room.scheduled_start_at ? (
            room.challenge_duration_days > 1 && room.challenge_end_at ? (
              <Text style={dc.scheduledDate}>
                {fmtDateTime(room.scheduled_start_at)}
                <Text style={{ color: "#6B7FA8" }}> → </Text>
                {fmtDateTime(room.challenge_end_at)}
              </Text>
            ) : (
              <Text style={dc.scheduledDate}>{fmtDateTime(room.scheduled_start_at)}</Text>
            )
          ) : null}
        </View>

        {/* Stats panel */}
        <View style={[dc.statsRow, { borderColor: accent + "22" }]}>
          <View style={dc.statChip}>
            <View style={[dc.statIconWrap, { backgroundColor: GREEN + "18" }]}>
              <Image source={require("@/assets/images/blue-shoe.png")} style={{ width: 14, height: 14 }} resizeMode="contain" />
            </View>
            <Text style={dc.statValue}>{room.target_steps >= 1000 ? `${(room.target_steps / 1000).toFixed(0)}k` : room.target_steps}</Text>
            <Text style={dc.statLabel}>steps</Text>
          </View>
          <View style={[dc.statDivider, { backgroundColor: accent + "22" }]} />
          <View style={dc.statChip}>
            <View style={[dc.statIconWrap, { backgroundColor: entryColor + "18" }]}>
              {isCash ? <Feather name="dollar-sign" size={14} color={entryColor} /> :
               isSponsored ? <Text style={{ fontSize: rf(12) }}>🏆</Text> :
               <Ionicons name="walk-outline" size={14} color={GREEN} />}
            </View>
            <Text style={[dc.statValue, { color: entryColor }]}>{entryLabel}</Text>
            <Text style={dc.statLabel}>entry</Text>
          </View>
          <View style={[dc.statDivider, { backgroundColor: accent + "22" }]} />
          <View style={dc.statChip}>
            <View style={[dc.statIconWrap, { backgroundColor: GOLD + "18" }]}>
              <Feather name="sun" size={14} color={GOLD} />
            </View>
            <Text style={dc.statValue}>{room.challenge_duration_days > 0 ? `${room.challenge_duration_days}d` : "1d"}</Text>
            <Text style={dc.statLabel}>duration</Text>
          </View>
          {hasPrizePool && (<>
            <View style={[dc.statDivider, { backgroundColor: accent + "22" }]} />
            <View style={dc.statChip}>
              <View style={[dc.statIconWrap, { backgroundColor: GOLD + "22" }]}>
                <Feather name="award" size={14} color={GOLD} />
              </View>
              <Text style={[dc.statValue, { color: GOLD }]}>
                {isCash ? `$${prizePoolDollars}` : `${prizePoolCoins.toLocaleString()}`}
              </Text>
              <Text style={dc.statLabel}>prize pool</Text>
            </View>
          </>)}
        </View>

        {/* Slots bar */}
        <View style={dc.slotsBar}>
          <View style={dc.slotsTrack}>
            <View style={[dc.slotsFill, { width: `${Math.min(100, (room.registered_count / room.max_players) * 100)}%` as `${number}%`, backgroundColor: accent }]} />
          </View>
          <Text style={dc.slotsText}>{room.registered_count}/{room.max_players} registered</Text>
        </View>

        {/* CTA */}
        {!isSponsored && isHost ? (
          <TouchableOpacity
            style={[dc.cancelRoomBtn, { opacity: registering ? 0.6 : 1 }]}
            onPress={() => !registering && onCancelRoom(room)}
            disabled={registering}
            activeOpacity={0.8}
          >
            {registering
              ? <><ActivityIndicator size="small" color="#FF4444" /><Text style={dc.cancelRoomBtnText}>Cancelling…</Text></>
              : <><Feather name="x-octagon" size={14} color="#FF4444" /><Text style={dc.cancelRoomBtnText}>Cancel Room</Text></>}
          </TouchableOpacity>
        ) : room.current_user_registered ? (
          <TouchableOpacity
            style={[dc.cancelRegBtn, { opacity: registering ? 0.6 : 1 }]}
            onPress={() => !registering && onCancel(room)}
            disabled={registering}
            activeOpacity={0.8}
          >
            {registering
              ? <><ActivityIndicator size="small" color="#8B9AC0" /><Text style={dc.cancelRegBtnText}>Cancelling…</Text></>
              : <><Feather name="x-circle" size={14} color="#8B9AC0" /><Text style={dc.cancelRegBtnText}>Cancel Registration</Text></>}
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={[dc.registerBtn, { opacity: (isFull || registering) ? 0.55 : 1 }]}
            onPress={() => !isFull && !registering && onRegister(room)}
            disabled={isFull || registering}
            activeOpacity={0.8}
          >
            <LinearGradient
              colors={isFull ? (["#2A2D3A", "#1E2130"] as const) : gradColors}
              start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
              style={dc.registerBtnGrad}
            >
              {registering ? (
                <><ActivityIndicator size="small" color="#FFF" /><Text style={[dc.registerBtnText, { color: "#FFF" }]}>Registering…</Text></>
              ) : isFull ? (
                <><Feather name="slash" size={14} color="#8B9AC0" /><Text style={[dc.registerBtnText, { color: "#8B9AC0" }]}>Room Full</Text></>
              ) : (
                <><Feather name="check-circle" size={14} color="#FFF" /><Text style={[dc.registerBtnText, { color: "#FFF" }]}>Register</Text></>
              )}
            </LinearGradient>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const dc = StyleSheet.create({
  wrap: { borderRadius: 20, overflow: "hidden", borderWidth: 1.5, marginBottom: 16 },
  bgImage: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, width: "100%", height: "100%" },
  overlay: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(4,6,18,0.70)" },
  bottomGrad: { position: "absolute", bottom: 0, left: 0, right: 0, height: 160 },
  topGlow: { position: "absolute", top: 0, left: 0, right: 0, height: 1.5 },
  content: { padding: rs(16), gap: 12 },

  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  titleGroup: { flexDirection: "row", alignItems: "center", gap: 6 },
  typeBadge: { flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 7, borderWidth: 1 },
  typeBadgeHighlight: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8, borderWidth: 1.5, shadowColor: "#000", shadowOpacity: 0.4, shadowRadius: 4, shadowOffset: { width: 0, height: 1 } },
  typeBadgeText: { fontSize: rf(10), fontWeight: "800", letterSpacing: 0.8 },
  scheduledBadge: { flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6, borderWidth: 1, backgroundColor: "#00B4FF12", borderColor: "#00B4FF35" },
  scheduledBadgeText: { fontSize: rf(9), fontWeight: "700", color: "#00B4FF" },

  headerRight: { flexDirection: "row", alignItems: "center", gap: 7 },
  visBadge: { flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6, borderWidth: 1 },
  visBadgeText: { fontSize: rf(9), fontWeight: "700" },
  playerPill: { flexDirection: "row", alignItems: "center", gap: 3 },
  playerText: { fontSize: rf(11), fontWeight: "700", color: "#8B9AC0" },

  hostRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  hostAvatar: { width: rs(38), height: rs(38), borderRadius: rs(19), alignItems: "center", justifyContent: "center", flexShrink: 0 },
  hostInitial: { fontSize: rf(14), fontWeight: "800", color: "#FFF" },
  hostBadge: { flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 5, backgroundColor: "#FFD70020", borderWidth: 1, borderColor: "#FFD70060" },
  hostBadgeText: { fontSize: rf(9), fontWeight: "700", color: "#FFD700" },
  hostName: { fontSize: rf(13), fontWeight: "700", color: "#D4DCEF" },
  hostLabel: { fontSize: rf(10), color: "#4B5680", marginTop: 1 },

  countdownSection: { gap: 4 },
  countdownBig: { fontSize: rf(21), fontWeight: "800", letterSpacing: 0.3 },
  scheduledDate: { fontSize: rf(11), color: "#6B7FA8", marginLeft: 22 },

  statsRow: { flexDirection: "row", alignItems: "center", backgroundColor: "rgba(10,13,28,0.85)", borderRadius: 14, borderWidth: 1, paddingVertical: rs(11), paddingHorizontal: rs(8) },
  statChip: { flex: 1, alignItems: "center", gap: 4 },
  statIconWrap: { width: rs(28), height: rs(28), borderRadius: rs(14), alignItems: "center", justifyContent: "center" },
  statValue: { fontSize: rf(13), fontWeight: "800", color: "#E2E8F8" },
  statLabel: { fontSize: rf(9), color: "#6B7FA8" },
  statDivider: { width: 1, height: rs(38) },

  slotsBar: { gap: 5 },
  slotsTrack: { height: 4, backgroundColor: "#1E2538", borderRadius: 2, overflow: "hidden" },
  slotsFill: { height: 4, borderRadius: 2 },
  slotsText: { fontSize: rf(10), color: "#4B5680", textAlign: "right" },

  registerBtn: { borderRadius: 14, overflow: "hidden" },
  registerBtnGrad: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: rs(14) },
  registerBtnText: { fontSize: rf(15), fontWeight: "900" },

  cancelRoomBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, paddingVertical: rs(13), borderRadius: 14, borderWidth: 1, borderColor: "#FF444445", backgroundColor: "#FF444412" },
  cancelRoomBtnText: { fontSize: rf(14), fontWeight: "700", color: "#FF4444" },

  cancelRegBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, paddingVertical: rs(13), borderRadius: 14, borderWidth: 1, borderColor: "#8B9AC030" },
  cancelRegBtnText: { fontSize: rf(14), fontWeight: "700", color: "#8B9AC0" },
});

export default function UpcomingRoomsByDateScreen() {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const params = useLocalSearchParams<{ date: string; dateLabel: string }>();
  const targetDate = params.date ?? "";
  const dateLabel  = params.dateLabel ?? targetDate;

  const [rooms, setRooms]             = useState<UpcomingRoom[]>([]);
  const [loading, setLoading]         = useState(true);
  const [refreshing, setRefreshing]   = useState(false);
  const [error, setError]             = useState<string | null>(null);
  const [registeringId, setRegId]         = useState<string | null>(null);
  const [consentRoom, setConsentRoom]     = useState<UpcomingRoom | null>(null);
  const [checks, setChecks]               = useState([false, false, false, false]);
  const [selectedHostData, setHostData]   = useState<PublicProfileInitialData | null>(null);
  const [selectedHostId, setHostId]       = useState<string | null>(null);

  const fetchRooms = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const res = await authFetch("/api/rooms/available?tab=upcoming");
      if (!res.ok) throw new Error(`Server error ${res.status}`);
      const data = (await res.json()) as { rooms: UpcomingRoom[] };
      const filtered = (data.rooms ?? []).filter((r) => {
        if (!r.scheduled_start_at) return false;
        return new Date(r.scheduled_start_at).toLocaleDateString("en-CA") === targetDate;
      });
      setRooms(filtered.sort((a, b) =>
        new Date(a.scheduled_start_at!).getTime() - new Date(b.scheduled_start_at!).getTime()
      ));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load rooms.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [targetDate]);

  useEffect(() => { void fetchRooms(); }, [fetchRooms]);

  const doRegister = useCallback(async (room: UpcomingRoom) => {
    if (registeringId) return;
    setRegId(room.room_id);
    try {
      const res = await authFetch(`/api/rooms/${room.room_id}/register`, {
        method: "POST",
        body: JSON.stringify({ acceptedCashChallengeConsent: room.entry_fee > 0 }),
      });
      const body = await res.json().catch(() => ({})) as Record<string, unknown>;
      if (!res.ok) { AppAlert.alert("Failed", (body.error as string) ?? "Could not register."); return; }
      setRooms((prev) => prev.map((r) =>
        r.room_id === room.room_id
          ? { ...r, current_user_registered: true, registered_count: (body.registered_count as number) ?? r.registered_count + 1 }
          : r
      ));
    } catch { AppAlert.alert("Error", "Network error. Please try again."); }
    finally { setRegId(null); }
  }, [registeringId]);

  const handleRegister = useCallback((room: UpcomingRoom) => {
    if (room.entry_fee > 0) { setChecks([false, false, false, false]); setConsentRoom(room); }
    else void doRegister(room);
  }, [doRegister]);

  const handleCancel = useCallback(async (room: UpcomingRoom) => {
    if (registeringId) return;
    setRegId(room.room_id);
    try {
      const res = await authFetch(`/api/rooms/${room.room_id}/cancel-registration`, { method: "POST" });
      if (!res.ok) { const b = await res.json().catch(() => ({})) as Record<string, unknown>; AppAlert.alert("Error", (b.error as string) ?? "Try again."); return; }
      setRooms((prev) => prev.map((r) =>
        r.room_id === room.room_id
          ? { ...r, current_user_registered: false, registered_count: Math.max(0, r.registered_count - 1) }
          : r
      ));
    } catch { AppAlert.alert("Error", "Network error."); }
    finally { setRegId(null); }
  }, [registeringId]);

  const handleViewHost = useCallback((room: UpcomingRoom) => {
    if (room.challenge_type === "sponsored") return;
    setHostData({
      username: room.host_username,
      countryFlag: room.host_country_flag,
      avatarColor: room.host_avatar_color,
      avatarUrl: null,
      isHost: true,
      isCurrentUser: false,
    });
    setHostId(room.host_user_id);
  }, []);

  const handleCancelRoom = useCallback((room: UpcomingRoom) => {
    AppAlert.alert("Cancel Room", "Cancel this room? All registered participants will be notified.", [
      { text: "Keep", style: "cancel" },
      { text: "Cancel Room", style: "destructive", onPress: async () => {
        setRegId(room.room_id);
        try {
          const res = await authFetch(`/api/races/${room.room_id}/cancel`, { method: "POST" });
          if (!res.ok) { const b = await res.json().catch(() => ({})) as Record<string, unknown>; AppAlert.alert("Error", (b.error as string) ?? "Try again."); return; }
          setRooms((prev) => prev.filter((r) => r.room_id !== room.room_id));
        } catch { AppAlert.alert("Error", "Network error."); }
        finally { setRegId(null); }
      }},
    ]);
  }, []);

  return (
    <View style={[s.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.backBtn} activeOpacity={0.7}>
          <View style={s.backBtnInner}>
            <Feather name="arrow-left" size={20} color="#D4DCEF" />
          </View>
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={s.headerTitle}>Rooms — {dateLabel}</Text>
          <Text style={s.headerSub}>{rooms.length} scheduled room{rooms.length !== 1 ? "s" : ""}</Text>
        </View>
        <TouchableOpacity onPress={() => void fetchRooms(true)} style={s.backBtn} activeOpacity={0.7} disabled={refreshing}>
          <View style={s.backBtnInner}>
            <Feather name="refresh-cw" size={16} color={refreshing ? GREEN : "#8B9AC0"} />
          </View>
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={s.center}>
          <ActivityIndicator color="#00B4FF" size="large" />
        </View>
      ) : error ? (
        <View style={s.center}>
          <Feather name="alert-circle" size={28} color="#FF6B6B" />
          <Text style={[s.emptyTitle, { color: "#FF6B6B", marginTop: 12 }]}>Failed to load</Text>
          <Text style={s.emptySub}>{error}</Text>
          <TouchableOpacity style={s.retryBtn} onPress={() => void fetchRooms()} activeOpacity={0.8}>
            <Text style={s.retryBtnText}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : rooms.length === 0 ? (
        <View style={s.center}>
          <View style={s.emptyIcon}><Feather name="calendar" size={28} color="#00B4FF" /></View>
          <Text style={s.emptyTitle}>No rooms on {dateLabel}</Text>
          <Text style={s.emptySub}>They may have started or been cancelled.</Text>
          <TouchableOpacity style={s.retryBtn} onPress={() => void fetchRooms()} activeOpacity={0.8}>
            <Text style={s.retryBtnText}>Refresh</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={rooms}
          keyExtractor={(item) => item.room_id}
          contentContainerStyle={{ paddingHorizontal: rs(16), paddingTop: 12, paddingBottom: insets.bottom + 60 }}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => void fetchRooms(true)}
              tintColor="#00B4FF"
              colors={["#00B4FF"]}
            />
          }
          renderItem={({ item }) => (
            <DetailCard
              room={item}
              currentUserId={user?.id}
              onRegister={handleRegister}
              onCancel={handleCancel}
              onCancelRoom={handleCancelRoom}
              onViewHost={handleViewHost}
              registering={registeringId === item.room_id}
            />
          )}
        />
      )}

      {/* Public profile modal */}
      <PublicProfileModal
        visible={!!selectedHostId}
        userId={selectedHostId}
        initialData={selectedHostData ?? undefined}
        onClose={() => { setHostId(null); setHostData(null); }}
      />

      {/* Cash consent modal */}
      <Modal visible={!!consentRoom} animationType="slide" presentationStyle="pageSheet" transparent={false}>
        <View style={s.consentWrap}>
          <View style={s.consentHeader}>
            <Text style={s.consentTitle}>Confirm Challenge Entry</Text>
            <TouchableOpacity onPress={() => setConsentRoom(null)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Feather name="x" size={22} color="#EAEFF8" />
            </TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={s.consentBody} showsVerticalScrollIndicator={false}>
            <View style={s.consentCard}>
              <View style={s.consentRow}><Text style={s.consentLabel}>Challenge</Text><Text style={s.consentValue}>${(consentRoom?.entry_fee ?? 0).toFixed(0)} Scheduled Challenge</Text></View>
              <View style={s.consentDivider} />
              <View style={s.consentRow}><Text style={s.consentLabel}>Entry Fee</Text><Text style={[s.consentValue, { color: "#60A5FA" }]}>${(consentRoom?.entry_fee ?? 0).toFixed(2)}</Text></View>
              <View style={s.consentDivider} />
              <View style={s.consentRow}><Text style={s.consentLabel}>Type</Text><Text style={s.consentValue}>Skill-based walking challenge</Text></View>
            </View>
            <Text style={s.consentSectionLabel}>Please confirm all of the following:</Text>
            {[
              "I am 18 years of age or older and legally eligible to participate in paid challenges in my jurisdiction.",
              "I understand this is a skill-based walking challenge. My result depends entirely on my step performance — outcomes are not based on chance.",
              "I understand that entry fees are charged when the race begins at its scheduled time. If I cancel my registration before the race starts, no fee is charged.",
              "I have read and agree to the Walk Champ Challenge Rules & Terms of Service.",
            ].map((text, i) => (
              <TouchableOpacity key={i} style={[s.checkRow, checks[i] && s.checkRowActive]}
                onPress={() => { const n = [...checks]; n[i] = !n[i]; setChecks(n); }} activeOpacity={0.8}>
                <View style={[s.checkbox, checks[i] && s.checkboxChecked]}>
                  {checks[i] && <Feather name="check" size={13} color="#000" />}
                </View>
                <Text style={s.checkText}>{text}</Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity
              style={{ opacity: checks.every(Boolean) ? 1 : 0.4, borderRadius: 14, overflow: "hidden", marginTop: 8 }}
              disabled={!checks.every(Boolean)}
              onPress={() => { const r = consentRoom; setConsentRoom(null); if (r) void doRegister(r); }}
              activeOpacity={0.85}
            >
              <LinearGradient colors={["#7C3AED", "#9333EA"]} style={s.confirmBtn} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}>
                <Feather name="check-circle" size={20} color="#FFF" />
                <Text style={s.confirmBtnText}>Confirm & Register</Text>
              </LinearGradient>
            </TouchableOpacity>
            <TouchableOpacity style={s.cancelConsentBtn} onPress={() => setConsentRoom(null)}>
              <Text style={s.cancelConsentBtnText}>Cancel</Text>
            </TouchableOpacity>
            <Text style={s.finePrint}>Walk Champ is a skill-based activity platform. Paid challenges are not gambling — your performance determines your result. Must be 18+ and eligible in your region to join paid challenges.</Text>
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: BG },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 10, gap: 10 },
  backBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  backBtnInner: { width: 36, height: 36, borderRadius: 12, backgroundColor: "#131829", borderWidth: 1, borderColor: "#1E2640", alignItems: "center", justifyContent: "center" },
  headerTitle: { fontSize: rf(17), fontWeight: "800", color: "#EAEFF8" },
  headerSub: { fontSize: rf(12), color: "#6B7FA8", marginTop: 1 },

  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 8, paddingHorizontal: 32 },
  emptyIcon: { width: 60, height: 60, borderRadius: 20, backgroundColor: "#00B4FF10", borderWidth: 1, borderColor: "#00B4FF30", alignItems: "center", justifyContent: "center", marginBottom: 4 },
  emptyTitle: { fontSize: rf(16), fontWeight: "700", color: "#D4DCEF", textAlign: "center" },
  emptySub: { fontSize: rf(13), color: "#6B7FA8", textAlign: "center" },
  retryBtn: { marginTop: 8, paddingHorizontal: 24, paddingVertical: 10, borderRadius: 10, backgroundColor: "#00B4FF20", borderWidth: 1, borderColor: "#00B4FF40" },
  retryBtnText: { color: "#00B4FF", fontWeight: "700", fontSize: rf(13) },

  consentWrap: { flex: 1, backgroundColor: "#0A0D1A" },
  consentHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: "#1E2640" },
  consentTitle: { fontSize: rf(17), fontWeight: "800", color: "#EAEFF8" },
  consentBody: { padding: 20, gap: 14 },
  consentCard: { backgroundColor: "#131829", borderRadius: 14, borderWidth: 1, borderColor: "#1E2640", padding: 16, gap: 12 },
  consentRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  consentDivider: { height: 1, backgroundColor: "#1E2640" },
  consentLabel: { fontSize: rf(13), color: "#6B7FA8" },
  consentValue: { fontSize: rf(13), fontWeight: "700", color: "#D4DCEF" },
  consentSectionLabel: { fontSize: rf(13), fontWeight: "700", color: "#8B9AC0" },
  checkRow: { flexDirection: "row", alignItems: "flex-start", gap: 12, padding: 14, borderRadius: 12, borderWidth: 1, borderColor: "#1E2640", backgroundColor: "#131829" },
  checkRowActive: { borderColor: "#7C3AFF60", backgroundColor: "#7C3AFF10" },
  checkbox: { width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: "#2A3550", alignItems: "center", justifyContent: "center", flexShrink: 0 },
  checkboxChecked: { backgroundColor: "#7C3AFF", borderColor: "#7C3AFF" },
  checkText: { flex: 1, fontSize: rf(13), color: "#BCC8E8", lineHeight: 20 },
  confirmBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, paddingVertical: 16 },
  confirmBtnText: { fontSize: rf(16), fontWeight: "800", color: "#FFF" },
  cancelConsentBtn: { alignItems: "center", justifyContent: "center", paddingVertical: 14 },
  cancelConsentBtnText: { fontSize: rf(14), color: "#6B7FA8", fontWeight: "600" },
  finePrint: { fontSize: rf(11), color: "#4B5680", textAlign: "center", lineHeight: 17 },
});
