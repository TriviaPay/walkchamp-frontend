/**
 * Pure dynamic app-icon selection — step milestone → icon key.
 * Keep thresholds identical to the historical 0 / 25 / 50 / 75 / 100 % mapping.
 */

export const DYNAMIC_APP_ICON_KEYS = [
  "WalkChampProgress0",
  "WalkChampProgress25",
  "WalkChampProgress50",
  "WalkChampProgress75",
  "WalkChampProgress100",
] as const;

export type DynamicAppIcon = (typeof DYNAMIC_APP_ICON_KEYS)[number];

export type DynamicAppIconMilestone = 0 | 25 | 50 | 75 | 100;

export const ICON_FOR_MILESTONE: Record<DynamicAppIconMilestone, DynamicAppIcon> = {
  0: "WalkChampProgress0",
  25: "WalkChampProgress25",
  50: "WalkChampProgress50",
  75: "WalkChampProgress75",
  100: "WalkChampProgress100",
};

export const MILESTONE_FOR_ICON: Record<DynamicAppIcon, DynamicAppIconMilestone> = {
  WalkChampProgress0: 0,
  WalkChampProgress25: 25,
  WalkChampProgress50: 50,
  WalkChampProgress75: 75,
  WalkChampProgress100: 100,
};

const LEGACY_ICON_ALIASES: Record<string, DynamicAppIcon> = {
  default: "WalkChampProgress0",
  progress_0: "WalkChampProgress0",
  progress_25: "WalkChampProgress25",
  progress_50: "WalkChampProgress50",
  progress_75: "WalkChampProgress75",
  progress_100: "WalkChampProgress100",
  completed: "WalkChampProgress100",
};

export function isDynamicAppIcon(value: unknown): value is DynamicAppIcon {
  return (
    typeof value === "string" &&
    (DYNAMIC_APP_ICON_KEYS as readonly string[]).includes(value)
  );
}

/** Migrate legacy / invalid stored keys to a known icon. */
export function normalizeDynamicAppIcon(value: unknown): DynamicAppIcon {
  if (isDynamicAppIcon(value)) return value;
  if (typeof value === "string") {
    const aliased = LEGACY_ICON_ALIASES[value];
    if (aliased) return aliased;
  }
  return "WalkChampProgress0";
}

export function milestoneFromPercent(pct: number): DynamicAppIconMilestone {
  if (!Number.isFinite(pct) || pct < 0) return 0;
  if (pct >= 100) return 100;
  if (pct >= 75) return 75;
  if (pct >= 50) return 50;
  if (pct >= 25) return 25;
  return 0;
}

/**
 * Select milestone from verified daily steps + goal.
 * Invalid / non-finite / negative steps → 0. Goal ≤ 0 → 0.
 */
export function milestoneForProgress(steps: number, goal: number): DynamicAppIconMilestone {
  if (!Number.isFinite(goal) || goal <= 0) return 0;
  const safeSteps = Number.isFinite(steps) ? Math.max(0, Math.floor(steps)) : 0;
  const pct = Math.min(100, Math.floor((safeSteps / goal) * 100));
  return milestoneFromPercent(pct);
}

export function iconForMilestone(milestone: number): DynamicAppIcon {
  if (milestone >= 100) return ICON_FOR_MILESTONE[100];
  if (milestone >= 75) return ICON_FOR_MILESTONE[75];
  if (milestone >= 50) return ICON_FOR_MILESTONE[50];
  if (milestone >= 25) return ICON_FOR_MILESTONE[25];
  return ICON_FOR_MILESTONE[0];
}

export function milestoneForIconName(iconName: string): DynamicAppIconMilestone {
  const normalized = normalizeDynamicAppIcon(iconName);
  return MILESTONE_FOR_ICON[normalized];
}

/** Single entry point: verified steps → icon key. */
export function selectDynamicAppIcon(steps: number, goal: number): DynamicAppIcon {
  return iconForMilestone(milestoneForProgress(steps, goal));
}

/**
 * Latest-wins coalescing for concurrent icon requests.
 * Returns whether `candidate` should replace `currentPending`.
 */
export function shouldReplacePendingIcon(
  currentPending: DynamicAppIcon | null,
  candidate: DynamicAppIcon,
  opts?: { force?: boolean; allowDowngrade?: boolean },
): boolean {
  if (!currentPending) return true;
  if (currentPending === candidate) return false;
  if (opts?.force || opts?.allowDowngrade) return true;
  return milestoneForIconName(candidate) >= milestoneForIconName(currentPending);
}
