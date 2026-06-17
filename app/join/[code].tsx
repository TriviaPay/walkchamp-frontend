/**
 * app/join/[code].tsx — Deep-link join handler
 *
 * Opened when the user taps a Walk Champ invite link:
 *   globalwalkerleague://join/CODE
 *
 * Validates auth, resolves room details, shows cash-challenge consent if needed,
 * calls join-with-code API, navigates to matchmaking on success.
 */

import * as Haptics from "expo-haptics";
import { LinearGradient } from "expo-linear-gradient";
import { router, useLocalSearchParams } from "expo-router";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { useSafeLayout } from "@/hooks/useSafeLayout";
import { useRace } from "@/context/RaceContext";
import { authFetch } from "@/utils/authFetch";

const CASH_RULES_VERSION = "2026-06";

const ERROR_MESSAGES: Record<string, string> = {
  INVALID_ROOM_CODE: "Room code not found. Double-check the code and try again.",
  ROOM_FULL: "This room is full and cannot accept more players.",
  ROOM_CODE_EXPIRED: "This room is no longer available.",
  RACE_ALREADY_STARTED: "This race has already started.",
  ACTIVE_RACE_EXISTS: "You're already in an active race. Finish or leave it first.",
  RACE_ALREADY_FORFEITED: "You previously forfeited from this race.",
  CASH_CHALLENGE_CONSENT_REQUIRED: "Please confirm the cash challenge terms before joining.",
};

const CONSENT_LINES = [
  "I understand this is a skill-based race. My result depends entirely on my activity performance — outcomes are not based on chance.",
  "I understand that entry fees are charged when the race begins. If I leave the lobby before the race starts, no fee is charged.",
  "I have read and agree to the Walk Champ Challenge Rules & Terms of Service.",
];

interface RoomPreview {
  id: string;
  entryAmountCents: number;
  maxPlayers: number;
  targetSteps: number;
  currentPlayers: number;
  status: string;
}

export default function JoinByCode() {
  const { code } = useLocalSearchParams<{ code: string }>();
  const colors = useColors();
  const { safeTop, safeBottom } = useSafeLayout();
  const { setActiveRace, joinRace } = useRace();

  const [resolving, setResolving] = useState(true);
  const [room, setRoom] = useState<RoomPreview | null>(null);
  const [resolveError, setResolveError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [checks, setChecks] = useState([false, false, false]);
  const allChecked = checks.every(Boolean);

  const normalizedCode = String(code ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");

  const isCash = (room?.entryAmountCents ?? 0) > 0;

  // Resolve room details on mount
  useEffect(() => {
    if (!normalizedCode) return;
    void (async () => {
      setResolving(true);
      try {
        const res = await authFetch(`/api/races/by-code/${encodeURIComponent(normalizedCode)}`);
        const data = await res.json();
        if (!res.ok) {
          setResolveError(
            ERROR_MESSAGES[data.code as string] ?? data.error ?? "Could not load room details.",
          );
          return;
        }
        setRoom(data.room as RoomPreview);
      } catch {
        setResolveError("Network error. Please try again.");
      } finally {
        setResolving(false);
      }
    })();
  }, [normalizedCode]);

  const handleJoin = async () => {
    if (loading || !normalizedCode) return;
    if (isCash && !allChecked) return;
    setJoinError(null);
    setLoading(true);
    try {
      const body: Record<string, unknown> = { code: normalizedCode };
      if (isCash) {
        body.acceptedCashChallengeConsent = true;
        body.acceptedRulesVersion = CASH_RULES_VERSION;
      }
      const res = await authFetch(`/api/races/join-with-code`, {
        method: "POST",
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setJoinError(
          ERROR_MESSAGES[data.code as string] ??
          data.error ??
          "Failed to join. Please try again.",
        );
        return;
      }
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      const roomId: string = data.room_id;
      const entryFee: number = data.entry_fee ?? 0;
      const maxPlayers: number = data.max_players ?? 10;
      setActiveRace(roomId, false);
      joinRace(entryFee, maxPlayers, false);
      router.replace({
        pathname: "/race/matchmaking",
        params: { raceId: roomId, isHost: "false" },
      });
    } catch {
      setJoinError("Network error. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const toggleCheck = (i: number) =>
    setChecks((prev) => prev.map((v, idx) => (idx === i ? !v : v)));

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <LinearGradient colors={["#A855F712", "transparent"]} style={styles.glow} />

      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: safeTop + 32, paddingBottom: safeBottom + 32 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.trophy}>🏆</Text>
        <Text style={[styles.title, { color: colors.foreground }]}>Walk Champ Invite</Text>
        <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
          You've been invited to join a private walking challenge!
        </Text>

        <View style={[styles.codeBox, { backgroundColor: "#A855F715", borderColor: "#A855F740" }]}>
          <Text style={[styles.codeLabel, { color: colors.mutedForeground }]}>Room Code</Text>
          <Text style={styles.codeValue}>{normalizedCode}</Text>
        </View>

        {/* Room resolve state */}
        {resolving && (
          <View style={styles.loadingRow}>
            <ActivityIndicator size="small" color="#A855F7" />
            <Text style={[styles.loadingText, { color: colors.mutedForeground }]}>Loading room details…</Text>
          </View>
        )}

        {resolveError && (
          <ErrorBox message={resolveError} colors={colors} />
        )}

        {/* Room details summary */}
        {room && !resolveError && (
          <View style={[styles.summaryBox, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <SummaryRow label="Entry Fee" value={room.entryAmountCents > 0 ? `$${(room.entryAmountCents / 100).toFixed(2)}` : "Free"} valueStyle={room.entryAmountCents > 0 ? { color: "#3B82F6", fontWeight: "700" as const } : {}} colors={colors} />
            <SummaryRow label="Target Steps" value={`${room.targetSteps.toLocaleString()} steps`} colors={colors} />
            <SummaryRow label="Players" value={`${room.currentPlayers}/${room.maxPlayers}`} colors={colors} />
          </View>
        )}

        {/* Consent section — only for cash challenges */}
        {isCash && room && !resolveError && (
          <>
            <Text style={[styles.consentHeader, { color: colors.foreground }]}>Confirm Challenge Entry</Text>
            <Text style={[styles.consentSub, { color: colors.mutedForeground }]}>
              Please confirm all of the following:
            </Text>
            {CONSENT_LINES.map((line, i) => (
              <TouchableOpacity
                key={i}
                style={[styles.checkRow, { borderColor: colors.border, backgroundColor: colors.card }]}
                onPress={() => toggleCheck(i)}
                activeOpacity={0.7}
              >
                <View style={[
                  styles.checkbox,
                  { borderColor: checks[i] ? "#3B82F6" : colors.border, backgroundColor: checks[i] ? "#3B82F6" : "transparent" },
                ]}>
                  {checks[i] && <Feather name="check" size={12} color="#FFF" />}
                </View>
                <Text style={[styles.checkText, { color: colors.foreground }]}>{line}</Text>
              </TouchableOpacity>
            ))}
          </>
        )}

        {joinError && <ErrorBox message={joinError} colors={colors} />}

        {/* Join button */}
        {room && !resolveError && (
          <TouchableOpacity
            style={[styles.joinBtn, { opacity: loading || (isCash && !allChecked) ? 0.55 : 1 }]}
            onPress={handleJoin}
            activeOpacity={0.85}
            disabled={loading || (isCash && !allChecked)}
          >
            <LinearGradient
              colors={["#A855F7", "#7C3AED"]}
              style={styles.joinGradient}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
            >
              {loading ? (
                <ActivityIndicator size="small" color="#FFF" />
              ) : (
                <Feather name="log-in" size={20} color="#FFF" />
              )}
              <Text style={styles.joinBtnText}>
                {loading ? "Joining…" : isCash ? "Confirm & Join" : "Join Room"}
              </Text>
            </LinearGradient>
          </TouchableOpacity>
        )}

        {isCash && (
          <Text style={[styles.legalNote, { color: colors.mutedForeground }]}>
            Walk Champ is a skill-based race platform. Results are determined by your activity performance — not by chance.
          </Text>
        )}

        <TouchableOpacity
          style={[styles.cancelBtn, { borderColor: colors.border }]}
          onPress={() => router.replace("/(tabs)/walk")}
        >
          <Text style={[styles.cancelText, { color: colors.mutedForeground }]}>Go to Home</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

function SummaryRow({
  label,
  value,
  valueStyle,
  colors,
}: {
  label: string;
  value: string;
  valueStyle?: object;
  colors: ReturnType<typeof useColors>;
}) {
  return (
    <View style={styles.summaryRow}>
      <Text style={[styles.summaryLabel, { color: colors.mutedForeground }]}>{label}</Text>
      <Text style={[styles.summaryValue, { color: colors.foreground }, valueStyle]}>{value}</Text>
    </View>
  );
}

function ErrorBox({ message, colors }: { message: string; colors: ReturnType<typeof useColors> }) {
  return (
    <View style={[styles.errorBox, { backgroundColor: colors.destructive + "15", borderColor: colors.destructive + "40" }]}>
      <Feather name="alert-circle" size={14} color={colors.destructive} />
      <Text style={[styles.errorText, { color: colors.destructive }]}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  glow: { position: "absolute", top: 0, left: 0, right: 0, height: 300 },
  content: {
    padding: 24,
    alignItems: "center",
    justifyContent: "center",
    gap: 16,
  },
  trophy: { fontSize: 56, textAlign: "center" },
  title: { fontSize: 26, fontWeight: "800", textAlign: "center", letterSpacing: -0.5 },
  subtitle: { fontSize: 14, textAlign: "center", lineHeight: 20, maxWidth: 280 },
  codeBox: { borderRadius: 16, borderWidth: 1.5, padding: 20, alignItems: "center", gap: 6, width: "100%" },
  codeLabel: { fontSize: 11, letterSpacing: 1, textTransform: "uppercase" },
  codeValue: { fontSize: 42, fontWeight: "900", letterSpacing: 7, color: "#A855F7" },
  loadingRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  loadingText: { fontSize: 13 },
  summaryBox: { width: "100%", borderRadius: 12, borderWidth: 1, padding: 14, gap: 8 },
  summaryRow: { flexDirection: "row", justifyContent: "space-between" },
  summaryLabel: { fontSize: 13 },
  summaryValue: { fontSize: 13, fontWeight: "600" },
  consentHeader: { fontSize: 18, fontWeight: "800", alignSelf: "flex-start" },
  consentSub: { fontSize: 13, alignSelf: "flex-start" },
  checkRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    borderRadius: 10,
    borderWidth: 1,
    padding: 12,
    width: "100%",
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 5,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 1,
    flexShrink: 0,
  },
  checkText: { fontSize: 13, lineHeight: 19, flex: 1 },
  errorBox: { flexDirection: "row", alignItems: "center", gap: 8, borderRadius: 10, borderWidth: 1, padding: 12, width: "100%" },
  errorText: { flex: 1, fontSize: 13, lineHeight: 18 },
  joinBtn: { width: "100%", borderRadius: 14, overflow: "hidden" },
  joinGradient: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, paddingVertical: 16 },
  joinBtnText: { fontSize: 17, fontWeight: "700", color: "#FFF" },
  cancelBtn: { width: "100%", borderRadius: 12, borderWidth: 1, paddingVertical: 14, alignItems: "center" },
  cancelText: { fontSize: 15, fontWeight: "600" },
  legalNote: { fontSize: 11, textAlign: "center", lineHeight: 16 },
});
