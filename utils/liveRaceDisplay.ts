/**
 * Shared live-race display helpers used by live-detail and live-track.
 * Extracted to prevent formatting / step merge drift — no UI layout changes.
 */

/** Matches existing live-detail / live-track formatSteps exactly. */
export function formatRaceSteps(n: number): string {
  if (n < 1000) return n.toLocaleString();
  const k = Math.round((n / 1000) * 10) / 10;
  return `${k % 1 === 0 ? k.toFixed(0) : k}k`;
}

/**
 * Display race steps = max(canonical Redux raceProgress, context userRaceSteps).
 * Preserves existing Math.max merge behavior used by both live screens.
 */
export function resolveLiveRaceDisplaySteps(
  canonicalRaceSteps: number | null | undefined,
  contextRaceSteps: number | null | undefined,
): number {
  return Math.max(
    0,
    Math.max(
      Math.floor(Number(canonicalRaceSteps) || 0),
      Math.floor(Number(contextRaceSteps) || 0),
    ),
  );
}

/**
 * Live-race / streak display only. Walk-tab daily totals stay uncapped.
 * Once the day's goal is complete, freeze the challenge counter.
 */
export function capStepsAtGoal(
  steps: number | null | undefined,
  goalSteps?: number | null,
): number {
  const s = Math.max(0, Math.floor(Number(steps) || 0));
  const g = Math.max(0, Math.floor(Number(goalSteps) || 0));
  if (g <= 0) return s;
  return Math.min(s, g);
}

/**
 * Display daily walk steps = max(context, canonical raceProgress.todaySteps).
 * Documented in docs/STEP_SOURCE_OF_TRUTH.md — temporary defensive merge.
 *
 * When `preferVerifiedContext` is set (HC/HK ready), drop only yesterday-style
 * Redux absolutes (≥1000 ahead of context) — not live provisional sensor growth.
 */
export function resolveDisplayTodaySteps(
  contextTodaySteps: number | null | undefined,
  canonicalTodaySteps: number | null | undefined,
  opts?: { preferVerifiedContext?: boolean; maxCanonicalAhead?: number },
): number {
  const ctx = Number.isFinite(contextTodaySteps as number)
    ? Math.max(0, Math.floor(contextTodaySteps as number))
    : 0;
  const canon = Math.max(0, Math.floor(Number(canonicalTodaySteps) || 0));
  const staleAbsoluteFloor = opts?.maxCanonicalAhead ?? 1000;
  if (
    opts?.preferVerifiedContext &&
    canon >= 1000 &&
    canon > ctx + staleAbsoluteFloor
  ) {
    return ctx;
  }
  return Math.max(ctx, canon);
}
