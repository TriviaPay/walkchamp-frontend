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
import { SkeletonWearableCheck } from "@/components/SkeletonRows";
import { authFetch } from "@/utils/authFetch";
import { TouchableOpacity } from "@/components/HapticTouchableOpacity";
import { rf } from "@/utils/responsive";
import {
  androidHCService,
  isExpoGo,
  type HCAvailability,
} from "@/services/steps/androidHealthConnectService";
import { stepProviderManager } from "@/services/steps/stepProviderManager";
import { androidLegacySensorProvider } from "@/services/steps/providers/androidLegacySensorProvider";
import { useWalkContext } from "@/context/WalkContext";

const isIOS = Platform.OS === "ios";
const TOTAL_IOS = 5;
const TOTAL_ANDROID = 4;

type AndroidPhase =
  | "checking"
  | "expo_go"
  | "not_supported"
  | "install"
  | "legacy_ready"
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
  const { enableLimitedSensorTracking, requestStepPermission } = useWalkContext();

  const platform   = isIOS ? "ios_healthkit" : "android_health_connect";
  const healthName = isIOS ? "Apple Health"  : "Health Connect";

  const [step,           setStep]           = useState(0);
  const [permStatus,     setPermStatus]     = useState<"unknown" | "granted" | "denied" | "unavailable">("unknown");
  const [permLoading,    setPermLoading]    = useState(false);
  const [saving,         setSaving]         = useState(false);
  const [androidPhase,   setAndroidPhase]   = useState<AndroidPhase>("checking");
  const [hcAvailability, setHcAvailability] = useState<HCAvailability | null>(null);
  const [installLoading, setInstallLoading] = useState(false);
  const [limitedLoading, setLimitedLoading] = useState(false);

  const checkHCAvailability = useCallback(async () => {
    if (isIOS) return;
    if (isExpoGo()) {
      setAndroidPhase("expo_go");
      return;
    }
    setAndroidPhase("checking");
    try {
      const legacyOk = await androidLegacySensorProvider.isAvailable();
      const result = await androidHCService.initialize();
      setHcAvailability(result.availability);

      const hcBlocked = androidHCService.isRangeReadBlocked();
      if (
        hcBlocked ||
        (result.availability !== "available" || !result.initialized)
      ) {
        if (legacyOk) {
          setAndroidPhase("legacy_ready");
          return;
        }
      }

      if (result.availability === "available" && result.initialized && !hcBlocked) {
        if (result.permission !== "granted" && legacyOk) {
          setAndroidPhase("legacy_ready");
          return;
        }
        setAndroidPhase("setup");
        setStep(0);
        setPermStatus(
          result.permission === "granted" ? "granted" :
          result.permission === "denied"  ? "denied"  : "unknown",
        );
        return;
      }

      // HC not usable — prefer Android Steps when the device sensor is available.
      if (legacyOk) {
        setAndroidPhase("legacy_ready");
        return;
      }

      if (result.availability === "not_supported") {
        setAndroidPhase("not_supported");
      } else if (
        result.availability === "not_installed" ||
        result.availability === "needs_update"
      ) {
        setAndroidPhase("install");
      } else {
        setAndroidPhase("not_supported");
      }
    } catch {
      const legacyOk = await androidLegacySensorProvider.isAvailable().catch(() => false);
      setAndroidPhase(legacyOk ? "legacy_ready" : "not_supported");
    }
  }, []);

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

  useEffect(() => {
    if (!visible || isIOS || isExpoGo()) return;
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active" && androidPhase === "install") {
        void checkHCAvailability();
      }
    });
    return () => sub.remove();
  }, [visible, androidPhase, checkHCAvailability]);

  const checkPerm = useCallback(async () => {
    try {
      if (isIOS) {
        const { stepTracker } = await import("@/services/StepTrackingService");
        const s = await stepTracker.getPermissionStatus();
        setPermStatus(s as typeof permStatus);
      } else {
        const s = await stepProviderManager.refreshStatus();
        setPermStatus(
          s.permission === "granted"
            ? "granted"
            : s.permission === "denied"
              ? "denied"
              : "unknown",
        );
      }
    } catch { setPermStatus("unknown"); }
  }, []);

  const grantAndroidSteps = async (): Promise<boolean> => {
    try {
      await requestStepPermission();
      const s = await stepProviderManager.refreshStatus();
      const granted = s.permission === "granted";
      if (granted) {
        setPermStatus("granted");
        setAndroidPhase("setup");
        setStep(TOTAL_ANDROID - 1);
      }
      return granted;
    } catch (e) {
      if (__DEV__) console.log("[WearableSetup] grantAndroidSteps error", e);
      return false;
    }
  };

  const requestPerm = async () => {
    if (permStatus === "denied") {
      if (isIOS) {
        Linking.openSettings();
      } else {
        void requestStepPermission();
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
        onClose();
        await new Promise((r) => setTimeout(r, 400));
        await grantAndroidSteps();
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

  const goNext = () => setStep(s => Math.min(s + 1, (isIOS ? TOTAL_IOS : TOTAL_ANDROID) - 1));
  const goBack = () => setStep(s => Math.max(s - 1, 0));
  const isLast = step === (isIOS ? TOTAL_IOS : TOTAL_ANDROID) - 1;

  const HCCheckingScreen = () => <SkeletonWearableCheck />;

  const HCExpoGoScreen = () => (
    <View style={ws.content}>
      <View style={[ws.iconCircle, { backgroundColor: "#FFD70018" }]}>
        <Feather name="smartphone" size={36} color="#FFD700" />
      </View>
      <Text style={[ws.title, { color: colors.foreground }]}>Standalone Build Required</Text>
      <Text style={[ws.desc, { color: colors.mutedForeground }]}>
        Step tracking requires the installed Android app. It does not work in Expo Go.
      </Text>
    </View>
  );

  const HCLegacyReadyScreen = () => (
    <View style={ws.content}>
      <View style={[ws.iconCircle, { backgroundColor: "#00E67618" }]}>
        <Feather name="activity" size={36} color="#00E676" />
      </View>
      <Text style={[ws.title, { color: colors.foreground }]}>Step Tracking Ready</Text>
      <Text style={[ws.desc, { color: colors.mutedForeground }]}>
        This device will use Android Steps (phone sensor). Tap Enable — no Health Connect required.
      </Text>
      <TouchableOpacity
        style={[ws.actionBtn, { opacity: limitedLoading ? 0.6 : 1 }]}
        onPress={async () => {
          setLimitedLoading(true);
          try {
            await grantAndroidSteps();
          } finally {
            setLimitedLoading(false);
          }
        }}
        disabled={limitedLoading}
      >
        {limitedLoading
          ? <ActivityIndicator size="small" color="#000" />
          : <Feather name="check-circle" size={16} color="#000" />}
        <Text style={ws.actionBtnText}>Enable Step Tracking</Text>
      </TouchableOpacity>
    </View>
  );

  const HCUnsupportedScreen = () => (
    <View style={ws.content}>
      <View style={[ws.iconCircle, { backgroundColor: colors.destructive + "18" }]}>
        <Feather name="alert-circle" size={36} color={colors.destructive} />
      </View>
      <Text style={[ws.title, { color: colors.foreground }]}>Step Tracking Unavailable</Text>
      <Text style={[ws.desc, { color: colors.mutedForeground }]}>
        Step tracking is not available on this device.
      </Text>
      <TouchableOpacity
        style={[ws.actionBtn, { opacity: limitedLoading ? 0.6 : 1, backgroundColor: "#F59E0B" }]}
        onPress={async () => {
          setLimitedLoading(true);
          try {
            await enableLimitedSensorTracking();
            setPermStatus("granted");
            setAndroidPhase("setup");
            setStep(TOTAL_ANDROID - 1);
          } finally {
            setLimitedLoading(false);
          }
        }}
        disabled={limitedLoading}
      >
        {limitedLoading
          ? <ActivityIndicator size="small" color="#000" />
          : <Feather name="activity" size={16} color="#000" />}
        <Text style={ws.actionBtnText}>Use Android Steps</Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={[ws.actionBtn, { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border }]}
        onPress={() => void checkHCAvailability()}
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
            : "Walk Champ uses Health Connect to read your verified steps for challenges, races, and leaderboards."}
        </Text>
        <TouchableOpacity
          style={[ws.actionBtn, { opacity: installLoading ? 0.6 : 1 }]}
          onPress={async () => {
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
        <TouchableOpacity
          style={[ws.actionBtn, { opacity: limitedLoading ? 0.6 : 1, backgroundColor: "#00E676", marginTop: 8 }]}
          onPress={async () => {
            setLimitedLoading(true);
            try {
              await grantAndroidSteps();
            } finally {
              setLimitedLoading(false);
            }
          }}
          disabled={limitedLoading}
        >
          {limitedLoading
            ? <ActivityIndicator size="small" color="#000" />
            : <Feather name="activity" size={16} color="#000" />}
          <Text style={ws.actionBtnText}>Use Android Steps Instead</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[ws.actionBtn, { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border }]}
          onPress={() => void checkHCAvailability()}
        >
          <Feather name="refresh-cw" size={16} color="#4285F4" />
          <Text style={[ws.actionBtnText, { color: "#4285F4" }]}>Try Again</Text>
        </TouchableOpacity>
      </View>
    );
  };

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
            ? "Tap Enable Step Tracking again, or open Health Connect settings and allow Steps."
            : "Tap Enable Step Tracking. A permission sheet should appear inside Walk Champ."}
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
              ? (isIOS ? "Open Settings" : "Enable Step Tracking")
              : (isIOS ? "Request Permission" : "Enable Step Tracking")}
          </Text>
        </TouchableOpacity>
      )}
      {!isIOS && (
        <View style={[ws.infoCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[ws.infoText, { color: colors.mutedForeground }]}>
            After allowing, Walk Champ appears under Health Connect → App permissions.
          </Text>
        </View>
      )}
    </View>
  );

  const DoneScreen = () => (
    <View style={[ws.content, { alignItems: "center" }]}>
      <View style={[ws.doneCircle, { backgroundColor: "#00E67620" }]}>
        <Feather name="check" size={52} color="#00E676" />
      </View>
      <Text style={[ws.title, { color: colors.foreground, textAlign: "center" }]}>You're set!</Text>
      <Text style={[ws.desc, { color: colors.mutedForeground, textAlign: "center" }]}>
        Your steps now count toward WalkChamp.
      </Text>
    </View>
  );

  const IOS_SCREENS = [
    () => (
      <View style={ws.content}>
        <View style={[ws.iconCircle, { backgroundColor: "#FF3B3018" }]}>
          <Feather name="heart" size={36} color="#FF3B30" />
        </View>
        <Text style={[ws.title, { color: colors.foreground }]}>Connect to Apple Health</Text>
        <Text style={[ws.desc, { color: colors.mutedForeground }]}>
          Tap Apple Health, then turn on Steps access.
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
    AllowStepsScreen,
    () => (
      <View style={ws.content}>
        <View style={[ws.iconCircle, { backgroundColor: "#34C75918" }]}>
          <Feather name="navigation" size={36} color="#34C759" />
        </View>
        <Text style={[ws.title, { color: colors.foreground }]}>Open Apple Health</Text>
        <Text style={[ws.desc, { color: colors.mutedForeground }]}>
          Health › Steps › Data Sources & Access.
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
    () => (
      <View style={ws.content}>
        <View style={[ws.iconCircle, { backgroundColor: "#FFD70018" }]}>
          <Feather name="award" size={36} color="#FFD700" />
        </View>
        <Text style={[ws.title, { color: colors.foreground }]}>Prioritize your wearable</Text>
        <Text style={[ws.desc, { color: colors.mutedForeground }]}>
          Drag your wearable above iPhone in Health Connect data sources (optional).
        </Text>
      </View>
    ),
    DoneScreen,
  ];

  const ANDROID_SCREENS = [
    () => (
      <View style={ws.content}>
        <View style={[ws.iconCircle, { backgroundColor: "#4285F418" }]}>
          <Feather name="activity" size={36} color="#4285F4" />
        </View>
        <Text style={[ws.title, { color: colors.foreground }]}>Connect to Health Connect</Text>
        <Text style={[ws.desc, { color: colors.mutedForeground }]}>
          Walk Champ reads verified steps from Health Connect for races and leaderboards.
        </Text>
      </View>
    ),
    AllowStepsScreen,
    () => (
      <View style={ws.content}>
        <View style={[ws.iconCircle, { backgroundColor: "#4285F418" }]}>
          <Feather name="database" size={36} color="#4285F4" />
        </View>
        <Text style={[ws.title, { color: colors.foreground }]}>Sync Your Wearable</Text>
        <Text style={[ws.desc, { color: colors.mutedForeground }]}>
          Ensure Samsung Health, Google Fit, or your wearable app writes Steps to Health Connect.
        </Text>
      </View>
    ),
    DoneScreen,
  ];

  const isAndroidPreCheck = !isIOS && androidPhase !== "setup";
  const SCREENS = isIOS ? IOS_SCREENS : ANDROID_SCREENS;
  const CurrentScreen = SCREENS[step];

  const renderPreCheckContent = () => {
    switch (androidPhase) {
      case "checking":      return <HCCheckingScreen />;
      case "expo_go":       return <HCExpoGoScreen />;
      case "legacy_ready":  return <HCLegacyReadyScreen />;
      case "not_supported": return <HCUnsupportedScreen />;
      case "install":       return <HCInstallScreen />;
      default:              return null;
    }
  };

  const headerTitle =
    isIOS ? "Apple Health Setup" :
    androidPhase === "checking" ? "Health Connect" :
    androidPhase === "expo_go" || androidPhase === "not_supported" || androidPhase === "legacy_ready"
      ? "Step Tracking"
      : "Health Connect Setup";

  const footerLabel = isAndroidPreCheck
    ? (androidPhase === "install" ? "Not Now" : "Close")
    : isLast ? "Done" : "Next";

  const footerAction = isAndroidPreCheck ? onClose : isLast ? handleDone : goNext;
  const showFooter = androidPhase !== "checking";
  const showBackBtn = !isAndroidPreCheck && step > 0;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={[ws.container, { backgroundColor: colors.background }]}>
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

        <ScrollView showsVerticalScrollIndicator={false} nestedScrollEnabled contentContainerStyle={{ paddingBottom: 24 }}>
          {isAndroidPreCheck
            ? renderPreCheckContent()
            : (CurrentScreen && <CurrentScreen />)}
        </ScrollView>

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
    flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "center",
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, borderWidth: 1,
  },
  badgeText: { fontSize: rf(13), fontWeight: "600" },
  actionBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 8, paddingVertical: 14, borderRadius: 14, backgroundColor: "#00E676",
  },
  actionBtnText: { fontSize: rf(16), fontWeight: "700", color: "#000" },
  infoCard: { borderRadius: 14, borderWidth: 1, padding: 16, gap: 6 },
  infoText: { fontSize: rf(14), lineHeight: 22 },
  footer: { paddingHorizontal: 24, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth },
  nextBtn: { paddingVertical: 16, borderRadius: 16, alignItems: "center", backgroundColor: "#00E676" },
  nextBtnText: { fontSize: rf(17), fontWeight: "800", color: "#000" },
});
