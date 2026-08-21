import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { AppAlert } from "@/components/AppAlert";
import { getValidSession } from "@/services/authService";
import {
  MIC_PASS_PRODUCT_ID,
  getIAPUnavailableMessage,
  initializeIAP,
  isIAPAvailable,
  purchaseProduct,
  restoreMicPass,
  setupPurchaseListeners,
} from "@/services/iapService";
import { getApiBase } from "@/utils/apiUrl";
import { rf } from "@/utils/responsive";
import { useSafeLayout } from "@/hooks/useSafeLayout";

// ── MicPassModal ──────────────────────────────────────────────────────────────
// Shown when a user without Mic Pass taps the mic icon.
// NOTE: Mic Pass is purely social — zero effect on steps, rank, prizes,
// race progress, or leaderboard logic.

interface Props {
  visible: boolean;
  onClose: () => void;
  onGranted: () => void;
}

export function MicPassModal({ visible, onClose, onGranted }: Props) {
  const { safeBottom } = useSafeLayout();
  const [loading, setLoading] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [iapReady, setIapReady] = useState(false);
  const cleanupListenersRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!visible) {
      cleanupListenersRef.current?.();
      cleanupListenersRef.current = null;
      setLoading(false);
      setRestoring(false);
      setError(null);
      setIapReady(false);
      return;
    }

    let cancelled = false;
    void (async () => {
      if (!isIAPAvailable()) {
        if (!cancelled) {
          setIapReady(false);
          setError(getIAPUnavailableMessage());
        }
        return;
      }
      try {
        await initializeIAP();
        if (cancelled) return;
        setIapReady(true);
        cleanupListenersRef.current?.();
        cleanupListenersRef.current = setupPurchaseListeners({
          onCoinPurchase: () => {},
          onMicPassGrant: () => {
            setLoading(false);
            setError(null);
            onGranted();
          },
          onPending: (msg) => {
            setLoading(false);
            setError(msg);
          },
          onError: (msg) => {
            setLoading(false);
            // Production API often lacks Apple/Google verify — try debug grant in __DEV__.
            const notConfigured =
              msg.toLowerCase().includes("not configured") ||
              msg.toLowerCase().includes("iap_verification");
            if (__DEV__ && notConfigured) {
              void grantViaDevApi();
              return;
            }
            setError(
              notConfigured
                ? `${msg} Mic Pass is App Store / Play Billing — not Stripe or Razorpay.`
                : msg,
            );
          },
          onCancelled: () => {
            setLoading(false);
          },
        });
      } catch {
        if (!cancelled) {
          setIapReady(false);
          setError(getIAPUnavailableMessage());
        }
      }
    })();

    return () => {
      cancelled = true;
      cleanupListenersRef.current?.();
      cleanupListenersRef.current = null;
    };
  }, [visible, onGranted]);

  /** Debug builds / sideloaded APKs cannot talk to Play Billing — unlock via API. */
  const grantViaDevApi = async () => {
    setLoading(true);
    setError(null);
    try {
      const session = await getValidSession();
      if (!session) throw new Error("Not authenticated");
      const apiBase = getApiBase();
      const res = await fetch(`${apiBase}/api/purchases/verify`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session}`,
        },
        body: JSON.stringify({
          product_id: "mic_pass_lifetime",
          platform: "dev",
          transaction_id: `dev_${Date.now()}`,
          purchase_token: "dev_token",
        }),
      });
      const data = (await res.json()) as {
        success?: boolean;
        message?: string;
        code?: string;
      };
      if (!res.ok || !data.success) {
        const msg =
          typeof data.message === "string"
            ? data.message
            : "Could not unlock Mic Pass on this server.";
        // Debug app → production API: ENABLE_DEV_IAP_PURCHASES is off by design.
        if (
          data.code === "DEV_PURCHASES_DISABLED" ||
          msg.toLowerCase().includes("development purchases are disabled")
        ) {
          throw new Error(
            `${msg} This debug build uses ${apiBase} (production). Dev Mic Pass unlocks need a staging API with ENABLE_DEV_IAP_PURCHASES=true, or a Play Store / Test Track build.`,
          );
        }
        throw new Error(msg);
      }
      onGranted();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Could not unlock Mic Pass.");
    } finally {
      setLoading(false);
    }
  };

  const handleBuy = async () => {
    if (loading || restoring) return;
    setLoading(true);
    setError(null);
    try {
      if (!isIAPAvailable() || !iapReady) {
        // Sideloaded debug APKs cannot start Google Play purchases.
        if (__DEV__) {
          await grantViaDevApi();
          return;
        }
        setError(
          "Mic Pass uses Apple / Google in-app purchase (not Stripe or Razorpay). " +
            getIAPUnavailableMessage(),
        );
        setLoading(false);
        return;
      }
      await purchaseProduct(MIC_PASS_PRODUCT_ID);
      // Grant / errors arrive via setupPurchaseListeners.
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "";
      if (msg.toLowerCase().includes("cancel")) {
        setLoading(false);
        return;
      }
      // Common on expo run:android / sideload — Play Billing unavailable.
      if (__DEV__) {
        await grantViaDevApi();
        return;
      }
      setError(
        "Mic Pass uses Apple / Google in-app purchase (not Stripe or Razorpay). " +
          getIAPUnavailableMessage(),
      );
      setLoading(false);
    }
  };

  const handleRestorePurchases = async () => {
    if (loading || restoring) return;
    setRestoring(true);
    setError(null);
    if (!isIAPAvailable() || !iapReady) {
      setRestoring(false);
      if (__DEV__) {
        await grantViaDevApi();
        return;
      }
      setError(getIAPUnavailableMessage());
      return;
    }
    await restoreMicPass({
      onSuccess: () => {
        setRestoring(false);
        onGranted();
        AppAlert.alert("Restored", "Mic Pass has been restored to your account.");
      },
      onNothingToRestore: () => {
        setRestoring(false);
        AppAlert.alert(
          "Nothing to Restore",
          "No Mic Pass purchase was found for this account.",
        );
      },
      onError: (msg) => {
        setRestoring(false);
        setError(msg);
      },
    });
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={st.overlay} onPress={onClose}>
        <Pressable
          style={[st.sheet, { paddingBottom: Math.max(safeBottom, 24) + 12 }]}
          onPress={(e) => e.stopPropagation()}
        >
          <ScrollView
            bounces={false}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            contentContainerStyle={st.scrollContent}
          >
          <LinearGradient colors={["#1A0533", "#0D0D1A"]} style={st.header}>
            <View style={st.micIconWrap}>
              <LinearGradient colors={["#7C3AED", "#A855F7"]} style={st.micIconBg}>
                <Feather name="mic" size={28} color="#fff" />
              </LinearGradient>
            </View>
            <Text style={st.title}>Unlock Mic Pass</Text>
            <Text style={st.subtitle}>Talk with racers and spectators during live races.</Text>
          </LinearGradient>

          <View style={st.body}>
            <Text style={st.note}>
              Mic Pass is a one-time unlock. It does not affect race results,
              rewards, rankings, or step tracking.
            </Text>

            <View style={st.pricingWrap}>
              <View style={st.promoBadge}>
                <Text style={st.promoBadgeText}>50% OFF</Text>
              </View>
              <View style={st.priceRow}>
                <Text style={st.originalPrice}>$4.99</Text>
                <Text style={st.salePrice}>$1.99</Text>
              </View>
              <Text style={st.promoLabel}>Early User Offer · Limited Launch Price</Text>
            </View>

            <View style={st.benefitsList}>
              {[
                "Voice chat during races",
                "Works in all future races",
                "One-time purchase",
                "Text chat still free for everyone",
              ].map((b) => (
                <View key={b} style={st.benefitRow}>
                  <Feather name="check-circle" size={15} color="#A855F7" style={st.benefitIcon} />
                  <Text style={st.benefitText}>{b}</Text>
                </View>
              ))}
            </View>

            {error != null && (
              <Text style={st.errorText}>{error}</Text>
            )}

            <TouchableOpacity
              style={st.purchaseBtn}
              onPress={() => { void handleBuy(); }}
              disabled={loading || restoring}
              activeOpacity={0.85}
            >
              <LinearGradient
                colors={["#7C3AED", "#A855F7"]}
                start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
                style={st.purchaseBtnGrad}
              >
                {loading
                  ? <ActivityIndicator color="#fff" />
                  : <Text style={st.purchaseBtnText}>Unlock Mic Pass — $1.99</Text>}
              </LinearGradient>
            </TouchableOpacity>

            <TouchableOpacity style={st.laterBtn} onPress={onClose} activeOpacity={0.7}>
              <Text style={st.laterText}>Maybe Later</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={st.restoreBtn}
              onPress={() => { void handleRestorePurchases(); }}
              disabled={loading || restoring}
              activeOpacity={0.7}
              hitSlop={{ top: 16, bottom: 16, left: 24, right: 24 }}
            >
              {restoring
                ? <ActivityIndicator color="#7C3AED" />
                : <Text style={st.restoreText}>Restore Purchase</Text>}
            </TouchableOpacity>
          </View>
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const st = StyleSheet.create({
  overlay:         { flex: 1, backgroundColor: "rgba(0,0,0,0.75)", justifyContent: "flex-end" },
  sheet:           { backgroundColor: "#0D0D1A", borderTopLeftRadius: 24, borderTopRightRadius: 24, overflow: "hidden", maxHeight: "92%" },
  scrollContent:   { paddingBottom: 8 },
  header:          { alignItems: "center", paddingTop: 28, paddingBottom: 24, paddingHorizontal: 24 },
  micIconWrap:     { marginBottom: 14 },
  micIconBg:       { width: 64, height: 64, borderRadius: 32, alignItems: "center", justifyContent: "center" },
  title:           { fontSize: rf(22), fontWeight: "800", color: "#FFFFFF", marginBottom: 6 },
  subtitle:        { fontSize: rf(14), color: "#C4B5FD", textAlign: "center", lineHeight: 20 },
  body:            { paddingHorizontal: 24, paddingBottom: 16, paddingTop: 16 },
  note:            { fontSize: rf(13), color: "#9CA3AF", lineHeight: 19, marginBottom: 16, textAlign: "center" },
  pricingWrap:     { backgroundColor: "#1A0533", borderRadius: 14, borderWidth: 1, borderColor: "#7C3AED50", padding: 14, alignItems: "center", marginBottom: 18, gap: 6 },
  promoBadge:      { backgroundColor: "#7C3AED", borderRadius: 20, paddingHorizontal: 12, paddingVertical: 4 },
  promoBadgeText:  { color: "#fff", fontSize: rf(12), fontWeight: "900", letterSpacing: 0.5 },
  priceRow:        { flexDirection: "row", alignItems: "center", gap: 12 },
  originalPrice:   { fontSize: rf(18), color: "#6B7280", textDecorationLine: "line-through", fontWeight: "600" },
  salePrice:       { fontSize: rf(30), color: "#A855F7", fontWeight: "900" },
  promoLabel:      { fontSize: rf(11), color: "#7C3AED", fontWeight: "700", letterSpacing: 0.3 },
  benefitsList:    { marginBottom: 16 },
  benefitRow:      { flexDirection: "row", alignItems: "center", marginBottom: 10 },
  benefitIcon:     { marginRight: 10 },
  benefitText:     { fontSize: rf(14), color: "#E5E7EB", flex: 1 },
  errorText:       { fontSize: rf(13), color: "#F87171", textAlign: "center", marginBottom: 12 },
  purchaseBtn:     { marginBottom: 10 },
  purchaseBtnGrad: { flexDirection: "row", alignItems: "center", justifyContent: "center", paddingVertical: 14, borderRadius: 14 },
  purchaseBtnText: { color: "#FFFFFF", fontSize: rf(15), fontWeight: "800", textAlign: "center" },
  laterBtn:        { alignItems: "center", paddingVertical: 12 },
  laterText:       { color: "#6B7280", fontSize: rf(14) },
  restoreBtn:      { alignItems: "center", justifyContent: "center", paddingVertical: 12, minHeight: 44 },
  restoreText:     { color: "#7C3AED", fontSize: rf(12), textDecorationLine: "underline" },
});
