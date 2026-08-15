import assert from "node:assert/strict";
import { isUserParticipatingInRace } from "./liveRaceParticipation";

const race = {
  id: "r1",
  hostUserId: "host",
  players: [{ userId: "host", username: "Host", status: null }],
};

assert.equal(
  isUserParticipatingInRace(race, { userId: "host", recentlyLeft: true, myActiveRaceIds: new Set(["r1"]) }),
  false,
  "recently left must drop View My Race even if my-active cache still has the id",
);

assert.equal(
  isUserParticipatingInRace(race, { userId: "host", myActiveRaceIds: new Set() }),
  false,
  "forfeited host must not stay participating just because they created the room",
);

assert.equal(
  isUserParticipatingInRace(race, { userId: "host", myActiveRaceIds: new Set(["r1"]) }),
  true,
  "my-active membership is still View My Race",
);

assert.equal(
  isUserParticipatingInRace(
    { ...race, currentUserParticipantStatus: "forfeited", currentUserParticipating: true },
    { userId: "host", myActiveRaceIds: new Set(["r1"]) },
  ),
  false,
  "explicit forfeited status wins over participating flag",
);

assert.equal(
  isUserParticipatingInRace(race, { userId: "host", myActiveRaceIds: null }),
  true,
  "without membership set, keep host fallback",
);

assert.equal(
  isUserParticipatingInRace(
    {
      ...race,
      challengeType: "unlimited_goal",
      currentUserParticipantStatus: "disqualified",
      currentUserParticipating: true,
    },
    { userId: "host", myActiveRaceIds: new Set(["r1"]) },
  ),
  true,
  "streak missed-day / DQ stays participating until manual leave",
);

assert.equal(
  isUserParticipatingInRace(
    {
      ...race,
      challengeType: "unlimited_goal",
      currentUserParticipantStatus: "left",
      currentUserParticipating: false,
    },
    { userId: "host", myActiveRaceIds: new Set(["r1"]) },
  ),
  false,
  "streak leave still drops View My Race",
);

console.log("liveRaceParticipation.test.ts ok");
