/**
 * Run: npx tsx platform/steps/stepSetupPromptDecision.test.ts
 */
import assert from "node:assert/strict";
import {
  applyDeviceSetupCompleted,
  applyDeviceSetupLater,
  decideStepSetupPrompt,
  emptyDeviceStepSetupRecord,
  isDeviceRaceViewOnly,
  parseDeviceStepSetupRecord,
  STEP_SETUP_LATER_SNOOZE_MS,
} from "./stepSetupPromptDecision";

assert.equal(
  decideStepSetupPrompt({
    osStepAccessGranted: true,
    deviceSetupCompleted: true,
    healthConnectMissingOrNeedsUpdate: false,
    laterCount: 0,
    snoozeUntilMs: 0,
  }),
  "skip_silent",
  "other account on an already-enabled device must not re-prompt",
);

assert.equal(
  decideStepSetupPrompt({
    osStepAccessGranted: true,
    deviceSetupCompleted: false,
    healthConnectMissingOrNeedsUpdate: false,
    laterCount: 2,
    snoozeUntilMs: 0,
  }),
  "skip_silent",
  "OS grant on this device wins even after two Maybes",
);

assert.equal(
  decideStepSetupPrompt({
    osStepAccessGranted: false,
    deviceSetupCompleted: false,
    healthConnectMissingOrNeedsUpdate: false,
    laterCount: 0,
    snoozeUntilMs: 0,
  }),
  "full_wizard",
  "fresh install / other device asks once",
);

assert.equal(
  decideStepSetupPrompt({
    osStepAccessGranted: false,
    deviceSetupCompleted: false,
    healthConnectMissingOrNeedsUpdate: false,
    laterCount: 1,
    snoozeUntilMs: 1_000,
    nowMs: 500,
  }),
  "skip_silent",
  "first Maybe Later snoozes auto-prompt",
);

assert.equal(
  decideStepSetupPrompt({
    osStepAccessGranted: false,
    deviceSetupCompleted: false,
    healthConnectMissingOrNeedsUpdate: false,
    laterCount: 1,
    snoozeUntilMs: 1_000,
    nowMs: 1_000 + STEP_SETUP_LATER_SNOOZE_MS,
  }),
  "full_wizard",
  "after the gap, ask again",
);

assert.equal(
  decideStepSetupPrompt({
    osStepAccessGranted: false,
    deviceSetupCompleted: false,
    healthConnectMissingOrNeedsUpdate: false,
    laterCount: 2,
    snoozeUntilMs: 0,
    nowMs: Date.now(),
  }),
  "skip_silent",
  "second Maybe Later stops auto-prompt (view-only races)",
);

assert.equal(
  decideStepSetupPrompt({
    osStepAccessGranted: false,
    deviceSetupCompleted: true,
    healthConnectMissingOrNeedsUpdate: false,
    laterCount: 0,
    snoozeUntilMs: 0,
  }),
  "grant_only",
  "revoked after device setup → grant sheet, not full wizard",
);

assert.equal(
  isDeviceRaceViewOnly({
    osStepAccessGranted: false,
    laterCount: 2,
    deviceSetupCompleted: false,
  }),
  true,
);

assert.equal(
  isDeviceRaceViewOnly({
    osStepAccessGranted: true,
    laterCount: 2,
    deviceSetupCompleted: false,
  }),
  false,
  "enabled device can race even if Later was tapped before",
);

assert.deepEqual(parseDeviceStepSetupRecord(true), applyDeviceSetupCompleted());
assert.equal(parseDeviceStepSetupRecord(null).laterCount, 0);

const firstLater = applyDeviceSetupLater(emptyDeviceStepSetupRecord(), 1_000, 50);
assert.equal(firstLater.laterCount, 1);
assert.equal(firstLater.snoozeUntilMs, 1_050);
const secondLater = applyDeviceSetupLater(firstLater, 2_000, 50);
assert.equal(secondLater.laterCount, 2);
assert.equal(secondLater.snoozeUntilMs, 0);
assert.equal(applyDeviceSetupLater(applyDeviceSetupCompleted(), 1).laterCount, 0);

console.log("stepSetupPromptDecision.test.ts: ok");
