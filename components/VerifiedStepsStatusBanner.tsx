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
};

function actionLabel(status: HealthConnectVerificationState["status"]): string {
  switch (status) {
    case "permission_required":
      return "Grant permissions";
    case "provider_required":
      return Platform.OS === "ios" ? "Open Apple Health" : "Set up health app";
    case "unsupported":
    case "error":
      return "Try again";
    default:
      return "Set up";
  }
}

export default function VerifiedStepsStatusBanner({ state, onSetup }: Props) {
  const colors = useColors();
  if (!state) return null;
  if (
    typeof isVerifiedHealthAuthoritative === "function" &&
    isVerifiedHealthAuthoritative(state.status)
  ) {
    return null;
  }
  if (state.status === "permission_required") {
    /* keep banner */
  } else if (state.status === "unsupported" || state.status === "error") {
    /* keep banner */
  } else if (state.writerInstalled === true || state.setupCompleted === true) {
    return null;
  }

  const title =
    state.status === "unsupported"
      ? "Verified Steps Unavailable"
      : state.status === "permission_required"
        ? "Step access needed"
        : "Health app needed";

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
          {describeHealthConnectVerificationStatus(state.status)}
        </Text>
      </View>
      <TouchableOpacity
        onPress={onSetup}
        style={[styles.btn, { borderColor: colors.warning + "60" }]}
      >
        <Text style={[styles.btnText, { color: colors.warning }]}>
          {actionLabel(state.status)}
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
