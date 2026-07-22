/**
 * Characterization tests for pure dynamic app-icon selection.
 * Run: npx tsx utils/dynamicAppIcon.test.ts
 */

import assert from "node:assert/strict";
import {
  DYNAMIC_APP_ICON_KEYS,
  iconForMilestone,
  milestoneForIconName,
  milestoneForProgress,
  milestoneFromPercent,
  normalizeDynamicAppIcon,
  selectDynamicAppIcon,
  shouldReplacePendingIcon,
} from "./dynamicAppIcon";

function eq(actual: unknown, expected: unknown, label: string): void {
  assert.equal(actual, expected, label);
}

// Zero / invalid
eq(milestoneForProgress(0, 10_000), 0, "zero steps");
eq(milestoneForProgress(-5, 10_000), 0, "negative steps");
eq(milestoneForProgress(Number.NaN, 10_000), 0, "NaN steps");
eq(milestoneForProgress(5000, 0), 0, "zero goal");
eq(milestoneForProgress(5000, -1), 0, "negative goal");

// Exact boundaries (floor percent)
eq(milestoneForProgress(2499, 10_000), 0, "just below 25%");
eq(milestoneForProgress(2500, 10_000), 25, "exact 25%");
eq(milestoneForProgress(2501, 10_000), 25, "just above 25%");
eq(milestoneForProgress(4999, 10_000), 25, "just below 50%");
eq(milestoneForProgress(5000, 10_000), 50, "exact 50%");
eq(milestoneForProgress(5001, 10_000), 50, "just above 50%");
eq(milestoneForProgress(7499, 10_000), 50, "just below 75%");
eq(milestoneForProgress(7500, 10_000), 75, "exact 75%");
eq(milestoneForProgress(7501, 10_000), 75, "just above 75%");
eq(milestoneForProgress(9999, 10_000), 75, "just below 100%");
eq(milestoneForProgress(10_000, 10_000), 100, "exact goal");
eq(milestoneForProgress(12_000, 10_000), 100, "above goal");

// Percent helper
eq(milestoneFromPercent(24), 0, "pct 24");
eq(milestoneFromPercent(25), 25, "pct 25");
eq(milestoneFromPercent(100), 100, "pct 100");
eq(milestoneFromPercent(-10), 0, "pct negative");

// Icon keys
eq(selectDynamicAppIcon(0, 10_000), "WalkChampProgress0", "select 0");
eq(selectDynamicAppIcon(2500, 10_000), "WalkChampProgress25", "select 25");
eq(selectDynamicAppIcon(5000, 10_000), "WalkChampProgress50", "select 50");
eq(selectDynamicAppIcon(7500, 10_000), "WalkChampProgress75", "select 75");
eq(selectDynamicAppIcon(10_000, 10_000), "WalkChampProgress100", "select 100");

eq(iconForMilestone(0), "WalkChampProgress0", "icon 0");
eq(iconForMilestone(100), "WalkChampProgress100", "icon 100");
eq(milestoneForIconName("WalkChampProgress50"), 50, "milestone from name");

// Legacy migration
eq(normalizeDynamicAppIcon("default"), "WalkChampProgress0", "legacy default");
eq(normalizeDynamicAppIcon("progress_75"), "WalkChampProgress75", "legacy progress_75");
eq(normalizeDynamicAppIcon("completed"), "WalkChampProgress100", "legacy completed");
eq(normalizeDynamicAppIcon("bogus"), "WalkChampProgress0", "invalid → default");
eq(normalizeDynamicAppIcon(null), "WalkChampProgress0", "null → default");

// Duplicate / pending coalesce
eq(
  shouldReplacePendingIcon("WalkChampProgress25", "WalkChampProgress25"),
  false,
  "duplicate pending ignored",
);
eq(
  shouldReplacePendingIcon("WalkChampProgress25", "WalkChampProgress50"),
  true,
  "upgrade pending",
);
eq(
  shouldReplacePendingIcon("WalkChampProgress50", "WalkChampProgress25"),
  false,
  "downgrade pending blocked",
);
eq(
  shouldReplacePendingIcon("WalkChampProgress50", "WalkChampProgress25", {
    force: true,
  }),
  true,
  "force allows downgrade",
);
eq(
  shouldReplacePendingIcon(null, "WalkChampProgress0"),
  true,
  "null pending accepts",
);

// Platform mapping stability — keys match native registrations
assert.deepEqual(
  [...DYNAMIC_APP_ICON_KEYS],
  [
    "WalkChampProgress0",
    "WalkChampProgress25",
    "WalkChampProgress50",
    "WalkChampProgress75",
    "WalkChampProgress100",
  ],
  "icon key set matches Android aliases / iOS alternate names",
);

// Rapid consecutive: latest higher milestone wins
{
  let pending: ReturnType<typeof selectDynamicAppIcon> | null = null;
  for (const steps of [1000, 3000, 6000, 8000, 11_000]) {
    const next = selectDynamicAppIcon(steps, 10_000);
    if (shouldReplacePendingIcon(pending, next)) pending = next;
  }
  eq(pending, "WalkChampProgress100", "rapid updates → latest highest");
}

console.log("dynamicAppIcon.test.ts — all assertions passed");
