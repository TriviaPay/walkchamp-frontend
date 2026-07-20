import {
  PROGRESS_ICON_SOURCES,
  milestoneForProgress,
} from "@/services/dynamicIconService";
import type { ImageSourcePropType } from "react-native";

const DEFAULT_DAILY_GOAL = 10_000;

/** Safe today steps — never NaN/negative. */
export function safeTodaySteps(steps: unknown): number {
  const n = typeof steps === "number" ? steps : Number(steps);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.floor(n));
}

/** Safe daily goal — never zero (avoids divide-by-zero). */
export function safeDailyGoal(goal: unknown): number {
  const n = typeof goal === "number" ? goal : Number(goal);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_DAILY_GOAL;
  return Math.floor(n);
}

/** Progress ratio 0..1 and display percent 0..100. */
export function clampDailyProgress(
  steps: unknown,
  goal: unknown,
): { progress: number; percent: number; safeSteps: number; safeGoal: number } {
  const safeSteps = safeTodaySteps(steps);
  const safeGoal = safeDailyGoal(goal);
  const progress = Math.min(1, safeSteps / safeGoal);
  const percent = Math.min(100, Math.max(0, Math.round(progress * 100)));
  return { progress, percent, safeSteps, safeGoal };
}

/** Static milestone icon source with guaranteed fallback. */
export function progressIconSourceForStepsSafe(
  steps: unknown,
  goal: unknown,
): ImageSourcePropType {
  const { safeSteps, safeGoal } = clampDailyProgress(steps, goal);
  const milestone = milestoneForProgress(safeSteps, safeGoal);
  return (
    PROGRESS_ICON_SOURCES[milestone as keyof typeof PROGRESS_ICON_SOURCES] ??
    PROGRESS_ICON_SOURCES[0]
  );
}
