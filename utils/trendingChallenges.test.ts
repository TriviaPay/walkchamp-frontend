/**

 * Trending Challenges helpers — free / coins / cash / unlimited, soonest start first.

 * Run: npx tsx utils/trendingChallenges.test.ts

 */



import assert from "node:assert/strict";

import {

  assignTrendingArtworkKey,

  assignTrendingThemeKey,

  buildTrendingChallengesFromRooms,

  formatTrendingPrizePool,

  isEligibleTrendingRoom,

  isUnlimitedChallengePreviewFormat,
  isTrendingPreviewFormat,

  mergeAvailableRoomLists,

  rankTrendingRooms,

  resolveTrendingFormat,

  shouldShowTrendingPreview,

  stableHash,

  trendingPreviewCacheKey,

  TRENDING_MAX_CARDS,

  type AvailableRoomLike,

} from "./trendingChallenges";



const future = new Date(Date.now() + 3_600_000).toISOString();

const past = new Date(Date.now() - 3_600_000).toISOString();



function room(partial: Partial<AvailableRoomLike> & { room_id: string }): AvailableRoomLike {

  return {

    scheduled_start_at: future,

    is_private: false,

    requires_code: false,

    joinable: true,

    eligible_to_register: true,

    status: "waiting",

    challenge_type: "cash",

    entry_fee: 3,

    current_players: 1,

    ...partial,

  };

}



assert.equal(stableHash("abc"), stableHash("abc"));

assert.notEqual(stableHash("abc"), stableHash("abd"));

assert.equal(assignTrendingThemeKey("room-1"), assignTrendingThemeKey("room-1"));

assert.equal(assignTrendingArtworkKey("room-1"), assignTrendingArtworkKey("room-1"));



assert.equal(isUnlimitedChallengePreviewFormat("fixed_cash"), true);

assert.equal(isUnlimitedChallengePreviewFormat("unlimited_goal"), true);

assert.equal(isUnlimitedChallengePreviewFormat("free"), false);

assert.equal(isUnlimitedChallengePreviewFormat("coins"), false);

assert.equal(isTrendingPreviewFormat("free"), true);

assert.equal(isTrendingPreviewFormat("coins"), true);

assert.equal(isTrendingPreviewFormat("fixed_cash"), true);

assert.equal(isTrendingPreviewFormat("unlimited_goal"), true);



// eligibility — free / coins / cash / unlimited all ok

assert.equal(isEligibleTrendingRoom(room({ room_id: "a" })), true);

assert.equal(isEligibleTrendingRoom(room({ room_id: "free", challenge_type: "free", entry_fee: 0 })), true);

assert.equal(

  isEligibleTrendingRoom(

    room({ room_id: "coins", challenge_type: "coins", coin_entry_amount: 500, entry_fee: 0 }),

  ),

  true,

);

assert.equal(

  isEligibleTrendingRoom(

    room({ room_id: "unl", challenge_type: "unlimited_goal", capacity_mode: "unlimited", entry_fee: 10 }),

  ),

  true,

);

assert.equal(isEligibleTrendingRoom(room({ room_id: "b", is_private: true })), false);

assert.equal(isEligibleTrendingRoom(room({ room_id: "c", requires_code: true })), false);

assert.equal(isEligibleTrendingRoom(room({ room_id: "d", status: "cancelled" })), false);

assert.equal(isEligibleTrendingRoom(room({ room_id: "f", scheduled_start_at: past })), false);

assert.equal(

  isEligibleTrendingRoom(

    room({ room_id: "g", host_user_id: "user-1" }),

    Date.now(),

    { viewerUserId: "user-1" },

  ),

  true,

);

assert.equal(isEligibleTrendingRoom(room({ room_id: "h", challenge_type: "sponsored" })), false);



assert.equal(resolveTrendingFormat(room({ room_id: "x", challenge_type: "unlimited_goal" })), "unlimited_goal");

assert.equal(resolveTrendingFormat(room({ room_id: "y", entry_fee: 5 })), "fixed_cash");

assert.equal(
  formatTrendingPrizePool(
    room({
      room_id: "prize-ul",
      challenge_type: "unlimited_goal",
      capacity_mode: "unlimited",
      entry_fee: 30,
      registered_count: 1,
      reward_pool: 30,
    }),
  ),
  "$30",
);

assert.equal(
  formatTrendingPrizePool(
    room({
      room_id: "prize-fallback",
      challenge_type: "unlimited_goal",
      capacity_mode: "unlimited",
      entry_fee: 30,
      registered_count: 1,
      reward_pool: 0,
    }),
  ),
  "$30",
);



// ranking: soonest start first

const ranked = rankTrendingRooms([

  room({

    room_id: "old",

    created_at: new Date(Date.now() - 10_000).toISOString(),

    scheduled_start_at: new Date(Date.now() + 7_200_000).toISOString(),

  }),

  room({

    room_id: "new",

    created_at: new Date(Date.now() - 1_000).toISOString(),

    scheduled_start_at: new Date(Date.now() + 3_600_000).toISOString(),

  }),

  room({

    room_id: "mid",

    created_at: new Date(Date.now() - 5_000).toISOString(),

    scheduled_start_at: new Date(Date.now() + 1_800_000).toISOString(),

  }),

]);

assert.deepEqual(

  ranked.map((r) => r.room_id),

  ["mid", "new", "old"],

);



// free / coins / cash / unlimited all ranked by soonest start

const typed = rankTrendingRooms([

  room({ room_id: "free1", challenge_type: "free", entry_fee: 0, scheduled_start_at: new Date(Date.now() + 4_000_000).toISOString() }),

  room({ room_id: "coins1", challenge_type: "coins", coin_entry_amount: 100, entry_fee: 0, scheduled_start_at: new Date(Date.now() + 2_000_000).toISOString() }),

  room({ room_id: "cash1", challenge_type: "cash", entry_fee: 3, created_at: new Date().toISOString(), scheduled_start_at: new Date(Date.now() + 3_000_000).toISOString() }),

  room({

    room_id: "unl1",

    challenge_type: "unlimited_goal",

    capacity_mode: "unlimited",

    entry_fee: 10,

    created_at: new Date(Date.now() - 500).toISOString(),

    scheduled_start_at: new Date(Date.now() + 5_000_000).toISOString(),

  }),

]);

assert.deepEqual(

  typed.map((r) => r.room_id),

  ["coins1", "cash1", "free1", "unl1"],

);



const many = Array.from({ length: 25 }, (_, i) =>

  room({

    room_id: `r${String(i).padStart(2, "0")}`,

    entry_fee: 3,

    created_at: new Date(Date.now() - i * 1_000).toISOString(),

    scheduled_start_at: new Date(Date.now() + (i + 1) * 3_600_000).toISOString(),

  }),

);

const built = buildTrendingChallengesFromRooms(many);

assert.equal(TRENDING_MAX_CARDS, 20);

assert.equal(built.length, 20);

assert.equal(built[0]!.id, "r00");

assert.equal(built[0]!.themeKey, assignTrendingThemeKey(built[0]!.id));



const merged = mergeAvailableRoomLists(

  [room({ room_id: "x", current_players: 1 })],

  [room({ room_id: "x", current_players: 9 }), room({ room_id: "y", current_players: 2 })],

);

assert.equal(merged.length, 2);

assert.equal(merged.find((r) => r.room_id === "x")?.current_players, 9);

assert.equal(shouldShowTrendingPreview(undefined), false);
assert.equal(shouldShowTrendingPreview([]), false);
assert.equal(shouldShowTrendingPreview([{ id: "a" }]), true);
assert.equal(trendingPreviewCacheKey("u1"), "walk_trending:u1");
assert.notEqual(trendingPreviewCacheKey("u1"), trendingPreviewCacheKey("u2"));

console.log("trendingChallenges.test.ts: ok");

