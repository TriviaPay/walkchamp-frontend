import assert from "node:assert/strict";
import {
  DEFAULT_MINIMUM_PARTICIPANTS,
  formatRemainingMmSs,
  getWaitingRoomBanner,
  isFutureScheduledStart,
  playersNeeded,
  resolveMinimumParticipants,
  resolveRacePlayerCount,
  resolveRoomExpiresAt,
  resolveWaitingRoomMode,
  cancellationCopy,
  WAITING_ROOM_GET_READY_WINDOW_MS,
  WAITING_ROOM_OPEN_WINDOW_MS,
} from "./waitingRoomTiming";

const now = Date.parse("2026-07-22T18:00:00.000Z");

assert.equal(resolveRacePlayerCount({ registered_count: 2 }), 2);
assert.equal(resolveRacePlayerCount({ currentPlayers: 3 }), 3);
assert.equal(resolveRacePlayerCount({ current_players: 4 }), 4);
assert.equal(resolveRacePlayerCount({}), 0);

assert.equal(resolveWaitingRoomMode(null, now), "open_window");
assert.equal(
  resolveWaitingRoomMode(new Date(now + 60_000).toISOString(), now),
  "scheduled",
);
assert.equal(
  resolveWaitingRoomMode(new Date(now - 60_000).toISOString(), now),
  "scheduled",
);

assert.equal(isFutureScheduledStart(new Date(now + 1).toISOString(), now), true);
assert.equal(isFutureScheduledStart(new Date(now - 1).toISOString(), now), false);

const created = new Date(now).toISOString();
const expires = resolveRoomExpiresAt({
  mode: "open_window",
  createdAt: created,
});
assert.ok(expires);
assert.equal(expires!.getTime(), now + WAITING_ROOM_OPEN_WINDOW_MS);

assert.equal(
  resolveRoomExpiresAt({
    mode: "scheduled",
    createdAt: created,
    roomExpiresAt: new Date(now + 1000).toISOString(),
  }),
  null,
);

assert.equal(resolveMinimumParticipants(undefined), DEFAULT_MINIMUM_PARTICIPANTS);
assert.equal(resolveMinimumParticipants(4), 4);
assert.equal(playersNeeded(2, 1), 1);
assert.equal(playersNeeded(2, 2), 0);
assert.equal(formatRemainingMmSs(5 * 60_000 + 42_000), "05:42");

const far = getWaitingRoomBanner({
  mode: "scheduled",
  scheduledStartAt: new Date(now + WAITING_ROOM_GET_READY_WINDOW_MS + 60_000).toISOString(),
  participantCount: 1,
  minimumParticipants: 2,
  nowMs: now,
});
assert.equal(far.kind, "scheduled_far");
assert.match(far.title, /No need to stay/i);

const soon = getWaitingRoomBanner({
  mode: "scheduled",
  scheduledStartAt: new Date(now + 10 * 60_000).toISOString(),
  participantCount: 1,
  minimumParticipants: 2,
  nowMs: now,
});
assert.equal(soon.kind, "scheduled_soon");
assert.match(soon.title, /Get ready/i);

const starting = getWaitingRoomBanner({
  mode: "scheduled",
  status: "starting",
  scheduledStartAt: new Date(now + 1000).toISOString(),
  participantCount: 2,
  minimumParticipants: 2,
  nowMs: now,
});
assert.equal(starting.kind, "scheduled_starting");

const openWaiting = getWaitingRoomBanner({
  mode: "open_window",
  participantCount: 1,
  minimumParticipants: 2,
  roomExpiresAt: new Date(now + 24 * 60_000 + 18_000),
  nowMs: now,
});
assert.equal(openWaiting.kind, "open_waiting");
assert.match(openWaiting.message, /24:18/);

const openReady = getWaitingRoomBanner({
  mode: "open_window",
  participantCount: 2,
  minimumParticipants: 2,
  roomExpiresAt: new Date(now + 5 * 60_000 + 42_000),
  nowMs: now,
});
assert.equal(openReady.kind, "open_ready");
assert.match(openReady.message, /05:42/);

assert.equal(cancellationCopy("MINIMUM_PARTICIPANTS_NOT_MET").title, "Room Cancelled");
assert.match(
  cancellationCopy("MINIMUM_PARTICIPANTS_NOT_MET", "scheduled").message,
  /scheduled start time/i,
);
assert.match(
  cancellationCopy("MINIMUM_PARTICIPANTS_NOT_MET", "open_window").message,
  /within 30 minutes/i,
);
assert.equal(cancellationCopy("HOST_DID_NOT_START_BEFORE_EXPIRATION").title, "Room Expired");

const exactly30 = getWaitingRoomBanner({
  mode: "scheduled",
  scheduledStartAt: new Date(now + WAITING_ROOM_GET_READY_WINDOW_MS).toISOString(),
  participantCount: 1,
  minimumParticipants: 2,
  nowMs: now,
});
assert.equal(exactly30.kind, "scheduled_soon");

console.log("waitingRoomTiming.test.ts: ok");
