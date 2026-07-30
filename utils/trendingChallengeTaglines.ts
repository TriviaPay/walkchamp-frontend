/**
 * Trending Challenges section taglines — Walk tab subtitle rotation.
 */

export const TRENDING_CHALLENGE_TAGLINES = [
  "Cash races everyone is joining right now",
  "Compete for exciting prizes in trending races",
  "Join fast-growing races before they begin",
  "Choose a challenge, start walking and win",
  "Join the hottest cash challenges before they start",
] as const;

export type TrendingChallengeTagline = (typeof TRENDING_CHALLENGE_TAGLINES)[number];

/** Rotate subtitle every 60 seconds. */
export const TRENDING_TAGLINE_ROTATE_MS = 60_000;

/** Fade + slide duration (ms) for each half of the crossfade. */
export const TRENDING_TAGLINE_ANIM_MS = 350;

/** Upward slide distance in px during transition. */
export const TRENDING_TAGLINE_SLIDE_PX = 5;

/** Reserved one-line subtitle height — prevents layout shift. */
export const TRENDING_TAGLINE_LINE_HEIGHT = 16;

export function getTrendingTaglineCount(): number {
  return TRENDING_CHALLENGE_TAGLINES.length;
}

export function getTrendingTaglineAt(index: number): TrendingChallengeTagline {
  const n = TRENDING_CHALLENGE_TAGLINES.length;
  const i = ((index % n) + n) % n;
  return TRENDING_CHALLENGE_TAGLINES[i]!;
}

/** Sequential next index: 0→1→2→3→4→0. Never randomizes. */
export function nextTrendingTaglineIndex(current: number): number {
  const n = TRENDING_CHALLENGE_TAGLINES.length;
  return (((current % n) + n) % n + 1) % n;
}

export type TrendingTaglineRotator = {
  start: () => void;
  stop: () => void;
  isRunning: () => boolean;
};

/**
 * Single-interval rotator. Calling start() twice does not create a second timer.
 * While `isAppActive` returns false, ticks are skipped (no catch-up burst on resume).
 */
export function createTrendingTaglineRotator(opts: {
  intervalMs?: number;
  onAdvance: () => void;
  isAppActive?: () => boolean;
  setIntervalFn?: typeof setInterval;
  clearIntervalFn?: typeof clearInterval;
}): TrendingTaglineRotator {
  const intervalMs = opts.intervalMs ?? TRENDING_TAGLINE_ROTATE_MS;
  const setIntervalFn = opts.setIntervalFn ?? setInterval;
  const clearIntervalFn = opts.clearIntervalFn ?? clearInterval;
  let timer: ReturnType<typeof setInterval> | null = null;

  return {
    start() {
      if (timer != null) return;
      timer = setIntervalFn(() => {
        if (opts.isAppActive && !opts.isAppActive()) return;
        opts.onAdvance();
      }, intervalMs);
    },
    stop() {
      if (timer == null) return;
      clearIntervalFn(timer);
      timer = null;
    },
    isRunning() {
      return timer != null;
    },
  };
}
