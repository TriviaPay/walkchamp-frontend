/**
 * Protected race verification unit tests (pure logic).
 * Run: npx tsx services/raceVerification/prizeVerification.test.ts
 */

import assert from "node:assert/strict";
import { HYBRID_RECON_ABS_TOLERANCE } from "@/config/prizeRaceVerificationConfig";
import {
  canonicalValue,
  hashCanonicalPayload,
  hexToBase64Url,
  sha256Hex,
} from "@/services/raceVerification/canonicalEvidenceHash";
import {
  adjudicationToPrizeStatus,
  isPrizeOutcomePending,
  prizeStatusDisplayLabel,
} from "@/services/raceVerification/prizeStatusLabels";
import {
  isProtectedClassicDurationOk,
  isProtectedPrizeRace,
  protectedRaceErrorCopy,
} from "@/services/raceVerification/prizeRaceDetection";
import {
  applyConnectivityChange,
  createEmptyOfflineSnapshot,
  evaluateOfflinePolicy,
} from "@/services/raceVerification/raceOfflineLogic";
import {
  areHybridCountsConsistent,
  evaluatePrizeRaceReadiness,
} from "@/services/raceVerification/raceVerificationPreflightLogic";
import { isOriginBlockedForProtectedRace } from "@/services/raceVerification/approvedSourcePolicy";

// Canonical JSON with recursively sorted keys
{
  const a = canonicalValue({ b: 1, a: "x" });
  const b = canonicalValue({ a: "x", b: 1 });
  assert.equal(a, b);
  assert.equal(a, '{"a":"x","b":1}');
}

// SHA-256 empty + base64url (43 chars, no padding)
{
  const hex = sha256Hex("");
  assert.equal(
    hex,
    "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  );
  const b64 = hexToBase64Url(hex);
  assert.equal(b64.length, 43);
  assert.equal(b64.includes("="), false);
  assert.equal(b64.includes("+"), false);
  assert.equal(b64.includes("/"), false);
}

// Preflight payload hash is stable and 43 chars
{
  const preflight = {
    approvedSource: "health_connect",
    permissionStatus: "granted",
    participantId: "p1",
    platform: "android",
    purpose: "preflight",
    raceId: "r1",
    registeredDeviceId: "d1",
    serverChallenge: "c1",
    verificationSessionId: "s1",
  };
  const h1 = hashCanonicalPayload(preflight);
  const h2 = hashCanonicalPayload(preflight);
  assert.equal(h1, h2);
  assert.equal(h1.length, 43);
  assert.ok(canonicalValue(preflight).includes('"purpose":"preflight"'));
}

// Source evidence arrays hash in sorted order
{
  const a = hashCanonicalPayload({
    automaticRecordCount: 2,
    manualEntryCount: 0,
    recordingMethods: ["automatic"],
    sourceIds: ["com.a", "com.b"],
  });
  const b = hashCanonicalPayload({
    sourceIds: ["com.a", "com.b"],
    recordingMethods: ["automatic"],
    manualEntryCount: 0,
    automaticRecordCount: 2,
  });
  assert.equal(a, b);
}

// Protected race detection — backend flag wins; free/streak never protected
assert.equal(isProtectedPrizeRace({ protectedRace: true }), true);
assert.equal(isProtectedPrizeRace({ protectedRace: false, entryFeeCents: 500 }), false);
assert.equal(isProtectedPrizeRace({ challengeType: "cash" }), true);
assert.equal(isProtectedPrizeRace({ challengeType: "coins_battle" }), true);
assert.equal(isProtectedPrizeRace({ challengeType: "free" }), false);
assert.equal(isProtectedPrizeRace({ challengeType: "unlimited_goal" }), false);
assert.equal(isProtectedPrizeRace({ entryFeeCents: 100 }), true);

assert.equal(
  isProtectedClassicDurationOk({
    durationMinutes: 45,
    minimumRaceDurationMinutes: 60,
    challengeType: "cash",
  }).ok,
  false,
);
assert.equal(
  isProtectedClassicDurationOk({
    durationMinutes: 30,
    minimumRaceDurationMinutes: 60,
    challengeType: "unlimited_goal",
  }).ok,
  true,
);

{
  const ready = evaluatePrizeRaceReadiness({
    authenticated: true,
    internetConnected: true,
    registeredDeviceId: "a",
    currentDeviceId: "a",
    verificationSessionObtained: true,
    raceAlreadyStarted: false,
    raceAlreadyEnded: false,
    integrityCapabilityAvailable: true,
    integrityRequired: true,
    sensorReady: true,
    healthPlatformReady: true,
    approvedSourceReady: true,
  });
  assert.equal(ready.eligible, true);
}

{
  const blocked = evaluatePrizeRaceReadiness({
    authenticated: true,
    internetConnected: false,
    registeredDeviceId: "a",
    currentDeviceId: "a",
    verificationSessionObtained: true,
    raceAlreadyStarted: false,
    raceAlreadyEnded: false,
    integrityCapabilityAvailable: true,
    integrityRequired: true,
    sensorReady: true,
    healthPlatformReady: true,
    approvedSourceReady: true,
  });
  assert.equal(blocked.eligible, false);
  assert.equal(blocked.failureReason, "offline");
}

assert.equal(
  areHybridCountsConsistent({
    provisionalSteps: 5100,
    qualifyingSteps: 5020,
    absTolerance: HYBRID_RECON_ABS_TOLERANCE,
  }),
  true,
);

{
  let snap = createEmptyOfflineSnapshot();
  snap = applyConnectivityChange({
    snapshot: snap,
    isOnline: false,
    nowIso: "2026-01-01T00:00:00.000Z",
    raceDurationMs: 3_600_000,
    maxContinuousOfflineMs: 600_000,
    maxOfflinePercent: 20,
  });
  snap = applyConnectivityChange({
    snapshot: snap,
    isOnline: true,
    nowIso: "2026-01-01T00:11:00.000Z",
    raceDurationMs: 3_600_000,
    maxContinuousOfflineMs: 600_000,
    maxOfflinePercent: 20,
  });
  assert.equal(snap.episodes.length, 1);
  const policy = evaluateOfflinePolicy({
    continuousOfflineMs: 11 * 60_000,
    totalOfflineMs: 0,
    raceDurationMs: 3_600_000,
    maxContinuousOfflineMinutes: 10,
    maxOfflinePercent: 20,
  });
  assert.equal(policy.exceeded, true);
}

assert.equal(isOriginBlockedForProtectedRace("android"), true);
assert.equal(isOriginBlockedForProtectedRace("com.walkchamp.app"), false);

assert.equal(adjudicationToPrizeStatus("review_required"), "review_required");
assert.equal(adjudicationToPrizeStatus("pending_verification"), "result_pending_verification");
assert.equal(
  prizeStatusDisplayLabel("review_required"),
  "Result under review; prize frozen",
);
assert.equal(isPrizeOutcomePending("close_result_review"), true);
assert.equal(isPrizeOutcomePending("finalized", "paid"), false);
assert.equal(isPrizeOutcomePending("finalized", "awaiting_verification"), true);
assert.equal(isPrizeOutcomePending("voided"), true);
assert.equal(isPrizeOutcomePending("disqualified"), true);
assert.equal(
  protectedRaceErrorCopy("PROTECTED_PREFLIGHT_INCOMPLETE"),
  "Waiting for all participants to verify",
);

console.log("prizeVerification.test.ts — passed");
