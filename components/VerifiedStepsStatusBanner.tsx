import React from "react";
import { Platform, StyleSheet, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { TouchableOpacity } from "@/components/HapticTouchableOpacity";
import { useColors } from "@/hooks/useColors";
import { rf, rs } from "@/utils/responsive";
import {
  describeHealthConnectVerificationStatus,
  isVerifiedHealthAuthoritative,
  isWaitingForHealthConnectWriterData,
} from "@/services/steps/healthConnectVerificationStateLogic";
import { isHealthConnectOnDeviceStepsAvailable } from "@/services/steps/hcOnDeviceSteps";
import type { HealthConnectVerificationState } from "@/services/steps/healthConnectVerificationState";

type Props = {
  state: HealthConnectVerificationState | null;
  onSetup: () => void;
  /** Re-read Health Connect — used when permissions are already granted. */
  onRecheck?: () => void;
  /** True when WalkContext already has Health Connect / HealthKit READ granted. */
  stepsAccessGranted?: boolean;
  /** Auto Tracking is already ON — hide informational local-only / waiting cards. */
  trackingActive?: boolean;
};

function waitingForWriter(state: HealthConnectVerificationState): boolean {
  return isWaitingForHealthConnectWriterData(state.status, state.writerInstalled);
}

function actionLabel(state: HealthConnectVerificationState): string {
  if (waitingForWriter(state)) {
    return "Recheck";
  }
  switch (state.status) {
    case "permission_required":
      return "Allow Step Access";
    case "provider_required":
      if (Platform.OS === "ios") return "Open Apple Health";
      return "Open system update";
    case "unsupported":
    case "error":
      return "Try again";
    default:
      return "Set up";
  }
}

function bannerTitle(state: HealthConnectVerificationState): string {
  if (waitingForWriter(state)) {
    return "Waiting for Health Connect data";
  }
  if (state.status === "unsupported") return "Verified Steps Unavailable";
  if (state.status === "permission_required") return "Allow Step Access";
  if (state.status === "provider_required") return "System update required";
  return "Health Connect needed";
}

function bannerBody(state: HealthConnectVerificationState): string {
  if (waitingForWriter(state)) {
    if (isHealthConnectOnDeviceStepsAvailable()) {
      return "WalkChamp is connected to Health Connect. Verified steps will update as Health Connect records them.";
    }
    return "WalkChamp is connected to Health Connect. Verified steps will update as Health Connect records them. Native phone capture needs a system update; watches and other Health Connect sources still count.";
  }
  return describeHealthConnectVerificationStatus(state.status);
}

export default function VerifiedStepsStatusBanner({
  state,
  onSetup,
  onRecheck,
  stepsAccessGranted = false,
  trackingActive = false,
}: Props) {
  const colors = useColors();
  if (!state) return null;

  const waiting = waitingForWriter(state);

  // After the user has already enabled tracking, empty Health Connect /
  // local-only is not a leftover setup error. Walk's Auto Tracking line
  // covers that — do not keep "Step tracking is active" on screen.
  if (
    (stepsAccessGranted || trackingActive) &&
    (waiting ||
      (typeof isVerifiedHealthAuthoritative === "function" &&
        isVerifiedHealthAuthoritative(state.status)))
  ) {
    return null;
  }

  if (
    !waiting &&
    typeof isVerifiedHealthAuthoritative === "function" &&
    isVerifiedHealthAuthoritative(state.status)
  ) {
    return null;
  }
  // Hide once the in-app HC wizard is done — except when HC is still empty.
  if (
    !waiting &&
    ((state.healthConnectAvailable && state.readStepsPermissionGranted) ||
      (stepsAccessGranted &&
        (state.status === "permission_required" || state.readStepsPermissionGranted)))
  ) {
    return null;
  }
  if (!waiting && state.writerConnectedToHealthConnect === true) {
    return null;
  }
  if (
    !waiting &&
    state.healthConnectAvailable &&
    state.readStepsPermissionGranted &&
    state.writerInstalled
  ) {
    return null;
  }

  const title = bannerTitle(state);
  const onActionPress = () => {
    if (waiting && onRecheck) {
      onRecheck();
      return;
    }
    onSetup();
  };

  return (
    <View
      style={[
        styles.wrap,
        { backgroundColor: colors.card, borderColor: colors.warning + "50" },
      ]}
    >
      <Feather name="alert-circle" size={16} color={colors.warning} />
      <View style={{ flex: 1 }}>
        <Text style={[styles.title, { color: colors.foreground }]}>{title}</Text>
        <Text style={[styles.body, { color: colors.mutedForeground }]}>
          {bannerBody(state)}
        </Text>
      </View>
      <TouchableOpacity
        onPress={onActionPress}
        style={[styles.btn, { borderColor: colors.warning + "60" }]}
      >
        <Text style={[styles.btnText, { color: colors.warning }]}>
          {actionLabel(state)}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginTop: rs(10),
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
  },
  title: { fontSize: rf(13), fontWeight: "700" },
  body: { fontSize: rf(11), marginTop: 2, lineHeight: 16 },
  btn: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 6,
    maxWidth: 92,
  },
  btnText: { fontSize: rf(11), fontWeight: "700", textAlign: "center" },
});
