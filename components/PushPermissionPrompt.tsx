import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useAuth } from "@/context/AuthContext";
import { useColors } from "@/hooks/useColors";
import { useSafeLayout } from "@/hooks/useSafeLayout";
import { TouchableOpacity } from "@/components/HapticTouchableOpacity";
import { rf } from "@/utils/responsive";
import {
  completePushPermissionPrompt,
  dismissPushPermissionPrompt,
  runPostLoginPushSetup,
} from "@/services/notificationService";

/**
 * One-time post-login prompt to enable push notifications via OneSignal.
 * Does not block the app if the user declines.
 */
export function PushPermissionPrompt() {
  const { user, loading } = useAuth();
  const colors = useColors();
  const { safeBottom } = useSafeLayout();
  const [visible, setVisible] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const handledUserRef = React.useRef<string | null>(null);

  useEffect(() => {
    if (loading || !user?.id) return;
    if (handledUserRef.current === user.id) return;
    handledUserRef.current = user.id;

    void (async () => {
      try {
        const { shouldShowPrompt } = await runPostLoginPushSetup(user.id);
        if (shouldShowPrompt) setVisible(true);
      } catch {
        // Never crash on notification setup
      }
    })();
  }, [user?.id, loading]);

  const handleEnable = useCallback(async () => {
    if (requesting) return;
    setRequesting(true);
    try {
      await completePushPermissionPrompt();
    } finally {
      setRequesting(false);
      setVisible(false);
    }
  }, [requesting]);

  const handleNotNow = useCallback(async () => {
    await dismissPushPermissionPrompt();
    setVisible(false);
  }, []);

  if (!visible) return null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={() => void handleNotNow()}
    >
      <View style={s.overlay}>
        <View style={[s.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={[s.iconCircle, { backgroundColor: colors.primary + "18" }]}>
            <Feather name="bell" size={28} color={colors.primary} />
          </View>
          <Text style={[s.title, { color: colors.foreground }]}>Stay in the loop</Text>
          <Text style={[s.body, { color: colors.mutedForeground }]}>
            Enable notifications for race invites, friend requests, rewards, and live race updates.
            You can change this anytime in Profile settings.
          </Text>
          <TouchableOpacity
            style={[s.primaryBtn, { opacity: requesting ? 0.7 : 1 }]}
            onPress={() => void handleEnable()}
            disabled={requesting}
          >
            {requesting ? (
              <ActivityIndicator size="small" color="#000" />
            ) : (
              <Text style={s.primaryBtnText}>Enable Notifications</Text>
            )}
          </TouchableOpacity>
          <TouchableOpacity
            style={[s.secondaryBtn, { marginBottom: safeBottom + 8 }]}
            onPress={() => void handleNotNow()}
            disabled={requesting}
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
    marginBottom: 8,
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
