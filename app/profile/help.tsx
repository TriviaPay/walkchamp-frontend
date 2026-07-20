import React from "react";
import { Linking, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import { useColors } from "@/hooks/useColors";
import { useSafeLayout } from "@/hooks/useSafeLayout";
import { AppAlert } from "@/components/AppAlert";
import { rf } from "@/utils/responsive";

const SUPPORT_EMAIL = "support@walkchamp.app";

const TROUBLESHOOT = [
  { q: "Steps not tracking?", a: "Make sure you've granted Step permissions. Go to Profile → Preferences → Wearable Setup." },
  { q: "Challenge not showing?", a: "Pull to refresh on the Live tab. Check your internet connection." },
  { q: "Coins balance wrong?", a: "Coin rewards are applied after race finalization. Wait a few minutes then refresh the Wallet tab." },
  { q: "App crashing?", a: "Force-close and reopen the app. If the problem persists, contact support with your username and device model." },
  { q: "Can't deposit or withdraw?", a: "Withdrawals require identity verification. Contact support for assistance." },
  { q: "Wearable not syncing?", a: "Open Wearable Setup from Profile and follow all steps. Make sure your wearable app is syncing to Apple Health or Health Connect." },
];

export default function HelpSupportScreen() {
  const colors = useColors();
  const { safeTop, safeBottom } = useSafeLayout();

  const openEmail = (subject: string) => {
    Linking.openURL(`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}`)
      .catch(() => AppAlert.alert("Email Support", `Please email us at:\n${SUPPORT_EMAIL}`));
  };

  const contacts = [
    { icon: "mail" as const,           label: "Email Support",  sub: SUPPORT_EMAIL,               onPress: () => openEmail("Walk Champ Support") },
    { icon: "alert-circle" as const,   label: "Report a Bug",   sub: "Describe what went wrong",  onPress: () => openEmail("Walk Champ Bug Report") },
    { icon: "message-square" as const, label: "Give Feedback",  sub: "Help us improve the app",   onPress: () => openEmail("Walk Champ Feedback") },
  ];

  return (
    <View style={[hs.container, { backgroundColor: colors.background }]}>
      <View style={[hs.header, { paddingTop: safeTop + 16, borderBottomColor: colors.border }]}>
        <TouchableOpacity
          onPress={() => router.back()}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Feather name="arrow-left" size={22} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={[hs.headerTitle, { color: colors.foreground }]}>Help & Support</Text>
        <View style={{ width: 22 }} />
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[hs.list, { paddingBottom: safeBottom + 40 }]}
      >
        <Text style={[hs.sectionLabel, { color: colors.foreground }]}>Contact Us</Text>
        <View style={[hs.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          {contacts.map((item, i) => (
            <TouchableOpacity
              key={item.label}
              style={[hs.row, i < contacts.length - 1 && { borderBottomColor: colors.border, borderBottomWidth: StyleSheet.hairlineWidth }]}
              onPress={item.onPress}
              activeOpacity={0.7}
            >
              <View style={[hs.rowIcon, { backgroundColor: colors.primary + "15" }]}>
                <Feather name={item.icon} size={17} color={colors.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[hs.rowLabel, { color: colors.foreground }]}>{item.label}</Text>
                <Text style={[hs.rowSub, { color: colors.mutedForeground }]}>{item.sub}</Text>
              </View>
              <Feather name="chevron-right" size={16} color={colors.mutedForeground} />
            </TouchableOpacity>
          ))}
        </View>

        <Text style={[hs.sectionLabel, { color: colors.foreground }]}>Quick Troubleshooting</Text>
        <View style={[hs.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
          {TROUBLESHOOT.map((item, i) => (
            <View
              key={item.q}
              style={[hs.troubleRow, i < TROUBLESHOOT.length - 1 && { borderBottomColor: colors.border, borderBottomWidth: StyleSheet.hairlineWidth }]}
            >
              <Text style={[hs.troubleQ, { color: colors.foreground }]}>{item.q}</Text>
              <Text style={[hs.troubleA, { color: colors.mutedForeground }]}>{item.a}</Text>
            </View>
          ))}
        </View>

        <View style={[hs.note, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Feather name="clock" size={14} color={colors.mutedForeground} />
          <Text style={[hs.noteText, { color: colors.mutedForeground }]}>
            We typically respond within 24–48 hours. Please include your username and device model for faster support.
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

const hs = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: 20, paddingBottom: 16, borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTitle: { fontSize: 17, fontWeight: "700" },
  list: { paddingHorizontal: 16, paddingTop: 20, gap: 16 },
  sectionLabel: { fontSize: rf(16), fontWeight: "800" },
  card: { borderRadius: 16, borderWidth: 1, overflow: "hidden" },
  row: { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 14, gap: 14 },
  rowIcon: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  rowLabel: { fontSize: rf(15), fontWeight: "500" },
  rowSub: { fontSize: rf(12), marginTop: 1 },
  troubleRow: { paddingHorizontal: 16, paddingVertical: 13, gap: 4 },
  troubleQ: { fontSize: rf(14), fontWeight: "600" },
  troubleA: { fontSize: rf(13), lineHeight: 18 },
  note: { flexDirection: "row", alignItems: "flex-start", gap: 10, borderRadius: 12, borderWidth: 1, padding: 14 },
  noteText: { flex: 1, fontSize: rf(12), lineHeight: 17 },
});
