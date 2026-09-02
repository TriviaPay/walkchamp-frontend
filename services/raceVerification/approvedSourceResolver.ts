/**
 * Resolve locked current-device native Health Connect / HealthKit source
 * for protected races only. Never hardcode origin as "android".
 */

import { Platform } from "react-native";
import { requireOptionalExpoNativeModule } from "@/utils/expoNativeModule";
import { isPhoneOnlyProtectedRaceEnabled } from "@/config/featureFlags";

type SourceNative = {
  resolveNativeHealthConnectSourceId?: () => Promise<string | null>;
  resolveApprovedHealthKitSourceId?: () => Promise<string | null>;
  readProtectedRaceSteps?: (args: {
    startMs: number;
    endMs: number;
    approvedSourceId: string;
  }) => Promise<{
    steps: number;
    originCount: number;
    unexpectedOriginDetected: boolean;
    firstRecordAt?: string | null;
    lastRecordAt?: string | null;
    recordingMethodSummary?: string | null;
  } | null>;
};

function native(): SourceNative | null {
  return requireOptionalExpoNativeModule<SourceNative>("WalkChampRaceProgress");
}

import { isOriginBlockedForProtectedRace } from "./approvedSourcePolicy";

export { isOriginBlockedForProtectedRace };

export async function resolveApprovedNativeSourceId(): Promise<{
  approvedSourceId: string | null;
  ready: boolean;
  reason?: string;
}> {
  if (!isPhoneOnlyProtectedRaceEnabled()) {
    return { approvedSourceId: null, ready: true };
  }

  if (Platform.OS === "android") {
    try {
      const id = await native()?.resolveNativeHealthConnectSourceId?.();
      if (typeof id === "string" && id.trim() && !isOriginBlockedForProtectedRace(id)) {
        return { approvedSourceId: id.trim(), ready: true };
      }
      return {
        approvedSourceId: null,
        ready: false,
        reason: "native_hc_source_unresolved",
      };
    } catch {
      return {
        approvedSourceId: null,
        ready: false,
        reason: "native_hc_source_error",
      };
    }
  }

  if (Platform.OS === "ios") {
    try {
      const id = await native()?.resolveApprovedHealthKitSourceId?.();
      if (typeof id === "string" && id.trim()) {
        return { approvedSourceId: id.trim(), ready: true };
      }
      // Soft readiness: native may not yet expose HK source API.
      // Preflight still requires demonstrable HK readability separately.
      return {
        approvedSourceId: null,
        ready: false,
        reason: "healthkit_source_unresolved",
      };
    } catch {
      return {
        approvedSourceId: null,
        ready: false,
        reason: "healthkit_source_error",
      };
    }
  }

  return { approvedSourceId: null, ready: false, reason: "unsupported_platform" };
}

export async function readProtectedRaceQualifyingSteps(args: {
  start: Date;
  end: Date;
  approvedSourceId: string;
}): Promise<{
  steps: number | null;
  originCount: number;
  unexpectedOriginDetected: boolean;
  firstRecordAt?: string | null;
  lastRecordAt?: string | null;
  recordingMethodSummary?: string | null;
  usedNativeFilter: boolean;
} | null> {
  try {
    const nativeResult = await native()?.readProtectedRaceSteps?.({
      startMs: args.start.getTime(),
      endMs: args.end.getTime(),
      approvedSourceId: args.approvedSourceId,
    });
    if (nativeResult && typeof nativeResult.steps === "number") {
      return {
        steps: Math.max(0, Math.floor(nativeResult.steps)),
        originCount: nativeResult.originCount ?? 1,
        unexpectedOriginDetected: !!nativeResult.unexpectedOriginDetected,
        firstRecordAt: nativeResult.firstRecordAt ?? null,
        lastRecordAt: nativeResult.lastRecordAt ?? null,
        recordingMethodSummary: nativeResult.recordingMethodSummary ?? null,
        usedNativeFilter: true,
      };
    }
  } catch {
    /* fall through — caller must not convert to zero */
  }
  return null;
}
