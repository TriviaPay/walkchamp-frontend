/**
 * Hard scope gate: Unlimited Live UI chrome must not apply to classic races.
 * Run: npx tsx utils/unlimitedLiveUiGate.test.ts
 */
import assert from "node:assert/strict";
import { isUnlimitedGoalChallenge } from "../rules/unlimitedGoal";

function shouldRenderUnlimitedLiveChrome(race: {
  challengeType?: string | null;
  entryType?: string | null;
  type?: string | null;
  capacityMode?: string | null;
  maxPlayers?: number | null;
}): boolean {
  // Type gate used by live-detail (flag is separate runtime check).
  return isUnlimitedGoalChallenge({
    challengeType: race.challengeType,
    entryType: race.entryType,
    type: race.type,
    capacityMode: race.capacityMode,
    maxPlayers: race.maxPlayers,
  });
}

assert.equal(
  shouldRenderUnlimitedLiveChrome({
    challengeType: "unlimited_goal",
    capacityMode: "unlimited",
  }),
  true,
);

for (const classic of [
  { challengeType: "free", entryType: "free" },
  { challengeType: "coins_battle", entryType: "coins_battle" },
  { type: "sponsored", challengeType: "sponsored" },
  { challengeType: "paid_usd", entryType: "paid_usd", maxPlayers: 10 },
]) {
  assert.equal(
    shouldRenderUnlimitedLiveChrome(classic),
    false,
    `classic must not render Unlimited chrome: ${JSON.stringify(classic)}`,
  );
}

console.log("unlimitedLiveUiGate.test.ts: ok");
