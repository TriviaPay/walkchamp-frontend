/**
 * Backend-status-driven final race authority.
 * Never use max(local, verified, backend) — a larger provisional must not
 * override intentional downward reconciliation.
 *
 * Run tests: npx tsx services/steps/finalRaceAuthority.test.ts
 */

export type RaceReconciliationStatus =
  | "not_started"
  | "pending"
  | "verification_delayed"
  | "review_required"
  | "finalized";

export type FinalRaceAuthorityInput = {
  targetSteps: number;
  /** Backend participant steps when race completed (accepted live or settled). */
  backendAcceptedLiveSteps: number | null | undefined;
  /** Backend reconciled total when settlement completed. */
  backendReconciledSteps: number | null | undefined;
  reconciliationStatus: RaceReconciliationStatus;
  /** Local provisional sensor/pedometer — display only, never final authority. */
  localLiveSteps: number;
};

export type FinalRaceAuthorityResult =
  | {
      kind: "finalized";
      finalAuthoritativeSteps: number;
      displayLabel: "Final result verified";
    }
  | {
      kind: "review_required";
      finalAuthoritativeSteps: null;
      provisionalDisplaySteps: number;
      displayLabel: "Result under review";
    }
  | {
      kind: "provisional";
      finalAuthoritativeSteps: null;
      provisionalDisplaySteps: number;
      displayLabel: "Live progress" | "Verification pending";
    };

/**
 * Resolve display + authoritative finalize values from backend status.
 * Raw local sensor progress never overrides a finalized backend value.
 */
export function resolveFinalRaceAuthority(
  input: FinalRaceAuthorityInput,
): FinalRaceAuthorityResult {
  const target = Math.max(0, Math.floor(input.targetSteps));
  const cap = (n: number) => Math.min(target, Math.max(0, Math.floor(n)));

  if (input.reconciliationStatus === "finalized") {
    const reconciled =
      input.backendReconciledSteps != null
        ? cap(input.backendReconciledSteps)
        : input.backendAcceptedLiveSteps != null
          ? cap(input.backendAcceptedLiveSteps)
          : null;
    if (reconciled != null) {
      return {
        kind: "finalized",
        finalAuthoritativeSteps: reconciled,
        displayLabel: "Final result verified",
      };
    }
  }

  if (input.reconciliationStatus === "review_required") {
    const provisional =
      input.backendAcceptedLiveSteps != null
        ? cap(input.backendAcceptedLiveSteps)
        : cap(input.localLiveSteps);
    return {
      kind: "review_required",
      finalAuthoritativeSteps: null,
      provisionalDisplaySteps: provisional,
      displayLabel: "Result under review",
    };
  }

  // pending / delayed / not_started — show backend-accepted live when present
  const provisional =
    input.backendAcceptedLiveSteps != null
      ? cap(input.backendAcceptedLiveSteps)
      : cap(input.localLiveSteps);

  return {
    kind: "provisional",
    finalAuthoritativeSteps: null,
    provisionalDisplaySteps: provisional,
    displayLabel:
      input.reconciliationStatus === "verification_delayed" ||
      input.reconciliationStatus === "pending"
        ? "Verification pending"
        : "Live progress",
  };
}

/**
 * Steps to show on the finished-race UI card.
 * Prefer final authoritative; otherwise provisional display; never invent
 * a max() across local + verified + reconciled.
 */
export function resolveFinishedRaceDisplaySteps(
  result: FinalRaceAuthorityResult,
): number {
  if (result.kind === "finalized") {
    return result.finalAuthoritativeSteps;
  }
  return result.provisionalDisplaySteps;
}
