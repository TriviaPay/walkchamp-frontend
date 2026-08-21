/**
 * Architecture lifecycle matrix — supported (HC) vs unsupported (sensor).
 * Run: npx tsx platform/steps/stepArchitecture.lifecycle.test.ts
 *
 * Lanes:
 *   verified daily = Health Connect / HealthKit → POST /api/walk/steps
 *   provisional    = TYPE_STEP_COUNTER / CMPedometer → display / live only
 * Never treat since-boot counter as today's total. Never POST sensor as verified.
 */
import assert from "node:assert/strict";
import {
  accountVerifiedFloor,
  looksLikeSinceBootCounter,
  resolveWalkNotificationSteps,
  shouldAcceptVerifiedZero,
} from "./walkDisplaySteps";
import {
  capWalkStepsForSyncCore,
  resolveTodayDisplayStepsCore,
} from "@/utils/stepAccuracyCore";
import { decideVerifiedDailySync } from "./hybridStepState";
import { resolvePaidChallengeEligibility } from "./stepTrackingCapabilityLogic";

const SINCE_BOOT = 22380;

function display(opts: {
  hc: number;
  db: number;
  sensor: number;
  supported: boolean;
  sensorTotal?: number;
  dailyBaseline?: number | null;
  raceActive?: boolean;
}): number {
  const verified = opts.supported ? opts.hc : accountVerifiedFloor(opts.hc, opts.db);
  return resolveWalkNotificationSteps({
    verifiedTodaySteps: verified,
    provisionalSensorTodaySteps: opts.sensor,
    todaySteps: opts.sensor,
    raceActive: opts.raceActive,
    verifiedAuthoritative: opts.supported,
    sensorTotal: opts.sensorTotal,
    dailyBaseline: opts.dailyBaseline,
  });
}

// ── Supported: uninstall / reinstall ────────────────────────────────────────
assert.equal(
  display({ hc: 0, db: 0, sensor: SINCE_BOOT, supported: true, sensorTotal: SINCE_BOOT }),
  0,
  "supported reinstall: empty HC + since-boot → 0",
);
assert.equal(
  display({ hc: 0, db: 18496, sensor: SINCE_BOOT, supported: true, sensorTotal: SINCE_BOOT }),
  0,
  "supported reinstall: Daily Walk is Health Connect only — no DB fallback",
);
assert.equal(
  capWalkStepsForSyncCore(SINCE_BOOT, 0, true, 18496),
  18496,
  "supported: never POST since-boot as verified; keep account floor",
);
assert.equal(
  decideVerifiedDailySync({
    authenticated: true,
    localDateValid: true,
    trackingComplete: true,
    verifiedTodaySteps: 0,
    displayTodaySteps: SINCE_BOOT,
    lastHcProviderSteps: 0,
    providerQueryStatus: "empty",
    backendTodaySteps: 18496,
    lastSyncedSteps: 18496,
    syncTotalAfterCap: 18496,
    platform: "android",
  }).action,
  "preserve_backend",
  "supported: empty HC preserves account DB, does not submit sensor UI",
);

// ── Supported: close / open (same day) ──────────────────────────────────────
assert.equal(
  display({
    hc: 3563,
    db: 3563,
    sensor: 3610,
    supported: true,
    sensorTotal: SINCE_BOOT,
    dailyBaseline: SINCE_BOOT - 3610,
  }),
  3563,
  "supported resume: Walk daily stays on Health Connect, not sensor session",
);
assert.equal(
  display({
    hc: 3563,
    db: 3563,
    sensor: SINCE_BOOT,
    supported: true,
    sensorTotal: SINCE_BOOT,
  }),
  3563,
  "supported resume: since-boot does not replace HC",
);

// ── Supported: midnight ─────────────────────────────────────────────────────
assert.equal(
  shouldAcceptVerifiedZero({ incomingSteps: 0, previousSteps: 9953, freshLocalDay: true }),
  true,
  "midnight: HC 0 may clear yesterday",
);
assert.equal(
  shouldAcceptVerifiedZero({ incomingSteps: 0, previousSteps: 9953, freshLocalDay: false }),
  false,
  "mid-day empty HC poll must not wipe a known total",
);
assert.equal(
  display({
    hc: 0,
    db: 0,
    sensor: 9953,
    supported: true,
    sensorTotal: 9953,
  }),
  0,
  "midnight leftover since-boot stays off Daily Walk / notification",
);
assert.equal(
  display({
    hc: 0,
    db: 0,
    sensor: 3610,
    supported: true,
    sensorTotal: SINCE_BOOT,
    dailyBaseline: SINCE_BOOT - 3610,
    raceActive: false,
  }),
  0,
  "after a finished race, Daily Walk stays on Health Connect (0 until HC has today's total)",
);
assert.equal(
  resolveTodayDisplayStepsCore({
    providerSteps: 0,
    backendSteps: 0,
    previousProviderSteps: 9953,
    verifiedSource: true,
  }),
  0,
  "midnight hydrate: drop leftover previous when HC+DB are 0",
);

// ── Unsupported: uninstall / reinstall ──────────────────────────────────────
assert.equal(
  looksLikeSinceBootCounter({ todaySteps: SINCE_BOOT, sensorTotal: SINCE_BOOT }),
  true,
);
assert.equal(
  display({
    hc: 0,
    db: 0,
    sensor: SINCE_BOOT,
    supported: false,
    sensorTotal: SINCE_BOOT,
  }),
  0,
  "unsupported reinstall: since-boot is not today's walk",
);
assert.equal(
  capWalkStepsForSyncCore(SINCE_BOOT, SINCE_BOOT, false, 0),
  SINCE_BOOT,
  "unsupported cap is display-only — caller must not POST as health_connect",
);
assert.equal(
  resolvePaidChallengeEligibility({
    verifiedHealthAvailable: false,
    verificationStatus: "unsupported",
  }),
  "unsupported",
  "unsupported devices cannot join prize challenges",
);

// ── Unsupported: live session after a real daily baseline ───────────────────
assert.equal(
  display({
    hc: 0,
    db: 0,
    sensor: 420,
    supported: false,
    sensorTotal: SINCE_BOOT,
    dailyBaseline: SINCE_BOOT - 420,
  }),
  420,
  "unsupported: real session today << sensorTotal shows on Walk + tray",
);

// ── Close/open must not confuse a real session with since-boot ──────────────
assert.equal(
  looksLikeSinceBootCounter({
    todaySteps: 420,
    sensorTotal: SINCE_BOOT,
    dailyBaseline: SINCE_BOOT - 420,
  }),
  false,
  "close/open: anchored daily session is not since-boot",
);

console.log("stepArchitecture.lifecycle.test.ts: ok");
