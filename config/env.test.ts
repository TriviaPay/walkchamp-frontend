/**
 * Unit tests for env / key classification helpers.
 * Run: npx tsx config/env.test.ts
 */

import assert from "node:assert/strict";
import {
  isAdMobSampleId,
  isRazorpayKeyLive,
  isRazorpayKeyTest,
  isStripePublishableKeyLive,
  isStripePublishableKeyTest,
} from "./env";

assert.equal(isStripePublishableKeyTest("pk_test_abc"), true);
assert.equal(isStripePublishableKeyLive("pk_live_abc"), true);
assert.equal(isStripePublishableKeyLive("pk_test_abc"), false);

assert.equal(isRazorpayKeyTest("rzp_test_abc"), true);
assert.equal(isRazorpayKeyLive("rzp_live_abc"), true);

assert.equal(isAdMobSampleId("ca-app-pub-3940256099942544/6300978111"), true);
assert.equal(isAdMobSampleId("ca-app-pub-1234567890123456/111"), false);

console.log("env.test.ts: ok");
