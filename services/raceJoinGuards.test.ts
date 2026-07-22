/**
 * Characterization of existing pure race-join / capacity / scheduled guards.
 * Sponsored registration helpers are imported directly.
 * ActiveRaceModal pure helpers are mirrored here (keep in sync) so Node tests
 * avoid React Native / vector-icons JSX transforms.
 * Run: npx tsx services/raceJoinGuards.test.ts
 */

import assert from "node:assert/strict";
import {
  canOpenSponsoredWaitingRoom,
  isBeforeScheduledStart,
  isSponsoredRegistrationOpen,
} from "@/utils/sponsoredEventRegistration";

// ── Mirrored from components/ActiveRaceModal.tsx (keep in sync) ──────────────

type ActiveRaceInfo = {
  room_id: string;
  room_status: string;
  challenge_type: string;
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
};

function normalizeActiveRaceInfo(
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

function isSponsoredActiveRaceConflict(
  info: {
    room_id?: string;
    room_type?: string;
    is_sponsored?: boolean;
    challenge_type?: string;
  } | null | undefined,
  sponsoredRacingId?: string | null,
): boolean {
  if (!info) return false;
  if (info.is_sponsored === true || info.room_type === "sponsored") return true;
  if (sponsoredRacingId && info.room_id === sponsoredRacingId) return true;
  return false;
}

// ── normalizeActiveRaceInfo (active-race payload shape) ──────────────────────

const normalized = normalizeActiveRaceInfo({
  room_id: "room-1",
  room_status: "in_progress",
  challenge_type: "cash",
  entry_fee: 2.5,
  target_steps: 5000,
  current_user_role: "participant",
  can_leave: true,
  next_screen: "race_track",
  participantCount: 3,
  maxParticipants: 10,
  startedAt: "2026-01-01T12:00:00.000Z",
  scheduledStartAt: "2026-01-01T11:00:00.000Z",
});
assert.equal(normalized.room_id, "room-1");
assert.equal(normalized.registered_count, 3);
assert.equal(normalized.max_players, 10);
assert.equal(normalized.started_at, "2026-01-01T12:00:00.000Z");
assert.equal(normalized.scheduled_start_at, "2026-01-01T11:00:00.000Z");

const snake = normalizeActiveRaceInfo({
  room_id: "r2",
  registered_count: 8,
  max_players: 8,
});
assert.equal(snake.registered_count, 8);
assert.equal(snake.max_players, 8);

// ── isSponsoredActiveRaceConflict ────────────────────────────────────────────

assert.equal(isSponsoredActiveRaceConflict(null), false);
assert.equal(isSponsoredActiveRaceConflict({ is_sponsored: true }), true);
assert.equal(isSponsoredActiveRaceConflict({ room_type: "sponsored" }), true);
assert.equal(
  isSponsoredActiveRaceConflict({ room_id: "sp-1" }, "sp-1"),
  true,
  "matching sponsoredRacingId counts as sponsored conflict",
);
assert.equal(
  isSponsoredActiveRaceConflict({ room_id: "cash-1", challenge_type: "cash" }, "sp-1"),
  false,
);

// ── Scheduled / capacity registration guards (sponsoredEventRegistration) ────

const future = new Date(Date.now() + 60_000).toISOString();
const past = new Date(Date.now() - 60_000).toISOString();

assert.equal(isBeforeScheduledStart(future), true);
assert.equal(isBeforeScheduledStart(past), false);
assert.equal(isBeforeScheduledStart(null), true);
assert.equal(isBeforeScheduledStart(undefined), true);

assert.equal(
  isSponsoredRegistrationOpen({
    status: "scheduled",
    scheduledStartAt: future,
  }),
  true,
);
assert.equal(
  isSponsoredRegistrationOpen({
    status: "scheduled",
    isFull: true,
    scheduledStartAt: future,
  }),
  false,
  "capacity full blocks registration",
);
assert.equal(
  isSponsoredRegistrationOpen({
    status: "scheduled",
    isRegistered: true,
    scheduledStartAt: future,
  }),
  false,
);
assert.equal(
  isSponsoredRegistrationOpen({
    status: "live",
    scheduledStartAt: future,
  }),
  false,
);
assert.equal(
  isSponsoredRegistrationOpen({
    status: "scheduled",
    scheduledStartAt: past,
  }),
  false,
  "after scheduled start registration closed",
);

assert.equal(
  canOpenSponsoredWaitingRoom({
    status: "scheduled",
    isRegistered: true,
    scheduledStartAt: future,
  }),
  true,
);
assert.equal(
  canOpenSponsoredWaitingRoom({
    status: "scheduled",
    isRegistered: false,
    scheduledStartAt: future,
  }),
  false,
);
assert.equal(
  canOpenSponsoredWaitingRoom({
    status: "scheduled",
    isRegistered: true,
    scheduledStartAt: past,
  }),
  false,
);

console.log("raceJoinGuards.test.ts — all assertions passed");
