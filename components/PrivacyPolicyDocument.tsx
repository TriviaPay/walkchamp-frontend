import React, { memo, useCallback, useMemo, useRef, useState } from "react";
import {
  FlatList,
  Linking,
  StyleSheet,
  Text,
  TextInput,
  View,
  type ListRenderItemInfo,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { TouchableOpacity } from "@/components/HapticTouchableOpacity";
import { rf, rs } from "@/utils/responsive";
import {
  PRIVACY_POLICY_LAST_UPDATED,
  PRIVACY_POLICY_SECTIONS,
  PRIVACY_POLICY_SUPPORT_EMAIL,
  PRIVACY_POLICY_TITLE,
  searchPrivacyPolicySections,
  type PrivacyPolicySection,
} from "@/constants/privacyPolicy";

const ACCENT = "#A78BFA";

type BodyPart =
  | { kind: "p"; text: string }
  | { kind: "ul"; items: string[] }
  | { kind: "label"; text: string };

const bodyCache = new Map<string, BodyPart[]>();

function parseBody(body: string): BodyPart[] {
  const cached = bodyCache.get(body);
  if (cached) return cached;

  const lines = body.split("\n");
  const parts: BodyPart[] = [];
  let paragraph: string[] = [];
  let bullets: string[] = [];

  const flushParagraph = () => {
    const text = paragraph.join(" ").trim();
    if (text) parts.push({ kind: "p", text });
    paragraph = [];
  };
  const flushBullets = () => {
    if (bullets.length) parts.push({ kind: "ul", items: bullets });
    bullets = [];
  };

  for (const raw of lines) {
    const trimmed = raw.trim();
    if (!trimmed) {
      flushBullets();
      flushParagraph();
      continue;
    }
    if (trimmed.startsWith("• ")) {
      flushParagraph();
      bullets.push(trimmed.slice(2));
      continue;
    }
    flushBullets();
    if (/^[A-Za-z][A-Za-z /,&-]+:$/.test(trimmed) && trimmed.length < 48) {
      flushParagraph();
      parts.push({ kind: "label", text: trimmed });
      continue;
    }
    paragraph.push(trimmed);
  }
  flushBullets();
  flushParagraph();
  bodyCache.set(body, parts);
  return parts;
}

function renderTextWithEmails(
  text: string,
  color: string,
  linkColor: string,
  style: object,
) {
  const parts = text.split(/(admin@miragaming\.com)/gi);
  if (parts.length === 1) {
    return (
      <Text selectable style={[style, { color }]}>
        {text}
      </Text>
    );
  }
  return (
    <Text selectable style={[style, { color }]}>
      {parts.map((part, i) =>
        part.toLowerCase() === PRIVACY_POLICY_SUPPORT_EMAIL ? (
          <Text
            key={`${part}-${i}`}
            style={{ color: linkColor, textDecorationLine: "underline" }}
            onPress={() =>
              void Linking.openURL(
                `mailto:${PRIVACY_POLICY_SUPPORT_EMAIL}?subject=${encodeURIComponent("Walk Champ Privacy Request")}`,
              )
            }
          >
            {part}
          </Text>
        ) : (
          <Text key={`${part}-${i}`}>{part}</Text>
        ),
      )}
    </Text>
  );
}

const SectionBody = memo(function SectionBody({
  body,
  colors,
}: {
  body: string;
  colors: ReturnType<typeof useColors>;
}) {
  const parts = useMemo(() => parseBody(body), [body]);
  return (
    <View style={styles.bodyBlocks}>
      {parts.map((part, index) => {
        if (part.kind === "ul") {
          return (
            <View key={`ul-${index}`} style={styles.bulletList}>
              {part.items.map((item, j) => (
                <View key={`${j}-${item.slice(0, 24)}`} style={styles.bulletRow}>
                  <Text style={[styles.bulletDot, { color: ACCENT }]}>•</Text>
                  {renderTextWithEmails(item, colors.mutedForeground, ACCENT, styles.bodyText)}
                </View>
              ))}
            </View>
          );
        }
        if (part.kind === "label") {
          return (
            <Text key={`label-${index}`} selectable style={[styles.labelLine, { color: colors.foreground }]}>
              {part.text}
            </Text>
          );
        }
        return (
          <View key={`p-${index}`}>
            {renderTextWithEmails(part.text, colors.mutedForeground, ACCENT, styles.bodyText)}
          </View>
        );
      })}
    </View>
  );
});

const SectionCard = memo(function SectionCard({
  section,
  open,
  onToggle,
  colors,
}: {
  section: PrivacyPolicySection;
  open: boolean;
  onToggle: (id: string) => void;
  colors: ReturnType<typeof useColors>;
}) {
  return (
    <View style={[styles.sectionCard, { backgroundColor: colors.card, borderColor: open ? ACCENT + "55" : colors.border }]}>
      <TouchableOpacity
        style={styles.sectionHeader}
        onPress={() => onToggle(section.id)}
        activeOpacity={0.75}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`${section.number}. ${toTitleCase(section.title)}`}
      >
        <Text style={[styles.sectionHeading, { color: colors.foreground, flex: 1 }]} numberOfLines={2}>
          {section.number}. {toTitleCase(section.title)}
        </Text>
        <Feather
          name={open ? "chevron-up" : "chevron-down"}
          size={16}
          color={colors.mutedForeground}
        />
      </TouchableOpacity>
      {open ? <SectionBody body={section.body} colors={colors} /> : null}
    </View>
  );
});

type Props = {
  contentBottomPad?: number;
};

export function PrivacyPolicyDocument({ contentBottomPad = 40 }: Props) {
  const colors = useColors();
  const listRef = useRef<FlatList<PrivacyPolicySection>>(null);
  const [query, setQuery] = useState("");
  const [tocOpen, setTocOpen] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const filtered = useMemo(() => searchPrivacyPolicySections(query), [query]);

  const toggleSection = useCallback((id: string) => {
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));
  }, []);

  const openPrivacyEmail = useCallback(() => {
    void Linking.openURL(
      `mailto:${PRIVACY_POLICY_SUPPORT_EMAIL}?subject=${encodeURIComponent("Walk Champ Privacy Request")}`,
    );
  }, []);

  const jumpToSection = useCallback(
    (id: string) => {
      if (query) setQuery("");
      setExpanded((prev) => ({ ...prev, [id]: true }));
      setTocOpen(false);
      const index = PRIVACY_POLICY_SECTIONS.findIndex((s) => s.id === id);
      if (index < 0) return;
      requestAnimationFrame(() => {
        listRef.current?.scrollToIndex({ index, animated: true, viewOffset: 8 });
      });
    },
    [query],
  );

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<PrivacyPolicySection>) => (
      <SectionCard
        section={item}
        open={!!expanded[item.id]}
        onToggle={toggleSection}
        colors={colors}
      />
    ),
    [colors, expanded, toggleSection],
  );

  const listHeader = useMemo(
    () => (
      <View style={styles.headerBlock}>
        <View style={[styles.searchBox, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Feather name="search" size={15} color={colors.mutedForeground} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search Health Data, Stripe, California…"
            placeholderTextColor={colors.mutedForeground}
            style={[styles.searchInput, { color: colors.foreground }]}
            autoCorrect={false}
            autoCapitalize="none"
            clearButtonMode="while-editing"
          />
          {query.length > 0 ? (
            <TouchableOpacity onPress={() => setQuery("")} hitSlop={8}>
              <Feather name="x" size={15} color={colors.mutedForeground} />
            </TouchableOpacity>
          ) : null}
        </View>

        <TouchableOpacity
          style={[styles.tocBtn, { backgroundColor: ACCENT + "18", borderColor: ACCENT + "55" }]}
          onPress={() => setTocOpen((v) => !v)}
          activeOpacity={0.85}
        >
          <Feather name="list" size={15} color={ACCENT} />
          <Text style={[styles.tocBtnText, { color: ACCENT }]}>
            {tocOpen ? "Hide Contents" : "Contents"}
          </Text>
        </TouchableOpacity>

        {tocOpen ? (
          <View style={[styles.tocPanel, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <FlatList
              data={PRIVACY_POLICY_SECTIONS}
              keyExtractor={(s) => s.id}
              nestedScrollEnabled
              style={{ maxHeight: rs(220) }}
              renderItem={({ item: section }) => (
                <TouchableOpacity style={styles.tocRow} onPress={() => jumpToSection(section.id)}>
                  <Text style={[styles.tocNum, { color: colors.mutedForeground }]}>{section.number}.</Text>
                  <Text style={[styles.tocTitle, { color: colors.mutedForeground }]} numberOfLines={2}>
                    {toTitleCase(section.title)}
                  </Text>
                </TouchableOpacity>
              )}
              initialNumToRender={12}
              windowSize={5}
            />
          </View>
        ) : null}

        <View style={[styles.hero, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text selectable style={[styles.heroTitle, { color: colors.foreground }]}>
            {PRIVACY_POLICY_TITLE}
          </Text>
          <Text selectable style={[styles.heroMeta, { color: colors.mutedForeground }]}>
            Last Updated: {PRIVACY_POLICY_LAST_UPDATED}
          </Text>
          <Text selectable style={[styles.heroCompany, { color: colors.mutedForeground }]}>
            MIRA GAMING PRIVATE LIMITED
          </Text>
          <Text style={[styles.heroHint, { color: colors.mutedForeground }]}>
            Tap a section to expand. Use Contents or Search to jump quickly.
          </Text>
        </View>
      </View>
    ),
    [colors, jumpToSection, query, tocOpen],
  );

  const listFooter = useMemo(
    () => (
      <View style={styles.footerBlock}>
        {filtered.length === 0 ? (
          <View style={[styles.empty, { borderColor: colors.border, backgroundColor: colors.card }]}>
            <Feather name="search" size={22} color={colors.mutedForeground} />
            <Text style={[styles.emptyTitle, { color: colors.foreground }]}>No matching sections</Text>
          </View>
        ) : null}
        <TouchableOpacity style={styles.contactBtn} onPress={openPrivacyEmail} activeOpacity={0.88}>
          <Feather name="mail" size={16} color="#FFF" />
          <Text style={styles.contactBtnText}>Contact Privacy Support</Text>
        </TouchableOpacity>
        <Text style={[styles.contactHint, { color: colors.mutedForeground }]}>
          Opens email to {PRIVACY_POLICY_SUPPORT_EMAIL}
        </Text>
      </View>
    ),
    [colors, filtered.length, openPrivacyEmail],
  );

  return (
    <FlatList
      ref={listRef}
      style={styles.flex}
      data={filtered}
      keyExtractor={(item) => item.id}
      renderItem={renderItem}
      ListHeaderComponent={listHeader}
      ListFooterComponent={listFooter}
      contentContainerStyle={[styles.content, { paddingBottom: contentBottomPad }]}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      initialNumToRender={14}
      maxToRenderPerBatch={10}
      windowSize={8}
      removeClippedSubviews
      onScrollToIndexFailed={(info) => {
        listRef.current?.scrollToOffset({
          offset: Math.max(0, info.averageItemLength * info.index),
          animated: true,
        });
      }}
    />
  );
}

function toTitleCase(title: string): string {
  return title
    .toLowerCase()
    .split(" ")
    .map((word) => {
      if (["and", "of", "the", "or", "for", "to", "in", "a"].includes(word)) return word;
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(" ")
    .replace(/\bGdpr\b/g, "GDPR")
    .replace(/\bKyc\b/g, "KYC")
    .replace(/\bIp\b/g, "IP")
    .replace(/\bUs\b/g, "US")
    .replace(/\bUk\b/g, "UK");
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { paddingHorizontal: rs(16), paddingTop: rs(12), gap: rs(10) },
  headerBlock: { gap: rs(10), marginBottom: rs(4) },
  footerBlock: { gap: rs(10), marginTop: rs(8) },
  searchBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    minHeight: 44,
  },
  searchInput: { flex: 1, fontSize: rf(14), paddingVertical: 8 },
  tocBtn: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  tocBtnText: { fontSize: rf(12), fontWeight: "800" },
  tocPanel: {
    borderRadius: 14,
    borderWidth: 1,
    paddingVertical: 6,
    overflow: "hidden",
  },
  tocRow: {
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  tocNum: { fontSize: rf(12), fontWeight: "700", width: 28 },
  tocTitle: { flex: 1, fontSize: rf(12.5), fontWeight: "600", lineHeight: rf(17) },
  hero: {
    borderRadius: 18,
    borderWidth: 1,
    padding: rs(16),
    gap: 6,
  },
  heroTitle: { fontSize: rf(18), fontWeight: "900", letterSpacing: 0.2 },
  heroMeta: { fontSize: rf(12.5), fontWeight: "600" },
  heroCompany: { fontSize: rf(12), marginTop: 2 },
  heroHint: { fontSize: rf(12), lineHeight: rf(17), marginTop: 4 },
  sectionCard: {
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: rs(14),
    paddingVertical: rs(4),
    marginBottom: rs(10),
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: rs(12),
  },
  sectionHeading: { fontSize: rf(14.5), fontWeight: "800", lineHeight: rf(20) },
  bodyBlocks: { gap: 10, paddingBottom: rs(12) },
  bodyText: { fontSize: rf(13.5), lineHeight: rf(20), flexShrink: 1 },
  labelLine: { fontSize: rf(13), fontWeight: "800", marginTop: 2 },
  bulletList: { gap: 6 },
  bulletRow: { flexDirection: "row", gap: 8, alignItems: "flex-start" },
  bulletDot: { fontSize: rf(14), lineHeight: rf(20), width: 12, fontWeight: "700" },
  empty: {
    borderRadius: 16,
    borderWidth: 1,
    padding: rs(18),
    alignItems: "center",
    gap: 8,
  },
  emptyTitle: { fontSize: rf(15), fontWeight: "800" },
  contactBtn: {
    height: rs(50),
    borderRadius: 14,
    backgroundColor: ACCENT,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  contactBtnText: { color: "#FFF", fontSize: rf(15), fontWeight: "800" },
  contactHint: { textAlign: "center", fontSize: rf(11), marginBottom: 8 },
});
