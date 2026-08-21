/**
 * Single WalkChamp step-engine state. Screens consume this instead of
 * combining Health Connect writer-detection with sensor status.
 */

export type VerifiedProvider = "health_connect" | "healthkit" | "none";

export type VerifiedStatus =
  | "initializing"
  | "unavailable"
  | "update_required"
  | "permission_required"
  | "ready_no_data"
  | "ready"
  | "error";

export type SensorStatus =
  | "sensor_initializing"
  | "sensor_permission_required"
  | "sensor_ready"
  | "sensor_unavailable"
  | "sensor_error";

export type VerifiedCapabilityKind =
  | "native_hc"
  | "hc_available"
  | "external_hc_confirmed"
  | "healthkit"
  | "pending"
  | "unavailable";

export type ProvisionalStatus =
  | "unavailable"
  | "permission_required"
  | "ready"
  | "error";

export type DisplayVerification =
  | "verified"
  | "syncing"
  | "local_only"
  | "provisional"
  | "error";

export type PrizeBlockReason =
  | null
  | "health_permission_required"
  | "health_connect_update_required"
  | "verified_source_not_established"
  | "verified_provider_unavailable";

export type StepProviderNextAction =
  | "none"
  | "update_health_connect"
  | "grant_health_permission"
  | "grant_activity_permission"
  | "retry";

export type StepProviderState = {
  platform: "android" | "ios";
  verifiedProvider: VerifiedProvider;
  verifiedStatus: VerifiedStatus;
  verifiedCapability: VerifiedCapabilityKind;
  verifiedSteps: number | null;
  onDeviceHcStepsAvailable: boolean;
  localProvider: "step_counter" | "cmpedometer" | "none";
  localStatus: ProvisionalStatus;
  localTodaySteps: number | null;
  provisionalStatus: ProvisionalStatus;
  provisionalTodayEstimate: number | null;
  displayedSteps: number;
  displayVerification: DisplayVerification;
  canUsePrizeFeatures: boolean;
  canJoinPrizeChallenge: boolean;
  prizeBlockReason: PrizeBlockReason;
  nextAction: StepProviderNextAction;
};

export function resolveVerifiedStatusFromSdk(args: {
  sdkAvailability: "available" | "not_installed" | "needs_update" | "not_supported";
  readGranted: boolean;
  aggregateSteps: number;
  readError?: boolean;
}): VerifiedStatus {
  if (args.readError) return "error";
  if (args.sdkAvailability === "not_supported") return "unavailable";
  if (args.sdkAvailability === "not_installed") return "update_required";
  if (args.sdkAvailability === "needs_update") return "update_required";
  if (!args.readGranted) return "permission_required";
  if (args.aggregateSteps > 0) return "ready";
  return "ready_no_data";
}

export function resolveVerifiedCapabilityKind(args: {
  platform: "android" | "ios";
  hcAvailable: boolean;
  readGranted: boolean;
  nativeOnDeviceSteps: boolean;
  externalConfirmed: boolean;
}): VerifiedCapabilityKind {
  if (args.platform === "ios") {
    return args.readGranted ? "healthkit" : args.hcAvailable ? "pending" : "unavailable";
  }
  if (!args.hcAvailable) return "unavailable";
  if (!args.readGranted) return "pending";
  if (args.nativeOnDeviceSteps) return "native_hc";
  if (args.externalConfirmed) return "external_hc_confirmed";
  // Ext <20: Health Connect is still the verified authority.
  // Native phone capture is a separate capability.
  return "hc_available";
}

export function resolvePrizeEligibility(args: {
  verifiedStatus: VerifiedStatus;
  verifiedCapability: VerifiedCapabilityKind;
}): { canUsePrizeFeatures: boolean; prizeBlockReason: PrizeBlockReason } {
  if (args.verifiedStatus === "permission_required") {
    return {
      canUsePrizeFeatures: false,
      prizeBlockReason: "health_permission_required",
    };
  }
  if (args.verifiedStatus === "update_required") {
    return {
      canUsePrizeFeatures: false,
      prizeBlockReason: "health_connect_update_required",
    };
  }
  if (
    args.verifiedStatus === "unavailable" ||
    args.verifiedCapability === "unavailable"
  ) {
    return {
      canUsePrizeFeatures: false,
      prizeBlockReason: "verified_provider_unavailable",
    };
  }
  if (args.verifiedStatus === "error") {
    return {
      canUsePrizeFeatures: false,
      prizeBlockReason: "verified_provider_unavailable",
    };
  }
  const capable =
    args.verifiedCapability === "native_hc" ||
    args.verifiedCapability === "hc_available" ||
    args.verifiedCapability === "external_hc_confirmed" ||
    args.verifiedCapability === "healthkit";
  if (
    capable &&
    (args.verifiedStatus === "ready" || args.verifiedStatus === "ready_no_data")
  ) {
    return { canUsePrizeFeatures: true, prizeBlockReason: null };
  }
  return {
    canUsePrizeFeatures: false,
    prizeBlockReason: "verified_source_not_established",
  };
}

export function resolveStepProviderNextAction(args: {
  verifiedStatus: VerifiedStatus;
  verifiedCapability: VerifiedCapabilityKind;
  sdkAvailability?: "available" | "not_installed" | "needs_update" | "not_supported";
  onDeviceHcStepsAvailable: boolean;
  provisionalStatus: ProvisionalStatus;
}): StepProviderNextAction {
  if (args.verifiedStatus === "update_required") return "update_health_connect";
  if (args.verifiedStatus === "permission_required") {
    return "grant_health_permission";
  }
  if (args.provisionalStatus === "permission_required") {
    return "grant_activity_permission";
  }
  if (args.verifiedStatus === "error" || args.verifiedStatus === "unavailable") {
    return "retry";
  }
  return "none";
}

export function resolveStepProviderState(args: {
  platform: "android" | "ios";
  verifiedProvider: VerifiedProvider;
  verifiedStatus: VerifiedStatus;
  verifiedCapability: VerifiedCapabilityKind;
  verifiedSteps: number | null;
  onDeviceHcStepsAvailable: boolean;
  localProvider?: "step_counter" | "cmpedometer" | "none";
  localStatus?: ProvisionalStatus;
  localTodaySteps?: number | null;
  provisionalStatus: ProvisionalStatus;
  provisionalTodayEstimate: number | null;
  displayedSteps: number;
  sdkAvailability?: "available" | "not_installed" | "needs_update" | "not_supported";
}): StepProviderState {
  const verified = Math.max(0, Math.floor(args.verifiedSteps ?? 0));
  const local = Math.max(0, Math.floor(args.localTodaySteps ?? 0));
  const display = Math.max(
    0,
    Math.floor(args.displayedSteps),
    local,
  );
  const prize = resolvePrizeEligibility({
    verifiedStatus: args.verifiedStatus,
    verifiedCapability: args.verifiedCapability,
  });

  let displayVerification: DisplayVerification = "local_only";
  if (args.verifiedStatus === "error") {
    displayVerification = "error";
  } else if (prize.canUsePrizeFeatures && display <= verified) {
    displayVerification = "verified";
  } else if (prize.canUsePrizeFeatures && display > verified) {
    displayVerification = "syncing";
  } else if (args.verifiedStatus === "ready_no_data") {
    displayVerification = local > 0 || display > 0 ? "local_only" : "verified";
  } else if (args.provisionalStatus === "ready") {
    displayVerification = "local_only";
  } else {
    displayVerification = "provisional";
  }

  const localStatus = args.localStatus ?? args.provisionalStatus;
  return {
    platform: args.platform,
    verifiedProvider: args.verifiedProvider,
    verifiedStatus: args.verifiedStatus,
    verifiedCapability: args.verifiedCapability,
    verifiedSteps: args.verifiedSteps,
    onDeviceHcStepsAvailable: args.onDeviceHcStepsAvailable,
    localProvider: args.localProvider ?? "none",
    localStatus,
    localTodaySteps: args.localTodaySteps ?? null,
    provisionalStatus: args.provisionalStatus,
    provisionalTodayEstimate: args.provisionalTodayEstimate,
    displayedSteps: display,
    displayVerification,
    canUsePrizeFeatures: prize.canUsePrizeFeatures,
    canJoinPrizeChallenge: prize.canUsePrizeFeatures,
    prizeBlockReason: prize.prizeBlockReason,
    nextAction: resolveStepProviderNextAction({
      verifiedStatus: args.verifiedStatus,
      verifiedCapability: args.verifiedCapability,
      sdkAvailability: args.sdkAvailability,
      onDeviceHcStepsAvailable: args.onDeviceHcStepsAvailable,
      provisionalStatus: args.provisionalStatus,
    }),
  };
}
