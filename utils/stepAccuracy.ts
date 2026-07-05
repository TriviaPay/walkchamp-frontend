/**
 * Step accuracy helpers — reconcile display/sync values against OS health sources.
 *
 * Verified sources (Health Connect / HealthKit) are always authoritative for display.
 * Backend and local caches are used only for metadata sync and legacy-sensor catch-up.
 */

import { stepProviderManager } from "@/services/steps/stepProviderManager";
import { getTodayKey } from "@/utils/format";
import { STEP_SYNC_CONFIG } from "@/config/stepSyncConfig";

/** Release-safe step pipeline logging (always on). */
export function stepEngineLog(tag: string, message: string): void {
  console.log(`[${tag}] ${message}`);
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

/** Today's walk steps for UI — never inflate verified counts from stale backend. */
export function resolveTodayDisplaySteps(params: {
  providerSteps: number;
  backendSteps: number;
  allowBackendCatchUp?: boolean;
  verifiedSource?: boolean;
}): number {
  const provider = Math.max(0, Math.floor(params.providerSteps));
  const backend = Math.max(0, Math.floor(params.backendSteps));
  const verified =
    params.verifiedSource ?? stepProviderManager.usesVerifiedStepSource();

  if (verified) {
    stepEngineLog(
      "StepEngine",
      `calculatedTodaySteps=${provider} healthStepsToday=${provider} backend=${backend} verified=true`,
    );
    return provider;
  }

  const display =
    params.allowBackendCatchUp && backend > provider ? backend : provider;
  stepEngineLog(
    "StepEngine",
    `calculatedTodaySteps=${display} provider=${provider} backend=${backend} verified=false`,
  );
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
): number {
  const ui = Math.max(0, Math.floor(uiSteps));
  const verified =
    verifiedSource ?? stepProviderManager.usesVerifiedStepSource();
  if (!verified || providerSteps == null) return ui;
  const provider = Math.max(0, Math.floor(providerSteps));
  return Math.min(ui, provider);
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
