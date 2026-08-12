/**
 * Shared WalkChamp image assets for steps / streak / challenge UI marks.
 */

export const FOOTSTEP_IMG = require("@/assets/images/footstep.png") as number;
export const CHALLENGE_IMG = require("@/assets/images/challenge.png") as number;
export const STREAK_ON_IMG = require("@/assets/images/streak.png") as number;
export const STREAK_DARK_IMG = require("@/assets/images/streakdark.png") as number;
export const STREAK_LIGHT_IMG = require("@/assets/images/streaklight.png") as number;

/**
 * Streak mark:
 * - completed / active streak → bright `streak.png`
 * - incomplete / failed → `streakdark` (dark theme) or `streaklight` (light theme)
 */
export function streakIconSource(opts: {
  completed: boolean;
  isDark: boolean;
}): number {
  if (opts.completed) return STREAK_ON_IMG;
  return opts.isDark ? STREAK_DARK_IMG : STREAK_LIGHT_IMG;
}
