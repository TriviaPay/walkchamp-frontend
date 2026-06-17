import React, { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { getValidSession } from "@/services/authService";
import { getApiBase } from "@/utils/apiUrl";

// ── MicPassModal ──────────────────────────────────────────────────────────────
// Shown when a user without Mic Pass taps the mic icon.
// NOTE: Mic Pass is purely social — zero effect on steps, rank, prizes,
// race progress, or leaderboard logic.

interface Props {
  visible: boolean;
  onClose: () => void;
  onGranted: () => void;
}

// Safe JSON parse — checks content-type before calling .json()
// Returns { ok: true, data } or { ok: false, error: string }
async function safeParseJson(res: Response): Promise<{ ok: true; data: Record<string, unknown> } | { ok: false; error: string }> {
  const contentType = res.headers.get("content-type") ?? "";
  if (__DEV__) {
    console.log("[MicPass] response status:", res.status);
    console.log("[MicPass] response content-type:", contentType);
  }
  if (!contentType.includes("application/json")) {
    const preview = (await res.text()).slice(0, 200);
    if (__DEV__) console.log("[MicPass] non-json response body preview:", preview);
    return { ok: false, error: "Could not connect to Mic Pass service. Please try again." };
  }
  const data = await res.json() as Record<string, unknown>;
  return { ok: true, data };
}

export function MicPassModal({ visible, onClose, onGranted }: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);

  const verifyPurchase = async (opts: {
    platform: string;
    transactionId: string;
    purchaseToken?: string;
    receipt?: string;
  }) => {
    setLoading(true);
    setError(null);
    try {
      const session = await getValidSession();
      if (!session) throw new Error("Not authenticated");

      const url = `${getApiBase()}/api/purchases/verify`;
      if (__DEV__) {
        console.log("[MicPass] purchase modal opened");
        console.log("[MicPass] purchase endpoint:", url);
      }

      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session}`,
        },
        body: JSON.stringify({ product_id: "mic_pass_lifetime", ...opts }),
      });

      const parsed = await safeParseJson(res);
      if (!parsed.ok) throw new Error(parsed.error);

      const data = parsed.data;
      if (!res.ok || !data.success) {
        throw new Error(typeof data.message === "string" ? data.message : "Purchase verification failed. Please try restore purchase.");
      }

      if (__DEV__) console.log("[MicPass] purchase success");
      onGranted();
    } catch (e: unknown) {
      const rawMsg = e instanceof Error ? e.message : "Could not complete purchase.";
      // Never show raw JSON parse errors to users
      const friendly = rawMsg.toLowerCase().includes("json") || rawMsg.toLowerCase().includes("unexpected")
        ? "Could not connect to Mic Pass service. Please try again."
        : rawMsg;
      if (__DEV__) console.log("[MicPass] purchase failed:", rawMsg);
      setError(friendly);
    } finally {
      setLoading(false);
    }
  };

  const handleDevGrant = () => {
    void verifyPurchase({
      platform: "dev",
      transactionId: `dev_${Date.now()}`,
      purchaseToken: "dev_token",
    });
  };

  const handleRestorePurchases = () => {
    Alert.alert(
      "Restore Purchases",
      "Contact support if you've already purchased Mic Pass and it isn't showing.",
      [{ text: "OK" }],
    );
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={st.overlay} onPress={onClose}>
        <Pressable style={st.sheet} onPress={(e) => e.stopPropagation()}>

          {/* Header */}
          <LinearGradient colors={["#1A0533", "#0D0D1A"]} style={st.header}>
            <View style={st.micIconWrap}>
              <LinearGradient colors={["#7C3AED", "#A855F7"]} style={st.micIconBg}>
                <Feather name="mic" size={28} color="#fff" />
              </LinearGradient>
            </View>
            <Text style={st.title}>Unlock Mic Pass</Text>
            <Text style={st.subtitle}>Talk with racers and spectators during live races.</Text>
          </LinearGradient>

          {/* Body */}
          <View style={st.body}>
            <Text style={st.note}>
              Mic Pass is a one-time unlock. It does not affect race results,
              rewards, rankings, or step tracking.
            </Text>

            {/* Promo pricing */}
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

            {/* Benefits */}
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

            {/* Purchase button */}
            {__DEV__ ? (
              <TouchableOpacity
                style={st.purchaseBtn}
                onPress={handleDevGrant}
                disabled={loading}
                activeOpacity={0.85}
              >
                <LinearGradient
                  colors={["#7C3AED", "#A855F7"]}
                  start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
                  style={st.purchaseBtnGrad}
                >
                  {loading
                    ? <ActivityIndicator color="#fff" />
                    : <Text style={st.purchaseBtnText}>Unlock Mic Pass — $1.99{"\n"}
                        <Text style={st.devLabel}>(Dev Test)</Text>
                      </Text>}
                </LinearGradient>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity style={st.purchaseBtn} activeOpacity={0.85} disabled>
                <LinearGradient
                  colors={["#7C3AED", "#A855F7"]}
                  start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
                  style={st.purchaseBtnGrad}
                >
                  <Text style={st.purchaseBtnText}>Unlock Mic Pass — $1.99</Text>
                </LinearGradient>
              </TouchableOpacity>
            )}

            <TouchableOpacity style={st.laterBtn} onPress={onClose} activeOpacity={0.7}>
              <Text style={st.laterText}>Maybe Later</Text>
            </TouchableOpacity>

            <TouchableOpacity style={st.restoreBtn} onPress={handleRestorePurchases} activeOpacity={0.7}>
              <Text style={st.restoreText}>Restore Purchase</Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const st = StyleSheet.create({
  overlay:         { flex: 1, backgroundColor: "rgba(0,0,0,0.75)", justifyContent: "flex-end" },
  sheet:           { backgroundColor: "#0D0D1A", borderTopLeftRadius: 24, borderTopRightRadius: 24, overflow: "hidden" },
  header:          { alignItems: "center", paddingTop: 28, paddingBottom: 24, paddingHorizontal: 24 },
  micIconWrap:     { marginBottom: 14 },
  micIconBg:       { width: 64, height: 64, borderRadius: 32, alignItems: "center", justifyContent: "center" },
  title:           { fontSize: 22, fontWeight: "800", color: "#FFFFFF", marginBottom: 6 },
  subtitle:        { fontSize: 14, color: "#C4B5FD", textAlign: "center", lineHeight: 20 },
  body:            { paddingHorizontal: 24, paddingBottom: 36, paddingTop: 16 },
  note:            { fontSize: 13, color: "#9CA3AF", lineHeight: 19, marginBottom: 16, textAlign: "center" },

  // Promo pricing
  pricingWrap:     { backgroundColor: "#1A0533", borderRadius: 14, borderWidth: 1, borderColor: "#7C3AED50", padding: 14, alignItems: "center", marginBottom: 18, gap: 6 },
  promoBadge:      { backgroundColor: "#7C3AED", borderRadius: 20, paddingHorizontal: 12, paddingVertical: 4 },
  promoBadgeText:  { color: "#fff", fontSize: 12, fontWeight: "900", letterSpacing: 0.5 },
  priceRow:        { flexDirection: "row", alignItems: "center", gap: 12 },
  originalPrice:   { fontSize: 18, color: "#6B7280", textDecorationLine: "line-through", fontWeight: "600" },
  salePrice:       { fontSize: 30, color: "#A855F7", fontWeight: "900" },
  promoLabel:      { fontSize: 11, color: "#7C3AED", fontWeight: "700", letterSpacing: 0.3 },

  benefitsList:    { marginBottom: 16 },
  benefitRow:      { flexDirection: "row", alignItems: "center", marginBottom: 10 },
  benefitIcon:     { marginRight: 10 },
  benefitText:     { fontSize: 14, color: "#E5E7EB", flex: 1 },
  errorText:       { fontSize: 13, color: "#F87171", textAlign: "center", marginBottom: 12 },
  purchaseBtn:     { marginBottom: 10 },
  purchaseBtnGrad: { flexDirection: "row", alignItems: "center", justifyContent: "center", paddingVertical: 14, borderRadius: 14 },
  purchaseBtnText: { color: "#FFFFFF", fontSize: 15, fontWeight: "800", textAlign: "center" },
  devLabel:        { fontSize: 11, fontWeight: "400", color: "#D8B4FE" },
  laterBtn:        { alignItems: "center", paddingVertical: 12 },
  laterText:       { color: "#6B7280", fontSize: 14 },
  restoreBtn:      { alignItems: "center", paddingVertical: 6 },
  restoreText:     { color: "#7C3AED", fontSize: 12, textDecorationLine: "underline" },
});
