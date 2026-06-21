/**
 * AndroidStepTrackingSetup
 *
 * Handles 5 setup states:
 *  A — Health Connect available (ready / permission / granted)
 *  B — Health Connect needs install/update
 *  C — HC unsupported; show optional fitness apps with honest status
 *  D — No verified source; offer limited TYPE_STEP_COUNTER fallback
 *  E — Nothing available
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { TouchableOpacity } from "@/components/HapticTouchableOpacity";
import { useColors } from "@/hooks/useColors";
import { SkeletonWearableCheck } from "@/components/SkeletonRows";
import { rf } from "@/utils/responsive";
import { androidHCService } from "@/services/steps/androidHealthConnectService";
import {
  enableAndroidStepTracking,
  getAndroidStepTrackingStatus,
  refreshAndroidStepTrackingStatus,
  type AndroidStepTrackingStatusResult,
} from "@/services/steps/androidStepTrackingStatus";
import {
  detectAndroidStepSources,
  getStaticFallbackFitnessApps,
  type AndroidStepSourceDetectionResult,
  type DetectedOptionalSource,
} from "@/services/steps/androidSourceDetection";
import { androidDeviceSensorService } from "@/services/steps/androidDeviceSensorService";
import type { AndroidSetupUIState, AndroidStepTrackingStatus } from "@/services/steps/androidStepTrackingMappings";

// ── Props ──────────────────────────────────────────────────────────────────────

interface Props {
  active?: boolean;
  onStatusChange?: (result: AndroidStepTrackingStatusResult) => void;
  onPermissionGranted?: () => void;
  /** Called when user enables limited sensor mode. */
  onLimitedSensorEnabled?: () => void;
}

// ── Component ──────────────────────────────────────────────────────────────────

export default function AndroidStepTrackingSetup({
  active = true,
  onStatusChange,
  onPermissionGranted,
  onLimitedSensorEnabled,
}: Props) {
  const colors = useColors();
  const [uiState, setUiState] = useState<AndroidSetupUIState>("checking");
  const [status, setStatus] = useState<AndroidStepTrackingStatus | null>(null);
  const [detection, setDetection] = useState<AndroidStepSourceDetectionResult | null>(null);
  const [loadingMain, setLoadingMain] = useState(false);
  const [loadingInstall, setLoadingInstall] = useState(false);
  const [loadingLimited, setLoadingLimited] = useState(false);
  const hasDetectedRef = useRef(false);

  // ── Apply result from HC status check ───────────────────────────────────────

  const applyHCResult = useCallback(
    (result: AndroidStepTrackingStatusResult, det: AndroidStepSourceDetectionResult | null) => {
      setStatus(result.status);
      onStatusChange?.(result);
      if (result.status === "permission_granted") {
        setUiState("granted");
        onPermissionGranted?.();
        return;
      }
      if (result.status === "permission_denied") {
        setUiState("permission");
        return;
      }
      if (result.status === "available") {
        setUiState("ready");
        return;
      }
      if (
        result.status === "unsupported" ||
        result.status === "error" ||
        result.status === "expo_go"
      ) {
        setUiState("optional_apps");
        return;
      }
      // HC install/update still available on device
      if (
        result.status === "provider_update_required" ||
        result.status === "provider_not_installed"
      ) {
        setUiState("install_update");
        return;
      }
      setUiState("fully_unsupported");
    },
    [onStatusChange, onPermissionGranted],
  );

  // ── Run full detection ───────────────────────────────────────────────────────

  const runDetection = useCallback(async () => {
    if (!hasDetectedRef.current) setUiState("checking");
    const [hcResult, det] = await Promise.all([
      getAndroidStepTrackingStatus(),
      detectAndroidStepSources(),
    ]);
    hasDetectedRef.current = true;
    setDetection(det);
    applyHCResult(hcResult, det);
  }, [applyHCResult]);

  const runRefresh = useCallback(async () => {
    setUiState("checking");
    const hcResult = await refreshAndroidStepTrackingStatus();
    const det = await detectAndroidStepSources();
    setDetection(det);
    applyHCResult(hcResult, det);
  }, [applyHCResult]);

  useEffect(() => {
    if (!active) {
      hasDetectedRef.current = false;
      return;
    }
    void runDetection();
  }, [active, runDetection]);

  // ── Actions ──────────────────────────────────────────────────────────────────

  const handleEnableHC = async () => {
    setLoadingMain(true);
    try {
      const current = await getAndroidStepTrackingStatus();
      if (
        current.status === "provider_not_installed" ||
        current.status === "provider_update_required"
      ) {
        await androidHCService.openInstallPage();
        applyHCResult(current, detection ?? await detectAndroidStepSources());
        return;
      }
      const result = await enableAndroidStepTracking();
      const det = detection ?? await detectAndroidStepSources();
      setDetection(det);
      applyHCResult(result, det);
    } finally {
      setLoadingMain(false);
    }
  };

  const handleInstallHC = async () => {
    setLoadingInstall(true);
    try {
      await androidHCService.openInstallPage();
    } finally {
      setLoadingInstall(false);
    }
  };

  const handleEnableLimited = async () => {
    setLoadingLimited(true);
    try {
      const granted = await androidDeviceSensorService.requestPermission();
      if (granted === "granted") {
        onLimitedSensorEnabled?.();
      }
    } finally {
      setLoadingLimited(false);
    }
  };

  // ── Render ───────────────────────────────────────────────────────────────────

  const hcGuide = uiState === "ready" || uiState === "permission" || uiState === "install_update" ? (
    <HcSetupGuide colors={colors} showManualSteps={uiState === "permission"} />
  ) : null;

  const fallbackPanel =
    detection &&
    uiState !== "checking" &&
    uiState !== "granted" ? (
      <FallbackOptions
        detection={detection}
        onLimitedPress={handleEnableLimited}
        limitedLoading={loadingLimited}
        colors={colors}
      />
    ) : null;

  if (uiState === "checking") {
    return <SkeletonWearableCheck />;
  }

  if (uiState === "granted") {
    return (
      <StateCard icon="check-circle" iconColor="#00E676" iconBg="#00E67618"
        title="Step Tracking Connected"
        desc="Health Connect is reading your verified steps. Races, challenges, and leaderboards will use this data."
        badge="Verified · Health Connect ✓"
        badgeColor="#00E676"
        colors={colors}
      />
    );
  }

  if (uiState === "ready") {
    return (
      <>
        {hcGuide}
        <StateCard icon="activity" iconColor="#4285F4" iconBg="#4285F418"
          title="Health Connect Recommended"
          desc="Tap Enable Step Tracking below. A permission sheet should appear inside Walk Champ — not in the Health Connect app."
          footnote="Allow Steps read access when prompted. Walk Champ reads steps from Health Connect for races and leaderboards."
          colors={colors}
          primaryLabel="Enable Step Tracking"
          primaryIcon="shield"
          onPrimary={handleEnableHC}
          primaryLoading={loadingMain}
          secondaryLabel="Try Again"
          onSecondary={runRefresh}
        />
        {fallbackPanel}
      </>
    );
  }

  if (uiState === "permission") {
    return (
      <>
        {hcGuide}
        <StateCard icon="shield-off" iconColor="#F59E0B" iconBg="#F59E0B18"
          title="Permission Needed"
          desc="Tap Enable Step Tracking below. A permission sheet should appear inside Walk Champ — stay in this app until you see it."
          footnote="Walk Champ appears in Health Connect only after you tap Enable here. If denied, it will show under Not allowed access."
          colors={colors}
          primaryLabel="Enable Step Tracking"
          primaryIcon="shield"
          onPrimary={handleEnableHC}
          primaryLoading={loadingMain}
          tertiaryLabel="Try Again"
          onTertiary={() => void runRefresh()}
        />
        {fallbackPanel}
      </>
    );
  }

  if (uiState === "install_update") {
    return (
      <>
        {hcGuide}
        <StateCard
          icon="download" iconColor="#4285F4" iconBg="#4285F418"
          title="Install or Update Health Connect"
          desc="Your device supports Health Connect, but it must be installed or updated from Google Play before Walk Champ can request Steps permission."
          footnote="After install/update, return to Walk Champ, tap Try Again, then tap Enable Step Tracking."
          colors={colors}
          primaryLabel="Install / Update Health Connect"
          primaryIcon="download"
          onPrimary={handleInstallHC}
          primaryLoading={loadingInstall}
          secondaryLabel="Try Again"
          onSecondary={runRefresh}
        />
        {fallbackPanel}
      </>
    );
  }

  if (uiState === "optional_apps") {
    const apps =
      detection?.installedFitnessApps?.length
        ? detection.installedFitnessApps
        : getStaticFallbackFitnessApps();
    return (
      <OptionalAppsState
        apps={apps}
        sensorAvailable={detection?.deviceStepSensorAvailable ?? false}
        onLimitedPress={handleEnableLimited}
        limitedLoading={loadingLimited}
        onRefresh={runRefresh}
        colors={colors}
      />
    );
  }

  // ── State D: Limited device sensor ──────────────────────────────────────────
  if (uiState === "limited_sensor") {
    return (
      <StateCard icon="activity" iconColor="#F59E0B" iconBg="#F59E0B18"
        title="Limited Step Tracking"
        desc={
          "Your device can count daily steps using the phone sensor.\n\n" +
          "This is limited tracking. Rewards, coins battles, cash challenges, and official rankings require verified tracking."
        }
        footnote="Limited tracking can show your daily steps, but it cannot be used for cash, coins, sponsored rewards, or official prize rankings."
        colors={colors}
        badge="Limited · Device Sensor"
        badgeColor="#F59E0B"
        primaryLabel="Use Limited Step Tracking"
        primaryIcon="activity"
        onPrimary={handleEnableLimited}
        primaryLoading={loadingLimited}
        secondaryLabel="Try Again"
        onSecondary={runRefresh}
      />
    );
  }

  // ── State E: Fully unsupported ───────────────────────────────────────────────
  return (
    <>
      <StateCard icon="alert-circle" iconColor={colors.destructive} iconBg={colors.destructive + "18"}
        title="Step Tracking Not Supported"
        desc="Verified Health Connect tracking is not available on this device. You can still use races, groups, shop, and all other Walk Champ features."
        footnote="Try limited sensor tracking or a fitness app bridge below if available."
        colors={colors}
        secondaryLabel="Try Again"
        onSecondary={runRefresh}
      />
      {fallbackPanel}
    </>
  );
}

// ── How sync works (3-step guide) ─────────────────────────────────────────────

function HcSetupGuide({
  colors,
  showManualSteps,
}: {
  colors: ReturnType<typeof useColors>;
  showManualSteps?: boolean;
}) {
  const steps = [
    { label: "Fitness app", sub: "Samsung Health / Google Fit records steps" },
    { label: "Health Connect", sub: "Central hub on your phone" },
    { label: "Walk Champ", sub: "Reads Steps from Health Connect" },
  ];
  return (
    <View style={[s.guideWrap, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <Text style={[s.guideTitle, { color: colors.foreground }]}>How step sync works</Text>
      <View style={s.guideRow}>
        {steps.map((step, i) => (
          <React.Fragment key={step.label}>
            <View style={s.guideStep}>
              <View style={[s.guideDot, { backgroundColor: "#4285F420", borderColor: "#4285F450" }]}>
                <Text style={s.guideDotText}>{i + 1}</Text>
              </View>
              <Text style={[s.guideStepLabel, { color: colors.foreground }]}>{step.label}</Text>
              <Text style={[s.guideStepSub, { color: colors.mutedForeground }]}>{step.sub}</Text>
            </View>
            {i < steps.length - 1 ? (
              <Feather name="chevron-right" size={16} color={colors.mutedForeground} />
            ) : null}
          </React.Fragment>
        ))}
      </View>
      {showManualSteps ? (
        <Text style={[s.guideFoot, { color: "#F59E0B" }]}>
          If Health Connect opened but you see no options: tap App permissions → Walk Champ → enable Steps.
        </Text>
      ) : null}
    </View>
  );
}

// ── Fallback options (shown alongside HC setup) ─────────────────────────────────

function FallbackOptions({
  detection,
  onLimitedPress,
  limitedLoading,
  colors,
}: {
  detection: AndroidStepSourceDetectionResult;
  onLimitedPress: () => void;
  limitedLoading: boolean;
  colors: ReturnType<typeof useColors>;
}) {
  return (
    <View style={[s.fallbackWrap, { borderTopColor: colors.border }]}>
      <Text style={[s.fallbackTitle, { color: colors.foreground }]}>
        Other step sources
      </Text>
      <Text style={[s.fallbackSub, { color: colors.mutedForeground }]}>
        If Health Connect is not working, use limited phone tracking or sync a fitness app through Health Connect.
      </Text>

      {detection.deviceStepSensorAvailable && (
        <TouchableOpacity
          style={[s.actionBtn, s.actionBtnSecondary, { borderColor: "#F59E0B40", backgroundColor: "#F59E0B10" }]}
          onPress={onLimitedPress}
          disabled={limitedLoading}
        >
          {limitedLoading
            ? <ActivityIndicator size="small" color="#F59E0B" />
            : <Feather name="activity" size={16} color="#F59E0B" />}
          <Text style={[s.actionBtnText, { color: "#F59E0B" }]}>Use Limited Phone Sensor</Text>
        </TouchableOpacity>
      )}

      <View style={s.appsList}>
        {(detection.installedFitnessApps.length > 0
          ? detection.installedFitnessApps
          : getStaticFallbackFitnessApps()
        ).map((app) => (
          <View key={app.id} style={[s.appRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Feather name="link" size={18} color={app.likelyInstalled ? "#00E676" : "#94A3B8"} />
            <View style={{ flex: 1 }}>
              <Text style={[s.appRowLabel, { color: colors.foreground }]}>
                {app.label}
                {app.likelyInstalled ? " · on device" : ""}
              </Text>
              <Text style={[s.appRowSub, { color: colors.mutedForeground }]}>
                {app.statusMessage}
              </Text>
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}

// ── State C: Optional apps list ───────────────────────────────────────────────

function OptionalAppsState({
  apps,
  sensorAvailable,
  onLimitedPress,
  limitedLoading,
  onRefresh,
  colors,
}: {
  apps: DetectedOptionalSource[];
  sensorAvailable: boolean;
  onLimitedPress: () => void;
  limitedLoading: boolean;
  onRefresh: () => void;
  colors: ReturnType<typeof useColors>;
}) {
  return (
    <View style={s.content}>
      <View style={[s.iconCircle, { backgroundColor: "#4285F418" }]}>
        <Feather name="smartphone" size={36} color="#4285F4" />
      </View>
      <Text style={[s.title, { color: colors.foreground }]}>
        Health Connect Not Available
      </Text>
      <Text style={[s.desc, { color: colors.mutedForeground }]}>
        Health Connect is not supported on this device. Choose a fitness app below to sync through Health Connect, or use limited phone sensor tracking.
      </Text>

      <View style={s.appsList}>
        {apps.map((app) => (
          <View key={app.id} style={[s.appRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Feather name="link" size={18} color={app.likelyInstalled ? "#00E676" : "#94A3B8"} />
            <View style={{ flex: 1 }}>
              <Text style={[s.appRowLabel, { color: colors.foreground }]}>
                {app.label}
                {app.likelyInstalled ? " · on device" : ""}
              </Text>
              <Text style={[s.appRowSub, { color: colors.mutedForeground }]}>
                {app.statusMessage}
              </Text>
            </View>
          </View>
        ))}
      </View>

      {sensorAvailable && (
        <TouchableOpacity
          style={[s.actionBtn, s.actionBtnSecondary, { borderColor: "#F59E0B40", backgroundColor: "#F59E0B10" }]}
          onPress={onLimitedPress}
          disabled={limitedLoading}
        >
          {limitedLoading
            ? <ActivityIndicator size="small" color="#F59E0B" />
            : <Feather name="activity" size={16} color="#F59E0B" />}
          <Text style={[s.actionBtnText, { color: "#F59E0B" }]}>Use Limited Sensor Tracking</Text>
        </TouchableOpacity>
      )}

      <TouchableOpacity
        style={[s.actionBtn, s.actionBtnSecondary, { borderColor: "#4285F440", backgroundColor: "#4285F410" }]}
        onPress={onRefresh}
      >
        <Feather name="refresh-cw" size={16} color="#4285F4" />
        <Text style={[s.actionBtnText, { color: "#4285F4" }]}>Try Again</Text>
      </TouchableOpacity>

      <View style={[s.infoCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Text style={[s.infoText, { color: colors.mutedForeground }]}>
          Connect through Health Connect or supported account sync. Walk Champ does not read steps directly from third-party apps unless explicitly integrated.
        </Text>
      </View>
    </View>
  );
}

// ── StateCard ─────────────────────────────────────────────────────────────────

function StateCard({
  icon, iconColor, iconBg, title, desc, footnote, badge, badgeColor,
  colors,
  primaryLabel, primaryIcon, onPrimary, primaryLoading,
  secondaryLabel, secondaryIcon, onSecondary,
  tertiaryLabel, onTertiary,
}: {
  icon: keyof typeof Feather.glyphMap;
  iconColor: string;
  iconBg: string;
  title: string;
  desc: string;
  footnote?: string;
  badge?: string;
  badgeColor?: string;
  colors: ReturnType<typeof useColors>;
  primaryLabel?: string;
  primaryIcon?: keyof typeof Feather.glyphMap;
  onPrimary?: () => void;
  primaryLoading?: boolean;
  secondaryLabel?: string;
  secondaryIcon?: keyof typeof Feather.glyphMap;
  onSecondary?: () => void;
  tertiaryLabel?: string;
  onTertiary?: () => void;
}) {
  const bc = badgeColor ?? "#00E676";
  return (
    <View style={s.content}>
      <View style={[s.iconCircle, { backgroundColor: iconBg }]}>
        <Feather name={icon} size={36} color={iconColor} />
      </View>
      <Text style={[s.title, { color: colors.foreground }]}>{title}</Text>
      <Text style={[s.desc, { color: colors.mutedForeground }]}>{desc}</Text>

      {badge ? (
        <View style={[s.badge, { backgroundColor: bc + "18", borderColor: bc + "40" }]}>
          <Feather name="check-circle" size={13} color={bc} />
          <Text style={[s.badgeText, { color: bc }]}>{badge}</Text>
        </View>
      ) : null}

      {primaryLabel && onPrimary ? (
        <TouchableOpacity
          style={[s.actionBtn, { opacity: primaryLoading ? 0.6 : 1 }]}
          onPress={onPrimary}
          disabled={primaryLoading}
        >
          {primaryLoading
            ? <ActivityIndicator size="small" color="#000" />
            : <Feather name={primaryIcon ?? "check"} size={16} color="#000" />}
          <Text style={s.actionBtnText}>{primaryLabel}</Text>
        </TouchableOpacity>
      ) : null}

      {secondaryLabel && onSecondary ? (
        <TouchableOpacity
          style={[s.actionBtn, s.actionBtnSecondary, { borderColor: colors.border, backgroundColor: colors.card }]}
          onPress={onSecondary}
        >
          {secondaryIcon ? <Feather name={secondaryIcon} size={16} color={colors.foreground} /> : null}
          <Text style={[s.actionBtnText, { color: colors.foreground }]}>{secondaryLabel}</Text>
        </TouchableOpacity>
      ) : null}

      {tertiaryLabel && onTertiary ? (
        <TouchableOpacity
          style={[s.actionBtn, s.actionBtnSecondary, { borderColor: "#4285F440", backgroundColor: "#4285F418" }]}
          onPress={onTertiary}
        >
          <Feather name="refresh-cw" size={16} color="#4285F4" />
          <Text style={[s.actionBtnText, { color: "#4285F4" }]}>{tertiaryLabel}</Text>
        </TouchableOpacity>
      ) : null}

      {footnote ? (
        <View style={[s.infoCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[s.infoText, { color: colors.mutedForeground }]}>{footnote}</Text>
        </View>
      ) : null}
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  content:            { paddingHorizontal: 24, paddingTop: 16, gap: 20 },
  centered:           { alignItems: "center", justifyContent: "center", paddingTop: 48 },
  iconCircle:         { width: 80, height: 80, borderRadius: 40, alignItems: "center", justifyContent: "center", alignSelf: "center" },
  title:              { fontSize: rf(24), fontWeight: "800", textAlign: "center" },
  desc:               { fontSize: rf(15), lineHeight: 22, textAlign: "center" },
  badge:              { flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "center", paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, borderWidth: 1 },
  badgeText:          { fontSize: rf(13), fontWeight: "600" },
  actionBtn:          { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 14, borderRadius: 14, backgroundColor: "#00E676" },
  actionBtnSecondary: { backgroundColor: "transparent", borderWidth: 1 },
  actionBtnText:      { fontSize: rf(16), fontWeight: "700", color: "#000" },
  infoCard:           { borderRadius: 14, borderWidth: 1, padding: 16 },
  infoText:           { fontSize: rf(14), lineHeight: 22 },
  fallbackWrap:       { paddingHorizontal: 24, paddingTop: 8, paddingBottom: 16, gap: 14, borderTopWidth: StyleSheet.hairlineWidth, marginTop: 4 },
  fallbackTitle:      { fontSize: rf(16), fontWeight: "800", textAlign: "center" },
  fallbackSub:        { fontSize: rf(13), lineHeight: 20, textAlign: "center" },
  guideWrap:            { marginHorizontal: 24, marginTop: 8, marginBottom: 4, borderRadius: 14, borderWidth: 1, padding: 14, gap: 10 },
  guideTitle:           { fontSize: rf(14), fontWeight: "800", textAlign: "center" },
  guideRow:             { flexDirection: "row", alignItems: "flex-start", justifyContent: "center", gap: 6 },
  guideStep:            { flex: 1, alignItems: "center", gap: 4, maxWidth: 100 },
  guideDot:             { width: 28, height: 28, borderRadius: 14, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  guideDotText:         { fontSize: 12, fontWeight: "800", color: "#4285F4" },
  guideStepLabel:       { fontSize: rf(11), fontWeight: "700", textAlign: "center" },
  guideStepSub:         { fontSize: rf(10), lineHeight: 14, textAlign: "center" },
  guideFoot:            { fontSize: rf(12), lineHeight: 18, textAlign: "center" },
  appsList:           { gap: 10 },
  appRow:             { flexDirection: "row", alignItems: "flex-start", gap: 12, borderRadius: 12, borderWidth: 1, padding: 14, marginBottom: 10 },
  appRowLabel:        { fontSize: rf(14), fontWeight: "700", marginBottom: 2 },
  appRowSub:          { fontSize: rf(13), lineHeight: 19 },
});
