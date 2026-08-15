/**
 * Live Challenges "View My Race" vs "Watch Live".
 * my-active membership is authoritative; creator / roster presence alone is not.
 */

import { isStreakChallengeKind, isStreakManualLeaveStatus } from "@/utils/unlimitedStreakParticipation";

export const NON_PARTICIPATING_STATUSES = new Set([
  "withdrawn",
  "withdrew",
  "left",
  "removed",
  "disqualified",
  "forfeited",
  "cancelled",
  "canceled",
  "quit",
]);

export type LiveParticipationPlayer = {
  userId?: string | null;
  username?: string | null;
  status?: string | null;
  participantStatus?: string | null;
  registrationStatus?: string | null;
  isForfeited?: boolean;
};

export type LiveParticipationRace = {
  id: string;
  hostUserId?: string | null;
  currentUserRole?: string | null;
  currentUserParticipantStatus?: string | null;
  currentUserParticipating?: boolean;
  challengeType?: string | null;
  capacityMode?: string | null;
  entryType?: string | null;
  players?: LiveParticipationPlayer[];
};

export function isUserParticipatingInRace(
  race: LiveParticipationRace,
  opts: {
    userId?: string | null;
    username?: string | null;
    myActiveRaceIds?: Set<string> | null;
    recentlyLeft?: boolean;
  },
): boolean {
  if (opts.recentlyLeft) return false;

  const uid = opts.userId;
  const uname = opts.username?.trim().toLowerCase();
  if (!uid && !uname && !opts.myActiveRaceIds?.size) return false;

  const player = race.players?.find(
    (p) =>
      (!!uid && p.userId === uid) ||
      (!!uname && p.username?.trim().toLowerCase() === uname),
  );
  const status = (
    race.currentUserParticipantStatus ??
    player?.participantStatus ??
    player?.registrationStatus ??
    player?.status ??
    (player?.isForfeited ? "forfeited" : "")
  )
    .trim()
    .toLowerCase();
  const streak = isStreakChallengeKind(race);
  if (streak ? isStreakManualLeaveStatus(status) : NON_PARTICIPATING_STATUSES.has(status)) {
    return false;
  }

  const role = race.currentUserRole?.trim().toLowerCase();
  if (role === "spectator" || role === "watcher" || role === "viewer") return false;

  if (opts.myActiveRaceIds?.has(race.id)) return true;
  if (race.currentUserParticipating === true) return true;
  if (role === "participant" || role === "racer" || role === "racing") return true;

  // Creator / top-3 roster is not enough after forfeit — /api/races still lists
  // forfeited players (only excludes `left`) and creatorId never changes.
  if (opts.myActiveRaceIds != null) return false;

  if (role === "host") return true;
  if (uid && race.hostUserId === uid) return true;
  return !!player;
}
