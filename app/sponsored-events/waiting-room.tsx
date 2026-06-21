import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Alert,
  Animated,
  Image,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { Feather } from "@expo/vector-icons";
import { router, useLocalSearchParams, useFocusEffect } from "expo-router";
import * as Haptics from "expo-haptics";
import { authFetch } from "@/utils/authFetch";
import { useAppDispatch } from "@/store/hooks";
import { fetchCoinBalance } from "@/store/slices/coinsSlice";
import { rf, rs } from "@/utils/responsive";
import { SkeletonList } from "@/components/SkeletonRows";
import { subscribeToChannel, SPONSORED_EVENTS_CHANNEL, EVENTS } from "@/services/realtimeService";
import { getApiBase } from "@/utils/apiUrl";
import { getBadgeColor } from "@/utils/mockData";
import { TouchableOpacity } from "@/components/HapticTouchableOpacity";

const COIN_IMG = require("@/assets/images/game-coin.png");

interface RegisteredUser {
  userId: string;
  username: string;
  avatarUrl: string | null;
  avatarColor: string;
  countryFlag: string | null;
  badge: string;
}

interface SponsoredEvent {
  id: string;
  title: string;
  status: string;
  scheduledStartAt: string | null;
  startedAt?: string | null;
  endsAt?: string | null;
  targetSteps: number;
  maxSlots: number;
  registeredCount: number;
  prizePoolCents: number;
  entryCoinFee: number;
  isRegistered: boolean;
  isActive: boolean;
  joinWindowOpen: boolean;
  registeredUsers: RegisteredUser[];
}

function useCountdown(iso: string | null): { label: string; expired: boolean } {
  const [label, setLabel] = useState("");
  const [expired, setExpired] = useState(false);
  useEffect(() => {
    if (!iso) { setLabel(""); return; }
    const tick = () => {
      const diff = new Date(iso).getTime() - Date.now();
      if (diff <= 0) {
        setLabel("Starting now…");
        setExpired(true);
        return;
      }
      setExpired(false);
      const h = Math.floor(diff / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      if (h > 0) setLabel(`${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`);
      else setLabel(`${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`);
    };
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [iso]);
  return { label, expired };
}

function AvatarWithFallback({ userId, avatarColor, username, size }: {
  userId: string; avatarColor: string; username: string; size: number;
}) {
  const [failed, setFailed] = useState(false);
  const uri = `${getApiBase()}/api/profile/avatar/${userId}`;
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, overflow: "hidden" }}>
      {!failed ? (
        <Image source={{ uri }} style={{ width: size, height: size }} onError={() => setFailed(true)} />
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

function PulseRing() {
  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(anim, { toValue: 1, duration: 1200, useNativeDriver: true }),
        Animated.timing(anim, { toValue: 0, duration: 600, useNativeDriver: true }),
      ])
    ).start();
  }, [anim]);
  const scale = anim.interpolate({ inputRange: [0, 1], outputRange: [1, 1.25] });
  const opacity = anim.interpolate({ inputRange: [0, 1], outputRange: [0.7, 0] });
  return (
    <Animated.View style={[s.pulseRing, { transform: [{ scale }], opacity }]} />
  );
}

export default function SponsoredWaitingRoom() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const dispatch = useAppDispatch();
  const [event, setEvent] = useState<SponsoredEvent | null>(null);
  const [loading, setLoading] = useState(true);
  const [leaving, setLeaving] = useState(false);
  const navigatedRef = useRef(false);

  const { label: countdown, expired } = useCountdown(event?.scheduledStartAt ?? null);

  const fetchEvent = useCallback(async () => {
    try {
      const res = await authFetch("/api/sponsored-events");
      if (!res.ok) return;
      const data = await res.json() as { events: SponsoredEvent[] };
      const found = (data.events ?? []).find((e) => e.id === id);
      if (found) setEvent(found);
    } catch { /* silent */ }
    finally { setLoading(false); }
  }, [id]);

  useFocusEffect(useCallback(() => {
    setLoading(true);
    fetchEvent();
  }, [fetchEvent]));

  // Navigate to live race when started (via polled state or direct trigger)
  const navigateToRace = useCallback((raceId: string) => {
    if (navigatedRef.current) return;
    navigatedRef.current = true;
    router.replace({ pathname: "/race/live-detail", params: { id: raceId } });
  }, []);

  useEffect(() => {
    if (!event) return;
    if (event.status === "in_progress") {
      navigateToRace(id);
    }
  }, [event, id, navigateToRace]);

  // When countdown expires, poll aggressively every 3 s until status = in_progress
  useEffect(() => {
    if (!expired) return;
    const poll = setInterval(async () => {
      try {
        const res = await authFetch("/api/sponsored-events");
        if (!res.ok) return;
        const data = await res.json() as { events: SponsoredEvent[] };
        const found = (data.events ?? []).find((e) => e.id === id);
        if (found) {
          setEvent(found);
          if (found.status === "in_progress") {
            clearInterval(poll);
            navigateToRace(id);
          }
        }
      } catch { /* silent */ }
    }, 3000);
    return () => clearInterval(poll);
  }, [expired, id, navigateToRace]);

  // Pusher real-time updates
  useEffect(() => {
    const ch = subscribeToChannel(SPONSORED_EVENTS_CHANNEL);
    if (!ch) return;

    ch.bind(EVENTS.SPONSORED_EVENT_STARTED, (d: { room_id: string }) => {
      if (d.room_id !== id) return;
      navigateToRace(d.room_id);
    });

    ch.bind(EVENTS.SPONSORED_EVENT_CANCELLED, (d: { room_id: string }) => {
      if (d.room_id !== id) return;
      Alert.alert(
        "Event Cancelled",
        "This race has been cancelled. Your coins have been refunded.",
        [{ text: "OK", onPress: () => router.back() }],
      );
    });

    ch.bind(EVENTS.SPONSORED_EVENT_REGISTRATION_UPDATED, (d: { room_id: string }) => {
      if (d.room_id !== id) return;
      fetchEvent();
    });

    return () => {
      ch.unbind(EVENTS.SPONSORED_EVENT_STARTED)
        .unbind(EVENTS.SPONSORED_EVENT_CANCELLED)
        .unbind(EVENTS.SPONSORED_EVENT_REGISTRATION_UPDATED);
    };
  }, [id, fetchEvent]);

  const handleLeave = () => {
    Alert.alert(
      "Leave Race",
      `Leave the waiting room? You'll receive a full refund of ${event?.entryCoinFee?.toLocaleString() ?? "5,000"} coins.`,
      [
        { text: "Stay In", style: "cancel" },
        { text: "Leave & Refund", style: "destructive", onPress: confirmLeave },
      ],
    );
  };

  const confirmLeave = async () => {
    if (!event) return;
    setLeaving(true);
    try {
      const res = await authFetch(`/api/sponsored-events/${event.id}/cancel-registration`, { method: "POST" });
      const data = await res.json() as { success?: boolean; error?: string };
      if (!res.ok) {
        Alert.alert("Error", data.error ?? "Failed to leave.");
        return;
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      dispatch(fetchCoinBalance());
      router.back();
    } catch {
      Alert.alert("Error", "Failed to leave. Please try again.");
    } finally {
      setLeaving(false);
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={s.root} edges={["top", "bottom"]}>
        <View style={{ paddingHorizontal: rs(16), paddingTop: rs(12) }}>
          <SkeletonList count={3} variant="event" />
        </View>
      </SafeAreaView>
    );
  }

  if (!event) {
    return (
      <SafeAreaView style={s.root} edges={["top", "bottom"]}>
        <View style={s.centered}>
          <Text style={s.errorText}>Event not found.</Text>
          <TouchableOpacity style={s.backBtn} onPress={() => router.back()}>
            <Text style={s.backBtnText}>Go Back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const displayTitle = event.title.replace(/\s*\([A-Za-z]+\s+\d+\)\s*$/, "").trim();
  const isRaceDay = expired || event.status === "in_progress";
  const slotPct = event.maxSlots > 0 ? event.registeredCount / event.maxSlots : 0;

  return (
    <SafeAreaView style={s.root} edges={["top", "bottom"]}>
      {/* Header */}
      <LinearGradient colors={["#100030", "#050010"]} style={s.header} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}>
        <TouchableOpacity onPress={() => router.back()} style={s.headerBack} activeOpacity={0.7}>
          <Feather name="arrow-left" size={22} color="#FFF" />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={s.headerTitle} numberOfLines={1}>{displayTitle}</Text>
          <Text style={s.headerSub}>Waiting Room · Race starts automatically</Text>
        </View>
      </LinearGradient>

      <ScrollView contentContainerStyle={s.scroll} showsVerticalScrollIndicator={false}>

        {/* Countdown */}
        <View style={s.countdownCard}>
          <LinearGradient
            colors={isRaceDay ? ["#003322", "#006644"] : ["#14004A", "#220066"]}
            style={s.countdownGrad}
            start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
          >
            <View style={s.pulseWrap}>
              <PulseRing />
              <View style={[s.pulseCore, { backgroundColor: isRaceDay ? "#00E676" : "#7C3AFF" }]}>
                <Feather name={isRaceDay ? "zap" : "clock"} size={22} color="#FFF" />
              </View>
            </View>

            <Text style={s.countdownSub}>
              {isRaceDay ? "🏁 Race Starting!" : "Race starts in"}
            </Text>
            <Text style={[s.countdownTime, { color: isRaceDay ? "#00E676" : "#C47BFF" }]}>
              {isRaceDay ? "Loading race…" : countdown}
            </Text>
            <Text style={s.countdownNote}>
              {isRaceDay
                ? "Navigating you to the live race…"
                : "The race starts automatically — no action needed"}
            </Text>
          </LinearGradient>
        </View>

        {/* Prize + stats row */}
        <View style={s.statsRow}>
          <View style={s.statPill}>
            <Text style={s.statIcon}>🎁</Text>
            <Text style={s.statVal}>$5</Text>
            <Text style={s.statLbl}>per winner</Text>
          </View>
          <View style={s.statPill}>
            <Image source={COIN_IMG} style={{ width: 14, height: 14 }} resizeMode="contain" />
            <Text style={[s.statVal, { color: "#FFD700" }]}>{event.targetSteps.toLocaleString()}</Text>
            <Text style={s.statLbl}>steps goal</Text>
          </View>
          <View style={s.statPill}>
            <Feather name="users" size={13} color="#A78BFA" />
            <Text style={s.statVal}>{event.registeredCount}</Text>
            <Text style={s.statLbl}>registered</Text>
          </View>
        </View>

        {/* Slot progress */}
        <View style={s.slotCard}>
          <View style={s.slotHeader}>
            <Text style={s.slotLabel}>{event.registeredCount} / {event.maxSlots} slots filled</Text>
            {slotPct >= 0.8 && slotPct < 1 && (
              <View style={s.almostBadge}>
                <Text style={s.almostText}>Almost full!</Text>
              </View>
            )}
          </View>
          <View style={s.slotTrack}>
            <LinearGradient
              colors={slotPct >= 0.8 ? ["#FF6B35", "#FFB300"] : ["#7C3AFF", "#C47BFF"]}
              style={[s.slotFill, { width: `${Math.min(100, slotPct * 100)}%` as `${number}%` }]}
              start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
            />
          </View>
        </View>

        {/* Registered participants */}
        {event.registeredUsers.length > 0 && (
          <View style={s.participantsCard}>
            <Text style={s.participantsTitle}>👥 Registered Participants</Text>
            {event.registeredUsers.map((u, i) => {
              const badgeColor = getBadgeColor(u.badge);
              return (
                <View key={i} style={s.participantRow}>
                  <View style={s.participantAvatar}>
                    <AvatarWithFallback
                      userId={u.userId}
                      avatarColor={u.avatarColor}
                      username={u.username}
                      size={rs(42)}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                      <Text style={s.participantName} numberOfLines={1}>@{u.username}</Text>
                      {u.countryFlag ? <Text style={s.participantFlag}>{u.countryFlag}</Text> : null}
                    </View>
                    <View style={[s.badgePill, { backgroundColor: badgeColor + "22", borderColor: badgeColor + "55" }]}>
                      <Text style={[s.badgeText, { color: badgeColor }]}>{u.badge}</Text>
                    </View>
                  </View>
                  <View style={s.readyDot} />
                </View>
              );
            })}
          </View>
        )}

        {/* Fallback "Go to Race" button — shown when countdown expired but navigation hasn't fired yet */}
        {isRaceDay && event.status === "in_progress" && (
          <TouchableOpacity
            style={[s.leaveBtn, { backgroundColor: "rgba(0,200,83,0.12)", borderColor: "#00E676" }]}
            onPress={() => navigateToRace(id)}
            activeOpacity={0.82}
          >
            <Feather name="zap" size={16} color="#00E676" />
            <View style={{ flex: 1 }}>
              <Text style={[s.leaveBtnText, { color: "#00E676" }]}>Go to Live Race</Text>
              <Text style={s.leaveBtnSub}>Tap if navigation didn't start automatically</Text>
            </View>
          </TouchableOpacity>
        )}

        {/* Leave button */}
        {event.status === "scheduled" && (
          <TouchableOpacity
            style={s.leaveBtn}
            onPress={handleLeave}
            disabled={leaving}
            activeOpacity={0.8}
          >
            {leaving ? (
              <ActivityIndicator size="small" color="#FF8888" />
            ) : (
              <>
                <Feather name="log-out" size={16} color="#FF8888" />
                <View style={{ flex: 1 }}>
                  <Text style={s.leaveBtnText}>Leave Waiting Room</Text>
                  <Text style={s.leaveBtnSub}>{(event.entryCoinFee ?? 5000).toLocaleString()} coins refunded immediately</Text>
                </View>
              </>
            )}
          </TouchableOpacity>
        )}

        {/* Info footer */}
        <View style={s.infoBox}>
          <Feather name="info" size={14} color="rgba(255,255,255,0.25)" />
          <Text style={s.infoText}>
            Stay on this screen and you'll be taken into the race automatically at the scheduled time.
            Walking outside this app is tracked via your device's health data.
          </Text>
        </View>

      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#060012" },

  header: {
    flexDirection: "row", alignItems: "center", gap: rs(12),
    paddingHorizontal: rs(16), paddingVertical: rs(14), paddingBottom: rs(16),
  },
  headerBack: {
    width: rs(36), height: rs(36), borderRadius: 18,
    backgroundColor: "rgba(255,255,255,0.08)", alignItems: "center", justifyContent: "center",
  },
  headerTitle: { fontSize: rf(17), fontWeight: "800", color: "#FFF" },
  headerSub: { fontSize: rf(11), color: "rgba(255,255,255,0.4)", marginTop: 2 },

  centered: { flex: 1, alignItems: "center", justifyContent: "center", gap: rs(16) },
  errorText: { fontSize: rf(15), color: "rgba(255,255,255,0.5)" },
  backBtn: {
    backgroundColor: "#7C3AFF", borderRadius: 12,
    paddingHorizontal: rs(20), paddingVertical: rs(10),
  },
  backBtnText: { fontSize: rf(14), fontWeight: "700", color: "#FFF" },

  scroll: { paddingHorizontal: rs(16), paddingTop: rs(12), paddingBottom: rs(48), gap: rs(14) },

  // Countdown card
  countdownCard: { borderRadius: 22, overflow: "hidden", borderWidth: 1.5, borderColor: "#7C3AFF50" },
  countdownGrad: { alignItems: "center", paddingVertical: rs(32), paddingHorizontal: rs(20) },
  pulseWrap: { alignItems: "center", justifyContent: "center", width: rs(80), height: rs(80), marginBottom: rs(20) },
  pulseRing: {
    position: "absolute", width: rs(80), height: rs(80), borderRadius: rs(40),
    borderWidth: 2, borderColor: "#7C3AFF",
  },
  pulseCore: {
    width: rs(60), height: rs(60), borderRadius: rs(30),
    alignItems: "center", justifyContent: "center",
  },
  countdownSub: { fontSize: rf(12), fontWeight: "700", color: "rgba(255,255,255,0.55)", letterSpacing: 0.5, marginBottom: rs(8) },
  countdownTime: { fontSize: rf(46), fontWeight: "900", letterSpacing: 2, lineHeight: 54, textAlign: "center" },
  countdownNote: { fontSize: rf(11.5), color: "rgba(255,255,255,0.35)", textAlign: "center", marginTop: rs(12), lineHeight: 18 },

  // Stats row
  statsRow: { flexDirection: "row", gap: rs(8) },
  statPill: {
    flex: 1, alignItems: "center", gap: 3,
    backgroundColor: "rgba(255,255,255,0.05)", borderRadius: 14,
    borderWidth: 1, borderColor: "rgba(255,255,255,0.08)",
    paddingVertical: rs(12),
  },
  statIcon: { fontSize: 14 },
  statVal: { fontSize: rf(15), fontWeight: "800", color: "#FFF" },
  statLbl: { fontSize: rf(9), color: "rgba(255,255,255,0.35)", fontWeight: "600" },

  // Slot card
  slotCard: {
    backgroundColor: "rgba(255,255,255,0.04)", borderRadius: 16,
    borderWidth: 1, borderColor: "rgba(255,255,255,0.07)",
    padding: rs(14),
  },
  slotHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: rs(10) },
  slotLabel: { fontSize: rf(12.5), fontWeight: "700", color: "rgba(255,255,255,0.6)" },
  almostBadge: {
    backgroundColor: "#FF6B3520", borderWidth: 1, borderColor: "#FF6B3550",
    borderRadius: 8, paddingHorizontal: 7, paddingVertical: 2,
  },
  almostText: { fontSize: rf(9.5), color: "#FF9060", fontWeight: "700" },
  slotTrack: { height: 6, backgroundColor: "rgba(255,255,255,0.07)", borderRadius: 4, overflow: "hidden" },
  slotFill: { height: "100%", borderRadius: 4 },

  // Participants
  participantsCard: {
    backgroundColor: "rgba(255,255,255,0.04)", borderRadius: 18,
    borderWidth: 1, borderColor: "rgba(255,255,255,0.07)",
    padding: rs(16),
  },
  participantsTitle: { fontSize: rf(13), fontWeight: "800", color: "#FFF", marginBottom: rs(14) },
  participantRow: { flexDirection: "row", alignItems: "center", gap: rs(10), marginBottom: rs(12) },
  participantAvatar: { borderRadius: rs(23), borderWidth: 2, borderColor: "#7C3AFF60", overflow: "hidden", flexShrink: 0 },
  participantName: { fontSize: rf(13.5), fontWeight: "700", color: "#FFF" },
  participantFlag: { fontSize: rf(14) },
  badgePill: {
    alignSelf: "flex-start", borderWidth: 1, borderRadius: 8,
    paddingHorizontal: 6, paddingVertical: 2, marginTop: 3,
  },
  badgeText: { fontSize: rf(9.5), fontWeight: "700" },
  readyDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: "#00E676", flexShrink: 0 },

  // Leave button
  leaveBtn: {
    flexDirection: "row", alignItems: "center", gap: rs(12),
    backgroundColor: "rgba(255,50,50,0.12)", borderWidth: 1.5, borderColor: "#FF5555",
    borderRadius: 16, paddingVertical: rs(14), paddingHorizontal: rs(16),
  },
  leaveBtnText: { fontSize: rf(15), fontWeight: "800", color: "#FF6666" },
  leaveBtnSub: { fontSize: rf(10.5), color: "rgba(255,120,120,0.6)", marginTop: 2 },

  // Info box
  infoBox: {
    flexDirection: "row", alignItems: "flex-start", gap: rs(10),
    backgroundColor: "rgba(255,255,255,0.03)", borderRadius: 14,
    padding: rs(14),
  },
  infoText: { flex: 1, fontSize: rf(11.5), color: "rgba(255,255,255,0.3)", lineHeight: 18 },
});
