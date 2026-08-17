/**
 * Characterization / regression tests for step display reconciliation.
 * Imports pure core only (no React Native) so Node CI can run them.
 *
 * Locks existing behavior — do not change assertions without an intentional
 * product decision. Run: npx tsx utils/stepAccuracy.test.ts
 */

import assert from "node:assert/strict";
import {
  capWalkStepsForSyncCore,
  mergeLegacyStepUpdate,
  resolveRaceDisplayStepsCore,
  resolveTodayDisplayStepsCore,
  sanitizeLegacyProviderSteps,
  shouldAcceptStepUpdateCore,
  shouldIgnoreStepSpike,
} from "./stepAccuracyCore";
import { STEP_SYNC_CONFIG } from "@/config/stepSyncConfig";

// ── Spike rejection ──────────────────────────────────────────────────────────

assert.equal(shouldIgnoreStepSpike(100, 700, 500), true, "jump > maxJump ignored");
assert.equal(shouldIgnoreStepSpike(100, 200, 500), false, "normal walk accepted");
assert.equal(shouldIgnoreStepSpike(100, 100, 500), false, "duplicate (delta 0) not a spike");
assert.equal(shouldIgnoreStepSpike(100, 50, 500), false, "regression (delta < 0) not a spike");
assert.equal(
  shouldIgnoreStepSpike(0, STEP_SYNC_CONFIG.WALK_MAX_STEP_SPIKE + 1),
  true,
  "default maxJump from STEP_SYNC_CONFIG",
);
assert.equal(
  shouldIgnoreStepSpike(0, STEP_SYNC_CONFIG.WALK_MAX_STEP_SPIKE),
  false,
  "exact maxJump boundary accepted",
);

// ── No steps / one / multiple (display resolve) ──────────────────────────────

assert.equal(
  resolveTodayDisplayStepsCore({
    providerSteps: 0,
    backendSteps: 0,
    verifiedSource: true,
  }),
  0,
  "no steps returned → 0",
);

assert.equal(
  resolveTodayDisplayStepsCore({
    providerSteps: 42,
    backendSteps: 0,
    verifiedSource: true,
  }),
  42,
  "one valid verified record",
);

assert.equal(
  resolveTodayDisplayStepsCore({
    providerSteps: 0,
    backendSteps: 197,
    previousProviderSteps: 197,
    verifiedSource: true,
  }),
  197,
  "verified empty HC keeps backend/previous floor",
);

assert.equal(
  resolveTodayDisplayStepsCore({
    providerSteps: 0,
    backendSteps: 18496,
    previousProviderSteps: 22380,
    verifiedSource: true,
  }),
  18496,
  "reinstall: keep account DB total, drop since-boot previous",
);

assert.equal(
  resolveTodayDisplayStepsCore({
    providerSteps: 0,
    backendSteps: 0,
    previousProviderSteps: 22380,
    verifiedSource: true,
  }),
  0,
  "verified empty HC drops since-boot previous when DB is empty",
);

assert.equal(
  capWalkStepsForSyncCore(22380, 0, true, 18496),
  18496,
  "verified empty HC never re-uploads sensor UI; keeps account floor",
);

assert.equal(
  capWalkStepsForSyncCore(250, 0, true, 197),
  197,
  "verified empty HC syncs backend only — never provisional UI",
);

assert.equal(
  capWalkStepsForSyncCore(100, 0, true, 197),
  197,
  "verified empty HC never syncs below backend floor",
);

assert.equal(
  resolveTodayDisplayStepsCore({
    providerSteps: 4200,
    backendSteps: 8900,
    verifiedSource: true,
  }),
  4200,
  "verified must use provider only — never stale backend",
);

assert.equal(
  resolveTodayDisplayStepsCore({
    providerSteps: 4200,
    backendSteps: 8900,
    verifiedSource: false,
    allowBackendCatchUp: true,
  }),
  8900,
  "legacy may catch up from backend when ahead",
);

assert.equal(
  resolveTodayDisplayStepsCore({
    providerSteps: 5000,
    backendSteps: 3000,
    verifiedSource: true,
  }),
  5000,
  "provider ahead always wins for verified",
);

assert.equal(
  resolveTodayDisplayStepsCore({
    providerSteps: 1000,
    backendSteps: 2000,
    verifiedSource: false,
    allowBackendCatchUp: false,
    previousProviderSteps: 1000,
  }),
  1000,
  "legacy without catch-up keeps provider when previousProviderSteps anchors sanitize",
);

assert.equal(
  resolveTodayDisplayStepsCore({
    providerSteps: 1000,
    backendSteps: 2000,
    verifiedSource: false,
    allowBackendCatchUp: false,
  }),
  2000,
  "legacy sanitize defaults previous=backend so provider behind backend is capped up",
);

// ── Legacy sanitize (abnormal / first tick) ──────────────────────────────────

assert.equal(
  sanitizeLegacyProviderSteps(67, 0, 0),
  67,
  "first real sensor read accepted when no baseline",
);

assert.equal(
  sanitizeLegacyProviderSteps(200, 100, 100),
  200,
  "monotonic forward progress accepted",
);

assert.equal(
  sanitizeLegacyProviderSteps(50, 100, 100),
  100,
  "legacy regression capped to max(backend, previous)",
);

// ── Merge legacy (duplicates / spikes) ───────────────────────────────────────

assert.equal(mergeLegacyStepUpdate(1000, 1000).next, 1000, "duplicate ignored");
assert.equal(mergeLegacyStepUpdate(1000, 900).next, 1000, "regression ignored");
assert.equal(mergeLegacyStepUpdate(1000, 1100).next, 1100, "normal increase accepted");
assert.equal(
  mergeLegacyStepUpdate(1000, 1000 + STEP_SYNC_CONFIG.WALK_MAX_STEP_SPIKE + 1).next,
  1000,
  "spike merge ignored",
);

// ── Race display ─────────────────────────────────────────────────────────────

assert.equal(
  resolveRaceDisplayStepsCore({
    providerRaceSteps: 0,
    serverSteps: 0,
    currentUiSteps: 0,
    verifiedSource: true,
  }),
  0,
  "race not started / no steps",
);

assert.equal(
  resolveRaceDisplayStepsCore({
    providerRaceSteps: 250,
    serverSteps: 100,
    currentUiSteps: 200,
    verifiedSource: true,
  }),
  250,
  "verified race: provider range query wins when > 0",
);

assert.equal(
  resolveRaceDisplayStepsCore({
    providerRaceSteps: 0,
    serverSteps: 180,
    currentUiSteps: 150,
    verifiedSource: true,
  }),
  180,
  "verified race: provider 0 falls back to max(ui, server)",
);

assert.equal(
  resolveRaceDisplayStepsCore({
    providerRaceSteps: 50,
    serverSteps: 200,
    currentUiSteps: 80,
    verifiedSource: false,
  }),
  200,
  "legacy race: max(provider, server, ui)",
);

// ── Sync cap (never POST inflated UI) ────────────────────────────────────────

assert.equal(
  capWalkStepsForSyncCore(9000, 4200, true),
  4200,
  "verified sync capped to provider",
);

assert.equal(
  capWalkStepsForSyncCore(3000, 4200, true),
  3000,
  "verified sync uses ui when below provider",
);

assert.equal(
  capWalkStepsForSyncCore(100, null, true),
  100,
  "verified with null provider returns ui",
);

// ── Stale update rejection ───────────────────────────────────────────────────

const baseCurrent = {
  userId: "user-a",
  todaySteps: 1000,
  raceSteps: 200,
  todayStepsLastUpdatedAt: "2026-07-22T10:00:00.000Z",
  raceStepsLastUpdatedAt: "2026-07-22T10:00:00.000Z",
};

assert.equal(
  shouldAcceptStepUpdateCore(
    { userId: "user-b", todaySteps: 5000, updatedAt: "2026-07-22T10:01:00.000Z" },
    baseCurrent,
  ),
  false,
  "reject update for a different user",
);

assert.equal(
  shouldAcceptStepUpdateCore({ userId: "user-a", todaySteps: 1100 }, baseCurrent),
  false,
  "reject update missing updatedAt",
);

assert.equal(
  shouldAcceptStepUpdateCore(
    { userId: "user-a", todaySteps: 900, updatedAt: "2026-07-22T10:01:00.000Z" },
    baseCurrent,
  ),
  false,
  "reject todaySteps regression",
);

assert.equal(
  shouldAcceptStepUpdateCore(
    { userId: "user-a", todaySteps: 0, updatedAt: "2026-07-22T10:01:00.000Z" },
    baseCurrent,
    { allowTodayDecrease: true },
  ),
  true,
  "allow verified HC/HK to re-anchor inflated todaySteps down to 0",
);

assert.equal(
  shouldAcceptStepUpdateCore(
    { userId: "user-a", raceSteps: 100, updatedAt: "2026-07-22T10:01:00.000Z" },
    baseCurrent,
  ),
  false,
  "reject raceSteps regression",
);

assert.equal(
  shouldAcceptStepUpdateCore(
    { userId: "user-a", todaySteps: 1500, updatedAt: "2026-07-22T09:59:00.000Z" },
    baseCurrent,
  ),
  false,
  "reject stale timestamp older than current todaySteps",
);

assert.equal(
  shouldAcceptStepUpdateCore(
    { userId: "user-a", todaySteps: 1500, updatedAt: "2026-07-22T10:01:00.000Z" },
    baseCurrent,
  ),
  true,
  "accept newer monotonic todaySteps",
);

assert.equal(
  shouldAcceptStepUpdateCore(
    { userId: "user-a", raceSteps: 250, updatedAt: "2026-07-22T10:01:00.000Z" },
    baseCurrent,
  ),
  true,
  "accept newer monotonic raceSteps",
);

console.log("stepAccuracy.test.ts — all assertions passed");
