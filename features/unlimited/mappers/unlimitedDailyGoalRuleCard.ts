/**
 * Copy + theme tokens for the Unlimited Review “Daily Goal Rule” banner.
 * Pure helpers — safe for Node unit tests.
 */

import type { RoomVisibilityTheme } from "@/constants/createChallengeTheme";
import {
  DAILY_GOAL_BANNER_EXPAND,
  DAILY_GOAL_BANNER_EXPAND_BULLETS,
  DAILY_GOAL_BANNER_PRIMARY,
  DAILY_GOAL_BANNER_SECONDARY,
} from "@/utils/createChallengeCheckout";

export const DAILY_GOAL_RULE_TITLE = "Daily Goal Rule";

export const DAILY_GOAL_RULE_PRIMARY = DAILY_GOAL_BANNER_PRIMARY;

export const DAILY_GOAL_RULE_SECONDARY = DAILY_GOAL_BANNER_SECONDARY;

export const DAILY_GOAL_RULE_EXPAND_PROMPT = DAILY_GOAL_BANNER_EXPAND;

export const DAILY_GOAL_RULE_EXPAND_BULLETS = DAILY_GOAL_BANNER_EXPAND_BULLETS;

export const DAILY_GOAL_RULE_A11Y_LABEL =
  "Daily Goal Rule. Complete your daily goal every day.";

/** Soft pulse cycles after entrance (not infinite). */
export const DAILY_GOAL_RULE_PULSE_CYCLES = 3;

export type DailyGoalRuleTheme = {
  key: RoomVisibilityTheme;
  gradient: readonly [string, string, string];
  border: string;
  icon: string;
  primaryText: string;
  glow: string;
};

export const DAILY_GOAL_RULE_THEMES: Record<RoomVisibilityTheme, DailyGoalRuleTheme> = {
  public: {
    key: "public",
    gradient: ["#062F56", "#083D76", "#173B91"],
    border: "#13C8FF",
    icon: "#42E6FF",
    primaryText: "#6BEAFF",
    glow: "rgba(19, 200, 255, 0.28)",
  },
  private: {
    key: "private",
    gradient: ["#2C1859", "#512080", "#791B91"],
    border: "#C33EFF",
    icon: "#E68BFF",
    primaryText: "#F09BFF",
    glow: "rgba(195, 62, 255, 0.28)",
  },
};

export function selectDailyGoalRuleTheme(visibility: RoomVisibilityTheme): DailyGoalRuleTheme {
  return DAILY_GOAL_RULE_THEMES[visibility] ?? DAILY_GOAL_RULE_THEMES.public;
}

/** Only Unlimited Review (Step 5) shows this card — Fixed never does. */
export function shouldShowDailyGoalRuleCard(opts: {
  isUnlimited: boolean;
  step: number;
}): boolean {
  return opts.isUnlimited && opts.step === 5;
}
