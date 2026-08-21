/**
 * Run: npx tsx utils/unlimitedLiveDayContext.test.ts
 */
import assert from "node:assert/strict";
import {
  isClassicLiveRaceRowForRestore,
  mergeUnlimitedSelfHydrateSteps,
  resolveUnlimitedLiveDayContext,
  resolveUnlimitedViewerDisplaySteps,
  shouldNativeSyncClassicRaceProgress,
  shouldPauseWalkBackendSync,
} from "./unlimitedLiveDayContext";
import { resolveUnlimitedDisplayedLiveSteps } from "./unlimitedHybridProgress";

// ── Day key: participant wins over host race key ─────────────────────────────
{
  const ctx = resolveUnlimitedLiveDayContext({
    participantChallengeDayKey: "2026-08-10",
    participantTimezone: "Asia/Kolkata",
    raceChallengeDayKey: "2026-08-09",
    raceChallengeTimezone: "America/Chicago",
  });
  assert.ok(ctx);
  assert.equal(ctx!.challengeDayKey, "2026-08-10");
  assert.equal(ctx!.timezone, "Asia/Kolkata");
  assert.equal(ctx!.source, "participant");
}

{
  const ctx = resolveUnlimitedLiveDayContext({
    raceChallengeDayKey: "2026-08-09",
    raceChallengeTimezone: "America/Chicago",
    deviceTimezone: "Asia/Kolkata",
  });
  assert.ok(ctx);
  assert.equal(ctx!.source, "race");
  assert.equal(ctx!.timezone, "America/Chicago");
}

{
  const ctx = resolveUnlimitedLiveDayContext({
    formattedDeviceDayKey: "2026-08-10",
    deviceTimezone: "Asia/Kolkata",
  });
  assert.ok(ctx);
  assert.equal(ctx!.source, "device");
  assert.equal(ctx!.challengeDayKey, "2026-08-10");
}

assert.equal(resolveUnlimitedLiveDayContext({}), null);

// ── Walk pause policy: daily walk / streak keep posting during a live race ──
assert.equal(
  shouldPauseWalkBackendSync({ classicLiveRaceActive: true, unlimitedDailyModeActive: false }),
  false,
);
assert.equal(
  shouldPauseWalkBackendSync({ classicLiveRaceActive: true, unlimitedDailyModeActive: true }),
  false,
);
assert.equal(
  shouldPauseWalkBackendSync({ classicLiveRaceActive: false, unlimitedDailyModeActive: true }),
  false,
);

// ── Viewer day gate ──────────────────────────────────────────────────────────
assert.equal(
  resolveUnlimitedViewerDisplaySteps({
    viewerStatus: "scheduled",
    displayedLiveSteps: 451,
  }),
  0,
);
assert.equal(
  resolveUnlimitedViewerDisplaySteps({
    viewerStatus: "active",
    displayedLiveSteps: 451,
  }),
  451,
);

// Dual-lane display still rejects wild provisional; then viewer gate zeros scheduled.
{
  const dual = resolveUnlimitedDisplayedLiveSteps(100, 2000);
  assert.equal(dual, 100);
  assert.equal(
    resolveUnlimitedViewerDisplaySteps({ viewerStatus: "scheduled", displayedLiveSteps: dual }),
    0,
  );
}

// ── Self hydrate merge ───────────────────────────────────────────────────────
assert.equal(
  mergeUnlimitedSelfHydrateSteps({
    viewerDayStarted: false,
    localDailySteps: 461,
    serverTodaySteps: 0,
  }),
  0,
);
assert.equal(
  mergeUnlimitedSelfHydrateSteps({
    viewerDayStarted: true,
    localDailySteps: 461,
    serverTodaySteps: 200,
  }),
  461,
);

// ── Classic restore filter ───────────────────────────────────────────────────
assert.equal(
  isClassicLiveRaceRowForRestore({
    id: "ul-1",
    status: "in_progress",
    challengeType: "unlimited_goal",
  }),
  false,
);
assert.equal(
  isClassicLiveRaceRowForRestore({
    id: "race-1",
    status: "in_progress",
    entryType: "free",
  }),
  true,
);

// ── Native classic progress skip ─────────────────────────────────────────────
assert.equal(
  shouldNativeSyncClassicRaceProgress({ unlimitedDailyMode: true }),
  false,
);
assert.equal(
  shouldNativeSyncClassicRaceProgress({ isUnlimitedChallengeIdBlocked: true }),
  false,
);
assert.equal(
  shouldNativeSyncClassicRaceProgress({ unlimitedDailyMode: false }),
  true,
);

console.log("unlimitedLiveDayContext.test.ts: ok");
