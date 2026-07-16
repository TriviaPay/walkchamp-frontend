/**
 * Payment URLs and App Link hosts — derived from env at build time.
 *
 * Backend API domain (deposits, webhooks, hosted checkout):
 *   EXPO_PUBLIC_API_URL → e.g. https://api.walkchamp.miragaming.com
 *
 * Marketing / Universal Link domain (optional, recommended):
 *   EXPO_PUBLIC_WEB_URL → e.g. https://walkchamp.app
 *
 * Public client keys only (EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY /
 * EXPO_PUBLIC_RAZORPAY_KEY_ID). Secret keys must never ship in the app.
 */

import {
  getRazorpayKeyId,
  getStripePublishableKey,
  isRazorpayKeyLive,
  isRazorpayKeyTest,
  isStripePublishableKeyLive,
  isStripePublishableKeyTest,
} from "@/config/env";

const API_BASE = (process.env.EXPO_PUBLIC_API_URL ?? "").replace(/\/$/, "");
const WEB_BASE = (process.env.EXPO_PUBLIC_WEB_URL ?? "https://walkchamp.app").replace(/\/$/, "");

export { getRazorpayKeyId, getStripePublishableKey };

export function stripePublishableKeyStatus(): "live" | "test" | "missing" | "unknown" {
  const key = getStripePublishableKey();
  if (!key) return "missing";
  if (isStripePublishableKeyLive(key)) return "live";
  if (isStripePublishableKeyTest(key)) return "test";
  return "unknown";
}

export function razorpayKeyStatus(): "live" | "test" | "missing" | "unknown" {
  const key = getRazorpayKeyId();
  if (!key) return "missing";
  if (isRazorpayKeyLive(key)) return "live";
  if (isRazorpayKeyTest(key)) return "test";
  return "unknown";
}
function hostFromUrl(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

export const PAYMENTS_API_BASE = API_BASE;
export const PAYMENTS_WEB_BASE = WEB_BASE;

/** Hostnames registered for Universal Links (iOS) and App Links (Android). */
export const PAYMENT_APP_LINK_HOSTS = [
  hostFromUrl(WEB_BASE),
  hostFromUrl(API_BASE),
].filter((h): h is string => Boolean(h));

/** Custom scheme fallback (existing). */
export const PAYMENT_DEEP_LINK_SCHEME = "globalwalkerleague://payment-complete";

/**
 * Paths that should open the app after a wallet deposit (HTTPS).
 * Backend done page should link to WEB payment-complete when Phase C backend ships.
 */
export const PAYMENT_APP_LINK_PATHS = [
  "/payment-complete",
  "/api/wallet/deposit/done",
] as const;

/** Backend endpoints used by the mobile wallet deposit flow. */
export const PAYMENT_API_PATHS = {
  stripeCreate: "/api/wallet/deposit/stripe/create-payment-intent",
  razorpayCreate: "/api/wallet/deposit/razorpay/create-order",
  depositStatus: (transactionId: string) => `/api/wallet/deposit/status/${transactionId}`,
  depositList: "/api/wallet/deposit/list",
  wallet: "/api/wallet",
  walletTransactions: "/api/wallet/transactions",
  walletSummary: "/api/wallet/summary",
} as const;

/** Poll interval while checkout browser is open or deposit is pending verification. */
export const DEPOSIT_POLL_INTERVAL_MS = 400;

/** First status check shortly after checkout opens (before interval polling). */
export const DEPOSIT_POLL_FIRST_MS = 150;

/** Stop resume-polling a pending deposit after this duration (24 h). */
export const DEPOSIT_PENDING_MAX_AGE_MS = 24 * 60 * 60 * 1000;
