/**
 * Build-time / runtime environment helpers for Walk Champ.
 * Only EXPO_PUBLIC_* values are available on the client — never put secrets here.
 */

export type AppEnvName = "development" | "preview" | "production";

/** Explicit app environment from EAS / .env; falls back based on __DEV__. */
export function getAppEnv(): AppEnvName {
  const raw = (process.env.EXPO_PUBLIC_APP_ENV ?? "").trim().toLowerCase();
  if (raw === "production" || raw === "preview" || raw === "development") {
    return raw;
  }
  return __DEV__ ? "development" : "production";
}

export function isProductionAppEnv(): boolean {
  return getAppEnv() === "production";
}

export function isPreviewAppEnv(): boolean {
  return getAppEnv() === "preview";
}

/** Google AdMob sample / test application ID prefix. */
export const ADMOB_SAMPLE_APP_ID_PREFIX = "ca-app-pub-3940256099942544";

export function isStripePublishableKeyLive(key: string | undefined | null): boolean {
  const k = (key ?? "").trim();
  return k.startsWith("pk_live_");
}

export function isStripePublishableKeyTest(key: string | undefined | null): boolean {
  const k = (key ?? "").trim();
  return k.startsWith("pk_test_");
}

export function isRazorpayKeyLive(key: string | undefined | null): boolean {
  const k = (key ?? "").trim();
  return k.startsWith("rzp_live_");
}

export function isRazorpayKeyTest(key: string | undefined | null): boolean {
  const k = (key ?? "").trim();
  return k.startsWith("rzp_test_");
}

export function isAdMobSampleId(id: string | undefined | null): boolean {
  const v = (id ?? "").trim();
  return v.length > 0 && v.includes(ADMOB_SAMPLE_APP_ID_PREFIX);
}

export function getStripePublishableKey(): string {
  return (process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? "").trim();
}

export function getRazorpayKeyId(): string {
  return (process.env.EXPO_PUBLIC_RAZORPAY_KEY_ID ?? "").trim();
}

/** True when at least one live (non-test) payment public key is configured. */
export function hasAnyLivePaymentPublicKey(): boolean {
  return (
    isStripePublishableKeyLive(getStripePublishableKey()) ||
    isRazorpayKeyLive(getRazorpayKeyId())
  );
}

/**
 * Mirrors backend `PAYMENTS_LIVE_MODE`.
 * - false / unset: sandbox/test keys allowed (card testing with sk_test_ / rzp_test_).
 * - true: only live provider keys; real-money readiness gates apply on the server.
 */
export function isPaymentsLiveMode(): boolean {
  const raw = (process.env.EXPO_PUBLIC_PAYMENTS_LIVE_MODE ?? "").trim().toLowerCase();
  return raw === "true" || raw === "1" || raw === "yes";
}

/**
 * Live-mode production builds must not ship with sandbox payment keys.
 * When `EXPO_PUBLIC_PAYMENTS_LIVE_MODE=false`, test keys are intentional for QA.
 */
export function productionPaymentConfigIsSafe(): boolean {
  if (!isPaymentsLiveMode()) return true;
  if (!isProductionAppEnv()) return true;
  const stripe = getStripePublishableKey();
  const razorpay = getRazorpayKeyId();
  if (isStripePublishableKeyTest(stripe) || isRazorpayKeyTest(razorpay)) {
    return false;
  }
  // Empty keys are OK when cash is disabled; unsafe if cash is enabled (checked separately).
  return true;
}
