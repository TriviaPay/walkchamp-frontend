import assert from "node:assert/strict";
import {
  extractUnlimitedChallengeRows,
  normalizeUnlimitedChallengeToUpcomingRoom,
  mergeUpcomingRoomsById,
} from "./unlimitedChallengeRooms";

const rows = extractUnlimitedChallengeRows({
  challenges: [
    {
      id: "ul-1",
      visibility: "public",
      entryFeeCents: 2500,
      dailyGoalSteps: 10000,
      durationDays: 7,
      startAtIso: "2026-07-31T05:00:00.000Z",
      title: "Unlimited · 10,000 steps/day",
      hostUserId: "host-1",
      hostUsername: "walker",
      participantCount: 1,
      currentUserRegistered: true,
      totalChargeCents: 3050,
    },
  ],
});
assert.equal(rows.length, 1);

const room = normalizeUnlimitedChallengeToUpcomingRoom(rows[0]!);
assert.ok(room);
assert.equal(room!.room_id, "ul-1");
assert.equal(room!.challenge_type, "unlimited_goal");
assert.equal(room!.entry_fee, 25);
assert.equal(room!.target_steps, 10000);
assert.equal(room!.challenge_duration_days, 7);
assert.equal(room!.capacity_mode, "unlimited");
assert.equal(room!.is_private, false);
assert.equal(room!.current_user_registered, true);
assert.equal(room!.host_user_id, "host-1");
assert.equal(room!.scheduled_start_at, "2026-07-31T05:00:00.000Z");
// Prize pool = entry contributions only ($25 × 1), not totalChargeCents.
assert.equal(room!.reward_pool, 25);

{
  const withPrize = normalizeUnlimitedChallengeToUpcomingRoom({
    id: "ul-prize",
    visibility: "public",
    entryFeeCents: 3000,
    dailyGoalSteps: 10000,
    durationDays: 7,
    startAtUtc: "2026-08-01T05:00:00.000Z",
    participantCount: 1,
    prizePoolCents: 3000,
  });
  assert.ok(withPrize);
  assert.equal(withPrize!.entry_fee, 30);
  assert.equal(withPrize!.reward_pool, 30);

  const noPrizeField = normalizeUnlimitedChallengeToUpcomingRoom({
    id: "ul-derive",
    visibility: "public",
    entryFeeCents: 3000,
    dailyGoalSteps: 10000,
    durationDays: 7,
    startAtUtc: "2026-08-01T05:00:00.000Z",
    participantCount: 2,
  });
  assert.ok(noPrizeField);
  assert.equal(noPrizeField!.reward_pool, 60);
}

// Spec field startAtUtc (not startAtIso)
const utcRow = normalizeUnlimitedChallengeToUpcomingRoom({
  id: "ul-2",
  visibility: "public",
  entryFeeCents: 1000,
  dailyGoalSteps: 8000,
  durationDays: 10,
  startAtUtc: "2026-08-01T05:00:00.000Z",
  isHost: true,
  host: { id: "host-2", username: "krishna" },
});
assert.ok(utcRow);
assert.equal(utcRow!.scheduled_start_at, "2026-08-01T05:00:00.000Z");
// isHost alone must NOT imply registered (Leave keeps creator as host).
assert.equal(utcRow!.current_user_registered, false);
assert.equal(utcRow!.host_user_id, "host-2");

// After Leave: explicit registered=false / left status stays unregistered.
const leftRoom = normalizeUnlimitedChallengeToUpcomingRoom({
  id: "ul-left",
  visibility: "public",
  entryFeeCents: 1000,
  dailyGoalSteps: 100,
  durationDays: 7,
  startAtUtc: "2026-08-02T05:00:00.000Z",
  hostUserId: "host-left",
  isHost: true,
  currentUserRegistered: false,
});
assert.ok(leftRoom);
assert.equal(leftRoom!.current_user_registered, false);

const leftStatus = normalizeUnlimitedChallengeToUpcomingRoom({
  id: "ul-left-status",
  visibility: "public",
  entryFeeCents: 1000,
  dailyGoalSteps: 100,
  durationDays: 7,
  startAtUtc: "2026-08-02T05:00:00.000Z",
  hostUserId: "host-left",
  isHost: true,
  participationStatus: "left",
});
assert.ok(leftStatus);
assert.equal(leftStatus!.current_user_registered, false);

const forfeitedStatus = normalizeUnlimitedChallengeToUpcomingRoom({
  id: "ul-forfeit-status",
  visibility: "public",
  entryFeeCents: 1000,
  dailyGoalSteps: 100,
  durationDays: 7,
  startAtUtc: "2026-08-02T05:00:00.000Z",
  hostUserId: "host-left",
  isHost: true,
  participationStatus: "forfeited",
});
assert.ok(forfeitedStatus);
assert.equal(forfeitedStatus!.current_user_registered, false);

const stillJoined = normalizeUnlimitedChallengeToUpcomingRoom({
  id: "ul-joined",
  visibility: "public",
  entryFeeCents: 3000,
  dailyGoalSteps: 100,
  durationDays: 7,
  startAtUtc: "2026-08-02T05:00:00.000Z",
  hostUserId: "host-2",
  currentUserRegistered: true,
});
assert.ok(stillJoined);
assert.equal(stillJoined!.current_user_registered, true);

// Nested data.unlimitedChallenges envelope
const nested = extractUnlimitedChallengeRows({
  data: { unlimitedChallenges: [{ id: "ul-3", startAtUtc: "2026-08-02T05:00:00.000Z", dailyGoalSteps: 5000 }] },
});
assert.equal(nested.length, 1);

const merged = mergeUpcomingRoomsById(
  [{ room_id: "a", title: "A" }],
  [{ room_id: "a", title: "A2" }, { room_id: "b", title: "B" }],
);
assert.equal(merged.length, 2);
assert.equal(merged.find((r) => r.room_id === "a")?.title, "A2");

// Classic Free / Cash race rooms must never normalize as Unlimited.
assert.equal(
  normalizeUnlimitedChallengeToUpcomingRoom({
    id: "free-1",
    title: "Free Walk",
    entryType: "Free",
    visibility: "public",
    scheduled_start_at: "2026-08-04T05:00:00.000Z",
    targetSteps: 5000,
    maxPlayers: 10,
  }),
  null,
);
assert.equal(
  normalizeUnlimitedChallengeToUpcomingRoom({
    id: "cash-1",
    title: "Cash Race",
    entryType: "$5",
    entryFeeCents: 500,
    visibility: "public",
    scheduled_start_at: "2026-08-04T05:00:00.000Z",
    max_players: 10,
  }),
  null,
);
assert.equal(
  extractUnlimitedChallengeRows({
    rooms: [
      {
        id: "free-2",
        entryType: "Free",
        visibility: "public",
        scheduled_start_at: "2026-08-04T05:00:00.000Z",
      },
    ],
  }).length,
  0,
);

{
  const listed = extractUnlimitedChallengeRows({
    challenges: [
      {
        id: "ul-live-roster",
        challengeType: "unlimited_goal",
        visibility: "public",
        entryFeeCents: 100000,
        dailyGoalSteps: 10000,
        durationDays: 5,
        startAtUtc: "2026-08-14T18:30:00.000Z",
        participantCount: 2,
        players: [
          {
            userId: "u-1",
            username: "priya",
            currentSteps: 400,
            rank: 1,
            isHost: true,
            qualificationStatus: "eligible",
          },
          {
            userId: "u-2",
            username: "krishna",
            current_steps: 120,
            rank: 2,
            is_host: false,
            status: "eligible",
          },
        ],
      },
    ],
  });
  const card = normalizeUnlimitedChallengeToUpcomingRoom(listed[0]!);
  assert.ok(card);
  assert.equal(card!.players?.length, 2, "list challenges[].players must survive normalize");
  assert.equal(card!.players?.[0]?.username, "priya");
  assert.equal(card!.players?.[1]?.userId, "u-2");
}

console.log("unlimitedChallengeRooms.test.ts: ok");
