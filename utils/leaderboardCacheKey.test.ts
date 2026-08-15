import assert from "node:assert/strict";
import { leaderboardDiskKey, leaderboardMemoryKey } from "./leaderboardCacheKey";

assert.equal(
  leaderboardMemoryKey({ userId: "u1", mainTab: "global", stepsSubTab: "today" }),
  "u1:global_today",
);
assert.equal(
  leaderboardMemoryKey({ userId: "u1", mainTab: "coins" }),
  "u1:coins",
);
assert.equal(
  leaderboardMemoryKey({ userId: "u1", mainTab: "race", raceSubTab: "all" }),
  "u1:race_all",
);
assert.equal(
  leaderboardMemoryKey({
    userId: "u1",
    mainTab: "regional",
    stepsSubTab: "week",
    countryCode: "us",
  }),
  "u1:regional_week_US",
);
assert.notEqual(
  leaderboardMemoryKey({ userId: "u1", mainTab: "global", stepsSubTab: "today" }),
  leaderboardMemoryKey({ userId: "u2", mainTab: "global", stepsSubTab: "today" }),
);
assert.notEqual(
  leaderboardMemoryKey({
    userId: "u1",
    mainTab: "regional",
    stepsSubTab: "today",
    countryCode: "US",
  }),
  leaderboardMemoryKey({
    userId: "u1",
    mainTab: "regional",
    stepsSubTab: "today",
    countryCode: "IN",
  }),
);
assert.equal(
  leaderboardDiskKey({ userId: "u1", mainTab: "groups", groupPeriod: "all_time" }),
  "lb_u1:groups_all_time",
);

console.log("leaderboardCacheKey.test.ts ok");
