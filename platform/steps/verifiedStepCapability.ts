/**
 * Centralized verified-step capability + race/action guard.
 * Opens the existing WearableSetupModal via callback — no new modal.
 */

import { Platform } from "react-native";
import { stepProviderManager } from "@/services/steps/stepProviderManager";
import { androidHCService, isExpoGo } from "@/services/steps/androidHealthConnectService";

export type VerifiedStepProviderStatus =
  | "checking"
  | "not_installed"
  | "permission_required"
  | "permission_denied"
  | "connected"
  | "provider_required"
  | "unsupported"
  | "temporarily_unavailable"
  | "error";

export type VerifiedStepProviderResult = {
  provider: "health_connect" | "healthkit" | "none";
  status: VerifiedStepProviderStatus;
  isSupported: boolean;
  isInstalled: boolean;
  hasPermission: boolean;
  canTrackSteps: boolean;
  reasonCode?: string;
};

export type VerifiedStepCapability = {
  canTrackVerifiedSteps: boolean;
  canParticipateInRaces: boolean;
  viewOnlyMode: boolean;
  result: VerifiedStepProviderResult;
};

export async function resolveVerifiedStepProvider(): Promise<VerifiedStepProviderResult> {
  if (Platform.OS === "android" && isExpoGo()) {
    return {
      provider: "none",
      status: "unsupported",
      isSupported: false,
      isInstalled: false,
      hasPermission: false,
      canTrackSteps: false,
      reasonCode: "expo_go",
    };
  }

  try {
    await stepProviderManager.initialize(true);
    const status = await stepProviderManager.refreshStatus();
    const id = status.providerId;

    if (Platform.OS === "ios") {
      const provider: VerifiedStepProviderResult["provider"] =
        id === "ios_healthkit" ? "healthkit" : "none";
      if (status.permission === "granted" && provider === "healthkit") {
        return {
          provider: "healthkit",
          status: "connected",
          isSupported: true,
          isInstalled: true,
          hasPermission: true,
          canTrackSteps: true,
        };
      }
      if (status.permission === "denied") {
        return {
          provider: "healthkit",
          status: "permission_denied",
          isSupported: true,
          isInstalled: true,
          hasPermission: false,
          canTrackSteps: false,
          reasonCode: "healthkit_denied",
        };
      }
      if (!status.ready && provider === "none") {
        return {
          provider: "none",
          status: "unsupported",
          isSupported: false,
          isInstalled: false,
          hasPermission: false,
          canTrackSteps: false,
          reasonCode: "healthkit_unavailable",
        };
      }
      return {
        provider: "healthkit",
        status: "permission_required",
        isSupported: true,
        isInstalled: true,
        hasPermission: false,
        canTrackSteps: false,
      };
    }

    if (Platform.OS === "android") {
      const init = await androidHCService.initialize();
      const blocked = androidHCService.isRangeReadBlocked();
      const avail = init.availability;

      if (blocked || avail === "not_supported") {
        return {
          provider: "none",
          status: "unsupported",
          isSupported: false,
          isInstalled: false,
          hasPermission: false,
          canTrackSteps: false,
          reasonCode: "health_connect_unsupported",
        };
      }
      if (avail === "not_installed" || avail === "needs_update") {
        return {
          provider: "health_connect",
          status: "not_installed",
          isSupported: true,
          isInstalled: false,
          hasPermission: false,
          canTrackSteps: false,
          reasonCode: avail,
        };
      }

      const {
        isHealthConnectOnDeviceStepsAvailable,
      } = await import("@/services/steps/hcOnDeviceSteps");
      const {
        getExternalVerifiedSourceConfirmed,
        resolveVerifiedCapabilityKind,
      } = await import("@/services/steps/verifiedCapabilityStore");
      const nativeHc = isHealthConnectOnDeviceStepsAvailable();
      const readGranted =
        status.permission === "granted" && id === "android_health_connect";
      if (readGranted) {
        const externalConfirmed = await getExternalVerifiedSourceConfirmed();
        const capability = resolveVerifiedCapabilityKind({
          platform: "android",
          hcAvailable: true,
          readGranted: true,
          nativeOnDeviceSteps: nativeHc,
          externalConfirmed,
        });
        return {
          provider: "health_connect",
          status: "connected",
          isSupported: true,
          isInstalled: true,
          hasPermission: true,
          canTrackSteps: true,
          reasonCode: capability,
        };
      }
      if (status.permission === "denied") {
        return {
          provider: "health_connect",
          status: "permission_denied",
          isSupported: true,
          isInstalled: true,
          hasPermission: false,
          canTrackSteps: false,
          reasonCode: "health_connect_denied",
        };
      }
      return {
        provider: "health_connect",
        status: "permission_required",
        isSupported: true,
        isInstalled: true,
        hasPermission: false,
        canTrackSteps: false,
      };
    }

    return {
      provider: "none",
      status: "unsupported",
      isSupported: false,
      isInstalled: false,
      hasPermission: false,
      canTrackSteps: false,
    };
  } catch {
    return {
      provider: "none",
      status: "temporarily_unavailable",
      isSupported: true,
      isInstalled: false,
      hasPermission: false,
      canTrackSteps: false,
      reasonCode: "temporary_error",
    };
  }
}

export async function getVerifiedStepCapability(): Promise<VerifiedStepCapability> {
  const result = await resolveVerifiedStepProvider();
  const canTrack = result.canTrackSteps;
  return {
    canTrackVerifiedSteps: canTrack,
    canParticipateInRaces: canTrack,
    viewOnlyMode: !canTrack,
    result,
  };
}

/**
 * Guard join/create race actions. Prefer opening existing WearableSetupModal
 * via onSetupRequired instead of a new modal.
 */
export async function requireVerifiedStepTracking(options: {
  action: string;
  onAllowed: () => void | Promise<void>;
  onSetupRequired: (result: VerifiedStepProviderResult) => void;
}): Promise<boolean> {
  const result = await resolveVerifiedStepProvider();
  if (result.canTrackSteps) {
    await options.onAllowed();
    return true;
  }
  if (__DEV__) {
    console.log(
      `[VerifiedSteps] blocked action=${options.action} status=${result.status} reason=${result.reasonCode ?? ""}`,
    );
  }
  options.onSetupRequired(result);
  return false;
}

/** True if a backend/API source string is allowed for verified submissions. */
export { isAcceptedVerifiedSource } from "@/services/steps/verifiedStepSources";
