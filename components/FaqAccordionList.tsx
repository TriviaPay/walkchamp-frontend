import React, { useState } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { rf, rs } from "@/utils/responsive";
import { WALK_CHAMP_FAQ } from "@/constants/walkChampFaq";

type Props = {
  /** Optional top intro text under the header. */
  intro?: string;
};

/**
 * Sectioned accordion FAQ list shared by Profile FAQ and My Profile FAQ subpage.
 */
export function FaqAccordionList({ intro }: Props) {
  const colors = useColors();
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  return (
    <View style={styles.wrap}>
      {intro ? (
        <Text style={[styles.intro, { color: colors.mutedForeground }]}>{intro}</Text>
      ) : null}

      {WALK_CHAMP_FAQ.map((section) => (
        <View key={section.title} style={styles.section}>
          <Text style={[styles.sectionTitle, { color: colors.foreground }]}>{section.title}</Text>
          {section.items.map((item, index) => {
            const key = `${section.title}:${index}`;
            const open = expandedKey === key;
            return (
              <TouchableOpacity
                key={key}
                activeOpacity={0.75}
                style={[
                  styles.item,
                  {
                    backgroundColor: colors.card,
                    borderColor: open ? colors.primary + "50" : colors.border,
                  },
                ]}
                onPress={() => setExpandedKey((prev) => (prev === key ? null : key))}
              >
                <View style={styles.itemHeader}>
                  <Text style={[styles.question, { color: colors.foreground, flex: 1 }]}>{item.q}</Text>
                  <Feather
                    name={open ? "chevron-up" : "chevron-down"}
                    size={16}
                    color={colors.mutedForeground}
                  />
                </View>
                {open ? (
                  <Text style={[styles.answer, { color: colors.mutedForeground }]}>{item.a}</Text>
                ) : null}
              </TouchableOpacity>
            );
          })}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: rs(18) },
  intro: { fontSize: rf(14), lineHeight: rf(20), marginBottom: 2 },
  section: { gap: rs(10) },
  sectionTitle: {
    fontSize: rf(13),
    fontWeight: "800",
    letterSpacing: 0.4,
    textTransform: "uppercase",
    marginTop: 2,
    marginBottom: 2,
  },
  item: { borderRadius: 14, borderWidth: 1, padding: 16, gap: 12 },
  itemHeader: { flexDirection: "row", alignItems: "center", gap: 12 },
  question: { fontSize: rf(15), fontWeight: "600", lineHeight: 21 },
  answer: { fontSize: rf(14), lineHeight: 21 },
});
