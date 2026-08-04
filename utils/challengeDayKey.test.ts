/**
 * Run: npx tsx utils/challengeDayKey.test.ts
 */
import assert from "node:assert/strict";
import { formatChallengeDayKey, isSameChallengeDay } from "./challengeDayKey";

// Fixed UTC instant — America/New_York on this date is still previous calendar day.
const utcAfternoon = new Date("2026-08-04T02:30:00.000Z");
assert.equal(formatChallengeDayKey(utcAfternoon, "UTC"), "2026-08-04");
assert.equal(formatChallengeDayKey(utcAfternoon, "America/New_York"), "2026-08-03");
assert.equal(formatChallengeDayKey(utcAfternoon, "Asia/Kolkata"), "2026-08-04");

assert.equal(isSameChallengeDay("2026-08-04", "2026-08-04"), true);
assert.equal(isSameChallengeDay("2026-08-04", "2026-08-03"), false);
assert.equal(isSameChallengeDay(null, "2026-08-04"), false);

console.log("challengeDayKey.test.ts: ok");
