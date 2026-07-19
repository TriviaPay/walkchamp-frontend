import React from "react";
import {
  View,
  Text,
  Modal,
  StyleSheet,
  TouchableOpacity,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import type { ActiveRaceInfo } from "@/components/ActiveRaceModal";
import { formatLocalDate, formatLocalTime } from "@/utils/timezone";

export type RegisteredRaceInfo = ActiveRaceInfo & {
  scheduled_start_at?: string | null;
  max_players?: number;
  registered_count?: number;
};

interface AlreadyRegisteredModalProps {
  visible: boolean;
  race: RegisteredRaceInfo | null;
  /** Kept for call-site compatibility; withdraw UI removed from this modal. */
  withdrawing?: boolean;
  onGoToRace: () => void;
  onWithdraw?: () => void;
  onCancel: () => void;
}

function challengeLabel(info: RegisteredRaceInfo): string {
  if (info.challenge_type === "coins_battle") return "Coins Battle";
  if (info.entry_fee === 0) return "Free Challenge";
  return `$${info.entry_fee.toFixed(2)} Challenge`;
}

function formatStartTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return `${formatLocalDate(iso)}, ${formatLocalTime(iso)}`;
  } catch {
    return "—";
  }
}

export default function AlreadyRegisteredModal({
  visible,
  race,
  onGoToRace,
  onCancel,
}: AlreadyRegisteredModalProps) {
  const label = race ? challengeLabel(race) : "Challenge";
  const role = race?.current_user_role === "host" ? "Host" : "Participant";
  const participants =
    race && typeof race.registered_count === "number" && typeof race.max_players === "number"
      ? `${race.registered_count} / ${race.max_players}`
      : "—";

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onCancel}
    >
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <TouchableOpacity
            style={styles.closeBtn}
            onPress={onCancel}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Feather name="x" size={20} color="#5A6A8A" />
          </TouchableOpacity>

          <View style={styles.iconRow}>
            <View style={styles.iconBadge}>
              <Text style={styles.iconEmoji}>🏁</Text>
            </View>
          </View>

          <Text style={styles.title}>You&apos;re already registered for a race!</Text>
          <Text style={styles.message}>
            You are currently signed up for the race below. Only one race can be active at a time.
          </Text>

          {race ? (
            <View style={styles.details}>
              <View style={styles.detailRow}>
                <View style={styles.detailLeft}>
                  <Feather name="award" size={14} color="#5A6A8A" />
                  <Text style={styles.detailLabel}>Challenge</Text>
                </View>
                <Text style={[styles.detailValue, { color: "#00E676" }]}>{label}</Text>
              </View>
              <View style={styles.detailDivider} />
              <View style={styles.detailRow}>
                <View style={styles.detailLeft}>
                  <Feather name="target" size={14} color="#5A6A8A" />
                  <Text style={styles.detailLabel}>Target</Text>
                </View>
                <Text style={styles.detailValue}>
                  {race.target_steps.toLocaleString()} steps
                </Text>
              </View>
              <View style={styles.detailDivider} />
              <View style={styles.detailRow}>
                <View style={styles.detailLeft}>
                  <Feather name="user" size={14} color="#5A6A8A" />
                  <Text style={styles.detailLabel}>Your Role</Text>
                </View>
                <Text style={styles.detailValue}>{role}</Text>
              </View>
              <View style={styles.detailDivider} />
              <View style={styles.detailRow}>
                <View style={styles.detailLeft}>
                  <Feather name="calendar" size={14} color="#5A6A8A" />
                  <Text style={styles.detailLabel}>Start Time</Text>
                </View>
                <Text style={styles.detailValue}>
                  {formatStartTime(race.scheduled_start_at)}
                </Text>
              </View>
              <View style={styles.detailDivider} />
              <View style={styles.detailRow}>
                <View style={styles.detailLeft}>
                  <Feather name="users" size={14} color="#5A6A8A" />
                  <Text style={styles.detailLabel}>Participants</Text>
                </View>
                <Text style={styles.detailValue}>{participants}</Text>
              </View>
            </View>
          ) : null}

          <TouchableOpacity
            style={styles.primaryBtn}
            onPress={onGoToRace}
            activeOpacity={0.8}
          >
            <Feather name="log-in" size={17} color="#000" style={styles.btnIcon} />
            <Text style={styles.primaryBtnText}>Go to Race</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.82)",
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 24,
  },
  card: {
    backgroundColor: "#0F1117",
    borderRadius: 24,
    padding: 28,
    width: "100%",
    borderWidth: 1.5,
    borderColor: "rgba(255,107,53,0.35)",
    position: "relative",
  },
  closeBtn: {
    position: "absolute",
    top: 16,
    right: 16,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "#161A26",
    borderWidth: 1,
    borderColor: "#1E2230",
    justifyContent: "center",
    alignItems: "center",
    zIndex: 1,
  },
  iconRow: {
    alignItems: "center",
    marginBottom: 16,
    marginTop: 8,
  },
  iconBadge: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: "rgba(255,107,53,0.12)",
    borderWidth: 1,
    borderColor: "rgba(255,107,53,0.25)",
    justifyContent: "center",
    alignItems: "center",
  },
  iconEmoji: { fontSize: 26 },
  title: {
    color: "#FFFFFF",
    fontSize: 18,
    fontWeight: "700",
    textAlign: "center",
    marginBottom: 10,
    letterSpacing: -0.3,
  },
  message: {
    color: "#8B9BBE",
    fontSize: 14,
    textAlign: "center",
    lineHeight: 22,
    marginBottom: 20,
  },
  details: {
    backgroundColor: "#161A26",
    borderRadius: 12,
    paddingVertical: 4,
    paddingHorizontal: 14,
    marginBottom: 24,
  },
  detailRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 10,
    gap: 8,
  },
  detailLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  detailDivider: {
    height: 1,
    backgroundColor: "#1E2230",
  },
  detailLabel: {
    color: "#5A6A8A",
    fontSize: 13,
    fontWeight: "500",
  },
  detailValue: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "600",
    flexShrink: 1,
    textAlign: "right",
  },
  primaryBtn: {
    backgroundColor: "#00E676",
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "center",
  },
  primaryBtnText: {
    color: "#000000",
    fontSize: 16,
    fontWeight: "700",
  },
  btnIcon: {
    marginRight: 8,
  },
});
