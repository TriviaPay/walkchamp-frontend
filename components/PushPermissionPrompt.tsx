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
import { useWalkContext } from "@/context/WalkContext";
import { useWalkTodaySteps } from "@/services/walkTodayStepsStore";
import { useAppSelector } from "@/store/hooks";
import { TouchableOpacity } from "@/components/HapticTouchableOpacity";
import { rf } from "@/utils/responsive";
import {
  completePushPermissionPrompt,
  dismissPushPermissionPrompt,
  runPostLoginPushSetup,
} from "@/services/notificationService";
import {
  isHomeStepSetupPhaseDone,
  waitForHomeStepSetupPhase,
} from "@/services/permissions/homePermissionFlow";
import { stepTrackingNotificationService } from "@/services/stepTrackingNotificationService";
import { stepProviderManager } from "@/services/steps/stepProviderManager";

/**
 * One-time post-login prompt to enable push notifications via OneSignal.
 * Waits until Health Connect / Apple Health home setup finishes so prompts
 * never stack. Does not block the app if the user declines.
 */
export function PushPermissionPrompt() {
  const { user, loading, sessionToken } = useAuth();
  const isAuthenticated = useAppSelector((s) => s.auth.isAuthenticated);
  const colors = useColors();
  const { safeBottom } = useSafeLayout();
  const { todayDailyGoal } = useWalkContext();
  const todaySteps = useWalkTodaySteps();
  const [visible, setVisible] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const handledUserRef = React.useRef<string | null>(null);

  useEffect(() => {
    if (loading || !isAuthenticated || !sessionToken || !user?.id) return;
    if (user.profileComplete === false) return;
    if (!user.emailVerified) return;
    if (handledUserRef.current === user.id) return;
    handledUserRef.current = user.id;

    void (async () => {
      try {
        // Capture whether we are waiting on HC/HealthKit setup *before* waiting.
        const waitedForStepSetup = !isHomeStepSetupPhaseDone();
        if (waitedForStepSetup) {
          await Promise.race([
            waitForHomeStepSetupPhase(),
            new Promise<void>((r) => setTimeout(r, 60_000)),
          ]);
          if (!isHomeStepSetupPhaseDone()) {
            const { markHomeStepSetupPhaseDone } = await import(
              "@/services/permissions/homePermissionFlow"
            );
            markHomeStepSetupPhaseDone();
          }
        }
        // Brief gap after setup modal closes.
        await new Promise((r) => setTimeout(r, 450));
        // Respect Profile toggle — if user disabled notifications, don't re-prompt.
        try {
          const { getNotificationPreferences } = await import(
            "@/services/notificationService"
          );
          const wants = await getNotificationPreferences();
          if (!wants) return;
        } catch {
          /* continue */
        }
        // Already asked during HC "allow all" setup — don't stack another prompt.
        try {
          const { storageGet, STORAGE_KEYS } = await import("@/utils/storage");
          const alreadyHandled = await storageGet<boolean>(
            STORAGE_KEYS.PUSH_PERMISSION_PROMPTED,
          );
          if (alreadyHandled) return;
        } catch {
          /* continue */
        }
        const { shouldShowPrompt, permissionGranted } = await runPostLoginPushSetup(user.id);
        // After step setup, offer notifications only if still needed and not already
        // handled inside WearableSetupModal (prompt storage / grant).
        if (shouldShowPrompt) {
          setVisible(true);
        } else if (waitedForStepSetup && !permissionGranted) {
          // WearableSetup may have skipped notifications — don't stack another sheet.
          const { storageGet, STORAGE_KEYS } = await import("@/utils/storage");
          const alreadyHandled = await storageGet<boolean>(STORAGE_KEYS.PUSH_PERMISSION_PROMPTED);
          if (!alreadyHandled) {
            setVisible(true);
          }
        }
      } catch {
        // Never crash on notification setup
      }
    })();
  }, [
    user?.id,
    user?.profileComplete,
    user?.emailVerified,
    loading,
    isAuthenticated,
    sessionToken,
  ]);

  const handleEnable = useCallback(async () => {
    if (requesting) return;
    setRequesting(true);
    try {
      const granted = await completePushPermissionPrompt();
      if (granted) {
        try {
          const { setNotificationPreferences } = await import(
            "@/services/notificationService"
          );
          await setNotificationPreferences(true);
        } catch {
          /* ignore */
        }
      }
      // After notifications are granted, start ongoing walk tracker once if HC/HK ready.
      if (
        granted &&
        user?.id &&
        stepProviderManager.usesVerifiedStepSource()
      ) {
        void stepTrackingNotificationService
          .start({
            userId: user.id,
            todaySteps: todaySteps ?? 0,
            dailyGoal: todayDailyGoal > 0 ? todayDailyGoal : 10_000,
          })
          .catch(() => {});
      }
    } catch (error) {
      console.log("[Push] permission prompt enable failed", error);
    } finally {
      setRequesting(false);
      setVisible(false);
    }
  }, [requesting, user?.id, todaySteps, todayDailyGoal]);

  const handleNotNow = useCallback(async () => {
    await dismissPushPermissionPrompt();
    try {
      const { setNotificationPreferences } = await import(
        "@/services/notificationService"
      );
      await setNotificationPreferences(false);
      const { applyOngoingNotificationPreference } = await import(
        "@/services/ongoingNotificationPreference"
      );
      await applyOngoingNotificationPreference(false, user?.id);
    } catch {
      /* ignore */
    }
    setVisible(false);
  }, [user?.id]);

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
          <Text style={[s.title, { color: colors.foreground }]}>Enable notifications</Text>
          <Text style={[s.body, { color: colors.mutedForeground }]}>
            Allow notifications so WalkChamp can show live step progress while you walk, plus race invites, rewards, and friend updates. You can change this anytime in Profile.
          </Text>
          <TouchableOpacity
            style={[s.primaryBtn, { opacity: requesting ? 0.7 : 1 }]}
            onPress={() => void handleEnable()}
            disabled={requesting}
          >
            {requesting ? (
              <ActivityIndicator size="small" color="#000" />
            ) : (
              <Text style={s.primaryBtnText}>Allow Notifications</Text>
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
