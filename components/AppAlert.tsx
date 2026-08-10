import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Animated,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { typography } from "@/constants/typography";
import { spacing } from "@/constants/spacing";
import { sizes } from "@/constants/sizes";
import { MODAL_MAX_WIDTH, rs } from "@/utils/responsive";

export type AlertButton = {
  text: string;
  style?: "default" | "cancel" | "destructive";
  onPress?: () => void;
};

export type AlertOptions = {
  /** Show an X in the top-right corner to dismiss without running action buttons. */
  showClose?: boolean;
};

type AlertConfig = {
  title: string;
  message?: string;
  buttons: AlertButton[];
  options?: AlertOptions;
};

type ShowAlertFn = (
  title: string,
  message?: string,
  buttons?: AlertButton[],
  options?: AlertOptions,
) => void;

let _showAlert: ShowAlertFn | null = null;

export const AppAlert = {
  alert: (
    title: string,
    message?: string,
    buttons?: AlertButton[],
    options?: AlertOptions,
  ) => {
    if (_showAlert) {
      _showAlert(title, message, buttons, options);
    }
  },
};

export function AlertHost() {
  const colors = useColors();
  const [config, setConfig] = useState<AlertConfig | null>(null);
  const opacity = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(0.92)).current;

  useEffect(() => {
    _showAlert = (title, message, buttons = [{ text: "OK" }], options) => {
      setConfig({ title, message, buttons, options });
    };
    return () => {
      _showAlert = null;
    };
  }, []);

  useEffect(() => {
    if (config) {
      Animated.parallel([
        Animated.timing(opacity, { toValue: 1, duration: 180, useNativeDriver: true }),
        Animated.spring(scale, { toValue: 1, friction: 8, tension: 100, useNativeDriver: true }),
      ]).start();
    } else {
      opacity.setValue(0);
      scale.setValue(0.92);
    }
  }, [config, opacity, scale]);

  const dismiss = useCallback(
    (onPress?: () => void) => {
      Animated.timing(opacity, { toValue: 0, duration: 130, useNativeDriver: true }).start(() => {
        setConfig(null);
        onPress?.();
      });
    },
    [opacity],
  );

  if (!config) return null;

  const cancelBtn = config.buttons.find((b) => b.style === "cancel");
  const actionBtns = config.buttons.filter((b) => b.style !== "cancel");
  const hasLongLabel = config.buttons.some((b) => b.text.length > 12);
  const stackButtons = config.buttons.length > 2 || hasLongLabel;
  const showClose = !!config.options?.showClose;

  return (
    <Modal transparent visible={!!config} animationType="none" onRequestClose={() => dismiss(cancelBtn?.onPress)}>
      <Animated.View style={[styles.overlay, { opacity }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={() => dismiss(cancelBtn?.onPress)} />
        <Animated.View
          style={[
            styles.card,
            { backgroundColor: colors.card, borderColor: colors.border, transform: [{ scale }] },
          ]}
        >
          {showClose ? (
            <TouchableOpacity
              style={styles.closeBtn}
              onPress={() => dismiss()}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              accessibilityLabel="Close"
              activeOpacity={0.7}
            >
              <Feather name="x" size={18} color={colors.mutedForeground} />
            </TouchableOpacity>
          ) : null}

          <View style={[styles.body, showClose && styles.bodyWithClose]}>
            <Text style={[styles.title, { color: colors.foreground }]}>{config.title}</Text>
            {!!config.message && (
              <Text style={[styles.message, { color: colors.mutedForeground }]}>{config.message}</Text>
            )}
          </View>

          <View style={[styles.divider, { backgroundColor: colors.border }]} />

          <View style={[styles.buttons, stackButtons && styles.buttonsStack]}>
            {cancelBtn && (
              <TouchableOpacity
                style={[
                  styles.btn,
                  stackButtons ? styles.btnFull : styles.btnHalf,
                  { borderColor: colors.border, borderWidth: 1 },
                ]}
                onPress={() => dismiss(cancelBtn.onPress)}
                activeOpacity={0.7}
              >
                <Text style={[styles.btnText, { color: colors.mutedForeground }]}>{cancelBtn.text}</Text>
              </TouchableOpacity>
            )}
            {actionBtns.map((btn, i) => {
              const isDestructive = btn.style === "destructive";
              return (
                <TouchableOpacity
                  key={i}
                  style={[
                    styles.btn,
                    stackButtons ? styles.btnFull : styles.btnHalf,
                    { backgroundColor: isDestructive ? colors.warning : colors.primary },
                  ]}
                  onPress={() => dismiss(btn.onPress)}
                  activeOpacity={0.8}
                >
                  <Text style={[styles.btnText, { color: isDestructive ? "#fff" : colors.primaryForeground }]}>
                    {btn.text}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.55)",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: rs(36),
  },
  card: {
    width: "100%",
    maxWidth: Math.min(340, MODAL_MAX_WIDTH),
    borderRadius: sizes.radiusXl,
    borderWidth: sizes.hairline,
    overflow: "hidden",
  },
  closeBtn: {
    position: "absolute",
    top: spacing.lg,
    right: spacing.lg,
    zIndex: 2,
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  body: {
    paddingHorizontal: rs(22),
    paddingTop: spacing.xxxl,
    paddingBottom: spacing.xlPlus,
    alignItems: "center",
  },
  bodyWithClose: {
    paddingTop: rs(28),
    paddingHorizontal: rs(36),
  },
  title: {
    ...typography.dialogTitle,
    textAlign: "center",
    letterSpacing: 0.1,
  },
  message: {
    ...typography.dialogBody,
    textAlign: "center",
    marginTop: rs(7),
  },
  divider: {
    height: sizes.hairline,
  },
  buttons: {
    flexDirection: "row",
    padding: spacing.lg,
    gap: spacing.md,
  },
  buttonsStack: {
    flexDirection: "column",
  },
  btn: {
    paddingVertical: spacing.lg,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
  },
  btnHalf: {
    flex: 1,
  },
  btnFull: {
    width: "100%",
  },
  btnText: {
    ...typography.button,
    fontWeight: "600",
  },
});
