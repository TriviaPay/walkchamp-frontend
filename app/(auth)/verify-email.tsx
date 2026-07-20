import { LinearGradient } from "expo-linear-gradient";
import { router, useLocalSearchParams } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
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
import { useAuth } from "@/context/AuthContext";
import { verifyEmailOTP, sendEmailOTP, fetchProfile, getUserIdFromJwt, DescopeError } from "@/services/authService";
import { dbProfileToUserProfile } from "@/utils/profileMapper";
import { TouchableOpacity } from '@/components/HapticTouchableOpacity';

const RESEND_COOLDOWN = 60;

export default function VerifyEmailScreen() {
  const colors = useColors();
  const { insets, safeTop, safeBottom } = useSafeLayout();
  const { login } = useAuth();
  const params = useLocalSearchParams<{
    email: string;
    userId: string;
    sessionToken?: string;
    refreshToken?: string;
  }>();

  const [code, setCode] = useState(["", "", "", "", "", ""]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [cooldown, setCooldown] = useState(0);
  const inputRefs = useRef<(TextInput | null)[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    // Start initial cooldown so user can't spam immediately
    startCooldown();
  }, []);

  function startCooldown() {
    setCooldown(RESEND_COOLDOWN);
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => {
      setCooldown((c) => {
        if (c <= 1) { clearInterval(timerRef.current!); return 0; }
        return c - 1;
      });
    }, 1000);
  }

  useEffect(() => () => { if (timerRef.current) clearInterval(timerRef.current); }, []);

  function handleCodeChange(text: string, index: number) {
    const digit = text.replace(/\D/g, "").slice(-1);
    const newCode = [...code];
    newCode[index] = digit;
    setCode(newCode);
    setError("");
    if (digit && index < 5) {
      inputRefs.current[index + 1]?.focus();
    }
    if (!digit && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  }

  async function handleVerify() {
    const otp = code.join("");
    if (otp.length < 6) { setError("Please enter the full 6-digit code."); return; }
    setLoading(true);
    setError("");
    try {
      const authData = await verifyEmailOTP(params.email, otp);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

      const userId = getUserIdFromJwt(authData.sessionJwt);
      const profile = await fetchProfile(userId);
      if (profile) {
        const userProfile = dbProfileToUserProfile(profile);
        await login(userProfile, authData.sessionJwt, authData.refreshJwt ?? "");
        router.replace("/(tabs)/walk");
      } else {
        router.replace({
          pathname: "/(auth)/complete-profile",
          params: { userId, email: params.email, authProvider: "email" },
        });
      }
    } catch (err) {
      if (err instanceof DescopeError) {
        setError("Invalid or expired code. Please try again.");
      } else {
        setError("Verification failed. Please try again.");
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleResend() {
    if (cooldown > 0) return;
    setError("");
    setSuccess("");
    try {
      await sendEmailOTP(params.email);
      setSuccess("A new code has been sent to your email.");
      startCooldown();
      setCode(["", "", "", "", "", ""]);
      inputRefs.current[0]?.focus();
    } catch {
      setError("Failed to resend. Please try again.");
    }
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <LinearGradient colors={["#00E67612", "transparent"]} style={styles.glow} start={{ x: 0.5, y: 0 }} end={{ x: 0.5, y: 1 }} />
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={styles.flex}>
        <View style={[styles.inner, { paddingTop: safeTop + 24, paddingBottom: safeBottom + 30 }]}>
          <TouchableOpacity style={styles.back} onPress={() => router.back()}>
            <Feather name="arrow-left" size={22} color={colors.foreground} />
          </TouchableOpacity>

          <View style={[styles.iconWrap, { backgroundColor: colors.primary + "20", borderColor: colors.primary + "50" }]}>
            <Feather name="mail" size={32} color={colors.primary} />
          </View>

          <Text style={[styles.title, { color: colors.foreground }]}>Verify your email</Text>
          <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
            We sent a 6-digit verification code to
          </Text>
          <Text style={[styles.emailText, { color: colors.foreground }]}>{params.email}</Text>

          {/* OTP Input */}
          <View style={styles.codeRow}>
            {code.map((digit, i) => (
              <TextInput
                key={i}
                ref={(r) => { inputRefs.current[i] = r; }}
                style={[
                  styles.codeBox,
                  {
                    backgroundColor: colors.card,
                    borderColor: digit ? colors.primary : colors.border,
                    color: colors.foreground,
                  },
                ]}
                value={digit}
                onChangeText={(t) => handleCodeChange(t, i)}
                keyboardType="numeric"
                maxLength={1}
                selectTextOnFocus
              />
            ))}
          </View>

          {!!error && (
            <View style={[styles.errorBox, { backgroundColor: "#FF444420", borderColor: "#FF444450" }]}>
              <Feather name="alert-circle" size={14} color="#FF4444" />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}
          {!!success && (
            <View style={[styles.successBox, { backgroundColor: "#00E67620", borderColor: "#00E67650" }]}>
              <Feather name="check-circle" size={14} color="#00E676" />
              <Text style={styles.successText}>{success}</Text>
            </View>
          )}

          <TouchableOpacity
            style={[styles.verifyBtn, { opacity: loading ? 0.7 : 1 }]}
            onPress={handleVerify}
            disabled={loading}
          >
            <LinearGradient colors={[colors.primary, colors.accent]} style={styles.verifyGradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}>
              {loading ? <ActivityIndicator color="#000000" /> : <Text style={styles.verifyText}>Verify Email</Text>}
            </LinearGradient>
          </TouchableOpacity>

          <TouchableOpacity onPress={handleResend} disabled={cooldown > 0} style={styles.resendBtn}>
            <Text style={[styles.resendText, { color: cooldown > 0 ? colors.mutedForeground : colors.primary }]}>
              {cooldown > 0 ? `Resend code in ${cooldown}s` : "Resend code"}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.changeEmailBtn} onPress={() => router.back()}>
            <Text style={[styles.changeEmailText, { color: colors.mutedForeground }]}>Change email address</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  flex: { flex: 1 },
  glow: { position: "absolute", top: 0, left: 0, right: 0, height: 250 },
  inner: { flex: 1, paddingHorizontal: rs(24), alignItems: "center" },
  back: { alignSelf: "flex-start", marginBottom: rs(32) },
  iconWrap: { width: rs(80), height: rs(80), borderRadius: rs(24), borderWidth: 1, alignItems: "center", justifyContent: "center", marginBottom: rs(20) },
  title: { fontSize: rf(26), fontWeight: "800", letterSpacing: -0.5, textAlign: "center" },
  subtitle: { fontSize: rf(15), textAlign: "center", marginTop: 8 },
  emailText: { fontSize: rf(15), fontWeight: "700", textAlign: "center", marginBottom: rs(32) },
  codeRow: { flexDirection: "row", gap: 10, marginBottom: rs(16) },
  codeBox: { width: rs(46), height: rs(56), borderRadius: 12, borderWidth: 1.5, fontSize: rf(22), fontWeight: "800", textAlign: "center" },
  errorBox: { flexDirection: "row", alignItems: "center", gap: 8, borderRadius: 10, borderWidth: 1, paddingHorizontal: rs(12), paddingVertical: rs(10), width: "100%", marginBottom: 8 },
  errorText: { color: "#FF4444", fontSize: rf(13), flex: 1 },
  successBox: { flexDirection: "row", alignItems: "center", gap: 8, borderRadius: 10, borderWidth: 1, paddingHorizontal: rs(12), paddingVertical: rs(10), width: "100%", marginBottom: 8 },
  successText: { color: "#00E676", fontSize: rf(13), flex: 1 },
  verifyBtn: { borderRadius: 14, overflow: "hidden", width: "100%", marginTop: 8 },
  verifyGradient: { paddingVertical: rs(16), alignItems: "center" },
  verifyText: { fontSize: rf(17), fontWeight: "700", color: "#000000" },
  resendBtn: { paddingVertical: rs(14) },
  resendText: { fontSize: rf(15), fontWeight: "600" },
  changeEmailBtn: { paddingVertical: 8 },
  changeEmailText: { fontSize: rf(14) },
});
