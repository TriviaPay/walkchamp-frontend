/**
 * Pure dummy Unlimited Race generators (no React Native imports).
 * Safe for Node unit tests.
 */

import { isUnlimitedRaceDummyDataEnabled } from "@/config/featureFlags";
import { UNLIMITED_GOAL_CHALLENGE_TYPE } from "@/utils/unlimitedGoal";

export const DUMMY_UNLIMITED_RACE_ID = "dummy-unlimited-race";
export const DUMMY_PARTICIPANT_COUNT = 100;
/** Current user default rank outside top 3 for UI verification. */
export const DUMMY_CURRENT_USER_DEFAULT_RANK = 8;

export type DummyRaceParticipant = {
  id: string;
  userId: string;
  currentSteps: number;
  status: string | null;
  rank: number | null;
  username: string;
  countryFlag: string | null;
  avatarColor: string | null;
  avatarUrl?: string | null;
  avatarVersion?: number | null;
  isHost: boolean;
  isCurrentUser?: boolean;
  isSpeaking?: boolean;
  isMicEnabled?: boolean;
  isLocallyMuted?: boolean;
  connectionStatus?: "connected" | "reconnecting" | "disconnected";
  participantStatus?: string | null;
};

export type DummyRaceData = {
  id: string;
  title: string;
  status: string;
  type?: string;
  entryType: string;
  entryAmountCents: number;
  entryAmountDollars: number;
  targetSteps: number;
  currentPlayers: number;
  maxPlayers: number | null;
  startedAt: string | null;
  completedAt: string | null;
  scheduledStartAt?: string | null;
  endsAt?: string | null;
  creatorId: string;
  prizePool: number;
  prizeTiers: number[];
  spectatorCount: number;
  capacityMode?: string | null;
  challengeType?: string | null;
  challengeEndAt?: string | null;
  challengeDurationDays?: number | null;
  timeLeftSeconds?: number | null;
};

export type DummyUnlimitedRaceSession = {
  race: DummyRaceData;
  participants: DummyRaceParticipant[];
};

const AVATAR_COLORS = [
  "#FFD700", "#C0C0C0", "#CD7F32", "#00E676", "#FF8C00",
  "#A855F7", "#00B4FF", "#FF5C93", "#35D0BA", "#F97316",
];

const FLAGS = ["🇺🇸", "🇮🇳", "🇬🇧", "🇨🇦", "🇦🇺", "🇩🇪", "🇧🇷", "🇯🇵", null];

function padIndex(n: number): string {
  return String(n).padStart(3, "0");
}

export function isDummyUnlimitedRaceId(raceId: string | null | undefined): boolean {
  if (!raceId) return false;
  return (
    raceId === DUMMY_UNLIMITED_RACE_ID ||
    raceId.startsWith("dummy-unlimited")
  );
}

export function shouldUseDummyUnlimitedRace(
  raceId: string | null | undefined,
  dummyParam?: string | null,
  opts?: { unlimitedChallenge?: boolean },
): boolean {
  if (!isUnlimitedRaceDummyDataEnabled()) return false;
  if (dummyParam === "1" || dummyParam === "true") return true;
  // When the dummy flag is on, Unlimited Live Race sessions use the 100-pack
  // for UI testing (Waiting Room → Live Race) without requiring a dummy race id.
  if (opts?.unlimitedChallenge) return true;
  return isDummyUnlimitedRaceId(raceId);
}

/** Deterministic dummy participants. Current user defaults to rank 8. */
export function createDummyUnlimitedParticipants(opts: {
  currentUserId: string;
  currentUsername?: string | null;
  count?: number;
  currentUserRank?: number;
}): DummyRaceParticipant[] {
  const count = Math.max(1, Math.min(opts.count ?? DUMMY_PARTICIPANT_COUNT, 120));
  const currentRank = Math.min(
    Math.max(opts.currentUserRank ?? DUMMY_CURRENT_USER_DEFAULT_RANK, 1),
    count,
  );
  const baseSteps = 50_000;

  const rows: DummyRaceParticipant[] = [];
  for (let rank = 1; rank <= count; rank++) {
    const isCurrent = rank === currentRank;
    const idx = padIndex(rank);
    const userId = isCurrent ? opts.currentUserId : `dummy-user-${idx}`;
    // Keep everyone near the START line so track winners are visible at the gate.
    // Rank 1 leads slightly; ranks beyond ~15 sit at 0 until the sim ticks.
    const steps = Math.max(0, 48 - (rank - 1) * 4);
    rows.push({
      id: `dummy-participant-${idx}`,
      userId,
      currentSteps: steps,
      status: rank === count ? "reconnecting" : "active",
      rank,
      username: isCurrent
        ? (opts.currentUsername?.trim() || "You")
        : `Runner${idx}`,
      countryFlag: FLAGS[(rank - 1) % FLAGS.length] ?? null,
      avatarColor: AVATAR_COLORS[(rank - 1) % AVATAR_COLORS.length],
      avatarUrl: null,
      avatarVersion: 0,
      isHost: rank === currentRank,
      isCurrentUser: isCurrent,
      isSpeaking: rank === 2,
      isMicEnabled: rank !== 5 && rank !== count,
      isLocallyMuted: rank === 5,
      connectionStatus:
        rank === count ? "reconnecting" : rank === count - 1 ? "disconnected" : "connected",
      participantStatus: rank === count ? "reconnecting" : "active",
    });
  }
  return rows;
}

export function createDummyUnlimitedRaceSession(opts: {
  currentUserId: string;
  currentUsername?: string | null;
  status?: "waiting" | "in_progress" | "completed";
  count?: number;
}): DummyUnlimitedRaceSession {
  const participants = createDummyUnlimitedParticipants(opts);
  const now = Date.now();
  const status = opts.status ?? "in_progress";
  const startedAt =
    status === "waiting" ? null : new Date(now - 15 * 60_000).toISOString();
  const endsAt = new Date(now + 26 * 24 * 3600_000).toISOString();

  return {
    race: {
      id: DUMMY_UNLIMITED_RACE_ID,
      title: "Unlimited Daily Goal (Demo)",
      status,
      type: "challenge",
      entryType: "paid_usd",
      entryAmountCents: 1000,
      entryAmountDollars: 10,
      targetSteps: 10_000,
      currentPlayers: participants.length,
      maxPlayers: null,
      startedAt,
      completedAt: null,
      scheduledStartAt: new Date(now - 20 * 60_000).toISOString(),
      endsAt,
      creatorId: opts.currentUserId,
      prizePool: 500,
      prizeTiers: [],
      spectatorCount: 12,
      capacityMode: "unlimited",
      challengeType: UNLIMITED_GOAL_CHALLENGE_TYPE,
      challengeEndAt: endsAt,
      challengeDurationDays: 7,
      timeLeftSeconds: 26 * 24 * 3600,
    },
    participants,
  };
}

export function getDummyWaitingRoomParticipants(
  currentUserId: string,
  currentUsername?: string | null,
): DummyRaceParticipant[] {
  return createDummyUnlimitedParticipants({
    currentUserId,
    currentUsername,
    count: DUMMY_PARTICIPANT_COUNT,
  });
}

export function resortDummyRanks(
  participants: DummyRaceParticipant[],
): DummyRaceParticipant[] {
  const sorted = [...participants].sort((a, b) => b.currentSteps - a.currentSteps);
  return sorted.map((p, i) => ({ ...p, rank: i + 1 }));
}
