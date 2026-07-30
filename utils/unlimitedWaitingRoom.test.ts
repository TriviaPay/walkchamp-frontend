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

console.log("unlimitedWaitingRoom.test.ts: ok");
