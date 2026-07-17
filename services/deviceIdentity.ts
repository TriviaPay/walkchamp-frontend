/**
 * Stable app-installation identifier (UUID).
 * Survives logout / session replacement; regenerates only after reinstall.
 * Not used as authentication. No IMEI / serial / advertising ID.
 */

import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import Constants from "expo-constants";

const INSTALLATION_ID_KEY = "wc_installation_id_v1";

let cachedInstallationId: string | null = null;
let warmPromise: Promise<string> | null = null;

function createUuid(): string {
  // RFC4122-ish v4 without extra deps
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

async function secureGet(key: string): Promise<string | null> {
  if (Platform.OS === "web") return null;
  try {
    return await SecureStore.getItemAsync(key);
  } catch {
    return null;
  }
}

async function secureSet(key: string, value: string): Promise<void> {
  if (Platform.OS === "web") return;
  try {
    await SecureStore.setItemAsync(key, value);
  } catch {
    /* ignore */
  }
}

export async function getInstallationId(): Promise<string> {
  if (cachedInstallationId) return cachedInstallationId;
  if (warmPromise) return warmPromise;

  warmPromise = (async () => {
    const existing = await secureGet(INSTALLATION_ID_KEY);
    if (existing?.trim()) {
      cachedInstallationId = existing.trim();
      return cachedInstallationId;
    }
    const id = createUuid();
    await secureSet(INSTALLATION_ID_KEY, id);
    cachedInstallationId = id;
    if (__DEV__) {
      console.log("[AuthSession] installationId created (redacted)");
    }
    return id;
  })().finally(() => {
    warmPromise = null;
  });

  return warmPromise;
}

export type DeviceSessionMetadata = {
  deviceId: string;
  platform: "android" | "ios" | "web";
  deviceModel?: string;
  manufacturer?: string;
  osName: string;
  osVersion: string;
  androidApiLevel?: number;
  appVersion: string;
  buildNumber: string;
};

/** Diagnostic / permission-orchestration metadata only — never trust for security. */
export async function getDeviceSessionMetadata(): Promise<DeviceSessionMetadata> {
  const deviceId = await getInstallationId();
  const platform =
    Platform.OS === "ios" ? "ios" : Platform.OS === "android" ? "android" : "web";
  const appVersion =
    Constants.expoConfig?.version ??
    Constants.nativeAppVersion ??
    "unknown";
  const buildNumber =
    Constants.nativeBuildVersion ??
    String(
      Constants.expoConfig?.android?.versionCode ??
        Constants.expoConfig?.ios?.buildNumber ??
        "",
    );

  const meta: DeviceSessionMetadata = {
    deviceId,
    platform,
    deviceModel: Constants.deviceName ?? undefined,
    manufacturer: undefined,
    osName: platform,
    osVersion: String(Platform.Version),
    appVersion,
    buildNumber,
  };

  if (Platform.OS === "android" && typeof Platform.Version === "number") {
    meta.androidApiLevel = Platform.Version;
  }

  return meta;
}
