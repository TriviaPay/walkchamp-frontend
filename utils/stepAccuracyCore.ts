/**
 * Pure step-accuracy math — no React Native / provider imports.
 * Used by stepAccuracy.ts (production) and characterization tests.
 * Behavior must stay identical; only move code here, do not change formulas.
 */

import { STEP_SYNC_CONFIG } from "@/config/stepSyncConfig";

/** Reject impossible single-tick step jumps (anti-cheat guard, non-punitive). */
export function shouldIgnoreStepSpike(
  previousSteps: number,
  incomingSteps: number,
  maxJump = STEP_SYNC_CONFIG.WALK_MAX_STEP_SPIKE ?? 500,
): boolean {
  const delta = incomingSteps - previousSteps;
  if (delta <= 0) return false;
  return delta > maxJump;
}

/**
 * Reject legacy-sensor glitches (e.g. first pedometer tick = 67) while allowing
 * gradual real walking between polls.
 */
export function sanitizeLegacyProviderSteps(
  providerSteps: number,
  backendSteps: number,
  previousProviderSteps?: number,
): number {
  const provider = Math.max(0, Math.floor(providerSteps));
  const backend = Math.max(0, Math.floor(backendSteps));
  const previous =
    previousProviderSteps != null
      ? Math.max(0, Math.floor(previousProviderSteps))
      : backend;

  if (previous === 0 && backend === 0 && provider > 0) {
    return provider;
  }

  if (provider >= previous && previous > 0) {
    return provider;
  }

  const tickJump = provider - previous;
  const aheadOfBackend = provider - backend;

  if (
    provider < previous ||
    (tickJump > STEP_SYNC_CONFIG.LEGACY_MAX_TICK_JUMP &&
      aheadOfBackend > STEP_SYNC_CONFIG.LEGACY_MAX_UNCONFIRMED_AHEAD)
  ) {
    return Math.max(backend, previous);
  }

  return provider;
}

/** Monotonic merge for legacy sensor paths only. */
export function mergeLegacyStepUpdate(
  currentSteps: number,
  incomingSteps: number,
): { next: number; ignoredDuplicate: boolean; ignoredSpike: boolean } {
  const current = Math.max(0, Math.floor(currentSteps));
  const incoming = Math.max(0, Math.floor(incomingSteps));
  if (incoming <= current) {
    return {
      next: current,
      ignoredDuplicate: incoming === current,
      ignoredSpike: false,
    };
  }
  if (shouldIgnoreStepSpike(current, incoming)) {
    return { next: current, ignoredDuplicate: false, ignoredSpike: true };
  }
  return { next: incoming, ignoredDuplicate: false, ignoredSpike: false };
}

/** Today's walk steps for UI — never inflate verified counts from stale backend. */
export function resolveTodayDisplayStepsCore(params: {
  providerSteps: number;
  backendSteps: number;
  allowBackendCatchUp?: boolean;
  verifiedSource: boolean;
  previousProviderSteps?: number;
}): number {
  const backend = Math.max(0, Math.floor(params.backendSteps));
  const verified = params.verifiedSource;

  let provider = Math.max(0, Math.floor(params.providerSteps));
  if (!verified) {
    provider = sanitizeLegacyProviderSteps(
      provider,
      backend,
      params.previousProviderSteps,
    );
  }

  if (verified) {
    // Empty HC/HK read is not an authoritative zero — keep a sane backend floor
    // so Samsung lag / reinstall does not wipe Walk UI. Drop only since-boot
    // previousProvider floors, never a real GET /api/walk/today account total.
    if (provider <= 0) {
      const prev = Math.max(0, Math.floor(params.previousProviderSteps ?? 0));
      const prevLooksLikeSinceBoot = prev >= 1000 && (backend <= 0 || prev > backend + 1000);
      const safePrev = prevLooksLikeSinceBoot ? 0 : prev;
      return Math.max(backend, safePrev);
    }
    return provider;
  }

  return params.allowBackendCatchUp && backend > provider ? backend : provider;
}

/** Race steps since raceStartTime — range query is authoritative when verified. */
export function resolveRaceDisplayStepsCore(params: {
  providerRaceSteps: number;
  serverSteps?: number;
  currentUiSteps?: number;
  verifiedSource: boolean;
}): number {
  const provider = Math.max(0, Math.floor(params.providerRaceSteps));
  const server = Math.max(0, Math.floor(params.serverSteps ?? 0));
  const current = Math.max(0, Math.floor(params.currentUiSteps ?? 0));

  if (params.verifiedSource) {
    return provider > 0 ? provider : Math.max(current, server);
  }

  return Math.max(provider, server, current);
}

/** Cap a walk total before backend sync so inflated UI never persists to server. */
export function capWalkStepsForSyncCore(
  uiSteps: number,
  providerSteps: number | null | undefined,
  verifiedSource: boolean,
  backendSteps?: number,
): number {
  const ui = Math.max(0, Math.floor(uiSteps));
  if (verifiedSource && providerSteps != null) {
    const provider = Math.max(0, Math.floor(providerSteps));
    const backend = Math.max(0, Math.floor(backendSteps ?? 0));
    if (provider <= 0) {
      // HC/HK empty — never upload sensor/provisional UI as verified daily.
      // Keep last backend floor so a reinstall can restore today's account total.
      return backend;
    }
    return Math.min(ui, provider);
  }
  if (!verifiedSource && backendSteps != null) {
    const backend = Math.max(0, Math.floor(backendSteps));
    const provider =
      providerSteps != null ? Math.max(0, Math.floor(providerSteps)) : 0;
    const ceiling = Math.max(backend, provider);
    const sanitized = sanitizeLegacyProviderSteps(ui, ceiling, ceiling);
    return Math.min(ui, sanitized);
  }
  return ui;
}

/** Reject stale updates that would overwrite newer step state. */
export function shouldAcceptStepUpdateCore(
  incoming: {
    userId?: string;
    todaySteps?: number;
    raceSteps?: number;
    updatedAt?: string;
  },
  current: {
    userId: string | null;
    todaySteps: number;
    raceSteps: number;
    todayStepsLastUpdatedAt: string | null;
    raceStepsLastUpdatedAt: string | null;
  },
  opts?: {
    /**
     * Health Connect / HealthKit may re-anchor an inflated sensor absolute
     * (e.g. yesterday's total still in Redux) down to today's real total — including 0.
     */
    allowTodayDecrease?: boolean;
  },
): boolean {
  if (incoming.userId && current.userId && incoming.userId !== current.userId) {
    return false;
  }
  if (!incoming.updatedAt) return false;
  const incomingMs = new Date(incoming.updatedAt).getTime();
  const todayMs = current.todayStepsLastUpdatedAt
    ? new Date(current.todayStepsLastUpdatedAt).getTime()
    : 0;
  const raceMs = current.raceStepsLastUpdatedAt
    ? new Date(current.raceStepsLastUpdatedAt).getTime()
    : 0;
  if (incoming.todaySteps !== undefined && todayMs > 0 && incomingMs < todayMs) return false;
  if (incoming.raceSteps !== undefined && raceMs > 0 && incomingMs < raceMs) return false;
  if (
    incoming.todaySteps !== undefined &&
    incoming.todaySteps < current.todaySteps &&
    !opts?.allowTodayDecrease
  ) {
    return false;
  }
  if (
    incoming.raceSteps !== undefined &&
    incoming.raceSteps < current.raceSteps
  ) {
    return false;
  }
  return true;
}
