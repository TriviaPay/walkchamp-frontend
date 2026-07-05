import { LinearGradient } from "expo-linear-gradient";
import { BlueShoe } from "@/components/BlueShoe";
import { router, useLocalSearchParams } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Animated,
  Dimensions,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View} from "react-native";
import { AppAlert } from "@/components/AppAlert";
import { Image } from "expo-image";
import { useSafeLayout } from "@/hooks/useSafeLayout";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { authFetch } from "@/utils/authFetch";
import { useAuth } from "@/context/AuthContext";
import { connectPusher, subscribeToChannel, CHANNELS, EVENTS } from "@/services/realtimeService";
import { TouchableOpacity } from '@/components/HapticTouchableOpacity';
import { useMicPass } from "@/hooks/useMicPass";


export const REACTION_EMOJIS = ["🔥", "👏", "👑", "🏃", "🏆", "😮"] as const;
export type ReactionEmoji = (typeof REACTION_EMOJIS)[number];

export interface LiveRaceComment {
  id: string;
  username: string;
  countryFlag: string;
  avatarColor: string;
  text: string;
  timestamp: string; }

interface RacePlayer {
  id: string;
  userId: string;
  username: string;
  countryFlag: string;
  avatarColor: string;
  currentSteps: number;
  targetSteps: number;
  rank: number;
  isHost: boolean; }

interface WinnerEntry {
  username: string;
  avatarColor: string;
  countryFlag: string;
  rank: number;
  steps: number;
  prizeCents: number; }

interface LiveRace {
  id: string;
  title: string;
  entryType: string;
  entryAmountCents: number;
  targetSteps: number;
  maxPlayers: number;
  playerCount: number;
  prizePool: number;
  spectatorCount: number;
  startedAt: string | null;
  status: string;
  elapsedSeconds: number;
  players: RacePlayer[];
  reactionCounts: Record<string, number>; }

export function formatElapsed(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s > 0 ? `${m}m ${s}s` : `${m}m`; }

function entryTypeLabel(amountCents: number): string {
  if (amountCents === 0) return "Free";
  const dollars = amountCents / 100;
  return `$${dollars % 1 === 0 ? dollars.toFixed(0) : dollars.toFixed(2)}`; }

async function fetchRaceDetail(id: string): Promise<LiveRace | null> {
  try {
    const res = await authFetch(`/api/races/${id}`);
    if (!res.ok) return null;
    const data = await res.json();
    const room = data.race;
    const participants: Array<{
      id: string; userId?: string; username: string; countryFlag: string; avatarColor: string;
      currentSteps: number; rank: number | null; isHost: boolean; }> = data.participants ?? [];
    const sorted = [...participants].sort((a, b) => b.currentSteps - a.currentSteps);
    const totalPoolCents = room.entryAmountCents * room.currentPlayers;
    return {
      id: room.id,
      title: room.title,
      entryType: entryTypeLabel(room.entryAmountCents),
      entryAmountCents: room.entryAmountCents,
      targetSteps: room.targetSteps,
      maxPlayers: room.maxPlayers,
      playerCount: room.currentPlayers,
      prizePool: totalPoolCents / 100,
      spectatorCount: room.spectatorCount ?? 0,
      startedAt: room.startedAt ?? null,
      status: room.status,
      elapsedSeconds: room.startedAt
        ? Math.floor((Date.now() - new Date(room.startedAt).getTime()) / 1000)
        : 0,
      players: sorted.map((p, i) => ({
        id: p.id,
        userId: p.userId ?? p.id,
        username: p.username,
        countryFlag: p.countryFlag ?? "🌍",
        avatarColor: p.avatarColor ?? "#00E676",
        currentSteps: p.currentSteps,
        targetSteps: room.targetSteps,
        rank: p.rank ?? i + 1,
        isHost: p.isHost, })),
      reactionCounts: {}, }; } catch {
    return null; } }

const { height: SCREEN_H } = Dimensions.get("window");
const SHEET_H = Math.round(SCREEN_H * 0.6);

const EXTRA_COMMENTS: Omit<LiveRaceComment, "id">[] = [
  { username: "race_king_v", countryFlag: "🇺🇸", avatarColor: "#00E676", text: "Incredible pace! 🔥", timestamp: "just now" },
  { username: "walk_fan_k", countryFlag: "🇰🇷", avatarColor: "#FFD700", text: "Top 3 is so close!!", timestamp: "just now" },
  { username: "champ_watcher", countryFlag: "🇬🇧", avatarColor: "#00B4FF", text: "Who's winning this? 👑", timestamp: "just now" },
  { username: "stride_lover", countryFlag: "🇮🇳", avatarColor: "#FF6B35", text: "Legends only 🏆", timestamp: "just now" },
  { username: "pace_spy", countryFlag: "🇫🇷", avatarColor: "#A855F7", text: "Getting intense!!! 😮", timestamp: "just now" },
  { username: "globalwalker9", countryFlag: "🇦🇺", avatarColor: "#34D399", text: "Amazing race everyone 👏", timestamp: "just now" },
  { username: "fast_fan_r", countryFlag: "🇧🇷", avatarColor: "#F472B6", text: "The finish is near 🏃", timestamp: "just now" },
  { username: "step_addict", countryFlag: "🇩🇪", avatarColor: "#60A5FA", text: "Come on!! Almost there!", timestamp: "just now" },
];

interface FloatingReaction {
  id: string;
  emoji: string;
  x: number;
  anim: Animated.Value; }

// Each ticker row — colored left accent + tinted row background + per-user color
function TickerRow({ comment }: { comment: LiveRaceComment }) {
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(6)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 300, useNativeDriver: true }),
      Animated.timing(translateY, { toValue: 0, duration: 300, useNativeDriver: true }),
    ]).start(); }, []);

  return (
    <Animated.View style={[styles.tickerRow, { opacity, transform: [{ translateY }] }]}>
      {/* Per-user colored left accent bar */}
      <View style={[styles.tickerAccentBar, { backgroundColor: comment.avatarColor }]} />
      {/* Tinted content area */}
      <View style={[styles.tickerContent, { backgroundColor: comment.avatarColor + "14" }]}>
        <View style={[styles.tickerAvatar, { backgroundColor: comment.avatarColor + "35", borderColor: comment.avatarColor }]}>
          <Text style={[styles.tickerAvatarText, { color: comment.avatarColor }]}>
            {comment.username[0].toUpperCase()}
          </Text>
        </View>
        <Text style={styles.tickerLine} numberOfLines={1}>
          <Text style={[styles.tickerUsername, { color: comment.avatarColor }]}>{comment.username} </Text>
          <Text style={styles.tickerFlag}>{comment.countryFlag} </Text>
          <Text style={styles.tickerMsg}>{comment.text}</Text>
        </Text>
      </View>
    </Animated.View>
  ); }

export default function SpectatorScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const colors = useColors();
  const { insets, safeTop, safeBottom } = useSafeLayout();
  const { user } = useAuth();
  const [race, setRace] = useState<LiveRace | null>(null);
  const [comments, setComments] = useState<LiveRaceComment[]>([]);
  const [commentText, setCommentText] = useState("");
  const [floatingReactions, setFloatingReactions] = useState<FloatingReaction[]>([]);
  const [friendStatusMap, setFriendStatusMap] = useState<Record<string, "none" | "sent" | "received" | "friends">>({});

  const loadFriendStatus = useCallback(async (players: RacePlayer[]) => {
    if (!user?.id) return;
    const playerIds = [...new Set(players.map((p) => p.userId).filter((uid) => uid && uid !== user?.id))];
    if (playerIds.length === 0) return;
    try {
      const res = await authFetch(`/api/friends/status?userIds=${playerIds.join(",")}`);
      if (res.ok) {
        const data = await res.json();
        const incoming: Record<string, string> = data.status ?? {};
        setFriendStatusMap((prev) => {
          const updated = { ...prev };
          for (const [uid, newStatus] of Object.entries(incoming)) {
            const current = prev[uid] ?? "none";
            if (newStatus === "none" && (current === "sent" || current === "received" || current === "friends")) {
              continue; }
            updated[uid] = newStatus as "none" | "sent" | "received" | "friends"; }
          return updated; }); } } catch {} }, [user?.id]);

  const handleAddFriend = async (targetUserId: string, username: string) => {
    if (!targetUserId) {
      AppAlert.alert("Error", "Cannot identify this player. Please reload the screen.");
      return; }
    const status = friendStatusMap[targetUserId] ?? "none";
    if (status === "friends") return;
    if (status === "sent") {
      AppAlert.alert("Request pending", `Your friend request to @${username} is already pending.`);
      return; }
    if (status === "received") {
      AppAlert.alert("Friend Request", `@${username} already sent you a request — accept it in Chat → Friends.`);
      return; }
    setFriendStatusMap((prev) => ({ ...prev, [targetUserId]: "sent" }));
    try {
      const res = await authFetch(`/api/friends/request`, {
        method: "POST",
        body: JSON.stringify({ targetUserId }),
      });
      if (!res.ok && res.status !== 409) {
        setFriendStatusMap((prev) => ({ ...prev, [targetUserId]: "none" }));
        const body = await res.json().catch(() => ({}));
        AppAlert.alert("Error", `Could not send request (${res.status}): ${(body as { error?: string }).error ?? "unknown error"}`);
        return; }
      // Re-fetch authoritative status but never downgrade an already-optimistic "sent"
      const statusRes = await authFetch(`/api/friends/status?userIds=${encodeURIComponent(targetUserId)}`).catch(() => null);
      if (statusRes?.ok) {
        const statusData = await statusRes.json();
        const incoming: Record<string, string> = statusData.status ?? {};
        setFriendStatusMap((prev) => {
          const updated = { ...prev };
          for (const [uid, ns] of Object.entries(incoming)) {
            const cur = prev[uid] ?? "none";
            if (ns === "none" && (cur === "sent" || cur === "received" || cur === "friends")) continue;
            updated[uid] = ns as "none" | "sent" | "received" | "friends"; }
          return updated; }); } else {
        setFriendStatusMap((prev) => ({ ...prev, [targetUserId]: "sent" })); } } catch (err) {
      setFriendStatusMap((prev) => ({ ...prev, [targetUserId]: "none" }));
      AppAlert.alert("Network error", err instanceof Error ? err.message : "Could not reach the server. Check your connection."); } };
  const [reactionCounts, setReactionCounts] = useState<Record<string, number>>({});
  const [showTicker, setShowTicker] = useState(true);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [endingRace, setEndingRace] = useState(false);
  const [winners, setWinners] = useState<WinnerEntry[] | null>(null);
  const [autoCountdown, setAutoCountdown] = useState<number | null>(null);
  const autoCompletedRef = useRef(false);
  const sheetAnim = useRef(new Animated.Value(SHEET_H)).current;
  const sheetScrollRef = useRef<ScrollView>(null);

  const isLive = race?.status === "in_progress";
  const {
    notifyRaceStarted,
    disconnectVoice,
    locallyMutedUserIds,
    activeSpeakerIds,
    mutedParticipantIds,
  } = useMicPass(id);
  const visibleSpeakerIds = activeSpeakerIds.filter(
    (uid) => !mutedParticipantIds.includes(uid) && !locallyMutedUserIds.includes(uid),
  );

  useEffect(() => {
    if (isLive) notifyRaceStarted();
  }, [isLive, notifyRaceStarted]);

  useEffect(() => {
    if (!isLive) disconnectVoice();
  }, [isLive, disconnectVoice]);

  // Determine if the current user is the host — computed early so effects can use it
  const amHost = race?.players.some((p) => p.isHost && p.username === user?.username) ?? false;

  // Initial fetch
  useEffect(() => {
    if (!id) return;
    fetchRaceDetail(id).then((data) => {
      if (data) {
        setRace(data);
        setReactionCounts(data.reactionCounts);
        void loadFriendStatus(data.players); } }); }, [id, loadFriendStatus]);

  // Poll every 5s to refresh step counts and player order from backend
  useEffect(() => {
    if (!id) return;
    const interval = setInterval(() => {
      fetchRaceDetail(id).then((data) => {
        if (!data) return;
        setRace((prev) => {
          if (!prev) return data;
          if (prev.status === "completed") return prev; // keep locally-frozen steps
          return {
            ...data,
            elapsedSeconds: prev.elapsedSeconds,
            spectatorCount: Math.max(prev.spectatorCount, data.spectatorCount),
            reactionCounts: prev.reactionCounts, }; }); }); }, 5000);
    return () => clearInterval(interval); }, [id]);

  // Live race progress simulation — stops automatically once race is completed
  useEffect(() => {
    if (!race) return;
    const interval = setInterval(() => {
      setRace((prev) => {
        if (!prev || prev.status === "completed") return prev; // frozen once complete
        return {
          ...prev,
          elapsedSeconds: prev.elapsedSeconds + 2,
          spectatorCount: prev.spectatorCount + Math.floor(Math.random() * 3),
          players: prev.players
            .map((p) => ({ ...p, currentSteps: Math.min(p.targetSteps, p.currentSteps + Math.floor(Math.random() * 6) + 1) }))
            .sort((a, b) => b.currentSteps - a.currentSteps)
            .map((p, i) => ({ ...p, rank: i + 1 })), }; }); }, 2000);
    return () => clearInterval(interval); }, [race?.id]);

  // Pusher: subscribe to private-user channel for friend status updates
  useEffect(() => {
    if (!user?.id) return;
    const channel = subscribeToChannel(CHANNELS.privateUser(user.id));
    if (!channel) return;
    const handleSent = (data: { targetUserId: string }) => {
      if (data?.targetUserId) setFriendStatusMap((prev) => ({ ...prev, [data.targetUserId]: "sent" })); };
    const handleAccepted = () => { if (race) void loadFriendStatus(race.players); };
    channel.bind(EVENTS.FRIEND_REQUEST_SENT, handleSent);
    channel.bind(EVENTS.FRIEND_REQUEST_ACCEPTED, handleAccepted);
    return () => {
      channel.unbind(EVENTS.FRIEND_REQUEST_SENT, handleSent);
      channel.unbind(EVENTS.FRIEND_REQUEST_ACCEPTED, handleAccepted); }; }, [user?.id, race, loadFriendStatus]);

  // Pusher: subscribe to race:completed and race:winners
  useEffect(() => {
    if (!id) return;
    connectPusher();
    const channel = subscribeToChannel(CHANNELS.liveRace(id));
    if (!channel) return;

    const onCompleted = () => {
      // Freeze steps at current locally-simulated values; just mark as completed
      setRace((prev) => prev ? { ...prev, status: "completed" } : prev); };

    const onWinners = (data: { winners: WinnerEntry[] }) => {
      setWinners(data.winners ?? []); };

    channel.bind("race:completed", onCompleted);
    channel.bind("race:winners", onWinners);
    return () => {
      channel.unbind("race:completed", onCompleted);
      channel.unbind("race:winners", onWinners); }; }, [id]);

  // Auto-complete is handled by the backend (90s timer on /start).
  // Host can still end early via the End Race button.

  // Auto comments
  useEffect(() => {
    if (!race) return;
    let idx = 0;
    const interval = setInterval(() => {
      const src = EXTRA_COMMENTS[idx % EXTRA_COMMENTS.length];
      const newComment: LiveRaceComment = { ...src, id: `auto_${Date.now()}_${Math.random()}` };
      setComments((prev) => [newComment, ...prev.slice(0, 79)]);
      idx++; }, 3500);
    return () => clearInterval(interval); }, [race?.id]);

  const handleReaction = (emoji: string) => {
    setReactionCounts((prev) => ({ ...prev, [emoji]: (prev[emoji] ?? 0) + 1 }));
    const rid = Date.now().toString();
    const anim = new Animated.Value(0);
    const x = Math.random() * 200 + 40;
    setFloatingReactions((prev) => [...prev, { id: rid, emoji, x, anim }]);
    Animated.timing(anim, { toValue: 1, duration: 1400, useNativeDriver: true }).start(() => {
      setFloatingReactions((prev) => prev.filter((r) => r.id !== rid)); }); };

  const handleSend = () => {
    const text = commentText.trim();
    if (!text || text.length > 200) return;
    const newComment: LiveRaceComment = {
      id: Date.now().toString(),
      username: "you",
      countryFlag: "🌍",
      avatarColor: "#00E676",
      text,
      timestamp: "just now", };
    setComments((prev) => [newComment, ...prev.slice(0, 79)]);
    setCommentText("");
    setTimeout(() => sheetScrollRef.current?.scrollTo({ y: 0, animated: true }), 80); };

  const openSheet = () => {
    setSheetOpen(true);
    Animated.spring(sheetAnim, { toValue: 0, useNativeDriver: true, damping: 22, stiffness: 220 }).start(); };

  const closeSheet = () => {
    Animated.timing(sheetAnim, { toValue: SHEET_H, duration: 260, useNativeDriver: true }).start(() =>
      setSheetOpen(false)
    ); };

  const handleEndRace = async () => {
    if (!id || endingRace) return;
    setEndingRace(true);
    await authFetch(`/api/races/${id}/force-complete`, { method: "POST" }).catch(() => null);
    setEndingRace(false);
    router.back(); };

  if (!race) {
    return (
      <View style={[styles.container, { backgroundColor: colors.background, alignItems: "center", justifyContent: "center" }]}>
        <Text style={{ color: colors.mutedForeground }}>Loading race...</Text>
      </View>
    ); }

  const rankColors = [colors.gold, colors.silver, colors.bronze];
  const entryColor: Record<string, string> = { Free: colors.accent, "$1": colors.primary, "$3": colors.accent, "$5": colors.gold };
  const ec = entryColor[race.entryType] ?? colors.primary;
  const isPaid = race.entryAmountCents > 0;
  const pool = race.prizePool;
  const prizePool = pool;
  const playerCount = race.playerCount;
  const nWinners = playerCount <= 2 ? 1 : playerCount === 3 ? 2 : 3;
  const rawSplits = nWinners === 1 ? [1.0] : nWinners === 2 ? [0.6, 0.4] : [0.5, 0.3, 0.2];
  const prizeByRank = rawSplits.map((s) => parseFloat((prizePool * s).toFixed(2)));
  const prizeCardDefs = [
    { medal: "🥇", label: "1st Place" },
    { medal: "🥈", label: "2nd Place" },
    { medal: "🥉", label: "3rd Place" },
  ].slice(0, nWinners);

  // Latest 3 comments for the ticker
  const tickerComments = comments.slice(0, 3);

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: colors.background }]}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      keyboardVerticalOffset={0}
    >
      {/* Floating reaction emojis */}
      <View style={styles.floatLayer} pointerEvents="none">
        {floatingReactions.map((fr) => (
          <Animated.Text
            key={fr.id}
            style={[
              styles.floatEmoji,
              {
                left: fr.x,
                bottom: safeBottom + 130,
                opacity: fr.anim.interpolate({ inputRange: [0, 0.8, 1], outputRange: [1, 0.8, 0] }),
                transform: [{ translateY: fr.anim.interpolate({ inputRange: [0, 1], outputRange: [0, -220] }) }], },
            ]}
          >
            {fr.emoji}
          </Animated.Text>
        ))}
      </View>

      {/* ── Header ── */}
      <View style={[styles.header, { paddingTop: safeTop + 10 }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Feather name="arrow-left" size={22} color={colors.foreground} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={[styles.headerTitle, { color: colors.foreground }]} numberOfLines={1}>
            {race.title}
          </Text>
          <View style={styles.headerMeta}>
            <View style={styles.livePill}>
              <View style={styles.liveDot} />
              <Text style={styles.liveText}>LIVE</Text>
            </View>
            <Text style={[styles.timerText, { color: colors.mutedForeground }]}>{formatElapsed(race.elapsedSeconds)}</Text>
            <Text style={[styles.spectText, { color: colors.mutedForeground }]}>
              {race.spectatorCount.toLocaleString()} watching
            </Text>
          </View>
        </View>
      </View>

      {/* ── Info + Prize section ── */}
      <View style={[styles.infoSection, { backgroundColor: colors.card, borderColor: colors.border }]}>
        {/* Row 1: target + reward pool inline */}
        <View style={styles.infoRow}>
          <BlueShoe size={16} />
          <Text style={[styles.infoStepsValue, { color: colors.foreground }]}>
            {race.targetSteps.toLocaleString()}
          </Text>
          <Text style={[styles.infoStepsLabel, { color: colors.mutedForeground }]}>steps target</Text>
          {isPaid && pool > 0 && (
            <View style={{ marginLeft: "auto", flexDirection: "row", alignItems: "center", gap: 4 }}>
              <Text style={{ fontSize: 11, color: colors.mutedForeground }}>💰 Pool</Text>
              <Text style={{ fontSize: 13, fontWeight: "800", color: colors.gold }}>${pool.toFixed(2)}</Text>
            </View>
          )}
        </View>

        {/* Row 2: prize cards (paid only) */}
        {isPaid && (
          <>
            <View style={[styles.prizeDivider, { backgroundColor: colors.border }]} />
            <View style={styles.prizeCardsRow}>
              {prizeCardDefs.map((item, idx) => (
                <View key={item.label} style={[styles.prizeCard, { backgroundColor: colors.background, borderColor: colors.border }]}>
                  <Text style={styles.prizeMedalEmoji}>{item.medal}</Text>
                  <Text style={[styles.prizeCardAmount, { color: colors.gold }]}>${(prizeByRank[idx] ?? 0).toFixed(2)}</Text>
                  <Text style={[styles.prizeCardLabel, { color: colors.mutedForeground }]}>{item.label}</Text>
                </View>
              ))}
            </View>
          </>
        )}
      </View>

      {/* ── Scrollable body: leaderboard (up to 10) + live chat ticker ── */}
      <ScrollView
        style={styles.flex}
        contentContainerStyle={{ paddingHorizontal: 12, paddingTop: 8, paddingBottom: 12 }}
        showsVerticalScrollIndicator={false}
      >
        <Text style={[styles.sectionLabel, { color: colors.foreground }]}>Live Leaderboard</Text>
        <View style={{ gap: 7 }}>
          {race.players.slice(0, 10).map((p, i) => {
            const pct = Math.min((p.currentSteps / p.targetSteps) * 100, 100);
            const isWinner = i < nWinners;
            const isTop3 = i < 3;
            const rc = rankColors[i] ?? colors.mutedForeground;
            const medals = ["🥇", "🥈", "🥉"];
            const prizeAmt = isPaid && isWinner && prizeByRank[i] !== undefined && prizeByRank[i] > 0 ? prizeByRank[i] : null;
            return (
              <View
                key={p.id}
                style={[
                  styles.playerCard,
                  { backgroundColor: colors.card, borderColor: isTop3 ? rc + "40" : colors.border },
                ]}
              >
                {/* Rank badge */}
                {isTop3 ? (
                  <Text style={styles.rankMedal}>{medals[i]}</Text>
                ) : (
                  <View style={[styles.rankCircle, { backgroundColor: colors.muted }]}>
                    <Text style={[styles.rankNum, { color: colors.mutedForeground }]}>#{i + 1}</Text>
                  </View>
                )}

                {/* Avatar */}
                <View style={[styles.pAvatar, { backgroundColor: p.avatarColor + "20", borderColor: p.avatarColor }]}>
                  <Text style={[styles.pAvatarText, { color: p.avatarColor }]}>
                    {p.username.charAt(0).toUpperCase()}
                  </Text>
                </View>

                {/* Name + progress */}
                <View style={styles.pInfo}>
                  <View style={styles.pNameRow}>
                    <Text style={[styles.pName, { color: colors.foreground }]} numberOfLines={1}>
                      {p.username}
                    </Text>
                    <Text style={styles.pFlag}>{p.countryFlag}</Text>
                    {p.isHost && (
                      <View style={[styles.playerTag, { backgroundColor: "#FFB70022", borderColor: "#FFB70055" }]}>
                        <Text style={[styles.playerTagText, { color: "#FFB700" }]}>Host</Text>
                      </View>
                    )}
                    {user?.username && p.username === user.username && (
                      <View style={[styles.playerTag, { backgroundColor: colors.primary + "20", borderColor: colors.primary + "50" }]}>
                        <Text style={[styles.playerTagText, { color: colors.primary }]}>You</Text>
                      </View>
                    )}
                    {visibleSpeakerIds.includes(p.userId) && (
                      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: "#A3E635" }} />
                    )}
                  </View>
                  <View style={[styles.progressTrack, { backgroundColor: colors.border }]}>
                    <LinearGradient
                      colors={isTop3 ? [rc, rc + "88"] : [p.avatarColor, p.avatarColor + "66"]}
                      style={[styles.progressFill, { width: `${pct}%` }]}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 0 }}
                    />
                  </View>
                </View>

                {/* Steps + prize */}
                <View style={styles.pRightCol}>
                  <View style={styles.pStepsRow}>
                    <BlueShoe size={13} />
                    <Text style={[styles.pSteps, { color: isTop3 ? rc : colors.foreground }]}>
                      {p.currentSteps.toLocaleString()}
                    </Text>
                  </View>
                  {prizeAmt !== null && (
                    <View style={[styles.prizeBadge, { backgroundColor: colors.gold + "18", borderColor: colors.gold + "40" }]}>
                      <Text style={[styles.prizeBadgeText, { color: colors.gold }]}>{medals[i]} ${prizeAmt.toFixed(2)}</Text>
                    </View>
                  )}
                </View>

                {/* Add Friend btn */}
                {!(user?.username && p.username === user.username) && (() => {
                  const fs = friendStatusMap[p.userId] ?? "none";
                  if (fs === "friends") return (
                    <View style={[styles.followBtn, { backgroundColor: colors.primary + "10", borderColor: colors.primary + "30" }]}>
                      <Feather name="user-check" size={14} color={colors.primary} />
                    </View>
                  );
                  if (fs === "sent") return (
                    <View style={[styles.followBtn, { backgroundColor: colors.warning + "10", borderColor: colors.warning + "40" }]}>
                      <Feather name="clock" size={14} color={colors.warning} />
                    </View>
                  );
                  if (fs === "received") return (
                    <TouchableOpacity
                      style={[styles.followBtn, { backgroundColor: colors.accent + "15", borderColor: colors.accent + "50" }]}
                      onPress={() => handleAddFriend(p.userId, p.username)}
                    >
                      <Feather name="user-check" size={14} color={colors.accent} />
                    </TouchableOpacity>
                  );
                  return (
                    <TouchableOpacity
                      style={[styles.followBtn, { backgroundColor: colors.muted, borderColor: colors.border }]}
                      onPress={() => handleAddFriend(p.userId, p.username)}
                    >
                      <Text style={[styles.followBtnText, { color: colors.mutedForeground }]}>+</Text>
                    </TouchableOpacity>
                  ); })()}
              </View>
            ); })}
        </View>

      </ScrollView>

      {/* ── Live comment ticker ── */}
      {showTicker && tickerComments.length > 0 && (
        <View style={[styles.tickerOuter, { borderTopColor: colors.primary, borderColor: colors.border }]}>
          <LinearGradient
            colors={[colors.primary + "18", colors.card]}
            style={StyleSheet.absoluteFill}
            start={{ x: 0, y: 0 }}
            end={{ x: 0, y: 1 }}
          />
          <View style={styles.tickerHeader}>
            <View style={[styles.liveChatPill, { backgroundColor: "#FF444422", borderColor: "#FF444450" }]}>
              <View style={styles.liveDotSmall} />
              <Text style={styles.liveTextSmall}>LIVE CHAT</Text>
            </View>
            <Text style={[styles.tickerCommentCount, { color: colors.mutedForeground }]}>
              {comments.length} comments
            </Text>
            <TouchableOpacity onPress={openSheet} style={styles.tickerOpenBtn} activeOpacity={0.7}>
              <Text style={[styles.tickerOpenText, { color: colors.primary }]}>View all</Text>
              <Feather name="chevron-up" size={13} color={colors.primary} />
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setShowTicker(false)} style={styles.tickerCloseBtn}>
              <Feather name="eye-off" size={14} color={colors.mutedForeground} />
            </TouchableOpacity>
          </View>
          <View style={styles.tickerRows}>
            {tickerComments.map((c) => (
              <TickerRow key={c.id} comment={c} />
            ))}
          </View>
        </View>
      )}

      {/* ── End Race button (testing only — host only) ── */}
      {amHost && race.status !== "completed" && (
        <TouchableOpacity
          onPress={handleEndRace}
          disabled={endingRace}
          activeOpacity={0.8}
          style={[styles.endRaceBtn, { backgroundColor: "#FF444415", borderColor: "#FF444440", opacity: endingRace ? 0.5 : 1 }]}
        >
          <Feather name="flag" size={15} color="#FF4444" />
          <Text style={styles.endRaceBtnText}>
            {endingRace
              ? "Ending…"
              : autoCountdown !== null && autoCountdown > 0
                ? `Auto-ends in ${autoCountdown}s`
                : "End Race (Test)"}
          </Text>
        </TouchableOpacity>
      )}

      {/* ── Winner announcement overlay ── */}
      {winners !== null && (
        <View style={styles.winnersOverlay}>
          <View style={[styles.winnersCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.winnersTrophy]}>🏆</Text>
            <Text style={[styles.winnersTitleText, { color: colors.foreground }]}>Race Finished!</Text>
            {isPaid && (
              <Text style={[styles.winnersSubText, { color: colors.gold }]}>
                Total Pool: ${pool.toFixed(2)} · Prize Pool: ${prizePool.toFixed(2)}
              </Text>
            )}
            <View style={styles.winnersList}>
              {winners.map((w) => {
                const medals = ["🥇", "🥈", "🥉"];
                const rc = rankColors[w.rank - 1] ?? colors.mutedForeground;
                return (
                  <View key={w.rank} style={[styles.winnerRow, { borderColor: rc + "30" }]}>
                    <Text style={styles.winnerMedal}>{medals[w.rank - 1] ?? `#${w.rank}`}</Text>
                    <View style={[styles.winnerAvatar, { backgroundColor: w.avatarColor + "25", borderColor: w.avatarColor }]}>
                      <Text style={[styles.winnerAvatarText, { color: w.avatarColor }]}>{w.username.charAt(0).toUpperCase()}</Text>
                    </View>
                    <View style={styles.winnerInfo}>
                      <Text style={[styles.winnerName, { color: colors.foreground }]}>{w.username} {w.countryFlag}</Text>
                      <Text style={[styles.winnerSteps, { color: colors.mutedForeground }]}>{w.steps.toLocaleString()} steps</Text>
                    </View>
                    {w.prizeCents > 0 && (
                      <Text style={[styles.winnerPrize, { color: colors.gold }]}>${(w.prizeCents / 100).toFixed(2)}</Text>
                    )}
                  </View>
                ); })}
            </View>
            <TouchableOpacity
              style={[styles.winnersCloseBtn, { backgroundColor: colors.primary }]}
              onPress={() => { setWinners(null); router.back(); }}
            >
              <Text style={styles.winnersCloseBtnText}>Back to Live</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Show-ticker button when ticker is hidden */}
      {!showTicker && (
        <TouchableOpacity
          onPress={() => setShowTicker(true)}
          style={[styles.showTickerBtn, { backgroundColor: colors.card, borderColor: colors.border }]}
          activeOpacity={0.8}
        >
          <View style={styles.liveDotSmall} />
          <Text style={[styles.showTickerText, { color: colors.primary }]}>Show live chat</Text>
        </TouchableOpacity>
      )}

      {/* ── Bottom bar: reactions + input ── */}
      <View
        style={[
          styles.bottomBar,
          { backgroundColor: colors.background, borderColor: colors.border, paddingBottom: safeBottom + 8 },
        ]}
      >
        {/* Reaction row */}
        <View style={styles.reactRow}>
          {REACTION_EMOJIS.map((emoji) => (
            <TouchableOpacity key={emoji} onPress={() => handleReaction(emoji)} style={styles.reactBtn} activeOpacity={0.7}>
              <Text style={styles.reactEmoji}>{emoji}</Text>
              <Text style={[styles.reactCount, { color: colors.mutedForeground }]}>
                {(reactionCounts[emoji] ?? 0) > 999 ? "999+" : String(reactionCounts[emoji] ?? 0)}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* Input row */}
        <View style={styles.inputRow}>
          <TextInput
            style={[styles.input, { color: colors.foreground, backgroundColor: colors.card, borderColor: colors.border }]}
            placeholder="Comment on race..."
            placeholderTextColor={colors.mutedForeground}
            value={commentText}
            onChangeText={(t) => setCommentText(t.slice(0, 200))}
            returnKeyType="send"
            onSubmitEditing={handleSend}
          />
          <TouchableOpacity
            onPress={openSheet}
            style={[styles.iconBtn, { backgroundColor: colors.muted, borderColor: colors.border }]}
            activeOpacity={0.8}
          >
            <Feather name="message-square" size={17} color={colors.mutedForeground} />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={handleSend}
            style={[styles.sendBtn, { backgroundColor: commentText.trim() ? colors.primary : colors.muted }]}
            activeOpacity={0.8}
          >
            <Feather name="send" size={16} color={commentText.trim() ? "#000" : colors.mutedForeground} />
          </TouchableOpacity>
        </View>
      </View>

      {/* ── Comments bottom sheet ── */}
      {sheetOpen && (
        <>
          <TouchableOpacity style={styles.sheetBackdrop} activeOpacity={1} onPress={closeSheet} />
          <Animated.View
            style={[
              styles.sheet,
              { backgroundColor: colors.card, borderColor: colors.border, height: SHEET_H },
              { transform: [{ translateY: sheetAnim }] },
            ]}
          >
            <View style={[styles.sheetHandle, { backgroundColor: colors.border }]} />
            <View style={[styles.sheetHeader, { borderColor: colors.border }]}>
              <View style={styles.sheetTitleRow}>
                <Text style={[styles.sheetTitle, { color: colors.foreground }]}>Live Comments</Text>
                <View style={styles.livePillSmall}>
                  <View style={styles.liveDotSmall} />
                  <Text style={styles.liveTextSmall}>{comments.length}</Text>
                </View>
              </View>
              <TouchableOpacity onPress={closeSheet} style={styles.sheetCloseBtn}>
                <Feather name="x" size={20} color={colors.mutedForeground} />
              </TouchableOpacity>
            </View>

            <ScrollView
              ref={sheetScrollRef}
              style={styles.flex}
              contentContainerStyle={{ padding: 12, gap: 8 }}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
            >
              {comments.map((c) => (
                <View key={c.id} style={styles.commentRow}>
                  <View style={[styles.cAvatar, { backgroundColor: c.avatarColor + "20", borderColor: c.avatarColor }]}>
                    <Text style={[styles.cAvatarText, { color: c.avatarColor }]}>
                      {c.username.charAt(0).toUpperCase()}
                    </Text>
                  </View>
                  <View style={[styles.cBubble, { backgroundColor: colors.background, borderColor: colors.border }]}>
                    <View style={styles.cMeta}>
                      <Text style={[styles.cUsername, { color: colors.primary }]}>{c.username}</Text>
                      <Text style={styles.cFlag}>{c.countryFlag}</Text>
                      <Text style={[styles.cTime, { color: colors.mutedForeground }]}>{c.timestamp}</Text>
                    </View>
                    <Text style={[styles.cText, { color: colors.foreground }]}>{c.text}</Text>
                  </View>
                </View>
              ))}
            </ScrollView>

            <View style={[styles.sheetInputBar, { borderColor: colors.border, paddingBottom: safeBottom + 8 }]}>
              <TextInput
                style={[styles.input, { color: colors.foreground, backgroundColor: colors.background, borderColor: colors.border }]}
                placeholder="Comment on race..."
                placeholderTextColor={colors.mutedForeground}
                value={commentText}
                onChangeText={(t) => setCommentText(t.slice(0, 200))}
                returnKeyType="send"
                onSubmitEditing={handleSend}
              />
              <TouchableOpacity
                onPress={handleSend}
                style={[styles.sendBtn, { backgroundColor: commentText.trim() ? colors.primary : colors.muted }]}
                activeOpacity={0.8}
              >
                <Feather name="send" size={16} color={commentText.trim() ? "#000" : colors.mutedForeground} />
              </TouchableOpacity>
            </View>
          </Animated.View>
        </>
      )}
    </KeyboardAvoidingView>
  ); }

const styles = StyleSheet.create({
  container: { flex: 1 },
  flex: { flex: 1 },

  floatLayer: { position: "absolute", left: 0, right: 0, bottom: 0, top: 0, zIndex: 50, pointerEvents: "none" },
  floatEmoji: { position: "absolute", fontSize: 28 },

  // Header
  header: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 16, paddingBottom: 10 },
  backBtn: { width: 38, height: 38, alignItems: "center", justifyContent: "center" },
  headerCenter: { flex: 1, gap: 3 },
  headerTitle: { fontSize: 15, fontWeight: "800" },
  headerMeta: { flexDirection: "row", alignItems: "center", gap: 8 },
  livePill: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "#FF000020", borderRadius: 8, paddingHorizontal: 7, paddingVertical: 3, borderWidth: 1, borderColor: "#FF000040" },
  liveDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: "#FF4444" },
  liveText: { fontSize: 10, fontWeight: "800", color: "#FF4444", letterSpacing: 0.5 },
  timerText: { fontSize: 12 },
  spectText: { fontSize: 12 },
  poolBadge: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 10, borderWidth: 1 },
  poolText: { fontSize: 13, fontWeight: "800" },

  // Info + Prize section
  infoSection: { paddingHorizontal: 14, paddingVertical: 10, borderTopWidth: 1, borderBottomWidth: 1, gap: 10 },
  infoRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  infoStepsEmoji: { fontSize: 16 },
  infoStepsValue: { fontSize: 16, fontWeight: "800" },
  infoStepsLabel: { fontSize: 13 },
  entryPill: { paddingHorizontal: 9, paddingVertical: 3, borderRadius: 8, borderWidth: 1 },
  entryText: { fontSize: 11, fontWeight: "700" },
  prizeDivider: { height: 1 },
  prizeHeaderRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  prizePoolEmoji: { fontSize: 16 },
  prizePoolLabel: { fontSize: 13 },
  prizePoolAmount: { fontSize: 18, fontWeight: "900", marginLeft: 2 },
  prizeCardsRow: { flexDirection: "row", gap: 6 },
  prizeCard: { flex: 1, alignItems: "center", borderRadius: 10, borderWidth: 1, paddingVertical: 6, paddingHorizontal: 4, gap: 2 },
  prizeMedalEmoji: { fontSize: 16 },
  prizeCardAmount: { fontSize: 13, fontWeight: "900" },
  prizeCardLabel: { fontSize: 9, fontWeight: "600" },

  // Leaderboard
  sectionLabel: { fontSize: 15, fontWeight: "700", marginBottom: 8 },
  playerCard: { flexDirection: "row", alignItems: "center", gap: 8, borderRadius: 14, borderWidth: 1, padding: 10 },
  rankMedal: { fontSize: 26, width: 34, textAlign: "center" },
  rankCircle: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  rankNum: { fontSize: 11, fontWeight: "800" },
  pAvatar: { width: 32, height: 32, borderRadius: 16, borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
  pAvatarText: { fontSize: 12, fontWeight: "800" },
  pInfo: { flex: 1, gap: 5 },
  pNameRow: { flex: 1, flexDirection: "row", alignItems: "center", gap: 5 },
  pName: { fontSize: 12, fontWeight: "600", flexShrink: 1 },
  pFlag: { fontSize: 13 },
  progressTrack: { height: 4, borderRadius: 2, overflow: "hidden" },
  progressFill: { height: "100%", borderRadius: 2 },
  pRightCol: { alignItems: "flex-end", gap: 4 },
  pStepsRow: { flexDirection: "row", alignItems: "center", gap: 3 },
  pStepsEmoji: { fontSize: 12 },
  pSteps: { fontSize: 13, fontWeight: "800" },
  prizeBadge: { borderRadius: 8, borderWidth: 1, paddingHorizontal: 7, paddingVertical: 3 },
  prizeBadgeText: { fontSize: 11, fontWeight: "800" },
  followBtn: { width: 28, height: 28, borderRadius: 14, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  followBtnText: { fontSize: 14, fontWeight: "800" },
  playerTag: { borderRadius: 6, borderWidth: 1, paddingHorizontal: 5, paddingVertical: 1 },
  playerTagText: { fontSize: 9, fontWeight: "800" },
  endRaceBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, marginHorizontal: 12, marginVertical: 6, borderRadius: 10, borderWidth: 1, paddingVertical: 10 },
  endRaceBtnText: { fontSize: 13, fontWeight: "700", color: "#FF4444" },
  // Winner overlay
  winnersOverlay: { position: "absolute", left: 0, right: 0, top: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.85)", zIndex: 200, alignItems: "center", justifyContent: "center", paddingHorizontal: 20 },
  winnersCard: { width: "100%", borderRadius: 20, borderWidth: 1, padding: 20, alignItems: "center", gap: 12 },
  winnersTrophy: { fontSize: 48 },
  winnersTitleText: { fontSize: 22, fontWeight: "900" },
  winnersSubText: { fontSize: 13, fontWeight: "700", textAlign: "center" },
  winnersList: { width: "100%", gap: 8 },
  winnerRow: { flexDirection: "row", alignItems: "center", gap: 10, borderRadius: 12, borderWidth: 1, padding: 10 },
  winnerMedal: { fontSize: 22, width: 30, textAlign: "center" },
  winnerAvatar: { width: 34, height: 34, borderRadius: 17, borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
  winnerAvatarText: { fontSize: 13, fontWeight: "800" },
  winnerInfo: { flex: 1, gap: 2 },
  winnerName: { fontSize: 14, fontWeight: "700" },
  winnerSteps: { fontSize: 12 },
  winnerPrize: { fontSize: 15, fontWeight: "900" },
  winnersCloseBtn: { borderRadius: 12, paddingHorizontal: 32, paddingVertical: 12, marginTop: 4 },
  winnersCloseBtnText: { fontSize: 15, fontWeight: "800", color: "#000" },

  // Live comment ticker
  tickerOuter: { borderTopWidth: 2, borderWidth: 0, borderBottomWidth: 1, paddingHorizontal: 12, paddingTop: 8, paddingBottom: 8, overflow: "hidden" },
  tickerHeader: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 },
  liveChatPill: { flexDirection: "row", alignItems: "center", gap: 5, borderRadius: 10, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 3 },
  tickerCommentCount: { fontSize: 11 },
  tickerOpenBtn: { flexDirection: "row", alignItems: "center", gap: 3, marginLeft: "auto" },
  tickerOpenText: { fontSize: 11, fontWeight: "700" },
  tickerCloseBtn: { padding: 3, marginLeft: 4 },
  tickerRows: { gap: 4 },
  tickerRow: { flexDirection: "row", borderRadius: 9, overflow: "hidden" },
  tickerAccentBar: { width: 3, flexShrink: 0 },
  tickerContent: { flex: 1, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 9, paddingVertical: 7 },
  tickerAvatar: { width: 24, height: 24, borderRadius: 12, borderWidth: 1.5, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  tickerAvatarText: { fontSize: 10, fontWeight: "800" },
  tickerLine: { flex: 1, fontSize: 13, lineHeight: 18 },
  tickerUsername: { fontWeight: "800", fontSize: 13 },
  tickerFlag: { fontSize: 12 },
  tickerMsg: { fontWeight: "400", color: "#FFFFFF", fontSize: 13 },
  showTickerBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 14, paddingVertical: 8, borderTopWidth: 1 },
  showTickerText: { fontSize: 12, fontWeight: "700" },

  // Shared live pill (small)
  livePillSmall: { flexDirection: "row", alignItems: "center", gap: 4 },
  liveDotSmall: { width: 5, height: 5, borderRadius: 3, backgroundColor: "#FF4444" },
  liveTextSmall: { fontSize: 11, color: "#FF4444", fontWeight: "700", letterSpacing: 0.4 },

  // Bottom bar
  bottomBar: { borderTopWidth: 1, paddingTop: 6, paddingHorizontal: 12, gap: 6 },
  reactRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-around" },
  reactBtn: { alignItems: "center", gap: 1, minWidth: 36 },
  reactEmoji: { fontSize: 20 },
  reactCount: { fontSize: 9 },
  inputRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  input: { flex: 1, borderRadius: 20, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 9, fontSize: 14 },
  iconBtn: { width: 38, height: 38, borderRadius: 19, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  sendBtn: { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center" },

  // Bottom sheet
  sheetBackdrop: { position: "absolute", left: 0, right: 0, top: 0, bottom: 0, backgroundColor: "rgba(0,0,0,0.5)", zIndex: 90 },
  sheet: { position: "absolute", left: 0, right: 0, bottom: 0, borderTopLeftRadius: 24, borderTopRightRadius: 24, borderTopWidth: 1, borderLeftWidth: 1, borderRightWidth: 1, zIndex: 91, overflow: "hidden" },
  sheetHandle: { width: 36, height: 4, borderRadius: 2, alignSelf: "center", marginTop: 10, marginBottom: 6 },
  sheetHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingBottom: 10, borderBottomWidth: 1 },
  sheetTitleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  sheetTitle: { fontSize: 16, fontWeight: "800" },
  sheetCloseBtn: { width: 34, height: 34, alignItems: "center", justifyContent: "center" },
  sheetInputBar: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingTop: 8, borderTopWidth: 1 },

  // Comment rows (in sheet)
  commentRow: { flexDirection: "row", gap: 8 },
  cAvatar: { width: 28, height: 28, borderRadius: 14, borderWidth: 1.5, alignItems: "center", justifyContent: "center" },
  cAvatarText: { fontSize: 11, fontWeight: "800" },
  cBubble: { flex: 1, borderRadius: 12, borderWidth: 1, padding: 9, gap: 3 },
  cMeta: { flexDirection: "row", alignItems: "center", gap: 5 },
  cUsername: { fontSize: 12, fontWeight: "700" },
  cFlag: { fontSize: 11 },
  cTime: { fontSize: 10, marginLeft: "auto" },
  cText: { fontSize: 13, lineHeight: 18 }, });
