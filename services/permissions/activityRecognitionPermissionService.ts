/**
 * Centralized ACTIVITY_RECOGNITION permission for Android walking progress.
 *
 * First HC setup ("allow all"): themed modal → OS sheet once after Done.
 * Enable Step Tracking must NOT call this (HC READ_STEPS only).
 * Later Walk/Profile enables check-only — no re-prompt loop.
 * Settings helper is used only for NEVER_ASK_AGAIN.
 */

import { Linking, PermissionsAndroid, Platform } from "react-native";
import { presentPhysicalActivityPermissionPrompt } from "@/components/PhysicalActivityPermissionModal";

let inFlightRequest: Promise<boolean> | null = null;

function permLog(msg: string): void {
  console.log(`[Permissions] ${msg}`);
}

export async function ensureActivityRecognitionPermission(
  options?: { allowSettingsHelper?: boolean; promptIfMissing?: boolean },
): Promise<boolean> {
  if (Platform.OS !== "android") return true;
  if (inFlightRequest) return inFlightRequest;

  const allowSettingsHelper = options?.allowSettingsHelper !== false;
  const promptIfMissing = options?.promptIfMissing !== false;

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

      if (!promptIfMissing) {
        permLog("activity recognition granted=false (no prompt)");
        return false;
      }

      // Themed explanation once, then the OS Physical activity sheet.
      const choice = await presentPhysicalActivityPermissionPrompt("request");
      if (choice !== "allow") {
        permLog("activity recognition granted=false (user dismissed in-app prompt)");
        return false;
      }

      const result = await PermissionsAndroid.request(permission);
      const granted = result === PermissionsAndroid.RESULTS.GRANTED;
      permLog(`activity recognition granted=${granted} result=${String(result)}`);

      if (
        !granted &&
        allowSettingsHelper &&
        result === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN
      ) {
        const again = await presentPhysicalActivityPermissionPrompt("settings");
        if (again === "open_settings") {
          await Linking.openSettings().catch(() => {});
        }
      }

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

export async function promptActivityRecognitionAgain(): Promise<boolean> {
  if (Platform.OS !== "android") return true;

  const permission = PermissionsAndroid.PERMISSIONS.ACTIVITY_RECOGNITION;
  if (!permission) return true;

  try {
    if (await PermissionsAndroid.check(permission)) return true;

    const result = await PermissionsAndroid.request(permission);
    if (result === PermissionsAndroid.RESULTS.GRANTED) return true;

    const choice = await presentPhysicalActivityPermissionPrompt("settings");
    if (choice === "open_settings") {
      await Linking.openSettings().catch(() => {});
    }
    return false;
  } catch {
    return false;
  }
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
  return "Physical activity access is needed so your walking progress can keep updating in the background. Enable it in Android Settings → Apps → WalkChamp → Permissions, or reopen step tracking setup from Profile.";
}

export function getActivityRecognitionSettingsHint(): string {
  return "Android Settings → Apps → WalkChamp → Permissions → Physical activity";
}
