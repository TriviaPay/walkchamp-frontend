/**
 * Monotonic auth-session generation for stale-response guards.
 * Bump on login / logout / restore so in-flight work from a prior account is dropped.
 */

let _authGeneration = 0;

export function bumpAuthGeneration(): number {
  _authGeneration += 1;
  return _authGeneration;
}

export function getAuthGeneration(): number {
  return _authGeneration;
}

/** True when `captured` still matches the current authenticated session generation. */
export function isAuthGenerationCurrent(captured: number): boolean {
  return captured === _authGeneration;
}

/**
 * Capture user + generation at request start; call `stillValid()` before applying results.
 */
export function captureAuthSessionGuard(userId: string | null | undefined): {
  userId: string;
  generation: number;
  stillValid: () => boolean;
} | null {
  if (!userId) return null;
  const generation = _authGeneration;
  return {
    userId,
    generation,
    stillValid: () => {
      try {
        // Lazy import avoids circular deps with the store.
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { store } = require("@/store") as typeof import("@/store");
        const current = store.getState().auth.user?.id;
        return current === userId && generation === _authGeneration;
      } catch {
        return generation === _authGeneration;
      }
    },
  };
}

/** Capture identity for a race realtime subscription; drop events after switch. */
export function captureRaceRealtimeGuard(params: {
  userId: string | null | undefined;
  raceId: string | null | undefined;
}): {
  userId: string;
  raceId: string;
  generation: number;
  accepts: (eventRaceId?: string | null) => boolean;
} | null {
  if (!params.userId || !params.raceId) return null;
  const generation = _authGeneration;
  const userId = params.userId;
  const raceId = params.raceId;
  return {
    userId,
    raceId,
    generation,
    accepts: (eventRaceId?: string | null) => {
      if (eventRaceId && eventRaceId !== raceId) return false;
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { store } = require("@/store") as typeof import("@/store");
        const current = store.getState().auth.user?.id;
        return current === userId && generation === _authGeneration;
      } catch {
        return generation === _authGeneration;
      }
    },
  };
}
