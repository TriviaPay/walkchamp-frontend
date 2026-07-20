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
 * Display daily walk steps = max(context, canonical raceProgress.todaySteps).
 * Documented in docs/STEP_SOURCE_OF_TRUTH.md — temporary defensive merge.
 */
export function resolveDisplayTodaySteps(
  contextTodaySteps: number | null | undefined,
  canonicalTodaySteps: number | null | undefined,
): number {
  const ctx = Number.isFinite(contextTodaySteps as number)
    ? (contextTodaySteps as number)
    : 0;
  const canon = Math.max(0, Math.floor(Number(canonicalTodaySteps) || 0));
  return Math.max(ctx, canon);
}
