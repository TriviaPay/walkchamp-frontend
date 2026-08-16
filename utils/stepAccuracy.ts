/**
 * Step accuracy helpers — reconcile display/sync values against OS health sources.
 *
 * Verified sources (Health Connect / HealthKit) are always authoritative for display.
 * Backend and local caches are used only for metadata sync and legacy-sensor catch-up.
 *
 * Pure math lives in stepAccuracyCore.ts; this module adds provider defaults + logging.
 */

import { stepProviderManager } from "@/services/steps/stepProviderManager";
import { getTodayKey } from "@/utils/format";
import { STEP_SYNC_CONFIG } from "@/config/stepSyncConfig";
import {
  capWalkStepsForSyncCore,
  mergeLegacyStepUpdate as mergeLegacyStepUpdateCore,
  resolveRaceDisplayStepsCore,
  resolveTodayDisplayStepsCore,
  sanitizeLegacyProviderSteps as sanitizeLegacyProviderStepsPureFn,
  shouldIgnoreStepSpike as shouldIgnoreStepSpikePureFn,
} from "@/utils/stepAccuracyCore";

/** Pure aliases for tests / callers that want core math without provider defaults. */
export const sanitizeLegacyProviderStepsPure = sanitizeLegacyProviderStepsPureFn;
export const shouldIgnoreStepSpikePure = shouldIgnoreStepSpikePureFn;

let legacyBumpIgnoreUntilMs = Date.now() + 5_000;
/** After local midnight, ignore local-cache revive for a short window so UI stays at 0. */
let freshLocalDayUntilMs = 0;

/** Suppress +1 legacy-sensor ticks after subscribe / tab focus (phantom steps). */
export function suppressLegacyStepBumps(durationMs = 5_000): void {
  legacyBumpIgnoreUntilMs = Math.max(
    legacyBumpIgnoreUntilMs,
    Date.now() + durationMs,
  );
}

export function isLegacyStepBumpSuppressed(): boolean {
  return Date.now() < legacyBumpIgnoreUntilMs;
}

/** Mark that today just rolled over — don't resurrect yesterday's steps from cache. */
export function markFreshLocalDay(durationMs = 90_000): void {
  freshLocalDayUntilMs = Math.max(freshLocalDayUntilMs, Date.now() + durationMs);
  suppressLegacyStepBumps(Math.min(durationMs, 12_000));
}

export function isFreshLocalDay(): boolean {
  return Date.now() < freshLocalDayUntilMs;
}

/** Reject unconfirmed +1 bumps from legacy Android pedometer / native FGS on poll/open. */
export function shouldIgnoreLegacyPhantomBump(
  previousSteps: number,
  incomingSteps: number,
  options?: { backendSteps?: number; inStartupWindow?: boolean; fromWatch?: boolean },
): boolean {
  if (stepProviderManager.usesVerifiedStepSource()) return false;

  const current = Math.max(0, Math.floor(previousSteps));
  const incoming = Math.max(0, Math.floor(incomingSteps));
  const delta = incoming - current;
  if (delta <= 0 || delta > STEP_SYNC_CONFIG.WALK_PHANTOM_STEP_BUMP) return false;

  const inStartup =
    options?.inStartupWindow ?? isLegacyStepBumpSuppressed();

  // Screen focus / remount often fires a single legacy watch tick (+1). Reject it
  // during the suppress window even for fromWatch callbacks.
  if (
    options?.fromWatch &&
    inStartup &&
    delta > 0 &&
    delta <= STEP_SYNC_CONFIG.WALK_PHANTOM_STEP_BUMP
  ) {
    stepEngineLog(
      "StepEngine",
      `ignoredPhantomBump=true delta=${delta} reason=focus_watch_phantom current=${current}`,
    );
    try {
      const { stepAudit } = require("@/utils/stepAudit") as typeof import("@/utils/stepAudit");
      stepAudit.notePhantom({
        providerId: stepProviderManager.getActiveProviderId(),
        eventOrigin: "watch",
        previousDailySteps: current,
        calculatedDailySteps: incoming,
        reason: "focus_watch_phantom",
      });
    } catch {
      /* optional */
    }
    return true;
  }

  // Live sensor watch callbacks are trusted after the suppress window.
  if (options?.fromWatch) return false;

  // Open/reload: reject classic +1 pedometer phantoms at any current count.
  if (inStartup && delta > 0 && delta <= STEP_SYNC_CONFIG.WALK_PHANTOM_STEP_BUMP) {
    stepEngineLog(
      "StepEngine",
      `ignoredPhantomBump=true delta=${delta} reason=startup_reload_phantom current=${current}`,
    );
    try {
      const { stepAudit } = require("@/utils/stepAudit") as typeof import("@/utils/stepAudit");
      stepAudit.notePhantom({
        providerId: stepProviderManager.getActiveProviderId(),
        eventOrigin: options?.fromWatch ? "watch" : "poll",
        previousDailySteps: current,
        calculatedDailySteps: incoming,
        reason: "startup_reload_phantom",
      });
    } catch {
      /* optional */
    }
    return true;
  }

  return false;
}

/** Monotonic merge that rejects phantom +1 on poll/open; use for coordinator/UI reconcile. */
export function filterLegacyStepIncrease(
  currentSteps: number,
  incomingSteps: number,
  options?: { backendSteps?: number; fromWatch?: boolean },
): number {
  const current = Math.max(0, Math.floor(currentSteps));
  const incoming = Math.max(0, Math.floor(incomingSteps));
  if (incoming <= current) return current;
  if (shouldIgnoreLegacyPhantomBump(current, incoming, options)) return current;
  return incoming;
}

/** Verbose step pipeline logging — __DEV__ only; routine polls need STEP_DEBUG_VERBOSE. */
export function stepEngineLog(tag: string, message: string): void {
  if (typeof __DEV__ === "undefined" || !__DEV__) return;
  const important =
    tag === "AuthSwitch" ||
    tag === "RosterDiag" ||
    /rejected|failed|skippedCompletedRace/i.test(message);
  if (!important && !STEP_SYNC_CONFIG.STEP_DEBUG_VERBOSE) return;
  console.log(`[${tag}] ${message}`);
}

/** Opt-in verbose diagnostics ([AndroidHC], [StepSource], poll ticks). */
export function stepDebugVerboseLog(tag: string, message: string, detail?: unknown): void {
  if (typeof __DEV__ === "undefined" || !__DEV__ || !STEP_SYNC_CONFIG.STEP_DEBUG_VERBOSE) {
    return;
  }
  if (detail !== undefined) {
    console.log(`[${tag}] ${message}`, detail);
  } else {
    console.log(`[${tag}] ${message}`);
  }
}

export type StepAccuracySurface =
  | "walk"
  | "race"
  | "sync"
  | "hydrate"
  | "resume"
  | "poll";

export type StepAccuracyAuditContext = {
  surface: StepAccuracySurface;
  providerSteps?: number;
  backendSteps?: number;
  displaySteps?: number;
  lastSynced?: number;
  previousPoll?: number;
  delta?: number;
  raceStartAt?: string;
  raceSteps?: number;
  providerId?: string | null;
  extra?: Record<string, unknown>;
};

/**
 * Reject legacy-sensor glitches (e.g. first pedometer tick = 67) while allowing
 * gradual real walking between polls.
 */
export function sanitizeLegacyProviderSteps(
  providerSteps: number,
  backendSteps: number,
  previousProviderSteps?: number,
): number {
  const previous =
    previousProviderSteps != null
      ? Math.max(0, Math.floor(previousProviderSteps))
      : Math.max(0, Math.floor(backendSteps));
  const provider = Math.max(0, Math.floor(providerSteps));
  const backend = Math.max(0, Math.floor(backendSteps));
  const capped = sanitizeLegacyProviderStepsPureFn(
    providerSteps,
    backendSteps,
    previousProviderSteps,
  );
  if (
    capped !== provider &&
    (provider < previous ||
      (provider - previous > STEP_SYNC_CONFIG.LEGACY_MAX_TICK_JUMP &&
        provider - backend > STEP_SYNC_CONFIG.LEGACY_MAX_UNCONFIRMED_AHEAD))
  ) {
    stepDebugVerboseLog(
      "StepEngine",
      `sanitizedLegacyProvider provider=${provider} backend=${backend} previous=${previous} capped=${capped}`,
    );
  }
  return capped;
}

/** Today's walk steps for UI — never inflate verified counts from stale backend. */
export function resolveTodayDisplaySteps(params: {
  providerSteps: number;
  backendSteps: number;
  allowBackendCatchUp?: boolean;
  verifiedSource?: boolean;
  previousProviderSteps?: number;
}): number {
  const verified =
    params.verifiedSource ?? stepProviderManager.usesVerifiedStepSource();
  return resolveTodayDisplayStepsCore({
    providerSteps: params.providerSteps,
    backendSteps: params.backendSteps,
    allowBackendCatchUp: params.allowBackendCatchUp,
    previousProviderSteps: params.previousProviderSteps,
    verifiedSource: verified,
  });
}

/**
 * Hydrate today's display steps without regressing to 0 when backend is empty
 * but local cache or provider has valid data.
 */
export function hydrateStepDisplayFromSources(params: {
  providerSteps: number;
  backendSteps: number;
  localCachedSteps: number;
  allowBackendCatchUp?: boolean;
  previousProviderSteps?: number;
  verifiedSource?: boolean;
}): number {
  const display = resolveTodayDisplaySteps({
    providerSteps: params.providerSteps,
    backendSteps: params.backendSteps,
    allowBackendCatchUp: params.allowBackendCatchUp,
    previousProviderSteps: params.previousProviderSteps,
    verifiedSource: params.verifiedSource,
  });

  if (display > 0) return display;

  const provider = Math.max(0, Math.floor(params.providerSteps));
  const backend = Math.max(0, Math.floor(params.backendSteps));
  const local = Math.max(0, Math.floor(params.localCachedSteps));
  const verified =
    params.verifiedSource ?? stepProviderManager.usesVerifiedStepSource();

  // Midnight: HC/HK 0 + backend 0 means a new day — do not revive yesterday.
  // Mid-day empty HC polls (and walk POST paused during a live race) must not
  // wipe a same-day local total on logout/login.
  if (verified && provider === 0 && backend === 0) {
    if (isFreshLocalDay()) {
      stepEngineLog(
        "StepEngine",
        `hydrate verifiedZero keepZero=true ignoredLocal=${local}`,
      );
      return 0;
    }
    if (local > 0) {
      stepEngineLog(
        "StepEngine",
        `hydrate verified pendingHc keepLocal=${local}`,
      );
      return local;
    }
  }

  if (verified && provider === 0) {
    // Backend may still be ahead of a slow HC read — allow that catch-up only.
    // Inflated local cache (e.g. 9953 vs backend 0/small) is treated as stale.
    if (local > backend + 250) {
      stepEngineLog(
        "StepEngine",
        `hydrate verified dropInflatedLocal=${local} backend=${backend}`,
      );
      return backend;
    }
    const fallback = Math.max(backend, local);
    if (fallback > 0) {
      stepEngineLog(
        "StepEngine",
        `hydrate verified pending provider=0 fallback=${fallback} backend=${backend} local=${local}`,
      );
      return fallback;
    }
  }

  if (provider === 0 && backend === 0 && local > 0) {
    if (isFreshLocalDay()) {
      stepEngineLog(
        "StepEngine",
        `hydrate dropLocalCache=${local} verified=${verified}`,
      );
      return 0;
    }
    stepEngineLog(
      "StepEngine",
      `hydrate kept localCache=${local} pendingProvider=true`,
    );
    return local;
  }

  return display;
}

/** Reject impossible single-tick step jumps (anti-cheat guard, non-punitive). */
export function shouldIgnoreStepSpike(
  previousSteps: number,
  incomingSteps: number,
  maxJump = STEP_SYNC_CONFIG.WALK_MAX_STEP_SPIKE ?? 500,
): boolean {
  const ignored = shouldIgnoreStepSpikePureFn(previousSteps, incomingSteps, maxJump);
  if (ignored) {
    const delta = incomingSteps - previousSteps;
    stepEngineLog(
      "StepEngine",
      `ignoredSpike=true previousTodaySteps=${previousSteps} incoming=${incomingSteps} delta=${delta}`,
    );
  }
  return ignored;
}

/** Monotonic merge for legacy sensor paths only. */
export function mergeLegacyStepUpdate(
  currentSteps: number,
  incomingSteps: number,
): number {
  const result = mergeLegacyStepUpdateCore(currentSteps, incomingSteps);
  if (result.ignoredDuplicate || result.ignoredSpike) {
    stepEngineLog(
      "StepEngine",
      `ignoredDuplicate=${result.ignoredDuplicate} previousTodaySteps=${Math.max(0, Math.floor(currentSteps))} incoming=${Math.max(0, Math.floor(incomingSteps))}`,
    );
  }
  return result.next;
}

/** Race steps since raceStartTime — range query is authoritative when verified. */
export function resolveRaceDisplaySteps(params: {
  providerRaceSteps: number;
  serverSteps?: number;
  currentUiSteps?: number;
  verifiedSource?: boolean;
}): number {
  const verified =
    params.verifiedSource ?? stepProviderManager.usesVerifiedStepSource();
  return resolveRaceDisplayStepsCore({
    providerRaceSteps: params.providerRaceSteps,
    serverSteps: params.serverSteps,
    currentUiSteps: params.currentUiSteps,
    verifiedSource: verified,
  });
}

/** Cap a walk total before backend sync so inflated UI never persists to server. */
export function capWalkStepsForSync(
  uiSteps: number,
  providerSteps: number | null | undefined,
  verifiedSource?: boolean,
  backendSteps?: number,
): number {
  const verified =
    verifiedSource ?? stepProviderManager.usesVerifiedStepSource();
  return capWalkStepsForSyncCore(uiSteps, providerSteps, verified, backendSteps);
}

export function logStepAccuracyAudit(ctx: StepAccuracyAuditContext): void {
  if (typeof __DEV__ === "undefined" || !__DEV__) return;
  let tz = "UTC";
  try {
    tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    /* ignore */
  }
  const providerId =
    ctx.providerId ?? stepProviderManager.getActiveProviderId() ?? "none";
  const verified = stepProviderManager.usesVerifiedStepSource();
  stepDebugVerboseLog(
    "StepAudit",
    `${ctx.surface} date=${getTodayKey()} tz=${tz} provider=${providerId} verified=${verified}`,
    ctx.extra,
  );
}
