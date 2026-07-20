/**
 * Feature flags for real step tracking.
 * Set any flag to false to disable that feature and fall back to simulation.
 */

import {
  getAppEnv,
  getRazorpayKeyId,
  getStripePublishableKey,
  hasAnyLivePaymentPublicKey,
  isPaymentsLiveMode,
  isProductionAppEnv,
  isRazorpayKeyTest,
  isStripePublishableKeyTest,
} from "@/config/env";

export const FEATURE_FLAGS = {
  REAL_STEP_TRACKING_ENABLED: true,
  IOS_STEP_TRACKING_ENABLED: true,
  ANDROID_STEP_TRACKING_ENABLED: true,
  /** Use Health Connect for Android step reads (range-based, like iOS HealthKit). */
  ENABLE_ANDROID_HEALTH_CONNECT: true,
  /** Fall back to old expo-sensors Pedometer if HC fails (set true for debugging only). */
  FALLBACK_ANDROID_PEDOMETER: false,
  SERVER_TIME_RACE_VALIDATION_ENABLED: true,
  /**
   * Persistent daily step notification (Android FGS) / Live Activity (iOS).
   * Starts automatically when step tracking permission is granted.
   */
  ENABLE_STEP_TRACKING_NOTIFICATIONS: true,
  /**
   * Live race progress notification during an active race.
   * Requires native rebuild via expo prebuild.
   */
  ENABLE_RACE_PROGRESS_NOTIFICATIONS: true,
} as const;

// ── Mic Pass / Voice Chat flags ───────────────────────────────────────────────
export const ENABLE_MIC_PASS = true;
export const ENABLE_RACE_VOICE_CHAT = true;
export const ENABLE_VOICE_SDK = true;
export const VOICE_PROVIDER = "livekit" as const;

/** Paid cash challenges ($1 / $3 / $5 host + join). Requires API server cash flag enabled. */
export const ENABLE_CASH_CHALLENGES =
  process.env.EXPO_PUBLIC_ENABLE_CASH_CHALLENGES !== "false";

/**
 * Legacy $1 / $3 / $5 cards in the main Join section (off by default).
 * Cash Prize Challenge in Premium uses ENABLE_CASH_CHALLENGES instead.
 */
export const ENABLE_LEGACY_CASH_RACE_CARDS =
  process.env.EXPO_PUBLIC_ENABLE_LEGACY_CASH_RACE_CARDS === "true";

/**
 * Client-side cash UX + actions.
 *
 * Aligns with backend `PAYMENTS_LIVE_MODE` + cash feature flags:
 * - Sandbox (`EXPO_PUBLIC_PAYMENTS_LIVE_MODE=false`): cash UI may run with
 *   test Stripe/Razorpay keys for card testing — server still enforces
 *   CASH_FEATURES_ENABLED / REAL_MONEY_* as configured in Coolify.
 * - Live (`EXPO_PUBLIC_PAYMENTS_LIVE_MODE=true`): production builds require
 *   live public keys; test keys are rejected so real money is not mixed with sandbox.
 */
export function isCashClientEnabled(): boolean {
  if (!ENABLE_CASH_CHALLENGES) return false;

  // Sandbox / staging card testing — allow test keys even when APP_ENV=production.
  if (!isPaymentsLiveMode()) return true;

  if (!isProductionAppEnv()) return true;

  const stripe = getStripePublishableKey();
  const razorpay = getRazorpayKeyId();
  if (isStripePublishableKeyTest(stripe) || isRazorpayKeyTest(razorpay)) {
    return false;
  }
  if (!hasAnyLivePaymentPublicKey() && (stripe.length > 0 || razorpay.length > 0)) {
    return false;
  }
  return true;
}

/** Prefer for deposit / withdrawal / paid-challenge actions. */
export function canStartCashPaymentFlow(): boolean {
  return isCashClientEnabled();
}

export function cashGatingDebugSummary(): string {
  return [
    `appEnv=${getAppEnv()}`,
    `PAYMENTS_LIVE_MODE=${isPaymentsLiveMode()}`,
    `ENABLE_CASH_CHALLENGES=${ENABLE_CASH_CHALLENGES}`,
    `isCashClientEnabled=${isCashClientEnabled()}`,
    `stripe=${getStripePublishableKey() ? "set" : "empty"}`,
    `razorpay=${getRazorpayKeyId() ? "set" : "empty"}`,
  ].join(" ");
}
