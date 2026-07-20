import React, { useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { getValidSession } from "@/services/authService";
import { getApiBase } from "@/utils/apiUrl";
import { AppAlert } from "@/components/AppAlert";

const CASH_RULES_VERSION = "2026-06";

export interface JoinWithCodeParticipant {
  id: string;
  userId: string;
  username: string;
  country: string | null;
  countryFlag: string | null;
  avatarColor: string | null;
  avatarUrl: string | null;
  avatarVersion: number;
  isHost: boolean;
  isCurrentUser: boolean;
  friendStatus: string;
  friendRequestId: string | null;
  activeTitle: { code: string; title: string } | null;
  currentSteps: number;
}

export interface JoinWithCodeResult {
  room_id: string;
  entry_fee: number;
  max_players: number;
  participants: JoinWithCodeParticipant[];
}

interface RoomPreview {
  id: string;
  entryAmountCents: number;
  maxPlayers: number;
  targetSteps: number;
  currentPlayers: number;
  status: string;
  inviteCode: string;
}

interface Props {
  visible: boolean;
  onClose: () => void;
  onJoined: (result: JoinWithCodeResult) => void;
}

const JOIN_ERROR: Record<string, string> = {
  INVALID_ROOM_CODE: "Invalid room code. Double-check and try again.",
  ROOM_CODE_EXPIRED: "This room code has expired.",
  ROOM_FULL: "This room is full.",
  RACE_ALREADY_STARTED: "This race has already started.",
  ACTIVE_RACE_EXISTS: "You are already in an active race. Leave it first.",
  RACE_ALREADY_FORFEITED: "You already quit this race and cannot rejoin.",
  CASH_CHALLENGE_CONSENT_REQUIRED: "Please confirm the cash challenge terms before joining.",
};

type Step = "enter" | "consent";

export default function JoinWithCodeModal({ visible, onClose, onJoined }: Props) {
  const colors = useColors();
  const [step, setStep] = useState<Step>("enter");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [roomPreview, setRoomPreview] = useState<RoomPreview | null>(null);
  const [checks, setChecks] = useState([false, false, false]);
  const allChecked = checks.every(Boolean);

  const reset = () => {
    setStep("enter");
    setCode("");
    setError(null);
    setRoomPreview(null);
    setChecks([false, false, false]);
    setLoading(false);
  };

  const handleClose = () => {
    if (loading) return;
    reset();
    onClose();
  };

  const toggleCheck = (i: number) =>
    setChecks((prev) => prev.map((v, idx) => (idx === i ? !v : v)));

  // Step 1: resolve room details (peek without joining)
  const handleResolve = async () => {
    const trimmed = code.trim().toUpperCase();
    if (!trimmed) { setError("Please enter a room code."); return; }
    setLoading(true);
    setError(null);
    try {
      const session = await getValidSession();
      if (!session) { AppAlert.alert("Error", "Please sign in again."); return; }

      const res = await fetch(`${getApiBase()}/api/races/by-code/${encodeURIComponent(trimmed)}`, {
        headers: { Authorization: `Bearer ${session}` },
      });
      const data = await res.json() as Record<string, unknown>;

      if (!res.ok) {
        const msg = JOIN_ERROR[(data.code as string) ?? ""] ?? (data.error as string) ?? "Could not resolve room.";
        setError(msg);
        return;
      }

      const room = data.room as RoomPreview;
      // If it's a cash challenge, show consent step
      if (room.entryAmountCents > 0) {
        setRoomPreview(room);
        setStep("consent");
      } else {
        // Free room — join immediately
        await doJoin(trimmed, false, session);
      }
    } catch {
      setError("Connection error. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  // Step 2: join (with or without consent)
  const doJoin = async (roomCode: string, withConsent: boolean, sessionToken?: string) => {
    setLoading(true);
    setError(null);
    try {
      const session = sessionToken ?? (await getValidSession());
      if (!session) { AppAlert.alert("Error", "Please sign in again."); return; }

      const body: Record<string, unknown> = { code: roomCode };
      if (withConsent) {
        body.acceptedCashChallengeConsent = true;
        body.acceptedRulesVersion = CASH_RULES_VERSION;
      }

      const res = await fetch(`${getApiBase()}/api/races/join-with-code`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session}` },
        body: JSON.stringify(body),
      });
      const data = await res.json() as Record<string, unknown>;

      if (!res.ok) {
        const errCode = (data.code as string) ?? "";
        const msg = JOIN_ERROR[errCode] ?? (data.error as string) ?? (data.message as string) ?? "Could not join room.";
        setError(msg);
        return;
      }

      reset();
      onJoined({
        room_id: data.room_id as string,
        entry_fee: (data.entry_fee as number) ?? 0,
        max_players: (data.max_players as number) ?? 10,
        participants: Array.isArray(data.participants)
          ? (data.participants as JoinWithCodeParticipant[])
          : [],
      });
    } catch {
      setError("Connection error. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleConfirmConsent = async () => {
    if (!allChecked || !roomPreview) return;
    await doJoin(code.trim().toUpperCase(), true);
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={handleClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={styles.overlay}
      >
        {step === "enter" ? (
          <View style={[styles.sheet, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={[styles.handle, { backgroundColor: colors.border }]} />
            <View style={[styles.iconCircle, { backgroundColor: "#A855F720" }]}>
              <Feather name="lock" size={26} color="#A855F7" />
            </View>
            <Text style={[styles.title, { color: colors.foreground }]}>Join Private Room</Text>
            <Text style={[styles.sub, { color: colors.mutedForeground }]}>
              Enter the room code shared by the host.
            </Text>
            <View
              style={[
                styles.inputWrap,
                { borderColor: error ? "#EF4444" : colors.border, backgroundColor: colors.background },
              ]}
            >
              <TextInput
                style={[styles.input, { color: colors.foreground }]}
                placeholder="Room Code (e.g. K7M9Q2)"
                placeholderTextColor={colors.mutedForeground}
                value={code}
                onChangeText={(t) => { setCode(t.toUpperCase()); setError(null); }}
                autoCapitalize="characters"
                autoCorrect={false}
                maxLength={12}
                editable={!loading}
                returnKeyType="go"
                onSubmitEditing={handleResolve}
              />
            </View>
            {error ? (
              <View style={styles.errorRow}>
                <Feather name="alert-circle" size={13} color="#EF4444" />
                <Text style={styles.errorText}>{error}</Text>
              </View>
            ) : null}
            <View style={styles.btnRow}>
              <TouchableOpacity
                style={[styles.btn, styles.btnCancel, { borderColor: colors.border }]}
                onPress={handleClose}
                activeOpacity={0.7}
                disabled={loading}
              >
                <Text style={[styles.btnCancelText, { color: colors.mutedForeground }]}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.btn, styles.btnJoin, { opacity: loading || !code.trim() ? 0.6 : 1 }]}
                onPress={handleResolve}
                activeOpacity={0.8}
                disabled={loading || !code.trim()}
              >
                {loading ? (
                  <ActivityIndicator size="small" color="#FFF" />
                ) : (
                  <Text style={styles.btnJoinText}>Join Room</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          /* Consent step for cash challenges */
          <View style={[styles.sheet, styles.sheetTall, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={[styles.handle, { backgroundColor: colors.border }]} />
            <Text style={[styles.title, { color: colors.foreground }]}>Confirm Challenge Entry</Text>

            {/* Room summary */}
            <View style={[styles.summaryBox, { backgroundColor: colors.background, borderColor: colors.border }]}>
              <SummaryRow label="Challenge" value="Private Cash Challenge" colors={colors} />
              <SummaryRow
                label="Entry Fee"
                value={`$${((roomPreview?.entryAmountCents ?? 0) / 100).toFixed(2)}`}
                valueStyle={{ color: "#3B82F6", fontWeight: "700" }}
                colors={colors}
              />
              <SummaryRow label="Type" value="Skill-based race" colors={colors} />
            </View>

            <Text style={[styles.confirmLabel, { color: colors.mutedForeground }]}>
              Please confirm all of the following:
            </Text>

            <ScrollView style={{ width: "100%" }} showsVerticalScrollIndicator={false}>
              {CONSENT_LINES.map((line, i) => (
                <TouchableOpacity
                  key={i}
                  style={[styles.checkRow, { borderColor: colors.border, backgroundColor: colors.background }]}
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
            </ScrollView>

            {error ? (
              <View style={styles.errorRow}>
                <Feather name="alert-circle" size={13} color="#EF4444" />
                <Text style={styles.errorText}>{error}</Text>
              </View>
            ) : null}

            <TouchableOpacity
              style={[styles.btn, styles.btnConfirm, { opacity: allChecked && !loading ? 1 : 0.45 }]}
              onPress={handleConfirmConsent}
              disabled={!allChecked || loading}
              activeOpacity={0.85}
            >
              {loading ? (
                <ActivityIndicator size="small" color="#FFF" />
              ) : (
                <>
                  <Feather name="check-circle" size={16} color="#FFF" />
                  <Text style={styles.btnJoinText}>Confirm &amp; Continue</Text>
                </>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.btn, styles.btnCancel, { borderColor: colors.border }]}
              onPress={() => { setStep("enter"); setError(null); }}
              disabled={loading}
              activeOpacity={0.7}
            >
              <Text style={[styles.btnCancelText, { color: colors.mutedForeground }]}>Cancel</Text>
            </TouchableOpacity>

            <Text style={[styles.legalNote, { color: colors.mutedForeground }]}>
              Walk Champ is a skill-based race platform. Results are determined by your activity performance — not by chance.
            </Text>
          </View>
        )}
      </KeyboardAvoidingView>
    </Modal>
  );
}

const CONSENT_LINES = [
  "I understand this is a skill-based race. My result depends entirely on my activity performance — outcomes are not based on chance.",
  "I understand that entry fees are charged when the race begins. If I leave the lobby before the race starts, no fee is charged.",
  "I have read and agree to the Walk Champ Challenge Rules & Terms of Service.",
];

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

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.65)",
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  sheet: {
    width: "100%",
    maxWidth: 420,
    borderRadius: 20,
    borderWidth: 1,
    padding: 24,
    alignItems: "center",
    gap: 12,
  },
  sheetTall: {
    maxHeight: "90%",
  },
  handle: { width: 40, height: 4, borderRadius: 2, marginBottom: 4 },
  iconCircle: {
    width: 60,
    height: 60,
    borderRadius: 30,
    alignItems: "center",
    justifyContent: "center",
  },
  title: { fontSize: 20, fontWeight: "800", textAlign: "center" },
  sub: { fontSize: 14, textAlign: "center", lineHeight: 20 },
  inputWrap: {
    width: "100%",
    borderWidth: 1.5,
    borderRadius: 12,
    paddingHorizontal: 14,
    height: 50,
    justifyContent: "center",
    marginTop: 2,
  },
  input: { fontSize: 18, fontWeight: "700", letterSpacing: 3 },
  errorRow: { flexDirection: "row", alignItems: "center", gap: 5, alignSelf: "flex-start" },
  errorText: { fontSize: 12, color: "#EF4444", flex: 1 },
  btnRow: { flexDirection: "row", gap: 10, width: "100%", marginTop: 4 },
  btn: {
    flex: 1,
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 48,
    flexDirection: "row",
    gap: 6,
  },
  btnCancel: { borderWidth: 1 },
  btnCancelText: { fontSize: 15, fontWeight: "600" },
  btnJoin: { backgroundColor: "#A855F7" },
  btnConfirm: { backgroundColor: "#3B82F6", width: "100%" },
  btnJoinText: { fontSize: 15, fontWeight: "700", color: "#FFF" },
  summaryBox: {
    width: "100%",
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
    gap: 6,
  },
  summaryRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  summaryLabel: { fontSize: 13 },
  summaryValue: { fontSize: 13, fontWeight: "600" },
  confirmLabel: { fontSize: 13, alignSelf: "flex-start" },
  checkRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    borderRadius: 10,
    borderWidth: 1,
    padding: 12,
    marginBottom: 8,
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
  legalNote: { fontSize: 11, textAlign: "center", lineHeight: 16 },
});
