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
  TERMS_DOCUMENT,
  TERMS_SUPPORT_EMAIL,
  searchTermsSections,
  type TermsSection,
} from "@/constants/termsAndConditions";

const ACCENT = "#22C55E";

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
    if (trimmed.startsWith("• ") || trimmed.startsWith("- ")) {
      flushParagraph();
      bullets.push(trimmed.slice(2));
      continue;
    }
    flushBullets();
    if (/^(\d+\.\d+\s+)?[A-Za-z][A-Za-z0-9 /,&-]+:$/.test(trimmed) && trimmed.length < 64) {
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
        part.toLowerCase() === TERMS_SUPPORT_EMAIL ? (
          <Text
            key={`${part}-${i}`}
            style={{ color: linkColor, textDecorationLine: "underline" }}
            onPress={() =>
              void Linking.openURL(
                `mailto:${TERMS_SUPPORT_EMAIL}?subject=${encodeURIComponent("WalkChamp Terms and Conditions Question")}`,
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
  section: TermsSection;
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
        accessibilityLabel={`${section.number}. ${section.title}`}
      >
        <Text style={[styles.sectionHeading, { color: colors.foreground, flex: 1 }]} numberOfLines={2}>
          {section.number}. {section.title}
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

export function TermsAndConditionsDocument({ contentBottomPad = 40 }: Props) {
  const colors = useColors();
  const listRef = useRef<FlatList<TermsSection>>(null);
  const [query, setQuery] = useState("");
  const [tocOpen, setTocOpen] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const filtered = useMemo(() => searchTermsSections(query), [query]);

  const toggleSection = useCallback((id: string) => {
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));
  }, []);

  const openSupportEmail = useCallback(() => {
    const subject = encodeURIComponent("WalkChamp Terms and Conditions Question");
    const body = encodeURIComponent(
      [
        "Hello WalkChamp Support,",
        "",
        "Username:",
        "Account email:",
        "Country/region:",
        "Challenge or Room ID, if applicable:",
        "Question or issue:",
        "",
      ].join("\n"),
    );
    void Linking.openURL(`mailto:${TERMS_SUPPORT_EMAIL}?subject=${subject}&body=${body}`);
  }, []);

  const jumpToSection = useCallback(
    (id: string) => {
      if (query) setQuery("");
      setExpanded((prev) => ({ ...prev, [id]: true }));
      setTocOpen(false);
      const index = TERMS_DOCUMENT.sections.findIndex((s) => s.id === id);
      if (index < 0) return;
      requestAnimationFrame(() => {
        listRef.current?.scrollToIndex({ index, animated: true, viewOffset: 8 });
      });
    },
    [query],
  );

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<TermsSection>) => (
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
        <View
          style={[styles.searchBox, { backgroundColor: colors.card, borderColor: colors.border }]}
          accessibilityLabel="Search Terms"
        >
          <Feather name="search" size={15} color={colors.mutedForeground} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search Terms"
            placeholderTextColor={colors.mutedForeground}
            style={[styles.searchInput, { color: colors.foreground }]}
            autoCorrect={false}
            autoCapitalize="none"
            clearButtonMode="while-editing"
            accessibilityLabel="Search Terms"
          />
          {query.length > 0 ? (
            <TouchableOpacity onPress={() => setQuery("")} hitSlop={8} accessibilityLabel="Clear search">
              <Feather name="x" size={15} color={colors.mutedForeground} />
            </TouchableOpacity>
          ) : null}
        </View>

        <TouchableOpacity
          style={[styles.tocBtn, { backgroundColor: ACCENT + "18", borderColor: ACCENT + "55" }]}
          onPress={() => setTocOpen((v) => !v)}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel={tocOpen ? "Hide table of contents" : "Show table of contents"}
        >
          <Feather name="list" size={15} color={ACCENT} />
          <Text style={[styles.tocBtnText, { color: ACCENT }]}>
            {tocOpen ? "Hide Contents" : "Contents"}
          </Text>
        </TouchableOpacity>

        {tocOpen ? (
          <View style={[styles.tocPanel, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <FlatList
              data={TERMS_DOCUMENT.sections}
              keyExtractor={(s) => s.id}
              nestedScrollEnabled
              style={{ maxHeight: rs(220) }}
              renderItem={({ item: section }) => (
                <TouchableOpacity
                  style={styles.tocRow}
                  onPress={() => jumpToSection(section.id)}
                  accessibilityRole="button"
                  accessibilityLabel={`Go to section ${section.number}: ${section.title}`}
                >
                  <Text style={[styles.tocNum, { color: colors.mutedForeground }]}>{section.number}.</Text>
                  <Text style={[styles.tocTitle, { color: colors.mutedForeground }]} numberOfLines={2}>
                    {section.title}
                  </Text>
                </TouchableOpacity>
              )}
              initialNumToRender={12}
              windowSize={5}
            />
          </View>
        ) : null}

        <View style={[styles.hero, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text selectable style={[styles.heroBrand, { color: ACCENT }]}>
            WALK CHAMP
          </Text>
          <Text selectable style={[styles.heroTitle, { color: colors.foreground }]}>
            TERMS AND CONDITIONS
          </Text>
          <Text selectable style={[styles.heroMeta, { color: colors.mutedForeground }]}>
            Last Updated: {TERMS_DOCUMENT.lastUpdatedLabel}
          </Text>
          <Text selectable style={[styles.heroIntro, { color: colors.mutedForeground }]}>
            {TERMS_DOCUMENT.intro}
          </Text>
          <Text selectable style={[styles.heroAppleNote, { color: colors.mutedForeground }]}>
            Apple Inc. and Google LLC do not sponsor, endorse, administer, operate, or provide prizes for WalkChamp or any Challenge.
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
            <Text style={[styles.emptyBody, { color: colors.mutedForeground }]}>
              Try Entry fee, Prize pool, Refund, Coins, Sponsored Event, Apple Health, or Arbitration.
            </Text>
          </View>
        ) : null}

        <View style={[styles.supportCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.supportTitle, { color: colors.foreground }]}>Questions about these Terms?</Text>
          <Text style={[styles.supportBody, { color: colors.mutedForeground }]}>
            Contact the WalkChamp support team if you need help understanding these Terms or resolving a challenge, payment, reward, refund, or Account issue.
          </Text>
          <TouchableOpacity
            style={styles.contactBtn}
            onPress={openSupportEmail}
            activeOpacity={0.88}
            accessibilityRole="button"
            accessibilityLabel="Contact Support by email"
          >
            <Feather name="mail" size={16} color="#FFF" />
            <Text style={styles.contactBtnText}>Contact Support</Text>
          </TouchableOpacity>
          <Text style={[styles.contactHint, { color: colors.mutedForeground }]}>
            Opens email to {TERMS_SUPPORT_EMAIL}
          </Text>
        </View>
      </View>
    ),
    [colors, filtered.length, openSupportEmail],
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

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { paddingHorizontal: rs(16), paddingTop: rs(12) },
  headerBlock: { gap: rs(10), marginBottom: rs(8) },
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
    gap: 8,
  },
  heroBrand: { fontSize: rf(12), fontWeight: "900", letterSpacing: 1.2 },
  heroTitle: { fontSize: rf(20), fontWeight: "900", letterSpacing: 0.2 },
  heroMeta: { fontSize: rf(12.5), fontWeight: "600" },
  heroIntro: { fontSize: rf(13.5), lineHeight: rf(20), marginTop: 4 },
  heroAppleNote: { fontSize: rf(12), lineHeight: rf(17), marginTop: 2, fontStyle: "italic" },
  heroHint: { fontSize: rf(12), lineHeight: rf(17), marginTop: 2 },
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
  emptyBody: { fontSize: rf(13), lineHeight: rf(18), textAlign: "center" },
  supportCard: {
    borderRadius: 18,
    borderWidth: 1,
    padding: rs(16),
    gap: 10,
    marginTop: 4,
  },
  supportTitle: { fontSize: rf(16), fontWeight: "800" },
  supportBody: { fontSize: rf(13.5), lineHeight: rf(19) },
  contactBtn: {
    height: rs(50),
    borderRadius: 14,
    backgroundColor: ACCENT,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginTop: 4,
  },
  contactBtnText: { color: "#FFF", fontSize: rf(15), fontWeight: "800" },
  contactHint: { textAlign: "center", fontSize: rf(11) },
});
