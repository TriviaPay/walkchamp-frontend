import React, { useState, useEffect, useCallback } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View} from "react-native";
import { router } from "expo-router";
import { Feather } from "@expo/vector-icons";
import { useSafeLayout } from "@/hooks/useSafeLayout";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";
import { authFetch } from "@/utils/authFetch";
import { screenCache } from "@/utils/screenCache";
import { apiFetchAllowed, markApiFetched } from "@/utils/apiRequestCoordinator";
import { PROFILE_ME_CACHE_KEY } from "@/hooks/useAvatarCache";
import { TouchableOpacity } from '@/components/HapticTouchableOpacity';
import { SkeletonEditForm } from '@/components/SkeletonRows';

// Same palette used throughout the app. Not red by default (#00E676 is the first entry).
const AVATAR_COLORS = [
  "#00E676", "#00B4FF", "#FFD700",
  "#FF6B35", "#A855F7", "#F472B6",
];


interface ProfileData {
  fullName: string;
  username: string;
  country: string;
  countryFlag: string;
  bio: string;
  avatarColor: string;
}

async function fetchProfileMe(): Promise<ProfileData | null> {
  try {
    const res = await authFetch(`/api/profile/me`);
    if (!res.ok) return null;
    const json = await res.json();
    return json.data?.profile ?? null;
  } catch {
    return null;
  }
}

async function updateProfileMe(updates: Partial<ProfileData>): Promise<{ success: boolean; error?: string }> {
  try {
    const res = await authFetch(`/api/profile/me`, {
      method: "PUT",
      body: JSON.stringify(updates),
    });
    const json = await res.json();
    if (!res.ok) return { success: false, error: json.error ?? "Failed to save changes." };
    return { success: true };
  } catch {
    return { success: false, error: "Network error. Please try again." };
  }
}

export default function EditProfileScreen() {
  const colors  = useColors();
  const { safeTop, safeBottom } = useSafeLayout();
  const { refreshUserProfile } = useAuth();

  const [loading,     setLoading]     = useState(true);
  const [saving,      setSaving]      = useState(false);
  const [fullName,    setFullName]    = useState("");
  const [username,    setUsername]    = useState("");
  const [bio,         setBio]         = useState("");
  const [country,     setCountry]     = useState("");
  const [flag,        setFlag]        = useState("");
  const [avatarColor, setAvatarColor] = useState(AVATAR_COLORS[0]);

  const [usernameError, setUsernameError] = useState("");

  const applyProfileFields = useCallback((p: ProfileData) => {
    setFullName(p.fullName ?? "");
    setUsername(p.username ?? "");
    setBio(p.bio ?? "");
    setCountry(p.country ?? "");
    setFlag(p.countryFlag ?? "");
    if (p.avatarColor) {
      setAvatarColor(p.avatarColor);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const cached = screenCache.getSync<{ profile: ProfileData | null }>(PROFILE_ME_CACHE_KEY);
    if (cached?.profile) {
      applyProfileFields(cached.profile);
      setLoading(false);
    }
    void screenCache.get<{ profile: ProfileData | null }>(PROFILE_ME_CACHE_KEY).then((disk) => {
      if (cancelled || !disk?.profile) return;
      applyProfileFields(disk.profile);
      setLoading(false);
    });
    if (!apiFetchAllowed("profile_edit_me", 90_000) && cached?.profile) {
      return () => { cancelled = true; };
    }
    markApiFetched("profile_edit_me");
    fetchProfileMe().then((p) => {
      if (cancelled) return;
      if (p) applyProfileFields(p);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [applyProfileFields]);

  const validateUsername = useCallback((val: string) => {
    if (!val) { setUsernameError(""); return; }
    const re = /^[a-zA-Z][a-zA-Z0-9_]{5,13}$/;
    if (!re.test(val)) {
      setUsernameError("6-14 chars, start with a letter, letters/numbers/underscore only");
    } else {
      setUsernameError("");
    }
  }, []);

  const handleSave = async () => {
    if (usernameError) return;
    setSaving(true);
    const result = await updateProfileMe({ fullName, username, bio, avatarColor });
    setSaving(false);
    if (!result.success) {
      Alert.alert("Error", result.error ?? "Failed to save changes.");
      return;
    }
    await refreshUserProfile();
    Alert.alert("Saved!", "Your profile has been updated.", [
      { text: "OK", onPress: () => router.back() },
    ]);
  };

  if (loading) {
    return (
      <View style={[styles.loadingContainer, { backgroundColor: colors.background }]}>
        <SkeletonEditForm />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: colors.background }]}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={[styles.header, { paddingTop: safeTop + 12, borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={12} style={styles.headerBtn}>
          <Feather name="arrow-left" size={22} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>Edit Profile</Text>
        <TouchableOpacity
          onPress={handleSave}
          disabled={saving || !!usernameError}
          style={[styles.saveBtn, { backgroundColor: colors.primary, opacity: saving || !!usernameError ? 0.5 : 1 }]}
        >
          {saving ? (
            <ActivityIndicator size="small" color="#000" />
          ) : (
            <Text style={styles.saveBtnText}>Save</Text>
          )}
        </TouchableOpacity>
      </View>

      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[styles.body, { paddingBottom: safeBottom + 40 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Avatar preview */}
        {flag ? (
          <View style={styles.avatarSection}>
            <Text style={styles.flagBig}>{flag}</Text>
            <Text style={[styles.countryLabel, { color: colors.mutedForeground }]}>{country}</Text>
          </View>
        ) : null}

        {/* Full Name */}
        <View style={styles.field}>
          <Text style={[styles.label, { color: colors.mutedForeground }]}>Full Name</Text>
          <TextInput
            style={[styles.input, { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground }]}
            value={fullName}
            onChangeText={setFullName}
            placeholder="Your full name"
            placeholderTextColor={colors.mutedForeground}
            maxLength={100}
            autoCapitalize="words"
          />
        </View>

        {/* Username */}
        <View style={styles.field}>
          <Text style={[styles.label, { color: colors.mutedForeground }]}>Username</Text>
          <View style={[styles.inputRow, { backgroundColor: colors.card, borderColor: usernameError ? colors.destructive : colors.border }]}>
            <Text style={[styles.atSign, { color: colors.mutedForeground }]}>@</Text>
            <TextInput
              style={[styles.inputInner, { color: colors.foreground }]}
              value={username}
              onChangeText={(v) => { setUsername(v); validateUsername(v); }}
              placeholder="username"
              placeholderTextColor={colors.mutedForeground}
              maxLength={14}
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>
          {usernameError ? (
            <Text style={[styles.errorText, { color: colors.destructive }]}>{usernameError}</Text>
          ) : (
            <Text style={[styles.hintText, { color: colors.mutedForeground }]}>
              6-14 characters · letters, numbers, underscores
            </Text>
          )}
        </View>

        {/* Bio */}
        <View style={styles.field}>
          <Text style={[styles.label, { color: colors.mutedForeground }]}>Bio</Text>
          <TextInput
            style={[styles.bioInput, { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground }]}
            value={bio}
            onChangeText={setBio}
            placeholder="Tell the world about your walking journey..."
            placeholderTextColor={colors.mutedForeground}
            maxLength={300}
            multiline
            numberOfLines={4}
            textAlignVertical="top"
          />
          <Text style={[styles.charCount, { color: colors.mutedForeground }]}>{bio.length}/300</Text>
        </View>

        {/* Profile Color */}
        <View style={styles.field}>
          <Text style={[styles.label, { color: colors.mutedForeground }]}>Profile color</Text>
          <View style={[styles.colorCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.colorRow}>
              {AVATAR_COLORS.map((c) => (
                <TouchableOpacity
                  key={c}
                  style={[
                    styles.colorDot,
                    { backgroundColor: c },
                    avatarColor === c && {
                      borderWidth: 3,
                      borderColor: "#fff",
                      shadowColor: c,
                      shadowOffset: { width: 0, height: 0 },
                      shadowOpacity: 0.9,
                      shadowRadius: 6,
                      elevation: 6,
                    },
                  ]}
                  onPress={() => setAvatarColor(c)}
                />
              ))}
            </View>
            <Text style={[styles.colorHint, { color: colors.mutedForeground }]}>
              This color appears as your ring in Live Races, leaderboards, and chats.
            </Text>
          </View>
        </View>

        {/* Country note */}
        <View style={[styles.infoRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Feather name="info" size={15} color={colors.mutedForeground} />
          <Text style={[styles.infoText, { color: colors.mutedForeground }]}>
            To change your country, please contact support.
          </Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container:        { flex: 1 },
  loadingContainer: { flex: 1, alignItems: "center", justifyContent: "center" },
  header:           { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingBottom: 14, borderBottomWidth: StyleSheet.hairlineWidth, gap: 12 },
  headerBtn:        { width: 36, alignItems: "flex-start" },
  headerTitle:      { flex: 1, fontSize: 18, fontWeight: "700", textAlign: "center" },
  saveBtn:          { borderRadius: 10, paddingHorizontal: 18, paddingVertical: 8 },
  saveBtnText:      { fontSize: 14, fontWeight: "700", color: "#000" },
  body:             { padding: 20, gap: 24 },
  avatarSection:    { alignItems: "center", gap: 6, marginBottom: 4 },
  flagBig:          { fontSize: 48 },
  countryLabel:     { fontSize: 14 },
  field:            { gap: 8 },
  label:            { fontSize: 13, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.5 },
  input:            { borderRadius: 12, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 13, fontSize: 16 },
  inputRow:         { flexDirection: "row", alignItems: "center", borderRadius: 12, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 13, gap: 4 },
  atSign:           { fontSize: 16 },
  inputInner:       { flex: 1, fontSize: 16 },
  bioInput:         { borderRadius: 12, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 13, fontSize: 15, minHeight: 100 },
  charCount:        { fontSize: 12, textAlign: "right", marginTop: -4 },
  errorText:        { fontSize: 12 },
  hintText:         { fontSize: 12 },
  infoRow:          { flexDirection: "row", alignItems: "center", gap: 10, borderRadius: 12, borderWidth: 1, padding: 14 },
  infoText:         { flex: 1, fontSize: 13, lineHeight: 18 },
  colorCard:        { borderRadius: 12, borderWidth: 1, padding: 14, gap: 10 },
  colorRow:         { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  colorDot:         { width: 36, height: 36, borderRadius: 18 },
  colorHint:        { fontSize: 12, lineHeight: 17 },
});
