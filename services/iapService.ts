/**
 * iapService.ts — react-native-iap v12 wrapper for Walk Champ Global.
 *
 * Responsibilities:
 *  - initialize / cleanup IAP connection
 *  - load coin packs + Mic Pass products from the store
 *  - request purchases (coins consumable, mic_pass non-consumable)
 *  - listen for purchase updates and route to backend verify
 *  - finish/consume transactions only after backend succeeds
 *  - save failed verifications to an AsyncStorage pending queue
 *  - retry pending queue on app start
 *  - restore non-consumable Mic Pass
 *
 * IAP does NOT work in Expo Go — requires EAS development/production build.
 */

import {
  initConnection,
  endConnection,
  getProducts,
  requestPurchase,
  getAvailablePurchases,
  purchaseUpdatedListener,
  purchaseErrorListener,
  finishTransaction,
  type Product,
  type ProductPurchase,
  type PurchaseError,
} from "react-native-iap";
import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { getValidSession } from "@/services/authService";
import { getApiBase } from "@/utils/apiUrl";

// ── Product catalogue ────────────────────────────────────────────────────────
// DO NOT rename these product IDs — they must match App Store Connect / Google Play Console exactly.

export const COIN_IAP_PRODUCTS: Array<{ productId: string; coins: number; name: string }> = [
  { productId: "coins_100",  coins: 100,  name: "100 Coins" },
  { productId: "coins_500",  coins: 500,  name: "500 Coins" },
  { productId: "coins_1200", coins: 1200, name: "1,200 Coins" },
  { productId: "coins_2500", coins: 2500, name: "2,500 Coins" },
  { productId: "coins_5000", coins: 5000, name: "5,000 Coins" },
];

export const MIC_PASS_PRODUCT_ID = "mic_pass_lifetime";

const ALL_PRODUCT_IDS = [
  ...COIN_IAP_PRODUCTS.map((p) => p.productId),
  MIC_PASS_PRODUCT_ID,
];

// ── Pending purchase queue ───────────────────────────────────────────────────
// When backend verification fails (network/server error), the purchase is
// stored locally and retried on the next app open or manual refresh.

const PENDING_KEY = "@walkchamp_pending_iap_v1";

interface PendingPurchase {
  platform: string;
  productId: string;
  transactionId: string;
  purchaseToken?: string;
  transactionReceipt?: string;
  savedAt: number;
}

async function loadPending(): Promise<PendingPurchase[]> {
  try {
    const raw = await AsyncStorage.getItem(PENDING_KEY);
    return raw ? (JSON.parse(raw) as PendingPurchase[]) : [];
  } catch {
    return [];
  }
}

async function savePending(purchase: PendingPurchase): Promise<void> {
  try {
    const list = await loadPending();
    if (!list.some((p) => p.transactionId === purchase.transactionId)) {
      list.push(purchase);
      await AsyncStorage.setItem(PENDING_KEY, JSON.stringify(list));
    }
  } catch {}
}

async function removePending(transactionId: string): Promise<void> {
  try {
    const list = await loadPending();
    const filtered = list.filter((p) => p.transactionId !== transactionId);
    await AsyncStorage.setItem(PENDING_KEY, JSON.stringify(filtered));
  } catch {}
}

// ── Backend verify ───────────────────────────────────────────────────────────

export interface IAPVerifyResult {
  success: boolean;
  duplicate?: boolean;
  coin_balance?: number;
  has_mic_pass?: boolean;
  entitlements?: { mic_pass?: boolean };
  message?: string;
  code?: string;
}

async function verifyWithBackend(purchase: ProductPurchase): Promise<IAPVerifyResult> {
  const session = await getValidSession();
  if (!session) throw new Error("Not authenticated");

  const transactionId =
    purchase.transactionId ??
    purchase.purchaseToken ??
    String(purchase.transactionDate);

  const payload: Record<string, string> = {
    platform: Platform.OS === "ios" ? "ios" : "android",
    product_id: purchase.productId,
    transaction_id: transactionId,
  };

  if (Platform.OS === "ios" && purchase.transactionReceipt) {
    payload.receipt = purchase.transactionReceipt;
  }
  if (Platform.OS === "android") {
    if (purchase.purchaseToken) payload.purchase_token = purchase.purchaseToken;
    payload.package_name = "com.globalwalkerleague.app";
  }

  const res = await fetch(`${getApiBase()}/api/purchases/verify`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session}`,
    },
    body: JSON.stringify(payload),
  });

  const data = (await res.json()) as IAPVerifyResult;
  return data;
}

// ── Exported types ───────────────────────────────────────────────────────────

export type CoinProduct = Product & { coins: number };

// ── Service functions ────────────────────────────────────────────────────────

/** Connect to the platform store. Must be called before any other IAP call. */
export async function initializeIAP(): Promise<void> {
  await initConnection();
}

/** Disconnect from the platform store. Call on screen unmount. */
export async function cleanupIAP(): Promise<void> {
  try {
    await endConnection();
  } catch {}
}

/**
 * Fetch products from App Store / Google Play.
 * Returns sorted coin products and Mic Pass product.
 * Throws if the store is unreachable.
 */
export async function loadIAPProducts(): Promise<{
  coinProducts: CoinProduct[];
  premiumProduct: Product | null;
}> {
  const products = await getProducts({ skus: ALL_PRODUCT_IDS });

  const coinMap = new Map(COIN_IAP_PRODUCTS.map((p) => [p.productId, p.coins]));

  const coinProducts: CoinProduct[] = products
    .filter((p) => coinMap.has(p.productId))
    .map((p) => ({ ...p, coins: coinMap.get(p.productId) ?? 0 }))
    .sort((a, b) => a.coins - b.coins);

  const premiumProduct = products.find((p) => p.productId === MIC_PASS_PRODUCT_ID) ?? null;

  return { coinProducts, premiumProduct };
}

/**
 * Trigger a native purchase for the given product ID.
 * Actual credit happens in the purchaseUpdatedListener callback.
 * Cancellation is silently swallowed — only real errors call onError.
 */
export async function purchaseProduct(productId: string): Promise<void> {
  await requestPurchase({ sku: productId });
}

/**
 * Attach purchase listeners. Returns a cleanup function that removes them.
 *
 * onCoinPurchase  — called after backend credits coins; provides new balance
 * onMicPassGrant  — called after backend activates mic_pass entitlement
 * onPending       — called when backend is unreachable; purchase saved to queue
 * onError         — called on purchase/verification hard failure
 */
export function setupPurchaseListeners(callbacks: {
  onCoinPurchase: (productId: string, coins: number, newBalance: number) => void;
  onMicPassGrant: () => void;
  onPending: (msg: string) => void;
  onError: (msg: string) => void;
}): () => void {
  const { onCoinPurchase, onMicPassGrant, onPending, onError } = callbacks;

  const isConsumableId = (productId: string) =>
    COIN_IAP_PRODUCTS.some((p) => p.productId === productId);

  // purchaseUpdatedListener / purchaseErrorListener throw E_IAP_NOT_AVAILABLE
  // when called before initConnection() or inside Expo Go.
  // Wrap both in try/catch so the caller never gets an unhandled crash.
  let updateSub: { remove: () => void } | null = null;
  let errorSub: { remove: () => void } | null = null;

  try {
    updateSub = purchaseUpdatedListener(async (purchase: ProductPurchase) => {
      const isConsumable = isConsumableId(purchase.productId);
      const transactionId =
        purchase.transactionId ??
        purchase.purchaseToken ??
        String(purchase.transactionDate);

      try {
        const result = await verifyWithBackend(purchase);

        if (result.success || result.duplicate) {
          // Finish / consume only after backend confirms
          try { await finishTransaction({ purchase, isConsumable }); } catch {}
          await removePending(transactionId);

          if (!result.duplicate) {
            if (isConsumable) {
              const coins =
                COIN_IAP_PRODUCTS.find((p) => p.productId === purchase.productId)?.coins ?? 0;
              onCoinPurchase(purchase.productId, coins, result.coin_balance ?? 0);
            } else {
              onMicPassGrant();
            }
          }
        } else {
          await savePending({
            platform: Platform.OS,
            productId: purchase.productId,
            transactionId,
            purchaseToken: purchase.purchaseToken,
            transactionReceipt: purchase.transactionReceipt,
            savedAt: Date.now(),
          });
          onPending("Purchase received. Verification is pending. Please try again shortly.");
        }
      } catch {
        // Network / server error — queue for retry
        await savePending({
          platform: Platform.OS,
          productId: purchase.productId,
          transactionId,
          purchaseToken: purchase.purchaseToken,
          transactionReceipt: purchase.transactionReceipt,
          savedAt: Date.now(),
        });
        onPending("Purchase received. Verification is pending. Please try again shortly.");
      }
    });
  } catch {}

  try {
    errorSub = purchaseErrorListener((error: PurchaseError) => {
      // E_USER_CANCELLED is expected — do not surface to the user
      if (error.code !== "E_USER_CANCELLED") {
        onError("Purchase failed. Please try again.");
      }
    });
  } catch {}

  return () => {
    try { updateSub?.remove(); } catch {}
    try { errorSub?.remove(); } catch {}
  };
}

/**
 * Retry any pending verifications.
 * Call on app start or when the user manually refreshes the shop.
 */
export async function retryPendingPurchases(callbacks: {
  onCoinPurchase: (productId: string, coins: number, newBalance: number) => void;
  onMicPassGrant: () => void;
}): Promise<void> {
  const pending = await loadPending();
  if (pending.length === 0) return;

  for (const p of pending) {
    try {
      const session = await getValidSession();
      if (!session) break;

      const payload: Record<string, string> = {
        platform: p.platform,
        product_id: p.productId,
        transaction_id: p.transactionId,
      };
      if (p.purchaseToken) payload.purchase_token = p.purchaseToken;
      if (p.transactionReceipt) payload.receipt = p.transactionReceipt;
      if (p.platform === "android") payload.package_name = "com.globalwalkerleague.app";

      const res = await fetch(`${getApiBase()}/api/purchases/verify`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session}`,
        },
        body: JSON.stringify(payload),
      });
      const result = (await res.json()) as IAPVerifyResult;

      if (result.success || result.duplicate) {
        await removePending(p.transactionId);
        if (!result.duplicate) {
          const isConsumable = COIN_IAP_PRODUCTS.some((x) => x.productId === p.productId);
          if (isConsumable) {
            const coins =
              COIN_IAP_PRODUCTS.find((x) => x.productId === p.productId)?.coins ?? 0;
            callbacks.onCoinPurchase(p.productId, coins, result.coin_balance ?? 0);
          } else {
            callbacks.onMicPassGrant();
          }
        }
      }
    } catch {}
  }
}

/**
 * Restore non-consumable Mic Pass from the platform store.
 * Consumable coin packs are NOT restored (coin balance comes from backend).
 */
export async function restoreMicPass(callbacks: {
  onSuccess: () => void;
  onNothingToRestore: () => void;
  onError: (msg: string) => void;
}): Promise<void> {
  try {
    const purchases = await getAvailablePurchases();
    const micPassPurchase = purchases.find(
      (p) => p.productId === MIC_PASS_PRODUCT_ID,
    );

    if (!micPassPurchase) {
      callbacks.onNothingToRestore();
      return;
    }

    const result = await verifyWithBackend(micPassPurchase);
    if (result.success || result.duplicate) {
      try {
        await finishTransaction({ purchase: micPassPurchase, isConsumable: false });
      } catch {}
      callbacks.onSuccess();
    } else {
      callbacks.onError("Could not restore Mic Pass. Please try again.");
    }
  } catch {
    callbacks.onError("Could not restore purchases. Please try again.");
  }
}
