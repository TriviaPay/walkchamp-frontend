import React, { useEffect, useRef, useState } from "react";
import {
  Animated,
  Clipboard,
  Modal,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { TouchableOpacity } from "@/components/HapticTouchableOpacity";
import { ProfileAvatar } from "@/components/ProfileAvatar";
import { authFetch } from "@/utils/authFetch";
import { getApiBase } from "@/utils/apiUrl";
import { router } from "expo-router";
import { getStoredSession } from "@/services/authService";
import { useRace } from "@/context/RaceContext";

const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? "";
const INVITE_TTL = 20;

export interface RoomInvitation {
  inviteId: string;
  raceId: string;
  inviterUsername: string;
  inviterAvatarColor: string;
  inviterAvatarUrl?: string | null;
  inviterUserId?: string | null;
  challengeType: string;
  entryAmountCents: number;
  targetSteps: number;
  isPrivate: boolean;
  inviteCode?: string | null;
  expiresAt: string;
}

interface Props {
  invitation: RoomInvitation | null;
  onDismiss: () => void;
}

export function RoomInvitationModal({ invitation, onDismiss }: Props) {
  const { setActiveRace, joinRace } = useRace();
  const [secondsLeft, setSecondsLeft] = useState(INVITE_TTL);
  const [responding, setResponding] = useState(false);
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const progressAnim = useRef(new Animated.Value(1)).current;
  const scaleAnim = useRef(new Animated.Value(0.85)).current;
  const opacityAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!invitation) return;
    const remaining = Math.max(0, Math.round((new Date(invitation.expiresAt).getTime() - Date.now()) / 1000));
    setSecondsLeft(remaining);
    setResponding(false);
    setCopied(false);

    // Entrance animation
    Animated.parallel([
      Animated.spring(scaleAnim, { toValue: 1, useNativeDriver: true, tension: 80, friction: 9 }),
      Animated.timing(opacityAnim, { toValue: 1, duration: 200, useNativeDriver: true }),
    ]).start();

    progressAnim.setValue(remaining / INVITE_TTL);
    Animated.timing(progressAnim, {
      toValue: 0,
      duration: remaining * 1000,
      useNativeDriver: false,
    }).start();

    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setSecondsLeft((s) => {
        if (s <= 1) {
          clearInterval(timerRef.current!);
          timerRef.current = null;
          onDismiss();
          return 0;
        }
        return s - 1;
      });
    }, 1000);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invitation?.inviteId]);

  const respond = async (action: "accept" | "decline") => {
    if (!invitation || responding) return;
    setResponding(true);
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }

    try {
      const res = await authFetch(`/api/races/invites/${invitation.inviteId}/respond`, {
        method: "POST",
        body: JSON.stringify({ action }),
      });

      if (action === "decline" || !res.ok) {
        onDismiss();
        return;
      }

      const data = await res.json().catch(() => null) as { raceId?: string; room?: { entryAmountCents: number; targetSteps: number; maxPlayers: number; isPrivate: boolean; entryType: string } } | null;
      if (!data?.raceId) { onDismiss(); return; }

      const raceId = data.raceId;
      const room = data.room;
      const entryFee = (room?.entryAmountCents ?? 0) / 100;
      const maxPlayers = room?.maxPlayers ?? 10;

      if (!room || room.entryAmountCents === 0) {
        const { session } = await getStoredSession();
        if (session) {
          await fetch(`${API_BASE}/api/races/${raceId}/join`, {
            method: "POST",
            headers: { Authorization: `Bearer ${session}`, "Content-Type": "application/json" },
          }).catch(() => {});
        }
      }

      setActiveRace(raceId, false);
      joinRace(entryFee, maxPlayers, false);
      onDismiss();
      router.push({
        pathname: "/race/matchmaking",
        params: {
          raceId,
          isHost: "false",
          isPrivate: room?.isPrivate ? "true" : "false",
          seedFeeCents: String(room?.entryAmountCents ?? 0),
          seedMaxPlayers: String(room?.maxPlayers ?? 10),
          seedTargetSteps: String(room?.targetSteps ?? 1000),
        },
      });
    } catch {
      setResponding(false);
    }
  };

  const copyRoomId = () => {
    if (invitation?.raceId) {
      Clipboard.setString(invitation.raceId.slice(0, 8));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  };

  if (!invitation) return null;

  const isFree = invitation.entryAmountCents === 0;
  const entryLabel = isFree ? "No entry fee" : `$${(invitation.entryAmountCents / 100).toFixed(2).replace(/\.00$/, "")}`;
  const roomIdShort = invitation.raceId.slice(0, 8);

  const timerColor = secondsLeft > 10 ? "#F59E0B" : secondsLeft > 5 ? "#F97316" : "#EF4444";

  const progressWidth = progressAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ["0%", "100%"],
  });

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onDismiss}>
      <View style={styles.overlay}>
        <Animated.View style={[styles.card, { transform: [{ scale: scaleAnim }], opacity: opacityAnim }]}>
          {/* Top progress bar */}
          <View style={styles.timerBar}>
            <Animated.View style={[styles.timerFill, { width: progressWidth, backgroundColor: timerColor }]} />
          </View>

          {/* Close button */}
          <TouchableOpacity style={styles.closeBtn} onPress={onDismiss} hitSlop={10}>
            <Feather name="x" size={16} color="#666" />
          </TouchableOpacity>

          {/* Avatar centered */}
          <View style={styles.avatarWrap}>
            <View style={[styles.avatarRing, { borderColor: invitation.inviterAvatarColor + "60" }]}>
              <ProfileAvatar
                userId={invitation.inviterUserId ?? ""}
                profileImageUrl={invitation.inviterAvatarUrl ?? null}
                avatarVersion={0}
                avatarColor={invitation.inviterAvatarColor}
                displayName={invitation.inviterUsername}
                size={52}
                borderWidth={0}
              />
            </View>
          </View>

          {/* Invite text */}
          <Text style={styles.subText}>
            <Text style={styles.username}>@{invitation.inviterUsername}</Text>
            {" invited you to join a"}
          </Text>

          {/* Challenge type headline */}
          <Text style={styles.challengeType}>{invitation.challengeType.toUpperCase()}</Text>

          {/* Details card */}
          <View style={styles.details}>
            <DetailRow icon="activity" label="Target Steps" value={`${invitation.targetSteps.toLocaleString()} Steps`} />
            <View style={styles.divider} />
            <DetailRow icon="dollar-sign" label="Entry Fee" value={entryLabel} valueColor={isFree ? "#00E676" : "#FFC107"} />
            <View style={styles.divider} />
            <DetailRow icon="users" label="Room Type" value={invitation.isPrivate ? "Private" : "Public"} />
            <View style={styles.divider} />
            <View style={styles.detailRow}>
              <Feather name="hash" size={14} color="#5A6A8A" />
              <Text style={styles.detailLabel}>Room ID</Text>
              <Text style={styles.detailValue}>{roomIdShort}</Text>
              <TouchableOpacity onPress={copyRoomId} hitSlop={8}>
                <Feather name={copied ? "check" : "copy"} size={13} color={copied ? "#00E676" : "#5A6A8A"} />
              </TouchableOpacity>
            </View>
          </View>

          {/* Expires pill */}
          <View style={[styles.expiresPill, { borderColor: timerColor + "60", backgroundColor: timerColor + "18" }]}>
            <Feather name="clock" size={13} color={timerColor} />
            <Text style={[styles.expiresText, { color: timerColor }]}>
              Expires in <Text style={styles.expiresBold}>{secondsLeft}s</Text>
            </Text>
          </View>

          {/* Buttons */}
          <View style={styles.btnRow}>
            <TouchableOpacity
              style={[styles.declineBtn, { opacity: responding ? 0.5 : 1 }]}
              onPress={() => respond("decline")}
              disabled={responding}
            >
              <Feather name="x" size={15} color="#EF4444" />
              <Text style={styles.declineTxt}>DECLINE</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.acceptBtn, { opacity: responding ? 0.5 : 1 }]}
              onPress={() => respond("accept")}
              disabled={responding}
            >
              <Feather name="user-plus" size={15} color="#000" />
              <Text style={styles.acceptTxt}>{responding ? "Joining…" : "JOIN"}</Text>
            </TouchableOpacity>
          </View>

          <Text style={styles.note}>Accept within the time limit to join the challenge!</Text>
        </Animated.View>
      </View>
    </Modal>
  );
}

function DetailRow({ icon, label, value, valueColor }: { icon: string; label: string; value: string; valueColor?: string }) {
  return (
    <View style={styles.detailRow}>
      <Feather name={icon as never} size={14} color="#5A6A8A" />
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={[styles.detailValue, valueColor ? { color: valueColor } : undefined]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.80)",
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 24,
  },
  card: {
    width: "100%",
    maxWidth: 360,
    backgroundColor: "#0A0E1F",
    borderRadius: 24,
    borderWidth: 1,
    borderColor: "#1E2A50",
    overflow: "hidden",
    paddingBottom: 16,
  },

  // Timer bar
  timerBar: { height: 3, width: "100%", backgroundColor: "#1A2040" },
  timerFill: { height: 3 },

  // Close
  closeBtn: {
    position: "absolute",
    top: 12,
    right: 14,
    zIndex: 10,
    padding: 4,
  },

  // Avatar
  avatarWrap: { alignItems: "center", marginTop: 14, marginBottom: 6 },
  avatarRing: {
    width: 60,
    height: 60,
    borderRadius: 30,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },

  // Invite text
  subText: {
    textAlign: "center",
    fontSize: 12,
    color: "#8A9AC0",
    marginBottom: 2,
    paddingHorizontal: 20,
  },
  username: { color: "#00E676", fontWeight: "700" },

  // Challenge type
  challengeType: {
    textAlign: "center",
    fontSize: 18,
    fontWeight: "900",
    color: "#FFC107",
    letterSpacing: 0.5,
    marginBottom: 10,
    paddingHorizontal: 20,
  },

  // Details
  details: {
    marginHorizontal: 14,
    borderRadius: 12,
    backgroundColor: "#0E1428",
    borderWidth: 1,
    borderColor: "#1E2A50",
    marginBottom: 10,
  },
  divider: { height: 1, backgroundColor: "#1A2040", marginHorizontal: 12 },
  detailRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  detailLabel: { fontSize: 12, color: "#8A9AC0", flex: 1 },
  detailValue: { fontSize: 12, fontWeight: "700", color: "#E8EEFF" },

  // Expires pill
  expiresPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    alignSelf: "center",
    paddingHorizontal: 14,
    paddingVertical: 5,
    borderRadius: 20,
    borderWidth: 1.5,
    marginBottom: 10,
  },
  expiresText: { fontSize: 12 },
  expiresBold: { fontWeight: "900", fontSize: 13 },

  // Buttons
  btnRow: {
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 14,
    marginBottom: 8,
  },
  declineBtn: {
    flex: 1,
    height: 42,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: "#EF444450",
    backgroundColor: "#EF444415",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
  },
  declineTxt: { color: "#EF4444", fontSize: 12, fontWeight: "800", letterSpacing: 0.5 },
  acceptBtn: {
    flex: 2,
    height: 42,
    borderRadius: 10,
    backgroundColor: "#00E676",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
  },
  acceptTxt: { color: "#000", fontSize: 14, fontWeight: "900", letterSpacing: 0.5 },

  note: {
    textAlign: "center",
    fontSize: 10,
    color: "#3A4A70",
    paddingHorizontal: 20,
    marginBottom: 2,
  },
});
