/**
 * Integrity binding for protected-race evidence.
 * Hash first, then request Play Integrity / App Attest with that requestHash.
 * Frontend never decides token validity.
 */

import { Platform } from "react-native";
import { requireOptionalExpoNativeModule } from "@/utils/expoNativeModule";
import {
  isAppAttestEnabled,
  isPlayIntegrityEnabled,
} from "@/config/featureFlags";
import type { ProtectedIntegrityProvider } from "./raceVerificationTypes";

type IntegrityNative = {
  isPlayIntegrityAvailable?: () => boolean;
  requestPlayIntegrityToken?: (requestHash: string) => Promise<string | null>;
  isAppAttestAvailable?: () => boolean;
  requestAppAttestAssertion?: (
    clientDataHash: string,
    challenge: string,
  ) => Promise<string | null>;
};

function native(): IntegrityNative | null {
  return requireOptionalExpoNativeModule<IntegrityNative>("WalkChampRaceProgress");
}

export async function isIntegrityCapabilityAvailable(): Promise<boolean> {
  if (Platform.OS === "android") {
    if (!isPlayIntegrityEnabled()) return false;
    try {
      return native()?.isPlayIntegrityAvailable?.() === true;
    } catch {
      return false;
    }
  }
  if (Platform.OS === "ios") {
    if (!isAppAttestEnabled()) return false;
    try {
      return native()?.isAppAttestAvailable?.() === true;
    } catch {
      return false;
    }
  }
  return false;
}

export async function requestIntegrityToken(args: {
  requestHash: string;
  serverChallenge: string;
}): Promise<{
  token: string | null;
  provider: ProtectedIntegrityProvider;
}> {
  const provider: ProtectedIntegrityProvider =
    Platform.OS === "ios" ? "ios_app_attest" : "android_play_integrity";
  const mod = native();

  if (Platform.OS === "android" && isPlayIntegrityEnabled()) {
    try {
      const token = await mod?.requestPlayIntegrityToken?.(args.requestHash);
      return {
        token: typeof token === "string" && token ? token : null,
        provider,
      };
    } catch {
      return { token: null, provider };
    }
  }

  if (Platform.OS === "ios" && isAppAttestEnabled()) {
    try {
      const token = await mod?.requestAppAttestAssertion?.(
        args.requestHash,
        args.serverChallenge,
      );
      return {
        token: typeof token === "string" && token ? token : null,
        provider,
      };
    } catch {
      return { token: null, provider };
    }
  }

  return { token: null, provider };
}
