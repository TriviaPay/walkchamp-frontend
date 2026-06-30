import { LinearGradient } from "expo-linear-gradient";
import { getApiBase } from "@/utils/apiUrl";
import { router, useFocusEffect } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import React, { useState, useCallback, useEffect, useRef } from "react";
import {
  ActivityIndicator,
  Animated,
  Image,
  KeyboardAvoidingView,
  Linking,
  Platform,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View} from "react-native";
import { AppAlert } from "@/components/AppAlert";
import { dynamicIconService } from "@/services/dynamicIconService";
import CoinIcon from "@/components/CoinIcon";
import { AvatarPickerSheet } from "@/components/AvatarPickerSheet";
import { useSafeLayout } from "@/hooks/useSafeLayout";
import { SkeletonInlineEditForm } from "@/components/SkeletonRows";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "@/utils/haptics";
import { useColors } from "@/hooks/useColors";
import { useTheme } from "@/context/ThemeContext";
import { useSound } from "@/context/SoundContext";
import { useAuth } from "@/context/AuthContext";
import { useWalk } from "@/context/WalkContext";
import { useApp } from "@/context/AppContext";
import { BadgePill } from "@/components/BadgePill";
import { formatDistance, stepsToDistance } from "@/utils/format";
import { getStoredSession } from "@/services/authService";
import { authFetch } from "@/utils/authFetch";
import {
  getNotificationPreferences,
  setNotificationPreferences,
  initOneSignal,
  requestNotificationPermission,
  optInNotifications,
  optOutNotifications,
  registerDeviceWithBackend,
} from "@/services/notificationService";
import { useAppSelector, useAppDispatch } from "@/store/hooks";
import { fetchCoinBalance } from "@/store/slices/coinsSlice";
import { TouchableOpacity } from '@/components/HapticTouchableOpacity';
import { rf, rs } from "@/utils/responsive";
import MyTitlesModal, { type ActiveTitle, difficultyColor } from "@/components/MyTitlesModal";
import WearableSetupModal from "@/components/WearableSetupModal";
import { useTitleUnlock } from "@/context/TitleUnlockContext";

const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? "";

// iOS can report HEIC as the mimeType even when quality<1 converts data to JPEG.
// Normalize it so the server always receives a recognised image type.
function normalizeMime(mime: string | null | undefined): string {
  if (!mime) return "image/jpeg";
  const lower = mime.toLowerCase();
  if (lower === "image/heic" || lower === "image/heif") return "image/jpeg";
  return lower;
}

// ── Types ─────────────────────────────────────────────────────────────────────
interface ServerStats {
  level: number;
  levelTitle: string;
  xp: number;
  currentLevelXP: number;
  nextLevelXP: number;
  progressPercent: number;
  totalRaces: number;
  racesWon: number;
  top3Finishes: number;
  winRate: number;
  allTimeSteps: number;
  dayStreak: number;
  dailyRank: number | null;
  coinsEarned: number; }

interface ChallengeHistoryItem {
  id: string;
  title: string;
  type: string;
  entryType: string;
  targetSteps: number;
  participantStatus: string;
  rank: number | null;
  prizeAmountCents: number;
  completedAt: string | null;
}

interface ProfileData {
  fullName: string;
  username: string;
  country: string;
  countryFlag: string;
  bio: string;
  avatarColor: string; }

// ── API helpers ───────────────────────────────────────────────────────────────

async function fetchServerStats(): Promise<ServerStats | null> {
  try {
    const res = await authFetch(`/api/profile/me`);
    if (!res.ok) return null;
    const json = await res.json();
    return json.data?.stats ?? null;
  } catch {
    return null;
  }
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

// ── Constants ─────────────────────────────────────────────────────────────────
const BADGES = [
  { name: "Beginner Walker",  icon: "activity",  threshold: 0 },
  { name: "Fast Walker",      icon: "zap",       threshold: 50000 },
  { name: "Daily Champion",   icon: "star",      threshold: 100000 },
  { name: "Weekly Champion",  icon: "award",     threshold: 500000 },
  { name: "Country Champion", icon: "flag",      threshold: 1000000 },
  { name: "Global Champion",  icon: "globe",     threshold: 5000000 },
  { name: "Legend Walker",    icon: "star",      threshold: 10000000 },
];

const LEVELS = [
  { level: 1,  title: "Rookie Walker",    xpNeeded: 0 },
  { level: 5,  title: "Fast Walker",      xpNeeded: 500 },
  { level: 10, title: "Race Pro",         xpNeeded: 1500 },
  { level: 20, title: "Country Champion", xpNeeded: 5000 },
  { level: 50, title: "Global Legend",    xpNeeded: 20000 },
];

function computeLevel(totalSteps: number) {
  const xp = Math.floor(totalSteps / 100);
  const lvl = Math.min(99, Math.floor(Math.sqrt(xp / 2)) + 1);
  const xpForNext = Math.pow(lvl, 2) * 2;
  const xpForCurrent = Math.pow(lvl - 1, 2) * 2;
  const progress = xp < xpForNext ? (xp - xpForCurrent) / (xpForNext - xpForCurrent) : 1;
  const levelData = LEVELS.slice().reverse().find((l) => lvl >= l.level) ?? LEVELS[0];
  return { level: lvl, xp, xpForNext, progress: Math.min(progress, 1), title: levelData.title }; }

// ── Inline sub-components ──────────────────────────────────────────────────────

function WearableStatusCard({
  stepSource, onSetupPress, colors: c,
}: {
  stepSource: { platform: string; permissionStatus: string; setupCompleted: boolean } | null;
  onSetupPress: () => void;
  colors: ReturnType<typeof useColors>;
}) {
  const isConnected = stepSource?.permissionStatus === "connected";
  const isDenied    = stepSource?.permissionStatus === "denied";
  const sourceName  =
    stepSource?.platform === "ios_healthkit"         ? "Apple Health"    :
    stepSource?.platform === "android_health_connect" ? "Health Connect"  :
    Platform.OS === "ios"                             ? "Apple Health"    : "Health Connect";

  return (
    <TouchableOpacity
      style={[wsCard.card, {
        backgroundColor: isConnected ? "#00E67610" : isDenied ? c.destructive + "10" : c.card,
        borderColor:     isConnected ? "#00E67635" : isDenied ? c.destructive + "30" : c.border,
      }]}
      onPress={onSetupPress}
      activeOpacity={0.8}
    >
      <View style={[wsCard.dot, { backgroundColor: isConnected ? "#00E676" : isDenied ? c.destructive : "#FFD700" }]} />
      <View style={{ flex: 1 }}>
        <Text style={[wsCard.title, { color: c.foreground }]}>
          {isConnected ? "Step tracking connected" : isDenied ? "Steps permission denied" : "Set up step tracking"}
        </Text>
        <Text style={[wsCard.sub, { color: c.mutedForeground }]}>
          {isConnected
            ? `${sourceName} is syncing with Walk Champ.`
            : isDenied
            ? "Tap to restore permissions."
            : `Tap to connect ${sourceName}`}
        </Text>
      </View>
      <Feather name="chevron-right" size={16} color={c.mutedForeground} />
    </TouchableOpacity>
  );
}

const wsCard = StyleSheet.create({
  card:  { flexDirection: "row", alignItems: "center", gap: 12, borderRadius: 14, borderWidth: 1, padding: 14, marginBottom: 20 },
  dot:   { width: 8, height: 8, borderRadius: 4, flexShrink: 0 },
  title: { fontSize: rf(14), fontWeight: "700" },
  sub:   { fontSize: rf(12), marginTop: 2, lineHeight: 17 },
});

function ChallengeHistoryRow({
  item, colors: c, isLast,
}: {
  item: ChallengeHistoryItem;
  colors: ReturnType<typeof useColors>;
  isLast: boolean;
}) {
  const rankColor = item.rank === 1 ? c.gold : item.rank === 2 ? "#C0C0C0" : item.rank === 3 ? "#CD7F32" : c.mutedForeground;
  const rankLabel = item.rank === 1 ? "🥇 1st" : item.rank === 2 ? "🥈 2nd" : item.rank === 3 ? "🥉 3rd" : item.rank ? `#${item.rank}` : "—";
  const typeLabel =
    item.entryType === "coins_battle" ? "⚡ Coins Battle"                          :
    item.entryType === "free"         ? "🆓 Free"                                  :
    item.type      === "sponsored"    ? "🎁 Sponsored"                             :
    `💰 Paid`;

  return (
    <View style={[chRow.row, !isLast && { borderBottomColor: c.border, borderBottomWidth: StyleSheet.hairlineWidth }]}>
      <View style={{ flex: 1 }}>
        <Text style={[chRow.title, { color: c.foreground }]} numberOfLines={1}>{item.title}</Text>
        <Text style={[chRow.meta, { color: c.mutedForeground }]}>
          {typeLabel} · {item.targetSteps.toLocaleString()} steps
          {item.completedAt ? ` · ${new Date(item.completedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}` : ""}
        </Text>
      </View>
      <Text style={[chRow.rank, { color: rankColor }]}>{rankLabel}</Text>
    </View>
  );
}

const chRow = StyleSheet.create({
  row:   { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 13, gap: 12 },
  title: { fontSize: rf(14), fontWeight: "600" },
  meta:  { fontSize: rf(12), marginTop: 2 },
  rank:  { fontSize: rf(14), fontWeight: "700" },
});

// ── Sub-components ────────────────────────────────────────────────────────────
function StatBox({ label, value, color }: { label: string; value: string; color?: string }) {
  const colors = useColors();
  return (
    <View style={[styles.statBox, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <Text style={[styles.statBoxValue, { color: color ?? colors.foreground }]}>{value}</Text>
      <Text style={[styles.statBoxLabel, { color: colors.mutedForeground }]}>{label}</Text>
    </View>
  ); }

function AchievementCard({ icon, label, value, color }: { icon: string; label: string; value: string; color: string }) {
  const colors = useColors();
  return (
    <View style={[styles.achievCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={[styles.achievIcon, { backgroundColor: color + "20" }]}>
        <Feather name={icon as never} size={20} color={color} />
      </View>
      <Text style={[styles.achievValue, { color: colors.foreground }]}>{value}</Text>
      <Text style={[styles.achievLabel, { color: colors.mutedForeground }]}>{label}</Text>
    </View>
  ); }

// ── Main Screen ───────────────────────────────────────────────────────────────
export default function ProfileScreen() {
  const colors = useColors();
  const { insets, safeTop, safeBottom } = useSafeLayout();
  const { user, logout, refreshUserProfile, updateUser } = useAuth();
  const { allTimeSteps, currentStreak, weeklySteps, requestStepPermission } = useWalk();
  const { userRank } = useApp();

  // Profile view state
  const [serverStats,       setServerStats]       = useState<ServerStats | null>(null);
  const [showTitlesModal,   setShowTitlesModal]   = useState(false);
  const [activeTitle,       setActiveTitle]       = useState<ActiveTitle | null>(null);
  const [challengeHistory,  setChallengeHistory]  = useState<ChallengeHistoryItem[]>([]);
  const [last7Days,         setLast7Days]         = useState<{ date: string; steps: number }[]>([]);
  const [stepSourceInfo,    setStepSourceInfo]    = useState<{ platform: string; permissionStatus: string; setupCompleted: boolean } | null>(null);
  const [showWearableSetup, setShowWearableSetup] = useState(false);
  const [deleteLoading,     setDeleteLoading]     = useState(false);

  // Inline edit state
  const [isEditing,      setIsEditing]      = useState(false);
  const [editLoading,    setEditLoading]    = useState(false);
  const [saving,         setSaving]         = useState(false);
  const [fullName,       setFullName]       = useState("");
  const [username,       setUsername]       = useState("");
  const [country,        setCountry]        = useState("");
  const [countryFlag,    setCountryFlag]    = useState("");
  const [usernameError,  setUsernameError]  = useState("");

  // Push notifications state
  const [pushEnabled, setPushEnabled] = useState<boolean>(true);
  const [pushLoading, setPushLoading] = useState(false);

  // Dynamic app icon state
  const [dynIconEnabled, setDynIconEnabled] = useState<boolean>(true);
  useEffect(() => {
    dynamicIconService.isEnabled().then(setDynIconEnabled).catch(() => {});
  }, []);

  const handlePushToggle = useCallback(async (value: boolean) => {
    if (pushLoading) return;
    setPushLoading(true);
    try {
      if (value) {
        if (user?.id) {
          await initOneSignal(user.id);
        }
        // Request permission first — if denied, keep toggle off
        const granted = await requestNotificationPermission();
        if (!granted) {
          AppAlert.alert(
            "Notifications Blocked",
            "Please enable notifications in your device settings to receive updates.",
            [
              { text: "Open Settings", onPress: () => Linking.openSettings() },
              { text: "Cancel" },
            ],
          );
          setPushLoading(false);
          return;
        }
        await optInNotifications();
        await setNotificationPreferences(true);
        await registerDeviceWithBackend();
        setPushEnabled(true);
      } else {
        await optOutNotifications();
        await setNotificationPreferences(false);
        setPushEnabled(false);
      }
    } catch {
      // Best-effort
    } finally {
      setPushLoading(false);
    }
  }, [pushLoading, user?.id]);

  // Achievement title unlocks — global modal popup across all screens
  const { triggerUnlocks, lastEquipped } = useTitleUnlock();

  // Sync profile active title when user equips from the global unlock modal
  useEffect(() => {
    if (lastEquipped) setActiveTitle(lastEquipped);
  }, [lastEquipped]);

  // Coins state — sourced from Redux (fetchCoinBalance dispatched in useFocusEffect)
  const dispatch = useAppDispatch();
  const reduxBalance = useAppSelector((s) => s.coins.balance);
  const coinData = reduxBalance
    ? { currentBalance: reduxBalance.currentBalance, lifetimeEarned: reduxBalance.lifetimeEarned, lifetimeSpent: reduxBalance.lifetimeSpent, earnedToday: reduxBalance.earnedToday }
    : null;

  // Settings toggles — vibration is global, persisted via SoundContext
  const { soundEnabled, setSoundEnabled } = useSound();
  const { isDark: darkTheme, toggleTheme } = useTheme();

  // Avatar — local URI after pick (optimistic), falls back to server URL
  const [avatarUri,        setAvatarUri]        = useState<string | null>(null);
  const [uploadingAvatar,  setUploadingAvatar]  = useState(false);
  const [showAvatarPicker, setShowAvatarPicker] = useState(false);

  // Animate edit panel
  const editAnim = useRef(new Animated.Value(0)).current;

  // ── Upload avatar to server ──────────────────────────────────────────────────
  const uploadAvatarToServer = useCallback(async (uri: string, mimeType: string) => {
    try {
      setUploadingAvatar(true);
      const { session } = await getStoredSession();
      if (!session) return;

      const formData = new FormData();
      const ext = mimeType.split("/")[1] ?? "jpg";
      if (Platform.OS === "web") {
        const blobRes = await fetch(uri);
        const blob = await blobRes.blob();
        formData.append("avatar", blob, `avatar.${ext}`);
      } else {
        formData.append("avatar", { uri, name: `avatar.${ext}`, type: mimeType } as unknown as Blob);
      }

      // Use XMLHttpRequest instead of fetch for native platforms.
      // fetch+FormData silently drops file bytes on iOS (file:// URI reading
      // goes through a different bridge path), while XHR uses the native
      // file system APIs and works correctly on both iOS and Android.
      const url = `${API_BASE}/api/profile/me/avatar`;
      const json = await (Platform.OS === "web"
        ? fetch(url, { method: "POST", headers: { Authorization: `Bearer ${session}` }, body: formData }).then((r) => r.json())
        : new Promise<Record<string, unknown>>((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open("POST", url);
            xhr.setRequestHeader("Authorization", `Bearer ${session}`);
            xhr.onload = () => { try { resolve(JSON.parse(xhr.responseText)); } catch { reject(new Error("Bad response")); } };
            xhr.onerror = () => reject(new Error("Network error"));
            xhr.send(formData);
          }));
      if (json.success && (json.displayUrl || json.avatarUrl)) {
        if (__DEV__ && Platform.OS === "ios") console.log("[iOS Avatar] Upload success:", json.displayUrl ?? json.avatarUrl);
        // Cache-bust so React Native Image re-fetches the new photo
        const newUrl = `${getApiBase()}${json.displayUrl ?? json.avatarUrl}?t=${Date.now()}`;
        if (__DEV__ && Platform.OS === "ios") console.log("[iOS Avatar] Updated profile image URL:", newUrl);
        setAvatarUri(newUrl);
        // Immediately sync Redux so every other screen (leaderboard, race, walk tab)
        // knows the user now has an avatar without waiting for a full profile refresh.
        updateUser({ profileImageUrl: json.avatarUrl ?? json.displayUrl, avatarVersion: Date.now() });
        refreshUserProfile()
          .then(() => { if (__DEV__ && Platform.OS === "ios") console.log("[iOS Avatar] Profile refetch success"); })
          .catch(() => {});
      } else {
        AppAlert.alert("Upload Failed", "Could not save your photo. Please try again.");
      }
    } catch {
      AppAlert.alert("Upload Failed", "Network error. Please try again.");
    } finally {
      setUploadingAvatar(false);
    }
  }, [refreshUserProfile, updateUser]);

  // ── Remove avatar from server ────────────────────────────────────────────────
  const handleRemoveAvatar = useCallback(async () => {
    try {
      setUploadingAvatar(true);
      const res = await authFetch(`/api/profile/me/avatar`, { method: "DELETE" });
      const json = await res.json();
      if (json.success) {
        setAvatarUri(null);
        // Bump avatarVersion so every cached avatar URL instantly becomes stale
        updateUser({ profileImageUrl: null, avatarVersion: json.avatarVersion ?? Date.now() });
        refreshUserProfile().catch(() => {});
      } else {
        AppAlert.alert("Error", "Could not remove photo. Please try again.");
      }
    } catch {
      AppAlert.alert("Error", "Network error. Please try again.");
    } finally {
      setUploadingAvatar(false);
    }
  }, [refreshUserProfile, updateUser]);

  // ── Camera permission + photo picker ────────────────────────────────────────
  const handleTakePhoto = useCallback(async () => {
    if (__DEV__ && Platform.OS === "ios") console.log("[iOS Avatar] Modal option selected: Take Photo");
    if (__DEV__ && Platform.OS === "ios") console.log("[iOS Avatar] Permission requested: camera");
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (__DEV__ && Platform.OS === "ios") console.log("[iOS Avatar] Permission status:", perm.status, "granted:", perm.granted);
    if (!perm.granted) {
      AppAlert.alert(
        "Permission Required",
        "Please allow camera access to take a profile picture.",
        [{ text: "Cancel", style: "cancel" }, { text: "Open Settings", onPress: () => Linking.openSettings() }]
      );
      return;
    }
    try {
      if (__DEV__ && Platform.OS === "ios") console.log("[iOS Avatar] Picker launched: camera");
      const result = await ImagePicker.launchCameraAsync({
        mediaTypes: ["images"],
        // allowsEditing crashes silently on iOS with New Architecture (newArchEnabled: true) in Expo SDK 54
        allowsEditing: Platform.OS !== "ios",
        aspect: [1, 1],
        quality: 0.8,
        exif: false,
      });
      if (result.canceled) {
        if (__DEV__ && Platform.OS === "ios") console.log("[iOS Avatar] Picker cancelled: camera");
        return;
      }
      if (result.assets[0]?.uri) {
        const asset = result.assets[0];
        const mime = normalizeMime(asset.mimeType);
        if (__DEV__ && Platform.OS === "ios") console.log("[iOS Avatar] Selected asset URI:", asset.uri);
        setAvatarUri(asset.uri);
        if (__DEV__ && Platform.OS === "ios") console.log("[iOS Avatar] Upload started");
        uploadAvatarToServer(asset.uri, mime);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.toLowerCase().includes("camera not available")) {
        AppAlert.alert("Camera Unavailable", "Your device does not have an accessible camera.");
      } else {
        AppAlert.alert("Error", "Could not open camera. Please try again.");
      }
    }
  }, [uploadAvatarToServer]);

  const handleChooseFromLibrary = useCallback(async () => {
    if (__DEV__ && Platform.OS === "ios") console.log("[iOS Avatar] Modal option selected: Choose from Library");
    if (__DEV__ && Platform.OS === "ios") console.log("[iOS Avatar] Permission requested: photo library");
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    // "limited" means the user granted access to selected photos only — still valid on iOS 14+
    // Cast to string because expo-image-picker types don't expose "limited" but iOS returns it at runtime.
    if (__DEV__ && Platform.OS === "ios") console.log("[iOS Avatar] Permission status:", perm.status, "granted:", perm.granted);
    if (!perm.granted && (perm.status as string) !== "limited") {
      AppAlert.alert(
        "Permission Required",
        "Please allow photo library access to choose a profile picture.",
        [{ text: "Cancel", style: "cancel" }, { text: "Open Settings", onPress: () => Linking.openSettings() }]
      );
      return;
    }
    if (Platform.OS === "ios" && (perm.status as string) === "limited") {
      if (__DEV__) console.log("[iOS Avatar] Permission status: limited — proceeding with restricted access");
    }
    try {
      if (__DEV__ && Platform.OS === "ios") console.log("[iOS Avatar] Picker launched: image library");
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        // allowsEditing crashes silently on iOS with New Architecture (newArchEnabled: true) in Expo SDK 54
        allowsEditing: Platform.OS !== "ios",
        aspect: [1, 1],
        quality: 0.8,
        exif: false,
      });
      if (result.canceled) {
        if (__DEV__ && Platform.OS === "ios") console.log("[iOS Avatar] Picker cancelled: image library");
        return;
      }
      if (result.assets[0]?.uri) {
        const asset = result.assets[0];
        const mime = normalizeMime(asset.mimeType);
        if (__DEV__ && Platform.OS === "ios") console.log("[iOS Avatar] Selected asset URI:", asset.uri);
        setAvatarUri(asset.uri);
        if (__DEV__ && Platform.OS === "ios") console.log("[iOS Avatar] Upload started");
        uploadAvatarToServer(asset.uri, mime);
      }
    } catch (err: unknown) {
      AppAlert.alert("Error", "Could not open photo library. Please try again.");
    }
  }, [uploadAvatarToServer]);

  const handleAvatarPress = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setShowAvatarPicker(true);
  }, []);

  // Seed local avatar URI from server — proxy URL is always accessible via the Replit reverse proxy.
  // Only seed when the user has an avatar recorded (profileImageUrl != null).
  // Skip while an upload is in progress to avoid overwriting the optimistic preview.
  useEffect(() => {
    if (uploadingAvatar) return;
    setAvatarUri(
      user?.id
        ? `${getApiBase()}/api/profile/avatar/${user.id}?v=${user.avatarVersion ?? ""}`
        : null,
    );
  }, [user?.id, user?.profileImageUrl, user?.avatarVersion, uploadingAvatar]);

  useFocusEffect(
    useCallback(() => {
      (async () => {
        const [stats, profileData] = await Promise.all([
          fetchServerStats(),
          fetchProfileMe(),
        ]);
        if (stats) setServerStats(stats);
        // Fetch active title + new profile data in one call
        try {
          const res = await authFetch(`/api/profile/me`);
          if (res.ok) {
            const json = await res.json();
            setActiveTitle(json.data?.active_title ?? null);
            if (Array.isArray(json.data?.challengeHistory)) setChallengeHistory(json.data.challengeHistory);
            if (Array.isArray(json.data?.last7Days)) setLast7Days(json.data.last7Days);
            if (json.data?.stepSource !== undefined) setStepSourceInfo(json.data.stepSource);
          }
        } catch { /* ignore */ }
        // Evaluate achievement titles — show unlock modal for any newly earned titles
        try {
          const evalRes = await authFetch("/api/me/titles/evaluate", { method: "POST" });
          if (evalRes.ok) {
            const evalData = await evalRes.json() as {
              newly_unlocked: Array<{ code: string; title: string; difficulty: string; icon: string | null }>;
            };
            if (evalData.newly_unlocked?.length > 0) {
              triggerUnlocks(evalData.newly_unlocked);
            }
          }
        } catch { /* ignore */ }
        // Fetch coin balance from DB into Redux
        void dispatch(fetchCoinBalance());
        // Fetch push notification preference
        void getNotificationPreferences().then((enabled) => setPushEnabled(enabled)).catch(() => {});
      })(); }, [])
  );

  // Load editable fields when edit mode opens
  useEffect(() => {
    if (isEditing) {
      Animated.spring(editAnim, { toValue: 1, useNativeDriver: true, tension: 80, friction: 10 }).start();
      setEditLoading(true);
      fetchProfileMe().then((p) => {
        if (p) {
          setFullName(p.fullName ?? "");
          setUsername(p.username ?? "");
          setCountry(p.country ?? "");
          setCountryFlag(p.countryFlag ?? ""); }
        setEditLoading(false); }); } else {
      Animated.spring(editAnim, { toValue: 0, useNativeDriver: true, tension: 80, friction: 10 }).start(); } }, [isEditing]);

  const validateUsername = useCallback((val: string) => {
    if (!val) { setUsernameError(""); return; }
    const re = /^[a-zA-Z][a-zA-Z0-9_]{5,13}$/;
    setUsernameError(re.test(val) ? "" : "6-14 chars, start with a letter, letters/numbers/underscore only"); }, []);

  const handleSave = async () => {
    if (usernameError) return;
    setSaving(true);
    const result = await updateProfileMe({ fullName, username });
    setSaving(false);
    if (!result.success) {
      AppAlert.alert("Error", result.error ?? "Failed to save changes.");
      return; }
    await refreshUserProfile();
    AppAlert.alert("Saved!", "Your profile has been updated.", [
      { text: "OK", onPress: () => setIsEditing(false) },
    ]); };

  const handleCancelEdit = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setIsEditing(false);
    setUsernameError(""); };

  // ── Derived values ─────────────────────────────────────────────────────────
  const totalSteps    = allTimeSteps || (user?.totalSteps ?? 0);
  const streakDisplay = currentStreak || user?.currentStreak || 0;
  const avatarColor   = user?.avatarColor ?? colors.primary;

  const currentBadge   = BADGES.slice().reverse().find((b) => totalSteps >= b.threshold) ?? BADGES[0];
  const nextBadge      = BADGES.find((b) => b.threshold > totalSteps);
  const progressToNext = nextBadge ? totalSteps / nextBadge.threshold : 1;

  const fallbackLevelData = computeLevel(totalSteps);
  const levelData = serverStats
    ? { level: serverStats.level, xp: serverStats.xp, xpForNext: serverStats.nextLevelXP, progress: serverStats.progressPercent / 100, title: serverStats.levelTitle }
    : fallbackLevelData;

  const raceWins       = serverStats?.racesWon     ?? 0;
  const racesPlayed    = serverStats?.totalRaces   ?? 0;
  const podiumFinishes = serverStats?.top3Finishes ?? 0;
  const winRate        = serverStats?.winRate      ?? 0;

  // ── Handlers ───────────────────────────────────────────────────────────────
  const handleLogout = () => {
    AppAlert.alert("Log Out", "Are you sure you want to log out?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Log Out",
        style: "destructive",
        onPress: async () => {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
          await logout(); }, },
    ]); };

  const handleDeleteAccount = useCallback(() => {
    AppAlert.alert(
      "Delete Account",
      "This will permanently delete your Walk Champ account and all associated data. This action cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete My Account",
          style: "destructive",
          onPress: () => {
            AppAlert.alert(
              "Final Confirmation",
              "All coins, history, and data will be permanently erased.",
              [
                { text: "Cancel", style: "cancel" },
                {
                  text: "Confirm Delete",
                  style: "destructive",
                  onPress: async () => {
                    setDeleteLoading(true);
                    try {
                      const res = await authFetch("/api/me/account", { method: "DELETE" });
                      if (res.ok) {
                        await logout();
                      } else {
                        const j = await res.json().catch(() => ({})) as { error?: string };
                        AppAlert.alert("Error", j.error ?? "Failed to delete account. Please contact support.");
                      }
                    } catch {
                      AppAlert.alert("Error", "Network error. Please try again.");
                    } finally {
                      setDeleteLoading(false);
                    }
                  },
                },
              ],
            );
          },
        },
      ],
    );
  }, [logout]);

  // ── Edit panel translation ──────────────────────────────────────────────────
  const editTranslateY = editAnim.interpolate({ inputRange: [0, 1], outputRange: [-20, 0] });
  const editOpacity    = editAnim;

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: colors.background }]}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[styles.scroll, { paddingTop: safeTop + 16, paddingBottom: safeBottom + 100 }]}
      >
        {/* ── Profile Header Card ── */}
        <LinearGradient
          colors={[`${avatarColor}25`, `${colors.accent}10`, `${colors.background}00`]}
          style={[styles.profileCard, { borderColor: `${avatarColor}35` }]}
        >
          {/* Edit icon pinned top-right */}
          <TouchableOpacity
            style={[styles.editIconBtn, { backgroundColor: isEditing ? colors.primary + "20" : colors.background, borderColor: isEditing ? colors.primary : colors.border }]}
            onPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setIsEditing((e) => !e); }}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Feather name={isEditing ? "x" : "edit-2"} size={16} color={isEditing ? colors.primary : colors.foreground} />
          </TouchableOpacity>

          {/* Top row: avatar + info */}
          <View style={styles.profileTop}>
            <TouchableOpacity style={styles.avatarWrapper} onPress={handleAvatarPress} activeOpacity={0.8} disabled={uploadingAvatar}>
              <View style={[styles.avatar, { backgroundColor: avatarColor + "30", borderColor: avatarColor }]}>
                {avatarUri ? (
                  <Image source={{ uri: avatarUri }} style={styles.avatarImage} />
                ) : (
                  <Text style={[styles.avatarLetter, { color: avatarColor }]}>
                    {(user?.fullName ?? "W").charAt(0).toUpperCase()}
                  </Text>
                )}
                {uploadingAvatar && (
                  <View style={styles.avatarUploadOverlay}>
                    <ActivityIndicator size="small" color="#fff" />
                  </View>
                )}
              </View>
              {/* Camera icon overlay */}
              <View style={[styles.avatarCameraBtn, { backgroundColor: uploadingAvatar ? colors.muted : colors.primary, borderColor: colors.background }]}>
                <Feather name="camera" size={11} color="#000" />
              </View>
            </TouchableOpacity>

            <View style={styles.profileInfo}>
              <View style={styles.nameRow}>
                <Text style={[styles.fullName, { color: colors.foreground }]}>{user?.fullName}</Text>
                <Text style={styles.flag}>{user?.countryFlag}</Text>
              </View>
              <Text style={[styles.username, { color: colors.mutedForeground }]}>@{user?.username}</Text>
              {activeTitle ? (
                <TouchableOpacity
                  onPress={() => setShowTitlesModal(true)}
                  style={[styles.activeTitleChip, { backgroundColor: difficultyColor(activeTitle.difficulty, colors) + "18", borderColor: difficultyColor(activeTitle.difficulty, colors) + "50" }]}
                  activeOpacity={0.7}
                >
                  <Text style={styles.activeTitleIcon}>{activeTitle.icon ?? "🏆"}</Text>
                  <Text style={[styles.activeTitleText, { color: difficultyColor(activeTitle.difficulty, colors) }]}>{activeTitle.title}</Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity
                  onPress={() => setShowTitlesModal(true)}
                  style={[styles.noTitleChip, { backgroundColor: colors.muted, borderColor: colors.border }]}
                  activeOpacity={0.7}
                >
                  <Feather name="award" size={12} color={colors.mutedForeground} />
                  <Text style={[styles.noTitleText, { color: colors.mutedForeground }]}>No title selected</Text>
                </TouchableOpacity>
              )}
              <View style={[styles.statusChip, { backgroundColor: "#00E676" + "18", borderColor: "#00E676" + "35" }]}>
                <View style={[styles.statusDot, { backgroundColor: "#00E676" }]} />
                <Text style={[styles.statusText, { color: "#00E676" }]}>Online · Walking</Text>
              </View>
            </View>
          </View>

          {/* ── Inline Edit Panel ── */}
          {isEditing && (
            <Animated.View style={[styles.editPanel, { backgroundColor: colors.background + "CC", borderColor: colors.border, opacity: editOpacity, transform: [{ translateY: editTranslateY }] }]}>
              {editLoading ? (
                <SkeletonInlineEditForm />
              ) : (
                <>
                  {/* Full Name */}
                  <View style={styles.editField}>
                    <Text style={[styles.editLabel, { color: colors.mutedForeground }]}>FULL NAME</Text>
                    <TextInput
                      style={[styles.editInput, { backgroundColor: colors.card, borderColor: colors.border, color: colors.foreground }]}
                      value={fullName}
                      onChangeText={setFullName}
                      placeholder="Your full name"
                      placeholderTextColor={colors.mutedForeground}
                      maxLength={100}
                      autoCapitalize="words"
                    />
                  </View>

                  {/* Username */}
                  <View style={styles.editField}>
                    <Text style={[styles.editLabel, { color: colors.mutedForeground }]}>USERNAME</Text>
                    <View style={[styles.editInputRow, { backgroundColor: colors.card, borderColor: usernameError ? colors.destructive : colors.border }]}>
                      <Text style={[styles.atSign, { color: colors.mutedForeground }]}>@</Text>
                      <TextInput
                        style={[styles.editInputInner, { color: colors.foreground }]}
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
                      <Text style={[styles.editHint, { color: colors.destructive }]}>{usernameError}</Text>
                    ) : (
                      <Text style={[styles.editHint, { color: colors.mutedForeground }]}>6–14 characters · letters, numbers, underscores</Text>
                    )}
                  </View>

                  {/* Country (read-only note) */}
                  <View style={[styles.editInfoRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
                    <Text style={styles.editCountryFlag}>{countryFlag}</Text>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.editLabel, { color: colors.mutedForeground }]}>COUNTRY</Text>
                      <Text style={[styles.editCountryName, { color: colors.foreground }]}>{country || "Not set"}</Text>
                    </View>
                    <View style={{ alignItems: "flex-end" }}>
                      <Text style={[styles.editHint, { color: colors.mutedForeground }]}>Contact support to change</Text>
                    </View>
                  </View>

                  {/* Save / Cancel */}
                  <View style={styles.editActions}>
                    <TouchableOpacity
                      style={[styles.editCancelBtn, { borderColor: colors.border }]}
                      onPress={handleCancelEdit}
                    >
                      <Text style={[styles.editCancelText, { color: colors.mutedForeground }]}>Cancel</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.editSaveBtn, { backgroundColor: colors.primary, opacity: saving || !!usernameError ? 0.5 : 1 }]}
                      onPress={handleSave}
                      disabled={saving || !!usernameError}
                    >
                      {saving ? (
                        <ActivityIndicator size="small" color="#000" />
                      ) : (
                        <Text style={styles.editSaveText}>Save Changes</Text>
                      )}
                    </TouchableOpacity>
                  </View>
                </>
              )}
            </Animated.View>
          )}

          {/* Achievements card — tap to open My Titles */}
          <TouchableOpacity
            style={[styles.achievementsCard, { backgroundColor: colors.background + "80", borderColor: colors.primary + "35" }]}
            onPress={() => setShowTitlesModal(true)}
            activeOpacity={0.75}
          >
            <View style={[styles.achievementsIcon, { backgroundColor: colors.primary + "20" }]}>
              <Feather name="award" size={20} color={colors.primary} />
            </View>
            <View style={styles.achievementsInfo}>
              <Text style={[styles.achievementsLabel, { color: colors.foreground }]}>Achievements</Text>
              {activeTitle ? (
                <Text style={[styles.achievementsSubtext, { color: difficultyColor(activeTitle.difficulty, colors) }]}>
                  {activeTitle.icon ?? "🏆"} {activeTitle.title}
                </Text>
              ) : (
                <Text style={[styles.achievementsSubtext, { color: colors.mutedForeground }]}>Tap to view & equip titles</Text>
              )}
            </View>
            <Feather name="chevron-right" size={18} color={colors.mutedForeground} />
          </TouchableOpacity>

        </LinearGradient>

        {/* ── Stats Grid ── */}
        <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Your Stats</Text>
        <View style={styles.statsGrid}>
          <View style={[styles.statCard2, { backgroundColor: colors.card, borderColor: colors.primary + "40" }]}>
            <Text style={[styles.statCard2Num, { color: colors.primary }]}>{racesPlayed}</Text>
            <Text style={[styles.statCard2Label, { color: colors.mutedForeground }]}>Races Played 🏁</Text>
          </View>
          <View style={[styles.statCard2, { backgroundColor: colors.card, borderColor: colors.gold + "40" }]}>
            <Text style={[styles.statCard2Num, { color: colors.gold }]}>{raceWins}</Text>
            <Text style={[styles.statCard2Label, { color: colors.mutedForeground }]}>Race Wins 🏆</Text>
          </View>
          <View style={[styles.statCard2, { backgroundColor: colors.card, borderColor: colors.neonBlue + "40" }]}>
            <Text style={[styles.statCard2Num, { color: colors.neonBlue }]}>{podiumFinishes}</Text>
            <Text style={[styles.statCard2Label, { color: colors.mutedForeground }]}>Podiums 🥇</Text>
          </View>
          <View style={[styles.statCard2, { backgroundColor: colors.card, borderColor: colors.accent + "40" }]}>
            <Text style={[styles.statCard2Num, { color: colors.accent }]}>{winRate}%</Text>
            <Text style={[styles.statCard2Label, { color: colors.mutedForeground }]}>Win Rate 📊</Text>
          </View>
        </View>

        <View style={styles.statsGrid}>
          <View style={[styles.statCard3, { backgroundColor: colors.card, borderColor: colors.primary + "30" }]}>
            <Text style={[styles.statCard3Num, { color: colors.primary }]}>{totalSteps.toLocaleString()}</Text>
            <Text style={[styles.statCard3Label, { color: colors.mutedForeground }]}>Total Steps</Text>
          </View>
          <View style={[styles.statCard3, { backgroundColor: colors.card, borderColor: colors.accent + "30" }]}>
            <Text style={[styles.statCard3Num, { color: colors.accent }]}>{formatDistance(stepsToDistance(totalSteps))}</Text>
            <Text style={[styles.statCard3Label, { color: colors.mutedForeground }]}>Distance</Text>
          </View>
          <View style={[styles.statCard3, { backgroundColor: colors.card, borderColor: colors.destructive + "30" }]}>
            <Text style={[styles.statCard3Num, { color: colors.destructive }]}>{streakDisplay}d</Text>
            <Text style={[styles.statCard3Label, { color: colors.mutedForeground }]}>Day Streak</Text>
          </View>
          <View style={[styles.statCard3, { backgroundColor: colors.card, borderColor: "#FFD70030" }]}>
            <Text style={[styles.statCard3Num, { color: "#FFD700" }]}>{serverStats?.coinsEarned?.toLocaleString() ?? "--"}</Text>
            <Text style={[styles.statCard3Label, { color: colors.mutedForeground }]}>Coins Earned</Text>
          </View>
        </View>

        {/* ── Wearable Setup ── */}
        <WearableStatusCard
          stepSource={stepSourceInfo}
          onSetupPress={() => setShowWearableSetup(true)}
          colors={colors}
        />

        {/* ── Challenge History ── */}
        {challengeHistory.length > 0 && (
          <>
            <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Challenge History</Text>
            <View style={[styles.historyCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              {challengeHistory.map((item, i) => (
                <ChallengeHistoryRow key={item.id} item={item} colors={colors} isLast={i === challengeHistory.length - 1} />
              ))}
            </View>
          </>
        )}

        {/* Badge progress */}
        {nextBadge && (
          <View style={[styles.badgeProgressCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={styles.badgeProgressTop}>
              <Text style={[styles.badgeProgressLabel, { color: colors.mutedForeground }]}>
                Progress to <Text style={{ color: colors.foreground, fontWeight: "700" }}>{nextBadge.name}</Text>
              </Text>
              <Text style={[styles.badgeProgressPct, { color: colors.primary }]}>{Math.round(progressToNext * 100)}%</Text>
            </View>
            <View style={[styles.badgeProgressBar, { backgroundColor: colors.border }]}>
              <LinearGradient
                colors={[colors.primary, colors.accent]}
                style={[styles.badgeProgressFill, { width: `${Math.min(progressToNext * 100, 100)}%` }]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
              />
            </View>
          </View>
        )}

        {/* ── Preferences ── */}
        <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Preferences</Text>
        <View style={[styles.settingsList, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={[styles.settingRow, { borderBottomColor: colors.border, borderBottomWidth: StyleSheet.hairlineWidth }]}>
            <View style={[styles.settingIcon, { backgroundColor: colors.accent + "15" }]}>
              <Feather name="smartphone" size={17} color={colors.accent} />
            </View>
            <Text style={[styles.settingLabel, { color: colors.foreground }]}>Vibration</Text>
            <Switch value={soundEnabled} onValueChange={setSoundEnabled}
              trackColor={{ false: colors.border, true: colors.primary + "80" }}
              thumbColor={soundEnabled ? colors.primary : colors.mutedForeground}
              ios_backgroundColor={colors.border}
            />
          </View>
          <View style={[styles.settingRow, { borderBottomColor: colors.border, borderBottomWidth: StyleSheet.hairlineWidth }]}>
            <View style={[styles.settingIcon, { backgroundColor: colors.neonBlue + "15" }]}>
              <Feather name={darkTheme ? "moon" : "sun"} size={17} color={colors.neonBlue} />
            </View>
            <Text style={[styles.settingLabel, { color: colors.foreground }]}>Dark Theme</Text>
            <Switch value={darkTheme} onValueChange={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); toggleTheme(); }}
              trackColor={{ false: colors.border, true: colors.neonBlue + "80" }}
              thumbColor={darkTheme ? colors.neonBlue : colors.mutedForeground}
              ios_backgroundColor={colors.border}
            />
          </View>
          <View style={[styles.settingRow, { borderBottomColor: colors.border, borderBottomWidth: StyleSheet.hairlineWidth }]}>
            <View style={[styles.settingIcon, { backgroundColor: colors.accent + "15" }]}>
              <Feather name="bell" size={17} color={colors.accent} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.settingLabel, { color: colors.foreground }]}>Push Notifications</Text>
              <Text style={[styles.settingSubtitle, { color: colors.mutedForeground }]}>Races, invites, rewards, and important activity</Text>
            </View>
            {pushLoading
              ? <ActivityIndicator size="small" color={colors.accent} />
              : <Switch value={pushEnabled} onValueChange={handlePushToggle}
                  trackColor={{ false: colors.border, true: colors.accent + "80" }}
                  thumbColor={pushEnabled ? colors.accent : colors.mutedForeground}
                  ios_backgroundColor={colors.border}
                />
            }
          </View>
          <View style={[styles.settingRow]}>
            <View style={[styles.settingIcon, { backgroundColor: colors.primary + "15" }]}>
              <Feather name="image" size={17} color={colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.settingLabel, { color: colors.foreground }]}>Dynamic App Icon</Text>
              <Text style={[styles.settingSubtitle, { color: colors.mutedForeground }]}>Icon updates when you hit your daily step goal</Text>
            </View>
            <Switch value={dynIconEnabled} onValueChange={(v) => { setDynIconEnabled(v); dynamicIconService.setEnabled(v, user?.id).catch(() => {}); }}
              trackColor={{ false: colors.border, true: colors.primary + "80" }}
              thumbColor={dynIconEnabled ? colors.primary : colors.mutedForeground}
              ios_backgroundColor={colors.border}
            />
          </View>
        </View>

        {/* ── Wallet & Rewards ── */}
        <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Wallet & Rewards</Text>
        <View style={[styles.settingsList, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <TouchableOpacity style={[styles.settingRow, { borderBottomColor: colors.border, borderBottomWidth: StyleSheet.hairlineWidth }]}
            onPress={() => router.push("/(tabs)/wallet")}
          >
            <View style={[styles.settingIcon, { backgroundColor: "#FFD70015" }]}>
              <Feather name="credit-card" size={17} color="#FFD700" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.settingLabel, { color: colors.foreground }]}>My Wallet</Text>
              <Text style={[styles.settingSubtitle, { color: colors.mutedForeground }]}>
                Balance: {coinData ? `${coinData.currentBalance.toLocaleString()} coins` : "—"}
              </Text>
            </View>
            <Feather name="chevron-right" size={16} color={colors.mutedForeground} />
          </TouchableOpacity>
          <TouchableOpacity style={[styles.settingRow]}
            onPress={() => AppAlert.alert("Referral Code", `Your code: ${user?.referralCode ?? "WC123456"}\n\nShare it — both of you earn $2 when they walk 5,000 steps!`)}
          >
            <View style={[styles.settingIcon, { backgroundColor: colors.gold + "15" }]}>
              <Feather name="gift" size={17} color={colors.gold} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[styles.settingLabel, { color: colors.foreground }]}>Refer & Earn</Text>
              <Text style={[styles.settingSubtitle, { color: colors.mutedForeground }]}>Code: {user?.referralCode ?? "WC123456"}</Text>
            </View>
            <Feather name="chevron-right" size={16} color={colors.mutedForeground} />
          </TouchableOpacity>
        </View>

        {/* ── Support & Legal ── */}
        <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Support & Legal</Text>
        <View style={[styles.settingsList, { backgroundColor: colors.card, borderColor: colors.border }]}>
          {[
            { icon: "help-circle", label: "Help & Troubleshooting", color: colors.primary,         onPress: () => router.push("/profile/help" as never) },
            { icon: "message-circle", label: "FAQ",                 color: colors.accent,          onPress: () => router.push("/profile/faq" as never) },
            { icon: "shield",      label: "Privacy & Security",    color: colors.neonBlue,         onPress: () => {} },
            { icon: "file-text",   label: "Terms & Privacy Policy", color: colors.mutedForeground, onPress: () => Linking.openURL("https://walkchamp.app/legal") },
          ].map((item, i, arr) => (
            <TouchableOpacity key={item.label}
              style={[styles.settingRow, i < arr.length - 1 && { borderBottomColor: colors.border, borderBottomWidth: StyleSheet.hairlineWidth }]}
              onPress={item.onPress}
            >
              <View style={[styles.settingIcon, { backgroundColor: item.color + "15" }]}>
                <Feather name={item.icon as never} size={17} color={item.color} />
              </View>
              <Text style={[styles.settingLabel, { color: colors.foreground }]}>{item.label}</Text>
              <Feather name="chevron-right" size={16} color={colors.mutedForeground} />
            </TouchableOpacity>
          ))}
        </View>

        {/* Disclaimer */}
        <View style={[styles.disclaimerCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Feather name="shield" size={14} color={colors.mutedForeground} />
          <Text style={[styles.disclaimerText, { color: colors.mutedForeground }]}>
            Paid races are skill-based walking competitions. Prizes are subject to verification and local eligibility rules. Users must meet age and location requirements.
          </Text>
        </View>

        {/* ── Account ── */}
        <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Account</Text>
        <View style={[styles.settingsList, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <TouchableOpacity
            style={[styles.settingRow, { borderBottomColor: colors.border, borderBottomWidth: StyleSheet.hairlineWidth }]}
            onPress={handleLogout}
          >
            <View style={[styles.settingIcon, { backgroundColor: colors.destructive + "15" }]}>
              <Feather name="log-out" size={17} color={colors.destructive} />
            </View>
            <Text style={[styles.settingLabel, { color: colors.destructive }]}>Log Out</Text>
            <Feather name="chevron-right" size={16} color={colors.destructive} />
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.settingRow]}
            onPress={handleDeleteAccount}
            disabled={deleteLoading}
          >
            <View style={[styles.settingIcon, { backgroundColor: colors.destructive + "10" }]}>
              {deleteLoading
                ? <ActivityIndicator size="small" color={colors.destructive} />
                : <Feather name="trash-2" size={17} color={colors.destructive} />}
            </View>
            <Text style={[styles.settingLabel, { color: colors.destructive, opacity: 0.8 }]}>Delete Account</Text>
            <Feather name="chevron-right" size={16} color={colors.destructive} />
          </TouchableOpacity>
        </View>
      </ScrollView>

      {/* Wearable Setup modal */}
      <WearableSetupModal
        visible={showWearableSetup}
        onClose={() => setShowWearableSetup(false)}
        last7Days={last7Days}
        onComplete={(platform: string, permissionStatus: string) => {
          setStepSourceInfo({ platform, permissionStatus, setupCompleted: true });
          if (permissionStatus === "connected") {
            void requestStepPermission();
          }
        }}
      />

      {/* My Titles modal overlay */}
      <MyTitlesModal
        visible={showTitlesModal}
        onClose={() => setShowTitlesModal(false)}
        onSaved={(title) => {
          setActiveTitle(title);
          setShowTitlesModal(false); }}
      />
      <AvatarPickerSheet
        visible={showAvatarPicker}
        onClose={() => setShowAvatarPicker(false)}
        options={[
          { label: "Take Photo", icon: "camera", onPress: handleTakePhoto },
          { label: "Choose from Library", icon: "image", onPress: handleChooseFromLibrary },
          ...(avatarUri ? [{ label: "Remove Photo", icon: "trash-2", destructive: true, onPress: handleRemoveAvatar }] : []),
        ]}
      />
    </KeyboardAvoidingView>
  ); }

// ── Styles ────────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container:  { flex: 1 },
  scroll:     { paddingHorizontal: 16 },

  // Profile card
  profileCard:    { borderRadius: 20, borderWidth: 1, padding: rs(18), marginBottom: rs(24), gap: 14 },
  profileTop:     { flexDirection: "row", gap: 14 },
  avatarWrapper:    { position: "relative" },
  avatar:           { width: rs(72), height: rs(72), borderRadius: rs(36), borderWidth: 2.5, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  avatarImage:      { width: rs(72), height: rs(72), borderRadius: rs(36) },
  avatarLetter:     { fontSize: rf(28), fontWeight: "800" },
  avatarUploadOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.45)", borderRadius: rs(36), alignItems: "center", justifyContent: "center", zIndex: 3 },
  avatarCameraBtn:  { position: "absolute", bottom: 18, right: -2, width: rs(22), height: rs(22), borderRadius: rs(11), borderWidth: 2, alignItems: "center", justifyContent: "center", zIndex: 2 },
  profileInfo:    { flex: 1, gap: 5 },
  nameRow:        { flexDirection: "row", alignItems: "center", gap: 8 },
  fullName:       { fontSize: rf(20), fontWeight: "800" },
  flag:           { fontSize: rf(20) },
  username:       { fontSize: rf(14) },
  statusChip:     { flexDirection: "row", alignItems: "center", gap: 5, alignSelf: "flex-start", paddingHorizontal: rs(10), paddingVertical: 4, borderRadius: 20, borderWidth: 1 },
  statusDot:      { width: 6, height: 6, borderRadius: 3 },
  statusText:     { fontSize: rf(12), fontWeight: "600" },

  // Edit icon button (top-right of card)
  editIconBtn: {
    position: "absolute", top: 14, right: 14,
    width: rs(34), height: rs(34), borderRadius: rs(17),
    borderWidth: 1, alignItems: "center", justifyContent: "center",
    zIndex: 10, },

  // Inline edit panel
  editPanel:       { borderRadius: 16, borderWidth: 1, padding: rs(16), gap: 14 },
  editField:       { gap: 6 },
  editLabel:       { fontSize: rf(11), fontWeight: "700", letterSpacing: 0.8, textTransform: "uppercase" },
  editInput:       { borderRadius: 12, borderWidth: 1, paddingHorizontal: rs(14), paddingVertical: rs(12), fontSize: rf(15) },
  editInputRow:    { flexDirection: "row", alignItems: "center", borderRadius: 12, borderWidth: 1, paddingHorizontal: rs(14), paddingVertical: rs(12), gap: 4 },
  atSign:          { fontSize: rf(15) },
  editInputInner:  { flex: 1, fontSize: rf(15) },
  editHint:        { fontSize: rf(11), lineHeight: 15 },
  editInfoRow:     { flexDirection: "row", alignItems: "center", gap: 12, borderRadius: 12, borderWidth: 1, padding: rs(14) },
  editCountryFlag: { fontSize: rf(30) },
  editCountryName: { fontSize: rf(15), fontWeight: "600", marginTop: 2 },
  editActions:     { flexDirection: "row", gap: 10, marginTop: 4 },
  editCancelBtn:   { flex: 1, paddingVertical: rs(12), borderRadius: 12, borderWidth: 1, alignItems: "center" },
  editCancelText:  { fontSize: rf(14), fontWeight: "600" },
  editSaveBtn:     { flex: 2, paddingVertical: rs(12), borderRadius: 12, alignItems: "center" },
  editSaveText:    { fontSize: rf(14), fontWeight: "700", color: "#000" },

  // Active title chip (under username)
  activeTitleChip: { flexDirection: "row", alignItems: "center", gap: 5, alignSelf: "flex-start", paddingHorizontal: rs(10), paddingVertical: 4, borderRadius: 20, borderWidth: 1 },
  activeTitleIcon: { fontSize: rf(13) },
  activeTitleText: { fontSize: rf(12), fontWeight: "700" },
  noTitleChip:     { flexDirection: "row", alignItems: "center", gap: 5, alignSelf: "flex-start", paddingHorizontal: rs(10), paddingVertical: 4, borderRadius: 20, borderWidth: 1 },
  noTitleText:     { fontSize: rf(12) },

  // Achievements card (replaces level/XP bar)
  achievementsCard: { flexDirection: "row", alignItems: "center", gap: 12, borderRadius: 14, borderWidth: 1, padding: rs(12) },
  achievementsIcon: { width: rs(40), height: rs(40), borderRadius: rs(20), alignItems: "center", justifyContent: "center" },
  achievementsInfo: { flex: 1, gap: 3 },
  achievementsLabel:   { fontSize: 14, fontWeight: "700" },
  achievementsSubtext: { fontSize: 12 },

  // Badge / follow
  badgeFollowRow:    { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  followCounts:      { flexDirection: "row", alignItems: "center", gap: 12 },
  followCount:       { alignItems: "center" },
  followCountNum:    { fontSize: rf(16), fontWeight: "800" },
  followCountLabel:  { fontSize: rf(11) },
  followCountDivider:{ width: 1, height: 28 },

  // Action row (Follow + Share only)
  actionRow:   { flexDirection: "row", gap: 8 },
  actionBtn:   { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: rs(11), borderRadius: 12, borderWidth: 1 },
  actionBtnSm: { width: rs(44), alignItems: "center", justifyContent: "center", borderRadius: 12, borderWidth: 1 },
  actionText:  { fontSize: rf(14), fontWeight: "700" },

  // Race stats
  raceStatsGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginBottom: 20 },
  raceStatCard:  { flex: 1, minWidth: "44%", backgroundColor: "transparent", borderRadius: 16, borderWidth: 1, padding: rs(16), alignItems: "center", gap: 4 },
  raceStatNum:   { fontSize: rf(28), fontWeight: "900" },
  raceStatLabel: { fontSize: rf(12), fontWeight: "600" },
  raceStatIcon:  { fontSize: rf(20), marginTop: 4 },

  // Personal records
  prCard:    { borderRadius: 16, borderWidth: 1, padding: rs(16), marginBottom: 20, gap: 0 },
  prTitle:   { fontSize: rf(15), fontWeight: "700", marginBottom: 12 },
  prDivider: { height: StyleSheet.hairlineWidth, marginVertical: 10 },
  prRow:     { flexDirection: "row", alignItems: "center", gap: 12 },
  prIcon:    { width: rs(32), height: rs(32), borderRadius: 8, alignItems: "center", justifyContent: "center" },
  prLabel:   { flex: 1, fontSize: rf(13) },
  prValue:   { fontSize: rf(14), fontWeight: "700" },

  // Achievements grid
  achievGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginBottom: 20 },
  achievCard: { flex: 1, minWidth: "44%", borderRadius: 14, borderWidth: 1, padding: rs(14), alignItems: "center", gap: 6 },
  achievIcon: { width: rs(44), height: rs(44), borderRadius: rs(22), alignItems: "center", justifyContent: "center" },
  achievValue:{ fontSize: rf(18), fontWeight: "800" },
  achievLabel:{ fontSize: rf(11), textAlign: "center" },

  // Stat boxes
  statBox:      { flex: 1, borderRadius: 12, borderWidth: 1, padding: rs(12), alignItems: "center", gap: 4 },
  statBoxValue: { fontSize: rf(18), fontWeight: "800" },
  statBoxLabel: { fontSize: rf(11) },

  // Badge progress
  badgeProgressCard: { borderRadius: 14, borderWidth: 1, padding: rs(14), marginBottom: 20, gap: 8 },
  badgeProgressTop:  { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  badgeProgressLabel:{ fontSize: rf(13), flex: 1 },
  badgeProgressPct:  { fontSize: rf(13), fontWeight: "700" },
  badgeProgressBar:  { height: 6, borderRadius: 3, overflow: "hidden" },
  badgeProgressFill: { height: "100%", borderRadius: 3 },

  // Badges list
  badgesCard:    { borderRadius: 16, borderWidth: 1, padding: 4, marginBottom: 20, overflow: "hidden" },
  badgeItem:     { flexDirection: "row", alignItems: "center", gap: 14, padding: rs(12), borderBottomWidth: StyleSheet.hairlineWidth },
  badgeItemIcon: { width: rs(40), height: rs(40), borderRadius: rs(20), alignItems: "center", justifyContent: "center" },
  badgeItemInfo: { flex: 1, gap: 2 },
  badgeItemName: { fontSize: rf(14), fontWeight: "600" },
  badgeItemReq:  { fontSize: rf(11) },

  // Referral
  referralCard: { flexDirection: "row", alignItems: "center", gap: 14, borderRadius: 16, borderWidth: 1, padding: rs(16), marginBottom: 20 },
  referralInfo: { flex: 1, gap: 4 },
  referralTitle:{ fontSize: rf(15), fontWeight: "700" },
  referralDesc: { fontSize: rf(13), lineHeight: 18 },
  referralCopy: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: rs(12), paddingVertical: rs(8), borderRadius: 10, borderWidth: 1 },
  referralCode: { fontSize: rf(13), fontWeight: "700" },

  // Disclaimer
  disclaimerCard:{ flexDirection: "row", alignItems: "flex-start", gap: 10, borderRadius: 14, borderWidth: 1, padding: rs(14), marginBottom: 20 },
  disclaimerText:{ flex: 1, fontSize: rf(12), lineHeight: 17 },

  // Coins card
  coinsCard:      { borderRadius: 16, borderWidth: 1, padding: rs(16), marginBottom: 20 },
  coinsCardHeader:{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 6 },
  coinsCardTitle: { fontSize: rf(15), fontWeight: "700" },
  coinsViewBtn:   { paddingHorizontal: rs(10), paddingVertical: 4, borderRadius: 8, borderWidth: 1 },
  coinsViewText:  { fontSize: rf(11), fontWeight: "600" },
  coinsBigNum:    { fontSize: rf(36), fontWeight: "900", marginBottom: 10 },
  coinsInfoRow:   { flexDirection: "row", alignItems: "center", gap: 0 },
  coinsInfoCol:   { flex: 1, alignItems: "center", gap: 3 },
  coinsInfoDivider: { width: 1, height: 28, marginHorizontal: 8 },
  coinsInfoLabel: { fontSize: rf(11) },
  coinsInfoValue: { fontSize: rf(16), fontWeight: "700" },

  // Stats grids (new 2×2 layout)
  statsGrid:    { flexDirection: "row", flexWrap: "wrap", gap: 10, marginBottom: 14 },
  statCard2:    { flex: 1, minWidth: "44%", borderRadius: 16, borderWidth: 1, padding: rs(16), alignItems: "center", gap: 4 },
  statCard2Num: { fontSize: rf(26), fontWeight: "900" },
  statCard2Label:{ fontSize: rf(12), fontWeight: "600", textAlign: "center" },
  statCard3:    { flex: 1, minWidth: "44%", borderRadius: 14, borderWidth: 1, padding: rs(12), alignItems: "center", gap: 3 },
  statCard3Num: { fontSize: rf(20), fontWeight: "800" },
  statCard3Label:{ fontSize: rf(11), textAlign: "center" },

  // Challenge history card
  historyCard:  { borderRadius: 16, borderWidth: 1, marginBottom: 20, overflow: "hidden" },

  // Section title
  sectionTitle: { fontSize: rf(16), fontWeight: "800", marginBottom: 12 },

  // Settings list
  settingsList: { borderRadius: 16, borderWidth: 1, overflow: "hidden", marginBottom: 20 },
  settingRow:   { flexDirection: "row", alignItems: "center", paddingHorizontal: rs(16), paddingVertical: rs(14), gap: 14 },
  settingIcon:  { width: rs(34), height: rs(34), borderRadius: 10, alignItems: "center", justifyContent: "center" },
  settingLabel:    { flex: 1, fontSize: rf(15), fontWeight: "500" },
  settingSubtitle: { fontSize: rf(11), marginTop: 1 },

  // Logout
  logoutBtn:  { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, borderRadius: 14, borderWidth: 1, paddingVertical: rs(14), marginBottom: 8 },
  logoutText: { fontSize: rf(16), fontWeight: "700" }, });
