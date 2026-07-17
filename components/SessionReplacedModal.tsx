import React from "react";
import {
  View,
  Text,
  Modal,
  StyleSheet,
  TouchableOpacity,
} from "react-native";
import { Feather } from "@expo/vector-icons";

export type SessionNoticeKind = "replaced" | "expired" | "revoked";

interface SessionReplacedModalProps {
  visible: boolean;
  kind?: SessionNoticeKind;
  message?: string | null;
  onDismiss: () => void;
}

function copyFor(kind: SessionNoticeKind): { title: string; body: string; icon: keyof typeof Feather.glyphMap } {
  if (kind === "replaced") {
    return {
      title: "Signed in on another device",
      body:
        "Your account was just signed in on a different device, so you’ve been signed out here for security. Sign in again on this device if you want to continue.",
      icon: "smartphone",
    };
  }
  if (kind === "revoked") {
    return {
      title: "Session ended",
      body: "Your session was ended for security. Please sign in again to continue.",
      icon: "shield-off",
    };
  }
  return {
    title: "Session expired",
    body: "Your login session has expired. Please sign in again to continue.",
    icon: "clock",
  };
}

/**
 * Professional full-screen modal (not Alert) shown when this device loses
 * the single active session — e.g. login on another phone/tablet.
 */
export default function SessionReplacedModal({
  visible,
  kind = "replaced",
  message,
  onDismiss,
}: SessionReplacedModalProps) {
  const copy = copyFor(kind);
  const body = message?.trim() || copy.body;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onDismiss}
    >
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <View style={styles.iconRow}>
            <View style={styles.iconBadge}>
              <Feather name={copy.icon} size={26} color="#00E5A0" />
            </View>
          </View>

          <Text style={styles.title}>{copy.title}</Text>
          <Text style={styles.message}>{body}</Text>

          <TouchableOpacity
            style={styles.primaryBtn}
            onPress={onDismiss}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel="Sign in again"
          >
            <Feather name="log-in" size={17} color="#000" style={styles.btnIcon} />
            <Text style={styles.primaryBtnText}>Sign in again</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.82)",
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 24,
  },
  card: {
    backgroundColor: "#0F1117",
    borderRadius: 24,
    padding: 28,
    width: "100%",
    borderWidth: 1.5,
    borderColor: "rgba(0,229,160,0.28)",
  },
  iconRow: {
    alignItems: "center",
    marginBottom: 16,
    marginTop: 4,
  },
  iconBadge: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: "rgba(0,229,160,0.12)",
    borderWidth: 1,
    borderColor: "rgba(0,229,160,0.28)",
    justifyContent: "center",
    alignItems: "center",
  },
  title: {
    color: "#FFFFFF",
    fontSize: 20,
    fontWeight: "700",
    textAlign: "center",
    marginBottom: 10,
    letterSpacing: 0.2,
  },
  message: {
    color: "#A8B2C8",
    fontSize: 15,
    lineHeight: 22,
    textAlign: "center",
    marginBottom: 24,
  },
  primaryBtn: {
    backgroundColor: "#00E5A0",
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 18,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  btnIcon: {
    marginRight: 8,
  },
  primaryBtnText: {
    color: "#000",
    fontSize: 16,
    fontWeight: "700",
  },
});
