/**
 * Hook: protected-race verification lifecycle for LiveRaceScreen / result UI.
 */

import { useCallback, useEffect, useRef } from "react";
import { useSelector } from "react-redux";
import type { RootState } from "@/store";
import {
  beginProtectedRaceLive,
  onProtectedRaceEnd,
  submitProtectedRaceEvidence,
  stopProtectedRaceVerification,
  isProtectedPrizeRace,
  resumeProtectedRaceFromStorage,
} from "@/services/raceVerification/raceVerificationService";
import {
  isPrizeOutcomePending,
  prizeStatusDisplayLabel,
} from "@/services/raceVerification/prizeStatusLabels";
import { isProtectedRaceVerificationEnabled } from "@/config/featureFlags";

export function usePrizeVerificationState() {
  return useSelector((s: RootState) => s.prizeVerification);
}

export function useProtectedRaceVerificationLifecycle(args: {
  raceId: string | null | undefined;
  userId: string | null | undefined;
  participantId?: string | null;
  challengeType?: string | null;
  entryType?: string | null;
  entryFeeCents?: number | null;
  protectedRace?: boolean | null;
  durationMinutes?: number | null;
  raceCompleted: boolean;
  provisionalSteps: number;
  enabled?: boolean;
}) {
  const prize = usePrizeVerificationState();
  const startedRef = useRef(false);
  const evidenceSubmittedRef = useRef(false);
  const enabled =
    args.enabled !== false &&
    isProtectedRaceVerificationEnabled() &&
    !!args.raceId &&
    !!args.userId &&
    isProtectedPrizeRace({
      protectedRace: args.protectedRace,
      challengeType: args.challengeType,
      entryType: args.entryType,
      entryFeeCents: args.entryFeeCents,
    });

  useEffect(() => {
    if (!enabled || !args.raceId || !args.userId) return;
    if (prize.verificationSessionId) return;
    void resumeProtectedRaceFromStorage(args.userId);
  }, [enabled, args.raceId, args.userId, prize.verificationSessionId]);

  useEffect(() => {
    if (!enabled || !args.raceId) return;
    if (startedRef.current) return;
    if (prize.raceId === args.raceId && prize.verificationStatus === "live") {
      startedRef.current = true;
      return;
    }
    if (
      prize.raceId === args.raceId &&
      prize.preflightPassed &&
      (prize.verificationStatus === "ready" ||
        prize.verificationStatus === "preflight" ||
        prize.verificationStatus === "live")
    ) {
      beginProtectedRaceLive({
        raceId: args.raceId,
        durationMinutes: args.durationMinutes,
      });
      startedRef.current = true;
    }
  }, [
    enabled,
    args.raceId,
    args.durationMinutes,
    prize.raceId,
    prize.preflightPassed,
    prize.verificationStatus,
  ]);

  useEffect(() => {
    if (!enabled || !args.raceId || !args.raceCompleted) return;
    onProtectedRaceEnd({
      raceId: args.raceId,
      provisionalSteps: args.provisionalSteps,
    });
  }, [enabled, args.raceId, args.raceCompleted, args.provisionalSteps]);

  useEffect(() => {
    if (!enabled || !args.raceId || !args.userId || !args.raceCompleted) return;
    if (evidenceSubmittedRef.current) return;
    if (prize.evidenceSubmitted) {
      evidenceSubmittedRef.current = true;
      return;
    }
    evidenceSubmittedRef.current = true;
    void submitProtectedRaceEvidence({
      raceId: args.raceId,
      userId: args.userId,
      participantId: prize.participantId ?? args.participantId ?? args.userId,
      provisionalSteps: args.provisionalSteps,
      reason: "race_end",
    });
  }, [
    enabled,
    args.raceId,
    args.userId,
    args.participantId,
    args.raceCompleted,
    args.provisionalSteps,
    prize.participantId,
    prize.evidenceSubmitted,
  ]);

  const stop = useCallback(() => {
    stopProtectedRaceVerification();
    startedRef.current = false;
    evidenceSubmittedRef.current = false;
  }, []);

  const label = prizeStatusDisplayLabel(prize.verificationStatus, {
    settlementStatus: prize.settlementStatus,
  });
  const outcomePending = isPrizeOutcomePending(
    prize.verificationStatus,
    prize.settlementStatus,
  );

  return {
    prize,
    enabled,
    label,
    outcomePending,
    stop,
  };
}
