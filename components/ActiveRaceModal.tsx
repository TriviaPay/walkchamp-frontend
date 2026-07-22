import React from "react";
import {
  View,
  Text,
  Modal,
  StyleSheet,
  ActivityIndicator,
  TouchableOpacity,
} from "react-native";
import { Feather } from "@expo/vector-icons";

export interface ActiveRaceInfo {
  room_id: string;
  room_status: string;
  challenge_type: string;
  /** Present on updated backends — "sponsored" means this should not block hosting. */
  room_type?: string;
  is_sponsored?: boolean;
  entry_fee: number;
  target_steps: number;
  current_user_role: string;
  can_leave: boolean;
  next_screen: string;
  scheduled_start_at?: string | null;
  started_at?: string | null;
  max_players?: number;
  registered_count?: number;
  /** CamelCase aliases some APIs may return — normalized via normalizeActiveRaceInfo. */
  participantCount?: number;
  maxParticipants?: number;
  startedAt?: string | null;
  scheduledStartAt?: string | null;
  currentPlayers?: number;
  maxPlayers?: number;
}

/** Normalize snake_case / camelCase active-race payloads into ActiveRaceInfo. */
export function normalizeActiveRaceInfo(
  raw: Partial<ActiveRaceInfo> & Record<string, unknown>,
): ActiveRaceInfo {
  const registered =
    (typeof raw.registered_count === "number" ? raw.registered_count : undefined) ??
    (typeof raw.participantCount === "number" ? raw.participantCount : undefined) ??
    (typeof raw.currentPlayers === "number" ? raw.currentPlayers : undefined);
  const max =
    (typeof raw.max_players === "number" ? raw.max_players : undefined) ??
    (typeof raw.maxParticipants === "number" ? raw.maxParticipants : undefined) ??
    (typeof raw.maxPlayers === "number" ? raw.maxPlayers : undefined);
  const started =
    (typeof raw.started_at === "string" ? raw.started_at : null) ??
    (typeof raw.startedAt === "string" ? raw.startedAt : null) ??
    null;
  const scheduled =
    (typeof raw.scheduled_start_at === "string" ? raw.scheduled_start_at : null) ??
    (typeof raw.scheduledStartAt === "string" ? raw.scheduledStartAt : null) ??
    null;

  return {
    room_id: String(raw.room_id ?? ""),
    room_status: String(raw.room_status ?? "in_progress"),
    challenge_type: String(raw.challenge_type ?? "free"),
    room_type: typeof raw.room_type === "string" ? raw.room_type : undefined,
    is_sponsored: raw.is_sponsored === true,
    entry_fee: typeof raw.entry_fee === "number" ? raw.entry_fee : 0,
    target_steps: typeof raw.target_steps === "number" ? raw.target_steps : 0,
    current_user_role: String(raw.current_user_role ?? "participant"),
    can_leave: raw.can_leave !== false,
    next_screen: String(raw.next_screen ?? "race_track"),
    scheduled_start_at: scheduled,
    started_at: started,
    max_players: max,
    registered_count: registered,
  };
}

/** True when the "active race" conflict is only a sponsored event (should not block host). */
export function isSponsoredActiveRaceConflict(info: {
  room_id?: string;
  room_type?: string;
  is_sponsored?: boolean;
  challenge_type?: string;
} | null | undefined, sponsoredRacingId?: string | null): boolean {
  if (!info) return false;
  if (info.is_sponsored === true || info.room_type === "sponsored") return true;
  if (sponsoredRacingId && info.room_id === sponsoredRacingId) return true;
  return false;
}

interface ActiveRaceModalProps {
  visible: boolean;
  activeRace: ActiveRaceInfo | null;
  leaving: boolean;
  onStay: () => void;
  onLeaveAndContinue: () => void;
  onCancel: () => void;
}

function challengeLabel(info: ActiveRaceInfo): string {
  if (info.challenge_type === "coins_battle") return "Coins Battle";
  if (info.entry_fee === 0) return "Free Challenge";
  return `$${info.entry_fee.toFixed(2)} Challenge`;
}

function formatStartTime(iso: string | null | undefined): string {
  if (!iso) return "…";
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "…";
    const datePart = d.toLocaleDateString([], {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
    const timePart = d.toLocaleTimeString([], {
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
    });
    return `${datePart} • ${timePart}`;
  } catch {
    return "…";
  }
}

function formatParticipants(info: ActiveRaceInfo): string {
  const count =
    (typeof info.registered_count === "number" ? info.registered_count : undefined) ??
    (typeof info.participantCount === "number" ? info.participantCount : undefined) ??
    (typeof info.currentPlayers === "number" ? info.currentPlayers : undefined);
  const max =
    (typeof info.max_players === "number" ? info.max_players : undefined) ??
    (typeof info.maxParticipants === "number" ? info.maxParticipants : undefined) ??
    (typeof info.maxPlayers === "number" ? info.maxPlayers : undefined);
  if (typeof count === "number" && typeof max === "number" && max > 0) {
    return `${count} / ${max}`;
  }
  if (typeof count === "number") return String(count);
  return "Not available";
}

function DetailRow({
  icon,
  label,
  value,
  valueColor,
  showDivider,
}: {
  icon: React.ComponentProps<typeof Feather>["name"];
  label: string;
  value: string;
  valueColor?: string;
  showDivider?: boolean;
}) {
  return (
    <>
      <View style={styles.detailRow}>
        <View style={styles.detailLeft}>
          <Feather name={icon} size={14} color="#5A6A8A" />
          <Text style={styles.detailLabel}>{label}</Text>
        </View>
        <Text style={[styles.detailValue, valueColor ? { color: valueColor } : null]}>
          {value}
        </Text>
      </View>
      {showDivider ? <View style={styles.detailDivider} /> : null}
    </>
  );
}

export default function ActiveRaceModal({
  visible,
  activeRace,
  leaving,
  onStay,
  onLeaveAndContinue,
  onCancel,
}: ActiveRaceModalProps) {
  const isWaiting =
    activeRace?.room_status === "open" || activeRace?.room_status === "full";

  const label = activeRace ? challengeLabel(activeRace) : "Challenge";

  const title = isWaiting
    ? "You're already in a waiting room"
    : "You're already in a race";

  const message = isWaiting
    ? "You are waiting in another room. Go back to your room, or leave it to join a different challenge."
    : `You are currently racing in a ${label}. Quitting removes you from this race only — other players will continue.`;

  const role = activeRace?.current_user_role === "host" ? "Host" : "Participant";
  // Prefer actual start, then scheduled start.
  const startIso = activeRace?.started_at ?? activeRace?.scheduled_start_at ?? null;
  const participants = activeRace ? formatParticipants(activeRace) : "Not available";

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
            disabled={leaving}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Feather name="x" size={20} color="#5A6A8A" />
          </TouchableOpacity>

          <View style={styles.iconRow}>
            <View style={styles.iconBadge}>
              <Feather name="alert-triangle" size={24} color="#FF6B35" />
            </View>
          </View>

          <Text style={styles.title}>{title}</Text>
          <Text style={styles.message}>{message}</Text>

          {activeRace ? (
            <View style={styles.details}>
              <DetailRow icon="award" label="Challenge" value={label} valueColor="#00E676" showDivider />
              <DetailRow
                icon="target"
                label="Target"
                value={`${activeRace.target_steps.toLocaleString()} steps`}
                showDivider
              />
              <DetailRow icon="user" label="Your Role" value={role} showDivider />
              <DetailRow
                icon="calendar"
                label="Start Time"
                value={formatStartTime(startIso)}
                showDivider
              />
              <DetailRow icon="users" label="Participants" value={participants} />
            </View>
          ) : null}

          <View style={styles.buttonStack}>
            <TouchableOpacity
              style={styles.primaryBtn}
              onPress={onStay}
              disabled={leaving}
              activeOpacity={0.8}
            >
              <Feather
                name={isWaiting ? "clock" : "play-circle"}
                size={17}
                color="#000"
                style={styles.btnIcon}
              />
              <Text style={styles.primaryBtnText}>
                {isWaiting ? "Go Back to Waiting Room" : "Go Back to Race"}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.dangerBtn, leaving && styles.disabledBtn]}
              onPress={onLeaveAndContinue}
              disabled={leaving}
              activeOpacity={0.8}
            >
              {leaving ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <>
                  <Feather
                    name="log-out"
                    size={17}
                    color="#fff"
                    style={styles.btnIcon}
                  />
                  <Text style={styles.dangerBtnText}>
                    {isWaiting ? "Leave Room" : "Quit Race (Forfeit)"}
                  </Text>
                </>
              )}
            </TouchableOpacity>
          </View>
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
  buttonStack: {
    gap: 10,
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
  dangerBtn: {
    backgroundColor: "#E53935",
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "center",
  },
  disabledBtn: {
    opacity: 0.55,
  },
  dangerBtnText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "700",
  },
  btnIcon: {
    marginRight: 8,
  },
});
