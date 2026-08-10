import React from "react";
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { router } from "expo-router";
import { useColors } from "@/hooks/useColors";
import { useSafeLayout } from "@/hooks/useSafeLayout";
import { FaqAccordionList } from "@/components/FaqAccordionList";
import { rf } from "@/utils/responsive";

export default function FAQScreen() {
  const colors = useColors();
  const { safeTop, safeBottom } = useSafeLayout();

  return (
    <View style={[s.container, { backgroundColor: colors.background }]}>
      <View style={[s.header, { paddingTop: safeTop + 16, borderBottomColor: colors.border }]}>
        <TouchableOpacity
          onPress={() => router.back()}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Feather name="arrow-left" size={22} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={[s.headerTitle, { color: colors.foreground }]}>FAQ</Text>
        <View style={{ width: 22 }} />
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[s.list, { paddingBottom: safeBottom + 40 }]}
      >
        <FaqAccordionList intro="Frequently asked questions about Walk Champ." />
      </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingBottom: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTitle: { fontSize: rf(17), fontWeight: "700" },
  list: { paddingHorizontal: 16, paddingTop: 20 },
});
