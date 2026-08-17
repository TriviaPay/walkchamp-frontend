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
  subscribeHomeStepSetupDone,
  registerHomeStepSetupOpener,
  registerHomeStepGrantHandler,
  requestHomeStepAccess,
  setHomeStepSetupShellReady,
  homeStepSetupCountsAsLater,
} from "./homePermissionFlow";

resetHomePermissionFlowForTests();

markHomeStepSetupPhaseDone();
assert.equal(isHomeStepSetupPhaseDone(), true);

resetHomePermissionFlowForTests();
let setupDone = 0;
const unsub = subscribeHomeStepSetupDone(() => {
  setupDone += 1;
});
markHomeStepSetupPhaseDone();
assert.equal(setupDone, 1);
unsub();
markHomeStepSetupPhaseDone();
assert.equal(setupDone, 1);

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

resetHomePermissionFlowForTests();
setHomeStepSetupShellReady(true);
let wizardOpens = 0;
let grantOnly = 0;
registerHomeStepSetupOpener(() => {
  wizardOpens += 1;
});
registerHomeStepGrantHandler(() => {
  grantOnly += 1;
});
requestHomeStepAccess({
  verificationStatus: "permission_required",
  healthConnectAvailable: true,
  readStepsPermissionGranted: false,
});
assert.equal(grantOnly, 1, "permission re-grant must skip the full wizard");
assert.equal(wizardOpens, 0);
requestHomeStepAccess({
  verificationStatus: "provider_required",
  healthConnectAvailable: true,
  readStepsPermissionGranted: true,
});
assert.equal(wizardOpens, 1, "writer setup still uses the full wizard");
assert.equal(grantOnly, 1);
assert.equal(homeStepSetupCountsAsLater(), false, "Walk/Profile access must not count as Maybe Later");

console.log("homePermissionFlow.test.ts: ok");
