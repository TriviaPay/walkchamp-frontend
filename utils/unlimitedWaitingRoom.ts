/**
 * Map Unlimited Challenge detail API → waiting-room race/participant shapes.
 */

import { UNLIMITED_GOAL_CHALLENGE_TYPE } from "@/utils/unlimitedGoal";
import { resolveMinimumParticipants } from "@/utils/waitingRoomTiming";

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function pick(obj: Record<string, unknown>, ...keys: string[]): unknown {
  for (const key of keys) {
    if (obj[key] !== undefined && obj[key] !== null) return obj[key];
  }
  return undefined;
}

function asString(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return null;
}

export type UnlimitedWaitingRoomMapped = {
  race: {
    id: string;
    currentPlayers: number;
    maxPlayers: number | null;
    status: string;
    targetSteps: number;
    entryType: string;
    entryAmountCents: number;
    coinEntryAmount: number;
    coinPrizePool: number;
    isPrivate: boolean;
    inviteCode: string | null;
    minimumParticipants: number;
    canStart: boolean | null;
    roomExpiresAt: string | null;
    createdAt: string | null;
    cancellationReason: string | null;
    scheduledStartAt: string | null;
    challengeType: string;
    capacityMode: "unlimited";
    startedAt: string | null;
  };
  participants: unknown[];
};

/** Normalize GET /api/unlimited-challenges/:id (or list row) into waiting-room poll shape. */
export function mapUnlimitedDetailToWaitingRoom(
  payload: unknown,
): UnlimitedWaitingRoomMapped | null {
  const root = asRecord(payload);
  if (!root) return null;

  const challenge =
    asRecord(pick(root, "challenge", "unlimitedChallenge", "data")) ?? root;

  const id = asString(
    pick(challenge, "id", "challengeId", "challenge_id", "room_id", "roomId"),
  );
  if (!id) return null;

  const entryFeeCents =
    asNumber(
      pick(challenge, "entryFeeCents", "entry_fee_cents", "entryAmountCents"),
    ) ?? 0;

  const visibility = asString(pick(challenge, "visibility"))?.toLowerCase();
  const isPrivate =
    (typeof pick(challenge, "isPrivate", "is_private") === "boolean"
      ? (pick(challenge, "isPrivate", "is_private") as boolean)
      : null) ??
    visibility === "private";

  const participantCount =
    asNumber(
      pick(
        challenge,
        "participantCount",
        "participant_count",
        "currentPlayers",
        "current_players",
        "registered_count",
      ),
    ) ?? 1;

  const startAt = asString(
    pick(
      challenge,
      "startAtUtc",
      "start_at_utc",
      "startAtIso",
      "scheduledStartAt",
      "scheduled_start_at",
    ),
  );

  const participantCollections = [
    pick(root, "participants", "registrations", "registeredParticipants", "members"),
    pick(challenge, "participants", "registrations", "registeredParticipants", "members"),
  ];
  const participants = participantCollections.flatMap((c) =>
    Array.isArray(c) ? c : [],
  );

  return {
    race: {
      id,
      currentPlayers: Math.max(participantCount, participants.length, 1),
      maxPlayers: null,
      status: asString(pick(challenge, "status", "room_status")) ?? "waiting",
      targetSteps:
        asNumber(
          pick(challenge, "dailyGoalSteps", "daily_goal_steps", "targetSteps", "target_steps"),
        ) ?? 0,
      entryType: UNLIMITED_GOAL_CHALLENGE_TYPE,
      entryAmountCents: entryFeeCents,
      coinEntryAmount: 0,
      coinPrizePool: 0,
      isPrivate: !!isPrivate,
      inviteCode: asString(pick(challenge, "inviteCode", "invite_code")),
      minimumParticipants: resolveMinimumParticipants(
        asNumber(
          pick(
            challenge,
            "minimumParticipants",
            "minimum_participants",
            "minParticipants",
            "min_players",
          ),
        ) ?? undefined,
      ),
      canStart:
        typeof pick(challenge, "canStart", "can_start") === "boolean"
          ? (pick(challenge, "canStart", "can_start") as boolean)
          : null,
      roomExpiresAt: asString(
        pick(challenge, "registrationClosesAtUtc", "registration_closes_at_utc"),
      ),
      createdAt: asString(pick(challenge, "createdAt", "created_at")),
      cancellationReason: asString(
        pick(challenge, "cancellationReason", "cancellation_reason"),
      ),
      scheduledStartAt: startAt,
      challengeType: UNLIMITED_GOAL_CHALLENGE_TYPE,
      capacityMode: "unlimited",
      startedAt: asString(pick(challenge, "startedAt", "started_at")),
    },
    participants,
  };
}
