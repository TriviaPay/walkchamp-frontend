import React from "react";
import { Platform, StyleSheet, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { TouchableOpacity } from "@/components/HapticTouchableOpacity";
import { useColors } from "@/hooks/useColors";
import { rf, rs } from "@/utils/responsive";
import {
  describeHealthConnectVerificationStatus,
  isVerifiedHealthAuthoritative,
} from "@/services/steps/healthConnectVerificationStateLogic";
import type { HealthConnectVerificationState } from "@/services/steps/healthConnectVerificationState";

type Props = {
  state: HealthConnectVerificationState | null;
  onSetup: () => void;
  /** True when WalkContext already has Health Connect / HealthKit READ granted. */
  stepsAccessGranted?: boolean;
};

function actionLabel(state: HealthConnectVerificationState): string {
  switch (state.status) {
    case "permission_required":
      return "Grant permissions";
    case "provider_required":
      if (Platform.OS === "ios") return "Open Apple Health";
      if (state.writerInstalled) return "Open app";
      return "Set up health app";
    case "unsupported":
    case "error":
      return "Try again";
    default:
      return "Set up";
  }
}

function bannerTitle(state: HealthConnectVerificationState): string {
  if (state.status === "unsupported") return "Verified Steps Unavailable";
  if (state.status === "permission_required") return "Step access needed";
  if (
    state.status === "provider_required" &&
    state.writerInstalled &&
    !state.writerConnectedToHealthConnect
  ) {
    return "Waiting for step sync";
  }
  return "Health app needed";
}

function bannerBody(state: HealthConnectVerificationState): string {
  if (
    state.status === "provider_required" &&
    state.writerInstalled &&
    !state.writerConnectedToHealthConnect
  ) {
    const label = state.preferredWriterLabel ?? "your health app";
    return `${label} is set up with Health Connect. Open ${label} once and walk a bit — verified steps usually appear after it syncs.`;
  }
  return describeHealthConnectVerificationStatus(state.status);
}

export default function VerifiedStepsStatusBanner({
  state,
  onSetup,
  stepsAccessGranted = false,
}: Props) {
  const colors = useColors();
  if (!state) return null;
  if (
    typeof isVerifiedHealthAuthoritative === "function" &&
    isVerifiedHealthAuthoritative(state.status)
  ) {
    return null;
  }
  // Hide once the in-app HC wizard is done (READ granted + HC available).
  // WalkContext can know about the grant before the HC probe cache catches up.
  if (
    (state.healthConnectAvailable && state.readStepsPermissionGranted) ||
    (stepsAccessGranted &&
      (state.status === "permission_required" || state.readStepsPermissionGranted))
  ) {
    return null;
  }
  if (state.writerConnectedToHealthConnect === true) {
    return null;
  }
  // Setup can finish before Samsung writes Step rows. Do not keep alarming
  // "Health app needed" when HC is readable and the writer app is installed.
  if (
    state.healthConnectAvailable &&
    state.readStepsPermissionGranted &&
    state.writerInstalled
  ) {
    return null;
  }

  const title = bannerTitle(state);

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
        onPress={onSetup}
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
