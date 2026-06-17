import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  AppState,
  Linking,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { useSafeLayout } from "@/hooks/useSafeLayout";
import { authFetch } from "@/utils/authFetch";
import { TouchableOpacity } from "@/components/HapticTouchableOpacity";
import { rf } from "@/utils/responsive";
import {
  androidHCService,
  isExpoGo,
  type HCAvailability,
} from "@/services/steps/androidHealthConnectService";

const isIOS = Platform.OS === "ios";
const TOTAL_IOS     = 5;
const TOTAL_ANDROID = 4;

/**
 * androidPhase tracks Android-specific setup flow state.
 *  checking      — HC availability check in progress
 *  expo_go       — running in Expo Go, standalone build required
 *  not_supported — device/HC truly unsupported
 *  install       — HC not installed or needs update (show install card)
 *  setup         — HC available → normal multi-step wizard
 */
type AndroidPhase =
  | "checking"
  | "expo_go"
  | "not_supported"
  | "install"
  | "setup";

interface Props {
  visible: boolean;
  onClose: () => void;
  last7Days?: { date: string; steps: number }[];
  onRefreshSteps?: () => Promise<void>;
  onComplete?: (platform: string, permissionStatus: string) => void;
}

export default function WearableSetupModal({
  visible, onClose, onComplete,
}: Props) {
  const colors = useColors();
  const { safeTop, safeBottom } = useSafeLayout();

  const platform   = isIOS ? "ios_healthkit" : "android_health_connect";
  const healthName = isIOS ? "Apple Health"  : "Health Connect";

  const [step,           setStep]           = useState(0);
  const [permStatus,     setPermStatus]     = useState<"unknown" | "granted" | "denied" | "unavailable">("unknown");
  const [permLoading,    setPermLoading]    = useState(false);
  const [saving,         setSaving]         = useState(false);
  const [androidPhase,   setAndroidPhase]   = useState<AndroidPhase>("checking");
  const [hcAvailability, setHcAvailability] = useState<HCAvailability | null>(null);
  const [installLoading, setInstallLoading] = useState(false);

  // ── HC availability check (Android only) ───────────────────────────────────

  const checkHCAvailability = useCallback(async () => {
    if (isIOS) return;
    if (isExpoGo()) {
      setAndroidPhase("expo_go");
      return;
    }
    setAndroidPhase("checking");
    if (__DEV__) console.log("[HealthConnectSetup] checking availability...");
    try {
      const result = await androidHCService.initialize();
      if (__DEV__) console.log(`[HealthConnectSetup] availability status: ${result.availability}`);
      setHcAvailability(result.availability);
      if (result.availability === "not_supported") {
        setAndroidPhase("not_supported");
      } else if (
        result.availability === "not_installed" ||
        result.availability === "needs_update"
      ) {
        setAndroidPhase("install");
      } else {
        setAndroidPhase("setup");
        setStep(0);
        setPermStatus(
          result.permission === "granted" ? "granted" :
          result.permission === "denied"  ? "denied"  : "unknown",
        );
      }
    } catch {
      if (__DEV__) console.log("[HealthConnectSetup] unsupported final state: init error");
      setAndroidPhase("not_supported");
    }
  }, []);

  // Reset + initial check when modal opens
  useEffect(() => {
    if (visible) {
      setStep(0);
      setSaving(false);
      setPermLoading(false);
      setInstallLoading(false);
      if (isIOS) {
        void checkPerm();
      } else {
        void checkHCAvailability();
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  // AppState resume: re-check HC after returning from Play Store / Settings
  useEffect(() => {
    if (!visible || isIOS || isExpoGo()) return;
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active" && androidPhase === "install") {
        if (__DEV__) console.log("[HealthConnectSetup] app resumed after install/settings");
        void checkHCAvailability();
      }
    });
    return () => sub.remove();
  }, [visible, androidPhase, checkHCAvailability]);

  // ── Permission helpers ─────────────────────────────────────────────────────

  const checkPerm = useCallback(async () => {
    try {
      if (isIOS) {
        const { stepTracker } = await import("@/services/StepTrackingService");
        const s = await stepTracker.getPermissionStatus();
        setPermStatus(s as typeof permStatus);
      } else {
        const s = await androidHCService.getPermissionStatus();
        setPermStatus(s === "granted" ? "granted" : s === "denied" ? "denied" : "unknown");
      }
    } catch { setPermStatus("unknown"); }
  }, []);

  const requestPerm = async () => {
    if (permStatus === "denied") {
      if (__DEV__) console.log("[HealthConnectSetup] settings button tapped");
      if (isIOS) {
        Linking.openSettings();
      } else {
        void androidHCService.openSettings();
      }
      return;
    }
    setPermLoading(true);
    try {
      if (isIOS) {
        const { stepTracker } = await import("@/services/StepTrackingService");
        const s = await stepTracker.requestPermission();
        setPermStatus(s as typeof permStatus);
      } else {
        const s = await androidHCService.requestPermission();
        const resolved = s === "granted" ? "granted" : "denied";
        setPermStatus(resolved);
        if (__DEV__) console.log(`[HealthConnectSetup] permission status after setup: ${resolved}`);
        if (s === "granted") {
          if (__DEV__) console.log("[HealthConnectSetup] start tracking after setup: permission granted");
        }
      }
    } catch { /* ignore */ }
    finally { setPermLoading(false); }
  };

  const handleDone = async () => {
    setSaving(true);
    try {
      await authFetch("/api/me/step-source", {
        method: "POST",
        body: JSON.stringify({
          platform,
          permission_status: permStatus === "granted" ? "connected" : permStatus === "denied" ? "denied" : "not_requested",
          source_name: healthName,
          setup_completed: true,
        }),
      });
    } catch { /* ignore */ }
    finally {
      setSaving(false);
      const resolvedStatus = permStatus === "granted" ? "connected" : permStatus === "denied" ? "denied" : "not_requested";
      onComplete?.(platform, resolvedStatus);
      onClose();
    }
  };

  // ── Navigation ─────────────────────────────────────────────────────────────

  const goNext = () => setStep(s => Math.min(s + 1, (isIOS ? TOTAL_IOS : TOTAL_ANDROID) - 1));
  const goBack = () => setStep(s => Math.max(s - 1, 0));
  const isLast = step === (isIOS ? TOTAL_IOS : TOTAL_ANDROID) - 1;

  // ── Android pre-check screens ──────────────────────────────────────────────

  const HCCheckingScreen = () => (
    <View style={[ws.content, { alignItems: "center", justifyContent: "center", paddingTop: 60 }]}>
      <ActivityIndicator size="large" color={colors.primary} />
      <Text style={[ws.desc, { color: colors.mutedForeground, marginTop: 16, textAlign: "center" }]}>
        Checking Health Connect…
      </Text>
    </View>
  );

  const HCExpoGoScreen = () => (
    <View style={ws.content}>
      <View style={[ws.iconCircle, { backgroundColor: "#FFD70018" }]}>
        <Feather name="smartphone" size={36} color="#FFD700" />
      </View>
      <Text style={[ws.title, { color: colors.foreground }]}>Standalone Build Required</Text>
      <Text style={[ws.desc, { color: colors.mutedForeground }]}>
        Step tracking requires the installed Android app. It does not work in Expo Go.
      </Text>
      <View style={[ws.infoCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={[ws.infoText, { color: colors.mutedForeground }]}>
          Build and install the standalone Walk Champ APK to enable Health Connect step tracking.
        </Text>
      </View>
    </View>
  );

  const HCUnsupportedScreen = () => (
    <View style={ws.content}>
      <View style={[ws.iconCircle, { backgroundColor: colors.destructive + "18" }]}>
        <Feather name="alert-circle" size={36} color={colors.destructive} />
      </View>
      <Text style={[ws.title, { color: colors.foreground }]}>Step Tracking Unavailable</Text>
      <Text style={[ws.desc, { color: colors.mutedForeground }]}>
        {"Step tracking is not available on this device.\n\nWalk Champ requires Health Connect support to verify Android steps."}
      </Text>
      <TouchableOpacity
        style={[ws.actionBtn, { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border }]}
        onPress={() => {
          if (__DEV__) console.log("[HealthConnectSetup] unsupported final state: try again tapped");
          void checkHCAvailability();
        }}
      >
        <Feather name="refresh-cw" size={16} color={colors.foreground} />
        <Text style={[ws.actionBtnText, { color: colors.foreground }]}>Try Again</Text>
      </TouchableOpacity>
    </View>
  );

  const HCInstallScreen = () => {
    const isUpdate = hcAvailability === "needs_update";
    return (
      <View style={ws.content}>
        <View style={[ws.iconCircle, { backgroundColor: "#4285F418" }]}>
          <Feather name="download" size={36} color="#4285F4" />
        </View>
        <Text style={[ws.title, { color: colors.foreground }]}>Health Connect Required</Text>
        <Text style={[ws.desc, { color: colors.mutedForeground }]}>
          {isUpdate
            ? "Walk Champ requires an updated version of Health Connect to read your verified steps."
            : "Walk Champ uses Health Connect to read your verified steps on Android for challenges, races, history, and leaderboards.\n\nPlease install or enable Health Connect to continue."}
        </Text>

        {/* Primary: Install / Update */}
        <TouchableOpacity
          style={[ws.actionBtn, { opacity: installLoading ? 0.6 : 1 }]}
          onPress={async () => {
            if (__DEV__) console.log("[HealthConnectSetup] install button tapped");
            setInstallLoading(true);
            await androidHCService.openInstallPage();
            setInstallLoading(false);
          }}
          disabled={installLoading}
        >
          {installLoading
            ? <ActivityIndicator size="small" color="#000" />
            : <Feather name="download" size={16} color="#000" />}
          <Text style={ws.actionBtnText}>
            {isUpdate ? "Update Health Connect" : "Install Health Connect"}
          </Text>
        </TouchableOpacity>

        {/* Secondary: Open Settings */}
        <TouchableOpacity
          style={[ws.actionBtn, { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border }]}
          onPress={() => {
            if (__DEV__) console.log("[HealthConnectSetup] settings button tapped");
            void androidHCService.openSettings();
          }}
        >
          <Feather name="settings" size={16} color={colors.foreground} />
          <Text style={[ws.actionBtnText, { color: colors.foreground }]}>Open Health Connect Settings</Text>
        </TouchableOpacity>

        {/* Tertiary: Try Again */}
        <TouchableOpacity
          style={[ws.actionBtn, { backgroundColor: "#4285F418", borderWidth: 1, borderColor: "#4285F440" }]}
          onPress={() => {
            if (__DEV__) console.log("[HealthConnectSetup] try again tapped");
            void checkHCAvailability();
          }}
        >
          <Feather name="refresh-cw" size={16} color="#4285F4" />
          <Text style={[ws.actionBtnText, { color: "#4285F4" }]}>Try Again</Text>
        </TouchableOpacity>

        <View style={[ws.infoCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[ws.infoText, { color: colors.mutedForeground }]}>
            After installing Health Connect, return to Walk Champ and tap{" "}
            <Text style={{ fontWeight: "700" }}>Try Again</Text> to continue. The app will re-check automatically when you return.
          </Text>
        </View>
      </View>
    );
  };

  // ── Normal setup screens ───────────────────────────────────────────────────

  const AllowStepsScreen = () => (
    <View style={ws.content}>
      <View style={[ws.iconCircle, { backgroundColor: "#00E67618" }]}>
        <Feather name="check-square" size={36} color="#00E676" />
      </View>
      <Text style={[ws.title, { color: colors.foreground }]}>
        {isIOS
          ? "Allow Steps"
          : permStatus === "denied" ? "Step Permission Off" : "Enable Step Tracking"}
      </Text>
      <Text style={[ws.desc, { color: colors.mutedForeground }]}>
        {isIOS
          ? "Make sure Steps is on. WalkChamp uses this to track your race progress accurately."
          : permStatus === "denied"
            ? "Open Health Connect settings and allow Walk Champ to read Steps."
            : "Allow Walk Champ to read your steps from Health Connect."}
      </Text>
      {permStatus === "granted" ? (
        <View style={[ws.badge, { backgroundColor: "#00E67618", borderColor: "#00E67640", alignSelf: "center" }]}>
          <Feather name="check-circle" size={13} color="#00E676" />
          <Text style={[ws.badgeText, { color: "#00E676" }]}>Steps permission granted ✓</Text>
        </View>
      ) : (
        <TouchableOpacity
          style={[ws.actionBtn, { opacity: permLoading ? 0.6 : 1 }]}
          onPress={requestPerm}
          disabled={permLoading}
        >
          {permLoading
            ? <ActivityIndicator size="small" color="#000" />
            : <Feather name={permStatus === "denied" ? "settings" : "shield"} size={16} color="#000" />}
          <Text style={ws.actionBtnText}>
            {permStatus === "denied"
              ? (isIOS ? "Open Settings" : "Open Health Connect Settings")
              : (isIOS ? "Request Permission" : "Enable Step Tracking")}
          </Text>
        </TouchableOpacity>
      )}
      <View style={[ws.infoCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={[ws.infoText, { color: colors.mutedForeground }]}>
          {isIOS
            ? "Settings → Health → Data Access & Devices → Walk Champ → enable Steps."
            : "Health Connect → App permissions → Walk Champ → enable Steps read access."}
        </Text>
      </View>
    </View>
  );

  const DoneScreen = () => (
    <View style={[ws.content, { alignItems: "center" }]}>
      <View style={[ws.doneCircle, { backgroundColor: "#00E67620" }]}>
        <Feather name="check" size={52} color="#00E676" />
      </View>
      <Text style={[ws.title, { color: colors.foreground, textAlign: "center" }]}>You're set!</Text>
      <Text style={[ws.desc, { color: colors.mutedForeground, textAlign: "center" }]}>
        {isIOS
          ? "Your steps now count toward WalkChamp. Open the step tracking tile on the profile screen anytime to verify the totals."
          : "Your steps now count toward WalkChamp. You can open this step tracking setup anytime from your profile to verify your connection."}
      </Text>
      <View style={[ws.infoCard, { backgroundColor: "#00E67610", borderColor: "#00E67630" }]}>
        <Text style={[ws.infoText, { color: "#00E676", lineHeight: 26 }]}>
          {"✓  Steps sync to Walk tab\n✓  Leaderboards update\n✓  Goals and streaks tracked\n✓  Challenge progress counted"}
        </Text>
      </View>
    </View>
  );

  const IOS_SCREENS = [
    // 0: Connect to Apple Health
    () => (
      <View style={ws.content}>
        <View style={[ws.iconCircle, { backgroundColor: "#FF3B3018" }]}>
          <Feather name="heart" size={36} color="#FF3B30" />
        </View>
        <Text style={[ws.title, { color: colors.foreground }]}>Connect to Apple Health</Text>
        <Text style={[ws.desc, { color: colors.mutedForeground }]}>
          Tap Apple Health, then turn on Steps access.{"\n"}iOS will ask which data to share.
        </Text>
        <TouchableOpacity
          style={ws.actionBtn}
          onPress={() => Linking.openURL("x-apple-health://").catch(() => Linking.openSettings())}
        >
          <Feather name="external-link" size={16} color="#000" />
          <Text style={ws.actionBtnText}>Open Apple Health</Text>
        </TouchableOpacity>
      </View>
    ),
    // 1: Allow Steps
    AllowStepsScreen,
    // 2: Open Apple Health
    () => (
      <View style={ws.content}>
        <View style={[ws.iconCircle, { backgroundColor: "#34C75918" }]}>
          <Feather name="navigation" size={36} color="#34C759" />
        </View>
        <Text style={[ws.title, { color: colors.foreground }]}>Open Apple Health</Text>
        <Text style={[ws.desc, { color: colors.mutedForeground }]}>
          Health › Steps › Data Sources & Access.{"\n"}Your iPhone or wearable should appear in the list.
        </Text>
        <TouchableOpacity
          style={ws.actionBtn}
          onPress={() => Linking.openURL("x-apple-health://").catch(() => Linking.openSettings())}
        >
          <Feather name="external-link" size={16} color="#000" />
          <Text style={ws.actionBtnText}>Open Apple Health</Text>
        </TouchableOpacity>
        <View style={[ws.infoCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[ws.infoText, { color: colors.mutedForeground }]}>
            Browse → Activity → Steps → Data Sources & Access
          </Text>
        </View>
      </View>
    ),
    // 3: Prioritize Your Wearable
    () => (
      <View style={ws.content}>
        <View style={[ws.iconCircle, { backgroundColor: "#FFD70018" }]}>
          <Feather name="award" size={36} color="#FFD700" />
        </View>
        <Text style={[ws.title, { color: colors.foreground }]}>Prioritize your wearable</Text>
        <Text style={[ws.desc, { color: colors.mutedForeground }]}>
          Tap Edit, then drag your wearable above iPhone. This is optional, but it can improve accuracy.
        </Text>
        <View style={[ws.infoCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[ws.infoLabel, { color: colors.foreground }]}>Apple Health → Steps</Text>
          <Text style={[ws.infoText, { color: colors.mutedForeground }]}>1. Open Health → Browse → Activity → Steps</Text>
          <Text style={[ws.infoText, { color: colors.mutedForeground }]}>2. Tap Data Sources & Access</Text>
          <Text style={[ws.infoText, { color: colors.mutedForeground }]}>3. Tap Edit and drag your wearable above iPhone</Text>
        </View>
      </View>
    ),
    // 4: Done
    DoneScreen,
  ];

  const ANDROID_SCREENS = [
    // 0: Connect to Health Connect
    () => (
      <View style={ws.content}>
        <View style={[ws.iconCircle, { backgroundColor: "#4285F418" }]}>
          <Feather name="activity" size={36} color="#4285F4" />
        </View>
        <Text style={[ws.title, { color: colors.foreground }]}>Connect to Health Connect</Text>
        <Text style={[ws.desc, { color: colors.mutedForeground }]}>
          Tap Health Connect, then allow WalkChamp to read your step data.{"\n"}Android will ask which activity data to share.
        </Text>
        <TouchableOpacity
          style={ws.actionBtn}
          onPress={() => Linking.openURL("healthconnect://").catch(() => androidHCService.openSettings())}
        >
          <Feather name="external-link" size={16} color="#000" />
          <Text style={ws.actionBtnText}>Open Health Connect</Text>
        </TouchableOpacity>
      </View>
    ),
    // 1: Enable Step Tracking / Allow Steps
    AllowStepsScreen,
    // 2: Data Source Info
    () => (
      <View style={ws.content}>
        <View style={[ws.iconCircle, { backgroundColor: "#4285F418" }]}>
          <Feather name="database" size={36} color="#4285F4" />
        </View>
        <Text style={[ws.title, { color: colors.foreground }]}>Health Connect Data Source</Text>
        <Text style={[ws.desc, { color: colors.mutedForeground }]}>
          If you use multiple fitness apps or wearables, Health Connect may receive step data from more than one source. Choose the most accurate source in Health Connect settings when needed.
        </Text>
        <View style={[ws.infoCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[ws.infoLabel, { color: colors.foreground }]}>Health Connect</Text>
          <Text style={[ws.infoText, { color: colors.mutedForeground }]}>1. Open Health Connect → App permissions</Text>
          <Text style={[ws.infoText, { color: colors.mutedForeground }]}>2. Ensure your wearable app can write Steps</Text>
          <Text style={[ws.infoText, { color: colors.mutedForeground }]}>3. Check that your wearable app syncs to Health Connect</Text>
        </View>
      </View>
    ),
    // 3: Done
    DoneScreen,
  ];

  // ── Render ─────────────────────────────────────────────────────────────────

  const isAndroidPreCheck = !isIOS && androidPhase !== "setup";

  const renderPreCheckContent = () => {
    switch (androidPhase) {
      case "checking":      return <HCCheckingScreen />;
      case "expo_go":       return <HCExpoGoScreen />;
      case "not_supported": return <HCUnsupportedScreen />;
      case "install":       return <HCInstallScreen />;
      default:              return null;
    }
  };

  const SCREENS = isIOS ? IOS_SCREENS : ANDROID_SCREENS;
  const CurrentScreen = SCREENS[step];

  const headerTitle =
    isIOS                                        ? "Apple Health Setup" :
    androidPhase === "checking"                  ? "Health Connect"     :
    androidPhase === "expo_go" ||
    androidPhase === "not_supported"             ? "Step Tracking"      :
                                                   "Health Connect Setup";

  const footerLabel = isAndroidPreCheck
    ? (androidPhase === "install" ? "Not Now" : "Close")
    : isLast ? "Done" : "Next";

  const footerAction = isAndroidPreCheck ? onClose : isLast ? handleDone : goNext;
  const showFooter   = androidPhase !== "checking";
  const showBackBtn  = !isAndroidPreCheck && step > 0;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={[ws.container, { backgroundColor: colors.background }]}>

        {/* Header */}
        <View style={[ws.header, { paddingTop: safeTop + 16, borderBottomColor: colors.border }]}>
          <TouchableOpacity
            onPress={showBackBtn ? goBack : onClose}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Feather name={showBackBtn ? "arrow-left" : "x"} size={22} color={colors.foreground} />
          </TouchableOpacity>
          <Text style={[ws.headerTitle, { color: colors.foreground }]}>{headerTitle}</Text>
          <View style={{ width: 22 }} />
        </View>

        {/* Progress dots — only in the normal multi-step wizard */}
        {!isAndroidPreCheck && (
          <View style={ws.dots}>
            {Array.from({ length: isIOS ? TOTAL_IOS : TOTAL_ANDROID }).map((_, i) => (
              <View
                key={i}
                style={[ws.dot, {
                  backgroundColor: i === step ? "#00E676" : i < step ? "#00E67650" : colors.border,
                  width: i === step ? 20 : 8,
                }]}
              />
            ))}
          </View>
        )}

        {/* Content */}
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 24 }}>
          {isAndroidPreCheck
            ? renderPreCheckContent()
            : (CurrentScreen && <CurrentScreen />)
          }
        </ScrollView>

        {/* Footer */}
        {showFooter && (
          <View style={[ws.footer, { paddingBottom: safeBottom + 16, borderTopColor: colors.border }]}>
            <TouchableOpacity
              style={[ws.nextBtn, { opacity: saving ? 0.6 : 1 }]}
              onPress={footerAction}
              disabled={saving}
            >
              {saving
                ? <ActivityIndicator color="#000" />
                : <Text style={ws.nextBtnText}>{footerLabel}</Text>}
            </TouchableOpacity>
          </View>
        )}

      </View>
    </Modal>
  );
}

const ws = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 20, paddingBottom: 16, borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTitle: { fontSize: 17, fontWeight: "700" },
  dots: { flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 6, paddingVertical: 16 },
  dot: { height: 8, borderRadius: 4 },
  content: { paddingHorizontal: 24, paddingTop: 16, gap: 20 },
  iconCircle: { width: 80, height: 80, borderRadius: 40, alignItems: "center", justifyContent: "center", alignSelf: "center" },
  doneCircle: { width: 110, height: 110, borderRadius: 55, alignItems: "center", justifyContent: "center" },
  title: { fontSize: rf(24), fontWeight: "800", textAlign: "center" },
  desc: { fontSize: rf(15), lineHeight: 22, textAlign: "center" },
  badge: {
    flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start",
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, borderWidth: 1,
  },
  badgeText: { fontSize: rf(13), fontWeight: "600" },
  actionBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 8, paddingVertical: 14, borderRadius: 14, backgroundColor: "#00E676",
  },
  actionBtnText: { fontSize: rf(16), fontWeight: "700", color: "#000" },
  infoCard: { borderRadius: 14, borderWidth: 1, padding: 16, gap: 6 },
  infoLabel: { fontSize: rf(14), fontWeight: "700", marginBottom: 4 },
  infoText: { fontSize: rf(14), lineHeight: 22 },
  footer: { paddingHorizontal: 24, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth },
  nextBtn: { paddingVertical: 16, borderRadius: 16, alignItems: "center", backgroundColor: "#00E676" },
  nextBtnText: { fontSize: rf(17), fontWeight: "800", color: "#000" },
});
