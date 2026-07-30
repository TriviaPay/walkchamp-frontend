/**
 * Trending Challenges tagline rotation helpers.
 * Run: npx tsx utils/trendingChallengeTaglines.test.ts
 */

import assert from "node:assert/strict";
import {
  TRENDING_CHALLENGE_TAGLINES,
  TRENDING_TAGLINE_LINE_HEIGHT,
  TRENDING_TAGLINE_ROTATE_MS,
  createTrendingTaglineRotator,
  getTrendingTaglineAt,
  getTrendingTaglineCount,
  nextTrendingTaglineIndex,
} from "./trendingChallengeTaglines";

assert.equal(TRENDING_TAGLINE_ROTATE_MS, 60_000);
assert.equal(getTrendingTaglineCount(), 5);
assert.equal(TRENDING_CHALLENGE_TAGLINES.length, 5);

// First tagline renders initially (index 0)
assert.equal(
  getTrendingTaglineAt(0),
  "Cash races everyone is joining right now",
);

// Exact copy — all five in order
assert.deepEqual([...TRENDING_CHALLENGE_TAGLINES], [
  "Cash races everyone is joining right now",
  "Compete for exciting prizes in trending races",
  "Join fast-growing races before they begin",
  "Choose a challenge, start walking and win",
  "Join the hottest cash challenges before they start",
]);

// Sequential rotation 0→1→2→3→4→0
assert.equal(nextTrendingTaglineIndex(0), 1);
assert.equal(getTrendingTaglineAt(1), "Compete for exciting prizes in trending races");
assert.equal(nextTrendingTaglineIndex(1), 2);
assert.equal(nextTrendingTaglineIndex(2), 3);
assert.equal(nextTrendingTaglineIndex(3), 4);
assert.equal(nextTrendingTaglineIndex(4), 0);
assert.equal(getTrendingTaglineAt(5), getTrendingTaglineAt(0));

// Full cycle walk
{
  let i = 0;
  const seen: string[] = [getTrendingTaglineAt(i)];
  for (let step = 0; step < 4; step++) {
    i = nextTrendingTaglineIndex(i);
    seen.push(getTrendingTaglineAt(i));
  }
  assert.deepEqual(seen, [...TRENDING_CHALLENGE_TAGLINES]);
  i = nextTrendingTaglineIndex(i);
  assert.equal(getTrendingTaglineAt(i), TRENDING_CHALLENGE_TAGLINES[0]);
}

// Reserved one-line height (section height stability)
assert.equal(TRENDING_TAGLINE_LINE_HEIGHT, 16);
assert.ok(TRENDING_TAGLINE_LINE_HEIGHT >= 14);

// Timer: only one interval; start is idempotent; stop clears
{
  let advanceCount = 0;
  const timers = new Map<ReturnType<typeof setInterval>, () => void>();
  let nextId = 1;

  const setIntervalFn = ((fn: () => void, _ms?: number) => {
    const id = nextId++ as unknown as ReturnType<typeof setInterval>;
    timers.set(id, fn);
    return id;
  }) as typeof setInterval;

  const clearIntervalFn = ((id: ReturnType<typeof setInterval>) => {
    timers.delete(id);
  }) as typeof clearInterval;

  const rotator = createTrendingTaglineRotator({
    intervalMs: 60_000,
    onAdvance: () => {
      advanceCount += 1;
    },
    setIntervalFn,
    clearIntervalFn,
  });

  assert.equal(rotator.isRunning(), false);
  rotator.start();
  assert.equal(rotator.isRunning(), true);
  assert.equal(timers.size, 1);

  // Re-start must not create a duplicate interval
  rotator.start();
  assert.equal(timers.size, 1);
  assert.equal(rotator.isRunning(), true);

  // Simulate one 60s tick → second tagline advance
  for (const fn of timers.values()) fn();
  assert.equal(advanceCount, 1);

  // Five advances wrap through all taglines then back
  for (let n = 0; n < 4; n++) {
    for (const fn of timers.values()) fn();
  }
  assert.equal(advanceCount, 5);

  rotator.stop();
  assert.equal(rotator.isRunning(), false);
  assert.equal(timers.size, 0);

  // Stop is idempotent
  rotator.stop();
  assert.equal(timers.size, 0);

  // After unmount-style stop, start creates exactly one new interval
  rotator.start();
  assert.equal(timers.size, 1);
  rotator.stop();
  assert.equal(timers.size, 0);
}

// Background: ticks skipped while inactive — no burst on resume
{
  let advanceCount = 0;
  let active = true;
  const timers = new Map<ReturnType<typeof setInterval>, () => void>();
  let nextId = 1;

  const setIntervalFn = ((fn: () => void) => {
    const id = nextId++ as unknown as ReturnType<typeof setInterval>;
    timers.set(id, fn);
    return id;
  }) as typeof setInterval;

  const clearIntervalFn = ((id: ReturnType<typeof setInterval>) => {
    timers.delete(id);
  }) as typeof clearInterval;

  const rotator = createTrendingTaglineRotator({
    onAdvance: () => {
      advanceCount += 1;
    },
    isAppActive: () => active,
    setIntervalFn,
    clearIntervalFn,
  });

  rotator.start();
  assert.equal(timers.size, 1);

  active = false;
  for (const fn of timers.values()) fn();
  for (const fn of timers.values()) fn();
  assert.equal(advanceCount, 0, "no advances while backgrounded");

  active = true;
  // Still one timer — next single tick advances once (no catch-up)
  assert.equal(timers.size, 1);
  for (const fn of timers.values()) fn();
  assert.equal(advanceCount, 1);

  rotator.stop();
}

// Reduced-motion: index still advances via nextTrendingTaglineIndex (no motion in UI layer)
{
  let i = 0;
  i = nextTrendingTaglineIndex(i);
  assert.equal(getTrendingTaglineAt(i), TRENDING_CHALLENGE_TAGLINES[1]);
}

console.log("trendingChallengeTaglines.test.ts: all assertions passed");
