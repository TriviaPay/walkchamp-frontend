/**
 * Backend-owned Streak final-result flow.
 * Canonical contract: viewer.finalResultStatus + viewer.raceFinalStatus (+ finalFlow copy).
 * Server derives status from locked participant UTC boundaries — never device local time.
 */

import type { UnlimitedFinalResultStage } from "./unlimitedTimezoneChange";
import { UNLIMITED_FINAL_RESULT_STAGES } from "./unlimitedTimezoneChange";

/** Viewer-facing final result status (canonical backend contract). */
export type FinalResultStatus =
  | "FINAL_DAY_COMPLETED_WAITING"
  | "FINAL_VERIFICATION"
  | "RESULTS_READY"
  | "RESULTS_ANNOUNCED";

/** Race-wide final lifecycle status (canonical backend contract). */
export type RaceFinalStatus =
  | "WAITING_FOR_PARTICIPANT_DAY_ENDS"
  | "FINAL_VERIFICATION"
  | "PREPARING_LEADERBOARD"
  | "SETTLED"
  | "RESULTS_ANNOUNCED";

/** Progressive Live Race card id (legacy snake_case — derived from canonical statuses). */
export type UnlimitedFinalFlowStatus =
  | "final_day_completed"
  | "final_results_pending"
  | "verifying_final_results"
  | "results_ready"
  | "challenge_completed";

export type UnlimitedFinalFlow = {
  finalResultStatus?: FinalResultStatus;
  raceFinalStatus?: RaceFinalStatus;
  status: UnlimitedFinalFlowStatus;
  title: string;
  message: string;
};

/** Four-card progressive flow (reference UI). */
const FINAL_FLOW_ORDER: UnlimitedFinalFlowStatus[] = [
  "final_day_completed",
  "verifying_final_results",
  "results_ready",
  "challenge_completed",
];

const LEGACY_FLOW_ORDER: UnlimitedFinalFlowStatus[] = [
  "final_day_completed",
  "final_results_pending",
  "verifying_final_results",
  "results_ready",
  "challenge_completed",
];

/** Per-status card backgrounds for the live-race status strip (reference flow). */
export const FINAL_FLOW_HIGHLIGHT_BG: Record<UnlimitedFinalFlowStatus, string> = {
  final_day_completed: "rgba(8,36,58,0.96)",
  final_results_pending: "rgba(48,38,8,0.96)",
  verifying_final_results: "rgba(42,18,62,0.96)",
  results_ready: "rgba(8,48,32,0.96)",
  challenge_completed: "rgba(52,28,8,0.96)",
};

export const FINAL_FLOW_ICON_BG: Record<UnlimitedFinalFlowStatus, string> = {
  final_day_completed: "rgba(56,189,248,0.22)",
  final_results_pending: "rgba(250,204,21,0.2)",
  verifying_final_results: "rgba(192,132,252,0.22)",
  results_ready: "rgba(74,222,128,0.22)",
  challenge_completed: "rgba(251,146,60,0.22)",
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

const FINAL_RESULT_STATUSES: FinalResultStatus[] = [
  "FINAL_DAY_COMPLETED_WAITING",
  "FINAL_VERIFICATION",
  "RESULTS_READY",
  "RESULTS_ANNOUNCED",
];

const RACE_FINAL_STATUSES: RaceFinalStatus[] = [
  "WAITING_FOR_PARTICIPANT_DAY_ENDS",
  "FINAL_VERIFICATION",
  "PREPARING_LEADERBOARD",
  "SETTLED",
  "RESULTS_ANNOUNCED",
];

export function parseFinalResultStatus(value: unknown): FinalResultStatus | null {
  const raw = asString(value)?.toUpperCase();
  if (!raw) return null;
  return FINAL_RESULT_STATUSES.includes(raw as FinalResultStatus)
    ? (raw as FinalResultStatus)
    : null;
}

export function parseRaceFinalStatus(value: unknown): RaceFinalStatus | null {
  const raw = asString(value)?.toUpperCase();
  if (!raw) return null;
  return RACE_FINAL_STATUSES.includes(raw as RaceFinalStatus)
    ? (raw as RaceFinalStatus)
    : null;
}

/** Map canonical backend statuses → progressive card id. */
export function mapCanonicalFinalFlowToStageId(
  finalResultStatus: FinalResultStatus | null | undefined,
  raceFinalStatus: RaceFinalStatus | null | undefined,
): UnlimitedFinalFlowStatus | null {
  if (finalResultStatus === "RESULTS_ANNOUNCED" || raceFinalStatus === "RESULTS_ANNOUNCED") {
    return "challenge_completed";
  }
  if (finalResultStatus === "RESULTS_READY") return "results_ready";
  if (
    finalResultStatus === "FINAL_VERIFICATION"
    || raceFinalStatus === "FINAL_VERIFICATION"
  ) {
    return "verifying_final_results";
  }
  if (raceFinalStatus === "PREPARING_LEADERBOARD" || raceFinalStatus === "SETTLED") {
    return "results_ready";
  }
  if (
    finalResultStatus === "FINAL_DAY_COMPLETED_WAITING"
    || raceFinalStatus === "WAITING_FOR_PARTICIPANT_DAY_ENDS"
  ) {
    return "final_day_completed";
  }
  return null;
}

export function parseUnlimitedFinalFlowStatus(
  value: unknown,
): UnlimitedFinalFlowStatus | null {
  const raw = asString(value);
  if (!raw) return null;
  const normalized = raw.trim().toLowerCase();
  if (LEGACY_FLOW_ORDER.includes(normalized as UnlimitedFinalFlowStatus)) {
    // Legacy intermediate stage collapses into the waiting card.
    if (normalized === "final_results_pending") return "final_day_completed";
    return normalized as UnlimitedFinalFlowStatus;
  }
  return mapCanonicalFinalFlowToStageId(
    parseFinalResultStatus(raw),
    parseRaceFinalStatus(raw),
  );
}

export function parseUnlimitedFinalFlow(value: unknown): UnlimitedFinalFlow | null {
  const obj = asRecord(value);
  if (!obj) return null;
  const finalResultStatus =
    parseFinalResultStatus(obj.finalResultStatus ?? obj.final_result_status)
    ?? parseFinalResultStatus(obj.participantStatus ?? obj.participant_status);
  const raceFinalStatus =
    parseRaceFinalStatus(obj.raceFinalStatus ?? obj.race_final_status)
    ?? parseRaceFinalStatus(obj.raceStatus ?? obj.race_status);
  const status =
    parseUnlimitedFinalFlowStatus(obj.status)
    ?? mapCanonicalFinalFlowToStageId(finalResultStatus, raceFinalStatus);
  const title = asString(obj.title);
  const message = asString(obj.message);
  if (!status || !title || !message) return null;
  return {
    finalResultStatus: finalResultStatus ?? undefined,
    raceFinalStatus: raceFinalStatus ?? undefined,
    status,
    title,
    message,
  };
}

/** Parse canonical `viewer.finalResult` payload (preferred over deprecated `finalFlow`). */
export function parseStreakChallengeFinalResult(value: unknown): UnlimitedFinalFlow | null {
  return parseUnlimitedFinalFlow(value);
}

/** Parse viewer / flattened API fields. */
export function readUnlimitedFinalFlowFields(source: unknown): {
  finalResultStatus: FinalResultStatus | null;
  raceFinalStatus: RaceFinalStatus | null;
  finalFlowStatus: UnlimitedFinalFlowStatus | null;
  finalFlow: UnlimitedFinalFlow | null;
} {
  const root = asRecord(source);
  if (!root) {
    return {
      finalResultStatus: null,
      raceFinalStatus: null,
      finalFlowStatus: null,
      finalFlow: null,
    };
  }
  const viewer = asRecord(root.viewer) ?? root;
  const finalResultObj = asRecord(viewer.finalResult ?? viewer.final_result)
    ?? asRecord(root.finalResult ?? root.final_result);
  const finalResultStatus =
    parseFinalResultStatus(viewer.finalResultStatus ?? viewer.final_result_status) ??
    parseFinalResultStatus(root.finalResultStatus ?? root.final_result_status) ??
    parseFinalResultStatus(finalResultObj?.participantStatus ?? finalResultObj?.participant_status);
  const raceFinalStatus =
    parseRaceFinalStatus(viewer.raceFinalStatus ?? viewer.race_final_status) ??
    parseRaceFinalStatus(root.raceFinalStatus ?? root.race_final_status) ??
    parseRaceFinalStatus(finalResultObj?.raceStatus ?? finalResultObj?.race_status);
  const finalFlowStatus =
    parseUnlimitedFinalFlowStatus(viewer.finalFlowStatus ?? viewer.final_flow_status) ??
    parseUnlimitedFinalFlowStatus(root.finalFlowStatus ?? root.final_flow_status) ??
    mapCanonicalFinalFlowToStageId(finalResultStatus, raceFinalStatus);
  const fromFinalResult = parseStreakChallengeFinalResult(finalResultObj);
  const fromLegacyFlow =
    parseUnlimitedFinalFlow(viewer.finalFlow ?? viewer.final_flow) ??
    parseUnlimitedFinalFlow(root.finalFlow ?? root.final_flow);
  const finalFlow =
    fromFinalResult ??
    fromLegacyFlow ??
    (finalFlowStatus
      ? {
          finalResultStatus: finalResultStatus ?? undefined,
          raceFinalStatus: raceFinalStatus ?? undefined,
          status: finalFlowStatus,
          title: UNLIMITED_FINAL_RESULT_STAGES[finalFlowStatus].title,
          message: UNLIMITED_FINAL_RESULT_STAGES[finalFlowStatus].description,
        }
      : null);
  return { finalResultStatus, raceFinalStatus, finalFlowStatus, finalFlow };
}

function normalizeFlowStageId(
  id: UnlimitedFinalFlowStatus,
): UnlimitedFinalFlowStatus {
  return id === "final_results_pending" ? "final_day_completed" : id;
}

/** Progressive stages through the backend current status (uses server title/message on current). */
export function buildFinalFlowStagesFromBackend(
  finalFlowStatus: UnlimitedFinalFlowStatus | null | undefined,
  finalFlow: UnlimitedFinalFlow | null | undefined,
): UnlimitedFinalResultStage[] {
  if (!finalFlowStatus) return [];
  const normalized = normalizeFlowStageId(finalFlowStatus);
  const idx = FINAL_FLOW_ORDER.indexOf(normalized);
  if (idx < 0) return [];
  return FINAL_FLOW_ORDER.slice(0, idx + 1).map((id, i) => {
    const base = UNLIMITED_FINAL_RESULT_STAGES[id];
    const isCurrent = i === idx;
    return {
      id,
      title: isCurrent && finalFlow?.title ? finalFlow.title : base.title,
      description: isCurrent && finalFlow?.message ? finalFlow.message : base.description,
      accent: base.accent,
      border: base.border,
      icon: base.icon,
      highlightBg: FINAL_FLOW_HIGHLIGHT_BG[id],
      iconBg: FINAL_FLOW_ICON_BG[id],
    };
  });
}

export function isUnlimitedFinalFlowActive(
  finalFlowStatus: UnlimitedFinalFlowStatus | null | undefined,
  finalResultStatus?: FinalResultStatus | null,
): boolean {
  return finalFlowStatus != null || finalResultStatus != null;
}

/** Monotonic order — never walk a latched status backwards between polls. */
export const FINAL_FLOW_STAGE_ORDER: UnlimitedFinalFlowStatus[] = [
  "final_day_completed",
  "verifying_final_results",
  "results_ready",
  "challenge_completed",
];

export function advanceFinalFlowStatusMonotonic(
  previous: UnlimitedFinalFlowStatus | null | undefined,
  incoming: UnlimitedFinalFlowStatus | null | undefined,
): UnlimitedFinalFlowStatus | null {
  if (!incoming) return previous ?? null;
  if (!previous) return incoming;
  const prevIdx = FINAL_FLOW_STAGE_ORDER.indexOf(normalizeFlowStageId(previous));
  const nextIdx = FINAL_FLOW_STAGE_ORDER.indexOf(normalizeFlowStageId(incoming));
  if (prevIdx < 0) return incoming;
  if (nextIdx < 0) return previous;
  return nextIdx >= prevIdx ? incoming : previous;
}

export function isStreakFinalResultsAnnounced(input: {
  finalResultStatus?: FinalResultStatus | string | null;
  raceFinalStatus?: RaceFinalStatus | string | null;
  resultsAnnouncedAt?: string | null;
  finalFlowStatus?: UnlimitedFinalFlowStatus | string | null;
}): boolean {
  const participant = (input.finalResultStatus ?? "").toString().toUpperCase();
  const race = (input.raceFinalStatus ?? "").toString().toUpperCase();
  if (participant === "RESULTS_ANNOUNCED" || race === "RESULTS_ANNOUNCED") return true;
  if (input.resultsAnnouncedAt) return true;
  return input.finalFlowStatus === "challenge_completed";
}

/** Live Race strip: one card for the backend-owned current stage only. */
export function buildCurrentFinalFlowStageFromBackend(
  finalFlowStatus: UnlimitedFinalFlowStatus | null | undefined,
  finalFlow: UnlimitedFinalFlow | null | undefined,
): UnlimitedFinalResultStage[] {
  const stages = buildFinalFlowStagesFromBackend(finalFlowStatus, finalFlow);
  const current = stages[stages.length - 1];
  return current ? [current] : [];
}
