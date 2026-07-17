/**
 * Participant-only live race notification eligibility.
 * Spectators / viewers / Pusher subscribers must never pass these checks.
 */

/** Terminal / non-racing statuses — never get ongoing live race progress notifications. */
export const LIVE_RACE_NOTIFICATION_INELIGIBLE_STATUSES = new Set([
  "left",
  "forfeited",
  "disqualified",
  "completed",
] as const);

export type RaceParticipantStatusLike =
  | "joined"
  | "active"
  | "completed"
  | "disqualified"
  | "left"
  | "forfeited"
  | string
  | null
  | undefined;

export type RaceParticipantIdentity = {
  userId?: string | null;
  username?: string | null;
  status?: RaceParticipantStatusLike;
};

/**
 * Active racing statuses. Missing/null status is treated as eligible when a
 * participant row exists (API default is "joined").
 */
export function isLiveRaceNotificationStatus(
  status: RaceParticipantStatusLike,
): boolean {
  if (status == null || status === "") return true;
  if (
    LIVE_RACE_NOTIFICATION_INELIGIBLE_STATUSES.has(
      status as "left" | "forfeited" | "disqualified" | "completed",
    )
  ) {
    return false;
  }
  return true;
}

/**
 * Notification eligibility requires exact userId match.
 * Username matching is intentionally NOT used — it can false-positive
 * and start participant-only race notifications for spectators.
 */
export function isSameRaceUserForNotifications(
  participant: RaceParticipantIdentity,
  user: { id?: string | null; username?: string | null } | null | undefined,
): boolean {
  if (!user?.id || !participant.userId) return false;
  return participant.userId === user.id;
}

/**
 * Find the current user's participant row only when they are eligible for
 * participant-only live race notifications.
 * Spectators (no row) and left/forfeited/DQ/completed return null.
 */
export function findEligibleLiveRaceParticipant<T extends RaceParticipantIdentity>(
  participants: T[] | null | undefined,
  user: { id?: string | null; username?: string | null } | null | undefined,
): T | null {
  if (!participants?.length || !user?.id) return null;
  const me = participants.find((p) => isSameRaceUserForNotifications(p, user));
  if (!me) return null;
  if (!isLiveRaceNotificationStatus(me.status)) return null;
  return me;
}

export function canReceiveLiveRaceParticipantNotifications(
  participant: RaceParticipantIdentity | null | undefined,
): boolean {
  if (!participant) return false;
  return isLiveRaceNotificationStatus(participant.status);
}
