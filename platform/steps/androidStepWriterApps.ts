/**
 * Android step-writing apps that feed Health Connect.
 * WalkChamp only reads HC — these apps must write Steps into it.
 */

import { Linking, Platform } from "react-native";
import { requireOptionalExpoNativeModule } from "@/utils/expoNativeModule";

export type AndroidStepWriterKind = "samsung_health" | "google_fit";

export type AndroidStepWriterApp = {
  kind: AndroidStepWriterKind;
  label: string;
  packageId: string;
  /** Deep-link scheme for install probe / open. */
  scheme: string;
  /** Extra schemes OEMs may register. */
  altSchemes: string[];
  playStoreMarket: string;
  playStoreWeb: string;
  syncHint: string;
};

const SAMSUNG_HEALTH: AndroidStepWriterApp = {
  kind: "samsung_health",
  label: "Samsung Health",
  packageId: "com.sec.android.app.shealth",
  scheme: "shealth://",
  altSchemes: [
    "samsunghealth://",
    "shealth://home",
    "com.sec.android.app.shealth://",
  ],
  playStoreMarket: "market://details?id=com.sec.android.app.shealth",
  playStoreWeb:
    "https://play.google.com/store/apps/details?id=com.sec.android.app.shealth",
  syncHint:
    "Samsung Health can show steps in its own app while Health Connect stays empty. In Samsung Health: Settings → Health Connect (or Connected services) → turn on sync and allow Write Steps. Then WalkChamp can read them.",
};

const GOOGLE_FIT: AndroidStepWriterApp = {
  kind: "google_fit",
  label: "Google Fit",
  packageId: "com.google.android.apps.fitness",
  scheme: "com.google.android.apps.fitness://",
  altSchemes: ["googlefit://", "fit://"],
  playStoreMarket: "market://details?id=com.google.android.apps.fitness",
  playStoreWeb:
    "https://play.google.com/store/apps/details?id=com.google.android.apps.fitness",
  syncHint:
    "In Google Fit: Profile → Settings → Health Connect → allow Write Steps. WalkChamp only sees what Fit writes into Health Connect.",
};

type PackageProbeNative = {
  isPackageInstalled?: (packageName: string) => Promise<boolean>;
};

function getPackageProbeNative(): PackageProbeNative | null {
  try {
    return requireOptionalExpoNativeModule<PackageProbeNative>("WalkChampRaceProgress");
  } catch {
    return null;
  }
}

function androidBrandHints(): string {
  const constants = Platform.constants as {
    Brand?: string;
    Manufacturer?: string;
    Model?: string;
  };
  return `${constants?.Brand ?? ""} ${constants?.Manufacturer ?? ""} ${constants?.Model ?? ""}`;
}

/** True on Samsung OEM builds where Samsung Health is usually preinstalled. */
export function isSamsungDevice(): boolean {
  if (Platform.OS !== "android") return false;
  return /samsung/i.test(androidBrandHints());
}

function launchIntentForPackage(packageId: string): string {
  return `intent:#Intent;action=android.intent.action.MAIN;category=android.intent.category.LAUNCHER;package=${packageId};end`;
}

/** Prefer Samsung Health on Samsung devices; Google Fit elsewhere. */
export function resolvePreferredStepWriter(): AndroidStepWriterApp {
  if (Platform.OS !== "android") return GOOGLE_FIT;
  if (isSamsungDevice()) return SAMSUNG_HEALTH;
  return GOOGLE_FIT;
}

/**
 * Prefer already-installed Samsung Health when present (even on non-Samsung),
 * otherwise brand-based default (Samsung → Samsung Health, else Google Fit).
 */
export async function resolvePreferredStepWriterAsync(): Promise<AndroidStepWriterApp> {
  if (Platform.OS !== "android") return GOOGLE_FIT;
  const samsungInstalled = await isStepWriterInstalled(SAMSUNG_HEALTH);
  if (samsungInstalled) return SAMSUNG_HEALTH;
  return resolvePreferredStepWriter();
}

async function canOpenAny(urls: string[]): Promise<boolean> {
  for (const url of urls) {
    try {
      if (await Linking.canOpenURL(url)) return true;
    } catch {
      /* try next */
    }
  }
  return false;
}

async function nativePackageInstalled(packageId: string): Promise<boolean | null> {
  const native = getPackageProbeNative();
  if (!native?.isPackageInstalled) return null;
  try {
    return !!(await native.isPackageInstalled(packageId));
  } catch {
    return null;
  }
}

/**
 * Install detection. Prefers native PackageManager (needs manifest `<queries>`).
 * Never assume Samsung Health is installed just because the device is Samsung —
 * many devices remove it or never have it.
 */
export async function isStepWriterInstalled(
  writer: AndroidStepWriterApp = resolvePreferredStepWriter(),
): Promise<boolean> {
  if (Platform.OS !== "android") return false;

  const native = await nativePackageInstalled(writer.packageId);
  if (native === true) return true;
  if (native === false) return false;

  // Native probe unavailable — fall back to deep-link / launch intent only.
  const candidates = [
    writer.scheme,
    ...writer.altSchemes,
    launchIntentForPackage(writer.packageId),
  ];
  return canOpenAny(candidates);
}

/**
 * Skip Play Store only when the writer package is actually detected as installed.
 */
export async function shouldSkipWriterInstall(
  writer?: AndroidStepWriterApp,
): Promise<boolean> {
  const preferred = writer ?? (await resolvePreferredStepWriterAsync());
  return (await isStepWriterInstalled(preferred)) === true;
}

/** Open Play Store (or web fallback) to install the preferred writer app. */
export async function openStepWriterInstallPage(
  writer: AndroidStepWriterApp = resolvePreferredStepWriter(),
): Promise<void> {
  if (Platform.OS !== "android") return;
  try {
    const canMarket = await Linking.canOpenURL(writer.playStoreMarket).catch(
      () => false,
    );
    await Linking.openURL(canMarket ? writer.playStoreMarket : writer.playStoreWeb);
  } catch {
    try {
      await Linking.openURL(writer.playStoreWeb);
    } catch {
      /* ignore */
    }
  }
}

/** Try opening the writer app if installed. */
export async function openStepWriterApp(
  writer: AndroidStepWriterApp = resolvePreferredStepWriter(),
): Promise<boolean> {
  if (Platform.OS !== "android") return false;
  const candidates = [
    writer.scheme,
    ...writer.altSchemes,
    launchIntentForPackage(writer.packageId),
  ];
  for (const url of candidates) {
    try {
      await Linking.openURL(url);
      return true;
    } catch {
      /* try next */
    }
  }
  return false;
}
