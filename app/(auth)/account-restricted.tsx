import { router } from "expo-router";
import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { useSafeLayout } from "@/hooks/useSafeLayout";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";
import { TouchableOpacity } from '@/components/HapticTouchableOpacity';

export default function AccountRestrictedScreen() {
  const colors = useColors();
  const { insets, safeTop, safeBottom } = useSafeLayout();
  const { logout, user } = useAuth();

  const isBanned = user?.accountStatus === "banned";

  async function handleLogout() {
    await logout();
    router.replace("/(auth)");
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingTop: safeTop, paddingBottom: safeBottom }]}>
      <View style={styles.inner}>
        <View style={[styles.iconWrap, { backgroundColor: "#FF444420", borderColor: "#FF444450" }]}>
          <Feather name="shield-off" size={40} color="#FF4444" />
        </View>

        <Text style={[styles.title, { color: colors.foreground }]}>
          {isBanned ? "Account Banned" : "Account Suspended"}
        </Text>

        <Text style={[styles.body, { color: colors.mutedForeground }]}>
          {isBanned
            ? "Your account has been permanently banned due to violations of our Terms of Service. This decision is final."
            : "Your account has been temporarily suspended pending review. This may be due to suspicious activity or a policy violation."}
        </Text>

        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Feather name="info" size={16} color={colors.accent} />
          <Text style={[styles.cardText, { color: colors.foreground }]}>
            If you believe this is a mistake, please contact our support team at support@walkchamp.com with your username and registered email.
          </Text>
        </View>

        <TouchableOpacity
          style={[styles.logoutBtn, { backgroundColor: colors.muted, borderColor: colors.border }]}
          onPress={handleLogout}
        >
          <Feather name="log-out" size={18} color={colors.foreground} />
          <Text style={[styles.logoutText, { color: colors.foreground }]}>Sign Out</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  inner: { flex: 1, paddingHorizontal: 28, justifyContent: "center", alignItems: "center", gap: 20 },
  iconWrap: { width: 90, height: 90, borderRadius: 28, borderWidth: 1, alignItems: "center", justifyContent: "center", marginBottom: 4 },
  title: { fontSize: 26, fontWeight: "800", textAlign: "center", letterSpacing: -0.5 },
  body: { fontSize: 15, textAlign: "center", lineHeight: 24 },
  card: { flexDirection: "row", gap: 12, borderRadius: 14, borderWidth: 1, padding: 16, alignItems: "flex-start" },
  cardText: { fontSize: 14, lineHeight: 22, flex: 1 },
  logoutBtn: { flexDirection: "row", alignItems: "center", gap: 10, borderRadius: 14, borderWidth: 1, paddingHorizontal: 24, paddingVertical: 14, marginTop: 8 },
  logoutText: { fontSize: 16, fontWeight: "600" },
});
