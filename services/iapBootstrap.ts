/**
 * App-level IAP listener + pending-verify drain (audit A6).
 * Shop/MicPass modals still attach their own UI callbacks; this catches
 * purchases that complete while the app was killed / modals were closed.
 */

import { Platform } from "react-native";
import {
  initializeIAP,
  isIAPAvailable,
  retryPendingPurchases,
  setupPurchaseListeners,
} from "@/services/iapService";

let cleanup: (() => void) | null = null;
let startedForUser: string | null = null;

export async function startIapBootstrap(userId: string): Promise<void> {
  if (Platform.OS === "web" || !userId) return;
  if (startedForUser === userId && cleanup) return;

  stopIapBootstrap();
  startedForUser = userId;

  if (!isIAPAvailable()) return;

  try {
    await initializeIAP();
  } catch {
    startedForUser = null;
    return;
  }

  cleanup = setupPurchaseListeners({
    onCoinPurchase: () => {},
    onMicPassGrant: () => {},
    onPending: () => {},
    onError: () => {},
    onCancelled: () => {},
  });

  void retryPendingPurchases({
    onCoinPurchase: () => {},
    onMicPassGrant: () => {},
  }).catch(() => {});
}

export function stopIapBootstrap(): void {
  try {
    cleanup?.();
  } catch {
    /* ignore */
  }
  cleanup = null;
  startedForUser = null;
}
