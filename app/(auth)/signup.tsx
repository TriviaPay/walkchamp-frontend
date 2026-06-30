import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
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
import {
  sendSignupOtp,
  verifySignupOtp,
  completeSignup,
  checkUsernameAvailable,
  signInWithProvider,
  fetchMe,
  getUserIdFromJwt,
  DescopeError,
  ApiError,
} from "@/services/authService";
import { dbProfileToUserProfile } from "@/utils/profileMapper";
import { COUNTRIES } from "@/constants/countries";
import { DateOfBirthInput } from "@/components/DateOfBirthInput";
import { TouchableOpacity } from '@/components/HapticTouchableOpacity';
import { rf, rs, MAX_CONTENT_WIDTH } from "@/utils/responsive";

// ── Helpers ───────────────────────────────────────────────────────────────────
function validatePassword(pw: string) {
  return {
    length: pw.length >= 8,
    upper: /[A-Z]/.test(pw),
    lower: /[a-z]/.test(pw),
    number: /[0-9]/.test(pw),
    special: /[^A-Za-z0-9]/.test(pw),
    noSpace: !/\s/.test(pw),
  };
}
function passwordValid(pw: string) {
  return Object.values(validatePassword(pw)).every(Boolean);
}

const USERNAME_RE = /^[a-zA-Z][a-zA-Z0-9_]{5,13}$/;
const BLOCKED = ["admin","support","official","system","moderator","walkchamp","walk_champ","staff","help"];
function usernameBlocked(u: string) {
  const l = u.toLowerCase().replace(/_/g, "");
  return BLOCKED.some((b) => l.includes(b));
}

function calcAge(dobStr: string): number {
  const parts = dobStr.split("-");
  if (parts.length !== 3) return 0;
  const birth = new Date(dobStr);
  if (isNaN(birth.getTime())) return 0;
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const m = today.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
  return age;
}

const AVATAR_COLORS = ["#00E676","#00B4FF","#06B6D4","#FFD700","#FF6B35","#A855F7","#F472B6","#34D399"];
const RESEND_COOLDOWN = 60;

// 5 steps: Email → Verify → Profile → Terms → Password
const STEP_LABELS = ["Email", "Verify", "Profile", "Terms", "Password"];

// ── Error box ─────────────────────────────────────────────────────────────────
function ErrorBox({ message }: { message: string }) {
  return (
    <View style={[styles.errorBox, { backgroundColor: "#FF444420", borderColor: "#FF444450" }]}>
      <Feather name="alert-circle" size={14} color="#FF4444" />
      <Text style={styles.errorText}>{message}</Text>
    </View>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────
export default function SignupScreen() {
  const colors = useColors();
  const { insets, safeTop, safeBottom } = useSafeLayout();
  const { login } = useAuth();
  const [step, setStep] = useState(0);

  // Step 0 — Email
  const [email, setEmail] = useState("");
  const [sendingOtp, setSendingOtp] = useState(false);
  const [step0Error, setStep0Error] = useState("");
  const [socialLoading, setSocialLoading] = useState<"google" | "apple" | null>(null);

  // Step 1 — Verify OTP (6-box input)
  const [otpDigits, setOtpDigits] = useState(["", "", "", "", "", ""]);
  const otpRefs = useRef<(TextInput | null)[]>([]);
  const [verifyingOtp, setVerifyingOtp] = useState(false);
  const [step1Error, setStep1Error] = useState("");
  const [cooldown, setCooldown] = useState(0);
  const cooldownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Session from OTP verification — held in state until full signup completes
  const [otpSession, setOtpSession] = useState({ jwt: "", refresh: "" });

  // Step 2 — Profile
  const [fullName, setFullName] = useState("");
  const [username, setUsername] = useState("");
  const [dob, setDob] = useState("");
  const [selectedCountry, setSelectedCountry] = useState(COUNTRIES[0]);
  // Profile color is auto-assigned from the default palette; user can change it in Edit Profile.
  const avatarColor = AVATAR_COLORS[0];
  const [referralCode, setReferralCode] = useState("");
  const [showCountryPicker, setShowCountryPicker] = useState(false);
  const [countrySearch, setCountrySearch] = useState("");
  const [usernameStatus, setUsernameStatus] = useState<"idle"|"checking"|"available"|"taken"|"invalid">("idle");
  const [step2Error, setStep2Error] = useState("");
  const usernameTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Step 3 — Terms
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [privacyAccepted, setPrivacyAccepted] = useState(false);
  const [rewardAccepted, setRewardAccepted] = useState(false);
  const [confirmInfoAccepted, setConfirmInfoAccepted] = useState(false);
  const [marketingOptIn, setMarketingOptIn] = useState(false);
  const [step3Error, setStep3Error] = useState("");

  // Step 4 — Password
  const [password, setPassword] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");

  const pwChecks = validatePassword(password);

  // Clean up cooldown timer
  useEffect(
    () => () => { if (cooldownRef.current) clearInterval(cooldownRef.current); },
    [],
  );

  function startCooldown() {
    setCooldown(RESEND_COOLDOWN);
    if (cooldownRef.current) clearInterval(cooldownRef.current);
    cooldownRef.current = setInterval(() => {
      setCooldown((c) => {
        if (c <= 1) { clearInterval(cooldownRef.current!); return 0; }
        return c - 1;
      });
    }, 1000);
  }

  // Real-time username check
  useEffect(() => {
    if (!username) { setUsernameStatus("idle"); return; }
    if (!USERNAME_RE.test(username) || usernameBlocked(username)) { setUsernameStatus("invalid"); return; }
    setUsernameStatus("checking");
    if (usernameTimer.current) clearTimeout(usernameTimer.current);
    usernameTimer.current = setTimeout(async () => {
      try {
        const { available } = await checkUsernameAvailable(username);
        setUsernameStatus(available ? "available" : "taken");
      } catch { setUsernameStatus("idle"); }
    }, 600);
  }, [username]);

  // ── Step 0: Social login (Google / Apple) — shared with login screen ────────
  async function handleSocialLogin(provider: "google" | "apple") {
    if (socialLoading || sendingOtp) return;
    setStep0Error("");
    setSocialLoading(provider);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      const authData = await signInWithProvider(provider);
      const userId = getUserIdFromJwt(authData.sessionJwt);
      const email =
        authData.user?.loginIds?.[0] ??
        (authData.user as { email?: string } | undefined)?.email ??
        "";

      const profile = await fetchMe(authData.sessionJwt);
      if (!profile) {
        router.replace({
          pathname: "/(auth)/complete-profile",
          params: {
            userId,
            email,
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
      router.replace("/(tabs)/walk");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      if (msg.toLowerCase().includes("cancelled")) {
        // User cancelled — show nothing (Task 9: "Apple sign-in was cancelled." already in msg)
      } else if (err instanceof ApiError && err.status >= 500) {
        setStep0Error("Server unavailable. Please try again later.");
      } else {
        setStep0Error(msg || "Unable to sign in. Please try again.");
      }
    } finally {
      setSocialLoading(null);
    }
  }

  // ── Step 0: Send signup OTP ────────────────────────────────────────────────
  async function handleSendOtp() {
    setStep0Error("");
    const e = email.trim().toLowerCase();
    if (!e) { setStep0Error("Please enter your email address."); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) { setStep0Error("Please enter a valid email address."); return; }
    setSendingOtp(true);
    try {
      await sendSignupOtp(e);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      startCooldown();
      setStep(1);
    } catch (err) {
      if (err instanceof DescopeError) {
        const msg = err.message.toLowerCase();
        if (msg.includes("disabled") || msg.includes("not enabled")) {
          setStep0Error(
            "Email OTP is disabled in your Descope project.\n\n" +
            "Fix: Descope Console → Authentication Methods → One-Time Password → Enable.",
          );
        } else {
          setStep0Error(err.message);
        }
      } else {
        setStep0Error("Could not send verification code. Please check your connection and try again.");
      }
    } finally {
      setSendingOtp(false);
    }
  }

  async function handleResendOtp() {
    if (cooldown > 0) return;
    try {
      await sendSignupOtp(email.trim().toLowerCase());
      startCooldown();
    } catch { /* silent — user sees next-try in cooldown */ }
  }

  // ── Step 1: Verify OTP ────────────────────────────────────────────────────
  function handleOtpChange(value: string, index: number) {
    const cleaned = value.replace(/[^0-9]/g, "").slice(-1);
    const next = [...otpDigits];
    next[index] = cleaned;
    setOtpDigits(next);
    if (cleaned && index < 5) otpRefs.current[index + 1]?.focus();
  }

  function handleOtpKeyPress(e: { nativeEvent: { key: string } }, index: number) {
    if (e.nativeEvent.key === "Backspace" && !otpDigits[index] && index > 0) {
      otpRefs.current[index - 1]?.focus();
    }
  }

  async function handleVerifyOtp() {
    const code = otpDigits.join("");
    if (code.length < 6) { setStep1Error("Please enter the full 6-digit code."); return; }
    setStep1Error("");
    setVerifyingOtp(true);
    try {
      const authData = await verifySignupOtp(email.trim().toLowerCase(), code);

      // Check if this email already belongs to a completed account.
      // Since sendSignupOtp now uses signUpOrIn, existing users pass verification —
      // we detect them here and redirect instead of letting them re-signup.
      const existingProfile = await fetchMe(authData.sessionJwt).catch(() => null);
      if (existingProfile) {
        const completed = !!(existingProfile.profile_completed ?? existingProfile.profileCompleted);
        const authProvider = String(existingProfile.auth_provider ?? existingProfile.authProvider ?? "email");
        if (completed) {
          if (authProvider === "google" || authProvider === "apple") {
            setStep1Error(
              `This email is registered via ${authProvider === "google" ? "Google" : "Apple"} login. Please sign in with that method.`,
            );
          } else {
            setStep1Error("This email is already registered. Please sign in or reset your password.");
          }
          setOtpDigits(["", "", "", "", "", ""]);
          setStep(0);
          return;
        }
        // Incomplete profile — let them resume signup
        if (__DEV__) console.log("[signup] existing incomplete profile, resuming onboarding");
      }

      // Store session in component state — SecureStore write happens after full signup
      setOtpSession({ jwt: authData.sessionJwt, refresh: authData.refreshJwt ?? "" });
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      setStep(2);
    } catch (err) {
      if (err instanceof DescopeError) {
        const msg = err.message.toLowerCase();
        if (msg.includes("disabled") || msg.includes("not enabled")) {
          setStep1Error(
            "Email OTP is disabled in your Descope project.\n" +
            "Enable: Authentication Methods → One-Time Password.",
          );
        } else if (
          msg.includes("invalid") || msg.includes("expired") ||
          msg.includes("incorrect") || msg.includes("wrong")
        ) {
          setStep1Error("Invalid or expired verification code. Please try again.");
        } else {
          setStep1Error(err.message);
        }
      } else {
        setStep1Error("Verification failed. Please check your code and try again.");
      }
    } finally {
      setVerifyingOtp(false);
    }
  }

  // ── Step 2: Profile next ──────────────────────────────────────────────────
  function handleStep2Next() {
    setStep2Error("");
    if (!fullName.trim()) { setStep2Error("Full name is required."); return; }
    if (usernameStatus !== "available") { setStep2Error("Please choose a valid, available username."); return; }
    if (!dob) { setStep2Error("Date of birth is required."); return; }
    const age = calcAge(dob);
    if (age < 13) { setStep2Error("You must be at least 13 years old to register."); return; }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setStep(3);
  }

  // ── Step 3: Terms next ────────────────────────────────────────────────────
  function handleStep3Next() {
    setStep3Error("");
    if (!termsAccepted || !privacyAccepted || !rewardAccepted || !confirmInfoAccepted) {
      setStep3Error("Please accept all required agreements to continue.");
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setStep(4);
  }

  // ── Step 4: Set password + create account ────────────────────────────────
  async function handleCreateAccount() {
    setSubmitError("");
    if (!passwordValid(password)) { setSubmitError("Password does not meet all requirements."); return; }
    if (/\s/.test(password)) { setSubmitError("Password cannot contain spaces."); return; }
    if (password !== confirmPw) { setSubmitError("Passwords do not match."); return; }
    if (!otpSession.jwt) {
      setSubmitError("Your session has expired. Please start over.");
      setStep(0);
      return;
    }

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setSubmitting(true);
    try {
      // Single backend call: backend sets password in Descope via management key,
      // then creates the NeonDB profile — password is NEVER stored in NeonDB.
      const profile = await completeSignup(
        {
          password,
          fullName: fullName.trim(),
          username: username.toLowerCase().trim(),
          dateOfBirth: dob,
          country: selectedCountry.name,
          countryCode: selectedCountry.code,
          countryFlag: selectedCountry.flag,
          referredBy: referralCode.trim() || undefined,
          avatarColor,
          termsAccepted,
          privacyAccepted,
          rewardDisclaimerAccepted: rewardAccepted,
          marketingOptIn,
        },
        otpSession.jwt,
      );

      // Persist session + update auth context → enters main app
      const userProfile = dbProfileToUserProfile(profile);
      await login(userProfile, otpSession.jwt, otpSession.refresh);

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.replace("/(tabs)/walk");
    } catch (err) {
      if (err instanceof DescopeError) {
        const msg = err.message.toLowerCase();
        if (msg.includes("disabled") || msg.includes("not enabled")) {
          setSubmitError(
            "Password Authentication is disabled in Descope.\n\n" +
            "Fix: Authentication Methods → Passwords → Enable method in API and SDK.",
          );
        } else if (msg.includes("expired") || msg.includes("invalid token") || msg.includes("unauthorized")) {
          setSubmitError("Your session expired. Please start the signup again.");
          setStep(0);
        } else {
          setSubmitError(err.message);
        }
      } else {
        const e = err as { message?: string };
        if (e.message === "username_taken") {
          setSubmitError("That username was just taken. Please choose another.");
          setStep(2);
        } else if (e.message === "email_taken") {
          setSubmitError("This email is already registered. Please sign in.");
          setStep(0);
        } else {
          setSubmitError("Something went wrong. Please try again.");
        }
      }
    } finally {
      setSubmitting(false);
    }
  }

  const filteredCountries = COUNTRIES.filter((c) =>
    c.name.toLowerCase().includes(countrySearch.toLowerCase()),
  );

  // ── Sub-components ────────────────────────────────────────────────────────
  const PWCheck = ({ ok, label }: { ok: boolean; label: string }) => (
    <View style={styles.pwCheckRow}>
      <Feather name={ok ? "check-circle" : "circle"} size={13} color={ok ? "#00E676" : colors.mutedForeground} />
      <Text style={[styles.pwCheckText, { color: ok ? "#00E676" : colors.mutedForeground }]}>{label}</Text>
    </View>
  );

  const CheckBox = ({
    value, onToggle, label, required,
  }: { value: boolean; onToggle: () => void; label: string; required?: boolean }) => (
    <TouchableOpacity style={styles.checkRow} onPress={onToggle} activeOpacity={0.7}>
      <View style={[styles.checkbox, {
        borderColor: value ? colors.primary : colors.border,
        backgroundColor: value ? colors.primary + "20" : "transparent",
      }]}>
        {value && <Feather name="check" size={12} color={colors.primary} />}
      </View>
      <Text style={[styles.checkLabel, { color: colors.foreground }]}>
        {label}
        {required && <Text style={{ color: "#FF4444" }}> *</Text>}
      </Text>
    </TouchableOpacity>
  );

  const usernameColor =
    usernameStatus === "available" ? "#00E676" :
    (usernameStatus === "taken" || usernameStatus === "invalid") ? "#FF4444" :
    colors.mutedForeground;

  const usernameHint =
    usernameStatus === "available" ? "Username is available!" :
    usernameStatus === "taken" ? "This username is already taken." :
    usernameStatus === "invalid" ? "6–14 chars, letters/numbers/underscore, must start with a letter." :
    usernameStatus === "checking" ? "Checking availability…" : "";

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={styles.flex}>
        <ScrollView
          contentContainerStyle={[styles.scroll, { paddingTop: safeTop + 16, paddingBottom: safeBottom + 30 }]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {step === 0 && (
            <View style={styles.authLogoHeader}>
              <View style={[styles.logoContainer, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Image
                  source={require("@/assets/icons/WalkChampProgress0.png")}
                  style={styles.logoImage}
                  resizeMode="contain"
                />
              </View>
              <Text style={[styles.authAppName, { color: colors.foreground }]}>Walk Champ</Text>
              <Text style={[styles.authTagline, { color: colors.mutedForeground }]}>
                Global Walking Competition
              </Text>
            </View>
          )}

          {/* Header */}
          <View style={styles.topRow}>
            <TouchableOpacity
              onPress={() => step > 0 ? setStep(step - 1) : router.back()}
              style={styles.back}
            >
              <Feather name="arrow-left" size={22} color={colors.foreground} />
            </TouchableOpacity>
            <View style={styles.stepIndicator}>
              {STEP_LABELS.map((_, i) => (
                <View key={i} style={styles.stepItem}>
                  <View style={[styles.stepDot, {
                    backgroundColor: i <= step ? colors.primary : colors.border,
                    width: i === step ? 24 : 8,
                  }]} />
                </View>
              ))}
            </View>
            <Text style={[styles.stepLabel, { color: colors.mutedForeground }]}>
              {step + 1}/{STEP_LABELS.length} {STEP_LABELS[step]}
            </Text>
          </View>

          <Text style={[styles.title, { color: colors.foreground }]}>
            {step === 0 ? "Create Account" :
             step === 1 ? "Verify Email" :
             step === 2 ? "Your Profile" :
             step === 3 ? "Terms & Policies" :
             "Create Password"}
          </Text>
          <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
            {step === 0 ? "Walk Champ — join millions of walkers" :
             step === 1 ? `Enter the 6-digit code sent to ${email}` :
             step === 2 ? "Tell us about yourself" :
             step === 3 ? "Review and accept the terms" :
             "Stored securely in Descope — Walk Champ never sees it"}
          </Text>

          {/* ── STEP 0: Email ──────────────────────────────────────── */}
          {step === 0 && (
            <View style={styles.form}>
              {!!step0Error && <ErrorBox message={step0Error} />}

              <View>
                <Text style={[styles.label, { color: colors.mutedForeground }]}>Email address *</Text>
                <View style={[styles.inputContainer, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  <Feather name="mail" size={18} color={colors.mutedForeground} />
                  <TextInput
                    style={[styles.input, { color: colors.foreground }]}
                    placeholder="you@example.com"
                    placeholderTextColor={colors.mutedForeground}
                    value={email}
                    onChangeText={setEmail}
                    keyboardType="email-address"
                    autoCapitalize="none"
                    autoCorrect={false}
                    returnKeyType="done"
                    onSubmitEditing={handleSendOtp}
                  />
                </View>
              </View>

              <TouchableOpacity
                style={[styles.nextBtn, { opacity: sendingOtp ? 0.7 : 1 }]}
                onPress={handleSendOtp}
                disabled={sendingOtp}
              >
                <LinearGradient colors={[colors.primary, colors.accent]} style={styles.nextGradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}>
                  {sendingOtp ? <ActivityIndicator color="#000000" /> : (
                    <>
                      <Text style={[styles.nextText, { color: "#000000" }]}>Send Verification Code</Text>
                      <Feather name="send" size={20} color="#000000" />
                    </>
                  )}
                </LinearGradient>
              </TouchableOpacity>

              <View style={styles.socialDividerRow}>
                <View style={[styles.socialDivider, { backgroundColor: colors.border }]} />
                <Text style={[styles.socialDividerText, { color: colors.mutedForeground }]}>or</Text>
                <View style={[styles.socialDivider, { backgroundColor: colors.border }]} />
              </View>

              <View style={styles.socialRow}>
                {(["google", "apple"] as const).map((provider) => {
                  const isBusy = socialLoading === provider;
                  const label = provider === "google" ? "Google" : "Apple";
                  return (
                    <TouchableOpacity
                      key={provider}
                      style={[
                        styles.socialBtn,
                        { backgroundColor: colors.card, borderColor: colors.border },
                        (!!socialLoading || sendingOtp) && { opacity: 0.7 },
                      ]}
                      onPress={() => handleSocialLogin(provider)}
                      disabled={!!socialLoading || sendingOtp}
                    >
                      {isBusy
                        ? <ActivityIndicator size="small" color={colors.foreground} />
                        : <Feather name={provider === "google" ? "globe" : "smartphone"} size={18} color={colors.foreground} />
                      }
                      <Text style={[styles.socialBtnText, { color: colors.foreground }]}>
                        {isBusy ? "Signing in…" : label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <View style={styles.signinRow}>
                <Text style={[styles.signinText, { color: colors.mutedForeground }]}>Already have an account? </Text>
                <TouchableOpacity onPress={() => router.replace("/(auth)")}>
                  <Text style={[styles.signinLink, { color: colors.primary }]}>Sign in</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

          {/* ── STEP 1: Verify OTP ────────────────────────────────── */}
          {step === 1 && (
            <View style={styles.form}>
              {!!step1Error && <ErrorBox message={step1Error} />}

              <View style={styles.otpRow}>
                {otpDigits.map((digit, i) => (
                  <TextInput
                    key={i}
                    ref={(r) => { otpRefs.current[i] = r; }}
                    style={[
                      styles.otpBox,
                      {
                        backgroundColor: colors.card,
                        borderColor: digit ? colors.primary : colors.border,
                        color: colors.foreground,
                      },
                    ]}
                    value={digit}
                    onChangeText={(v) => handleOtpChange(v, i)}
                    onKeyPress={(e) => handleOtpKeyPress(e, i)}
                    keyboardType="number-pad"
                    maxLength={1}
                    selectTextOnFocus
                  />
                ))}
              </View>

              <TouchableOpacity
                style={[styles.nextBtn, { opacity: verifyingOtp ? 0.7 : 1 }]}
                onPress={handleVerifyOtp}
                disabled={verifyingOtp}
              >
                <LinearGradient colors={[colors.primary, colors.accent]} style={styles.nextGradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}>
                  {verifyingOtp ? <ActivityIndicator color="#000000" /> : (
                    <>
                      <Text style={[styles.nextText, { color: "#000000" }]}>Verify Email</Text>
                      <Feather name="check" size={20} color="#000000" />
                    </>
                  )}
                </LinearGradient>
              </TouchableOpacity>

              <View style={styles.resendRow}>
                {cooldown > 0 ? (
                  <Text style={[styles.resendText, { color: colors.mutedForeground }]}>
                    Resend code in {cooldown}s
                  </Text>
                ) : (
                  <TouchableOpacity onPress={handleResendOtp}>
                    <Text style={[styles.resendText, { color: colors.primary }]}>Resend verification code</Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>
          )}

          {/* ── STEP 2: Profile ───────────────────────────────────── */}
          {step === 2 && (
            <View style={styles.form}>
              {!!step2Error && <ErrorBox message={step2Error} />}

              <View>
                <Text style={[styles.label, { color: colors.mutedForeground }]}>Full legal name *</Text>
                <View style={[styles.inputContainer, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  <Feather name="user" size={18} color={colors.mutedForeground} />
                  <TextInput style={[styles.input, { color: colors.foreground }]} placeholder="Your full name" placeholderTextColor={colors.mutedForeground} value={fullName} onChangeText={setFullName} autoCapitalize="words" />
                </View>
              </View>

              <View>
                <Text style={[styles.label, { color: colors.mutedForeground }]}>Username *</Text>
                <View style={[styles.inputContainer, { backgroundColor: colors.card, borderColor: usernameStatus === "available" ? "#00E67660" : (usernameStatus === "taken" || usernameStatus === "invalid") ? "#FF444460" : colors.border }]}>
                  <Feather name="at-sign" size={18} color={colors.mutedForeground} />
                  <TextInput style={[styles.input, { color: colors.foreground }]} placeholder="unique_name (6–14 chars)" placeholderTextColor={colors.mutedForeground} value={username} onChangeText={(t) => setUsername(t.replace(/\s/g, ""))} autoCapitalize="none" autoCorrect={false} maxLength={14} />
                  {usernameStatus === "checking" && <ActivityIndicator size="small" color={colors.primary} />}
                  {usernameStatus === "available" && <Feather name="check-circle" size={18} color="#00E676" />}
                  {(usernameStatus === "taken" || usernameStatus === "invalid") && <Feather name="x-circle" size={18} color="#FF4444" />}
                </View>
                {!!usernameHint && <Text style={[styles.fieldHint, { color: usernameColor }]}>{usernameHint}</Text>}
              </View>

              <View>
                <Text style={[styles.label, { color: colors.mutedForeground }]}>Date of birth *</Text>
                <DateOfBirthInput value={dob} onChange={setDob} />
                {dob && calcAge(dob) < 18 && calcAge(dob) >= 13 && (
                  <View style={[styles.infoBox, { backgroundColor: "#FFD70015", borderColor: "#FFD70040" }]}>
                    <Feather name="info" size={13} color="#FFD700" />
                    <Text style={[styles.infoText, { color: "#FFD700" }]}>You must be 18+ to join paid races or withdraw rewards. You can use free features.</Text>
                  </View>
                )}
              </View>

              <View>
                <Text style={[styles.label, { color: colors.mutedForeground }]}>Country *</Text>
                <TouchableOpacity
                  style={[styles.inputContainer, { backgroundColor: colors.card, borderColor: colors.border }]}
                  onPress={() => setShowCountryPicker(true)}
                >
                  <Text style={{ fontSize: 20 }}>{selectedCountry.flag}</Text>
                  <Text style={[styles.input, { color: colors.foreground }]}>{selectedCountry.name}</Text>
                  <Feather name="chevron-down" size={18} color={colors.mutedForeground} />
                </TouchableOpacity>
              </View>

              <View>
                <Text style={[styles.label, { color: colors.mutedForeground }]}>Referral code (optional)</Text>
                <View style={[styles.inputContainer, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  <Feather name="gift" size={18} color={colors.mutedForeground} />
                  <TextInput style={[styles.input, { color: colors.foreground }]} placeholder="Enter referral code" placeholderTextColor={colors.mutedForeground} value={referralCode} onChangeText={setReferralCode} autoCapitalize="characters" />
                </View>
              </View>

              <TouchableOpacity style={styles.nextBtn} onPress={handleStep2Next}>
                <LinearGradient colors={[colors.primary, colors.accent]} style={styles.nextGradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}>
                  <Text style={[styles.nextText, { color: "#000000" }]}>Continue</Text>
                  <Feather name="arrow-right" size={20} color="#000000" />
                </LinearGradient>
              </TouchableOpacity>
            </View>
          )}

          {/* ── STEP 3: Terms ────────────────────────────────────── */}
          {step === 3 && (
            <View style={styles.form}>
              {!!step3Error && <ErrorBox message={step3Error} />}

              <View style={[styles.disclaimerBox, { backgroundColor: colors.card, borderColor: "#FFD70040" }]}>
                <Feather name="alert-triangle" size={16} color="#FFD700" />
                <Text style={[styles.disclaimerText, { color: colors.foreground }]}>
                  Rewards and withdrawals are subject to verification. Suspicious activity may result in disqualification, account suspension, or reward cancellation.
                </Text>
              </View>

              <CheckBox value={termsAccepted} onToggle={() => setTermsAccepted((v) => !v)} label="I agree to the Terms & Conditions" required />
              <CheckBox value={privacyAccepted} onToggle={() => setPrivacyAccepted((v) => !v)} label="I agree to the Privacy Policy" required />
              <CheckBox value={rewardAccepted} onToggle={() => setRewardAccepted((v) => !v)} label="I understand rewards are subject to verification" required />
              <CheckBox value={confirmInfoAccepted} onToggle={() => setConfirmInfoAccepted((v) => !v)} label="I confirm my information is accurate" required />
              <CheckBox value={marketingOptIn} onToggle={() => setMarketingOptIn((v) => !v)} label="I want to receive race and reward notifications (optional)" />

              <TouchableOpacity style={styles.nextBtn} onPress={handleStep3Next}>
                <LinearGradient colors={[colors.primary, colors.accent]} style={styles.nextGradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}>
                  <Text style={[styles.nextText, { color: "#000000" }]}>Continue to Password</Text>
                  <Feather name="arrow-right" size={20} color="#000000" />
                </LinearGradient>
              </TouchableOpacity>
            </View>
          )}

          {/* ── STEP 4: Password ─────────────────────────────────── */}
          {step === 4 && (
            <View style={styles.form}>
              {!!submitError && <ErrorBox message={submitError} />}

              <View style={[styles.infoBox, { backgroundColor: "#00E67610", borderColor: "#00E67640" }]}>
                <Feather name="shield" size={13} color="#00E676" />
                <Text style={[styles.infoText, { color: "#00E676" }]}>
                  Your password is stored securely in Descope. Walk Champ never stores your password.
                </Text>
              </View>

              <View>
                <Text style={[styles.label, { color: colors.mutedForeground }]}>Password *</Text>
                <View style={[styles.inputContainer, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  <Feather name="lock" size={18} color={colors.mutedForeground} />
                  <TextInput
                    style={[styles.input, { color: colors.foreground }]}
                    placeholder="Min 8 characters"
                    placeholderTextColor={colors.mutedForeground}
                    value={password}
                    onChangeText={setPassword}
                    secureTextEntry={!showPw}
                  />
                  <TouchableOpacity onPress={() => setShowPw((p) => !p)}>
                    <Feather name={showPw ? "eye-off" : "eye"} size={18} color={colors.mutedForeground} />
                  </TouchableOpacity>
                </View>
                {password.length > 0 && (
                  <View style={[styles.pwChecks, { backgroundColor: colors.card, borderColor: colors.border }]}>
                    <PWCheck ok={pwChecks.length} label="8+ characters" />
                    <PWCheck ok={pwChecks.upper} label="Uppercase letter" />
                    <PWCheck ok={pwChecks.lower} label="Lowercase letter" />
                    <PWCheck ok={pwChecks.number} label="Number" />
                    <PWCheck ok={pwChecks.special} label="Special character" />
                    <PWCheck ok={pwChecks.noSpace} label="No spaces" />
                  </View>
                )}
              </View>

              <View>
                <Text style={[styles.label, { color: colors.mutedForeground }]}>Confirm password *</Text>
                <View style={[styles.inputContainer, { backgroundColor: colors.card, borderColor: colors.border }]}>
                  <Feather name="lock" size={18} color={colors.mutedForeground} />
                  <TextInput
                    style={[styles.input, { color: colors.foreground }]}
                    placeholder="Re-enter password"
                    placeholderTextColor={colors.mutedForeground}
                    value={confirmPw}
                    onChangeText={setConfirmPw}
                    secureTextEntry={!showConfirm}
                  />
                  <TouchableOpacity onPress={() => setShowConfirm((p) => !p)}>
                    <Feather name={showConfirm ? "eye-off" : "eye"} size={18} color={colors.mutedForeground} />
                  </TouchableOpacity>
                </View>
                {confirmPw.length > 0 && password !== confirmPw && (
                  <Text style={[styles.fieldError, { color: "#FF4444" }]}>Passwords do not match.</Text>
                )}
              </View>

              <TouchableOpacity
                style={[styles.nextBtn, { opacity: submitting ? 0.7 : 1 }]}
                onPress={handleCreateAccount}
                disabled={submitting}
              >
                <LinearGradient colors={[colors.primary, colors.accent]} style={styles.nextGradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}>
                  {submitting ? <ActivityIndicator color="#000000" /> : (
                    <>
                      <Text style={[styles.nextText, { color: "#000000" }]}>Create Account</Text>
                      <Feather name="check" size={20} color="#000000" />
                    </>
                  )}
                </LinearGradient>
              </TouchableOpacity>
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Country Picker Modal */}
      {showCountryPicker && (
        <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.background, zIndex: 999 }]}>
          <View style={[styles.modalHeader, { paddingTop: safeTop + 12, borderBottomColor: colors.border }]}>
            <Text style={[styles.modalTitle, { color: colors.foreground }]}>Select Country</Text>
            <TouchableOpacity onPress={() => setShowCountryPicker(false)}>
              <Feather name="x" size={22} color={colors.foreground} />
            </TouchableOpacity>
          </View>
          <View style={[styles.searchBox, { backgroundColor: colors.card, borderColor: colors.border, marginHorizontal: 16, marginVertical: 8 }]}>
            <Feather name="search" size={16} color={colors.mutedForeground} />
            <TextInput
              style={[styles.input, { color: colors.foreground }]}
              placeholder="Search country..."
              placeholderTextColor={colors.mutedForeground}
              value={countrySearch}
              onChangeText={setCountrySearch}
            />
          </View>
          <ScrollView keyboardShouldPersistTaps="handled">
            {filteredCountries.map((item) => (
              <TouchableOpacity
                key={item.code}
                style={[styles.countryRow, { borderBottomColor: colors.border }]}
                onPress={() => { setSelectedCountry(item); setShowCountryPicker(false); setCountrySearch(""); }}
              >
                <Text style={{ fontSize: 22 }}>{item.flag}</Text>
                <Text style={[styles.countryName, { color: colors.foreground }]}>{item.name}</Text>
                {selectedCountry.code === item.code && <Feather name="check" size={18} color={colors.primary} />}
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  flex: { flex: 1 },
  scroll: { paddingHorizontal: rs(24), maxWidth: MAX_CONTENT_WIDTH, alignSelf: "center", width: "100%" },
  authLogoHeader: { alignItems: "center", marginBottom: rs(20) },
  logoContainer: { width: rs(70), height: rs(70), borderRadius: rs(20), borderWidth: 1, alignItems: "center", justifyContent: "center", marginBottom: rs(12) },
  logoImage: { width: rs(48), height: rs(48) },
  authAppName: { fontSize: rf(24), fontWeight: "800", letterSpacing: -0.5 },
  authTagline: { fontSize: rf(14), marginTop: 4 },
  topRow: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: rs(24) },
  back: { padding: 4 },
  stepIndicator: { flexDirection: "row", gap: 4, flex: 1 },
  stepItem: { justifyContent: "center" },
  stepDot: { height: 6, borderRadius: 3 },
  stepLabel: { fontSize: rf(12), fontWeight: "600" },
  title: { fontSize: rf(28), fontWeight: "800", letterSpacing: -0.5 },
  subtitle: { fontSize: rf(15), marginTop: 6, marginBottom: rs(24) },
  form: { gap: rs(16) },
  label: { fontSize: rf(13), fontWeight: "600", marginBottom: 6 },
  inputContainer: { flexDirection: "row", alignItems: "center", gap: 12, borderRadius: 14, borderWidth: 1, paddingHorizontal: rs(16), paddingVertical: rs(14) },
  input: { flex: 1, fontSize: rf(16) },
  fieldError: { fontSize: rf(12), marginTop: 4, marginLeft: 4 },
  fieldHint: { fontSize: rf(12), marginTop: 4, marginLeft: 4 },
  errorBox: { flexDirection: "row", alignItems: "flex-start", gap: 8, borderRadius: 10, borderWidth: 1, paddingHorizontal: rs(12), paddingVertical: rs(10) },
  errorText: { color: "#FF4444", fontSize: rf(13), flex: 1, lineHeight: 18 },
  infoBox: { flexDirection: "row", alignItems: "flex-start", gap: 8, borderRadius: 10, borderWidth: 1, paddingHorizontal: rs(12), paddingVertical: rs(10) },
  infoText: { fontSize: rf(12), flex: 1, lineHeight: 18 },
  otpRow: { flexDirection: "row", justifyContent: "space-between", gap: 8 },
  otpBox: { flex: 1, height: rs(60), borderRadius: 12, borderWidth: 2, textAlign: "center", fontSize: rf(26), fontWeight: "700" },
  resendRow: { alignItems: "center", marginTop: 4 },
  resendText: { fontSize: rf(14) },
  pwChecks: { borderRadius: 10, borderWidth: 1, padding: rs(12), marginTop: 6, gap: 6 },
  pwCheckRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  pwCheckText: { fontSize: rf(12) },
  checkRow: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  checkbox: { width: rs(22), height: rs(22), borderRadius: 6, borderWidth: 2, alignItems: "center", justifyContent: "center", marginTop: 1 },
  checkLabel: { flex: 1, fontSize: rf(14), lineHeight: 22 },
  disclaimerBox: { flexDirection: "row", alignItems: "flex-start", gap: 10, borderRadius: 12, borderWidth: 1, padding: rs(14) },
  disclaimerText: { flex: 1, fontSize: rf(13), lineHeight: 20 },
  colorRow: { flexDirection: "row", gap: 12 },
  colorDot: { width: rs(34), height: rs(34), borderRadius: rs(17) },
  colorDotSelected: { borderWidth: 3, borderColor: "#FFFFFF" },
  nextBtn: { borderRadius: 14, overflow: "hidden", marginTop: 8 },
  nextGradient: { paddingVertical: rs(16), flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  nextText: { fontSize: rf(17), fontWeight: "700" },
  socialDividerRow: { flexDirection: "row", alignItems: "center", gap: 12, marginTop: 4 },
  socialDivider: { flex: 1, height: 1 },
  socialDividerText: { fontSize: rf(13) },
  socialRow: { flexDirection: "row", gap: 12 },
  socialBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: 14, borderWidth: 1, paddingVertical: rs(13) },
  socialBtnText: { fontSize: rf(14), fontWeight: "600" },
  signinRow: { flexDirection: "row", justifyContent: "center", alignItems: "center", marginTop: 8 },
  signinText: { fontSize: rf(14) },
  signinLink: { fontSize: rf(14), fontWeight: "700" },
  modalHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 20, paddingBottom: 12, borderBottomWidth: 1 },
  modalTitle: { fontSize: rf(18), fontWeight: "700" },
  searchBox: { flexDirection: "row", alignItems: "center", gap: 10, borderRadius: 12, borderWidth: 1, paddingHorizontal: rs(14), paddingVertical: rs(10) },
  countryRow: { flexDirection: "row", alignItems: "center", gap: 14, paddingHorizontal: 20, paddingVertical: rs(14), borderBottomWidth: StyleSheet.hairlineWidth },
  countryName: { flex: 1, fontSize: rf(16) },
});
