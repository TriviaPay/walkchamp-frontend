import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import React, { useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  View} from "react-native";
import { useSafeLayout } from "@/hooks/useSafeLayout";
import { rf, rs } from "@/utils/responsive";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useColors } from "@/hooks/useColors";
import { sendPasswordResetEmail } from "@/services/authService";
import { TouchableOpacity } from '@/components/HapticTouchableOpacity';

// Common domain suggestions shown when the user types "@"
const DOMAIN_SUGGESTIONS = ["gmail.com", "yahoo.com", "outlook.com", "icloud.com"];

function getEmailSuggestions(value: string): string[] {
  const atIdx = value.indexOf("@");
  if (atIdx === -1) return [];
  const user = value.slice(0, atIdx);
  const afterAt = value.slice(atIdx + 1);
  if (!user) return [];
  // Only show suggestions when there is no complete domain yet
  if (afterAt.includes(".") && afterAt.split(".").pop()!.length >= 2) return [];
  return DOMAIN_SUGGESTIONS.filter((d) =>
    afterAt === "" || d.toLowerCase().startsWith(afterAt.toLowerCase()),
  ).map((d) => `${user}@${d}`);
}

export default function ForgotPasswordScreen() {
  const colors = useColors();
  const { insets, safeTop, safeBottom } = useSafeLayout();
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  const suggestions = getEmailSuggestions(email);

  async function handleSend() {
    setError("");
    const e = email.trim().toLowerCase();
    if (!e || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) {
      setError("Please enter a valid email address.");
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setLoading(true);
    try {
      await sendPasswordResetEmail(e);
    } catch {
      // Always show success — never reveal whether the email exists
    } finally {
      setLoading(false);
      setSent(true);
    }
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <LinearGradient colors={["#00B4FF10", "transparent"]} style={styles.glow} start={{ x: 0.5, y: 0 }} end={{ x: 0.5, y: 1 }} />
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={styles.flex}>
        <View style={[styles.inner, { paddingTop: safeTop + 24, paddingBottom: safeBottom + 30 }]}>
          <TouchableOpacity style={styles.back} onPress={() => router.back()}>
            <Feather name="arrow-left" size={22} color={colors.foreground} />
          </TouchableOpacity>

          <View style={[styles.iconWrap, { backgroundColor: colors.accent + "20", borderColor: colors.accent + "50" }]}>
            <Feather name="key" size={32} color={colors.accent} />
          </View>

          <Text style={[styles.title, { color: colors.foreground }]}>Reset password</Text>

          {!sent ? (
            <>
              <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
                Enter your email address and we'll send you a reset link.
              </Text>

              {!!error && (
                <View style={[styles.errorBox, { backgroundColor: "#FF444420", borderColor: "#FF444450" }]}>
                  <Feather name="alert-circle" size={14} color="#FF4444" />
                  <Text style={styles.errorText}>{error}</Text>
                </View>
              )}

              <View style={styles.inputWrap}>
                <View style={[styles.inputContainer, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  <Feather name="mail" size={18} color={colors.mutedForeground} />
                  <TextInput
                    style={[styles.input, { color: colors.foreground }]}
                    placeholder="Email address"
                    placeholderTextColor={colors.mutedForeground}
                    value={email}
                    onChangeText={(t) => { setEmail(t); setError(""); }}
                    keyboardType="email-address"
                    autoCapitalize="none"
                    autoCorrect={false}
                    textContentType="emailAddress"
                  />
                  {email.length > 0 && (
                    <TouchableOpacity onPress={() => setEmail("")} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                      <Feather name="x" size={16} color={colors.mutedForeground} />
                    </TouchableOpacity>
                  )}
                </View>

                {/* Domain autocomplete suggestions */}
                {suggestions.length > 0 && (
                  <View style={[styles.suggestions, { backgroundColor: colors.card, borderColor: colors.border }]}>
                    {suggestions.map((s) => (
                      <TouchableOpacity
                        key={s}
                        style={[styles.suggestionRow, { borderBottomColor: colors.border }]}
                        onPress={() => setEmail(s)}
                      >
                        <Feather name="mail" size={13} color={colors.accent} />
                        <Text style={[styles.suggestionText, { color: colors.foreground }]}>{s}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                )}
              </View>

              <TouchableOpacity
                style={[styles.sendBtn, { opacity: loading ? 0.7 : 1 }]}
                onPress={handleSend}
                disabled={loading}
              >
                <LinearGradient colors={[colors.accent, colors.primary]} style={styles.sendGradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}>
                  <Text style={[styles.sendText, { color: "#000000" }]}>
                    {loading ? "Sending…" : "Send Reset Link"}
                  </Text>
                </LinearGradient>
              </TouchableOpacity>

              <TouchableOpacity style={styles.backLink} onPress={() => router.back()}>
                <Feather name="arrow-left" size={14} color={colors.mutedForeground} />
                <Text style={[styles.backLinkText, { color: colors.mutedForeground }]}>Back to Sign In</Text>
              </TouchableOpacity>
            </>
          ) : (
            <>
              <View style={[styles.successCard, { backgroundColor: "#00E67618", borderColor: "#00E67640" }]}>
                <Feather name="check-circle" size={22} color="#00E676" />
                <Text style={[styles.successText, { color: colors.foreground }]}>
                  If an account exists for {email}, a reset link has been sent.
                </Text>
              </View>
              <Text style={[styles.successHint, { color: colors.mutedForeground }]}>
                Check your inbox and spam folder. The link expires in 1 hour.
              </Text>
              <TouchableOpacity style={styles.backLink} onPress={() => router.replace("/(auth)")}>
                <Feather name="arrow-left" size={14} color={colors.primary} />
                <Text style={[styles.backLinkText, { color: colors.primary }]}>Back to Sign In</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  flex: { flex: 1 },
  glow: { position: "absolute", top: 0, left: 0, right: 0, height: 300 },
  inner: { flex: 1, paddingHorizontal: rs(24), alignItems: "center" },
  back: { alignSelf: "flex-start", marginBottom: rs(32) },
  iconWrap: { width: rs(80), height: rs(80), borderRadius: rs(24), borderWidth: 1, alignItems: "center", justifyContent: "center", marginBottom: rs(20) },
  title: { fontSize: rf(26), fontWeight: "800", letterSpacing: -0.5, textAlign: "center", marginBottom: 12 },
  subtitle: { fontSize: rf(15), textAlign: "center", marginBottom: rs(28), lineHeight: 22 },
  errorBox: { flexDirection: "row", alignItems: "center", gap: 8, borderRadius: 10, borderWidth: 1, paddingHorizontal: rs(12), paddingVertical: rs(10), width: "100%", marginBottom: 12 },
  errorText: { color: "#FF4444", fontSize: rf(13), flex: 1 },
  inputWrap: { width: "100%", marginBottom: rs(16), position: "relative" },
  inputContainer: { flexDirection: "row", alignItems: "center", gap: 12, borderRadius: 14, borderWidth: 1, paddingHorizontal: rs(16), paddingVertical: rs(14) },
  input: { flex: 1, fontSize: rf(16) },
  suggestions: { borderRadius: 12, borderWidth: 1, marginTop: 4, overflow: "hidden" },
  suggestionRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: rs(16), paddingVertical: rs(12), borderBottomWidth: 1 },
  suggestionText: { fontSize: rf(14) },
  sendBtn: { borderRadius: 14, overflow: "hidden", width: "100%" },
  sendGradient: { paddingVertical: rs(16), alignItems: "center" },
  sendText: { fontSize: rf(17), fontWeight: "700" },
  backLink: { flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: rs(16) },
  backLinkText: { fontSize: rf(15) },
  successCard: { flexDirection: "row", alignItems: "flex-start", gap: 12, borderRadius: 14, borderWidth: 1, padding: rs(16), width: "100%", marginBottom: rs(16) },
  successText: { fontSize: rf(15), lineHeight: 22, flex: 1 },
  successHint: { fontSize: rf(13), textAlign: "center", lineHeight: 20, marginBottom: rs(16) },
});
