/**
 * USD cash leave / refund policy helpers.
 * Run: npx tsx utils/usdCashChallengeLeavePolicy.test.ts
 */

import assert from "node:assert/strict";
import {
  formatCashLeaveSuccessMessage,
} from "../services/refundApi";
import {
  isAlreadyLeftLeaveError,
  isUsdCashChallenge,
  mapPaidCancelError,
  previewChallengeHasStarted,
  shouldReleaseActiveChallengeLock,
  usdCashLeaveConfirmCopy,
  usdCashLeaveEndpoint,
  USD_CASH_LEAVE_ACTION_LABEL,
  USD_CASH_LEAVE_POST_START_CONFIRM,
  USD_CASH_LEAVE_PRE_START_CONFIRM,
  USD_CASH_NO_CANCEL_MESSAGE,
  PAID_CHALLENGE_CANNOT_BE_CANCELLED,
} from "./usdCashChallengeLeavePolicy";

assert.equal(isUsdCashChallenge({ entryFeeCents: 1000, entryType: "paid_usd" }), true);
assert.equal(isUsdCashChallenge({ entryFee: 10, challengeType: "unlimited_goal" }), true);
assert.equal(isUsdCashChallenge({ entryFeeCents: 0, entryType: "free" }), false);
assert.equal(isUsdCashChallenge({ entryFee: 50, entryType: "coins_battle" }), false);

assert.equal(
  usdCashLeaveEndpoint("abc", false),
  "/api/races/abc/leave",
);
assert.equal(
  usdCashLeaveEndpoint("abc", true),
  "/api/unlimited-challenges/abc/leave",
);

// Exact start timestamp is started (no refund preview)
{
  const start = "2026-08-01T05:00:00.000Z";
  assert.equal(
    previewChallengeHasStarted({
      scheduledStartAt: start,
      nowMs: new Date(start).getTime(),
    }),
    true,
  );
  assert.equal(
    previewChallengeHasStarted({
      scheduledStartAt: start,
      nowMs: new Date(start).getTime() - 1,
    }),
    false,
  );
}

{
  const pre = usdCashLeaveConfirmCopy({ hasStartedPreview: false, isHost: false });
  assert.equal(pre.confirmLabel, USD_CASH_LEAVE_PRE_START_CONFIRM);
  assert.match(pre.message, /has not started/i);
  assert.match(pre.message, /refund/i);

  const preHost = usdCashLeaveConfirmCopy({ hasStartedPreview: false, isHost: true });
  assert.match(preHost.message, /continue for other participants/i);

  const post = usdCashLeaveConfirmCopy({ hasStartedPreview: true, isHost: false });
  assert.equal(post.confirmLabel, USD_CASH_LEAVE_POST_START_CONFIRM);
  assert.match(post.message, /already started/i);
  assert.match(post.message, /no refund/i);

  const postHost = usdCashLeaveConfirmCopy({ hasStartedPreview: true, isHost: true });
  assert.match(postHost.message, /continue for other participants/i);

  const streak = usdCashLeaveConfirmCopy({
    hasStartedPreview: false,
    isHost: false,
    noRefund: true,
  });
  assert.equal(streak.confirmLabel, USD_CASH_LEAVE_ACTION_LABEL);
  assert.match(streak.message, /no refund/i);
}

assert.equal(
  mapPaidCancelError({ code: PAID_CHALLENGE_CANNOT_BE_CANCELLED, error: "Cash challenges cannot be cancelled after creation." }),
  "Cash challenges cannot be cancelled after creation.",
);
assert.equal(mapPaidCancelError({ code: "X", error: null }), "Could not cancel this room.");
assert.ok(USD_CASH_NO_CANCEL_MESSAGE.length > 0);

assert.equal(isAlreadyLeftLeaveError(404, { error: "You are not an active participant" }), true);
assert.equal(isAlreadyLeftLeaveError(400, { error: "bad" }), false);

assert.equal(
  shouldReleaseActiveChallengeLock({ success: true, activeChallengeReleased: true }),
  true,
);
assert.equal(
  shouldReleaseActiveChallengeLock({ success: false }),
  false,
);

// Backend response drives success copy — not client-calculated eligibility
assert.match(
  formatCashLeaveSuccessMessage({
    success: true,
    refundEligible: true,
    refundIssued: true,
    refundAmount: 1000,
  }),
  /\$10\.00 was refunded/,
);
assert.match(
  formatCashLeaveSuccessMessage({
    success: true,
    refundEligible: true,
    refundIssued: false,
    refundAmount: 1000,
  }),
  /being processed/,
);
assert.match(
  formatCashLeaveSuccessMessage({
    success: true,
    refundEligible: false,
    refundIssued: false,
    refundAmount: 0,
  }),
  /No refund was issued/,
);

console.log("usdCashChallengeLeavePolicy.test.ts: ok");
