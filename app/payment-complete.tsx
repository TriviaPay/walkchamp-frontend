import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useEffect } from "react";
import { ActivityIndicator, View } from "react-native";
import {
  clearPendingDeposit,
  depositStatusToUiResult,
  fetchDepositStatus,
  isTerminalDepositStatus,
  savePaymentResult,
} from "@/services/depositSession";

/**
 * Handles payment return from:
 * - Custom scheme: globalwalkerleague://payment-complete?...
 * - Universal Link: https://walkchamp.app/payment-complete?...
 * - API done page (when backend links App Link): .../api/wallet/deposit/done?...
 *
 * Verifies status with backend, stores result for wallet tab modal, then redirects.
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
      const urlStatus = typeof params.status === "string" ? params.status : undefined;

      let uiStatus: "success" | "failed" | "cancelled" | "verification_failed" | null = null;

      if (transactionId) {
        try {
          const backendStatus = await fetchDepositStatus(transactionId);
          if (!cancelled) {
            uiStatus = depositStatusToUiResult(backendStatus);
            if (!uiStatus && isTerminalDepositStatus(backendStatus)) {
              uiStatus = "failed";
            }
            if (!uiStatus && urlStatus === "processing") {
              uiStatus = "verification_failed";
            }
          }
        } catch {
          // fall through to URL status
        }
      }

      if (!uiStatus && urlStatus) {
        if (urlStatus === "success" || urlStatus === "succeeded") uiStatus = "success";
        else if (urlStatus === "cancelled") uiStatus = "cancelled";
        else if (urlStatus === "processing") uiStatus = "verification_failed";
        else if (urlStatus === "requires_review" || urlStatus === "settlement_error") {
          uiStatus = "verification_failed";
        } else uiStatus = "failed";
      }

      if (uiStatus && transactionId) {
        await clearPendingDeposit();
        await savePaymentResult({
          status: uiStatus,
          transactionId,
          resolvedAt: new Date().toISOString(),
        });
      }

      if (!cancelled) {
        router.replace("/(tabs)/wallet");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [params.status, params.transaction_id, router]);

  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
      <ActivityIndicator size="large" />
    </View>
  );
}
