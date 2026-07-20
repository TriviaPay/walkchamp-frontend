import { LinearGradient } from "expo-linear-gradient";
import { router, useLocalSearchParams } from "expo-router";
import * as Haptics from "expo-haptics";
import * as Linking from "expo-linking";
import { Feather } from "@expo/vector-icons";
import React, { useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View} from "react-native";
import { useSafeLayout } from "@/hooks/useSafeLayout";

import { useColors } from "@/hooks/useColors";
import { completePasswordReset } from "@/services/authService";
import { TouchableOpacity } from '@/components/HapticTouchableOpacity';

// ── Password rules ────────────────────────────────────────────────────────────

const RULES = [
  { label: "8+ characters", test: (p: string) => p.length >= 8 },
  { label: "Lowercase letter", test: (p: string) => /[a-z]/.test(p) },
  { label: "Uppercase letter", test: (p: string) => /[A-Z]/.test(p) },
  { label: "Number", test: (p: string) => /[0-9]/.test(p) },
  { label: "Special character (!@#$…)", test: (p: string) => /[^A-Za-z0-9]/.test(p) },
  { label: "No spaces", test: (p: string) => !/\s/.test(p) },
];

function allRulesPassed(pw: string) {
  return RULES.every((r) => r.test(pw));
}

// ── Screen ────────────────────────────────────────────────────────────────────

type Stage = "form" | "submitting" | "success";

export default function ResetPasswordScreen() {
  const colors = useColors();
  const { insets, safeTop, safeBottom } = useSafeLayout();

  // Descope appends ?t=TOKEN&loginId=EMAIL to the redirectUrl
  // Support all common param names — primary is "t"
  const params = useLocalSearchParams<{
    t?: string;
    token?: string;
    code?: string;
    resetToken?: string;
    loginId?: string;
  }>();

  const resetToken =
    params.t ?? params.token ?? params.code ?? params.resetToken ?? "";
  const loginId = (params.loginId ?? "").trim().toLowerCase();

  const [stage, setStage] = useState<Stage>("form");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [error, setError] = useState(
    // Only pre-fill an error when the token is completely missing from the URL
    resetToken ? "" : "Reset token missing. Please request a new reset link.",
  );

  // Prevent double-submission (e.g. rapid taps)
  const submittingRef = useRef(false);

  async function handleSubmit() {
    if (submittingRef.current) return;
    setError("");

    if (!resetToken) {
      setError("Reset token missing. Please request a new reset link.");
      return;
    }
    if (!allRulesPassed(password)) {
      setError("Password must meet all the requirements below.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }

    submittingRef.current = true;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setStage("submitting");

    try {
      // Single backend call: verifies the magic-link token server-side (using
      // the real DESCOPE_PROJECT_ID, not EXPO_PUBLIC_*) then sets the password
      // via the Descope management API. This avoids the "Request project is
      // invalid or missing" error that occurs when calling Descope directly
      // from the Expo web bundle.
      await completePasswordReset(resetToken, password);
      setStage("success");
    } catch (err: unknown) {
      submittingRef.current = false;
      setStage("form");
      const msg = err instanceof Error ? err.message.toLowerCase() : "";
      if (
        msg.includes("expired") ||
        msg.includes("already used") ||
        msg.includes("invalid") ||
        msg.includes("invalid or expired")
      ) {
        setError("Reset link is invalid or expired. Please request a new one.");
      } else {
        setError(`Unable to reset password — ${err instanceof Error ? err.message : "please try again"}.`);
      }
    }
  }

  // ── Success ───────────────────────────────────────────────────────────────

  if (stage === "success") {
    // On web the reset link opens in the browser, so we deep-link back into
    // the native app. On mobile (shouldn't normally happen) navigate directly.
    const isWeb = Platform.OS === "web";

    function handleSignIn() {
      if (isWeb) {
        // Opens the app at the root; the auth guard redirects to login.
        Linking.openURL("globalwalkerleague://");
      } else {
        router.replace("/(auth)");
      }
    }

    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <LinearGradient colors={["#00E67610", "transparent"]} style={styles.glow} />
        <View
          style={[
            styles.centred,
            { paddingTop: safeTop + 40, paddingBottom: safeBottom + 32 },
          ]}
        >
          <View
            style={[
              styles.iconWrap,
              { backgroundColor: "#00E67620", borderColor: "#00E67650" },
            ]}
          >
            <Feather name="check-circle" size={32} color="#00E676" />
          </View>
          <Text style={[styles.title, { color: colors.foreground }]}>
            Password reset!
          </Text>
          <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
            Your password has been updated. Open the app to sign in with your new password.
          </Text>
          <TouchableOpacity
            style={[styles.primaryBtn, { backgroundColor: colors.accent }]}
            onPress={handleSignIn}
          >
            <Text style={[styles.primaryBtnText, { color: "#000" }]}>
              {isWeb ? "Open App to Sign In" : "Sign In"}
            </Text>
          </TouchableOpacity>
          {isWeb && (
            <Text style={[styles.hint, { color: colors.mutedForeground, marginTop: 16 }]}>
              You can close this browser tab once the app opens.
            </Text>
          )}
        </View>
      </View>
    );
  }

  // ── Form (and submitting) ─────────────────────────────────────────────────

  const isSubmitting = stage === "submitting";

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <LinearGradient
        colors={["#00B4FF10", "transparent"]}
        style={styles.glow}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
      />
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={styles.flex}
      >
        <ScrollView
          contentContainerStyle={[
            styles.inner,
            {
              paddingTop: safeTop + 32,
              paddingBottom: safeBottom + 40,
            },
          ]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          <View
            style={[
              styles.iconWrap,
              {
                backgroundColor: colors.accent + "20",
                borderColor: colors.accent + "50",
              },
            ]}
          >
            <Feather name="lock" size={32} color={colors.accent} />
          </View>

          <Text style={[styles.title, { color: colors.foreground }]}>
            Set new password
          </Text>

          {loginId ? (
            <View
              style={[
                styles.emailBadge,
                {
                  backgroundColor: colors.card,
                  borderColor: colors.border,
                },
              ]}
            >
              <Feather name="user" size={14} color={colors.accent} />
              <Text
                style={[styles.emailBadgeText, { color: colors.foreground }]}
                numberOfLines={1}
              >
                {loginId}
              </Text>
            </View>
          ) : null}

          <Text
            style={[
              styles.subtitle,
              { color: colors.mutedForeground, marginTop: 10 },
            ]}
          >
            Choose a strong password for your account.
          </Text>

          {!!error && (
            <View
              style={[
                styles.errorBox,
                {
                  backgroundColor: "#FF444420",
                  borderColor: "#FF444450",
                },
              ]}
            >
              <Feather name="alert-circle" size={14} color="#FF4444" />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}

          {/* New password */}
          <Text style={[styles.label, { color: colors.mutedForeground }]}>
            New password
          </Text>
          <View
            style={[
              styles.inputRow,
              {
                backgroundColor: colors.card,
                borderColor: colors.border,
              },
            ]}
          >
            <Feather name="lock" size={18} color={colors.mutedForeground} />
            <TextInput
              style={[styles.input, { color: colors.foreground }]}
              placeholder="New password"
              placeholderTextColor={colors.mutedForeground}
              value={password}
              onChangeText={(t) => {
                setPassword(t);
                setError("");
              }}
              secureTextEntry={!showPw}
              autoCapitalize="none"
              autoCorrect={false}
              textContentType="newPassword"
              editable={!isSubmitting}
            />
            <TouchableOpacity
              onPress={() => setShowPw((v) => !v)}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Feather
                name={showPw ? "eye-off" : "eye"}
                size={18}
                color={colors.mutedForeground}
              />
            </TouchableOpacity>
          </View>

          {/* Confirm password */}
          <Text style={[styles.label, { color: colors.mutedForeground }]}>
            Confirm password
          </Text>
          <View
            style={[
              styles.inputRow,
              {
                backgroundColor: colors.card,
                borderColor: colors.border,
              },
            ]}
          >
            <Feather name="lock" size={18} color={colors.mutedForeground} />
            <TextInput
              style={[styles.input, { color: colors.foreground }]}
              placeholder="Confirm new password"
              placeholderTextColor={colors.mutedForeground}
              value={confirm}
              onChangeText={(t) => {
                setConfirm(t);
                setError("");
              }}
              secureTextEntry={!showConfirm}
              autoCapitalize="none"
              autoCorrect={false}
              textContentType="newPassword"
              editable={!isSubmitting}
            />
            <TouchableOpacity
              onPress={() => setShowConfirm((v) => !v)}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Feather
                name={showConfirm ? "eye-off" : "eye"}
                size={18}
                color={colors.mutedForeground}
              />
            </TouchableOpacity>
          </View>

          {/* Real-time checklist */}
          {password.length > 0 && (
            <View
              style={[
                styles.checklist,
                {
                  backgroundColor: colors.card,
                  borderColor: colors.border,
                },
              ]}
            >
              {RULES.map((rule) => {
                const ok = rule.test(password);
                return (
                  <View key={rule.label} style={styles.checkRow}>
                    <Feather
                      name={ok ? "check-circle" : "circle"}
                      size={14}
                      color={ok ? "#00E676" : colors.mutedForeground}
                    />
                    <Text
                      style={[
                        styles.checkLabel,
                        {
                          color: ok ? "#00E676" : colors.mutedForeground,
                        },
                      ]}
                    >
                      {rule.label}
                    </Text>
                  </View>
                );
              })}
              {confirm.length > 0 && (
                <View style={styles.checkRow}>
                  <Feather
                    name={
                      password === confirm ? "check-circle" : "circle"
                    }
                    size={14}
                    color={
                      password === confirm
                        ? "#00E676"
                        : colors.mutedForeground
                    }
                  />
                  <Text
                    style={[
                      styles.checkLabel,
                      {
                        color:
                          password === confirm
                            ? "#00E676"
                            : colors.mutedForeground,
                      },
                    ]}
                  >
                    Passwords match
                  </Text>
                </View>
              )}
            </View>
          )}

          <TouchableOpacity
            style={[styles.submitBtn, { opacity: isSubmitting ? 0.7 : 1 }]}
            onPress={handleSubmit}
            disabled={isSubmitting}
          >
            <LinearGradient
              colors={[colors.accent, colors.primary]}
              style={styles.submitGradient}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
            >
              {isSubmitting ? (
                <ActivityIndicator size="small" color="#000" />
              ) : (
                <Text style={[styles.submitText, { color: "#000" }]}>
                  Reset Password
                </Text>
              )}
            </LinearGradient>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.linkBtn}
            onPress={() => router.replace("/(auth)")}
          >
            <Feather
              name="arrow-left"
              size={14}
              color={colors.mutedForeground}
            />
            <Text
              style={[styles.linkBtnText, { color: colors.mutedForeground }]}
            >
              Back to Sign In
            </Text>
          </TouchableOpacity>

          {!resetToken && (
            <TouchableOpacity
              style={[styles.primaryBtn, { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, marginTop: 4 }]}
              onPress={() => router.replace("/(auth)/forgot-password")}
            >
              <Text style={[styles.primaryBtnText, { color: colors.foreground }]}>
                Request new link
              </Text>
            </TouchableOpacity>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  flex: { flex: 1 },
  glow: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: 300,
  },
  centred: {
    flex: 1,
    paddingHorizontal: 24,
    alignItems: "center",
    justifyContent: "center",
  },
  inner: { paddingHorizontal: 24, alignItems: "center" },
  iconWrap: {
    width: 80,
    height: 80,
    borderRadius: 24,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
  },
  title: {
    fontSize: 26,
    fontWeight: "800",
    letterSpacing: -0.5,
    textAlign: "center",
    marginBottom: 8,
  },
  emailBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: 20,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  emailBadgeText: { fontSize: 14, fontWeight: "500", maxWidth: 260 },
  subtitle: {
    fontSize: 15,
    textAlign: "center",
    marginBottom: 24,
    lineHeight: 22,
  },
  hint: {
    fontSize: 13,
    textAlign: "center",
    lineHeight: 18,
  },
  errorBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    width: "100%",
    marginBottom: 14,
  },
  errorText: { color: "#FF4444", fontSize: 13, flex: 1 },
  label: {
    alignSelf: "flex-start",
    fontSize: 12,
    fontWeight: "600",
    marginBottom: 6,
    letterSpacing: 0.4,
  },
  inputRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 14,
    width: "100%",
    marginBottom: 14,
  },
  input: { flex: 1, fontSize: 16 },
  checklist: {
    width: "100%",
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 8,
    marginBottom: 20,
  },
  checkRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  checkLabel: { fontSize: 13 },
  submitBtn: {
    borderRadius: 14,
    overflow: "hidden",
    width: "100%",
    marginBottom: 4,
  },
  submitGradient: {
    paddingVertical: 16,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 54,
  },
  submitText: { fontSize: 17, fontWeight: "700" },
  primaryBtn: {
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: "center",
    width: "100%",
    marginBottom: 8,
  },
  primaryBtnText: { fontSize: 17, fontWeight: "700" },
  linkBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 16,
  },
  linkBtnText: { fontSize: 15 },
});
