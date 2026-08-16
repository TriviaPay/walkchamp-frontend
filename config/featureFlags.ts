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
import {
  resolveCashEligibility,
  cashUnavailableMessage,
  type CashEligibility,
} from "@/utils/cashEligibility";

export const FEATURE_FLAGS = {
  REAL_STEP_TRACKING_ENABLED: true,
  IOS_STEP_TRACKING_ENABLED: true,
  ANDROID_STEP_TRACKING_ENABLED: true,
  /** Use Health Connect for Android step reads (range-based, like iOS HealthKit). */
  ENABLE_ANDROID_HEALTH_CONNECT: true,
  /**
   * Live race path uses TYPE_STEP_COUNTER (Android) / Core Motion (iOS).
   * Health Connect / HealthKit remain the verified daily + reconciliation sources.
   * Do not use this as a daily-walk replacement.
   */
  ENABLE_LIVE_RACE_DEVICE_SENSOR: true,
  /** @deprecated Prefer ENABLE_LIVE_RACE_DEVICE_SENSOR — kept for older call sites. */
  FALLBACK_ANDROID_PEDOMETER: true,
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
 * Unlimited Daily Goal Challenge (`unlimited_goal`) frontend surfaces.
 *
 * Default: ON (product is live). Disable with:
 *   EXPO_PUBLIC_ENABLE_UNLIMITED_GOAL=false
 * Also baked into expo.extra.enableUnlimitedGoal via app.config.js.
 * Instant rollback: flip the hard switch below to `false`.
 */
function readUnlimitedGoalFlag(): boolean {
  const env = String(process.env.EXPO_PUBLIC_ENABLE_UNLIMITED_GOAL ?? "")
    .trim()
    .toLowerCase();
  if (env === "false" || env === "0" || env === "no") return false;
  if (env === "true" || env === "1" || env === "yes") return true;
  try {
    // Lazy require — avoids circular imports in Node test runners.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Constants = require("expo-constants").default as {
      expoConfig?: { extra?: { enableUnlimitedGoal?: boolean } };
      manifest?: { extra?: { enableUnlimitedGoal?: boolean } };
      manifest2?: { extra?: { expoClient?: { extra?: { enableUnlimitedGoal?: boolean } } } };
    };
    const extra =
      Constants.expoConfig?.extra ??
      Constants.manifest?.extra ??
      Constants.manifest2?.extra?.expoClient?.extra;
    if (typeof extra?.enableUnlimitedGoal === "boolean") {
      return extra.enableUnlimitedGoal;
    }
  } catch {
    /* expo-constants unavailable */
  }
  // Default ON so Live/Walk Unlimited still works if Metro missed env inlining.
  return true;
}

export const ENABLE_UNLIMITED_GOAL_FRONTEND =
  readUnlimitedGoalFlag() &&
  // Local hard switch — flip to false for instant revert without env vars.
  true;

/** Prefer this helper so call sites stay readable. */
export function isUnlimitedGoalFrontendEnabled(): boolean {
  return ENABLE_UNLIMITED_GOAL_FRONTEND;
}

/**
 * Frontend-only Unlimited Race dummy session (Waiting Room → Live Race).
 *
 * Default: false (production). Enable with:
 *   EXPO_PUBLIC_ENABLE_UNLIMITED_RACE_DUMMY_DATA=true
 * Instant rollback: flip the hard switch below to `false`.
 *
 * Does not change backend contracts or production race rules when false.
 */
export const ENABLE_UNLIMITED_RACE_DUMMY_DATA =
  process.env.EXPO_PUBLIC_ENABLE_UNLIMITED_RACE_DUMMY_DATA === "true" &&
  // Local hard switch — flip to true only while testing Unlimited Live Race dummy UI.
  false;

export function isUnlimitedRaceDummyDataEnabled(): boolean {
  return ENABLE_UNLIMITED_RACE_DUMMY_DATA;
}

/**
 * Walk-tab Trending Challenges preview (stacked carousel below Create Challenge).
 *
 * Dev default: on. Disable with:
 *   EXPO_PUBLIC_ENABLE_WALK_TRENDING_CHALLENGES_PREVIEW=false
 * Instant rollback: flip hard switch to `false`.
 */
export const ENABLE_WALK_TRENDING_CHALLENGES_PREVIEW =
  process.env.EXPO_PUBLIC_ENABLE_WALK_TRENDING_CHALLENGES_PREVIEW !== "false" &&
  true;

export function isWalkTrendingChallengesPreviewEnabled(): boolean {
  return ENABLE_WALK_TRENDING_CHALLENGES_PREVIEW;
}

/**
 * Walk-tab Trending Challenges mock data (10 preview cards).
 *
 * Off by default. Enable with:
 *   EXPO_PUBLIC_ENABLE_WALK_TRENDING_CHALLENGES_MOCK=true
 * Instant rollback: flip hard switch to `false`.
 */
export const ENABLE_WALK_TRENDING_CHALLENGES_MOCK =
  process.env.EXPO_PUBLIC_ENABLE_WALK_TRENDING_CHALLENGES_MOCK === "true" &&
  // Local hard switch — flip to true only while testing with 10 mock cards.
  false;

export function isWalkTrendingChallengesMockEnabled(): boolean {
  return ENABLE_WALK_TRENDING_CHALLENGES_MOCK;
}

/**
 * Legacy $1 / $3 / $5 cards in the main Join section (off by default).
 * Cash Prize Challenge in Premium uses ENABLE_CASH_CHALLENGES instead.
 */
export const ENABLE_LEGACY_CASH_RACE_CARDS =
  process.env.EXPO_PUBLIC_ENABLE_LEGACY_CASH_RACE_CARDS === "true";

/**
 * Premium post-auth onboarding (Welcome → … → Enter WalkChamp).
 *
 * One-command disable (skip premium onboarding; auth goes straight to tabs):
 *   npm run onboarding:disable
 *
 * Or set ENABLE_PREMIUM_ONBOARDING = false below / EXPO_PUBLIC_ENABLE_PREMIUM_ONBOARDING=false
 */
export const ENABLE_PREMIUM_ONBOARDING =
  process.env.EXPO_PUBLIC_ENABLE_PREMIUM_ONBOARDING !== "false" &&
  // Local hard switch — flip to false for instant revert without env vars.
  true;

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

type CashUserLike = {
  countryCode?: string | null;
  country?: string | null;
  dateOfBirth?: string | null;
  isAdult?: boolean | null;
} | null;

/**
 * Build flags plus client age (18+) and territory allowlist (default US, IN).
 * Server still enforces cash / real-money flags.
 */
export function cashEligibilityForUser(user?: CashUserLike): CashEligibility {
  return resolveCashEligibility({
    buildEnabled: isCashClientEnabled(),
    countryCode: user?.countryCode,
    country: user?.country,
    dateOfBirth: user?.dateOfBirth,
    isAdult: user?.isAdult,
  });
}

/** Create / join cash contests and deposits — not withdrawals of existing funds. */
export function canStartCashPaymentFlowForUser(user?: CashUserLike): boolean {
  return cashEligibilityForUser(user).allowed;
}

export function cashJoinBlockMessage(user?: CashUserLike): string | null {
  const eligibility = cashEligibilityForUser(user);
  if (eligibility.allowed) return null;
  return cashUnavailableMessage(eligibility.reason);
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
