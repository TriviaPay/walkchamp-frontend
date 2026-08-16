/**
 * Themed battery-optimization prompt (light + dark).
 * Replaces the system Alert so the race/walk flow stays in WalkChamp UI.
 */

import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { ONBOARDING_COLORS } from "@/constants/onboarding";
import { MODAL_MAX_WIDTH, rf, rs } from "@/utils/responsive";

const ONBOARDING_BTN = [ONBOARDING_COLORS.cyan, ONBOARDING_COLORS.primary] as const;

export type BatteryOptimizationPromptChoice = "allow" | "not_now";

type PromptRequest = {
  resolve: (choice: BatteryOptimizationPromptChoice) => void;
};

let _presentPrompt: (() => Promise<BatteryOptimizationPromptChoice>) | null = null;

/** Imperative API used by batteryOptimization.ts */
export function presentBatteryOptimizationPrompt(): Promise<BatteryOptimizationPromptChoice> {
  if (_presentPrompt) return _presentPrompt();
  return Promise.resolve("not_now");
}

export function BatteryOptimizationHost() {
  const colors = useColors();
  const [request, setRequest] = useState<PromptRequest | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    _presentPrompt = () =>
      new Promise<BatteryOptimizationPromptChoice>((resolve) => {
        setRequest({ resolve });
      });
    return () => {
      _presentPrompt = null;
    };
  }, []);

  const finish = useCallback(
    (choice: BatteryOptimizationPromptChoice) => {
      if (!request) return;
      const { resolve } = request;
      setBusy(false);
      setRequest(null);
      resolve(choice);
    },
    [request],
  );

  if (!request) return null;

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
          <View style={[styles.iconCircle, { backgroundColor: ONBOARDING_COLORS.lime + "22" }]}>
            <Feather name="zap" size={32} color={ONBOARDING_COLORS.lime} />
          </View>

          <Text style={[styles.title, { color: colors.foreground }]}>
            Keep step tracking running
          </Text>

          <Text style={[styles.message, { color: colors.mutedForeground }]}>
            Your phone's battery saver may close WalkChamp while you're walking, cutting off
            step tracking. Allow WalkChamp to run in the background for accurate steps and
            race results.
          </Text>

          <TouchableOpacity
            style={[styles.primaryBtn, busy && { opacity: 0.6 }]}
            disabled={busy}
            activeOpacity={0.88}
            onPress={() => {
              setBusy(true);
              finish("allow");
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
                <Text style={styles.primaryText}>Allow</Text>
              )}
            </LinearGradient>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.secondaryBtn}
            onPress={() => finish("not_now")}
            disabled={busy}
          >
            <Text style={[styles.secondaryText, { color: colors.mutedForeground }]}>
              Not now
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
