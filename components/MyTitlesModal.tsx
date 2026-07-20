import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { useTheme } from "@/context/ThemeContext";
import { useSafeLayout } from "@/hooks/useSafeLayout";
import { SkeletonList } from "@/components/SkeletonRows";
import { getValidSession } from "@/services/authService";
import { TitleBadge } from "@/components/TitleBadge";

const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? "";
const SUCCESS_TOAST_ORANGE = "#FF9800";

// ── Types ─────────────────────────────────────────────────────────────────────
export interface TitleEntry {
  code:           string;
  title:          string;
  description:    string;
  category:       string;
  difficulty:     string;
  goal_to_reach:  string;
  progress_value: number;
  target_value:   number | null;
  unlocked:       boolean;
  owned:          boolean;
  is_active:      boolean;
  unlocked_at:    string | null;
  icon:           string | null;
  badge_color:    string | null;
  sort_order:     number;
}

export interface ActiveTitle {
  code:       string;
  title:      string;
  difficulty: string;
  icon:       string | null;
}

// ── Difficulty helpers ────────────────────────────────────────────────────────
export function difficultyColor(d: string, colors: ReturnType<typeof useColors>): string {
  switch (d) {
    case "easy":      return "#00E676";
    case "medium":    return "#FFD700";
    case "hard":      return "#FF6B00";
    case "very_hard": return "#FF0057";
    case "legendary": return "#9B59B6";
    default:          return colors.mutedForeground;
  }
}

function difficultyLabel(d: string): string {
  switch (d) {
    case "very_hard": return "Very Hard";
    case "legendary": return "Legendary";
    default:          return d.charAt(0).toUpperCase() + d.slice(1);
  }
}

const FILTERS = ["All", "Easy", "Medium", "Hard", "Very Hard", "Legendary"] as const;
type Filter = typeof FILTERS[number];

function filterKey(f: Filter): string {
  return f === "Very Hard" ? "very_hard" : f.toLowerCase();
}

function filterColor(f: Filter): string {
  switch (f) {
    case "Easy":      return "#00E676";
    case "Medium":    return "#FFD700";
    case "Hard":      return "#FF6B00";
    case "Very Hard": return "#FF0057";
    case "Legendary": return "#9B59B6";
    default:          return "#00E676";
  }
}

// ── API helpers ───────────────────────────────────────────────────────────────
async function fetchTitles(): Promise<{ owned_count: number; active_title: ActiveTitle | null; titles: TitleEntry[] } | null> {
  try {
    const session = await getValidSession();
    if (!session) return null;
    const res = await fetch(`${API_BASE}/api/achievements/titles`, {
      headers: { Authorization: `Bearer ${session}` },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

async function equipTitle(code: string): Promise<{ success: boolean; active_title?: ActiveTitle; error?: string }> {
  try {
    const session = await getValidSession();
    if (!session) return { success: false, error: "Not authenticated" };
    const res = await fetch(`${API_BASE}/api/titles/equip`, {
      method: "POST",
      headers: { Authorization: `Bearer ${session}`, "Content-Type": "application/json" },
      body: JSON.stringify({ achievement_code: code }),
    });
    const json = await res.json();
    if (!res.ok) return { success: false, error: json.error ?? "Failed to equip title" };
    return { success: true, active_title: json.active_title };
  } catch {
    return { success: false, error: "Network error" };
  }
}

async function unequipTitle(): Promise<boolean> {
  try {
    const session = await getValidSession();
    if (!session) return false;
    const res = await fetch(`${API_BASE}/api/titles/unequip`, {
      method: "POST",
      headers: { Authorization: `Bearer ${session}`, "Content-Type": "application/json" },
    });
    return res.ok;
  } catch {
    return false;
  }
}

// ── Title row ─────────────────────────────────────────────────────────────────
function TitleRow({
  entry, selected, onSelect, colors,
}: {
  entry:    TitleEntry;
  selected: boolean;
  onSelect: (code: string) => void;
  colors:   ReturnType<typeof useColors>;
}) {
  const dColor  = difficultyColor(entry.difficulty, colors);
  const isLocked = !entry.owned;

  return (
    <TouchableOpacity
      activeOpacity={isLocked ? 1 : 0.75}
      onPress={() => { if (!isLocked) onSelect(entry.code); }}
      style={[
        st.row,
        {
          backgroundColor: selected
            ? "#00E67608"
            : isLocked
            ? colors.card + "CC"
            : colors.card,
          borderColor: selected
            ? "#00E676"
            : isLocked
            ? colors.border + "50"
            : colors.border,
        },
        selected && st.rowSelected,
      ]}
    >
      {/* Badge icon */}
      <TitleBadge code={entry.code} difficulty={entry.difficulty} size={48} locked={isLocked} />

      {/* Title + description + progress bar */}
      <View style={st.info}>
        <Text
          style={[st.titleText, { color: isLocked ? colors.mutedForeground : colors.foreground }]}
          numberOfLines={1}
        >
          {entry.title}
        </Text>
        <Text
          style={[st.descText, { color: colors.mutedForeground }]}
          numberOfLines={2}
        >
          {entry.description}
        </Text>
        {isLocked && (() => {
          const tv = entry.target_value;
          const pv = entry.progress_value;
          if (!tv || tv <= 1 || pv <= 0 || pv > tv) return null;
          const ratio = Math.min(1, pv / tv);
          const pct   = Math.round(ratio * 100);
          return (
            <View style={st.progressWrap}>
              <View style={[st.progressTrack, { backgroundColor: colors.border }]}>
                <View style={[st.progressFill, { width: `${pct}%` as `${number}%`, backgroundColor: dColor }]} />
              </View>
              <Text style={[st.progressPct, { color: dColor }]}>{pct}%</Text>
            </View>
          );
        })()}
      </View>

      {/* Goal + difficulty badge */}
      <View style={st.midCol}>
        {entry.owned ? (
          <View style={st.unlockedRow}>
            <Feather name="check" size={11} color="#00E676" />
            <Text style={st.unlockedText}>Unlocked</Text>
          </View>
        ) : (
          <Text
            style={[st.goalText, { color: colors.mutedForeground }]}
            numberOfLines={3}
          >
            {entry.goal_to_reach}
          </Text>
        )}
        <View style={[st.diffBadge, { backgroundColor: dColor + "1A", borderColor: dColor + "55" }]}>
          <Text style={[st.diffText, { color: dColor }]}>{difficultyLabel(entry.difficulty)}</Text>
        </View>
      </View>

      {/* Selector */}
      <View style={st.selectorCol}>
        {isLocked ? (
          <View style={[st.lockCircle, { borderColor: colors.border }]}>
            <Feather name="lock" size={11} color={colors.mutedForeground} />
          </View>
        ) : selected ? (
          <View style={st.checkCircle}>
            <Feather name="check" size={14} color="#000" />
          </View>
        ) : (
          <View style={[st.radioCircle, { borderColor: colors.border }]} />
        )}
      </View>
    </TouchableOpacity>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
interface Props {
  visible:  boolean;
  onClose:  () => void;
  onSaved:  (title: ActiveTitle | null) => void;
}

export default function MyTitlesModal({ visible, onClose, onSaved }: Props) {
  const colors = useColors();
  const { isDark } = useTheme();
  const { safeTop, safeBottom } = useSafeLayout();

  const [loading,        setLoading]        = useState(false);
  const [saving,         setSaving]         = useState(false);
  const [error,          setError]          = useState<string | null>(null);
  const [ownedCount,     setOwnedCount]     = useState(0);
  const [titles,         setTitles]         = useState<TitleEntry[]>([]);
  const [selectedCode,   setSelectedCode]   = useState<string | null>(null);
  const [originalCode,   setOriginalCode]   = useState<string | null>(null);
  const [activeFilter,   setActiveFilter]   = useState<Filter>("All");
  const [lockedExpanded, setLockedExpanded] = useState(true);
  const [toast,          setToast]          = useState<{ msg: string; ok: boolean } | null>(null);

  const toastAnim = useRef(new Animated.Value(0)).current;

  const showToast = useCallback((msg: string, ok: boolean) => {
    setToast({ msg, ok });
    Animated.sequence([
      Animated.timing(toastAnim, { toValue: 1, duration: 250, useNativeDriver: true }),
      Animated.delay(2000),
      Animated.timing(toastAnim, { toValue: 0, duration: 250, useNativeDriver: true }),
    ]).start(() => setToast(null));
  }, [toastAnim]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const data = await fetchTitles();
    setLoading(false);
    if (!data) { setError("Failed to load titles. Tap to retry."); return; }
    setOwnedCount(data.owned_count);
    setTitles(data.titles);
    const active = data.active_title?.code ?? null;
    setSelectedCode(active);
    setOriginalCode(active);
  }, []);

  useEffect(() => {
    if (visible) load();
  }, [visible, load]);

  const handleSelect = useCallback((code: string) => {
    setSelectedCode((prev) => prev === code ? null : code);
  }, []);

  const handleSave = async () => {
    if (saving) return;
    setSaving(true);
    try {
      if (selectedCode === null) {
        const ok = await unequipTitle();
        if (ok) {
          setOriginalCode(null);
          showToast("Title removed", true);
          onSaved(null);
        } else {
          showToast("Failed to remove title", false);
        }
      } else {
        const result = await equipTitle(selectedCode);
        if (result.success && result.active_title) {
          setOriginalCode(selectedCode);
          showToast("Active title updated!", true);
          onSaved(result.active_title);
        } else {
          showToast(result.error ?? "Failed to save title", false);
        }
      }
    } finally {
      setSaving(false);
    }
  };

  const filtered = useMemo(
    () => titles.filter((t) => activeFilter === "All" ? true : t.difficulty === filterKey(activeFilter)),
    [titles, activeFilter],
  );
  const owned  = useMemo(() => filtered.filter((t) => t.owned),  [filtered]);
  const locked = useMemo(() => filtered.filter((t) => !t.owned), [filtered]);
  const isDirty = selectedCode !== originalCode;
  const headerHeight = safeTop + 58;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={[st.container, { backgroundColor: colors.background, paddingBottom: safeBottom }]}>

        {/* Header */}
        <View style={[st.header, { borderBottomColor: colors.border, paddingTop: safeTop + 8 }]}>
          <TouchableOpacity
            style={[st.headerBtn, { borderColor: colors.border }]}
            onPress={onClose}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Feather name="arrow-left" size={18} color="#00E676" />
          </TouchableOpacity>
          <Text style={[st.headerTitle, { color: colors.foreground }]}>My Titles</Text>
          <TouchableOpacity
            style={[st.saveBtn, {
              backgroundColor: isDirty ? "#00E676" : "#00E67630",
              borderColor: "#00E67650",
            }]}
            onPress={handleSave}
            disabled={saving || !isDirty}
          >
            {saving ? (
              <ActivityIndicator size="small" color="#000" />
            ) : (
              <>
                <Feather name="save" size={14} color={isDirty ? "#000" : "#00E676"} />
                <Text style={[st.saveBtnText, { color: isDirty ? "#000" : "#00E676" }]}>Save</Text>
              </>
            )}
          </TouchableOpacity>
        </View>

        {/* Info strip */}
        <View style={[st.infoStrip, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Feather name="award" size={18} color="#FFD700" />
          <Text style={[st.infoText, { color: colors.foreground }]}>
            Owned Titles:{" "}
            <Text style={{ color: "#00E676", fontWeight: "800" }}>{ownedCount}</Text>
          </Text>
          <View style={[st.stripDivider, { backgroundColor: colors.border }]} />
          <Text style={[st.infoHint, { color: colors.mutedForeground }]}>
            Choose 1 title to display on your profile.
          </Text>
        </View>

        {/* Filter chips */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={st.filterScroll}
          contentContainerStyle={st.filterRow}
        >
          {FILTERS.map((f) => {
            const isActive = f === activeFilter;
            const fc = filterColor(f);
            return (
              <TouchableOpacity
                key={f}
                onPress={() => setActiveFilter(f)}
                style={[st.filterChip, {
                  backgroundColor: isActive ? fc + "22" : colors.card,
                  borderColor:     isActive ? fc       : colors.border,
                }]}
              >
                <Text style={[st.filterChipText, { color: isActive ? fc : colors.mutedForeground }]}>
                  {f}
                </Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        {/* Body */}
        {loading ? (
          <View style={[st.bodyFill, st.list, { paddingTop: 8 }]}>
            <SkeletonList count={8} variant="title" />
          </View>
        ) : error ? (
          <TouchableOpacity style={[st.bodyFill, st.center]} onPress={load}>
            <Feather name="alert-circle" size={32} color={colors.destructive} />
            <Text style={[st.errorText, { color: colors.destructive }]}>{error}</Text>
            <Text style={[st.retryText, { color: colors.success }]}>Tap to retry</Text>
          </TouchableOpacity>
        ) : (
          <ScrollView
            style={st.bodyFill}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={[st.list, { paddingBottom: Math.max(safeBottom, 24) + 16 }]}
          >

            {/* ── Owned section ─────────────────────────────────────────── */}
            {owned.length > 0 && (
              <>
                <View style={st.sectionHeader}>
                  <View style={[st.sectionBar, { backgroundColor: "#00E676" }]} />
                  <Text style={[st.sectionTitle, { color: colors.foreground }]}>Owned Titles</Text>
                </View>
                {owned.map((entry) => (
                  <TitleRow
                    key={entry.code}
                    entry={entry}
                    selected={selectedCode === entry.code}
                    onSelect={handleSelect}
                    colors={colors}
                  />
                ))}
              </>
            )}

            {owned.length === 0 && (
              <View style={[st.emptyCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                {activeFilter === "All" ? (
                  <>
                    <Feather name="award" size={40} color={colors.mutedForeground} />
                    <Text style={[st.emptyTitle, { color: colors.foreground }]}>No titles yet</Text>
                    <Text style={[st.emptyDesc, { color: colors.mutedForeground }]}>
                      Complete achievements to earn titles you can display on your profile.
                    </Text>
                  </>
                ) : (
                  <>
                    <Feather name="lock" size={36} color={colors.mutedForeground} />
                    <Text style={[st.emptyTitle, { color: colors.foreground }]}>
                      No {activeFilter} titles owned
                    </Text>
                    <Text style={[st.emptyDesc, { color: colors.mutedForeground }]}>
                      Complete {activeFilter.toLowerCase()} achievements to earn these titles.
                    </Text>
                  </>
                )}
              </View>
            )}

            {/* ── Locked section ────────────────────────────────────────── */}
            {locked.length > 0 && (
              <>
                <TouchableOpacity
                  style={st.sectionHeader}
                  onPress={() => setLockedExpanded((v) => !v)}
                  activeOpacity={0.7}
                >
                  <Feather name="lock" size={13} color={colors.mutedForeground} />
                  <Text style={[st.sectionTitle, { color: colors.mutedForeground, marginLeft: 7 }]}>
                    Locked Titles
                  </Text>
                  <View style={st.flex1} />
                  <Feather
                    name={lockedExpanded ? "chevron-up" : "chevron-down"}
                    size={16}
                    color={colors.mutedForeground}
                  />
                </TouchableOpacity>
                {lockedExpanded && locked.map((entry) => (
                  <TitleRow
                    key={entry.code}
                    entry={entry}
                    selected={false}
                    onSelect={() => {}}
                    colors={colors}
                  />
                ))}
              </>
            )}

          </ScrollView>
        )}

        {/* Floating toast — overlays content, does not shift layout */}
        {toast && (
          <View style={st.toastOverlay} pointerEvents="box-none">
            <Animated.View style={[
              st.toast,
              {
                top: headerHeight,
                backgroundColor: isDark ? colors.card : "#FFFFFF",
                borderColor: toast.ok ? SUCCESS_TOAST_ORANGE : colors.destructive,
                shadowColor: isDark ? "#000" : "#0A0B14",
                shadowOpacity: isDark ? 0.5 : 0.16,
                shadowRadius: 12,
                shadowOffset: { width: 0, height: 4 },
                elevation: 12,
                opacity: toastAnim,
                transform: [{
                  translateY: toastAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [-10, 0],
                  }),
                }],
              },
            ]}>
              <View style={[
                st.toastIconWrap,
                { backgroundColor: (toast.ok ? SUCCESS_TOAST_ORANGE : colors.destructive) + (isDark ? "30" : "20") },
              ]}>
                <Feather
                  name={toast.ok ? "check-circle" : "alert-circle"}
                  size={16}
                  color={toast.ok ? SUCCESS_TOAST_ORANGE : colors.destructive}
                />
              </View>
              <Text style={[
                st.toastText,
                { color: toast.ok ? colors.foreground : colors.destructive },
              ]}>
                {toast.msg}
              </Text>
            </Animated.View>
          </View>
        )}
      </View>
    </Modal>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const st = StyleSheet.create({
  container: { flex: 1 },

  header:      { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth, gap: 12 },
  headerBtn:   { width: 36, height: 36, borderRadius: 18, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  headerTitle: { flex: 1, fontSize: 20, fontWeight: "800", textAlign: "center" },
  saveBtn:     { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10, borderWidth: 1 },
  saveBtnText: { fontSize: 14, fontWeight: "700" },

  infoStrip:   { flexDirection: "row", alignItems: "center", gap: 10, marginHorizontal: 16, marginTop: 12, padding: 12, borderRadius: 12, borderWidth: 1 },
  infoText:    { fontSize: 13, fontWeight: "600" },
  stripDivider:{ width: 1, height: 18 },
  infoHint:    { flex: 1, fontSize: 12, lineHeight: 16 },

  filterScroll: { flexShrink: 0, flexGrow: 0 },
  filterRow:    { paddingHorizontal: 16, paddingVertical: 10, gap: 8, alignItems: "center" },
  filterChip:   { height: 34, paddingHorizontal: 14, borderRadius: 17, borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
  filterChipText: { fontSize: 12, fontWeight: "600" },

  bodyFill:      { flex: 1, minHeight: 0 },
  list:          { paddingHorizontal: 12, paddingVertical: 8, gap: 6 },

  sectionHeader: { flexDirection: "row", alignItems: "center", paddingHorizontal: 4, paddingVertical: 10 },
  sectionBar:    { width: 3, height: 16, borderRadius: 2, marginRight: 8 },
  sectionTitle:  { fontSize: 13, fontWeight: "700" },
  flex1:         { flex: 1 },

  // Row
  row:         {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 14,
    borderWidth: 1,
    padding: 12,
    gap: 10,
  },
  rowSelected: {
    borderColor: "#00E676",
    shadowColor: "#00E676",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.35,
    shadowRadius: 10,
    elevation: 5,
  },

  // Row sections
  info: { flex: 1, gap: 3, minWidth: 0 },
  titleText: { fontSize: 13, fontWeight: "700" },
  descText:  { fontSize: 11, lineHeight: 15 },
  progressWrap: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 2 },
  progressTrack: { flex: 1, height: 4, borderRadius: 2, overflow: "hidden" },
  progressFill:  { height: "100%", borderRadius: 2 },
  progressPct:   { fontSize: 10, fontWeight: "700", width: 30, textAlign: "right" },

  midCol:     { width: 88, alignItems: "flex-end", gap: 6 },
  unlockedRow:{ flexDirection: "row", alignItems: "center", gap: 3 },
  unlockedText:{ fontSize: 11, fontWeight: "700", color: "#00E676" },
  goalText:   { fontSize: 11, lineHeight: 15, textAlign: "right" },
  diffBadge:  { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20, borderWidth: 1 },
  diffText:   { fontSize: 10, fontWeight: "700" },

  selectorCol: { width: 26, alignItems: "center" },
  radioCircle: { width: 22, height: 22, borderRadius: 11, borderWidth: 2 },
  checkCircle: { width: 22, height: 22, borderRadius: 11, backgroundColor: "#00E676", alignItems: "center", justifyContent: "center" },
  lockCircle:  { width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, alignItems: "center", justifyContent: "center" },

  center:      { flex: 1, alignItems: "center", justifyContent: "center", gap: 12, padding: 32 },
  loadingText: { fontSize: 14, marginTop: 8 },
  errorText:   { fontSize: 14, textAlign: "center" },
  retryText:   { fontSize: 13, fontWeight: "600" },

  emptyCard:  { borderRadius: 16, borderWidth: 1, padding: 28, alignItems: "center", gap: 10, marginTop: 8 },
  emptyTitle: { fontSize: 16, fontWeight: "700" },
  emptyDesc:  { fontSize: 13, textAlign: "center", lineHeight: 18 },

  toastOverlay: { ...StyleSheet.absoluteFillObject, zIndex: 200, elevation: 20 },
  toast:        { position: "absolute", left: 16, right: 16, flexDirection: "row", alignItems: "center", gap: 10, padding: 14, borderRadius: 12, borderWidth: 1.5 },
  toastIconWrap: { width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  toastText: { flex: 1, fontSize: 14, fontWeight: "700" },
});
