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
import { useColors } from "@/hooks/useColors";

export type AlertButton = {
  text: string;
  style?: "default" | "cancel" | "destructive";
  onPress?: () => void;
};

type AlertConfig = {
  title: string;
  message?: string;
  buttons: AlertButton[];
};

type ShowAlertFn = (title: string, message?: string, buttons?: AlertButton[]) => void;

let _showAlert: ShowAlertFn | null = null;

export const AppAlert = {
  alert: (title: string, message?: string, buttons?: AlertButton[]) => {
    if (_showAlert) {
      _showAlert(title, message, buttons);
    }
  },
};

export function AlertHost() {
  const colors = useColors();
  const [config, setConfig] = useState<AlertConfig | null>(null);
  const opacity = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(0.92)).current;

  useEffect(() => {
    _showAlert = (title, message, buttons = [{ text: "OK" }]) => {
      setConfig({ title, message, buttons });
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
          <View style={styles.body}>
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
    paddingHorizontal: 36,
  },
  card: {
    width: "100%",
    maxWidth: 340,
    borderRadius: 18,
    borderWidth: 1,
    overflow: "hidden",
  },
  body: {
    paddingHorizontal: 22,
    paddingTop: 24,
    paddingBottom: 18,
    alignItems: "center",
  },
  title: {
    fontSize: 17,
    fontWeight: "700",
    textAlign: "center",
    letterSpacing: 0.1,
  },
  message: {
    fontSize: 14,
    textAlign: "center",
    marginTop: 7,
    lineHeight: 20,
  },
  divider: {
    height: 1,
  },
  buttons: {
    flexDirection: "row",
    padding: 12,
    gap: 8,
  },
  buttonsStack: {
    flexDirection: "column",
  },
  btn: {
    paddingVertical: 12,
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
    fontSize: 15,
    fontWeight: "600",
  },
});
