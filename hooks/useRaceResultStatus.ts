/**
 * Poll + apply GET /api/races/:id/result-status into Redux.
 * When feature is off (404), returns featureEnabled:false and callers keep legacy UI.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  getRaceResultStatus,
  isRaceVerifyFeatureEnabled,
  verificationStatusToReconciliation,
  type RaceResultStatus,
} from "@/services/raceVerificationApi";
import { store } from "@/store";
import { raceProgressActions } from "@/store/slices/raceProgressSlice";

const POLL_MS = 8_000;

export function useRaceResultStatus(
  raceId: string | null | undefined,
  opts?: { enabled?: boolean; pollWhilePending?: boolean },
) {
  const enabled = opts?.enabled !== false && !!raceId;
  const pollWhilePending = opts?.pollWhilePending !== false;
  const [status, setStatus] = useState<RaceResultStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const mountedRef = useRef(true);

  const applyToStore = useCallback((s: RaceResultStatus) => {
    if (!s.featureEnabled) return;
    const recon = verificationStatusToReconciliation(s.verificationStatus);
    store.dispatch(
      raceProgressActions.setBackendReconciliation({
        status: recon,
        backendReconciledSteps:
          s.verificationStatus === "finalized" ? s.steps : null,
        finalAuthoritativeSteps:
          s.verificationStatus === "finalized" ? s.steps : null,
      }),
    );
    if (typeof s.liveSteps === "number") {
      store.dispatch(
        raceProgressActions.updateFromBackend({
          raceSteps: s.liveSteps,
          rank: s.rank ?? undefined,
        }),
      );
    }
  }, []);

  const refresh = useCallback(async () => {
    if (!raceId || !enabled) return null;
    if (isRaceVerifyFeatureEnabled() === false) {
      const off: RaceResultStatus = {
        raceStatus: "unknown",
        settlementStatus: "awaiting_verification",
        verificationStatus: "live",
        liveSteps: null,
        steps: null,
        rank: null,
        payoutCents: null,
        featureEnabled: false,
      };
      if (mountedRef.current) setStatus(off);
      return off;
    }
    setLoading(true);
    try {
      const next = await getRaceResultStatus(raceId);
      if (!mountedRef.current) return next;
      if (next) {
        setStatus(next);
        applyToStore(next);
      }
      return next;
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [applyToStore, enabled, raceId]);

  useEffect(() => {
    mountedRef.current = true;
    if (!enabled || !raceId) return;
    void refresh();
    return () => {
      mountedRef.current = false;
    };
  }, [enabled, raceId, refresh]);

  useEffect(() => {
    if (!enabled || !raceId || !pollWhilePending) return;
    if (status && !status.featureEnabled) return;
    if (status?.verificationStatus === "finalized") return;
    if (status?.verificationStatus === "verification_rejected") return;

    const t = setInterval(() => {
      void refresh();
    }, POLL_MS);
    return () => clearInterval(t);
  }, [
    enabled,
    pollWhilePending,
    raceId,
    refresh,
    status?.featureEnabled,
    status?.verificationStatus,
  ]);

  return { status, loading, refresh };
}
