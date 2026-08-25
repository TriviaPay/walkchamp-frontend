/**
 * Pure protected-race Health Connect origin policy (no React Native).
 */

const BLOCKED_ORIGIN_NEEDLES = [
  "shealth",
  "samsung",
  "fitbit",
  "garmin",
  "com.sec.android.app.shealth",
  "com.google.android.apps.fitness",
];

export function isOriginBlockedForProtectedRace(origin: string): boolean {
  const o = origin.trim().toLowerCase();
  if (!o) return true;
  // Never treat literal "android" as approved — must resolve real package.
  if (o === "android") return true;
  return BLOCKED_ORIGIN_NEEDLES.some((n) => o.includes(n));
}
