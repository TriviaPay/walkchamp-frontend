import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFocusEffect, useLocalSearchParams } from "expo-router";
import { useAvatarVersionContext } from "@/context/AvatarVersionContext";
import { SkeletonList, SkeletonInlineEditForm } from "@/components/SkeletonRows";
import { screenCache } from "@/utils/screenCache";
import { apiFetchAllowed, markApiFetched } from "@/utils/apiRequestCoordinator";
import { perf } from "@/utils/perfLogger";
import { useScreenMountPerf } from "@/hooks/useScreenMountPerf";
import { getApiBase } from "@/utils/apiUrl";
import { prefetchProfileAvatars } from "@/services/mediaApi";
import {
  Animated,
  ActivityIndicator,
  AppState,
  FlatList,
  Image,
  Keyboard,
  Modal,
  PanResponder,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableWithoutFeedback,
  useColorScheme,
  KeyboardAvoidingView,
  View} from "react-native";
import { AppAlert } from "@/components/AppAlert";
import { CachedAvatarImage } from "@/components/CachedAvatarImage";
import { useSafeLayout, getSafeTop, getSafeBottom } from "@/hooks/useSafeLayout";
import type { EdgeInsets } from "react-native-safe-area-context";
import { Feather } from "@expo/vector-icons";
import * as Haptics from "@/utils/haptics";
import { useColors } from "@/hooks/useColors";
import { useTabBarHeight } from "@/hooks/useTabBarHeight";
import { useAuth } from "@/context/AuthContext";
import { usePresence } from "@/context/PresenceContext";
import { useUnread } from "@/context/UnreadContext";
import { authFetch } from "@/utils/authFetch";
import { connectPusher, subscribeToChannel, CHANNELS, EVENTS } from "@/services/realtimeService";
import { TouchableOpacity } from '@/components/HapticTouchableOpacity';
import { rf, rs } from "@/utils/responsive";
import BannerAdView from "@/components/BannerAdView";

const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? "";

function formatRelativeTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60000) return "now";
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h`;
  return `${Math.floor(diff / 86400000)}d`;
}

type ChatTab = "global" | "private" | "friends";

function normalizeChatTab(raw?: string): ChatTab | null {
  if (!raw) return null;
  if (raw === "global" || raw === "private" || raw === "friends") return raw;
  if (raw === "requests") return "friends";
  return null;
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface ReplyPreview {
  username: string;
  text: string; }

interface GlobalMessage {
  id: string;
  userId: string;
  username: string;
  flag: string;
  countryFlag?: string;
  avatarColor: string;
  avatarUrl?: string | null;
  avatarVersion?: number | null;
  text: string;
  time: string;
  createdAt?: string;
  isMe?: boolean;
  replyToId?: string | null;
  replyPreview?: ReplyPreview | null;
  reactions?: Record<string, number>; }

interface Conversation {
  conversationId: string;
  friendId: string;
  friendUsername: string;
  friendFlag: string;
  friendAvatarColor: string;
  friendAvatarUrl?: string | null;
  friendAvatarVersion?: number | null;
  lastMessage?: string | null;
  lastMessageAt?: string | null;
  unreadCount: number;
  isOnline?: boolean; }

interface PrivateMessage {
  id: string;
  senderId: string;
  text: string;
  time: string;
  createdAt?: string;
  isMe: boolean;
  replyToId?: string | null;
  replyPreview?: ReplyPreview | null;
  reactions?: Record<string, number>; }

interface FriendItem {
  id: string;
  username: string;
  flag: string;
  avatarColor: string;
  avatarUrl?: string | null;
  avatarVersion?: number | null;
  isOnline?: boolean; }

interface FriendRequest {
  id: string;
  type: "received" | "sent";
  userId: string;
  username: string;
  flag: string;
  avatarColor: string;
  avatarUrl?: string | null;
  avatarVersion?: number | null; }

interface SearchUser {
  id: string;
  username: string;
  fullName?: string | null;
  flag: string;
  avatarColor: string;
  avatarUrl?: string | null;
  avatarVersion?: number;
  friendStatus: "friends" | "pending_sent" | "pending_received" | "none";
  requestId?: string | null; }

// ── Helpers ───────────────────────────────────────────────────────────────────

function dedupeRequestsByUser(items: FriendRequest[]): FriendRequest[] {
  const seen = new Set<string>();
  return items.filter((r) => {
    if (seen.has(r.userId)) return false;
    seen.add(r.userId);
    return true;
  });
}

function getTime() {
  return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); }

function formatLocalTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); }

// ── Avatar ────────────────────────────────────────────────────────────────────

function Avatar({ color, letter, size = 36 }: { color: string; letter: string; size?: number }) {
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color + "25", borderWidth: 1.5, borderColor: color, alignItems: "center", justifyContent: "center" }}>
      <Text style={{ fontSize: size * 0.42, fontWeight: "800", color }}>{(letter ?? "?").toUpperCase()}</Text>
    </View>
  ); }

// ── ReplyBar ─────────────────────────────────────────────────────────────────

function ReplyBar({ reply, onCancel, colors }: { reply: { username: string; text: string }; onCancel: () => void; colors: ReturnType<typeof useColors> }) {
  return (
    <View style={[rbStyles.bar, { backgroundColor: colors.card, borderTopColor: colors.primary + "60", borderLeftColor: colors.primary }]}>
      <View style={rbStyles.inner}>
        <Feather name="corner-up-right" size={14} color={colors.primary} />
        <View style={{ flex: 1 }}>
          <Text style={[rbStyles.username, { color: colors.primary }]}>@{reply.username}</Text>
          <Text style={[rbStyles.preview, { color: colors.mutedForeground }]} numberOfLines={1}>{reply.text}</Text>
        </View>
      </View>
      <TouchableOpacity onPress={onCancel} hitSlop={10}>
        <Feather name="x" size={17} color={colors.mutedForeground} />
      </TouchableOpacity>
    </View>
  ); }

const rbStyles = StyleSheet.create({
  bar: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: rs(14), paddingVertical: rs(8), borderTopWidth: 1, borderLeftWidth: 3 },
  inner: { flex: 1, flexDirection: "row", alignItems: "center", gap: 8 },
  username: { fontSize: rf(12), fontWeight: "700" },
  preview: { fontSize: rf(12) }, });

// ── ReactionRow ───────────────────────────────────────────────────────────────

function ReactionRow({ reactions, colors }: { reactions: Record<string, number>; colors: ReturnType<typeof useColors> }) {
  const entries = Object.entries(reactions).filter(([, c]) => c > 0);
  if (!entries.length) return null;
  return (
    <View style={rrStyles.row}>
      {entries.map(([emoji, count]) => (
        <View key={emoji} style={[rrStyles.pill, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={rrStyles.emoji}>{emoji}</Text>
          <Text style={[rrStyles.count, { color: colors.mutedForeground }]}>{count}</Text>
        </View>
      ))}
    </View>
  ); }

const rrStyles = StyleSheet.create({
  row: { flexDirection: "row", flexWrap: "wrap", gap: 4, marginTop: 4 },
  pill: { flexDirection: "row", alignItems: "center", gap: 3, borderRadius: 10, borderWidth: 1, paddingHorizontal: 7, paddingVertical: 2 },
  emoji: { fontSize: rf(13) },
  count: { fontSize: rf(11), fontWeight: "600" }, });

// ── ReplyPreviewBlock (inside message bubble) ─────────────────────────────────

function ReplyBlock({ preview, isMe, colors }: { preview: ReplyPreview; isMe: boolean; colors: ReturnType<typeof useColors> }) {
  return (
    <View style={[rpStyles.block, { backgroundColor: isMe ? "rgba(255,255,255,0.15)" : colors.border + "60", borderLeftColor: isMe ? "rgba(255,255,255,0.6)" : colors.primary }]}>
      <Text style={[rpStyles.username, { color: isMe ? "rgba(255,255,255,0.85)" : colors.primary }]}>@{preview.username}</Text>
      <Text style={[rpStyles.text, { color: isMe ? "rgba(255,255,255,0.7)" : colors.mutedForeground }]} numberOfLines={1}>{preview.text}</Text>
    </View>
  ); }

const rpStyles = StyleSheet.create({
  block: { borderRadius: 8, borderLeftWidth: 2.5, paddingHorizontal: 8, paddingVertical: 5, marginBottom: 6 },
  username: { fontSize: rf(11), fontWeight: "700" },
  text: { fontSize: rf(11), marginTop: 1 }, });

// ── Long-press action modal ────────────────────────────────────────────────────

const QUICK_REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "🙏", "😁"];

function InlineActionPanel({ isMe, onReact, onReply, onReport, colors }: {
  isMe: boolean;
  onReact: (emoji: string) => void;
  onReply: () => void;
  onReport?: () => void;
  colors: ReturnType<typeof useColors>;
}) {
  return (
    <View style={[iapStyles.wrap, isMe ? iapStyles.wrapMe : iapStyles.wrapThem]}>
      <View style={[iapStyles.pill, { backgroundColor: colors.card, borderColor: colors.border }]}>
        {QUICK_REACTIONS.map((e) => (
          <TouchableOpacity key={e} style={iapStyles.pillBtn} onPress={() => onReact(e)}>
            <Text style={iapStyles.pillEmoji}>{e}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <View style={[iapStyles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <TouchableOpacity style={iapStyles.cardRow} onPress={onReply}>
          <Feather name="corner-up-left" size={15} color={colors.foreground} />
          <Text style={[iapStyles.cardText, { color: colors.foreground }]}>Reply</Text>
        </TouchableOpacity>
        {!isMe && onReport && (
          <>
            <View style={[iapStyles.cardSep, { backgroundColor: colors.border }]} />
            <TouchableOpacity style={iapStyles.cardRow} onPress={onReport}>
              <Feather name="flag" size={15} color="#FF3B30" />
              <Text style={[iapStyles.cardText, { color: "#FF3B30" }]}>Report</Text>
            </TouchableOpacity>
          </>
        )}
      </View>
    </View>
  );
}

const iapStyles = StyleSheet.create({
  wrap: { gap: 6, marginBottom: 4 },
  wrapMe: { alignItems: "flex-end" },
  wrapThem: { alignItems: "flex-start" },
  pill: {
    flexDirection: "row", borderRadius: 30, borderWidth: 1,
    paddingHorizontal: 6, paddingVertical: 5,
    shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.14, shadowRadius: 6, elevation: 4,
  },
  pillBtn: { paddingHorizontal: 4, paddingVertical: 2 },
  pillEmoji: { fontSize: rf(22) },
  card: {
    borderRadius: 12, borderWidth: 1, overflow: "hidden", minWidth: 130,
    shadowColor: "#000", shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.14, shadowRadius: 6, elevation: 4,
  },
  cardRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: rs(16), paddingVertical: rs(12) },
  cardText: { fontSize: rf(14), fontWeight: "500" },
  cardSep: { height: StyleSheet.hairlineWidth, marginLeft: 42 },
});

// ── Report reason options ──────────────────────────────────────────────────────
const REPORT_REASONS = [
  { key: "spam", label: "Spam" },
  { key: "harassment", label: "Harassment or abuse" },
  { key: "inappropriate", label: "Inappropriate content" },
  { key: "hate_or_threat", label: "Hate or threatening content" },
  { key: "other", label: "Other" },
] as const;

// ── Report modal ──────────────────────────────────────────────────────────────
function ReportModal({ msg, chatType, reportedUserId, visible, onClose, colors }: {
  msg: { id: string; text: string; username: string } | null;
  chatType: "global" | "private";
  reportedUserId?: string;
  visible: boolean;
  onClose: () => void;
  colors: ReturnType<typeof useColors>;
}) {
  const [selectedReason, setSelectedReason] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const reset = () => { setSelectedReason(null); setNote(""); setSubmitting(false); };
  const handleClose = () => { reset(); onClose(); };

  const handleSubmit = async () => {
    if (!selectedReason || !msg) return;
    setSubmitting(true);
    try {
      await authFetch(`/api/chat/messages/${msg.id}/report`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: selectedReason, note: note.trim() || undefined, chatType, reportedUserId, messageSnapshot: msg.text }),
      });
      reset();
      onClose();
      AppAlert.alert("Reported", "Message reported.");
    } catch {
      reset();
      onClose();
      AppAlert.alert("Error", "Could not submit report. Please try again.");
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={handleClose}>
      <TouchableOpacity style={rmStyles.backdrop} activeOpacity={1} onPress={handleClose}>
        <TouchableOpacity activeOpacity={1} style={[rmStyles.panel, { backgroundColor: colors.card }]} onPress={() => {}}>
          <Text style={[rmStyles.title, { color: colors.foreground }]}>Report Message</Text>
          {msg && (
            <View style={[rmStyles.preview, { backgroundColor: colors.background, borderColor: colors.border }]}>
              <Text style={[rmStyles.previewText, { color: colors.mutedForeground }]} numberOfLines={2}>"{msg.text}"</Text>
            </View>
          )}
          {REPORT_REASONS.map((r) => (
            <TouchableOpacity key={r.key} style={rmStyles.reasonRow} onPress={() => setSelectedReason(r.key)}>
              <View style={[rmStyles.radio, { borderColor: selectedReason === r.key ? colors.primary : colors.border }]}>
                {selectedReason === r.key && <View style={[rmStyles.radioFill, { backgroundColor: colors.primary }]} />}
              </View>
              <Text style={[rmStyles.reasonText, { color: colors.foreground }]}>{r.label}</Text>
            </TouchableOpacity>
          ))}
          <TextInput
            style={[rmStyles.noteInput, { backgroundColor: colors.background, borderColor: colors.border, color: colors.foreground }]}
            placeholder="Add details (optional)"
            placeholderTextColor={colors.mutedForeground}
            value={note}
            onChangeText={setNote}
            multiline
            maxLength={300}
          />
          <View style={rmStyles.btnRow}>
            <TouchableOpacity style={[rmStyles.btn, { backgroundColor: colors.border }]} onPress={handleClose}>
              <Text style={[rmStyles.btnText, { color: colors.foreground }]}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[rmStyles.btn, { backgroundColor: selectedReason && !submitting ? "#FF3B30" : colors.border }]}
              onPress={handleSubmit}
              disabled={!selectedReason || submitting}
            >
              <Text style={[rmStyles.btnText, { color: selectedReason && !submitting ? "#fff" : colors.mutedForeground }]}>
                {submitting ? "Sending…" : "Report"}
              </Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

const rmStyles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "flex-end" },
  panel: { borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: rs(24), paddingBottom: 40, gap: 14 },
  title: { fontSize: rf(18), fontWeight: "700", marginBottom: 2 },
  preview: { borderRadius: 10, borderWidth: 1, paddingHorizontal: rs(12), paddingVertical: rs(8) },
  previewText: { fontSize: rf(13), fontStyle: "italic" },
  reasonRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 6 },
  radio: { width: rs(20), height: rs(20), borderRadius: rs(10), borderWidth: 2, alignItems: "center", justifyContent: "center" },
  radioFill: { width: rs(10), height: rs(10), borderRadius: rs(5) },
  reasonText: { fontSize: rf(15) },
  noteInput: { borderWidth: 1, borderRadius: 10, paddingHorizontal: rs(12), paddingVertical: rs(8), minHeight: rs(60), fontSize: rf(14), textAlignVertical: "top" },
  btnRow: { flexDirection: "row", gap: 10, marginTop: 4 },
  btn: { flex: 1, borderRadius: 12, paddingVertical: rs(13), alignItems: "center" },
  btnText: { fontSize: rf(15), fontWeight: "700" },
});

// ── Swipeable message wrapper ─────────────────────────────────────────────────

function SwipeableMessage({ children, onSwipeReply }: { children: React.ReactNode; onSwipeReply: () => void }) {
  const pan = useRef(new Animated.Value(0)).current;
  const triggered = useRef(false);
  const onReplyRef = useRef(onSwipeReply);
  useEffect(() => { onReplyRef.current = onSwipeReply; }, [onSwipeReply]);

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) =>
        Math.abs(g.dx) > 8 && Math.abs(g.dx) > Math.abs(g.dy) * 1.4,
      onPanResponderGrant: () => { triggered.current = false; },
      onPanResponderMove: (_, g) => {
        const clamped = Math.max(-72, Math.min(72, g.dx));
        pan.setValue(clamped);
        if (Math.abs(clamped) > 52 && !triggered.current) {
          triggered.current = true;
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
          onReplyRef.current(); } },
      onPanResponderRelease: () => {
        Animated.spring(pan, { toValue: 0, useNativeDriver: true, tension: 140, friction: 12 }).start(); },
      onPanResponderTerminate: () => {
        pan.setValue(0); }, }),
  ).current;

  return (
    <Animated.View {...panResponder.panHandlers} style={{ transform: [{ translateX: pan }] }}>
      {children}
    </Animated.View>
  ); }

// ── Emoji panel ───────────────────────────────────────────────────────────────

const EMOJI_CATEGORIES = [
  { icon: "🏃", emojis: ["🚶","🏃","👟","👣","💪","🎯","🏅","🥇","🏆","⭐","🔥","⚡","💨","🌟","🎽"] },
  { icon: "😀", emojis: ["😀","😂","🥹","😍","🥰","😎","🤩","😅","🤔","🙃","😤","😏","🤯","😴","🥳"] },
  { icon: "❤️", emojis: ["❤️","🧡","💛","💚","💙","💜","🖤","🤍","💕","💯","✅","🎉","👏","🙌","🎊"] },
  { icon: "👍", emojis: ["👍","👎","👋","🤝","✌️","🤞","🙏","👆","👇","🫶","🤙","✋","🫵","👊","💃"] },
] as const;

function EmojiPanel({ onSelect, onDelete, colors }: { onSelect: (e: string) => void; onDelete: () => void; colors: ReturnType<typeof useColors> }) {
  const [catIdx, setCatIdx] = useState(0);
  const current = EMOJI_CATEGORIES[catIdx];
  return (
    <View style={[epStyles.panel, { backgroundColor: colors.card, borderTopColor: colors.border }]}>
      <View style={[epStyles.catRow, { borderBottomColor: colors.border }]}>
        {EMOJI_CATEGORIES.map((c, i) => (
          <TouchableOpacity key={i} style={[epStyles.catBtn, i === catIdx && { borderBottomWidth: 2.5, borderBottomColor: colors.primary }]} onPress={() => setCatIdx(i)}>
            <Text style={epStyles.catIcon}>{c.icon}</Text>
          </TouchableOpacity>
        ))}
        <TouchableOpacity style={epStyles.catBtn} onPress={onDelete}>
          <Feather name="delete" size={17} color={colors.mutedForeground} />
        </TouchableOpacity>
      </View>
      <View style={epStyles.grid}>
        {current.emojis.map((e) => (
          <TouchableOpacity key={e} style={epStyles.emojiBtn} onPress={() => onSelect(e)}>
            <Text style={epStyles.emojiText}>{e}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  ); }

const epStyles = StyleSheet.create({
  panel: { borderTopWidth: 1 },
  catRow: { flexDirection: "row", borderBottomWidth: StyleSheet.hairlineWidth, paddingHorizontal: 4 },
  catBtn: { flex: 1, alignItems: "center", paddingVertical: rs(10) },
  catIcon: { fontSize: rf(20) },
  grid: { flexDirection: "row", flexWrap: "wrap", paddingHorizontal: 6, paddingTop: 6, paddingBottom: 8 },
  emojiBtn: { width: "13.3%", alignItems: "center", paddingVertical: rs(7) },
  emojiText: { fontSize: rf(24) }, });

// ── User Profile Modal ────────────────────────────────────────────────────────

function UserProfileModal({ user, visible, onClose, colors }: {
  user: { userId: string; username: string; flag: string; avatarColor: string } | null;
  visible: boolean;
  onClose: () => void;
  colors: ReturnType<typeof useColors>; }) {
  const [friendState, setFriendState] = useState<"none" | "sending" | "sent" | "friends">("none");
  const [blocking, setBlocking] = useState(false);

  useEffect(() => { if (visible) setFriendState("none"); }, [visible]);

  if (!user) return null;

  const sendFriendRequest = async () => {
    setFriendState("sending");
    try {
      const res = await authFetch("/api/friends/request", { method: "POST", body: JSON.stringify({ targetUserId: user.userId }) });
      if (res.ok || res.status === 409) setFriendState("sent");
      else setFriendState("none"); } catch { setFriendState("none"); } };

  const blockUser = async () => {
    AppAlert.alert("Block", `Block @${user.username}?`, [
      { text: "Cancel" },
      { text: "Block", style: "destructive", onPress: async () => {
        setBlocking(true);
        try { await authFetch(`/api/users/${user.userId}/block`, { method: "POST" }); } catch {}
        setBlocking(false);
        onClose(); }},
    ]); };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" transparent={false}>
      <View style={[pStyles.profileModal, { backgroundColor: colors.background }]}>
        <View style={[pStyles.profileHeader, { borderBottomColor: colors.border }]}>
          <Text style={[pStyles.profileTitle, { color: colors.foreground }]}>Profile</Text>
          <TouchableOpacity onPress={onClose}><Feather name="x" size={22} color={colors.foreground} /></TouchableOpacity>
        </View>
        <ScrollView contentContainerStyle={pStyles.profileBody}>
          <View style={pStyles.profileCenter}>
            <Avatar color={user.avatarColor} letter={user.username[0]} size={72} />
            <Text style={[pStyles.profileUsername, { color: colors.foreground }]}>@{user.username}</Text>
            <Text style={pStyles.profileFlag}>{user.flag}</Text>
          </View>
          <View style={pStyles.profileActions}>
            <TouchableOpacity
              style={[pStyles.profileActionBtn, {
                backgroundColor: friendState === "sent" ? colors.warning + "15" : friendState === "friends" ? colors.primary + "15" : colors.primary,
                borderColor: friendState === "sent" ? colors.warning : friendState === "friends" ? colors.primary : colors.primary,
                borderWidth: 1, opacity: friendState === "sending" ? 0.6 : 1, }]}
              onPress={friendState === "none" ? sendFriendRequest : undefined}
              disabled={friendState !== "none"}
            >
              <Feather name={friendState === "friends" ? "user-check" : "user-plus"} size={16} color={friendState === "none" ? colors.primaryForeground : friendState === "sent" ? colors.warning : colors.primary} />
              <Text style={[pStyles.profileActionText, { color: friendState === "none" ? colors.primaryForeground : friendState === "sent" ? colors.warning : colors.primary }]}>
                {friendState === "none" ? "Add Friend" : friendState === "sending" ? "Sending…" : friendState === "sent" ? "Request Sent" : "Friends"}
              </Text>
            </TouchableOpacity>
          </View>
          <View style={pStyles.profileDangerRow}>
            <TouchableOpacity style={[pStyles.dangerBtn, { backgroundColor: colors.destructive + "15", borderColor: colors.destructive + "30", borderWidth: 1, opacity: blocking ? 0.6 : 1 }]} onPress={blockUser} disabled={blocking}>
              <Feather name="slash" size={14} color={colors.destructive} />
              <Text style={[pStyles.dangerBtnText, { color: colors.destructive }]}>Block</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[pStyles.dangerBtn, { backgroundColor: colors.warning + "15", borderColor: colors.warning + "30", borderWidth: 1 }]} onPress={() => AppAlert.alert("Report", `Report @${user.username}?`, [{ text: "Cancel" }, { text: "Report", onPress: onClose }])}>
              <Feather name="flag" size={14} color={colors.warning} />
              <Text style={[pStyles.dangerBtnText, { color: colors.warning }]}>Report</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </View>
    </Modal>
  ); }

// ── Global Chat Tab ────────────────────────────────────────────────────────────

function GlobalChatTab({ colors, insets, user, headerHeight }: {
  colors: ReturnType<typeof useColors>;
  insets: EdgeInsets;
  user: ReturnType<typeof useAuth>["user"];
  headerHeight: number; }) {
  const { getAvatarVersion } = useAvatarVersionContext();
  const { counts, formatCount } = usePresence();
  const [onlineUserIds, setOnlineUserIds] = useState<Set<string>>(new Set());
  const [messages, setMessages] = useState<GlobalMessage[]>(
    () => screenCache.getSync<GlobalMessage[]>("screen_globalchat") ?? []
  );
  const [loading, setLoading] = useState(
    () => screenCache.getSync("screen_globalchat") === null
  );
  const [sending, setSending] = useState(false);
  const [input, setInput] = useState("");
  const [inputH, setInputH] = useState(44);
  const [profileTarget, setProfileTarget] = useState<{ userId: string; username: string; flag: string; avatarColor: string } | null>(null);
  const [replyingTo, setReplyingTo] = useState<{ id: string; username: string; text: string } | null>(null);
  const [selectedMsgId, setSelectedMsgId] = useState<string | null>(null);
  const [reportingMsg, setReportingMsg] = useState<{ id: string; username: string; text: string; userId: string } | null>(null);
  const listRef = useRef<FlatList>(null);

  const loadMessages = useCallback(async () => {
    // Warm from disk cache on first launch (mem may be cold after app kill)
    if (messages.length === 0) {
      const diskCached = await screenCache.get<GlobalMessage[]>("screen_globalchat");
      if (diskCached && diskCached.length > 0) {
        setMessages(diskCached);
        setLoading(false);
      }
    }
    try {
      const res = await authFetch("/api/chat/global?limit=50");
      if (res.ok) {
        const data = await res.json();
        const myId = user?.id ?? "";
        const fresh = (data.messages ?? []).map((m: GlobalMessage) => ({
          ...m,
          flag: m.flag ?? m.countryFlag ?? "🌍",
          time: m.createdAt ? formatLocalTime(m.createdAt) : m.time,
          isMe: m.userId === myId,
        }));
        setMessages(fresh);
        void screenCache.set("screen_globalchat", fresh);
      }
    } catch {}
    setLoading(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  useEffect(() => { loadMessages(); }, [loadMessages]);

  // Fetch online user IDs so we can show per-user presence dots in the chat
  const fetchOnlineIds = useCallback(async () => {
    try {
      const res = await authFetch("/api/presence/online-ids");
      if (res.ok) {
        const data = await res.json() as { userIds?: string[] };
        setOnlineUserIds(new Set(data.userIds ?? []));
      }
    } catch {}
  }, []);

  useEffect(() => { void fetchOnlineIds(); }, [fetchOnlineIds]);

  // Refresh online IDs when tab comes into focus or app returns to foreground
  useFocusEffect(useCallback(() => { void fetchOnlineIds(); }, [fetchOnlineIds]));

  // Refetch when app comes back to foreground — throttled to avoid duplicate storms.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        if (apiFetchAllowed("chat_global_resume", 15_000)) {
          markApiFetched("chat_global_resume");
          perf.backgroundRefresh("chat_global");
          void loadMessages();
          void fetchOnlineIds();
        } else {
          perf.apiSkipped("chat_global_resume_throttled");
        }
      }
    });
    return () => sub.remove();
  }, [loadMessages, fetchOnlineIds]);

  useEffect(() => {
    connectPusher();
    const channel = subscribeToChannel(CHANNELS.GLOBAL_CHAT);
    if (!channel) return;

    const onNewMessage = (msg: GlobalMessage) => {
      setMessages((prev) => {
        if (prev.some((m) => m.id === msg.id)) return prev;
        const myId = user?.id ?? "";
        const enriched = { ...msg, time: msg.createdAt ? formatLocalTime(msg.createdAt) : msg.time, isMe: msg.userId === myId };
        // If this is my own message arriving via Pusher, replace the pending optimistic
        // (id starts with "opt-") in-place so we never show a duplicate.
        if (msg.userId === myId) {
          const optIdx = prev.findIndex((m) => m.id.startsWith("opt-"));
          if (optIdx !== -1) {
            const updated = [...prev];
            updated[optIdx] = enriched;
            return updated;
          }
        }
        return [...prev, enriched];
      });
      setTimeout(() => listRef.current?.scrollToOffset({ offset: 0, animated: true }), 50);
    };

    const onReactionsUpdated = ({ messageId, reactions }: { messageId: string; reactions: Record<string, number> }) => {
      // Suppress server update if we have an in-flight optimistic reaction for this message.
      if (pendingGlobalReactionsRef.current.has(messageId)) return;
      setMessages((prev) => prev.map((m) => m.id === messageId ? { ...m, reactions } : m)); };

    const onMessageDeleted = ({ messageId }: { messageId: string }) => {
      setMessages((prev) => prev.filter((m) => m.id !== messageId)); };

    channel.bind(EVENTS.CHAT_NEW_MESSAGE, onNewMessage);
    channel.bind("chat:reactions_updated", onReactionsUpdated);
    channel.bind("chat:message_deleted", onMessageDeleted);
    return () => {
      channel.unbind(EVENTS.CHAT_NEW_MESSAGE, onNewMessage);
      channel.unbind("chat:reactions_updated", onReactionsUpdated);
      channel.unbind("chat:message_deleted", onMessageDeleted); }; }, [user?.id]);

  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text || sending) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    const optimisticId = `opt-${Date.now()}`;
    const optimistic: GlobalMessage = {
      id: optimisticId,
      userId: user?.id ?? "me",
      username: user?.username ?? "you",
      flag: user?.countryFlag ?? "🌍",
      avatarColor: user?.avatarColor ?? "#00E676",
      text,
      time: getTime(),
      isMe: true,
      replyToId: replyingTo?.id ?? null,
      replyPreview: replyingTo ? { username: replyingTo.username, text: replyingTo.text } : null,
      reactions: {}, };
    setMessages((prev) => [...prev, optimistic]);
    setInput("");
    setInputH(44);
    setReplyingTo(null);
    setTimeout(() => listRef.current?.scrollToOffset({ offset: 0, animated: true }), 50);

    setSending(true);
    try {
      const res  = await authFetch("/api/chat/global", {
        method: "POST",
        body: JSON.stringify({ text, ...(optimistic.replyToId ? { replyToId: optimistic.replyToId } : {}) }),
      });
      const data = await res.json().catch(() => null) as { message?: { id: string } } | null;
      const realId = data?.message?.id;
      if (realId) {
        setMessages((prev) => {
          // Pusher may have already delivered the real message while we awaited the POST.
          // If so, just remove the optimistic to avoid a duplicate key.
          // If not, upgrade the optimistic ID in-place so Pusher's dedup will skip it.
          if (prev.some((m) => m.id === realId)) {
            return prev.filter((m) => m.id !== optimisticId);
          }
          return prev.map((m) => m.id === optimisticId ? { ...m, id: realId } : m);
        });
      } else {
        setMessages((prev) => prev.filter((m) => m.id !== optimisticId));
      }
    } catch {
      setMessages((prev) => prev.filter((m) => m.id !== optimisticId));
    }
    setSending(false); }, [input, sending, user, replyingTo]);

  // Tracks the emoji the current user has reacted with per message (session-scoped).
  // Used to detect a second tap on the same emoji → remove reaction.
  const myGlobalReactionsRef = useRef(new Map<string, string>());
  // Tracks messageIds with an in-flight reaction API call so Pusher updates don't overwrite optimistic state.
  const pendingGlobalReactionsRef = useRef(new Set<string>());

  const handleReact = (messageId: string, emoji: string) => {
    const current = myGlobalReactionsRef.current.get(messageId);
    const removing = current === emoji;

    // Optimistic update — instant UI before the API responds.
    setMessages((prev) =>
      prev.map((m) => {
        if (m.id !== messageId) return m;
        const next: Record<string, number> = { ...(m.reactions ?? {}) };
        if (current) {
          next[current] = (next[current] ?? 1) - 1;
          if (next[current] <= 0) delete next[current];
        }
        if (!removing) next[emoji] = (next[emoji] ?? 0) + 1;
        return { ...m, reactions: next };
      }),
    );

    // Mark as pending so Pusher doesn't clobber the optimistic state mid-flight.
    pendingGlobalReactionsRef.current.add(messageId);

    if (removing) {
      myGlobalReactionsRef.current.delete(messageId);
      authFetch("/api/chat/global/react", {
        method: "DELETE",
        body: JSON.stringify({ messageId }),
      }).finally(() => { pendingGlobalReactionsRef.current.delete(messageId); });
    } else {
      myGlobalReactionsRef.current.set(messageId, emoji);
      authFetch("/api/chat/global/react", {
        method: "POST",
        body: JSON.stringify({ messageId, emoji }),
      }).finally(() => { pendingGlobalReactionsRef.current.delete(messageId); });
    }
  };

  const inputHRef = useRef(inputH);
  useEffect(() => { inputHRef.current = inputH; }, [inputH]);

  const [globalKbVisible, setGlobalKbVisible] = useState(false);
  useEffect(() => {
    const showEv = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEv = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const show = Keyboard.addListener(showEv, () => setGlobalKbVisible(true));
    const hide = Keyboard.addListener(hideEv, () => setGlobalKbVisible(false));
    return () => { show.remove(); hide.remove(); };
  }, []);

  // Close reactions when keyboard opens (covers non-input keyboard triggers)
  useEffect(() => {
    const event = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const sub = Keyboard.addListener(event, () => {
      setSelectedMsgId(null);
    });
    return () => sub.remove();
  }, []);

  // Close reactions when user navigates away from the Chat screen entirely
  useFocusEffect(useCallback(() => {
    return () => {
      setSelectedMsgId(null);
    };
  }, []));

  return (
    <View style={{ flex: 1 }}>
      <UserProfileModal user={profileTarget} visible={!!profileTarget} onClose={() => setProfileTarget(null)} colors={colors} />
      <ReportModal
        msg={reportingMsg}
        chatType="global"
        reportedUserId={reportingMsg?.userId}
        visible={!!reportingMsg}
        onClose={() => setReportingMsg(null)}
        colors={colors}
      />

      <View style={[cStyles.onlineBar, { backgroundColor: colors.card, borderBottomColor: colors.border }]}>
        <View style={[cStyles.onlineDot, { backgroundColor: colors.primary }]} />
        <Text style={[cStyles.onlineText, { color: colors.mutedForeground }]}>{formatCount(counts.online)} online worldwide</Text>
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding" keyboardVerticalOffset={0}>
        {loading ? (
          <View style={{ flex: 1, paddingTop: 12 }}>
            <SkeletonList count={7} variant="chat" />
          </View>
        ) : (
          <FlatList
            ref={listRef}
            data={[...messages].reverse()}
            inverted
            extraData={selectedMsgId}
            keyExtractor={(item) => item.id}
            onScrollBeginDrag={() => { Keyboard.dismiss(); setSelectedMsgId(null); }}
            onMomentumScrollBegin={() => setSelectedMsgId(null)}
            keyboardDismissMode="on-drag"
            ListFooterComponent={<TouchableOpacity activeOpacity={1} style={{ minHeight: selectedMsgId !== null ? 120 : 20 }} onPress={() => { setSelectedMsgId(null); Keyboard.dismiss(); }} />}
            renderItem={({ item }) => {
              const isMe = !!item.isMe;
              const isSelected = item.id === selectedMsgId;
              return (
                <View>
                  {isSelected && (
                    <InlineActionPanel
                      isMe={isMe}
                      onReact={(emoji) => { void handleReact(item.id, emoji); setSelectedMsgId(null); }}
                      onReply={() => { setReplyingTo({ id: item.id, username: item.username, text: item.text }); setSelectedMsgId(null); }}
                      onReport={() => { const found = messages.find((m) => m.id === item.id); setReportingMsg({ id: item.id, text: item.text, username: item.username, userId: found?.userId ?? "" }); setSelectedMsgId(null); }}
                      colors={colors}
                    />
                  )}
                <SwipeableMessage onSwipeReply={() => setReplyingTo({ id: item.id, username: item.username, text: item.text })}>
                  <TouchableOpacity
                    activeOpacity={0.85}
                    onLongPress={() => {
                      setSelectedMsgId((prev) => (prev === item.id ? null : item.id));
                    }}
                    onPress={() => { Keyboard.dismiss(); if (selectedMsgId && selectedMsgId !== item.id) setSelectedMsgId(null); }}
                    delayLongPress={400}
                  >
                    <View style={[cStyles.msgRow, isMe ? cStyles.msgRowMe : cStyles.msgRowThem]}>
                      {/* Others: avatar on LEFT with online/offline dot */}
                      {!isMe && (
                        <TouchableOpacity onPress={() => setProfileTarget({ userId: item.userId, username: item.username, flag: item.flag, avatarColor: item.avatarColor })} style={{ alignSelf: "flex-end" }}>
                          <View style={{ position: "relative" }}>
                            {item.avatarUrl && item.userId ? (
                              <View style={{ width: 32, height: 32, borderRadius: 16, overflow: "hidden", borderWidth: 1.5, borderColor: item.avatarColor }}>
                                <CachedAvatarImage userId={item.userId} avatarVersion={getAvatarVersion(item.userId, item.avatarVersion ?? 0)} size={32} />
                              </View>
                            ) : (
                              <Avatar color={item.avatarColor} letter={item.username[0]} size={32} />
                            )}
                            <View style={{ position: "absolute", bottom: 0, right: 0, width: 10, height: 10, borderRadius: 5, backgroundColor: onlineUserIds.has(item.userId) ? "#00E676" : "#505060", borderWidth: 1.5, borderColor: colors.card }} />
                          </View>
                        </TouchableOpacity>
                      )}

                      <View style={{ maxWidth: "75%", alignItems: isMe ? "flex-end" : "flex-start" }}>
                        {!isMe && (
                          <View style={cStyles.msgMeta}>
                            <Text style={[cStyles.msgUsername, { color: item.avatarColor }]}>@{item.username}</Text>
                            <Text style={cStyles.msgFlag}>{item.flag}</Text>
                          </View>
                        )}
                        <View style={[cStyles.bubble, isMe
                          ? { backgroundColor: colors.primary, borderBottomRightRadius: 4 }
                          : { backgroundColor: colors.card, borderColor: colors.border, borderWidth: 1, borderBottomLeftRadius: 4 }
                        ]}>
                          {item.replyPreview && <ReplyBlock preview={item.replyPreview} isMe={isMe} colors={colors} />}
                          <Text style={[cStyles.bubbleText, { color: isMe ? colors.primaryForeground : colors.foreground }]}>{item.text}</Text>
                        </View>
                        {!isMe && item.reactions && <ReactionRow reactions={item.reactions} colors={colors} />}
                        <Text style={[cStyles.msgTime, { color: colors.mutedForeground }]}>{item.time}</Text>
                      </View>

                      {/* Me: avatar on RIGHT */}
                      {isMe && (
                        <View style={{ alignSelf: "flex-end" }}>
                          {user?.id && user?.profileImageUrl ? (
                            <View style={{ width: 32, height: 32, borderRadius: 16, overflow: "hidden", borderWidth: 1.5, borderColor: user?.avatarColor ?? "#00E676" }}>
                              <CachedAvatarImage userId={user.id} avatarVersion={user?.avatarVersion ?? 0} size={32} />
                            </View>
                          ) : (
                            <Avatar color={user?.avatarColor ?? "#00E676"} letter={(user?.username ?? "Y")[0]} size={32} />
                          )}
                        </View>
                      )}
                    </View>
                  </TouchableOpacity>
                </SwipeableMessage>
              </View>
              ); }}
            style={{ flex: 1 }}
            contentContainerStyle={[cStyles.msgList, { flexGrow: 1 }]}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          />
        )}

        {replyingTo && <ReplyBar reply={replyingTo} onCancel={() => setReplyingTo(null)} colors={colors} />}

        <View style={[cStyles.inputBar, { backgroundColor: colors.card, borderTopColor: colors.border, paddingBottom: globalKbVisible ? 12 : Math.max(12, getSafeBottom(insets.bottom)) }]}>
          <TextInput
            style={[cStyles.chatInput, { backgroundColor: colors.background, borderColor: colors.border, color: colors.foreground }]}
            placeholder="Message global chat..."
            placeholderTextColor={colors.mutedForeground}
            value={input}
            onChangeText={(t) => { setInput(t); }}
            onContentSizeChange={(e) => {
              const nextH = Math.min(140, Math.max(44, e.nativeEvent.contentSize.height));
              if (__DEV__) console.log("[ChatInput] global content height:", e.nativeEvent.contentSize.height, "applied:", nextH);
              setInputH(nextH);
            }}
            onSubmitEditing={sendMessage}
            onFocus={() => setSelectedMsgId(null)}
            returnKeyType="send"
            multiline
            textAlignVertical="top"
            scrollEnabled={inputH >= 140}
            blurOnSubmit={false}
            maxLength={280}
          />
          <TouchableOpacity style={[cStyles.sendBtn, { backgroundColor: input.trim() ? colors.primary : colors.border }]} onPress={sendMessage} disabled={!input.trim()}>
            <Feather name="send" size={16} color={input.trim() ? colors.primaryForeground : colors.mutedForeground} />
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </View>
  ); }

// ── Private Chat Tab ──────────────────────────────────────────────────────────

function PrivateChatTab({ colors, insets, user, headerHeight, pendingFriend = null, initialConversationId = null, onUnreadCountChange, unfriendedConv = null, onUnfriendHandled, onUnfriend }: {
  colors: ReturnType<typeof useColors>;
  insets: EdgeInsets;
  user: ReturnType<typeof useAuth>["user"];
  headerHeight: number;
  pendingFriend?: FriendItem | null;
  initialConversationId?: string | null;
  onUnreadCountChange?: (count: number) => void;
  unfriendedConv?: { friendId: string; conversationId: string | null } | null;
  onUnfriendHandled?: () => void;
  onUnfriend?: (friendId: string, conversationId: string | null) => void; }) {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === "dark";
  const DM_RECV_BG = isDark ? "#111827" : "#EEF2FF";
  const DM_RECV_TEXT = isDark ? "#B8C8F0" : "#2D3A8C";
  const DM_CHAT_BG = isDark ? "#070A14" : "#F6F9FF";
  const { getAvatarVersion } = useAvatarVersionContext();
  const [conversations, setConversations] = useState<Conversation[]>(
    () => screenCache.getSync<Conversation[]>("screen_conversations") ?? []
  );
  const [loadingConvs, setLoadingConvs] = useState(false);
  const [activeFriend, setActiveFriend] = useState<{ id: string; username: string; flag: string; avatarColor: string; avatarUrl?: string | null; avatarVersion?: number | null; conversationId: string; isOnline?: boolean } | null>(null);
  const [msgs, setMsgs] = useState<PrivateMessage[]>([]);
  const [loadingMsgs, setLoadingMsgs] = useState(false);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [inputH, setInputH] = useState(44);
  const [replyingTo, setReplyingTo] = useState<{ id: string; username: string; text: string } | null>(null);
  const [selectedMsgId, setSelectedMsgId] = useState<string | null>(null);
  const [reportingMsg, setReportingMsg] = useState<{ id: string; username: string; text: string; userId: string } | null>(null);
  const listRef = useRef<FlatList>(null);

  const loadConversations = useCallback(async () => {
    // Show disk-cached conversations on first launch (mem may be cold after kill)
    if (conversations.length === 0) {
      const diskCached = await screenCache.get<Conversation[]>("screen_conversations");
      if (diskCached && diskCached.length > 0) {
        setConversations(diskCached);
        setLoadingConvs(false);
      }
    }
    try {
      const res = await authFetch("/api/chat/private/conversations");
      if (res.ok) {
        const data = await res.json();
        const fresh: Conversation[] = data.conversations ?? [];
        setConversations(fresh);
        void screenCache.set("screen_conversations", fresh);
        prefetchProfileAvatars(
          fresh.map((c) => ({
            userId: c.friendId,
            avatarUrl: c.friendAvatarUrl,
            avatarVersion: c.friendAvatarVersion,
          })),
        );
      }
    } catch {}
    setLoadingConvs(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { loadConversations(); }, [loadConversations]);

  // Report total unread count to ChatScreen for tab badge
  useEffect(() => {
    if (!onUnreadCountChange) return;
    const total = conversations.reduce((sum, c) => sum + (c.unreadCount ?? 0), 0);
    onUnreadCountChange(total); }, [conversations, onUnreadCountChange]);

  // Auto-open conversation when navigating here from the Friends tab chat icon
  const pendingFriendId = pendingFriend?.id;
  useEffect(() => {
    if (!pendingFriend) return;
    let cancelled = false;
    setLoadingMsgs(true);
    setActiveFriend({ id: pendingFriend.id, username: pendingFriend.username, flag: pendingFriend.flag, avatarColor: pendingFriend.avatarColor, avatarUrl: pendingFriend.avatarUrl ?? null, avatarVersion: pendingFriend.avatarVersion ?? 0, conversationId: "", isOnline: pendingFriend.isOnline ?? false });
    (async () => {
      try {
        const res = await authFetch(`/api/chat/private/${pendingFriend.id}?limit=50`);
        if (!cancelled && res.ok) {
          const data = await res.json();
          const myId = user?.id ?? "";
          setActiveFriend({ id: pendingFriend.id, username: pendingFriend.username, flag: pendingFriend.flag, avatarColor: pendingFriend.avatarColor, avatarUrl: pendingFriend.avatarUrl ?? null, avatarVersion: pendingFriend.avatarVersion ?? 0, conversationId: data.conversationId, isOnline: pendingFriend.isOnline ?? false });
          setMsgs((data.messages ?? []).map((m: PrivateMessage & { senderId: string }) => ({
            ...m,
            time: m.createdAt ? formatLocalTime(m.createdAt) : m.time,
            isMe: m.senderId === myId, })));
          // Opening the chat marks messages as read — refresh conversation list to clear badge
          void loadConversations(); } } catch {}
      if (!cancelled) setLoadingMsgs(false); })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingFriendId]);

  const openChat = async (conv: Conversation) => {
    setActiveFriend({ id: conv.friendId, username: conv.friendUsername, flag: conv.friendFlag, avatarColor: conv.friendAvatarColor, avatarUrl: conv.friendAvatarUrl ?? null, avatarVersion: conv.friendAvatarVersion ?? 0, conversationId: conv.conversationId, isOnline: conv.isOnline ?? false });
    setLoadingMsgs(true);
    try {
      const res = await authFetch(`/api/chat/private/${conv.friendId}?limit=50`);
      if (res.ok) {
        const data = await res.json();
        const myId = user?.id ?? "";
        setMsgs((data.messages ?? []).map((m: PrivateMessage & { senderId: string }) => ({
          ...m,
          time: m.createdAt ? formatLocalTime(m.createdAt) : m.time,
          isMe: m.senderId === myId, })));
        // Refresh conversation list so the unread badge for this conversation resets to 0
        void loadConversations(); } } catch {}
    setLoadingMsgs(false); };

  // Open a specific conversation when arriving from a push notification deep link
  const initialConversationIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!initialConversationId || initialConversationIdRef.current === initialConversationId) return;
    const conv = conversations.find((c) => c.conversationId === initialConversationId);
    if (!conv) return;
    initialConversationIdRef.current = initialConversationId;
    void openChat(conv);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialConversationId, conversations]);

  // Pusher for private messages
  useEffect(() => {
    if (!activeFriend?.conversationId) return;
    connectPusher();
    const channelName = `private-chat-${activeFriend.conversationId}`;
    const channel = subscribeToChannel(channelName);
    if (!channel) return;

    const onMsg = (msg: PrivateMessage & { senderId: string }) => {
      setMsgs((prev) => {
        if (prev.some((m) => m.id === msg.id)) return prev;
        const myId = user?.id ?? "";
        const enriched = { ...msg, time: msg.createdAt ? formatLocalTime(msg.createdAt) : msg.time, isMe: msg.senderId === myId };
        // If this is my own message arriving via Pusher, replace the pending optimistic
        // (id starts with "opt-") in-place so we never show a duplicate.
        if (msg.senderId === myId) {
          const optIdx = prev.findIndex((m) => m.id.startsWith("opt-"));
          if (optIdx !== -1) {
            const updated = [...prev];
            updated[optIdx] = enriched;
            return updated;
          }
        }
        return [...prev, enriched];
      });
      setTimeout(() => listRef.current?.scrollToOffset({ offset: 0, animated: true }), 50);
    };

    const onReactionsUpdated = ({ messageId, reactions }: { messageId: string; reactions: Record<string, number> }) => {
      // Suppress server update if we have an in-flight optimistic reaction for this message.
      if (pendingDmReactionsRef.current.has(messageId)) return;
      setMsgs((prev) => prev.map((m) => m.id === messageId ? { ...m, reactions } : m)); };

    const onMsgDeleted = ({ messageId }: { messageId: string }) => {
      setMsgs((prev) => prev.filter((m) => m.id !== messageId)); };

    channel.bind(EVENTS.CHAT_NEW_MESSAGE, onMsg);
    channel.bind("chat:reactions_updated", onReactionsUpdated);
    channel.bind("chat:message_deleted", onMsgDeleted);
    return () => {
      channel.unbind(EVENTS.CHAT_NEW_MESSAGE, onMsg);
      channel.unbind("chat:reactions_updated", onReactionsUpdated);
      channel.unbind("chat:message_deleted", onMsgDeleted); }; }, [activeFriend?.conversationId, user?.id]);

  const sendMsg = useCallback(async () => {
    if (!input.trim() || !activeFriend || sending) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    const text = input.trim();
    const optimisticId = `opt-${Date.now()}`;
    const optimistic: PrivateMessage = {
      id: optimisticId,
      senderId: user?.id ?? "me",
      text,
      time: getTime(),
      isMe: true,
      replyToId: replyingTo?.id ?? null,
      replyPreview: replyingTo ? { username: replyingTo.username, text: replyingTo.text } : null,
      reactions: {}, };
    setMsgs((prev) => [...prev, optimistic]);
    setInput("");
    setInputH(44);
    setReplyingTo(null);
    setTimeout(() => listRef.current?.scrollToOffset({ offset: 0, animated: true }), 50);

    setSending(true);
    try {
      const res  = await authFetch(`/api/chat/private/${activeFriend.id}`, {
        method: "POST",
        body: JSON.stringify({ text, ...(optimistic.replyToId ? { replyToId: optimistic.replyToId } : {}) }),
      });
      const data = await res.json().catch(() => null) as { message?: { id: string } } | null;
      const realId = data?.message?.id;
      if (realId) {
        setMsgs((prev) => {
          // Pusher may have already delivered the real message while we awaited the POST.
          // If so, just remove the optimistic to avoid a duplicate key.
          // If not, upgrade the optimistic ID in-place so Pusher's dedup will skip it.
          if (prev.some((m) => m.id === realId)) {
            return prev.filter((m) => m.id !== optimisticId);
          }
          return prev.map((m) => m.id === optimisticId ? { ...m, id: realId } : m);
        });
      } else {
        setMsgs((prev) => prev.filter((m) => m.id !== optimisticId));
      }
    } catch {
      setMsgs((prev) => prev.filter((m) => m.id !== optimisticId));
    }
    setSending(false); }, [input, sending, activeFriend, user, replyingTo]);

  // Tracks the emoji the current user has reacted with per DM message (session-scoped).
  const myDmReactionsRef = useRef(new Map<string, string>());
  // Tracks messageIds with an in-flight reaction API call so Pusher updates don't overwrite optimistic state.
  const pendingDmReactionsRef = useRef(new Set<string>());

  const handleReact = (messageId: string, emoji: string) => {
    if (!activeFriend?.conversationId) return;
    const convId = activeFriend.conversationId;
    const current = myDmReactionsRef.current.get(messageId);
    const removing = current === emoji;

    // Optimistic update — instant UI before the API responds.
    setMsgs((prev) =>
      prev.map((m) => {
        if (m.id !== messageId) return m;
        const next: Record<string, number> = { ...(m.reactions ?? {}) };
        if (current) {
          next[current] = (next[current] ?? 1) - 1;
          if (next[current] <= 0) delete next[current];
        }
        if (!removing) next[emoji] = (next[emoji] ?? 0) + 1;
        return { ...m, reactions: next };
      }),
    );

    // Mark as pending so Pusher doesn't clobber the optimistic state mid-flight.
    pendingDmReactionsRef.current.add(messageId);

    if (removing) {
      myDmReactionsRef.current.delete(messageId);
      authFetch("/api/chat/private/react", {
        method: "DELETE",
        body: JSON.stringify({ messageId, conversationId: convId }),
      }).finally(() => { pendingDmReactionsRef.current.delete(messageId); });
    } else {
      myDmReactionsRef.current.set(messageId, emoji);
      authFetch("/api/chat/private/react", {
        method: "POST",
        body: JSON.stringify({ messageId, emoji, conversationId: convId }),
      }).finally(() => { pendingDmReactionsRef.current.delete(messageId); });
    }
  };

  useEffect(() => {
    if (!unfriendedConv) return;
    if (activeFriend?.id === unfriendedConv.friendId) {
      setActiveFriend(null);
      setMsgs([]);
      setReplyingTo(null);
      setSelectedMsgId(null);
    }
    setConversations((prev) => prev.filter((c) => c.friendId !== unfriendedConv.friendId));
    void loadConversations();
    onUnfriendHandled?.();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unfriendedConv]);

  const deleteConversation = (conv: Conversation) => {
    if (__DEV__) console.log("[PrivateChatDelete] delete requested", conv.conversationId);
    AppAlert.alert(
      "Delete Private Chat?",
      "Are you sure you want to delete this private chat? This will permanently remove the chat history from your private chat list.",
      [
        { text: "Cancel" },
        {
          text: "Delete Chat",
          style: "destructive",
          onPress: async () => {
            try {
              const res = await authFetch(`/api/chat/private/conversations/${conv.conversationId}`, { method: "DELETE" });
              if (res.ok) {
                if (__DEV__) console.log("[PrivateChatDelete] backend success", conv.conversationId);
                if (activeFriend?.conversationId === conv.conversationId) {
                  setActiveFriend(null); setMsgs([]); setReplyingTo(null); setSelectedMsgId(null);
                }
                setConversations((prev) => prev.filter((c) => c.conversationId !== conv.conversationId));
                if (__DEV__) console.log("[PrivateChatDelete] removed from local state", conv.conversationId);
                void loadConversations();
                if (__DEV__) console.log("[PrivateChatDelete] list refetched");
              }
            } catch { if (__DEV__) console.log("[PrivateChatDelete] delete failed"); }
          },
        },
      ]
    );
  };

  const [longPressConv, setLongPressConv] = useState<Conversation | null>(null);

  const removeFriendFromConv = (conv: Conversation) => {
    setLongPressConv(null);
    AppAlert.alert(
      "Unfriend & Delete Chat",
      `Unfriend @${conv.friendUsername}? This will permanently delete your private chat history.`,
      [
        { text: "Cancel" },
        {
          text: "Unfriend & Delete Chat",
          style: "destructive",
          onPress: async () => {
            try {
              const res = await authFetch("/api/friends/remove", { method: "POST", body: JSON.stringify({ friendId: conv.friendId }) });
              let conversationId: string | null = conv.conversationId;
              if (res.ok) { const data = await res.json(); conversationId = data.conversationId ?? conv.conversationId; }
              if (activeFriend?.id === conv.friendId) { setActiveFriend(null); setMsgs([]); setReplyingTo(null); setSelectedMsgId(null); }
              setConversations((prev) => prev.filter((c) => c.friendId !== conv.friendId));
              onUnfriend?.(conv.friendId, conversationId);
            } catch {}
          },
        },
      ]
    );
  };


  const [dmKbVisible, setDmKbVisible] = useState(false);
  useEffect(() => {
    const showEv = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEv = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const show = Keyboard.addListener(showEv, () => setDmKbVisible(true));
    const hide = Keyboard.addListener(hideEv, () => setDmKbVisible(false));
    return () => { show.remove(); hide.remove(); };
  }, []);

  // Close reactions when keyboard opens in private chat
  useEffect(() => {
    const event = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const sub = Keyboard.addListener(event, () => {
      setSelectedMsgId(null);
    });
    return () => sub.remove();
  }, []);

  // Close reactions when user navigates away from the Chat screen entirely
  useFocusEffect(useCallback(() => {
    return () => {
      setSelectedMsgId(null);
    };
  }, []));

  if (activeFriend) {
    return (
      <View style={{ flex: 1 }}>
        <ReportModal
          msg={reportingMsg}
          chatType="private"
          reportedUserId={reportingMsg?.userId}
          visible={!!reportingMsg}
          onClose={() => setReportingMsg(null)}
          colors={colors}
        />

        <View style={[cStyles.dmHeader, { backgroundColor: colors.card, borderBottomColor: colors.border }]}>
          <TouchableOpacity onPress={() => { setActiveFriend(null); setMsgs([]); setReplyingTo(null); setSelectedMsgId(null); }} style={{ padding: 4 }}>
            <Feather name="arrow-left" size={20} color={colors.mutedForeground} />
          </TouchableOpacity>
          <View style={{ position: "relative" }}>
            <View style={{ width: 42, height: 42, borderRadius: 21, overflow: "hidden", borderWidth: 2, borderColor: colors.primary + "40", backgroundColor: activeFriend.avatarColor, alignItems: "center", justifyContent: "center" }}>
              {activeFriend.avatarUrl ? (
                <CachedAvatarImage userId={activeFriend.id} avatarVersion={getAvatarVersion(activeFriend.id, activeFriend.avatarVersion ?? 0)} size={42} />
              ) : (
                <Text style={{ fontSize: 16, fontWeight: "800", color: "#fff" }}>{activeFriend.username[0].toUpperCase()}</Text>
              )}
            </View>
            <View style={{ position: "absolute", bottom: 1, right: 1, width: 11, height: 11, borderRadius: 6, backgroundColor: activeFriend.isOnline ? colors.primary : "#505060", borderWidth: 2, borderColor: colors.card }} />
          </View>
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 7 }}>
              <Text style={[cStyles.dmName, { color: colors.foreground }]}>@{activeFriend.username}</Text>
              {activeFriend.flag ? <Text style={{ fontSize: 17 }}>{activeFriend.flag}</Text> : null}
            </View>
            <Text style={{ color: activeFriend.isOnline ? colors.primary : colors.mutedForeground, fontSize: 11, marginTop: 1 }}>
              {activeFriend.isOnline ? "Online" : "Offline"}
            </Text>
          </View>
        </View>

        <KeyboardAvoidingView style={{ flex: 1, backgroundColor: DM_CHAT_BG }} behavior="padding" keyboardVerticalOffset={0}>
        {loadingMsgs ? (
          <View style={{ flex: 1, backgroundColor: DM_CHAT_BG, paddingTop: 12, paddingHorizontal: 12 }}>
            <SkeletonList count={8} variant="chat" />
          </View>
        ) : (
          <FlatList
            ref={listRef}
            data={[...msgs].reverse()}
            inverted
            extraData={selectedMsgId}
            keyExtractor={(item) => item.id}
            onScrollBeginDrag={() => { Keyboard.dismiss(); setSelectedMsgId(null); }}
            onMomentumScrollBegin={() => setSelectedMsgId(null)}
            keyboardDismissMode="on-drag"
            ListFooterComponent={<TouchableOpacity activeOpacity={1} style={{ minHeight: selectedMsgId !== null ? 120 : 20 }} onPress={() => { setSelectedMsgId(null); Keyboard.dismiss(); }} />}
            renderItem={({ item }) => {
              const isMe = item.isMe;
              const isSelected = item.id === selectedMsgId;
              const msgName = isMe ? (user?.username ?? "me") : activeFriend.username;
              const found = msgs.find((m) => m.id === item.id);
              return (
                <View>
                  {isSelected && (
                    <InlineActionPanel
                      isMe={isMe}
                      onReact={(emoji) => { void handleReact(item.id, emoji); setSelectedMsgId(null); }}
                      onReply={() => { setReplyingTo({ id: item.id, username: msgName, text: item.text }); setSelectedMsgId(null); }}
                      onReport={() => { setReportingMsg({ id: item.id, text: item.text, username: msgName, userId: found?.senderId ?? activeFriend?.id ?? "" }); setSelectedMsgId(null); }}
                      colors={colors}
                    />
                  )}
                  <SwipeableMessage onSwipeReply={() => setReplyingTo({ id: item.id, username: msgName, text: item.text })}>
                    <TouchableOpacity
                      activeOpacity={0.85}
                      onLongPress={() => {
                        setSelectedMsgId((prev) => (prev === item.id ? null : item.id));
                      }}
                      onPress={() => { Keyboard.dismiss(); if (selectedMsgId && selectedMsgId !== item.id) setSelectedMsgId(null); }}
                      delayLongPress={400}
                    >
                      {/* Private chat: no per-bubble avatars — WhatsApp style */}
                      <View style={[cStyles.msgRow, isMe ? cStyles.msgRowMe : cStyles.msgRowThem]}>
                        <View style={{ maxWidth: "78%", alignItems: isMe ? "flex-end" : "flex-start" }}>
                          <View style={[cStyles.bubble, isMe
                            ? { backgroundColor: colors.primary, borderBottomRightRadius: 4 }
                            : { backgroundColor: DM_RECV_BG, borderBottomLeftRadius: 4 }
                          ]}>
                            {item.replyPreview && <ReplyBlock preview={item.replyPreview} isMe={isMe} colors={colors} />}
                            <Text style={[cStyles.bubbleText, { color: isMe ? colors.primaryForeground : DM_RECV_TEXT }]}>{item.text}</Text>
                          </View>
                          {!isMe && item.reactions && <ReactionRow reactions={item.reactions} colors={colors} />}
                          <Text style={[cStyles.msgTime, { color: colors.mutedForeground }]}>{item.time}</Text>
                        </View>
                      </View>
                    </TouchableOpacity>
                  </SwipeableMessage>
                </View>
              ); }}
            style={{ flex: 1 }}
            contentContainerStyle={[cStyles.msgList, { flexGrow: 1 }]}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          />
        )}

        {replyingTo && <ReplyBar reply={replyingTo} onCancel={() => setReplyingTo(null)} colors={colors} />}

        <View style={[cStyles.inputBar, { backgroundColor: colors.card, borderTopColor: colors.border, paddingBottom: dmKbVisible ? 12 : Math.max(12, getSafeBottom(insets.bottom)) }]}>
          <TextInput
            style={[cStyles.chatInput, { backgroundColor: colors.background, borderColor: colors.border, color: colors.foreground }]}
            placeholder={`Message @${activeFriend.username}...`}
            placeholderTextColor={colors.mutedForeground}
            value={input}
            onFocus={() => setSelectedMsgId(null)}
            onChangeText={(t) => { setInput(t); }}
            onContentSizeChange={(e) => {
              const nextH = Math.min(140, Math.max(44, e.nativeEvent.contentSize.height));
              if (__DEV__) console.log("[ChatInput] DM content height:", e.nativeEvent.contentSize.height, "applied:", nextH);
              setInputH(nextH);
            }}
            onSubmitEditing={sendMsg}
            returnKeyType="send"
            multiline
            textAlignVertical="top"
            scrollEnabled={inputH >= 140}
            blurOnSubmit={false}
            maxLength={280}
          />
          <TouchableOpacity style={[cStyles.sendBtn, { backgroundColor: input.trim() ? colors.primary : colors.border }]} onPress={sendMsg} disabled={!input.trim()}>
            <Feather name="send" size={16} color={input.trim() ? colors.primaryForeground : colors.mutedForeground} />
          </TouchableOpacity>
        </View>
        </KeyboardAvoidingView>
      </View>
    ); }

  return (
    <>
      <Modal visible={!!longPressConv} transparent animationType="fade" onRequestClose={() => setLongPressConv(null)}>
        <TouchableOpacity style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.65)", justifyContent: "flex-end" }} activeOpacity={1} onPress={() => setLongPressConv(null)}>
          <TouchableOpacity activeOpacity={1} style={{ backgroundColor: colors.card, borderTopLeftRadius: 26, borderTopRightRadius: 26, paddingBottom: 36 }}>
            <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: colors.border, alignSelf: "center", marginTop: 10, marginBottom: 18 }} />
            {longPressConv && (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 22, paddingBottom: 18, borderBottomWidth: 1, borderBottomColor: colors.border }}>
                <Avatar color={longPressConv.friendAvatarColor} letter={longPressConv.friendUsername[0]} size={40} />
                <View>
                  <Text style={{ color: colors.foreground, fontWeight: "700", fontSize: 15 }}>@{longPressConv.friendUsername}</Text>
                  <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>{longPressConv.friendFlag}</Text>
                </View>
              </View>
            )}
            <TouchableOpacity
              style={{ flexDirection: "row", alignItems: "center", gap: 14, paddingHorizontal: 22, paddingVertical: 18 }}
              onPress={() => { const conv = longPressConv; setLongPressConv(null); if (conv) deleteConversation(conv); }}
            >
              <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: "#FF3B3018", alignItems: "center", justifyContent: "center" }}>
                <Feather name="trash-2" size={18} color="#FF3B30" />
              </View>
              <View>
                <Text style={{ color: "#FF3B30", fontSize: 16, fontWeight: "600" }}>Delete Chat</Text>
                <Text style={{ color: colors.mutedForeground, fontSize: 12, marginTop: 2 }}>Remove this conversation history</Text>
              </View>
            </TouchableOpacity>
            <TouchableOpacity
              style={{ flexDirection: "row", alignItems: "center", gap: 14, paddingHorizontal: 22, paddingVertical: 18 }}
              onPress={() => { const conv = longPressConv; if (conv) removeFriendFromConv(conv); }}
            >
              <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: "#EF444418", alignItems: "center", justifyContent: "center" }}>
                <Feather name="user-minus" size={18} color="#EF4444" />
              </View>
              <View>
                <Text style={{ color: "#EF4444", fontSize: 16, fontWeight: "600" }}>Unfriend</Text>
                <Text style={{ color: colors.mutedForeground, fontSize: 12, marginTop: 2 }}>Remove friend and delete chat</Text>
              </View>
            </TouchableOpacity>
            <TouchableOpacity
              style={{ marginHorizontal: 20, marginTop: 4, borderRadius: 14, backgroundColor: colors.muted, alignItems: "center", paddingVertical: 15 }}
              onPress={() => setLongPressConv(null)}
            >
              <Text style={{ color: colors.mutedForeground, fontSize: 15, fontWeight: "600" }}>Cancel</Text>
            </TouchableOpacity>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      <ScrollView
        style={{ flex: 1 }}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[cStyles.listPad, { paddingBottom: 20 }]}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={loadingConvs} onRefresh={loadConversations} tintColor="#00E676" />}
      >
        {!loadingConvs && conversations.length === 0 && (
          <View style={cStyles.emptyBox}>
            <Feather name="users" size={36} color={colors.mutedForeground} />
            <Text style={[cStyles.emptyText, { color: colors.mutedForeground }]}>No friends yet. Add friends to start chatting!</Text>
          </View>
        )}
        {conversations.map((conv) => (
          <TouchableOpacity
            key={conv.conversationId}
            style={[cStyles.neonCard, { backgroundColor: colors.card, borderColor: colors.border }]}
            onPress={() => openChat(conv)}
            onLongPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); setLongPressConv(conv); }}
            delayLongPress={400}
            activeOpacity={0.82}
          >
            <View style={{ position: "relative" }}>
              {conv.friendAvatarUrl ? (
                <View style={{ width: 50, height: 50, borderRadius: 25, overflow: "hidden", borderWidth: 2, borderColor: conv.friendAvatarColor + "80" }}>
                  <CachedAvatarImage userId={conv.friendId} avatarVersion={getAvatarVersion(conv.friendId, conv.friendAvatarVersion ?? 0)} size={50} />
                </View>
              ) : (
                <Avatar color={conv.friendAvatarColor} letter={conv.friendUsername[0]} size={50} />
              )}
              <View style={{ position: "absolute", bottom: 1, right: 1, width: 12, height: 12, borderRadius: 6, backgroundColor: conv.isOnline ? "#00E676" : "#505060", borderWidth: 2, borderColor: colors.card }} />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexShrink: 1, minWidth: 0 }}>
                  <Text style={{ color: colors.foreground, fontSize: 15, fontWeight: "700" }} numberOfLines={1}>@{conv.friendUsername}</Text>
                  <Text style={{ fontSize: 14 }}>{conv.friendFlag}</Text>
                </View>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexShrink: 0 }}>
                  {conv.lastMessageAt && <Text style={{ fontSize: 11, color: colors.mutedForeground }}>{formatRelativeTime(conv.lastMessageAt)}</Text>}
                  {conv.unreadCount > 0 && (
                    <View style={{ backgroundColor: "#00E676", borderRadius: 10, minWidth: 20, height: 20, alignItems: "center", justifyContent: "center", paddingHorizontal: 5 }}>
                      <Text style={{ fontSize: 10, fontWeight: "900", color: "#000" }}>{conv.unreadCount > 9 ? "9+" : conv.unreadCount}</Text>
                    </View>
                  )}
                </View>
              </View>
              {conv.lastMessage ? (
                <Text style={{ fontSize: 13, color: colors.mutedForeground, marginTop: 3 }} numberOfLines={1}>{conv.lastMessage}</Text>
              ) : (
                <Text style={{ fontSize: 13, color: colors.mutedForeground + "60", marginTop: 3, fontStyle: "italic" }}>Start a conversation…</Text>
              )}
            </View>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </>
  ); }

// ── Friends Tab ────────────────────────────────────────────────────────────────

function FriendsTab({ colors, insets, onOpenPrivateChat, incomingRequests = [], refreshTrigger = 0, onUnfriend, highlightUserId = null }: {
  colors: ReturnType<typeof useColors>;
  insets: EdgeInsets;
  onOpenPrivateChat: (friend: FriendItem) => void;
  incomingRequests?: FriendRequest[];
  refreshTrigger?: number;
  onUnfriend?: (friendId: string, conversationId: string | null) => void;
  highlightUserId?: string | null;
}) {
  const { getAvatarVersion } = useAvatarVersionContext();
  const { user } = useAuth();
  const [friends, setFriends] = useState<FriendItem[]>([]);
  const [received, setReceived] = useState<FriendRequest[]>([]);
  const [sent, setSent] = useState<FriendRequest[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  // ── User search ────────────────────────────────────────────────────────────
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchUser[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sendingToRef = useRef<Set<string>>(new Set());

  const runSearch = useCallback(async (q: string) => {
    if (q.length < 2) { setSearchResults([]); setSearchLoading(false); return; }
    setSearchLoading(true);
    try {
      const res = await authFetch(`/api/users/search?query=${encodeURIComponent(q)}`);
      if (res.ok) { const data = await res.json(); setSearchResults(data.users ?? []); }
    } catch {}
    setSearchLoading(false); }, []);

  const handleSearchChange = useCallback((q: string) => {
    setSearchQuery(q);
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    if (q.length < 2) { setSearchResults([]); setSearchLoading(false); return; }
    setSearchLoading(true);
    searchDebounceRef.current = setTimeout(() => { void runSearch(q); }, 300); }, [runSearch]);

  const clearSearch = useCallback(() => {
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    setSearchQuery(""); setSearchResults([]); setSearchLoading(false); }, []);

  const load = useCallback(async () => {
    try {
      const [fr, fds] = await Promise.all([
        authFetch("/api/friends/requests").then((r) => r.json()),
        authFetch("/api/friends").then((r) => r.json()),
      ]);
      setReceived(dedupeRequestsByUser(fr.received ?? []));
      setSent(dedupeRequestsByUser(fr.sent ?? []));
      setFriends(fds.friends ?? []);
      prefetchProfileAvatars(fds.friends ?? []);
    } catch {}
    setLoading(false);
    setRefreshing(false);
  }, []);

  const friendIds = useMemo(() => new Set(friends.map((f) => f.id)), [friends]);

  const visibleReceived = useMemo(
    () => dedupeRequestsByUser(received.filter((r) => !friendIds.has(r.userId))),
    [received, friendIds],
  );

  const visibleSent = useMemo(
    () => dedupeRequestsByUser(sent.filter((r) => !friendIds.has(r.userId))),
    [sent, friendIds],
  );

  const resolvedSearchResults = useMemo(() => {
    const sentByUserId = new Map(visibleSent.map((s) => [s.userId, s.id]));
    const receivedByUserId = new Map(visibleReceived.map((r) => [r.userId, r.id]));

    return searchResults.map((u) => {
      if (friendIds.has(u.id)) {
        return { ...u, friendStatus: "friends" as const, requestId: null };
      }
      const receivedRequestId = receivedByUserId.get(u.id);
      if (receivedRequestId) {
        return { ...u, friendStatus: "pending_received" as const, requestId: receivedRequestId };
      }
      const sentRequestId = sentByUserId.get(u.id);
      if (sentRequestId) {
        return { ...u, friendStatus: "pending_sent" as const, requestId: sentRequestId };
      }
      if (u.friendStatus === "pending_sent" || u.friendStatus === "pending_received") {
        return { ...u, friendStatus: "none" as const, requestId: null };
      }
      return u;
    });
  }, [searchResults, friendIds, visibleSent, visibleReceived]);

  const displaySearchResults = useMemo(() => {
    const listedUserIds = new Set([
      ...friendIds,
      ...visibleSent.map((s) => s.userId),
      ...visibleReceived.map((r) => r.userId),
    ]);
    return resolvedSearchResults.filter((u) => {
      if (listedUserIds.has(u.id)) return false;
      if (u.friendStatus !== "none") return false;
      return true;
    });
  }, [resolvedSearchResults, friendIds, visibleSent, visibleReceived]);

  const upsertSentRequest = useCallback((requestId: string, user: SearchUser) => {
    setSent((prev) => {
      if (prev.some((r) => r.id === requestId || r.userId === user.id)) return prev;
      return [{
        id: requestId,
        type: "sent" as const,
        userId: user.id,
        username: user.username,
        flag: user.flag,
        avatarColor: user.avatarColor,
        avatarUrl: user.avatarUrl ?? null,
        avatarVersion: user.avatarVersion ?? null,
      }, ...prev];
    });
  }, []);

  const addFriendLocally = useCallback((req: Pick<FriendRequest, "userId" | "username" | "flag" | "avatarColor" | "avatarUrl" | "avatarVersion">) => {
    setFriends((prev) => {
      if (prev.some((f) => f.id === req.userId)) return prev;
      return [{
        id: req.userId,
        username: req.username,
        flag: req.flag,
        avatarColor: req.avatarColor,
        avatarUrl: req.avatarUrl ?? null,
        avatarVersion: req.avatarVersion ?? null,
      }, ...prev];
    });
    setReceived((prev) => prev.filter((r) => r.userId !== req.userId));
    setSent((prev) => prev.filter((r) => r.userId !== req.userId));
    setSearchResults((prev) => prev.map((u) => (
      u.id === req.userId ? { ...u, friendStatus: "friends" as const, requestId: null } : u
    )));
  }, []);

  const clearPendingForUser = useCallback((userId: string) => {
    setReceived((prev) => prev.filter((r) => r.userId !== userId));
    setSent((prev) => prev.filter((r) => r.userId !== userId));
    setSearchResults((prev) => prev.map((u) => (
      u.id === userId ? { ...u, friendStatus: "none" as const, requestId: null } : u
    )));
  }, []);

  const sendRequestFromSearch = useCallback(async (targetId: string) => {
    if (sendingToRef.current.has(targetId)) return;
    const targetUser = searchResults.find((u) => u.id === targetId);
    if (targetUser?.friendStatus === "pending_sent") return;

    sendingToRef.current.add(targetId);
    setSearchResults((prev) => prev.map((u) => u.id === targetId ? { ...u, friendStatus: "pending_sent" as const } : u));
    if (targetUser) {
      setSent((prev) => {
        if (prev.some((r) => r.userId === targetId)) return prev;
        return [{
          id: `pending-${targetId}`,
          type: "sent" as const,
          userId: targetUser.id,
          username: targetUser.username,
          flag: targetUser.flag,
          avatarColor: targetUser.avatarColor,
          avatarUrl: targetUser.avatarUrl ?? null,
          avatarVersion: targetUser.avatarVersion ?? null,
        }, ...prev];
      });
    }
    try {
      const res = await authFetch("/api/friends/request", { method: "POST", body: JSON.stringify({ targetUserId: targetId }) });
      if (!res.ok) {
        clearPendingForUser(targetId);
        return;
      }
      const data = (await res.json()) as { request?: { id: string } };
      const requestId = data.request?.id ?? null;
      if (!requestId) {
        clearPendingForUser(targetId);
        return;
      }
      if (targetUser) {
        upsertSentRequest(requestId, { ...targetUser, friendStatus: "pending_sent", requestId });
      }
      setSent((prev) => prev.map((r) => r.id === `pending-${targetId}` ? { ...r, id: requestId } : r));
      setSearchResults((prev) => prev.map((u) => u.id === targetId ? { ...u, friendStatus: "pending_sent" as const, requestId } : u));
    } catch {
      clearPendingForUser(targetId);
    } finally {
      sendingToRef.current.delete(targetId);
    }
  }, [searchResults, clearPendingForUser, upsertSentRequest]);

  const cancelRequestFromSearch = useCallback(async (requestId: string, targetId: string) => {
    setActionLoading(requestId);
    clearPendingForUser(targetId);
    try {
      await authFetch("/api/friends/cancel", { method: "POST", body: JSON.stringify({ requestId }) });
    } catch {
      void load();
    }
    setActionLoading(null);
  }, [clearPendingForUser, load]);

  const acceptFromSearch = useCallback(async (requestId: string, targetId: string) => {
    const user = searchResults.find((u) => u.id === targetId);
    if (user) {
      addFriendLocally({
        userId: targetId,
        username: user.username,
        flag: user.flag,
        avatarColor: user.avatarColor,
        avatarUrl: user.avatarUrl,
        avatarVersion: user.avatarVersion,
      });
    }
    setActionLoading(requestId);
    try {
      await authFetch("/api/friends/accept", { method: "POST", body: JSON.stringify({ requestId }) });
      await load();
    } catch {
      void load();
    }
    setActionLoading(null);
  }, [addFriendLocally, load, searchResults]);

  useEffect(() => { load(); }, [load]);

  // Note: FriendsTab remounts on every switch to Friends tab, so useEffect above handles the initial load.

  // ── Real-time friend request updates via Pusher ────────────────────────────
  useEffect(() => {
    if (!user?.id) return;
    const channelName = CHANNELS.privateUser(user.id);
    const channel = subscribeToChannel(channelName);
    if (!channel) return;

    const handleNewRequest = (data: { id: string; userId: string; username: string; flag: string; avatarColor: string; createdAt: string }) => {
      setReceived((prev) => {
        if (prev.some((r) => r.id === data.id || r.userId === data.userId)) return prev;
        return [{ id: data.id, type: "received" as const, userId: data.userId, username: data.username, flag: data.flag, avatarColor: data.avatarColor, createdAt: data.createdAt }, ...prev]; }); };

    const handleAccepted = () => { void load(); };

    const handleRejected = (data: { requestId: string; otherUserId: string }) => {
      setReceived((prev) => prev.filter((r) => r.id !== data.requestId && r.userId !== data.otherUserId));
      setSent((prev) => prev.filter((r) => r.id !== data.requestId && r.userId !== data.otherUserId));
      setSearchResults((prev) => prev.map((u) => (
        u.id === data.otherUserId ? { ...u, friendStatus: "none" as const, requestId: null } : u
      )));
    };

    channel.bind(EVENTS.FRIEND_REQUEST_NEW, handleNewRequest);
    channel.bind(EVENTS.FRIEND_REQUEST_ACCEPTED, handleAccepted);
    channel.bind(EVENTS.FRIEND_REQUEST_REJECTED, handleRejected);

    return () => {
      channel.unbind(EVENTS.FRIEND_REQUEST_NEW, handleNewRequest);
      channel.unbind(EVENTS.FRIEND_REQUEST_ACCEPTED, handleAccepted);
      channel.unbind(EVENTS.FRIEND_REQUEST_REJECTED, handleRejected); }; }, [user?.id, load]);

  // Merge requests that arrived while on another sub-tab (from parent ChatScreen)
  useEffect(() => {
    if (!incomingRequests.length) return;
    setReceived((prev) => {
      const existingIds = new Set(prev.map((r) => r.id));
      const existingUserIds = new Set(prev.map((r) => r.userId));
      const news = incomingRequests.filter((r) => !existingIds.has(r.id) && !existingUserIds.has(r.userId));
      return news.length ? dedupeRequestsByUser([...news, ...prev]) : prev; }); }, [incomingRequests]);

  // Reload when parent receives friend_request:accepted or friend:list_updated on any sub-tab
  useEffect(() => {
    if (refreshTrigger > 0) void load();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshTrigger]);

  const acceptRequest = async (req: FriendRequest) => {
    setActionLoading(req.id);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    addFriendLocally(req);
    try {
      await authFetch("/api/friends/accept", { method: "POST", body: JSON.stringify({ requestId: req.id }) });
      await load();
    } catch {
      void load();
    }
    setActionLoading(null);
  };

  const rejectRequest = async (req: FriendRequest) => {
    setActionLoading(req.id);
    clearPendingForUser(req.userId);
    try {
      await authFetch("/api/friends/reject", { method: "POST", body: JSON.stringify({ requestId: req.id }) });
    } catch {
      void load();
    }
    setActionLoading(null);
  };

  const cancelRequest = async (req: FriendRequest) => {
    setActionLoading(req.id);
    clearPendingForUser(req.userId);
    try {
      await authFetch("/api/friends/cancel", { method: "POST", body: JSON.stringify({ requestId: req.id }) });
    } catch {
      void load();
    }
    setActionLoading(null);
  };

  const removeFriend = (f: FriendItem) => {
    AppAlert.alert(
      "Unfriend & Delete Chat",
      `Are you sure you want to unfriend @${f.username}? This will permanently delete all private chat history between you two.`,
      [
        { text: "Cancel" },
        {
          text: "Unfriend & Delete Chat",
          style: "destructive",
          onPress: async () => {
            try {
              const res = await authFetch("/api/friends/remove", { method: "POST", body: JSON.stringify({ friendId: f.id }) });
              let conversationId: string | null = null;
              if (res.ok) {
                const data = await res.json();
                conversationId = data.conversationId ?? null;
              }
              setFriends((prev) => prev.filter((fr) => fr.id !== f.id));
              clearPendingForUser(f.id);
              onUnfriend?.(f.id, conversationId);
            } catch {}
          },
        },
      ]
    ); };

  const hasRequests = visibleReceived.length > 0 || visibleSent.length > 0;

  return (
    <ScrollView
      style={{ flex: 1 }}
      showsVerticalScrollIndicator={false}
      contentContainerStyle={[cStyles.listPad, { paddingBottom: getSafeBottom(insets.bottom) + 20 }]}
      keyboardShouldPersistTaps="handled"
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); void load(); }} tintColor={colors.primary} />}
    >
      {/* ── Search bar ── */}
      <View style={{ flexDirection: "row", alignItems: "center", backgroundColor: colors.card, borderRadius: 14, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 14, paddingVertical: 10, gap: 10, marginBottom: 14 }}>
        <Feather name="search" size={16} color={colors.mutedForeground} />
        <TextInput
          style={{ flex: 1, fontSize: 15, color: colors.foreground, padding: 0 }}
          placeholder="Search users by username…"
          placeholderTextColor={colors.mutedForeground}
          value={searchQuery}
          onChangeText={handleSearchChange}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
        />
        {searchQuery.length > 0 && (
          <TouchableOpacity onPress={clearSearch} hitSlop={8}>
            <Feather name="x" size={16} color={colors.mutedForeground} />
          </TouchableOpacity>
        )}
      </View>

      {/* ── Search Results ── */}
      {searchQuery.length >= 2 && (
        <>
          <View style={[cStyles.sectionHeader, { borderBottomColor: colors.border }]}>
            <Feather name="search" size={15} color="#00CFFF" />
            <Text style={[cStyles.sectionTitle, { color: colors.foreground }]}>Search Results</Text>
          </View>
          {searchLoading && (
            <View style={{ paddingHorizontal: 12, paddingTop: 8 }}>
              <SkeletonList count={4} variant="user" />
            </View>
          )}
          {!searchLoading && displaySearchResults.length === 0 && (
            <Text style={[cStyles.emptyHint, { color: colors.mutedForeground }]}>
              {resolvedSearchResults.length > 0
                ? "Matching users are listed in Requests or Friends below."
                : `No users found for "${searchQuery}"`}
            </Text>
          )}
          {displaySearchResults.map((u) => (
            <View key={u.id} style={[cStyles.neonCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              {u.avatarUrl ? (
                <View style={{ width: 48, height: 48, borderRadius: 24, overflow: "hidden", borderWidth: 2, borderColor: u.avatarColor + "80" }}>
                  <CachedAvatarImage userId={u.id} avatarVersion={u.avatarVersion ?? 0} size={48} />
                </View>
              ) : (
                <Avatar color={u.avatarColor} letter={(u.username[0] ?? "?").toUpperCase()} size={48} />
              )}
              <View style={{ flex: 1 }}>
                <Text style={[cStyles.friendName, { color: colors.foreground }]}>@{u.username}</Text>
                {u.fullName ? (
                  <Text style={{ fontSize: 12, color: colors.mutedForeground, marginTop: 2 }}>{u.fullName} {u.flag}</Text>
                ) : (
                  <Text style={{ fontSize: 14, marginTop: 2 }}>{u.flag}</Text>
                )}
              </View>
              {u.friendStatus === "friends" ? (
                <View style={{ borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8, backgroundColor: "#00E67618", borderWidth: 1, borderColor: "#00E67630" }}>
                  <Text style={{ color: "#00E676", fontSize: 13, fontWeight: "600" }}>Friends</Text>
                </View>
              ) : u.friendStatus === "pending_sent" ? (
                <TouchableOpacity
                  style={{
                    borderRadius: 10,
                    borderWidth: 1.5,
                    borderColor: colors.warning + "60",
                    paddingHorizontal: 14,
                    paddingVertical: 8,
                    backgroundColor: colors.warning + "12",
                    opacity: u.requestId && actionLoading === u.requestId ? 0.6 : 1,
                  }}
                  onPress={() => u.requestId ? void cancelRequestFromSearch(u.requestId, u.id) : undefined}
                  disabled={!u.requestId || actionLoading === u.requestId}
                  activeOpacity={0.8}
                >
                  <Text style={{ color: colors.warning, fontSize: 13, fontWeight: "600" }}>
                    {u.requestId && actionLoading === u.requestId ? "…" : "Cancel"}
                  </Text>
                </TouchableOpacity>
              ) : u.friendStatus === "pending_received" ? (
                <TouchableOpacity
                  style={{ borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8, backgroundColor: "#00E67612", borderWidth: 1.5, borderColor: "#00E676" }}
                  onPress={() => u.requestId ? void acceptFromSearch(u.requestId, u.id) : undefined}
                >
                  <Text style={{ color: "#00E676", fontSize: 13, fontWeight: "700" }}>Accept</Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity
                  style={{ borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8, backgroundColor: "#A855F718", borderWidth: 1.5, borderColor: "#A855F760" }}
                  onPress={() => void sendRequestFromSearch(u.id)}
                >
                  <Text style={{ color: "#A855F7", fontSize: 13, fontWeight: "700" }}>Add Friend</Text>
                </TouchableOpacity>
              )}
            </View>
          ))}
          <View style={{ height: 8 }} />
        </>
      )}

      {/* ── Friend Requests ── */}
      <View style={[cStyles.sectionHeader, { borderBottomColor: colors.border }]}>
        <Feather name="user-plus" size={15} color="#A855F7" />
        <Text style={[cStyles.sectionTitle, { color: colors.foreground }]}>Friend Requests</Text>
        {hasRequests && (
          <View style={[cStyles.countBadge, { backgroundColor: "#A855F7" }]}>
            <Text style={cStyles.countBadgeText}>{visibleReceived.length + visibleSent.length}</Text>
          </View>
        )}
      </View>

      {visibleReceived.map((r) => (
        <View key={r.id} style={[cStyles.neonCard, {
          backgroundColor: colors.card,
          borderColor: highlightUserId === r.userId ? "#A855F7" : colors.border,
          borderWidth: highlightUserId === r.userId ? 2 : 1,
          alignItems: "flex-start",
        }]}>
          <View style={{ position: "relative" }}>
            {r.avatarUrl && r.userId ? (
              <View style={{ width: 48, height: 48, borderRadius: 24, overflow: "hidden", borderWidth: 2, borderColor: r.avatarColor + "80" }}>
                <CachedAvatarImage userId={r.userId} avatarVersion={getAvatarVersion(r.userId, r.avatarVersion ?? 0)} size={48} />
              </View>
            ) : (
              <Avatar color={r.avatarColor} letter={r.username[0]} size={48} />
            )}
            <View style={{ position: "absolute", bottom: 1, right: 1, width: 12, height: 12, borderRadius: 6, backgroundColor: "#505060", borderWidth: 2, borderColor: colors.card }} />
          </View>
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <Text style={[cStyles.friendName, { color: colors.foreground }]}>@{r.username}</Text>
              <Text style={{ fontSize: 14 }}>{r.flag}</Text>
            </View>
            <Text style={{ fontSize: 12, color: "#00E676", marginTop: 3, fontWeight: "500" }}>Wants to be friends</Text>
          </View>
          <View style={{ flexDirection: "column", gap: 7 }}>
            <TouchableOpacity
              style={{ borderRadius: 10, borderWidth: 1.5, borderColor: "#00E676", paddingHorizontal: 16, paddingVertical: 8, alignItems: "center", opacity: actionLoading === r.id ? 0.6 : 1, backgroundColor: "#00E67612" }}
              onPress={() => acceptRequest(r)}
              disabled={actionLoading === r.id}
            >
              <Text style={{ color: "#00E676", fontSize: 13, fontWeight: "700" }}>Accept</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={{ borderRadius: 10, borderWidth: 1.5, borderColor: "#EF4444", paddingHorizontal: 16, paddingVertical: 8, alignItems: "center", opacity: actionLoading === r.id ? 0.6 : 1, backgroundColor: "#EF444412" }}
              onPress={() => rejectRequest(r)}
              disabled={actionLoading === r.id}
            >
              <Text style={{ color: "#EF4444", fontSize: 13, fontWeight: "700" }}>Decline</Text>
            </TouchableOpacity>
          </View>
        </View>
      ))}

      {visibleSent.map((r) => (
        <View key={r.id} style={[cStyles.neonCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          {r.avatarUrl && r.userId ? (
            <View style={{ width: 48, height: 48, borderRadius: 24, overflow: "hidden", borderWidth: 2, borderColor: r.avatarColor + "80" }}>
              <CachedAvatarImage userId={r.userId} avatarVersion={getAvatarVersion(r.userId, r.avatarVersion ?? 0)} size={48} />
            </View>
          ) : (
            <Avatar color={r.avatarColor} letter={r.username[0]} size={48} />
          )}
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <Text style={[cStyles.friendName, { color: colors.foreground }]}>@{r.username}</Text>
              <Text style={{ fontSize: 14 }}>{r.flag}</Text>
            </View>
            <Text style={{ fontSize: 12, color: colors.warning, marginTop: 3, fontWeight: "500" }}>Request pending</Text>
          </View>
          <TouchableOpacity
            style={{ borderRadius: 10, borderWidth: 1.5, borderColor: colors.warning + "60", paddingHorizontal: 14, paddingVertical: 8, backgroundColor: colors.warning + "12", opacity: actionLoading === r.id ? 0.6 : 1 }}
            onPress={() => cancelRequest(r)}
            disabled={actionLoading === r.id}
          >
            <Text style={{ color: colors.warning, fontSize: 13, fontWeight: "600" }}>Cancel</Text>
          </TouchableOpacity>
        </View>
      ))}

      {!hasRequests && (
        <Text style={[cStyles.emptyHint, { color: colors.mutedForeground }]}>No pending requests</Text>
      )}

      {/* ── Friends ── */}
      <View style={[cStyles.sectionHeader, { borderBottomColor: colors.border, marginTop: 20 }]}>
        <Feather name="users" size={15} color="#00E676" />
        <Text style={[cStyles.sectionTitle, { color: colors.foreground }]}>Friends</Text>
        {friends.length > 0 && (
          <View style={[cStyles.countBadge, { backgroundColor: "#00E67618" }]}>
            <Text style={[cStyles.countBadgeText, { color: "#00E676" }]}>{friends.length}</Text>
          </View>
        )}
      </View>

      {friends.map((f) => (
        <TouchableOpacity
          key={f.id}
          style={[cStyles.neonCard, { backgroundColor: colors.card, borderColor: colors.border }]}
          onPress={() => onOpenPrivateChat(f)}
          activeOpacity={0.8}
        >
          <View style={{ position: "relative" }}>
            {f.avatarUrl && f.id ? (
              <View style={{ width: 48, height: 48, borderRadius: 24, overflow: "hidden", borderWidth: 2, borderColor: f.avatarColor + "80" }}>
                <CachedAvatarImage userId={f.id} avatarVersion={getAvatarVersion(f.id, f.avatarVersion ?? 0)} size={48} />
              </View>
            ) : (
              <Avatar color={f.avatarColor} letter={f.username[0]} size={48} />
            )}
            <View style={{ position: "absolute", bottom: 1, right: 1, width: 12, height: 12, borderRadius: 6, backgroundColor: f.isOnline ? "#00E676" : "#505060", borderWidth: 2, borderColor: colors.card }} />
          </View>
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <Text style={[cStyles.friendName, { color: colors.foreground }]}>@{f.username}</Text>
              <Text style={{ fontSize: 14 }}>{f.flag}</Text>
            </View>
            <Text style={{ fontSize: 12, color: "#00E67690", marginTop: 2 }}>Tap to chat</Text>
          </View>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <TouchableOpacity
              style={{ width: 36, height: 36, borderRadius: 10, borderWidth: 1.5, borderColor: "#00E67640", backgroundColor: "#00E67612", alignItems: "center", justifyContent: "center" }}
              onPress={() => onOpenPrivateChat(f)}
              hitSlop={6}
            >
              <Feather name="message-circle" size={16} color="#00E676" />
            </TouchableOpacity>
            <TouchableOpacity
              style={{ width: 36, height: 36, borderRadius: 10, borderWidth: 1.5, borderColor: "#EF444440", backgroundColor: "#EF444412", alignItems: "center", justifyContent: "center" }}
              onPress={() => removeFriend(f)}
              hitSlop={6}
            >
              <Feather name="user-x" size={16} color="#EF4444" />
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      ))}

      {!loading && friends.length === 0 && (
        <View style={cStyles.emptyBox}>
          <Feather name="users" size={36} color={colors.mutedForeground} />
          <Text style={[cStyles.emptyText, { color: colors.mutedForeground }]}>No friends yet. Add from the leaderboard or global chat!</Text>
        </View>
      )}
    </ScrollView>
  ); }

// ── Chat Screen ───────────────────────────────────────────────────────────────

export default function ChatScreen() {
  useScreenMountPerf("Chat");
  const colors = useColors();
  const { insets, safeTop } = useSafeLayout();
  const { user } = useAuth();
  const searchParams = useLocalSearchParams<{
    tab?: string | string[];
    senderUserId?: string | string[];
    friendId?: string | string[];
    conversationId?: string | string[];
  }>();
  const paramTab = Array.isArray(searchParams.tab) ? searchParams.tab[0] : searchParams.tab;
  const paramSenderUserId = Array.isArray(searchParams.senderUserId)
    ? searchParams.senderUserId[0]
    : searchParams.senderUserId;
  const paramFriendId = Array.isArray(searchParams.friendId)
    ? searchParams.friendId[0]
    : searchParams.friendId;
  const paramConversationId = Array.isArray(searchParams.conversationId)
    ? searchParams.conversationId[0]
    : searchParams.conversationId;
  const tabBarHeight = useTabBarHeight();
  const { getAvatarVersion } = useAvatarVersionContext();
  const { markRequestsSeen, clearPrivateUnread } = useUnread();
  const [activeTab, setActiveTab] = useState<ChatTab>("global");
  const [pendingPrivateFriend, setPendingPrivateFriend] = useState<FriendItem | null>(null);
  const [incomingFriendRequests, setIncomingFriendRequests] = useState<FriendRequest[]>([]);
  const [friendsRefreshTrigger, setFriendsRefreshTrigger] = useState(0);
  const [unfriendedConv, setUnfriendedConv] = useState<{ friendId: string; conversationId: string | null } | null>(null);
  const [globalUnread, setGlobalUnread] = useState(0);
  const [privateUnread, setPrivateUnread] = useState(0);
  const activeTabRef = useRef<ChatTab>("global");

  useEffect(() => {
    const tab = normalizeChatTab(paramTab);
    if (tab) setActiveTab(tab);
  }, [paramTab]);

  // Deep link: open a friend's private chat after friend request accepted
  useEffect(() => {
    if (!paramFriendId || !user?.id) return;
    setActiveTab("private");
    let cancelled = false;
    void (async () => {
      try {
        const res = await authFetch("/api/friends");
        if (!res.ok || cancelled) return;
        const data = await res.json();
        const match = (data.friends ?? []).find(
          (f: { id: string; username: string; flag?: string; avatarColor?: string; avatarUrl?: string | null; avatarVersion?: number | null }) =>
            f.id === paramFriendId,
        );
        if (!match || cancelled) return;
        setPendingPrivateFriend({
          id: match.id,
          username: match.username,
          flag: match.flag ?? "🌍",
          avatarColor: match.avatarColor ?? "#00E676",
          avatarUrl: match.avatarUrl ?? null,
          avatarVersion: match.avatarVersion ?? null,
        });
      } catch {
        // Ignore — user lands on private tab
      }
    })();
    return () => { cancelled = true; };
  }, [paramFriendId, user?.id]);

  // Seed badge counts from DB on screen mount
  useEffect(() => {
    if (!user?.id) return;
    (async () => {
      try {
        const res = await authFetch("/api/chat/summary");
        if (res.ok) {
          const data: { privateUnread: number; requestCount: number } = await res.json();
          setPrivateUnread(data.privateUnread ?? 0);
          if (data.requestCount > 0) {
            // Merge any pending requests we don't already have in state
            const res2 = await authFetch("/api/friends/requests");
            if (res2.ok) {
              const d2 = await res2.json();
              const received: Array<{ id: string; userId: string; username: string; flag: string; avatarColor: string; avatarUrl?: string | null }> = d2.received ?? [];
              setIncomingFriendRequests((prev) => {
                const merged = [...prev];
                for (const r of received) {
                  if (!merged.some((x) => x.id === r.id || x.userId === r.userId)) {
                    merged.push({ id: r.id, type: "received" as const, userId: r.userId, username: r.username, flag: r.flag, avatarColor: r.avatarColor, avatarUrl: r.avatarUrl ?? null }); } }
                return dedupeRequestsByUser(merged); }); } } } } catch {} })(); }, [user?.id]);

  const [headerHeight, setHeaderHeight] = useState(getSafeTop(insets.top) + 96);

  const TAB_ACCENTS: Record<ChatTab, string> = {
    global: "#00CFFF",
    private: "#00E676",
    friends: "#A855F7",
  };

  const TABS: { key: ChatTab; label: string; icon: string }[] = [
    { key: "global", label: "Global", icon: "globe" },
    { key: "private", label: "Friends", icon: "users" },
    { key: "friends", label: "Requests", icon: "user-plus" },
  ];

  // Subscribe at screen level so friend_request:new events arrive on any sub-tab
  useEffect(() => {
    if (!user?.id) return;
    const channel = subscribeToChannel(CHANNELS.privateUser(user.id));
    if (!channel) return;
    const onNewRequest = (data: { id: string; userId: string; username: string; flag: string; avatarColor: string }) => {
      setIncomingFriendRequests((prev) => {
        if (prev.some((r) => r.id === data.id || r.userId === data.userId)) return prev;
        return [{ id: data.id, type: "received" as const, userId: data.userId, username: data.username, flag: data.flag, avatarColor: data.avatarColor }, ...prev]; }); };

    const onRejected = (data: { requestId: string; otherUserId: string }) => {
      setIncomingFriendRequests((prev) => prev.filter((r) => r.id !== data.requestId && r.userId !== data.otherUserId));
    };

    // When a request is accepted, signal FriendsTab to reload its full list
    const onAccepted = () => {
      setFriendsRefreshTrigger((n) => n + 1); };

    // friend:list_updated is sent after accept — also refresh
    const onListUpdated = () => {
      setFriendsRefreshTrigger((n) => n + 1); };

    channel.bind(EVENTS.FRIEND_REQUEST_NEW, onNewRequest);
    channel.bind(EVENTS.FRIEND_REQUEST_ACCEPTED, onAccepted);
    channel.bind(EVENTS.FRIEND_REQUEST_REJECTED, onRejected);
    channel.bind(EVENTS.FRIEND_LIST_UPDATED, onListUpdated);
    return () => {
      channel.unbind(EVENTS.FRIEND_REQUEST_NEW, onNewRequest);
      channel.unbind(EVENTS.FRIEND_REQUEST_ACCEPTED, onAccepted);
      channel.unbind(EVENTS.FRIEND_REQUEST_REJECTED, onRejected);
      channel.unbind(EVENTS.FRIEND_LIST_UPDATED, onListUpdated); }; }, [user?.id]);

  // Track activeTab in a ref so the global-chat handler below doesn't need it as a dependency
  useEffect(() => { activeTabRef.current = activeTab; }, [activeTab]);

  // Reset unread counts when the user opens the respective tab
  useEffect(() => {
    if (activeTab === "global") setGlobalUnread(0);
    if (activeTab === "private") {
      setPrivateUnread(0);
      clearPrivateUnread(); // also clear the tab bar badge
    }
    if (activeTab === "friends") {
      setIncomingFriendRequests([]); // clear local request badge
      void markRequestsSeen(); // mark DB as seen + clear tab bar badge
    }
  }, [activeTab, clearPrivateUnread, markRequestsSeen]);

  // Count incoming global messages when user is NOT on Global tab
  useEffect(() => {
    const channel = subscribeToChannel(CHANNELS.GLOBAL_CHAT);
    if (!channel) return;
    const onMsg = (msg: { userId?: string }) => {
      if (activeTabRef.current !== "global" && msg.userId !== user?.id) {
        setGlobalUnread((n) => n + 1); } };
    channel.bind(EVENTS.CHAT_NEW_MESSAGE, onMsg);
    return () => { channel.unbind(EVENTS.CHAT_NEW_MESSAGE, onMsg); }; }, [user?.id]);

  const handleOpenPrivateChat = (friend: FriendItem) => {
    setPendingPrivateFriend(friend);
    setActiveTab("private"); };

  return (
    <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
    <View style={[cStyles.container, { backgroundColor: colors.background, paddingBottom: tabBarHeight }]}>
      {/* KAV must be the FIRST child so its frame.origin.y = 0 in parent coords,
          matching the keyboard.screenY coordinate origin and fixing the overlap math. */}
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior="padding"
        keyboardVerticalOffset={0}
      >
        <View
          style={[cStyles.header, { paddingTop: safeTop + 12, backgroundColor: colors.background }]}
          onLayout={(e) => setHeaderHeight(e.nativeEvent.layout.height + getSafeTop(insets.top))}
        >
          <Text style={[cStyles.headerTitle, { color: colors.foreground }]}>Chat</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={cStyles.tabScroll} contentContainerStyle={cStyles.tabRow}>
            {TABS.map((tab) => {
              const isActive = activeTab === tab.key;
              const accent = TAB_ACCENTS[tab.key];
              const badge = tab.key === "global" ? globalUnread : tab.key === "private" ? privateUnread : incomingFriendRequests.length;
              return (
                <TouchableOpacity
                  key={tab.key}
                  style={[cStyles.tabBtn, isActive
                    ? { backgroundColor: accent + "1A", borderColor: accent, shadowColor: accent, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.55, shadowRadius: 8, elevation: 6 }
                    : { backgroundColor: colors.card, borderColor: colors.border + "60" }
                  ]}
                  onPress={() => setActiveTab(tab.key)}
                >
                  <Feather name={tab.icon as never} size={13} color={isActive ? accent : colors.mutedForeground} />
                  <Text style={[cStyles.tabBtnText, { color: isActive ? accent : colors.mutedForeground, fontWeight: isActive ? "700" : "500" }]}>{tab.label}</Text>
                  {badge > 0 && (
                    <View style={[cStyles.tabDot, { backgroundColor: isActive ? accent : "#EF4444" }]}>
                      <Text style={cStyles.tabDotText}>{badge > 9 ? "9+" : badge}</Text>
                    </View>
                  )}
                </TouchableOpacity>
              ); })}
          </ScrollView>
        </View>

        {/* ── Banner Ad — shown below the Chat heading / tab pills ── */}
        <BannerAdView style={{ paddingVertical: 4 }} />

        {activeTab === "global" && <GlobalChatTab colors={colors} insets={insets} user={user} headerHeight={headerHeight} />}
        {activeTab === "private" && (
          <PrivateChatTab
            colors={colors}
            insets={insets}
            user={user}
            headerHeight={headerHeight}
            pendingFriend={pendingPrivateFriend}
            initialConversationId={paramConversationId ?? null}
            onUnreadCountChange={setPrivateUnread}
            unfriendedConv={unfriendedConv}
            onUnfriendHandled={() => setUnfriendedConv(null)}
            onUnfriend={(fid, cid) => setUnfriendedConv({ friendId: fid, conversationId: cid })}
          />
        )}
        {activeTab === "friends" && (
          <FriendsTab
            colors={colors}
            insets={insets}
            onOpenPrivateChat={handleOpenPrivateChat}
            incomingRequests={incomingFriendRequests}
            refreshTrigger={friendsRefreshTrigger}
            onUnfriend={(fid, cid) => setUnfriendedConv({ friendId: fid, conversationId: cid })}
            highlightUserId={paramSenderUserId ?? null}
          />
        )}
      </KeyboardAvoidingView>
    </View>
    </TouchableWithoutFeedback>
  ); }

// ── Styles ────────────────────────────────────────────────────────────────────

const cStyles = StyleSheet.create({
  container: { flex: 1 },
  header: { paddingHorizontal: rs(20), paddingBottom: 8, zIndex: 10 },
  headerTitle: { fontSize: rf(26), fontWeight: "800", letterSpacing: -0.5, marginBottom: 10 },
  tabScroll: { flexGrow: 0, marginBottom: 4 },
  tabRow: { gap: 6, paddingBottom: 4 },
  tabBtn: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: rs(12), paddingVertical: rs(7), borderRadius: 20, borderWidth: 1 },
  tabBtnText: { fontSize: rf(13), fontWeight: "600" },
  tabDot: { borderRadius: 8, paddingHorizontal: 5, paddingVertical: 1, minWidth: 16, alignItems: "center" },
  tabDotText: { fontSize: rf(9), fontWeight: "900", color: "#fff" },
  onlineBar: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: rs(16), paddingVertical: rs(8), borderBottomWidth: StyleSheet.hairlineWidth },
  onlineDot: { width: 7, height: 7, borderRadius: 4 },
  onlineText: { fontSize: rf(12), fontWeight: "500" },
  msgList: { paddingHorizontal: rs(14), paddingVertical: rs(10), gap: 2 },
  msgRow: { flexDirection: "row", marginBottom: 10, gap: 8, alignItems: "flex-end" },
  msgRowMe: { justifyContent: "flex-end" },
  msgRowThem: { justifyContent: "flex-start" },
  msgMeta: { flexDirection: "row", alignItems: "center", gap: 4, marginBottom: 3 },
  msgUsername: { fontSize: rf(12), fontWeight: "700" },
  msgFlag: { fontSize: rf(12) },
  bubble: { borderRadius: 18, paddingHorizontal: rs(14), paddingVertical: rs(10) },
  bubbleText: { fontSize: rf(15), lineHeight: 20 },
  msgTime: { fontSize: rf(10), marginTop: 3, paddingHorizontal: 4 },
  inputBar: { flexDirection: "row", gap: 4, alignItems: "flex-end", paddingHorizontal: rs(10), paddingTop: rs(10), borderTopWidth: 1 },
  chatInput: { flex: 1, borderRadius: 20, borderWidth: 1, paddingHorizontal: rs(14), paddingVertical: rs(8), fontSize: rf(15), minHeight: rs(44), maxHeight: 140 },
  sendBtn: { width: rs(44), height: rs(44), borderRadius: rs(22), alignItems: "center", justifyContent: "center" },
  emojiBtn: { width: rs(36), height: rs(36), borderRadius: rs(18), alignItems: "center", justifyContent: "center" },
  listPad: { paddingHorizontal: rs(16), paddingTop: 12 },
  friendRow: { flexDirection: "row", alignItems: "center", gap: 12, borderRadius: 14, borderWidth: 1, padding: rs(14), marginBottom: 8 },
  neonCard: { flexDirection: "row", alignItems: "center", gap: 12, borderRadius: 16, borderWidth: 1, borderColor: "transparent", padding: rs(14), marginBottom: 10, shadowColor: "#6366F1", shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.1, shadowRadius: 8, elevation: 2 },
  friendNameRow: { flexDirection: "row", alignItems: "center", gap: 5 },
  friendName: { fontSize: rf(14), fontWeight: "700" },
  friendLastMsg: { fontSize: rf(12), marginTop: 2 },
  friendStatus: { fontSize: rf(12), marginTop: 2, fontWeight: "500" },
  actionChip: { paddingHorizontal: rs(10), paddingVertical: rs(7), borderRadius: 10, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  actionChipText: { fontSize: rf(12), fontWeight: "600" },
  iconBtn: { width: rs(32), height: rs(32), borderRadius: 10, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  emptyBox: { alignItems: "center", gap: 12, paddingTop: 60 },
  emptyText: { fontSize: rf(14), textAlign: "center", lineHeight: 20, maxWidth: 260 },
  emptyHint: { fontSize: rf(13), textAlign: "center", paddingVertical: 12 },
  reqBtns: { flexDirection: "row", gap: 8 },
  reqBtn: { width: rs(34), height: rs(34), borderRadius: 10, alignItems: "center", justifyContent: "center" },
  dmHeader: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: rs(16), paddingVertical: rs(12), borderBottomWidth: 1 },
  dmName: { fontSize: rf(15), fontWeight: "700" },
  dmSub: { fontSize: rf(12), fontWeight: "500" },
  dmFlag: { fontSize: rf(18) },
  unreadBadge: { position: "absolute", top: -4, right: -4, width: rs(17), height: rs(17), borderRadius: rs(9), alignItems: "center", justifyContent: "center" },
  unreadText: { fontSize: rf(9), fontWeight: "800", color: "#fff" },
  sectionHeader: { flexDirection: "row", alignItems: "center", gap: 8, paddingBottom: 10, borderBottomWidth: 1, marginBottom: 10 },
  sectionTitle: { fontSize: rf(15), fontWeight: "700" },
  sectionCount: { fontSize: rf(13) },
  countBadge: { borderRadius: 10, paddingHorizontal: 7, paddingVertical: 2 },
  countBadgeText: { fontSize: rf(11), fontWeight: "800", color: "#fff" }, });

const pStyles = StyleSheet.create({
  profileModal: { flex: 1 },
  profileHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: rs(20), paddingTop: 20, paddingBottom: rs(16), borderBottomWidth: 1 },
  profileTitle: { fontSize: rf(20), fontWeight: "700" },
  profileBody: { paddingHorizontal: rs(24), paddingTop: rs(24), gap: 16, paddingBottom: 40 },
  profileCenter: { alignItems: "center", gap: 8 },
  profileUsername: { fontSize: rf(22), fontWeight: "800" },
  profileFlag: { fontSize: rf(22) },
  profileActions: { flexDirection: "row", gap: 10 },
  profileActionBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: 14, paddingVertical: rs(14) },
  profileActionText: { fontSize: rf(15), fontWeight: "700" },
  profileDangerRow: { flexDirection: "row", gap: 10 },
  dangerBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: 14, paddingVertical: rs(12) },
  dangerBtnText: { fontSize: rf(14), fontWeight: "600" }, });
