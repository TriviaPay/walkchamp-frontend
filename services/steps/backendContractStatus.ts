/**
 * Backend contract notes for hybrid step sources (frontend repo).
 *
 * This repository does NOT contain the Walk Champ API server. Client callers
 * post to a remote backend. Verified below is what the *frontend* sends and
 * validates locally — not server-side enforcement.
 *
 * Verified daily POST /api/walk/steps
 *   - Client sends: health_connect | healthkit (canonical)
 *   - Client rejects: android_step_counter | ios_pedometer for daily outbox
 *
 * Live race POST /api/races/:id/progress
 *   - Client sends: steps, sequenceId, stepSource, optional deviceTotalSteps
 *   - Client now also sends: sessionId + trackingSessionId (forward-compatible)
 *   - Backend acceptance of sessionId: UNVERIFIED in this repo (Pending)
 *
 * Reconcile POST /api/races/:id/reconcile-steps
 *   - Client sends: { steps, source }
 *
 * Winner / payout
 *   - Settled on remote backend (see docs/PAYMENTS_BACKEND_HANDOFF.md)
 *   - Frontend must not invent winners from local sensor max()
 */

export const BACKEND_CONTRACT_STATUS = {
  repoContainsApiServer: false,
  verifiedDailySourcesClientEnforced: ["health_connect", "healthkit"] as const,
  liveRaceSourcesClientAccepted: [
    "android_step_counter",
    "ios_pedometer",
    "device_sensor",
  ] as const,
  progressSequenceIdSent: true,
  progressSessionIdSent: true,
  progressSessionIdBackendVerified: false,
  winnerUsesBackendReconciliationVerified: false,
  multiDevicePolicyVerified: false,
} as const;
