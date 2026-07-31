import assert from "node:assert/strict";
import { mapUnlimitedDetailToWaitingRoom } from "./unlimitedWaitingRoom";

const mapped = mapUnlimitedDetailToWaitingRoom({
  challenge: {
    id: "aff442fe-35ca-4e91-9273-2f18e6c59603",
    challengeType: "unlimited_goal",
    hostUserId: "host-1",
    title: "Unlimited · 10,000 steps/day",
    visibility: "public",
    capacityMode: "unlimited",
    maxParticipants: null,
    status: "waiting",
    entryFeeCents: 3000,
    platformFeeCents: 50,
    totalChargeCents: 3050,
    dailyGoalSteps: 10000,
    durationDays: 7,
    startAtUtc: "2026-07-30T05:00:00.000Z",
    participantCount: 1,
    participants: [
      {
        userId: "host-1",
        username: "krishna",
        isHost: true,
      },
    ],
  },
});

assert.ok(mapped);
assert.equal(mapped!.race.id, "aff442fe-35ca-4e91-9273-2f18e6c59603");
assert.equal(mapped!.race.entryType, "unlimited_goal");
assert.equal(mapped!.race.capacityMode, "unlimited");
assert.equal(mapped!.race.maxPlayers, null);
assert.equal(mapped!.race.targetSteps, 10000);
assert.equal(mapped!.race.entryAmountCents, 3000);
assert.equal(mapped!.race.scheduledStartAt, "2026-07-30T05:00:00.000Z");
assert.equal(mapped!.participants.length, 1);
assert.equal(mapped!.race.currentPlayers, 1);

// Backend count must win even when the embedded avatar list is only a preview.
const mappedHundred = mapUnlimitedDetailToWaitingRoom({
  challenge: {
    id: "ul-100",
    status: "waiting",
    registeredCount: 100,
    dailyGoalSteps: 10000,
    entryFeeCents: 1000,
    participants: [{ userId: "host-1", username: "host", isHost: true }],
  },
});
assert.ok(mappedHundred);
assert.equal(mappedHundred!.race.currentPlayers, 100);
assert.equal(mappedHundred!.participants.length, 1);
assert.equal(mappedHundred!.race.hasExplicitPlayerCount, true);

// Nested participant list + snake_case count
const mappedNested = mapUnlimitedDetailToWaitingRoom({
  data: {
    id: "ul-nested",
    registered_count: 42,
    participants: { data: [{ user_id: "a" }, { user_id: "b" }] },
  },
});
assert.ok(mappedNested);
assert.equal(mappedNested!.race.currentPlayers, 42);
assert.equal(mappedNested!.participants.length, 2);

// Real detail shape: players + participants are the SAME roster (must not double to 202).
const roster = Array.from({ length: 101 }, (_, i) => ({
  id: `p-${i}`,
  participantId: `p-${i}`,
  userId: `user-${i}`,
  username: `user${i}`,
  status: "active",
  currentSteps: 0,
  isHost: i === 0,
}));
const mappedDup = mapUnlimitedDetailToWaitingRoom({
  challenge: {
    id: "2c63ab07-b5fa-4227-aa9d-71ee5c7f78ca",
    participantCount: 101,
    prizePoolCents: 303000,
    entryFeeCents: 3000,
    status: "waiting",
    dailyGoalSteps: 10000,
  },
  membership: { status: "active" },
  canJoin: false,
  players: roster,
  participants: roster.map((r) => ({ ...r })), // separate object instances, same userIds
});
assert.ok(mappedDup);
assert.equal(mappedDup!.race.currentPlayers, 101, "must use participantCount, not 202");
assert.equal(mappedDup!.participants.length, 101, "must dedupe players+participants");
assert.equal(mappedDup!.race.hasExplicitPlayerCount, true);

// Take MAX when a stale participantCount:1 coexists with registered_count:101
const mappedMax = mapUnlimitedDetailToWaitingRoom({
  challenge: {
    id: "ul-max",
    participantCount: 1,
    registered_count: 101,
    entryFeeCents: 1000,
    dailyGoalSteps: 10000,
  },
});
assert.ok(mappedMax);
assert.equal(mappedMax!.race.currentPlayers, 101);

console.log("unlimitedWaitingRoom.test.ts: ok");
