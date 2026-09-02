/**
 * Canonical Streak Challenge HTTP paths.
 * Replaces legacy `/api/unlimited-challenges/*` (deprecated but still supported).
 */
export const STREAK_CHALLENGES_API_BASE = "/api/streak-challenges" as const;

/** `/api/streak-challenges` + optional suffix (`/live`, `/host`, `?status=active`, …). */
export function streakChallengePath(suffix = ""): string {
  if (!suffix) return STREAK_CHALLENGES_API_BASE;
  return suffix.startsWith("/") || suffix.startsWith("?")
    ? `${STREAK_CHALLENGES_API_BASE}${suffix}`
    : `${STREAK_CHALLENGES_API_BASE}/${suffix}`;
}

/** `/api/streak-challenges/:id` or `/api/streak-challenges/:id/:action`. */
export function streakChallengeIdPath(id: string, action?: string): string {
  const base = `${STREAK_CHALLENGES_API_BASE}/${encodeURIComponent(id)}`;
  if (!action) return base;
  const segment = action.startsWith("/") ? action.slice(1) : action;
  return `${base}/${segment}`;
}
