/**
 * Local mute-all semantics (pure). Run: npx tsx utils/liveRaceLocalMute.test.ts
 *
 * Mute All = local playback silence on this device only (not self mic, not global).
 * Individual unmute while Mute All is active = explicit exception.
 */
import assert from "node:assert/strict";

function isRemoteLocallyMuted(
  userId: string,
  state: {
    muteAllActive: boolean;
    unmuteExceptions: string[];
    locallyMutedUserIds: string[];
  },
): boolean {
  if (state.muteAllActive) {
    return !state.unmuteExceptions.includes(userId);
  }
  return state.locallyMutedUserIds.includes(userId);
}

let state = {
  muteAllActive: false,
  unmuteExceptions: [] as string[],
  locallyMutedUserIds: [] as string[],
};

// Mute All
state = {
  muteAllActive: true,
  unmuteExceptions: [],
  locallyMutedUserIds: ["a", "b", "c"],
};
assert.equal(isRemoteLocallyMuted("a", state), true);
assert.equal(isRemoteLocallyMuted("new-joiner", state), true, "new joiners inherit mute-all");

// Individual unmute exception while Mute All active
state = {
  ...state,
  unmuteExceptions: ["b"],
  locallyMutedUserIds: state.locallyMutedUserIds.filter((id) => id !== "b"),
};
assert.equal(isRemoteLocallyMuted("b", state), false);
assert.equal(isRemoteLocallyMuted("a", state), true);

// Unmute All clears everything
state = { muteAllActive: false, unmuteExceptions: [], locallyMutedUserIds: [] };
assert.equal(isRemoteLocallyMuted("a", state), false);

// Individual mute without Mute All
state = {
  muteAllActive: false,
  unmuteExceptions: [],
  locallyMutedUserIds: ["c"],
};
assert.equal(isRemoteLocallyMuted("c", state), true);
assert.equal(isRemoteLocallyMuted("a", state), false);

console.log("liveRaceLocalMute.test.ts: ok");
