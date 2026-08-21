/**
 * Health Connect on-device phone steps (Android 14 + SDK Extension 20+).
 * When true, READ_STEPS is enough for HC to capture TYPE_STEP_COUNTER.
 * Wearables may still contribute through Health Connect; WalkChamp does not
 * add phone + watch itself.
 *
 * minSdk is 34. The API < 34 guard is defensive only.
 */

import { Platform } from "react-native";
import { requireOptionalExpoNativeModule } from "@/utils/expoNativeModule";

type OnDeviceStepsNative = {
  isHealthConnectOnDeviceStepsAvailable?: () => boolean;
  getHealthConnectSdkExtensionVersion?: () => number;
};

let _cachedOnDevice: boolean | null = null;
let _cachedExt: number | null = null;

function androidApiLevel(): number {
  const v = Platform.Version;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const n = Number.parseInt(String(v), 10);
  return Number.isFinite(n) ? n : 0;
}

function native(): OnDeviceStepsNative | null {
  if (Platform.OS !== "android") return null;
  try {
    return requireOptionalExpoNativeModule<OnDeviceStepsNative>(
      "WalkChampRaceProgress",
    );
  } catch {
    return null;
  }
}

export function isHealthConnectOnDeviceStepsAvailable(): boolean {
  if (Platform.OS !== "android") return false;
  // minSdk is 34. This API check is defensive only.
  if (androidApiLevel() < 34) return false;
  if (_cachedOnDevice != null) return _cachedOnDevice;
  try {
    _cachedOnDevice = native()?.isHealthConnectOnDeviceStepsAvailable?.() === true;
  } catch {
    _cachedOnDevice = false;
  }
  return _cachedOnDevice === true;
}

export function getHealthConnectSdkExtensionVersion(): number {
  if (Platform.OS !== "android") return 0;
  if (androidApiLevel() < 34) return 0;
  if (_cachedExt != null) return _cachedExt;
  try {
    const n = native()?.getHealthConnectSdkExtensionVersion?.();
    _cachedExt = typeof n === "number" && Number.isFinite(n) ? n : 0;
  } catch {
    _cachedExt = 0;
  }
  return _cachedExt;
}
