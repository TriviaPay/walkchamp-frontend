/**
 * Observer hook — screens must not be the only place that can submit.
 * The global coordinator owns Health reads + POST /final-verification.
 */

import { useEffect } from "react";
import { isUnlimitedGoalFrontendEnabled } from "@/config/featureFlags";
import { syncUnlimitedFinalVerification } from "@/services/unlimitedFinalVerificationCoordinator";

export function useUnlimitedFinalVerificationObserver(
  challengeId: string | null | undefined,
  enabled = true,
): void {
  useEffect(() => {
    if (!enabled || !challengeId || !isUnlimitedGoalFrontendEnabled()) return;
    void syncUnlimitedFinalVerification(challengeId);
  }, [challengeId, enabled]);
}
