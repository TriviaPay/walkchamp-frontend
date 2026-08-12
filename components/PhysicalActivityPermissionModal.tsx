/**
 * Themed Physical Activity permission modal (light + dark).
 * Shown before the OS permission sheet so users understand this is for walking progress.
 * If the OS will no longer show its sheet, offers Open Settings with clear instructions.
 */

import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { TouchableOpacity } from "@/components/HapticTouchableOpacity";
import { ONBOARDING_COLORS } from "@/constants/onboarding";
import { MODAL_MAX_WIDTH, rf, rs } from "@/utils/responsive";

const ONBOARDING_BTN = [ONBOARDING_COLORS.cyan, ONBOARDING_COLORS.primary] as const;

export type PhysicalActivityPromptMode = "request" | "settings";

export type PhysicalActivityPromptChoice =
  | "allow"
  | "not_now"
  | "open_settings";

type PromptRequest = {
  mode: PhysicalActivityPromptMode;
  resolve: (choice: PhysicalActivityPromptChoice) => void;
};

let _presentPrompt:
  | ((mode: PhysicalActivityPromptMode) => Promise<PhysicalActivityPromptChoice>)
  | null = null;

/** Imperative API used by activityRecognitionPermissionService. */
export function presentPhysicalActivityPermissionPrompt(
  mode: PhysicalActivityPromptMode = "request",
): Promise<PhysicalActivityPromptChoice> {
  if (_presentPrompt) return _presentPrompt(mode);
  // Host not mounted yet — skip gracefully.
  return Promise.resolve("not_now");
}

export function PhysicalActivityPermissionHost() {
  const colors = useColors();
  const [request, setRequest] = useState<PromptRequest | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    _presentPrompt = (mode) =>
      new Promise<PhysicalActivityPromptChoice>((resolve) => {
        setRequest({ mode, resolve });
      });
    return () => {
      _presentPrompt = null;
    };
  }, []);

  const finish = useCallback(
    (choice: PhysicalActivityPromptChoice) => {
      if (!request) return;
      const { resolve } = request;
      setBusy(false);
      setRequest(null);
      resolve(choice);
    },
    [request],
  );

  if (!request) return null;

  const needsSettings = request.mode === "settings";

  return (
    <Modal
      transparent
      visible
      animationType="fade"
      onRequestClose={() => finish("not_now")}
    >
      <View style={styles.overlay}>
        <Pressable style={StyleSheet.absoluteFill} onPress={() => finish("not_now")} />
        <View
          style={[
            styles.card,
            {
              backgroundColor: colors.card,
              borderColor: colors.border,
              maxWidth: MODAL_MAX_WIDTH,
            },
          ]}
        >
          <View style={[styles.iconCircle, { backgroundColor: ONBOARDING_COLORS.cyan + "22" }]}>
            <Feather name="activity" size={32} color={ONBOARDING_COLORS.cyan} />
          </View>

          <Text style={[styles.title, { color: colors.foreground }]}>
            {needsSettings
              ? "Turn on walking progress access"
              : "Keep walking progress updating"}
          </Text>

          <Text style={[styles.message, { color: colors.mutedForeground }]}>
            {needsSettings
              ? "Physical activity access was turned off. Enable it so your steps and race progress keep updating while you walk — even when WalkChamp is in the background."
              : "WalkChamp needs Physical activity access so your steps and race progress keep updating while you walk — even when the app is in the background or your phone is locked."}
          </Text>

          <View style={[styles.tipCard, { backgroundColor: colors.muted, borderColor: colors.border }]}>
            <Feather name="info" size={14} color={colors.accent} />
            <Text style={[styles.tipText, { color: colors.mutedForeground }]}>
              {needsSettings
                ? "Path: Android Settings → Apps → WalkChamp → Permissions → Physical activity. Or reopen step tracking setup from Profile."
                : "This is for walking progress — not promotional alerts. You can change it later in Android Settings → Apps → WalkChamp → Permissions."}
            </Text>
          </View>

          <TouchableOpacity
            style={[styles.primaryBtn, busy && { opacity: 0.6 }]}
            disabled={busy}
            activeOpacity={0.88}
            onPress={() => {
              setBusy(true);
              finish(needsSettings ? "open_settings" : "allow");
            }}
          >
            <LinearGradient
              colors={[...ONBOARDING_BTN]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.primaryGrad}
            >
              {busy ? (
                <ActivityIndicator color="#FFF" />
              ) : (
                <Text style={styles.primaryText}>
                  {needsSettings ? "Open Settings" : "Allow Walking Access"}
                </Text>
              )}
            </LinearGradient>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.secondaryBtn}
            onPress={() => finish("not_now")}
            disabled={busy}
          >
            <Text style={[styles.secondaryText, { color: colors.mutedForeground }]}>
              Not Now
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.55)",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: rs(24),
  },
  card: {
    width: "100%",
    borderRadius: rs(20),
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: rs(22),
    paddingTop: rs(28),
    paddingBottom: rs(20),
    gap: rs(14),
  },
  iconCircle: {
    width: rs(72),
    height: rs(72),
    borderRadius: rs(36),
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "center",
  },
  title: {
    fontSize: rf(20),
    fontWeight: "800",
    textAlign: "center",
  },
  message: {
    fontSize: rf(14.5),
    lineHeight: rf(21),
    textAlign: "center",
  },
  tipCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    borderRadius: rs(12),
    borderWidth: StyleSheet.hairlineWidth,
    padding: rs(12),
  },
  tipText: {
    flex: 1,
    fontSize: rf(12.5),
    lineHeight: rf(18),
  },
  primaryBtn: {
    borderRadius: 16,
    overflow: "hidden",
    marginTop: 4,
  },
  primaryGrad: {
    minHeight: 52,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  primaryText: {
    color: "#FFF",
    fontSize: rf(16),
    fontWeight: "800",
  },
  secondaryBtn: {
    alignItems: "center",
    paddingVertical: 10,
  },
  secondaryText: {
    fontSize: rf(15),
    fontWeight: "600",
  },
});
