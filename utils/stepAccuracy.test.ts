/**
 * Unit tests for step display reconciliation.
 * Run from frontend/: npx tsx utils/stepAccuracy.test.ts
 */

import assert from "node:assert/strict";
import {
  resolveTodayDisplaySteps,
  shouldIgnoreStepSpike,
} from "./stepAccuracy";

assert.equal(
  resolveTodayDisplaySteps({
    providerSteps: 4200,
    backendSteps: 8900,
    verifiedSource: true,
  }),
  4200,
  "verified must use provider only — never stale backend",
);

assert.equal(
  resolveTodayDisplaySteps({
    providerSteps: 4200,
    backendSteps: 8900,
    verifiedSource: false,
    allowBackendCatchUp: true,
  }),
  8900,
  "legacy may catch up from backend when ahead",
);

assert.equal(
  resolveTodayDisplaySteps({
    providerSteps: 5000,
    backendSteps: 3000,
    verifiedSource: true,
  }),
  5000,
  "provider ahead always wins for verified",
);

assert.equal(shouldIgnoreStepSpike(100, 700, 500), true);
assert.equal(shouldIgnoreStepSpike(100, 200, 500), false);

console.log("stepAccuracy.test.ts — all assertions passed");
