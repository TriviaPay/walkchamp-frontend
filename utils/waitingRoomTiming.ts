/**
 * Shared Waiting Room timing / messaging for regular challenges
 * (Free, Coins, Cash, Create Public/Private). Not for Sponsored Events.
 */

export const WAITING_ROOM_OPEN_WINDOW_MS = 30 * 60 * 1000;
export const WAITING_ROOM_GET_READY_WINDOW_MS = 30 * 60 * 1000;
/** Fallback when backend does not return minimumParticipants. */
export const DEFAULT_MINIMUM_PARTICIPANTS = 2;

export type WaitingRoomMode = "scheduled" | "open_window";

export type WaitingRoomBannerKind =
  | "scheduled_far"
  | "scheduled_soon"
  | "scheduled_starting"
  | "open_waiting"
  | "open_ready";

export type WaitingRoomBanner = {
  kind: WaitingRoomBannerKind;
  title: string;
  message: string;
};

export function isFutureScheduledStart(
  scheduledStartAt: string | null | undefined,
  nowMs: number = Date.now(),
): boolean {
  if (!scheduledStartAt) return false;
  const t = new Date(scheduledStartAt).getTime();
  return Number.isFinite(t) && t > nowMs;
}

export function resolveWaitingRoomMode(
  scheduledStartAt: string | null | undefined,
  nowMs: number = Date.now(),
): WaitingRoomMode {
  // Past or present scheduledStartAt still counts as "scheduled" mode until
  // the room transitions to active/cancelled — so we never apply the 30-min
  // open-window expiry to scheduled rooms.
  if (!scheduledStartAt) return "open_window";
  const t = new Date(scheduledStartAt).getTime();
  if (!Number.isFinite(t)) return "open_window";
  return "scheduled";
}

/**
 * Authoritative expiry for non-scheduled (open_window) rooms.
 * Prefer backend roomExpiresAt; otherwise createdAt + 30 minutes.
 * Scheduled rooms return null (they expire at scheduledStartAt via backend).
 */
export function resolveRoomExpiresAt(opts: {
  mode: WaitingRoomMode;
  roomExpiresAt?: string | null;
  createdAt?: string | null;
}): Date | null {
  if (opts.mode !== "open_window") return null;

  if (opts.roomExpiresAt) {
    const d = new Date(opts.roomExpiresAt);
    if (Number.isFinite(d.getTime())) return d;
  }
  if (opts.createdAt) {
    const created = new Date(opts.createdAt).getTime();
    if (Number.isFinite(created)) {
      return new Date(created + WAITING_ROOM_OPEN_WINDOW_MS);
    }
  }
  return null;
}

export function resolveRacePlayerCount(race: Record<string, unknown> | null | undefined): number {
  if (!race) return 0;
  const candidates = [
    race.registered_count,
    race.registeredCount,
    race.currentPlayers,
    race.current_players,
    race.participantCount,
    race.participant_count,
    race.joinedCount,
    race.joined_count,
    race.playersJoined,
    race.players_joined,
  ];
  for (const value of candidates) {
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
      return Math.floor(value);
    }
    if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) {
      const n = Number(value);
      if (n >= 0) return Math.floor(n);
    }
  }
  return 0;
}

export function resolveMinimumParticipants(
  value: number | null | undefined,
): number {
  if (typeof value === "number" && Number.isFinite(value) && value >= 2) {
    return Math.floor(value);
  }
  return DEFAULT_MINIMUM_PARTICIPANTS;
}

export function playersNeeded(
  minimumParticipants: number,
  participantCount: number,
): number {
  return Math.max(minimumParticipants - Math.max(0, participantCount), 0);
}

export function formatRemainingMmSs(msRemaining: number): string {
  const clamped = Math.max(0, Math.floor(msRemaining / 1000));
  const m = Math.floor(clamped / 60);
  const s = clamped % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function getWaitingRoomBanner(opts: {
  mode: WaitingRoomMode;
  status?: string | null;
  scheduledStartAt?: string | null;
  roomExpiresAt?: Date | null;
  participantCount: number;
  minimumParticipants: number;
  nowMs?: number;
}): WaitingRoomBanner {
  const now = opts.nowMs ?? Date.now();
  const status = (opts.status ?? "").toLowerCase();

  if (status === "starting") {
    return {
      kind: "scheduled_starting",
      title: "Starting race…",
      message: "Please wait while we prepare your race.",
    };
  }

  if (opts.mode === "scheduled") {
    const startMs = opts.scheduledStartAt
      ? new Date(opts.scheduledStartAt).getTime()
      : NaN;
    if (Number.isFinite(startMs)) {
      const remaining = startMs - now;
      if (remaining > WAITING_ROOM_GET_READY_WINDOW_MS) {
        return {
          kind: "scheduled_far",
          title: "No need to stay here.",
          message: "We'll notify you when the race starts.",
        };
      }
      if (remaining > 0) {
        return {
          kind: "scheduled_soon",
          title: "Get ready!",
          message:
            "Your race is starting soon. Make sure your step tracking is connected and be ready at the scheduled time.",
        };
      }
      return {
        kind: "scheduled_starting",
        title: "Starting race…",
        message: "Please wait while we prepare your race.",
      };
    }
    return {
      kind: "scheduled_far",
      title: "No need to stay here.",
      message: "We'll notify you when the race starts.",
    };
  }

  // open_window
  const needed = playersNeeded(opts.minimumParticipants, opts.participantCount);
  const remainingMs = opts.roomExpiresAt
    ? opts.roomExpiresAt.getTime() - now
    : null;
  const remainingLabel =
    remainingMs != null && remainingMs > 0
      ? formatRemainingMmSs(remainingMs)
      : null;

  if (needed > 0) {
    return {
      kind: "open_waiting",
      title: "Waiting for players",
      message: remainingLabel
        ? `The host can start the race once the minimum number of players joins. This room will close in ${remainingLabel}.`
        : "The host can start the race once the minimum number of players joins.",
    };
  }
  return {
    kind: "open_ready",
    title: "Minimum players reached",
    message: remainingLabel
      ? `The host can start the race now. This room will close in ${remainingLabel} if it is not started.`
      : "The host can start the race now. This room will close if it is not started.",
  };
}

export function cancellationCopy(
  reason?: string | null,
  mode?: WaitingRoomMode,
): {
  title: string;
  message: string;
} {
  const r = (reason ?? "").toUpperCase();
  if (
    r.includes("HOST_DID_NOT_START") ||
    (r.includes("EXPIRED") && !r.includes("MINIMUM"))
  ) {
    return {
      title: "Room Expired",
      message:
        "This Waiting Room expired because the race was not started within 30 minutes.",
    };
  }
  if (r.includes("MINIMUM") || r.includes("PARTICIPANT")) {
    return {
      title: "Room Cancelled",
      message:
        mode === "open_window"
          ? "The minimum number of players was not reached within 30 minutes. This room has been cancelled."
          : "The minimum number of players was not reached before the scheduled start time. This room has been cancelled.",
    };
  }
  if (r.includes("HOST_CANCEL")) {
    return {
      title: "Room Cancelled",
      message: "The host cancelled this race room.",
    };
  }
  if (mode === "scheduled") {
    return {
      title: "Room Cancelled",
      message:
        "The minimum number of players was not reached before the scheduled start time. This room has been cancelled.",
    };
  }
  return {
    title: "Room Cancelled",
    message:
      "The race was not started within 30 minutes, so this room has been cancelled.",
  };
}
