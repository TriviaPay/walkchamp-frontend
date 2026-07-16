import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useEffect } from "react";
import {
  clearPendingDeposit,
  resolveDepositUiFromTransaction,
  savePaymentResult,
} from "@/services/depositSession";

/**
 * Legacy payment return route — immediately forwards to wallet.
 * UI result comes from backend deposit status (not URL query params).
 */
export default function PaymentCompleteScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    status?: string;
    transaction_id?: string;
  }>();

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const transactionId =
        typeof params.transaction_id === "string" ? params.transaction_id : undefined;

      if (transactionId) {
        const ui = await resolveDepositUiFromTransaction(transactionId);
        if (ui) {
          await clearPendingDeposit();
          await savePaymentResult({
            status: ui,
            transactionId,
            resolvedAt: new Date().toISOString(),
          });
        }
      }

      if (!cancelled) {
        router.replace("/(tabs)/wallet");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [params.transaction_id, router]);

  return null;
}
