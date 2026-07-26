import React, { useCallback, useEffect, useRef, useState } from "react";
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
import { LinearGradient } from "expo-linear-gradient";
import { MODAL_MAX_WIDTH, rf, rs } from "@/utils/responsive";
import { ONBOARDING_COLORS } from "@/constants/onboarding";
import {
  androidHCService,
  isExpoGo,
  type HCAvailability,
} from "@/services/steps/androidHealthConnectService";
import { stepProviderManager } from "@/services/steps/stepProviderManager";
import { androidLegacySensorProvider } from "@/services/steps/providers/androidLegacySensorProvider";
import { useWalkContext } from "@/context/WalkContext";
import { FEATURE_FLAGS } from "@/config/featureFlags";

const isIOS = Platform.OS === "ios";
const TOTAL_IOS = 5;
const TOTAL_ANDROID = 4;
const ONBOARDING_BTN = [ONBOARDING_COLORS.cyan, ONBOARDING_COLORS.primary] as const;
/** Hybrid: daily requires Health Connect — never offer phone-sensor daily fallback in setup. */
const hybridDailyHcOnly = () =>
  FEATURE_FLAGS.ENABLE_LIVE_RACE_DEVICE_SENSOR === true;

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
  /** Match premium onboarding primary button (cyan → blue). Default matches onboarding. */
  accent?: "default" | "onboarding";
}

export default function WearableSetupModal({
  visible, onClose, onComplete, accent = "onboarding",
}: Props) {
  const colors = useColors();
  const { safeTop, safeBottom } = useSafeLayout();
  const { enableLimitedSensorTracking } = useWalkContext();

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
  /** True after Enable Step Tracking succeeded this open — survives stale HC "unknown" cache. */
  const stepsGrantedThisSessionRef = useRef(false);
  const useOnboardingAccent = accent === "onboarding";
  const actionIconColor = useOnboardingAccent ? "#FFF" : "#000";
  const actionTextColor = useOnboardingAccent ? "#FFF" : "#000";

  const PrimaryAction = ({
    onPress,
    disabled,
    loading,
    icon,
    label,
    solidColor,
  }: {
    onPress: () => void;
    disabled?: boolean;
    loading?: boolean;
    icon: React.ComponentProps<typeof Feather>["name"];
    label: string;
    /** Non-onboarding solid fill (e.g. amber fallback). Ignored when onboarding accent. */
    solidColor?: string;
  }) => (
    <TouchableOpacity
      style={[
        ws.actionBtn,
        !useOnboardingAccent && { backgroundColor: solidColor ?? "#00E676" },
        useOnboardingAccent && { backgroundColor: "transparent", paddingVertical: 0 },
        { opacity: disabled || loading ? 0.6 : 1 },
      ]}
      onPress={onPress}
      disabled={disabled || loading}
      activeOpacity={0.88}
    >
      {useOnboardingAccent ? (
        <LinearGradient
          colors={[...ONBOARDING_BTN]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={ws.actionBtnGrad}
        >
          {loading
            ? <ActivityIndicator size="small" color={actionIconColor} />
            : <Feather name={icon} size={16} color={actionIconColor} />}
          <Text style={[ws.actionBtnText, { color: actionTextColor }]}>{label}</Text>
        </LinearGradient>
      ) : (
        <>
          {loading
            ? <ActivityIndicator size="small" color={actionIconColor} />
            : <Feather name={icon} size={16} color={actionIconColor} />}
          <Text style={[ws.actionBtnText, { color: actionTextColor }]}>{label}</Text>
        </>
      )}
    </TouchableOpacity>
  );

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
      const hcUsable =
        !hcBlocked &&
        result.availability === "available" &&
        result.initialized;

      // Prefer Health Connect setup when HC is usable — do not divert to
      // Android Steps solely because Steps permission is not granted yet.
      if (hcUsable) {
        setAndroidPhase("setup");
        setStep(0);
        setPermStatus(
          result.permission === "granted"
            ? "granted"
            : result.permission === "denied"
              ? "denied"
              : "unknown",
        );
        return;
      }

      // Guide install / update first — same as previous HC setup flow.
      if (
        result.availability === "not_installed" ||
        result.availability === "needs_update"
      ) {
        setAndroidPhase("install");
        return;
      }

      if (result.availability === "not_supported") {
        setAndroidPhase("not_supported");
        return;
      }

      // Non-hybrid only: phone sensor daily fallback when HC is unusable.
      if (!hybridDailyHcOnly() && legacyOk) {
        setAndroidPhase("legacy_ready");
        return;
      }

      setAndroidPhase("not_supported");
    } catch {
      const legacyOk = await androidLegacySensorProvider.isAvailable().catch(() => false);
      if (!hybridDailyHcOnly() && legacyOk) {
        setAndroidPhase("legacy_ready");
        return;
      }
      setAndroidPhase("not_supported");
    }
  }, []);

  useEffect(() => {
    if (visible) {
      setStep(0);
      setSaving(false);
      setPermLoading(false);
      setInstallLoading(false);
      stepsGrantedThisSessionRef.current = false;
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
      const result = await stepProviderManager.requestStepPermission();
      // Prefer the request result — do not invalidate HC cache here (that wiped
      // the fresh "granted" write and left Done reading stale "unknown").
      let live: "unknown" | "granted" | "denied" | "unavailable" = "unknown";
      if (result.status === "granted") {
        live = "granted";
      } else {
        live = await resolveLivePermStatus();
      }
      const granted = live === "granted" || result.status === "granted";
      if (granted) {
        stepsGrantedThisSessionRef.current = true;
        setPermStatus("granted");
        setAndroidPhase("setup");
        // Advance past Allow Steps so Next/Done do not bounce back to step 1.
        setStep(Math.max(2, TOTAL_ANDROID - 2));
      } else {
        setPermStatus(
          live === "denied" || result.status === "denied" ? "denied" : live,
        );
        if (__DEV__) {
          console.log(
            `[WearableSetup] grantAndroidSteps status=${result.status} live=${live} provider=${result.providerId ?? "none"} msg=${result.message ?? ""}`,
          );
        }
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
        setPermLoading(true);
        try {
          await grantAndroidSteps();
        } finally {
          setPermLoading(false);
        }
      }
      return;
    }
    setPermLoading(true);
    try {
      if (isIOS) {
        // Use the same provider path as WalkContext so HealthKit grant
        // activates tracking consistently after first install.
        const result = await stepProviderManager.requestStepPermission();
        const live = await resolveLivePermStatus();
        const granted = live === "granted" || result.status === "granted";
        setPermStatus(
          granted
            ? "granted"
            : live === "denied" || result.status === "denied"
              ? "denied"
              : live === "unavailable" || result.status === "unavailable"
                ? "unavailable"
                : "unknown",
        );
        if (granted) {
          stepsGrantedThisSessionRef.current = true;
          setStep(Math.max(2, TOTAL_IOS - 2));
        }
      } else {
        await grantAndroidSteps();
      }
    } catch { /* ignore */ }
    finally { setPermLoading(false); }
  };

  const resolveLivePermStatus = async (): Promise<"unknown" | "granted" | "denied" | "unavailable"> => {
    try {
      if (isIOS) {
        const { stepTracker } = await import("@/services/StepTrackingService");
        const s = await stepTracker.getPermissionStatus();
        return (s as typeof permStatus) ?? "unknown";
      }
      const s = await stepProviderManager.refreshStatus();
      if (s.permission === "granted") return "granted";
      if (s.permission === "denied") return "denied";
      return "unknown";
    } catch {
      return permStatus;
    }
  };

  const handleDone = async () => {
    setSaving(true);
    try {
      // If Enable already succeeded this session, finish as connected even when
      // HC/provider caches still briefly report "unknown".
      if (stepsGrantedThisSessionRef.current || permStatus === "granted") {
        const resolvedStatus = "connected";
        try {
          await authFetch("/api/me/step-source", {
            method: "POST",
            body: JSON.stringify({
              platform,
              permission_status: resolvedStatus,
              source_name: healthName,
              setup_completed: true,
            }),
          });
        } catch { /* ignore network — still update local UI */ }

        if (!isIOS && Platform.OS === "android") {
          try {
            const { hasActivityRecognitionPermission } = await import(
              "@/services/permissions/activityRecognitionPermissionService"
            );
            const arOk = await hasActivityRecognitionPermission();
            if (__DEV__) {
              console.log(
                `[WearableSetup] Done — activityRecognition alreadyGranted=${arOk} (no re-prompt)`,
              );
            }
          } catch {
            /* ignore */
          }
        }

        onComplete?.(platform, resolvedStatus);
        onClose();
        return;
      }

      // No in-session grant — re-check OS permission (user may have skipped Enable).
      if (!isIOS) {
        try {
          androidHCService.invalidateCachesForForeground();
        } catch {
          /* ignore */
        }
      }

      let live = await resolveLivePermStatus();
      setPermStatus(live);

      if (live !== "granted" && live !== "denied") {
        for (const waitMs of [400, 800]) {
          await new Promise((r) => setTimeout(r, waitMs));
          try {
            androidHCService.invalidateCachesForForeground();
          } catch {
            /* ignore */
          }
          live = await resolveLivePermStatus();
          if (live === "granted" || live === "denied") break;
        }
        setPermStatus(live);
      }

      if (live !== "granted" && live !== "denied") {
        setSaving(false);
        setStep(1); // Allow Steps screen — ask them to Enable again
        return;
      }

      const resolvedStatus = live === "granted" ? "connected" : "denied";
      try {
        await authFetch("/api/me/step-source", {
          method: "POST",
          body: JSON.stringify({
            platform,
            permission_status: resolvedStatus,
            source_name: healthName,
            setup_completed: true,
          }),
        });
      } catch { /* ignore network — still update local UI */ }

      onComplete?.(platform, resolvedStatus);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const goNext = async () => {
    // On the Allow Steps step, require a live grant before continuing so Done
    // cannot mark setup complete while Profile still shows "Tap to connect".
    const allowStepsIndex = 1;
    if (step === allowStepsIndex) {
      let live = await resolveLivePermStatus();
      setPermStatus(live);
      if (live !== "granted") {
        // Don't silently no-op (feels like Next is broken / looping).
        // Kick Enable once; if still not granted, stay here with clear CTA.
        if (!permLoading) {
          await requestPerm();
          live = await resolveLivePermStatus();
          setPermStatus(live);
        }
        if (live !== "granted") return;
      }
    }
    setStep(s => Math.min(s + 1, (isIOS ? TOTAL_IOS : TOTAL_ANDROID) - 1));
  };
  const goBack = () => setStep(s => Math.max(s - 1, 0));
  const isLast = step === (isIOS ? TOTAL_IOS : TOTAL_ANDROID) - 1;

  const tryLimitedSensor = async (): Promise<boolean> => {
    setLimitedLoading(true);
    try {
      const ok = await enableLimitedSensorTracking();
      if (!ok) return false;
      stepsGrantedThisSessionRef.current = true;
      setPermStatus("granted");
      setAndroidPhase("setup");
      setStep(TOTAL_ANDROID - 1);
      return true;
    } finally {
      setLimitedLoading(false);
    }
  };

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
      <PrimaryAction
        onPress={() => void tryLimitedSensor()}
        disabled={limitedLoading}
        loading={limitedLoading}
        icon="check-circle"
        label="Enable Step Tracking"
      />
    </View>
  );

  const HCUnsupportedScreen = () => (
    <View style={ws.content}>
      <View style={[ws.iconCircle, { backgroundColor: colors.destructive + "18" }]}>
        <Feather name="alert-circle" size={36} color={colors.destructive} />
      </View>
      <Text style={[ws.title, { color: colors.foreground }]}>Step Tracking Unavailable</Text>
      <Text style={[ws.desc, { color: colors.mutedForeground }]}>
        {hybridDailyHcOnly()
          ? "Health Connect is required for verified step tracking on this device."
          : "Step tracking is not available on this device."}
      </Text>
      {!hybridDailyHcOnly() ? (
        <PrimaryAction
          onPress={() => void tryLimitedSensor()}
          disabled={limitedLoading}
          loading={limitedLoading}
          icon="activity"
          label="Use Android Steps"
          solidColor="#F59E0B"
        />
      ) : null}
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
        <PrimaryAction
          onPress={() => {
            void (async () => {
              setInstallLoading(true);
              await androidHCService.openInstallPage();
              setInstallLoading(false);
            })();
          }}
          disabled={installLoading}
          loading={installLoading}
          icon="download"
          label={isUpdate ? "Update Health Connect" : "Install Health Connect"}
        />
        {!hybridDailyHcOnly() ? (
          <View style={{ marginTop: 8 }}>
            <PrimaryAction
              onPress={() => void tryLimitedSensor()}
              disabled={limitedLoading}
              loading={limitedLoading}
              icon="activity"
              label="Use Android Steps Instead"
            />
          </View>
        ) : null}
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
            : "Tap Enable Step Tracking to allow Health Connect Steps. Physical activity and notifications are asked once when you tap Done."}
      </Text>
      {permStatus === "granted" ? (
        <View style={[ws.badge, { backgroundColor: "#00E67618", borderColor: "#00E67640", alignSelf: "center" }]}>
          <Feather name="check-circle" size={13} color="#00E676" />
          <Text style={[ws.badgeText, { color: "#00E676" }]}>Steps permission granted ✓</Text>
        </View>
      ) : (
        <PrimaryAction
          onPress={requestPerm}
          disabled={permLoading}
          loading={permLoading}
          icon={permStatus === "denied" ? "settings" : "shield"}
          label={
            permStatus === "denied"
              ? (isIOS ? "Open Settings" : "Enable Step Tracking")
              : (isIOS ? "Request Permission" : "Enable Step Tracking")
          }
        />
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
        Your steps now count toward WalkChamp. Tap Done to finish — notifications can be changed anytime in Profile.
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
        <PrimaryAction
          onPress={() => Linking.openURL("x-apple-health://").catch(() => Linking.openSettings())}
          icon="external-link"
          label="Open Apple Health"
        />
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
        <PrimaryAction
          onPress={() => Linking.openURL("x-apple-health://").catch(() => Linking.openSettings())}
          icon="external-link"
          label="Open Apple Health"
        />
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
  const activeDot = useOnboardingAccent ? ONBOARDING_COLORS.lime : "#00E676";
  const doneDot = useOnboardingAccent ? ONBOARDING_COLORS.cyan + "80" : "#00E67650";

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={[ws.container, { backgroundColor: colors.background }]}>
        <View style={[ws.sheet, { maxWidth: MODAL_MAX_WIDTH }]}>
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
                  backgroundColor: i === step ? activeDot : i < step ? doneDot : colors.border,
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
              style={[
                ws.nextBtn,
                !useOnboardingAccent && { backgroundColor: "#00E676", paddingVertical: 16 },
                { opacity: saving ? 0.6 : 1 },
              ]}
              onPress={footerAction}
              disabled={saving}
              activeOpacity={0.88}
            >
              {useOnboardingAccent ? (
                <LinearGradient
                  colors={[...ONBOARDING_BTN]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={ws.nextBtnGrad}
                >
                  {saving
                    ? <ActivityIndicator color="#FFF" />
                    : <Text style={[ws.nextBtnText, { color: "#FFF" }]}>{footerLabel}</Text>}
                </LinearGradient>
              ) : saving
                ? <ActivityIndicator color="#000" />
                : <Text style={ws.nextBtnText}>{footerLabel}</Text>}
            </TouchableOpacity>
          </View>
        )}
        </View>
      </View>
    </Modal>
  );
}

const ws = StyleSheet.create({
  container: { flex: 1, alignItems: "center" },
  sheet: { flex: 1, width: "100%", alignSelf: "center" },
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: rs(20), paddingBottom: rs(16), borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTitle: { fontSize: rf(17), fontWeight: "700" },
  dots: { flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 6, paddingVertical: rs(16) },
  dot: { height: 8, borderRadius: 4 },
  content: { paddingHorizontal: rs(24), paddingTop: rs(16), gap: rs(20) },
  iconCircle: { width: rs(80), height: rs(80), borderRadius: rs(40), alignItems: "center", justifyContent: "center", alignSelf: "center" },
  doneCircle: { width: rs(110), height: rs(110), borderRadius: rs(55), alignItems: "center", justifyContent: "center" },
  title: { fontSize: rf(24), fontWeight: "800", textAlign: "center" },
  desc: { fontSize: rf(15), lineHeight: rf(22), textAlign: "center" },
  badge: {
    flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "center",
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, borderWidth: 1,
  },
  badgeText: { fontSize: rf(13), fontWeight: "600" },
  actionBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 8, paddingVertical: rs(14), borderRadius: rs(14), backgroundColor: "#00E676",
    overflow: "hidden",
  },
  actionBtnGrad: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    width: "100%",
    paddingVertical: rs(14),
    paddingHorizontal: rs(16),
    borderRadius: rs(14),
  },
  actionBtnText: { fontSize: rf(16), fontWeight: "700", color: "#000" },
  infoCard: { borderRadius: rs(14), borderWidth: 1, padding: rs(16), gap: 6 },
  infoText: { fontSize: rf(14), lineHeight: rf(22) },
  footer: { paddingHorizontal: rs(24), paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth },
  nextBtn: { borderRadius: 16, alignItems: "center", overflow: "hidden", minHeight: 54 },
  nextBtnGrad: {
    minHeight: 54,
    width: "100%",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 16,
    paddingHorizontal: 16,
  },
  nextBtnText: { fontSize: rf(17), fontWeight: "800", color: "#000" },
});
