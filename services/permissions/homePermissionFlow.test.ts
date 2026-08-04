/**
 * Run: npx tsx services/permissions/homePermissionFlow.test.ts
 */
import assert from "node:assert/strict";
import {
  isHomeStepSetupPhaseDone,
  markHomeStepSetupPhaseDone,
  resetHomePermissionFlow,
  resetHomePermissionFlowForTests,
  resetHomePermissionFlowSoft,
  setHomeStepSetupInProgress,
  isHomeStepSetupInProgress,
} from "./homePermissionFlow";

resetHomePermissionFlowForTests();

markHomeStepSetupPhaseDone();
assert.equal(isHomeStepSetupPhaseDone(), true);

// Soft logout reset must NOT clear phase-done (avoids re-prompt when OS already granted).
setHomeStepSetupInProgress(true);
resetHomePermissionFlowSoft();
assert.equal(isHomeStepSetupPhaseDone(), true);
assert.equal(isHomeStepSetupInProgress(), false);

// Hard reset (tests) clears phase-done.
resetHomePermissionFlow();
assert.equal(isHomeStepSetupPhaseDone(), false);

// With phase not done, in-progress flag is observable.
setHomeStepSetupInProgress(true);
assert.equal(isHomeStepSetupInProgress(), true);

console.log("homePermissionFlow.test.ts: ok");
