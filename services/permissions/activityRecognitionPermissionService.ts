/**
 * Centralized ACTIVITY_RECOGNITION permission for Android step tracking.
 */

import { PermissionsAndroid, Platform } from "react-native";

let inFlightRequest: Promise<boolean> | null = null;

function permLog(msg: string): void {
  console.log(`[Permissions] ${msg}`);
}

export async function ensureActivityRecognitionPermission(): Promise<boolean> {
  if (Platform.OS !== "android") return true;
  if (inFlightRequest) return inFlightRequest;

  inFlightRequest = (async () => {
    permLog(`Android SDK version=${Platform.Version}`);

    const permission = PermissionsAndroid.PERMISSIONS.ACTIVITY_RECOGNITION;
    if (!permission) {
      permLog("activity recognition not required on this API level");
      return true;
    }

    try {
      const alreadyGranted = await PermissionsAndroid.check(permission);
      if (alreadyGranted) {
        permLog("activity recognition granted=true");
        return true;
      }

      const result = await PermissionsAndroid.request(permission);
      const granted = result === PermissionsAndroid.RESULTS.GRANTED;
      permLog(`activity recognition granted=${granted}`);
      return granted;
    } catch (error) {
      permLog(`activity recognition request failed: ${String(error)}`);
      return false;
    }
  })().finally(() => {
    inFlightRequest = null;
  });

  return inFlightRequest;
}

export async function hasActivityRecognitionPermission(): Promise<boolean> {
  if (Platform.OS !== "android") return true;

  const permission = PermissionsAndroid.PERMISSIONS.ACTIVITY_RECOGNITION;
  if (!permission) return true;

  try {
    return await PermissionsAndroid.check(permission);
  } catch {
    return false;
  }
}

export function getActivityRecognitionDeniedMessage(): string {
  return "Physical activity permission is required to track steps.";
}
