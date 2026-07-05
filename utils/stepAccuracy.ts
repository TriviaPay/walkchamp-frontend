/**
 * Step accuracy helpers — reconcile display/sync values against OS health sources.
 *
 * Verified sources (Health Connect / HealthKit) are always authoritative for display.
 * Backend and local caches are used only for metadata sync and legacy-sensor catch-up.
 */

import { stepProviderManager } from "@/services/steps/stepProviderManager";
import { getTodayKey } from "@/utils/format";
import { STEP_SYNC_CONFIG } from "@/config/stepSyncConfig";

let legacyBumpIgnoreUntilMs = Date.now() + 5_000;

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

/** Reject unconfirmed +1 bumps from legacy Android pedometer / native FGS. */
export function shouldIgnoreLegacyPhantomBump(
  previousSteps: number,
  incomingSteps: number,
  options?: { backendSteps?: number; inStartupWindow?: boolean },
): boolean {
  if (stepProviderManager.usesVerifiedStepSource()) return false;

  const current = Math.max(0, Math.floor(previousSteps));
  const incoming = Math.max(0, Math.floor(incomingSteps));
  const delta = incoming - current;
  if (delta <= 0 || delta > STEP_SYNC_CONFIG.WALK_PHANTOM_STEP_BUMP) return false;

  const inStartup =
    options?.inStartupWindow ?? isLegacyStepBumpSuppressed();
  if (inStartup) {
    stepEngineLog(
      "StepEngine",
      `ignoredPhantomBump=true delta=${delta} reason=startup_window`,
    );
    return true;
  }

  const backend = Math.max(0, Math.floor(options?.backendSteps ?? 0));
  if (
    incoming > backend &&
    incoming - backend <= STEP_SYNC_CONFIG.WALK_PHANTOM_STEP_BUMP &&
    current <= backend
  ) {
    stepEngineLog(
      "StepEngine",
      `ignoredPhantomBump=true delta=${delta} reason=unconfirmed_backend backend=${backend}`,
    );
    return true;
  }

  return false;
}

/** Verbose step pipeline logging — __DEV__ only; routine polls need STEP_DEBUG_VERBOSE. */
export function stepEngineLog(tag: string, message: string): void {
  if (!__DEV__) return;
  const important =
    tag === "AuthSwitch" ||
    /rejected|failed|sanitized|skippedCompletedRace/i.test(message);
  if (!important && !STEP_SYNC_CONFIG.STEP_DEBUG_VERBOSE) return;
  console.log(`[${tag}] ${message}`);
}

/** Opt-in verbose diagnostics ([AndroidHC], [StepSource], poll ticks). */
export function stepDebugVerboseLog(tag: string, message: string, detail?: unknown): void {
  if (!__DEV__ || !STEP_SYNC_CONFIG.STEP_DEBUG_VERBOSE) return;
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
  const provider = Math.max(0, Math.floor(providerSteps));
  const backend = Math.max(0, Math.floor(backendSteps));
  const previous =
    previousProviderSteps != null
      ? Math.max(0, Math.floor(previousProviderSteps))
      : backend;
  const tickJump = provider - previous;
  const aheadOfBackend = provider - backend;

  if (
    tickJump > STEP_SYNC_CONFIG.LEGACY_MAX_TICK_JUMP &&
    aheadOfBackend > STEP_SYNC_CONFIG.LEGACY_MAX_UNCONFIRMED_AHEAD
  ) {
    const capped = Math.max(backend, previous);
    stepEngineLog(
      "StepEngine",
      `sanitizedLegacyProvider provider=${provider} backend=${backend} previous=${previous} capped=${capped}`,
    );
    return capped;
  }

  return provider;
}

/** Today's walk steps for UI — never inflate verified counts from stale backend. */
export function resolveTodayDisplaySteps(params: {
  providerSteps: number;
  backendSteps: number;
  allowBackendCatchUp?: boolean;
  verifiedSource?: boolean;
  previousProviderSteps?: number;
}): number {
  const backend = Math.max(0, Math.floor(params.backendSteps));
  const verified =
    params.verifiedSource ?? stepProviderManager.usesVerifiedStepSource();

  let provider = Math.max(0, Math.floor(params.providerSteps));
  if (!verified) {
    provider = sanitizeLegacyProviderSteps(
      provider,
      backend,
      params.previousProviderSteps,
    );
  }

  if (verified) {
    return provider;
  }

  const display =
    params.allowBackendCatchUp && backend > provider ? backend : provider;
  return display;
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

  if (provider === 0 && backend === 0 && local > 0) {
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
  const delta = incomingSteps - previousSteps;
  if (delta <= 0) return false;
  if (delta > maxJump) {
    stepEngineLog(
      "StepEngine",
      `ignoredSpike=true previousTodaySteps=${previousSteps} incoming=${incomingSteps} delta=${delta}`,
    );
    return true;
  }
  return false;
}

/** Monotonic merge for legacy sensor paths only. */
export function mergeLegacyStepUpdate(
  currentSteps: number,
  incomingSteps: number,
): number {
  const current = Math.max(0, Math.floor(currentSteps));
  const incoming = Math.max(0, Math.floor(incomingSteps));
  if (incoming <= current) {
    stepEngineLog(
      "StepEngine",
      `ignoredDuplicate=${incoming === current} previousTodaySteps=${current} incoming=${incoming}`,
    );
    return current;
  }
  if (shouldIgnoreStepSpike(current, incoming)) return current;
  return incoming;
}

/** Race steps since raceStartTime — range query is authoritative when verified. */
export function resolveRaceDisplaySteps(params: {
  providerRaceSteps: number;
  serverSteps?: number;
  currentUiSteps?: number;
  verifiedSource?: boolean;
}): number {
  const provider = Math.max(0, Math.floor(params.providerRaceSteps));
  const server = Math.max(0, Math.floor(params.serverSteps ?? 0));
  const current = Math.max(0, Math.floor(params.currentUiSteps ?? 0));
  const verified =
    params.verifiedSource ?? stepProviderManager.usesVerifiedStepSource();

  if (verified) {
    return provider > 0 ? provider : Math.max(current, server);
  }

  return Math.max(provider, server, current);
}

/** Cap a walk total before backend sync so inflated UI never persists to server. */
export function capWalkStepsForSync(
  uiSteps: number,
  providerSteps: number | null | undefined,
  verifiedSource?: boolean,
  backendSteps?: number,
): number {
  const ui = Math.max(0, Math.floor(uiSteps));
  const verified =
    verifiedSource ?? stepProviderManager.usesVerifiedStepSource();
  if (verified && providerSteps != null) {
    const provider = Math.max(0, Math.floor(providerSteps));
    return Math.min(ui, provider);
  }
  if (!verified && backendSteps != null) {
    const backend = Math.max(0, Math.floor(backendSteps));
    const sanitized = sanitizeLegacyProviderSteps(ui, backend, backend);
    return Math.min(ui, sanitized);
  }
  return ui;
}

export function logStepAccuracyAudit(ctx: StepAccuracyAuditContext): void {
  let tz = "UTC";
  try {
    tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    /* ignore */
  }
  const providerId =
    ctx.providerId ?? stepProviderManager.getActiveProviderId() ?? "none";
  const verified = stepProviderManager.usesVerifiedStepSource();
  stepEngineLog(
    "StepAudit",
    `surface=${ctx.surface} localDate=${getTodayKey()} tz=${tz} provider=${providerId} verified=${verified} providerSteps=${ctx.providerSteps ?? "n/a"} backendSteps=${ctx.backendSteps ?? "n/a"} displaySteps=${ctx.displaySteps ?? "n/a"} delta=${ctx.delta ?? "n/a"}`,
  );
  if (__DEV__) {
    console.log(`[StepAudit] detail`, {
      lastSynced: ctx.lastSynced,
      previousPoll: ctx.previousPoll,
      raceStartAt: ctx.raceStartAt,
      raceSteps: ctx.raceSteps,
      ...ctx.extra,
    });
  }
}
