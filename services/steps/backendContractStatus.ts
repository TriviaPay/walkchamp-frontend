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
 *   - Client soft-handles: ignored:true / unchanged:true
 *
 * Live race POST /api/races/:id/progress
 *   - Client sends: steps, sequenceId, stepSource, optional deviceTotalSteps
 *   - Client sends: sessionId + trackingSessionId (≤64 chars)
 *
 * Race verify POST /api/races/:id/verify
 *   - Client sends HC/HK race-window totals periodically + at goal flush
 *   - 404 → feature off (soft-skip)
 *
 * Result status GET /api/races/:id/result-status
 *   - Authoritative for finalized rank / steps / payoutCents
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
  progressSessionIdMaxLen: 64,
  raceVerifyEndpointClient: true,
  raceResultStatusEndpointClient: true,
  progressSessionIdBackendVerified: false,
  winnerUsesBackendReconciliationVerified: false,
  multiDevicePolicyVerified: false,
} as const;
