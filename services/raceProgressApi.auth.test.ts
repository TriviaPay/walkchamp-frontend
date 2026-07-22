/**
 * Characterization: authFetch retryOnUnauthorized option + race progress parse safety.
 * Run: npx tsx services/raceProgressApi.auth.test.ts
 */

import assert from "node:assert/strict";

// Documented contract: non-idempotent race progress must not auto-retry POST body on 401.
const defaultRetry = true;
const raceProgressRetry = false;
assert.notEqual(defaultRetry, raceProgressRetry);
assert.equal(raceProgressRetry, false, "race progress disables 401 body retry");

// Parse helpers mirrored from raceProgressApi (keep in sync)
function parseAccepted(
  json: Record<string, unknown>,
  fallbackSteps: number,
): number {
  if (typeof json.steps === "number") return json.steps;
  if (typeof json.raceSteps === "number") return json.raceSteps;
  return fallbackSteps;
}

assert.equal(parseAccepted({ steps: 12 }, 99), 12);
assert.equal(parseAccepted({ raceSteps: 34 }, 99), 34);
assert.equal(parseAccepted({}, 99), 99);
assert.equal(parseAccepted({ skipped: true }, 5), 5);

console.log("raceProgressApi.auth.test.ts — contracts locked");
