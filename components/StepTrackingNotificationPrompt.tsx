import React, { useCallback, useEffect, useState } from "react";
import {
  AppState,
  type AppStateStatus,
  Modal,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { useSafeLayout } from "@/hooks/useSafeLayout";
import { TouchableOpacity } from "@/components/HapticTouchableOpacity";
import { rf } from "@/utils/responsive";
import {
  handleAppResumeNotificationRecheck,
  onStepTrackingNotificationDismiss,
  onStepTrackingNotificationOpenSettings,
  registerStepTrackingNotificationModalHost,
  NOTIFICATION_STILL_DISABLED_MESSAGE,
  unregisterStepTrackingNotificationModal,
} from "@/services/permissions/notificationGate";

/**
 * Custom modal when app-level Android notifications are off before step tracking.
 * Separate from push (OneSignal) onboarding.
 */
export function StepTrackingNotificationPrompt() {
  const colors = useColors();
  const { safeBottom } = useSafeLayout();
  const [visible, setVisible] = useState(false);
  const [stillDisabled, setStillDisabled] = useState(false);

  useEffect(() => {
    registerStepTrackingNotificationModalHost({
      show: ({ stillDisabled: showStillDisabled }) => {
        setStillDisabled(showStillDisabled);
        setVisible(true);
      },
      hide: () => {
        setStillDisabled(false);
        setVisible(false);
      },
    });
    return () => unregisterStepTrackingNotificationModal();
  }, []);

  useEffect(() => {
    const onAppState = (next: AppStateStatus) => {
      if (next !== "active") return;
      void handleAppResumeNotificationRecheck();
    };
    const sub = AppState.addEventListener("change", onAppState);
    return () => sub.remove();
  }, []);

  const handleOpenSettings = useCallback(() => {
    setStillDisabled(false);
    onStepTrackingNotificationOpenSettings();
  }, []);

  const handleNotNow = useCallback(() => {
    onStepTrackingNotificationDismiss();
  }, []);

  if (!visible) return null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={handleNotNow}
    >
      <View style={s.overlay}>
        <View style={[s.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={[s.iconCircle, { backgroundColor: colors.primary + "18" }]}>
            <Feather name="bell" size={28} color={colors.primary} />
          </View>
          <Text style={[s.title, { color: colors.foreground }]}>Enable Notifications</Text>
          <Text style={[s.body, { color: colors.mutedForeground }]}>
            Walk Champ needs notifications to show ongoing step tracking while you walk.
          </Text>
          {stillDisabled ? (
            <Text style={[s.warning, { color: "#ef4444" }]}>
              {NOTIFICATION_STILL_DISABLED_MESSAGE}
            </Text>
          ) : null}
          <TouchableOpacity style={s.primaryBtn} onPress={handleOpenSettings}>
            <Text style={s.primaryBtnText}>Open Notification Settings</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[s.secondaryBtn, { marginBottom: safeBottom + 8 }]}
            onPress={handleNotNow}
          >
            <Text style={[s.secondaryBtnText, { color: colors.mutedForeground }]}>Not Now</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.55)",
    justifyContent: "flex-end",
    paddingHorizontal: 20,
    paddingBottom: 24,
  },
  card: {
    borderRadius: 20,
    borderWidth: 1,
    padding: 24,
    alignItems: "center",
    gap: 12,
  },
  iconCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  title: {
    fontSize: rf(20),
    fontWeight: "800",
    textAlign: "center",
  },
  body: {
    fontSize: rf(14),
    lineHeight: 21,
    textAlign: "center",
    marginBottom: 4,
  },
  warning: {
    fontSize: rf(13),
    lineHeight: 19,
    textAlign: "center",
    fontWeight: "600",
  },
  primaryBtn: {
    width: "100%",
    paddingVertical: 14,
    borderRadius: 14,
    backgroundColor: "#00E676",
    alignItems: "center",
  },
  primaryBtnText: {
    fontSize: rf(16),
    fontWeight: "700",
    color: "#000",
  },
  secondaryBtn: {
    paddingVertical: 10,
    alignItems: "center",
  },
  secondaryBtnText: {
    fontSize: rf(15),
    fontWeight: "600",
  },
});
