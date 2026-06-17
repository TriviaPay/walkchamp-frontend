import React from "react";
import {
  View,
  Text,
  Modal,
  StyleSheet,
  TouchableOpacity,
} from "react-native";
import { Feather } from "@expo/vector-icons";

interface AlreadyHostingModalProps {
  visible: boolean;
  onGoToRoom: () => void;
  onDismiss: () => void;
}

export default function AlreadyHostingModal({
  visible,
  onGoToRoom,
  onDismiss,
}: AlreadyHostingModalProps) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
    >
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <TouchableOpacity
            style={styles.closeBtn}
            onPress={onDismiss}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Feather name="x" size={20} color="#5A6A8A" />
          </TouchableOpacity>

          <View style={styles.iconRow}>
            <View style={styles.iconBadge}>
              <Feather name="alert-triangle" size={24} color="#FF6B35" />
            </View>
          </View>

          <Text style={styles.title}>Already Hosting</Text>
          <Text style={styles.message}>
            You're currently hosting a room. You can only host one room at a time.
          </Text>

          <View style={styles.buttonStack}>
            <TouchableOpacity
              style={styles.primaryBtn}
              onPress={onGoToRoom}
              activeOpacity={0.8}
            >
              <Feather name="play-circle" size={17} color="#000" style={styles.btnIcon} />
              <Text style={styles.primaryBtnText}>Go to My Room</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.dismissBtn}
              onPress={onDismiss}
              activeOpacity={0.8}
            >
              <Text style={styles.dismissBtnText}>Dismiss</Text>
            </TouchableOpacity>
          </View>
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
    borderColor: "rgba(255,107,53,0.35)",
    position: "relative",
  },
  closeBtn: {
    position: "absolute",
    top: 16,
    right: 16,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "#161A26",
    borderWidth: 1,
    borderColor: "#1E2230",
    justifyContent: "center",
    alignItems: "center",
    zIndex: 1,
  },
  iconRow: {
    alignItems: "center",
    marginBottom: 16,
    marginTop: 8,
  },
  iconBadge: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: "rgba(255,107,53,0.12)",
    borderWidth: 1,
    borderColor: "rgba(255,107,53,0.25)",
    justifyContent: "center",
    alignItems: "center",
  },
  title: {
    color: "#FFFFFF",
    fontSize: 18,
    fontWeight: "700",
    textAlign: "center",
    marginBottom: 10,
    letterSpacing: -0.3,
  },
  message: {
    color: "#8B9BBE",
    fontSize: 14,
    textAlign: "center",
    lineHeight: 22,
    marginBottom: 24,
  },
  buttonStack: {
    gap: 10,
  },
  primaryBtn: {
    backgroundColor: "#00E676",
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "center",
  },
  primaryBtnText: {
    color: "#000000",
    fontSize: 16,
    fontWeight: "700",
  },
  dismissBtn: {
    backgroundColor: "#161A26",
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#2A3352",
  },
  dismissBtnText: {
    color: "#8B9BBE",
    fontSize: 16,
    fontWeight: "600",
  },
  btnIcon: {
    marginRight: 8,
  },
});
