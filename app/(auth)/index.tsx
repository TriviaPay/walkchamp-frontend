import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import React, { useState } from "react";
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
import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";
import { signInWithEmail, signInWithProvider, signInWithAppleNative, fetchMe, getUserIdFromJwt, DescopeError, ApiError } from "@/services/authService";
import { dbProfileToUserProfile } from "@/utils/profileMapper";
import { TouchableOpacity } from '@/components/HapticTouchableOpacity';
import { rf, rs, MAX_CONTENT_WIDTH } from "@/utils/responsive";

const EMAIL_DOMAINS = ["gmail.com", "yahoo.com", "outlook.com", "hotmail.com", "icloud.com"];

function getEmailSuggestions(email: string): string[] {
  const atIdx = email.indexOf("@");
  if (atIdx < 1) return [];
  if (email.indexOf("@") !== email.lastIndexOf("@")) return [];
  const local = email.slice(0, atIdx);
  if (!local) return [];
  const domainPart = email.slice(atIdx + 1).toLowerCase();
  if (EMAIL_DOMAINS.includes(domainPart)) return [];
  const matches = EMAIL_DOMAINS.filter((d) => d.startsWith(domainPart));
  return matches.map((d) => `${local}@${d}`);
}

export default function LoginScreen() {
  const colors = useColors();
  const { insets, safeTop, safeBottom } = useSafeLayout();
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [socialLoading, setSocialLoading] = useState<"google" | "apple" | null>(null);
  const [error, setError] = useState("");
  const [suggestions, setSuggestions] = useState<string[]>([]);

  const handleEmailChange = (t: string) => {
    setEmail(t);
    setError("");
    setSuggestions(getEmailSuggestions(t));
  };

  const handleSuggestionTap = (suggestion: string) => {
    setEmail(suggestion);
    setSuggestions([]);
  };

  const handleLogin = async () => {
    setSuggestions([]);
    setError("");
    const e = email.trim().toLowerCase();
    if (!e || !password) {
      setError("Please enter your email and password.");
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setLoading(true);
    try {
      const authData = await signInWithEmail(e, password);
      const userId = getUserIdFromJwt(authData.sessionJwt);

      const profile = await fetchMe(authData.sessionJwt);

      if (!profile) {
        router.replace({
          pathname: "/(auth)/complete-profile",
          params: {
            userId,
            email: e,
            authProvider: "email",
            sessionToken: authData.sessionJwt,
            refreshToken: authData.refreshJwt ?? "",
          },
        });
        return;
      }

      const status = (profile.accountStatus ?? profile.account_status) as string;
      if (status === "suspended" || status === "banned") {
        router.replace("/(auth)/account-restricted");
        return;
      }

      const userProfile = dbProfileToUserProfile(profile);
      await login(userProfile, authData.sessionJwt, authData.refreshJwt ?? "");

      if (!userProfile.emailVerified) {
        router.replace({
          pathname: "/(auth)/verify-email",
          params: { email: e, userId },
        });
        return;
      }

      // Explicitly route to complete-profile if the profile is still incomplete
      // (e.g. social-auth user whose DB record is partial). This mirrors the
      // guard in index.tsx and prevents a flash caused by the two racing.
      if (!userProfile.profileComplete) {
        router.replace({
          pathname: "/(auth)/complete-profile",
          params: {
            userId,
            email: e,
            authProvider: "email",
            sessionToken: authData.sessionJwt,
            refreshToken: authData.refreshJwt ?? "",
          },
        });
        return;
      }

      router.replace("/(tabs)/walk");
    } catch (err) {
      if (err instanceof DescopeError) {
        const desc = err.message.toLowerCase();
        if (desc.includes("method") || desc.includes("disabled") || desc.includes("not enabled") || desc.includes("not configured")) {
          setError("Password login is not yet set up for your account. Please complete signup first.");
        } else if (desc.includes("not found") || desc.includes("user does not exist")) {
          setError("No account found with this email address.");
        } else if (desc.includes("locked") || desc.includes("suspended")) {
          setError("This account has been suspended. Please contact support.");
        } else if (desc.includes("verify") || desc.includes("unverified")) {
          setError("Please verify your email address before signing in.");
        } else {
          setError("Invalid email or password.");
        }
      } else if (err instanceof ApiError && err.status >= 500) {
        setError("Server unavailable. Please try again later.");
      } else {
        setError("Something went wrong. Please try again.");
      }
    } finally {
      setLoading(false);
    }
  };

  async function handleSocialLogin(provider: "google" | "apple") {
    if (socialLoading || loading) return;
    setSuggestions([]);
    setError("");
    setSocialLoading(provider);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      // Apple on iOS → native ASAuthorizationController; everything else → web OAuth
      const authData =
        provider === "apple" && Platform.OS === "ios"
          ? await signInWithAppleNative()
          : await signInWithProvider(provider);

      const userId = getUserIdFromJwt(authData.sessionJwt);
      const providerEmail =
        authData.user?.loginIds?.[0] ??
        (authData.user as { email?: string } | undefined)?.email ??
        "";

      const profile = await fetchMe(authData.sessionJwt);
      if (!profile) {
        router.replace({
          pathname: "/(auth)/complete-profile",
          params: {
            userId,
            email: providerEmail,
            authProvider: provider,
            sessionToken: authData.sessionJwt,
            refreshToken: authData.refreshJwt ?? "",
          },
        });
        return;
      }

      const status = (profile.accountStatus ?? profile.account_status) as string;
      if (status === "suspended" || status === "banned") {
        router.replace("/(auth)/account-restricted");
        return;
      }

      const userProfile = dbProfileToUserProfile(profile);
      await login(userProfile, authData.sessionJwt, authData.refreshJwt ?? "");

      if (!userProfile.profileComplete) {
        router.replace({
          pathname: "/(auth)/complete-profile",
          params: {
            userId,
            email: providerEmail,
            authProvider: provider,
            sessionToken: authData.sessionJwt,
            refreshToken: authData.refreshJwt ?? "",
          },
        });
        return;
      }

      router.replace("/(tabs)/walk");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      if (msg.toLowerCase().includes("cancelled")) {
        // User dismissed the Apple sheet — show nothing
      } else if (err instanceof ApiError && err.status >= 500) {
        setError("Server unavailable. Please try again later.");
      } else {
        setError(msg || "Unable to sign in. Please try again.");
      }
    } finally {
      setSocialLoading(null);
    }
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <LinearGradient
        colors={["#00E67615", "#00B4FF10", "transparent"]}
        style={styles.topGlow}
        start={{ x: 0.5, y: 0 }}
        end={{ x: 0.5, y: 1 }}
      />

      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={styles.flex}>
        <ScrollView
          contentContainerStyle={[styles.scroll, { paddingTop: safeTop + 60, paddingBottom: safeBottom + 30 }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.header}>
            <View style={[styles.logoContainer, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Text style={[styles.logoText, { color: colors.primary }]}>WC</Text>
            </View>
            <Text style={[styles.appName, { color: colors.foreground }]}>Walk Champ</Text>
            <Text style={[styles.tagline, { color: colors.mutedForeground }]}>Global Walking Competition</Text>
          </View>

          <View style={styles.form}>
            <Text style={[styles.title, { color: colors.foreground }]}>Welcome back</Text>
            <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>Sign in to continue your journey</Text>

            {!!error && (
              <View style={[styles.errorBox, { backgroundColor: "#FF444420", borderColor: "#FF444450" }]}>
                <Feather name="alert-circle" size={14} color="#FF4444" />
                <Text style={styles.errorText}>{error}</Text>
              </View>
            )}

            {/* Email input + suggestions */}
            <View style={styles.emailWrapper}>
              <View style={[styles.inputContainer, { backgroundColor: colors.card, borderColor: suggestions.length > 0 ? colors.primary + "80" : colors.border }]}>
                <Feather name="mail" size={18} color={colors.mutedForeground} />
                <TextInput
                  style={[styles.input, { color: colors.foreground }]}
                  placeholder="Email address"
                  placeholderTextColor={colors.mutedForeground}
                  value={email}
                  onChangeText={handleEmailChange}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                {suggestions.length > 0 && (
                  <TouchableOpacity onPress={() => setSuggestions([])} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                    <Feather name="x" size={15} color={colors.mutedForeground} />
                  </TouchableOpacity>
                )}
              </View>

              {suggestions.length > 0 && (
                <View style={[styles.suggestionsDropdown, { backgroundColor: colors.card, borderColor: colors.primary + "50" }]}>
                  {suggestions.map((s, i) => (
                    <TouchableOpacity
                      key={s}
                      style={[
                        styles.suggestionItem,
                        i < suggestions.length - 1 && { borderBottomWidth: 1, borderBottomColor: colors.border },
                      ]}
                      onPress={() => handleSuggestionTap(s)}
                      activeOpacity={0.7}
                    >
                      <Feather name="at-sign" size={13} color={colors.primary} />
                      <Text style={[styles.suggestionText, { color: colors.foreground }]} numberOfLines={1}>
                        {s}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}
            </View>

            <View style={[styles.inputContainer, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <Feather name="lock" size={18} color={colors.mutedForeground} />
              <TextInput
                style={[styles.input, { color: colors.foreground }]}
                placeholder="Password"
                placeholderTextColor={colors.mutedForeground}
                value={password}
                onChangeText={(t) => { setPassword(t); setError(""); }}
                secureTextEntry={!showPassword}
              />
              <TouchableOpacity onPress={() => setShowPassword((p) => !p)}>
                <Feather name={showPassword ? "eye-off" : "eye"} size={18} color={colors.mutedForeground} />
              </TouchableOpacity>
            </View>

            <TouchableOpacity style={styles.forgotRow} onPress={() => router.push("/(auth)/forgot-password")}>
              <Text style={[styles.forgot, { color: colors.accent }]}>Forgot password?</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.loginBtn, { opacity: loading ? 0.7 : 1 }]}
              onPress={handleLogin}
              disabled={loading}
            >
              <LinearGradient colors={[colors.primary, colors.accent]} style={styles.loginGradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}>
                <Text style={[styles.loginBtnText, { color: "#000000" }]}>
                  {loading ? "Signing in..." : "Sign In"}
                </Text>
              </LinearGradient>
            </TouchableOpacity>

            <View style={styles.dividerRow}>
              <View style={[styles.divider, { backgroundColor: colors.border }]} />
              <Text style={[styles.dividerText, { color: colors.mutedForeground }]}>or</Text>
              <View style={[styles.divider, { backgroundColor: colors.border }]} />
            </View>

            <View style={styles.socialRow}>
              {/* Google — always visible */}
              <TouchableOpacity
                style={[
                  styles.socialBtn,
                  { backgroundColor: colors.card, borderColor: colors.border },
                  (!!socialLoading || loading) && { opacity: 0.7 },
                ]}
                onPress={() => handleSocialLogin("google")}
                disabled={!!socialLoading || loading}
              >
                {socialLoading === "google"
                  ? <ActivityIndicator size="small" color={colors.foreground} />
                  : <Feather name="globe" size={18} color={colors.foreground} />
                }
                <Text style={[styles.socialText, { color: colors.foreground }]}>
                  {socialLoading === "google" ? "Signing in…" : "Google"}
                </Text>
              </TouchableOpacity>

              {/* Apple — iOS only (native ASAuthorizationController) */}
              {Platform.OS === "ios" && (
                <TouchableOpacity
                  style={[
                    styles.socialBtn,
                    { backgroundColor: colors.card, borderColor: colors.border },
                    (!!socialLoading || loading) && { opacity: 0.7 },
                  ]}
                  onPress={() => handleSocialLogin("apple")}
                  disabled={!!socialLoading || loading}
                >
                  {socialLoading === "apple"
                    ? <ActivityIndicator size="small" color={colors.foreground} />
                    : <Feather name="smartphone" size={18} color={colors.foreground} />
                  }
                  <Text style={[styles.socialText, { color: colors.foreground }]}>
                    {socialLoading === "apple" ? "Signing in…" : "Apple"}
                  </Text>
                </TouchableOpacity>
              )}
            </View>

            <View style={styles.signupRow}>
              <Text style={[styles.signupText, { color: colors.mutedForeground }]}>New here? </Text>
              <TouchableOpacity onPress={() => router.push("/(auth)/onboarding")}>
                <Text style={[styles.signupLink, { color: colors.primary }]}>Create account</Text>
              </TouchableOpacity>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  flex: { flex: 1 },
  topGlow: { position: "absolute", top: 0, left: 0, right: 0, height: 300 },
  scroll: { paddingHorizontal: rs(24), maxWidth: MAX_CONTENT_WIDTH, alignSelf: "center", width: "100%" },
  header: { alignItems: "center", marginBottom: rs(40) },
  logoContainer: { width: rs(70), height: rs(70), borderRadius: rs(20), borderWidth: 1, alignItems: "center", justifyContent: "center", marginBottom: rs(12) },
  logoText: { fontSize: rf(26), fontWeight: "800" },
  appName: { fontSize: rf(28), fontWeight: "800", letterSpacing: -0.5 },
  tagline: { fontSize: rf(14), marginTop: 4 },
  form: { gap: rs(14) },
  title: { fontSize: rf(26), fontWeight: "800", letterSpacing: -0.5 },
  subtitle: { fontSize: rf(15), marginTop: -6 },
  errorBox: { flexDirection: "row", alignItems: "center", gap: 8, borderRadius: 10, borderWidth: 1, paddingHorizontal: rs(12), paddingVertical: rs(10) },
  errorText: { color: "#FF4444", fontSize: rf(13), flex: 1 },
  emailWrapper: { gap: 0 },
  inputContainer: { flexDirection: "row", alignItems: "center", gap: 12, borderRadius: 14, borderWidth: 1, paddingHorizontal: rs(16), paddingVertical: rs(14) },
  input: { flex: 1, fontSize: rf(16) },
  suggestionsDropdown: {
    borderRadius: 12,
    borderWidth: 1,
    overflow: "hidden",
    marginTop: 4,
  },
  suggestionItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: rs(16),
    paddingVertical: rs(11),
  },
  suggestionText: { fontSize: rf(14), fontWeight: "500", flex: 1 },
  forgotRow: { alignSelf: "flex-end" },
  forgot: { fontSize: rf(14), fontWeight: "500" },
  loginBtn: { borderRadius: 14, overflow: "hidden" },
  loginGradient: { paddingVertical: rs(16), alignItems: "center" },
  loginBtnText: { fontSize: rf(17), fontWeight: "700" },
  dividerRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  divider: { flex: 1, height: 1 },
  dividerText: { fontSize: rf(13) },
  socialRow: { flexDirection: "row", gap: 12 },
  socialBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: 14, borderWidth: 1, paddingVertical: rs(14) },
  socialText: { fontSize: rf(15), fontWeight: "600" },
  signupRow: { flexDirection: "row", justifyContent: "center", marginTop: 8 },
  signupText: { fontSize: rf(15) },
  signupLink: { fontSize: rf(15), fontWeight: "700" },
});
