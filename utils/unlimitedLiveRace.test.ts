/**
 * Run: npx tsx utils/unlimitedLiveRace.test.ts
 */
import assert from "node:assert/strict";
import {
  coerceUnlimitedRaceInProgress,
  mapUnlimitedDetailToLiveDetail,
  mapUnlimitedUpcomingToLiveRaceFields,
  mergeUnlimitedLiveParticipants,
  normalizeUnlimitedLiveStatus,
  overlayClassicRaceOnUnlimitedDetail,
} from "./unlimitedLiveRace";
import type { UnlimitedUpcomingRoom } from "./unlimitedChallengeRooms";

const start = "2026-07-30T05:00:00.000Z";
const nowAfterStart = Date.parse("2026-07-30T05:20:00.000Z");
const nowBeforeStart = Date.parse("2026-07-30T04:00:00.000Z");

assert.equal(
  normalizeUnlimitedLiveStatus("waiting", {
    startAt: start,
    endAt: null,
    nowMs: nowAfterStart,
  }),
  "in_progress",
  "waiting + past startAt → in_progress",
);

assert.equal(
  normalizeUnlimitedLiveStatus("scheduled", {
    startAt: start,
    endAt: "2026-08-06T05:00:00.000Z",
    nowMs: nowAfterStart,
  }),
  "in_progress",
);

assert.equal(
  normalizeUnlimitedLiveStatus("cancelled_by_platform", {
    startAt: start,
    endAt: "2026-08-06T05:00:00.000Z",
    nowMs: nowAfterStart,
  }),
  "completed",
  "platform cancel must not stay live via schedule window",
);

const room: UnlimitedUpcomingRoom = {
  room_id: "aff442fe-35ca-4e91-9273-2f18e6c59603",
  status: "waiting",
  challenge_type: "unlimited_goal",
  entry_fee: 30,
  coin_entry_amount: 0,
  title: "Unlimited · 10,000 steps/day",
  target_steps: 10000,
  max_players: 0,
  registered_count: 1,
  scheduled_start_at: start,
  challenge_duration_days: 7,
  challenge_end_at: null,
  selected_track_theme_id: "bg",
  theme_name: "Unlimited",
  is_private: false,
  requires_code: false,
  host_user_id: "U3HCx3UEI9kuD9Woys1yguJMO5KW",
  host_username: "host",
  host_avatar_color: "#00E676",
  host_avatar_url: null,
  host_country_flag: null,
  current_user_registered: true,
  eligible_to_register: false,
  capacity_mode: "unlimited",
  reward_pool: 30,
};

const mapped = mapUnlimitedUpcomingToLiveRaceFields(room, nowAfterStart);
assert.ok(mapped);
assert.equal(mapped.status, "in_progress");
assert.equal(mapped.entryType, "$30");
assert.equal(mapped.maxPlayers, 0);
assert.equal(mapped.challengeType, "unlimited_goal");
assert.equal(mapped.capacityMode, "unlimited");

const detailMapped = mapUnlimitedDetailToLiveDetail({
  challenge: {
    id: "chal-1",
    status: "waiting",
    startAtUtc: start,
    dailyGoalSteps: 10000,
    entryFeeCents: 3000,
    participantCount: 2,
    hostUserId: "host-1",
  },
  players: [
    { id: "user-a", displayName: "Alice", currentSteps: 0 },
    { userId: "user-b", username: "Bob", current_steps: 12 },
  ],
});
assert.ok(detailMapped);
assert.equal(detailMapped.participants.length, 2, "id-only rows must map onto live roster");
assert.equal(detailMapped.race.status, "in_progress");

const overlaid = overlayClassicRaceOnUnlimitedDetail(detailMapped, {
  race: { status: "in_progress", startedAt: start, currentPlayers: 2 },
  participants: [
    { userId: "user-a", currentSteps: 40 },
    { userId: "user-b", currentSteps: 12 },
  ],
});
assert.equal(overlaid.race.status, "in_progress");
assert.equal(
  overlaid.participants.find((p) => p.userId === "user-a")?.currentSteps,
  40,
);

const merged = mergeUnlimitedLiveParticipants(detailMapped.participants, [
  { userId: "user-a", steps: 55 },
]);
assert.equal(merged.find((p) => p.userId === "user-a")?.currentSteps, 55);

const forced = coerceUnlimitedRaceInProgress(detailMapped.race, { forceLive: true });
assert.equal(forced.status, "in_progress");
assert.ok(forced.startedAt);

console.log("unlimitedLiveRace.test.ts: ok");
