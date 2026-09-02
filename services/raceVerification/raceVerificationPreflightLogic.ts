/**
 * Pure readiness evaluation for protected races.
 * Platform probes inject facts; this does not touch stepProgressCoordinator.
 */

import type { PrizeRaceReadiness } from "./raceVerificationTypes";

export type PrizeReadinessFacts = {
  authenticated: boolean;
  internetConnected: boolean;
  registeredDeviceId: string | null;
  currentDeviceId: string | null;
  verificationSessionObtained: boolean;
  raceAlreadyStarted: boolean;
  raceAlreadyEnded: boolean;
  integrityCapabilityAvailable: boolean;
  /** When integrityRequired is false, integrityReady is treated as true. */
  integrityRequired: boolean;

  sensorReady: boolean;
  healthPlatformReady: boolean;
  approvedSourceReady: boolean;

  /** Android: API >= 34 */
  androidApiOk?: boolean;
  /** Android: HC SDK extension for native on-device steps */
  sdkExtensionOk?: boolean;
};

export function evaluatePrizeRaceReadiness(
  facts: PrizeReadinessFacts,
): PrizeRaceReadiness {
  const registeredDeviceReady =
    !!facts.registeredDeviceId &&
    !!facts.currentDeviceId &&
    facts.registeredDeviceId === facts.currentDeviceId;

  const integrityReady =
    !facts.integrityRequired || facts.integrityCapabilityAvailable;

  const connectivityReady = facts.internetConnected;

  let failureReason: string | undefined;
  if (!facts.authenticated) failureReason = "not_authenticated";
  else if (!connectivityReady) failureReason = "offline";
  else if (!facts.verificationSessionObtained) {
    failureReason = "verification_session_missing";
  } else if (facts.raceAlreadyEnded) failureReason = "race_ended";
  else if (facts.raceAlreadyStarted) failureReason = "race_already_started";
  else if (!registeredDeviceReady) failureReason = "device_mismatch";
  else if (facts.androidApiOk === false) failureReason = "android_api_unsupported";
  else if (facts.sdkExtensionOk === false) {
    failureReason = "hc_sdk_extension_unavailable";
  } else if (!facts.sensorReady) failureReason = "sensor_unavailable";
  else if (!facts.healthPlatformReady) failureReason = "health_platform_not_ready";
  else if (!facts.approvedSourceReady) failureReason = "source_not_approved";
  else if (!integrityReady) failureReason = "integrity_unavailable";

  const eligible =
    facts.authenticated &&
    connectivityReady &&
    facts.verificationSessionObtained &&
    !facts.raceAlreadyStarted &&
    !facts.raceAlreadyEnded &&
    registeredDeviceReady &&
    facts.sensorReady &&
    facts.healthPlatformReady &&
    facts.approvedSourceReady &&
    integrityReady &&
    facts.androidApiOk !== false &&
    facts.sdkExtensionOk !== false;

  return {
    eligible,
    sensorReady: facts.sensorReady,
    healthPlatformReady: facts.healthPlatformReady,
    approvedSourceReady: facts.approvedSourceReady,
    registeredDeviceReady,
    integrityReady,
    connectivityReady,
    failureReason,
    userMessage: eligible
      ? "Ready to Race"
      : "Your step tracker isn't ready for verified challenges.",
  };
}

/** Compare provisional sensor vs qualifying health within recon tolerance. */
export function areHybridCountsConsistent(args: {
  provisionalSteps: number;
  qualifyingSteps: number;
  absTolerance: number;
}): boolean {
  return (
    Math.abs(args.provisionalSteps - args.qualifyingSteps) <=
    Math.max(0, args.absTolerance)
  );
}
