/**
 * Run: npx tsx utils/liveRaceParticipantList.test.ts
 */
import assert from "node:assert/strict";
import {
  filterRaceParticipantsForDisplay,
  isGhostOrSystemHost,
  selectTopParticipantsForRaceTrack,
  LIVE_RACE_TRACK_TOP_N,
  resolveDisplayRank,
} from "./liveRaceParticipantList";
import {
  getRankAccessibilityLabel,
  getTopThreeRankAccent,
  getParticipantRowBorderColor,
  RANK_GOLD,
  RANK_SILVER,
  RANK_BRONZE,
  RANK_CURRENT_USER_GREEN,
} from "./participantRankUi";
import {
  createDummyUnlimitedParticipants,
  createDummyUnlimitedRaceSession,
  shouldUseDummyUnlimitedRace,
  DUMMY_PARTICIPANT_COUNT,
  DUMMY_CURRENT_USER_DEFAULT_RANK,
} from "../services/dummyUnlimitedRace/dummyUnlimitedRaceData";

// ── Ghost / filter ────────────────────────────────────────────────────────────
assert.equal(isGhostOrSystemHost({ username: "Walk Champ Admin" }), true);
assert.equal(isGhostOrSystemHost({ username: "normal_user" }), false);
assert.equal(isGhostOrSystemHost({ isGhostHost: true, username: "x" }), true);

const filtered = filterRaceParticipantsForDisplay([
  { id: "1", userId: "a", username: "alice", status: "active" },
  { id: "2", userId: "b", username: "Walk Champ Admin", status: "active" },
  { id: "3", userId: "c", username: "bob", status: "left" },
  { id: "4", userId: "d", username: "cara", status: "disqualified" },
  { id: "5", userId: "e", username: "dan", status: "active" },
]);
assert.deepEqual(
  filtered.map((p) => p.username),
  ["alice", "dan"],
);

// ── Top 10 track selection ────────────────────────────────────────────────────
const mk = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    id: `p${i + 1}`,
    steps: 1000 - i,
  }));

assert.equal(selectTopParticipantsForRaceTrack(mk(5)).length, 5);
assert.equal(selectTopParticipantsForRaceTrack(mk(10)).length, 10);
assert.equal(selectTopParticipantsForRaceTrack(mk(100)).length, LIVE_RACE_TRACK_TOP_N);
assert.deepEqual(
  selectTopParticipantsForRaceTrack(mk(15)).map((p) => p.id),
  mk(10).map((p) => p.id),
);

assert.equal(resolveDisplayRank(7, 0), 7);
assert.equal(resolveDisplayRank(null, 3), 4);

// ── Rank UI ───────────────────────────────────────────────────────────────────
assert.equal(getTopThreeRankAccent(1), RANK_GOLD);
assert.equal(getTopThreeRankAccent(2), RANK_SILVER);
assert.equal(getTopThreeRankAccent(3), RANK_BRONZE);
assert.equal(getTopThreeRankAccent(4), null);
assert.equal(getRankAccessibilityLabel(1), "Rank 1, gold position");
assert.equal(getRankAccessibilityLabel(2, { isCurrentUser: true }), "Rank 2, silver position, you");
assert.equal(
  getParticipantRowBorderColor(1, true),
  RANK_CURRENT_USER_GREEN,
  "current user green wins over gold border",
);
assert.equal(getParticipantRowBorderColor(1, false), RANK_GOLD);

// ── Dummy flag default off ────────────────────────────────────────────────────
assert.equal(
  shouldUseDummyUnlimitedRace("dummy-unlimited-race", "1"),
  false,
  "dummy path stays off when feature flag env is not true",
);

const dummies = createDummyUnlimitedParticipants({
  currentUserId: "me-user",
  currentUsername: "tester",
  count: DUMMY_PARTICIPANT_COUNT,
});
assert.equal(dummies.length, 100);
assert.equal(dummies[0]!.rank, 1);
assert.equal(dummies[1]!.rank, 2);
assert.equal(dummies[2]!.rank, 3);
const me = dummies.find((p) => p.userId === "me-user");
assert.ok(me);
assert.equal(me!.rank, DUMMY_CURRENT_USER_DEFAULT_RANK);
assert.ok(DUMMY_CURRENT_USER_DEFAULT_RANK > 3);
assert.ok(
  dummies.every((p) => (p.currentSteps ?? 0) < 100),
  "dummy runners start near the start line",
);
assert.ok(dummies[0]!.currentSteps! > dummies[1]!.currentSteps!);
assert.ok(dummies.some((p) => p.isSpeaking));

assert.ok(dummies.some((p) => p.isLocallyMuted));
assert.ok(dummies.some((p) => p.connectionStatus === "disconnected" || p.connectionStatus === "reconnecting"));

const session = createDummyUnlimitedRaceSession({
  currentUserId: "me-user",
  status: "waiting",
});
assert.equal(session.race.capacityMode, "unlimited");
assert.equal(session.participants.length, 100);

console.log("liveRaceParticipantList.test.ts: ok");
