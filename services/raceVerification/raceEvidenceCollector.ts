/**
 * Collect minimum protected-race Health Connect / HealthKit evidence
 * for the exact server window. Never converts a read error into 0 steps.
 */

import { stepProviderManager } from "@/services/steps/stepProviderManager";
import { logger } from "@/utils/logger";
import { readProtectedRaceQualifyingSteps } from "./approvedSourceResolver";
import type {
  HealthEvidenceErrorKind,
  ProtectedSourceEvidence,
  QualifyingEvidenceSummary,
} from "./raceVerificationTypes";

function sortedUnique(values: string[]): string[] {
  return [...new Set(values.map((v) => v.trim()).filter(Boolean))].sort();
}

function emptyEvidence(): ProtectedSourceEvidence {
  return {
    automaticRecordCount: 0,
    manualEntryCount: 0,
    sourceIds: [],
    recordingMethods: [],
  };
}

export async function collectProtectedRaceEvidence(args: {
  serverStartAt: string;
  serverEndAt: string;
  approvedSourceId: string | null;
  provisionalSteps: number;
}): Promise<QualifyingEvidenceSummary> {
  const verificationReadAt = new Date().toISOString();
  const start = new Date(args.serverStartAt);
  const end = new Date(args.serverEndAt);

  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start) {
    return {
      qualifyingSteps: null,
      verificationReadAt,
      errorKind: "PLATFORM_ERROR",
      sourceEvidence: emptyEvidence(),
    };
  }

  if (args.approvedSourceId) {
    const filtered = await readProtectedRaceQualifyingSteps({
      start,
      end,
      approvedSourceId: args.approvedSourceId,
    });
    if (filtered) {
      const sourceIds = sortedUnique(
        filtered.unexpectedOriginDetected
          ? [args.approvedSourceId]
          : [args.approvedSourceId],
      );
      const recordingMethods = sortedUnique(
        filtered.recordingMethodSummary
          ? [filtered.recordingMethodSummary]
          : ["automatic"],
      );
      const sourceEvidence: ProtectedSourceEvidence = {
        automaticRecordCount:
          (filtered.steps ?? 0) > 0 ? Math.max(1, filtered.originCount || 1) : 0,
        manualEntryCount: 0,
        sourceIds,
        recordingMethods,
      };
      let errorKind: HealthEvidenceErrorKind | null = null;
      if (filtered.unexpectedOriginDetected) errorKind = "SOURCE_NOT_APPROVED";
      else if ((filtered.steps ?? 0) === 0 && args.provisionalSteps > 0) {
        errorKind = "SYNC_DELAYED";
      } else if ((filtered.steps ?? 0) === 0) errorKind = "READY_NO_DATA";

      return {
        qualifyingSteps: filtered.unexpectedOriginDetected ? null : filtered.steps,
        verificationReadAt,
        errorKind,
        sourceEvidence,
      };
    }
  }

  try {
    const snap = await stepProviderManager.getStepsForRange(start, end);
    if (!snap) {
      return {
        qualifyingSteps: null,
        verificationReadAt,
        errorKind: "VERIFICATION_PENDING",
        sourceEvidence: emptyEvidence(),
      };
    }

    const origins = Array.isArray((snap as { dataOrigins?: string[] }).dataOrigins)
      ? ((snap as { dataOrigins?: string[] }).dataOrigins as string[])
      : [];
    const sourceIds = sortedUnique(
      origins.length ? origins : args.approvedSourceId ? [args.approvedSourceId] : [],
    );
    const steps = Math.max(0, Math.floor(snap.steps));
    const sourceEvidence: ProtectedSourceEvidence = {
      automaticRecordCount: steps > 0 ? Math.max(1, sourceIds.length || 1) : 0,
      manualEntryCount: 0,
      sourceIds,
      recordingMethods: sortedUnique(["automatic"]),
    };

    let errorKind: HealthEvidenceErrorKind | null = null;
    if (steps === 0 && args.provisionalSteps > 0) errorKind = "SYNC_DELAYED";
    else if (steps === 0) errorKind = "READY_NO_DATA";

    return {
      qualifyingSteps: steps,
      verificationReadAt,
      errorKind,
      sourceEvidence,
    };
  } catch (err) {
    logger.debug("PrizeEvidence", `health read error: ${String(err)}`);
    return {
      qualifyingSteps: null,
      verificationReadAt,
      errorKind: "PLATFORM_ERROR",
      sourceEvidence: emptyEvidence(),
    };
  }
}
