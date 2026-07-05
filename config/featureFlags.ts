/**
 * Feature flags for real step tracking.
 * Set any flag to false to disable that feature and fall back to simulation.
 */
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
// ENABLE_MIC_PASS        — purchase modal + entitlement check are live
// ENABLE_RACE_VOICE_CHAT — voice channel connection is enabled
// ENABLE_VOICE_SDK       — LiveKit is installed and configured
//
// All three are now live. Voice chat requires a dev build / native APK / TestFlight.
// Expo Go shows a friendly "requires installed app" message and does not crash.
export const ENABLE_MIC_PASS        = true;
export const ENABLE_RACE_VOICE_CHAT = true;
export const ENABLE_VOICE_SDK       = true;
export const VOICE_PROVIDER         = "livekit" as const;

/** Paid cash challenges ($1 / $3 / $5 host + join). Requires API server cash flag enabled. */
export const ENABLE_CASH_CHALLENGES =
  process.env.EXPO_PUBLIC_ENABLE_CASH_CHALLENGES !== "false";

/**
 * Legacy $1 / $3 / $5 cards in the main Join section (off by default).
 * Cash Prize Challenge in Premium uses ENABLE_CASH_CHALLENGES instead.
 */
export const ENABLE_LEGACY_CASH_RACE_CARDS =
  process.env.EXPO_PUBLIC_ENABLE_LEGACY_CASH_RACE_CARDS === "true";
