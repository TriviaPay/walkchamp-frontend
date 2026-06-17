import { LinearGradient } from "expo-linear-gradient";
import { router, useLocalSearchParams } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
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
import { createProfile, checkUsernameAvailable, fetchMe, getStoredSession, getValidSession } from "@/services/authService";
import { dbProfileToUserProfile } from "@/utils/profileMapper";
import { COUNTRIES } from "@/constants/countries";
import { DateOfBirthInput } from "@/components/DateOfBirthInput";
import { TouchableOpacity } from '@/components/HapticTouchableOpacity';
import { rf, rs, MAX_CONTENT_WIDTH } from "@/utils/responsive";

const USERNAME_RE = /^[a-zA-Z][a-zA-Z0-9_]{5,13}$/;
const BLOCKED = ["admin","support","official","system","moderator","walkchamp","walk_champ","staff"];
function usernameBlocked(u: string) { return BLOCKED.some((b) => u.toLowerCase().replace(/_/g,"").includes(b)); }
const AVATAR_COLORS = ["#00E676","#00B4FF","#06B6D4","#FFD700","#FF6B35","#A855F7","#F472B6","#34D399"];

function calcAge(dob: string): number {
  const birth = new Date(dob);
  if (isNaN(birth.getTime())) return 0;
  const today = new Date();
  let age = today.getFullYear() - birth.getFullYear();
  const m = today.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
  return age;
}

export default function CompleteProfileScreen() {
  const colors = useColors();
  const { insets, safeTop, safeBottom } = useSafeLayout();
  const { login } = useAuth();
  const params = useLocalSearchParams<{
    userId: string;
    email: string;
    authProvider?: string;
    sessionToken?: string;
    refreshToken?: string;
  }>();

  const [fullName, setFullName] = useState("");
  const [username, setUsername] = useState("");
  const [dob, setDob] = useState("");
  const [selectedCountry, setSelectedCountry] = useState<typeof COUNTRIES[0] | null>(null);
  const [avatarColor, setAvatarColor] = useState(AVATAR_COLORS[0]);
  const [showCountryPicker, setShowCountryPicker] = useState(false);
  const [countrySearch, setCountrySearch] = useState("");
  const [usernameStatus, setUsernameStatus] = useState<"idle"|"checking"|"available"|"taken"|"invalid">("idle");
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [privacyAccepted, setPrivacyAccepted] = useState(false);
  const [rewardAccepted, setRewardAccepted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const usernameTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  const usernameColor = usernameStatus === "available" ? "#00E676" : usernameStatus === "taken" || usernameStatus === "invalid" ? "#FF4444" : colors.mutedForeground;

  async function handleSubmit() {
    setError("");
    if (!fullName.trim()) { setError("Full name is required."); return; }
    if (usernameStatus !== "available") { setError("Please choose a valid, available username."); return; }
    if (!dob) { setError("Date of birth is required."); return; }
    if (calcAge(dob) < 13) { setError("You must be at least 13 years old."); return; }
    if (!selectedCountry) { setError("Please select your country."); return; }
    if (!termsAccepted || !privacyAccepted || !rewardAccepted) { setError("Please accept all required agreements."); return; }

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setSubmitting(true);
    try {
      // Resolve session JWT: prefer params (set by login/signup screens),
      // fall back to SecureStore (set when app/index.tsx redirects here after
      // a cold-start session restore without forwarding the token in params).
      let sessionJwt = params.sessionToken ?? "";
      let refreshJwt = params.refreshToken ?? "";
      if (!sessionJwt) {
        const stored = await getStoredSession();
        sessionJwt = (await getValidSession()) ?? stored.session ?? "";
        refreshJwt = stored.refresh ?? "";
      }

      if (!sessionJwt) {
        setError("Session expired. Please sign in again.");
        router.replace("/(auth)");
        return;
      }

      await createProfile(
        {
          descopeUserId: params.userId,
          email: params.email,
          fullName: fullName.trim(),
          username: username.toLowerCase().trim(),
          dateOfBirth: dob,
          country: selectedCountry.name,
          countryCode: selectedCountry.code,
          countryFlag: selectedCountry.flag,
          authProvider: params.authProvider ?? "email",
          avatarColor,
          termsAccepted,
          privacyAccepted,
          rewardDisclaimerAccepted: rewardAccepted,
          marketingOptIn: false,
        },
        sessionJwt,
      );

      // Always update Redux with the freshly-created profile so that
      // app/index.tsx sees profileComplete: true and stops redirecting here.
      const profile = await fetchMe(sessionJwt);
      if (profile) {
        const userProfile = dbProfileToUserProfile(profile);
        await login(userProfile, sessionJwt, refreshJwt);

        // Route based on actual email-verified status, not a fixed destination.
        // Email-login users are already verified; OTP users still need to verify.
        if (userProfile.emailVerified) {
          router.replace("/(tabs)/walk");
        } else {
          router.replace({
            pathname: "/(auth)/verify-email",
            params: { email: params.email, userId: params.userId, sessionToken: sessionJwt, refreshToken: refreshJwt },
          });
        }
      } else {
        // Profile created but fetchMe returned nothing — unusual, send to login
        router.replace("/(auth)");
      }
    } catch (e) {
      const err = e as { message?: string };
      if (err.message === "username_taken") setError("That username was just taken. Please choose another.");
      else if (err.message === "email_taken") setError("This email is already registered.");
      else setError("Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  const filteredCountries = COUNTRIES.filter((c) => c.name.toLowerCase().includes(countrySearch.toLowerCase()));

  const CheckBox = ({ value, onToggle, label }: { value: boolean; onToggle: () => void; label: string }) => (
    <TouchableOpacity style={styles.checkRow} onPress={onToggle} activeOpacity={0.7}>
      <View style={[styles.checkbox, { borderColor: value ? colors.primary : colors.border, backgroundColor: value ? colors.primary + "20" : "transparent" }]}>
        {value && <Feather name="check" size={12} color={colors.primary} />}
      </View>
      <Text style={[styles.checkLabel, { color: colors.foreground }]}>{label}</Text>
    </TouchableOpacity>
  );

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={styles.flex}>
        <ScrollView contentContainerStyle={[styles.scroll, { paddingTop: safeTop + 20, paddingBottom: safeBottom + 30 }]} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <Text style={[styles.title, { color: colors.foreground }]}>Complete Profile</Text>
          <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>Just a few details to get you started</Text>

          {!!error && (
            <View style={[styles.errorBox, { backgroundColor: "#FF444420", borderColor: "#FF444450" }]}>
              <Feather name="alert-circle" size={14} color="#FF4444" />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}

          <View style={styles.form}>
            <View>
              <Text style={[styles.label, { color: colors.mutedForeground }]}>Full legal name *</Text>
              <View style={[styles.inputContainer, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <Feather name="user" size={18} color={colors.mutedForeground} />
                <TextInput style={[styles.input, { color: colors.foreground }]} placeholder="Your full name" placeholderTextColor={colors.mutedForeground} value={fullName} onChangeText={setFullName} autoCapitalize="words" />
              </View>
            </View>

            <View>
              <Text style={[styles.label, { color: colors.mutedForeground }]}>Username *</Text>
              <View style={[styles.inputContainer, { backgroundColor: colors.card, borderColor: usernameStatus === "available" ? "#00E67660" : usernameStatus === "taken" || usernameStatus === "invalid" ? "#FF444460" : colors.border }]}>
                <Feather name="at-sign" size={18} color={colors.mutedForeground} />
                <TextInput style={[styles.input, { color: colors.foreground }]} placeholder="unique_name (6–14 chars)" placeholderTextColor={colors.mutedForeground} value={username} onChangeText={(t) => setUsername(t.replace(/\s/g, ""))} autoCapitalize="none" autoCorrect={false} maxLength={14} />
                {usernameStatus === "checking" && <ActivityIndicator size="small" color={colors.primary} />}
                {usernameStatus === "available" && <Feather name="check-circle" size={18} color="#00E676" />}
                {(usernameStatus === "taken" || usernameStatus === "invalid") && <Feather name="x-circle" size={18} color="#FF4444" />}
              </View>
              {usernameStatus !== "idle" && (
                <Text style={[styles.fieldHint, { color: usernameColor }]}>
                  {usernameStatus === "available" ? "Username is available!" : usernameStatus === "taken" ? "This username is already taken." : "6–14 chars, letters/numbers/underscore, must start with a letter."}
                </Text>
              )}
            </View>

            <View>
              <Text style={[styles.label, { color: colors.mutedForeground }]}>Date of birth *</Text>
              <DateOfBirthInput value={dob} onChange={setDob} />
            </View>

            <View>
              <Text style={[styles.label, { color: colors.mutedForeground }]}>Country *</Text>
              <TouchableOpacity
                style={[styles.inputContainer, { backgroundColor: colors.card, borderColor: selectedCountry ? colors.border : "#FF444450" }]}
                onPress={() => setShowCountryPicker(true)}
              >
                {selectedCountry ? (
                  <>
                    <Text style={{ fontSize: 20 }}>{selectedCountry.flag}</Text>
                    <Text style={[styles.input, { color: colors.foreground }]}>{selectedCountry.name}</Text>
                  </>
                ) : (
                  <>
                    <Feather name="globe" size={18} color={colors.mutedForeground} />
                    <Text style={[styles.input, { color: colors.mutedForeground }]}>Select your country</Text>
                  </>
                )}
                <Feather name="chevron-down" size={18} color={colors.mutedForeground} />
              </TouchableOpacity>
            </View>

            <View>
              <Text style={[styles.label, { color: colors.mutedForeground }]}>Avatar color</Text>
              <View style={styles.colorRow}>
                {AVATAR_COLORS.map((c) => (
                  <TouchableOpacity key={c} style={[styles.colorDot, { backgroundColor: c }, avatarColor === c && styles.colorDotSelected]} onPress={() => setAvatarColor(c)} />
                ))}
              </View>
            </View>

            <View style={[styles.divider, { backgroundColor: colors.border }]} />
            <CheckBox value={termsAccepted} onToggle={() => setTermsAccepted((v) => !v)} label="I agree to the Terms & Conditions *" />
            <CheckBox value={privacyAccepted} onToggle={() => setPrivacyAccepted((v) => !v)} label="I agree to the Privacy Policy *" />
            <CheckBox value={rewardAccepted} onToggle={() => setRewardAccepted((v) => !v)} label="I understand rewards are subject to verification *" />

            <TouchableOpacity style={[styles.submitBtn, { opacity: submitting ? 0.7 : 1 }]} onPress={handleSubmit} disabled={submitting}>
              <LinearGradient colors={[colors.primary, colors.accent]} style={styles.submitGradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}>
                {submitting ? <ActivityIndicator color="#000000" /> : <>
                  <Text style={[styles.submitText, { color: "#000000" }]}>Start Walking</Text>
                  <Feather name="chevrons-right" size={20} color="#000000" />
                </>}
              </LinearGradient>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      {showCountryPicker && (
        <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.background, zIndex: 999 }]}>
          <View style={[styles.modalHeader, { paddingTop: safeTop + 12, borderBottomColor: colors.border }]}>
            <Text style={[styles.modalTitle, { color: colors.foreground }]}>Select Country</Text>
            <TouchableOpacity onPress={() => setShowCountryPicker(false)}>
              <Feather name="x" size={22} color={colors.foreground} />
            </TouchableOpacity>
          </View>
          <View style={[styles.searchBox, { backgroundColor: colors.card, borderColor: colors.border, margin: 16 }]}>
            <Feather name="search" size={16} color={colors.mutedForeground} />
            <TextInput style={[styles.input, { color: colors.foreground }]} placeholder="Search country..." placeholderTextColor={colors.mutedForeground} value={countrySearch} onChangeText={setCountrySearch} />
          </View>
          <ScrollView keyboardShouldPersistTaps="handled">
            {filteredCountries.map((item) => (
              <TouchableOpacity key={item.code} style={[styles.countryRow, { borderBottomColor: colors.border }]} onPress={() => { setSelectedCountry(item); setShowCountryPicker(false); setCountrySearch(""); }}>
                <Text style={{ fontSize: 22 }}>{item.flag}</Text>
                <Text style={[styles.countryName, { color: colors.foreground }]}>{item.name}</Text>
                {selectedCountry?.code === item.code && <Feather name="check" size={18} color={colors.primary} />}
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
  title: { fontSize: rf(28), fontWeight: "800", letterSpacing: -0.5 },
  subtitle: { fontSize: rf(15), marginTop: 6, marginBottom: rs(20) },
  form: { gap: rs(16) },
  label: { fontSize: rf(13), fontWeight: "600", marginBottom: 6 },
  inputContainer: { flexDirection: "row", alignItems: "center", gap: 12, borderRadius: 14, borderWidth: 1, paddingHorizontal: rs(16), paddingVertical: rs(14) },
  input: { flex: 1, fontSize: rf(16) },
  fieldHint: { fontSize: rf(12), marginTop: 4, marginLeft: 4 },
  errorBox: { flexDirection: "row", alignItems: "center", gap: 8, borderRadius: 10, borderWidth: 1, paddingHorizontal: rs(12), paddingVertical: rs(10), marginBottom: 4 },
  errorText: { color: "#FF4444", fontSize: rf(13), flex: 1 },
  colorRow: { flexDirection: "row", gap: 12 },
  colorDot: { width: rs(34), height: rs(34), borderRadius: rs(17) },
  colorDotSelected: { borderWidth: 3, borderColor: "#FFFFFF" },
  divider: { height: 1 },
  checkRow: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  checkbox: { width: rs(22), height: rs(22), borderRadius: 6, borderWidth: 1.5, alignItems: "center", justifyContent: "center", marginTop: 1 },
  checkLabel: { fontSize: rf(14), lineHeight: 22, flex: 1 },
  submitBtn: { borderRadius: 14, overflow: "hidden", marginTop: 8 },
  submitGradient: { paddingVertical: rs(16), flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  submitText: { fontSize: rf(17), fontWeight: "700" },
  modalHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 20, paddingBottom: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  modalTitle: { fontSize: rf(18), fontWeight: "700" },
  searchBox: { flexDirection: "row", alignItems: "center", gap: 10, borderRadius: 12, borderWidth: 1, paddingHorizontal: rs(14), paddingVertical: rs(10) },
  countryRow: { flexDirection: "row", alignItems: "center", gap: 14, paddingHorizontal: 20, paddingVertical: rs(14), borderBottomWidth: StyleSheet.hairlineWidth },
  countryName: { flex: 1, fontSize: rf(16) },
});
