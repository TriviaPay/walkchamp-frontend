import { AnimatedTrackOverlay } from "@/components/race/AnimatedTrackOverlay";
import { getTrackCalibration, type TrackCalibration } from "@/components/race/trackCalibrations";
import { LinearGradient } from "expo-linear-gradient";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ImageBackground,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View} from "react-native";
import { AppAlert } from "@/components/AppAlert";
import { useSafeLayout } from "@/hooks/useSafeLayout";
import { useTabBarHeight } from "@/hooks/useTabBarHeight";
import { Feather } from "@expo/vector-icons";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  withRepeat,
  withSequence,
  cancelAnimation, } from "react-native-reanimated";
import { useAuth } from "@/context/AuthContext";
import { authFetch } from "@/utils/authFetch";
import {
  CHANNELS,
  EVENTS,
  connectPusher,
  subscribeToChannel,
  unsubscribeFromChannel, } from "@/services/realtimeService";
import { STORAGE_KEYS, storageGet } from "@/utils/storage";
import { TouchableOpacity } from '@/components/HapticTouchableOpacity';
import { rf, rs } from "@/utils/responsive";

const TRACK_BACKGROUNDS = {
  bg: require("../../assets/images/bg.png"),
  bg1: require("../../assets/images/bg1.png"),
  galaxy: require("../../assets/images/galaxy.jpeg"),
  daylightStadium: require("../../assets/images/daylightStadium.jpeg"),
  forest: require("../../assets/images/forest.jpeg"),
  city: require("../../assets/images/city.jpeg"),
  lava:       require("../../assets/images/lava.jpeg"),
  ice:        require("../../assets/images/ice.jpeg"),
  candy:      require("../../assets/images/candy.jpeg"),
  farm:       require("../../assets/images/farm.jpeg"),
  underwater: require("../../assets/images/underwater.jpeg"),
  musicfest:  require("../../assets/images/musicfest.jpeg"),
  // ── New themes ──────────────────────────────────────────────────────────────
  barbie:       require("../../assets/images/track_barbie.png"),
  desert:       require("../../assets/images/track_desert.png"),
  gold:         require("../../assets/images/track_gold.png"),
  nightforest:  require("../../assets/images/track_nightforest.png"),
  skykingdom:   require("../../assets/images/track_skykingdom.png"),
  rain:         require("../../assets/images/track_rain.png"),
  storm:        require("../../assets/images/track_storm.png"),
  mountain:     require("../../assets/images/track_mountain.png"),
  waterfall:    require("../../assets/images/track_waterfall.png"),
  webcity:      require("../../assets/images/track_webcity.png"),
  bridge:       require("../../assets/images/track_bridge.png"),
  newyork:      require("../../assets/images/track_newyork.png"),
  pirateisland: require("../../assets/images/track_pirateisland.png"),
  paradise:     require("../../assets/images/track_paradise.png"),
  musicfest2:   require("../../assets/images/track_musicfest2.png"),
  // ── Premium race-track skins ────────────────────────────────────────────────
  chocolate:    require("../../assets/images/track_chocolate.png"),
  fireworks:    require("../../assets/images/track_fireworks.png"),
  moon:         require("../../assets/images/track_moon.png"),
  rainbow_road: require("../../assets/images/track_rainbow_road.png"),
  runway:       require("../../assets/images/track_runway.png"),
  toy_race:     require("../../assets/images/track_toy_race.png"),
  water_park:   require("../../assets/images/track_water_park.png"), } as const;
type TrackLayoutId = keyof typeof TRACK_BACKGROUNDS;
const DEFAULT_TARGET_STEPS = 500;
const REACTIONS = ["🔥", "👏", "👑", "🏃", "🏆", "😮"];
const FALLBACK_COLORS = ["#FFD700", "#C0C0C0", "#00E676", "#FF8C00", "#A855F7", "#00B4FF", "#FF5C93", "#35D0BA", "#F97316", "#8B5CF6"];

interface RaceData {
  id: string;
  title: string;
  status: string;
  entryType: string;
  entryAmountCents: number;
  entryAmountDollars?: number;
  targetSteps: number;
  currentPlayers: number;
  maxPlayers: number;
  startedAt: string | null;
  completedAt: string | null;
  challengeEndAt: string | null;
  creatorId: string;
  prizePool?: number;
  prizeTiers?: number[];
  spectatorCount?: number;
  trackLayout?: string; }

interface RaceParticipant {
  id: string;
  userId: string;
  currentSteps: number;
  status: string | null;
  rank: number | null;
  username: string;
  countryFlag: string | null;
  avatarColor: string | null;
  isHost: boolean; }

interface RaceComment {
  id: string;
  userId: string;
  username: string;
  countryFlag: string;
  avatarColor: string;
  text: string;
  createdAt: string; }

interface ReactionCount {
  emoji: string;
  count: number; }

interface Player {
  id: string;
  userId: string;
  rank: number;
  name: string;
  steps: number;
  isMe: boolean;
  rankColor: string;
  initial: string;
  country?: string;
  isHost?: boolean; }

interface TrackPoint {
  x: number;
  y: number; }

function fmtTime(seconds: number) {
  const safe = Math.max(0, Math.floor(seconds));
  return `${Math.floor(safe / 60).toString().padStart(2, "0")}:${(safe % 60).toString().padStart(2, "0")}`; }

function formatSteps(n: number): string {
  if (n < 1000) return n.toLocaleString();
  const k = Math.round((n / 1000) * 10) / 10;
  return `${k % 1 === 0 ? k.toFixed(0) : k}k`; }

function normalizeCounts(counts: ReactionCount[]) {
  return counts.reduce<Record<string, number>>((acc, item) => {
    acc[item.emoji] = item.count;
    return acc; }, {}); }

type RaceCommentPayload = Partial<RaceComment> & {
  comment?: Partial<RaceComment>;
  timestamp?: string; };

function normalizeIncomingComment(payload: RaceCommentPayload): RaceComment | null {
  const raw = payload.comment ?? payload;
  if (!raw.id || !raw.text) return null;
  return {
    id: raw.id,
    userId: raw.userId ?? "",
    username: raw.username ?? "Runner",
    countryFlag: raw.countryFlag ?? "",
    avatarColor: raw.avatarColor ?? "#00E676",
    text: raw.text,
    createdAt: raw.createdAt ?? new Date().toISOString(), }; }

function appendUniqueComment(prev: RaceComment[], comment: RaceComment) {
  if (prev.some((item) => item.id === comment.id)) return prev;
  return [...prev, comment].slice(-60); }

// ── Per-track calibrated positioning helpers ───────────────────────────────
// All three helpers now accept a TrackCalibration so every track's visual
// start/finish lines and lane boundaries are respected.

function laneBoundaryX(
  boundaryIndex: number,
  y: number,
  width: number,
  height: number,
  cal: TrackCalibration,
) {
  const bottomLeft  = width  * cal.bottomLeftPercent;
  const bottomRight = width  * cal.bottomRightPercent;
  const topLeft     = width  * cal.topLeftPercent;
  const topRight    = width  * cal.topRightPercent;
  // Extend slightly beyond the avatar range so perspective is smooth at edges
  const topY    = height * Math.max(0,   cal.finishYPercent - 0.06);
  const bottomY = height * Math.min(1.0, cal.startYPercent  + 0.04);
  const t = Math.min(Math.max((y - topY) / (bottomY - topY), 0), 1);
  const left  = topLeft  + (bottomLeft  - topLeft)  * t;
  const right = topRight + (bottomRight - topRight)  * t;
  return left + ((right - left) / 10) * boundaryIndex;
}

function laneCenterX(
  laneIndex: number,
  y: number,
  width: number,
  height: number,
  cal: TrackCalibration,
) {
  return (
    laneBoundaryX(laneIndex,     y, width, height, cal) +
    laneBoundaryX(laneIndex + 1, y, width, height, cal)
  ) / 2;
}

/**
 * Convert a [0,1] progress value to pixel coordinates using the calibrated
 * start/finish positions for the active track theme.
 *
 * progress = 0  → avatar at startY  (visual start line, bottom of road)
 * progress = 1  → avatar at finishY (visual finish line, top of road) — EXACT
 */
function sampleTrack(progress: number, width: number, height: number, cal: TrackCalibration) {
  const clamped  = Math.min(Math.max(progress, 0), 1);
  const startY   = height * cal.startYPercent;
  const finishY  = height * cal.finishYPercent;
  // Linear interpolation: 0% → startY, 100% → finishY exactly
  const y = startY + (finishY - startY) * clamped;
  return {
    x:     width * 0.5,
    y,
    angle: -90,
    depth: 0.82 + clamped * 0.2,
  };
}

function RunnerMarker({
  player,
  index,
  width,
  height,
  targetSteps,
  calibration,
  rsFactor = 1, }: {
  player: Player;
  index: number;
  width: number;
  height: number;
  targetSteps: number;
  calibration: TrackCalibration;
  rsFactor?: number; }) {
  const rs = (n: number) => Math.round(n * rsFactor);
  const progress = Math.min(player.steps / Math.max(targetSteps, 1), 1);
  const completedGoal = player.steps >= targetSteps;
  const point = sampleTrack(progress, width, height, calibration);
  const laneIndex = Math.min(Math.max(player.rank - 1, 0), 9);
  const baseSize = player.isMe ? rs(43) : rs(34);
  const size = baseSize * point.depth;

  // FINISH LOCK: once a player hits the goal, pin the avatar.
  // Standard themes: pin 5 px below the hero top.
  // Mountain (finishYPercent > 0.1): pin at the calibrated finish gate position
  // so the avatar aligns with the visual FINISH gate in the mountain image.
  const FINISH_GAP = 5;
  const useCalibratedFinishLock = calibration.finishYPercent > 0.1;
  const calibratedFinishY = height * calibration.finishYPercent;
  let y: number;
  if (completedGoal) {
    y = useCalibratedFinishLock ? calibratedFinishY : size / 2 + FINISH_GAP;
  } else {
    const floorY = size / 2 + FINISH_GAP;
    y = Math.max(floorY, point.y + (index % 2 === 0 ? -4 : 4));
  }
  const x = laneCenterX(laneIndex, y, width, height, calibration);

  if (__DEV__) {
    const startY = height * calibration.startYPercent;
    const finishY = height * calibration.finishYPercent;
    console.log(
      `[RaceTrack] trackHeight: ${Math.round(height)} | ` +
      `startY: ${Math.round(startY)} | finishY: ${Math.round(finishY)} | ` +
      `currentRaceSteps: ${player.steps} | targetSteps: ${targetSteps} | ` +
      `progress: ${(progress * 100).toFixed(1)}% | avatarY: ${Math.round(y)} | ` +
      `completedGoal: ${completedGoal}`,
    );
  }
  const labelLeft = laneIndex >= 7;
  const trailW = rs(14);
  const trailH = rs(46);
  const rankBadgeSize = rs(18);

  return (
    <View
      style={[
        st.runner,
        {
          left: x - size / 2,
          top: y - size / 2, },
      ]}
    >
      <View style={[st.runnerTrail, { width: trailW, height: trailH, top: size * 0.45, backgroundColor: `${player.rankColor}30`, shadowColor: player.rankColor }]} />
      <View
        style={[
          st.runnerAvatar,
          {
            width: size,
            height: size,
            borderRadius: size / 2,
            borderColor: player.isMe ? "#00E676" : player.rankColor,
            borderWidth: player.isMe ? 3 : 2,
            backgroundColor: "#060914E8",
            shadowColor: player.isMe ? "#00E676" : player.rankColor, },
        ]}
      >
        <Text style={[st.runnerInitial, { color: player.isMe ? "#00E676" : player.rankColor, fontSize: rs(14) }]}>
          {player.initial}
        </Text>
        <View style={[st.runnerRank, { backgroundColor: player.rankColor, width: rankBadgeSize, height: rankBadgeSize, borderRadius: rankBadgeSize / 2, top: -rankBadgeSize / 2, right: -rankBadgeSize / 2 }]}>
          <Text style={[st.runnerRankText, { fontSize: rs(9) }]}>{player.rank}</Text>
        </View>
      </View>
      <View
        style={[
          st.runnerLabel,
          labelLeft ? { right: size + 4 } : { left: size + 4 },
        ]}
      >
        <Text style={[st.runnerName, { color: player.isMe ? "#00E676" : "#FFFFFF", fontSize: rs(10) }]} numberOfLines={1}>
          {player.isMe ? "You" : player.name}{player.isHost ? " HOST" : ""}
        </Text>
        <Text style={[st.runnerSteps, { fontSize: rs(9) }]}>{formatSteps(player.steps)} steps</Text>
      </View>
    </View>
  ); }

function LeaderboardOverlay({
  visible,
  players,
  width,
  height,
  animatedStyle,
  positionText,
  statusText,
  rsFactor = 1, }: {
  visible: boolean;
  players: Player[];
  width: number;
  height: number;
  animatedStyle: object;
  positionText: string;
  statusText: string;
  rsFactor?: number; }) {
  const rs = (n: number) => Math.round(n * rsFactor);
  const avatarSize = rs(32);
  const badgeSize = rs(20);
  return (
    <Animated.View pointerEvents={visible ? "auto" : "none"} style={[st.lbOverlay, { width, height }, animatedStyle]}>
      <View style={st.lbHead}>
        <View style={st.lbHeadText}>
          <Text style={[st.lbTitle, { fontSize: Math.max(8, rs(9)) }]}>TRACK POSITION</Text>
          <Text style={[st.lbPosition, { fontSize: rs(13) }]}>{positionText}</Text>
        </View>
        <View style={st.lbStatusPill}>
          <View style={st.lbDot} />
          <Text style={[st.lbStatusText, { fontSize: Math.max(7, rs(8)) }]}>{statusText}</Text>
        </View>
      </View>
      <ScrollView showsVerticalScrollIndicator={false}>
        {players.length === 0 ? (
          <View style={st.lbEmpty}>
            <Text style={[st.lbEmptyText, { fontSize: rs(10) }]}>No live runners yet</Text>
          </View>
        ) : (
          players.map((p) => (
            <View key={p.id} style={[st.lbRow, p.isMe && st.lbRowMe]}>
              <View style={[st.lbBadge, { width: badgeSize, height: badgeSize, borderRadius: badgeSize / 2, backgroundColor: `${p.rankColor}22`, borderColor: p.rankColor }]}>
                <Text style={[st.lbBadgeN, { color: p.rankColor, fontSize: rs(10) }]}>{p.rank}</Text>
              </View>
              <View style={[st.lbAvatar, { width: avatarSize, height: avatarSize, borderRadius: avatarSize / 2, borderColor: p.rankColor }]}>
                <Text style={[st.lbAvatarI, { color: p.rankColor, fontSize: rs(12) }]}>{p.initial}</Text>
              </View>
              <View style={st.lbInfo}>
                <Text style={[st.lbName, { color: p.isMe ? "#00E676" : "#fff", fontSize: rs(11) }]} numberOfLines={1}>
                  {p.isMe ? "You" : p.name}
                </Text>
                <Text style={[st.lbSteps, { fontSize: rs(13) }]}>{formatSteps(p.steps)}</Text>
                <Text style={[st.lbUnit, { fontSize: Math.max(7, rs(9)) }]}>steps</Text>
              </View>
            </View>
          ))
        )}
      </ScrollView>
    </Animated.View>
  ); }

export default function LiveTrackTab() {
  const { insets, safeTop, safeBottom } = useSafeLayout();
  const tabBarHeight = useTabBarHeight();
  const { user } = useAuth();
  const { width: screenW } = useWindowDimensions();
  const isTablet = screenW >= 768;
  // Scale UI elements proportionally: 0.87× on 320px phones, 1.0× on 390px, up to 1.5× on tablets
  const rsFactor = isTablet
    ? Math.min(1.5, screenW / 520)
    : Math.max(0.87, Math.min(1.1, screenW / 390));
  const rs = (n: number) => Math.round(n * rsFactor);
  const cheerScrollRef = useRef<ScrollView | null>(null);

  const [race, setRace] = useState<RaceData | null>(null);
  const [participants, setParticipants] = useState<RaceParticipant[]>([]);
  const [comments, setComments] = useState<RaceComment[]>([]);
  const [reactionCounts, setReactionCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const hasInitialized = useRef(false);
  const [cheerText, setCheerText] = useState("");
  const [isLeaderboardVisible, setIsLeaderboardVisible] = useState(true);
  const [showReactionPicker, setShowReactionPicker] = useState(false);
  const [trackLayoutId, setTrackLayoutId] = useState<TrackLayoutId>("bg");
  const [now, setNow] = useState(Date.now());
  // Measured via onLayout — lets the OS layout engine own the height (no manual screenH math)
  const [heroHeight, setHeroHeight] = useState(400);
  // Dev-only calibration debug overlay (tap race title 5× to toggle)
  const [debugMode, setDebugMode] = useState(false);
  const debugTapCount = useRef(0);

  const activeRaceId = race?.id ?? null;
  const isActive = race?.status === "in_progress";
  const isFinished = race?.status === "completed";
  const targetSteps = race?.targetSteps ?? DEFAULT_TARGET_STEPS;
  const trackBackground = TRACK_BACKGROUNDS[trackLayoutId];

  const progress = useSharedValue(0);
  const leaderboardProgress = useSharedValue(1);
  const pulseOpacity = useSharedValue(0);

  const loadRaceSnapshot = useCallback(async (raceId: string) => {
    const [detailRes, commentsRes, reactionsRes] = await Promise.all([
      authFetch(`/api/races/${raceId}`),
      authFetch(`/api/races/${raceId}/comments`),
      authFetch(`/api/races/${raceId}/reactions`),
    ]);

    if (detailRes.ok) {
      const detail = (await detailRes.json()) as {
        race?: RaceData;
        participants?: RaceParticipant[]; };
      setRace(detail.race ?? null);
      setParticipants(Array.isArray(detail.participants) ? detail.participants : []);
      // Apply track layout from DB — shared for all users in the race
      if (detail.race?.trackLayout && detail.race.trackLayout in TRACK_BACKGROUNDS) {
        setTrackLayoutId(detail.race.trackLayout as TrackLayoutId); } }

    if (commentsRes.ok) {
      const body = (await commentsRes.json()) as { comments?: RaceComment[] };
      setComments(Array.isArray(body.comments) ? body.comments : []); }

    if (reactionsRes.ok) {
      const body = (await reactionsRes.json()) as { reactions?: ReactionCount[] };
      setReactionCounts(Array.isArray(body.reactions) ? normalizeCounts(body.reactions) : {}); } }, []);

  const loadActiveRace = useCallback(async () => {
    setLoading(true);
    try {
      let raceId: string | null = null;
      const myActiveRes = await authFetch(`/api/races/my-active`);

      if (myActiveRes.ok) {
        const body = (await myActiveRes.json()) as { race?: { id?: string } | null };
        raceId = body.race?.id ?? null; }

      if (!raceId) {
        const liveRes = await authFetch(`/api/races?status=in_progress`);
        if (liveRes.ok) {
          const body = (await liveRes.json()) as { races?: Array<{ id: string }> };
          raceId = body.races?.[0]?.id ?? null; } }

      if (raceId) {
        await loadRaceSnapshot(raceId); } else {
        setRace(null);
        setParticipants([]);
        setComments([]);
        setReactionCounts({}); } } catch {
      setRace(null);
      setParticipants([]);
      setComments([]);
      setReactionCounts({});
    } finally {
      setLoading(false);
      hasInitialized.current = true; } }, [loadRaceSnapshot]);

  useEffect(() => {
    loadActiveRace(); }, [loadActiveRace]);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id); }, []);

  useEffect(() => {
    if (!isActive) setShowReactionPicker(false); }, [isActive]);

  useEffect(() => {
    // Reset to default when no race is active; actual layout is set by loadRaceSnapshot from DB.
    if (!activeRaceId) setTrackLayoutId("bg"); }, [activeRaceId]);

  useEffect(() => {
    leaderboardProgress.value = withTiming(isLeaderboardVisible ? 1 : 0, { duration: 260 }); }, [isLeaderboardVisible, leaderboardProgress]);

  useEffect(() => {
    if (loading) {
      pulseOpacity.value = withRepeat(
        withSequence(
          withTiming(1, { duration: 550 }),
          withTiming(0.25, { duration: 550 }),
        ),
        -1,
        false,
      ); } else {
      cancelAnimation(pulseOpacity);
      pulseOpacity.value = withTiming(0, { duration: 200 }); } }, [loading, pulseOpacity]);

  useEffect(() => {
    if (!activeRaceId) return;
    connectPusher();
    const channelName = CHANNELS.liveRace(activeRaceId);
    const channel = subscribeToChannel(channelName);
    if (!channel) return;

    const refresh = () => {
      setTimeout(() => {
        loadRaceSnapshot(activeRaceId).catch(() => {}); }, 250); };

    const onStarted = refresh;
    const onJoined = refresh;
    const onLeft = refresh;
    const onCompleted = () => {
      setRace((prev) =>
        prev ? { ...prev, status: "completed", completedAt: prev.completedAt ?? new Date().toISOString() } : prev,
      );
      refresh(); };
    const onProgress = (data: { participantId?: string; steps?: number; rank?: number }) => {
      if (!data.participantId || typeof data.steps !== "number") return;
      const nextSteps = data.steps;
      setParticipants((prev) =>
        prev.map((p) =>
          p.id === data.participantId
            ? { ...p, currentSteps: Math.max(p.currentSteps, nextSteps), rank: data.rank ?? p.rank }
            : p,
        ),
      ); };
    const onComment = (data: RaceCommentPayload) => {
      const comment = normalizeIncomingComment(data);
      if (!comment) return;
      setComments((prev) => appendUniqueComment(prev, comment));
      setTimeout(() => cheerScrollRef.current?.scrollToEnd({ animated: true }), 50); };
    const onReaction = (data: { counts?: ReactionCount[] }) => {
      if (Array.isArray(data.counts)) setReactionCounts(normalizeCounts(data.counts)); };

    channel.bind(EVENTS.RACE_STARTED, onStarted);
    channel.bind("race:player-joined", onJoined);
    channel.bind("race:player-left", onLeft);
    channel.bind("race:participant_left", onLeft);
    channel.bind(EVENTS.RACE_PROGRESS, onProgress);
    channel.bind("race:comment_new", onComment);
    channel.bind(EVENTS.RACE_COMMENT, onComment);
    channel.bind("race:reaction_updated", onReaction);
    channel.bind(EVENTS.RACE_COMPLETED, onCompleted);
    channel.bind("race:winners", refresh);

    return () => {
      channel.unbind(EVENTS.RACE_STARTED, onStarted);
      channel.unbind("race:player-joined", onJoined);
      channel.unbind("race:player-left", onLeft);
      channel.unbind("race:participant_left", onLeft);
      channel.unbind(EVENTS.RACE_PROGRESS, onProgress);
      channel.unbind("race:comment_new", onComment);
      channel.unbind(EVENTS.RACE_COMMENT, onComment);
      channel.unbind("race:reaction_updated", onReaction);
      channel.unbind(EVENTS.RACE_COMPLETED, onCompleted);
      channel.unbind("race:winners", refresh);
      unsubscribeFromChannel(channelName); }; }, [activeRaceId, loadRaceSnapshot]);

  useEffect(() => {
    connectPusher();
    const channel = subscribeToChannel(CHANNELS.PRESENCE);
    if (!channel) return;
    const onRaceStarted = () => {
      loadActiveRace().catch(() => {}); };
    channel.bind(EVENTS.RACE_STARTED, onRaceStarted);
    return () => {
      channel.unbind(EVENTS.RACE_STARTED, onRaceStarted);
      unsubscribeFromChannel(CHANNELS.PRESENCE); }; }, [loadActiveRace]);

  const sortedPlayers = useMemo(() => {
    const sorted = [...participants].sort((a, b) => b.currentSteps - a.currentSteps);
    return sorted.slice(0, 10).map<Player>((p, index) => {
      const rank = p.rank && p.rank > 0 ? p.rank : index + 1;
      const username = p.username || "Runner";
      const isMe =
        p.userId === user?.id ||
        (!!user?.username && username.toLowerCase() === user.username.toLowerCase());
      return {
        id: p.id,
        userId: p.userId,
        rank,
        name: isMe ? "You" : username,
        steps: p.currentSteps,
        isMe,
        rankColor: p.avatarColor ?? FALLBACK_COLORS[index % FALLBACK_COLORS.length],
        initial: (isMe ? "Y" : username.slice(0, 1).toUpperCase()) || "R",
        country: p.countryFlag ?? undefined,
        isHost: p.isHost, }; }).sort((a, b) => a.rank - b.rank); }, [participants, user?.id, user?.username]);

  const myPlayer = useMemo(
    () => sortedPlayers.find((p) => p.isMe) ?? sortedPlayers[0] ?? null,
    [sortedPlayers],
  );
  const currentParticipant = useMemo(
    () =>
      participants.find(
        (p) =>
          p.userId === user?.id ||
          (!!user?.username && p.username.toLowerCase() === user.username.toLowerCase()),
      ) ?? null,
    [participants, user?.id, user?.username],
  );
  const showLeaveButton =
    !!activeRaceId &&
    !!race &&
    !!currentParticipant &&
    (race?.status === "open" || race?.status === "in_progress");
  const canLeaveRace = showLeaveButton && !currentParticipant.isHost;
  const mySteps = myPlayer?.steps ?? 0;
  const myProgress = Math.min(mySteps / Math.max(targetSteps, 1), 1);

  useEffect(() => {
    progress.value = withTiming(myProgress, { duration: 900 }); }, [myProgress, progress]);

  const startedAtMs = race?.startedAt ? new Date(race.startedAt).getTime() : null;
  const elapsed = startedAtMs ? Math.max(0, Math.floor((now - startedAtMs) / 1000)) : 0;

  // Scheduled races have a real end time — show a countdown to it.
  // Instant races (goal-based) show elapsed time only; they end when winners
  // are finalized by the backend, not after a fixed duration.
  const challengeEndAtMs = race?.challengeEndAt ? new Date(race.challengeEndAt).getTime() : null;
  const isScheduledRace = !!challengeEndAtMs;
  const secondsToEnd = challengeEndAtMs ? Math.max(0, Math.floor((challengeEndAtMs - now) / 1000)) : 0;

  // ── Completion-poll safety net ─────────────────────────────────────────────
  // Poll every 3s after 60s of active time so we catch any missed Pusher event.
  // The backend no longer auto-ends at 90s; this is just a dropped-event guard.
  const shouldPollCompletion = isActive && elapsed >= 60;
  useEffect(() => {
    if (!shouldPollCompletion || !activeRaceId) return;
    const id = setInterval(() => {
      loadRaceSnapshot(activeRaceId).catch(() => {});
    }, 3000);
    return () => clearInterval(id);
  }, [shouldPollCompletion, activeRaceId, loadRaceSnapshot]);
  const raceTitle = race?.title || "LIVE WALK RACE";
  const statusLabel = isFinished ? "FINISHED" : isActive ? "LIVE" : race ? "WAITING" : "NO LIVE RACE";
  // Instant races: show elapsed time (race ends by backend when winners done).
  // Scheduled races: show countdown to challengeEndAt while active.
  const infoTimeLabel = isFinished
    ? "ELAPSED"
    : isActive
      ? isScheduledRace ? "ENDS IN" : "TIME"
      : "STATUS";
  const infoTimeValue = isFinished
    ? fmtTime(elapsed)
    : isActive
      ? isScheduledRace ? fmtTime(secondsToEnd) : fmtTime(elapsed)
      : statusLabel;
  const participantValue = race ? `${participants.length || race.currentPlayers}/${race.maxPlayers}` : "0";
  const latestCheers = useMemo(() => comments.slice(-8), [comments]);
  const trackPositionText = myPlayer ? `#${myPlayer.rank} of ${Math.max(sortedPlayers.length, participants.length || 1)}` : "Waiting";
  const trackStatusText = isFinished ? "FINISHED" : isActive ? "LIVE" : race ? "WAITING" : "NO RACE";

  const headerH = rs(48);
  const subtitleH = rs(20);
  const infoBarH = rs(56);
  const progressH = rs(66);
  const reactionH = isActive && showReactionPicker ? rs(42) : 0;
  const cheerH = rs(38);
  const bottomInset = safeBottom;
  const trackW = screenW;

  // Resolve per-track calibration — used by sampleTrack, laneBoundaryX, RunnerMarker
  const trackCalibration = getTrackCalibration(trackLayoutId);

  const handleTitleDebugTap = __DEV__
    ? () => {
        debugTapCount.current += 1;
        if (debugTapCount.current >= 5) {
          debugTapCount.current = 0;
          setDebugMode((v) => !v);
        }
      }
    : undefined;
  const leaderboardW = isTablet
    ? Math.min(280, Math.max(200, screenW * 0.30))
    : Math.min(170, Math.max(138, screenW * 0.38));

  const leaderboardWShared = useSharedValue(leaderboardW);
  useEffect(() => {
    leaderboardWShared.value = leaderboardW; }, [leaderboardW, leaderboardWShared]);

  const trackAnimatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: -8 * leaderboardProgress.value },
      { scale: 1.02 - 0.035 * leaderboardProgress.value },
    ], }));

  const leaderboardAnimatedStyle = useAnimatedStyle(() => ({
    opacity: leaderboardProgress.value,
    transform: [{ translateX: (1 - leaderboardProgress.value) * leaderboardWShared.value }], }));

  const progressBarStyle = useAnimatedStyle(() => ({
    width: `${Math.min(progress.value * 100, 100)}%`, }));

  const pulseStyle = useAnimatedStyle(() => ({
    opacity: pulseOpacity.value, }));

  const handleSendCheer = useCallback(async () => {
    if (!activeRaceId || !isActive || !cheerText.trim() || sending) return;
    const text = cheerText.trim();
    setSending(true);
    try {
      const res = await authFetch(`/api/races/${activeRaceId}/comments`, {
        method: "POST",
        body: JSON.stringify({ text }),
      });
      if (res.ok) {
        const body = (await res.json().catch(() => null)) as { comment?: RaceComment } | null;
        if (body?.comment) {
          setComments((prev) => appendUniqueComment(prev, body.comment as RaceComment));
          setTimeout(() => cheerScrollRef.current?.scrollToEnd({ animated: true }), 50); }
        setCheerText(""); } } finally {
      setSending(false); } }, [activeRaceId, cheerText, isActive, sending]);

  const leaveRace = useCallback(async () => {
    if (!activeRaceId || leaving) return;
    setLeaving(true);
    try {
      const res = await authFetch(`/api/races/${activeRaceId}/leave`, { method: "POST" });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
        AppAlert.alert("Unable to leave race", body.error ?? body.message ?? `HTTP ${res.status}`);
        return; }
      setParticipants((prev) => prev.filter((p) => p.userId !== user?.id));
      setComments([]);
      setReactionCounts({});
      setRace(null);
      await loadActiveRace(); } finally {
      setLeaving(false); } }, [activeRaceId, leaving, loadActiveRace, user?.id]);

  const handleLeaveRace = useCallback(() => {
    if (!showLeaveButton) return;
    if (!canLeaveRace) {
      AppAlert.alert("Unable to leave race", "Hosts cannot leave from this screen.");
      return; }
    AppAlert.alert("Leave race?", "The race will continue without you.", [
      { text: "Cancel", style: "cancel" },
      { text: "Leave", style: "destructive", onPress: () => void leaveRace() },
    ]); }, [canLeaveRace, leaveRace, showLeaveButton]);

  const handleReact = useCallback(async (emoji: string) => {
    if (!activeRaceId || !isActive) return;
    try {
      const res = await authFetch(`/api/races/${activeRaceId}/reactions`, {
        method: "POST",
        body: JSON.stringify({ emoji }),
      });
      if (res.ok) {
        const body = (await res.json().catch(() => null)) as { counts?: ReactionCount[] } | null;
        if (Array.isArray(body?.counts)) setReactionCounts(normalizeCounts(body.counts));
      }
    } catch { /* silent — optimistic update already applied */ }
  }, [activeRaceId, isActive]);

  return (
    <KeyboardAvoidingView
      style={st.screen}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={tabBarHeight}
    >
      <View style={[st.root, { paddingTop: safeTop, paddingBottom: tabBarHeight }]}>
        <View style={[st.header, { height: headerH }]}>
          <TouchableOpacity style={st.backBtn}>
            <Feather name="chevron-left" size={25} color="#fff" />
          </TouchableOpacity>
          <TouchableOpacity
            activeOpacity={1}
            onPress={handleTitleDebugTap}
            style={st.hCenter}
          >
            <Text style={[st.hLive, !isActive && st.hInactive, { fontSize: rs(18) }]}>{statusLabel} </Text>
            <Text style={[st.hTitle, { fontSize: rs(18) }]} numberOfLines={1}>{raceTitle.replace(/^LIVE\s+/i, "")}</Text>
            <Text style={[st.hShoe, { fontSize: rs(18) }]}> 👟</Text>
          </TouchableOpacity>
          {showLeaveButton ? (
            <TouchableOpacity disabled={leaving} onPress={handleLeaveRace} activeOpacity={0.85}>
              <LinearGradient colors={["#FF3333", "#BB0000"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={[st.leaveBtn, leaving && st.leaveBtnDisabled]}>
                <Text style={st.leaveTxt}>{leaving ? "Leaving" : "Leave"}</Text>
                <Feather name="log-out" size={12} color="#fff" style={st.leaveIcon} />
              </LinearGradient>
            </TouchableOpacity>
          ) : (
            <View style={st.headerSpacer} />
          )}
        </View>

        <View style={[st.subtitleWrap, { height: subtitleH }]}>
          <Text style={[st.subtitle, { fontSize: rs(12) }]}>Beat your friends. Hit your goal!</Text>
        </View>

        <View style={[st.infoBar, { height: infoBarH }]}>
          {[
            { icon: isActive ? "⏱" : isFinished ? "🏁" : "•", label: infoTimeLabel, value: infoTimeValue },
            { icon: "👥", label: "PARTICIPANTS", value: participantValue },
          ].map((card) => (
            <View key={card.label} style={st.infoCard}>
              <View style={st.infoRow}>
                <Text style={st.infoIcon}>{card.icon}</Text>
                <Text style={[st.infoLbl, { fontSize: Math.max(8, rs(9)) }]}>{card.label}</Text>
              </View>
              <Text style={[st.infoVal, { fontSize: rs(20) }]} numberOfLines={1}>{card.value}</Text>
            </View>
          ))}
        </View>

        <View
          style={[st.hero, { width: trackW, flex: 1, minHeight: rs(240) }]}
          onLayout={(e) => setHeroHeight(Math.max(rs(240), e.nativeEvent.layout.height))}
        >
          <Animated.View style={[StyleSheet.absoluteFill, trackAnimatedStyle]}>
            <ImageBackground
              source={trackBackground}
              resizeMode="stretch"
              fadeDuration={0}
              style={[StyleSheet.absoluteFill, trackLayoutId === "bg1" && st.bg1Background]}
            />
            <LinearGradient
              colors={["#02030A10", "#02030A00", "#02030A18"]}
              style={StyleSheet.absoluteFill}
              pointerEvents="none"
            />
            {/* ── Animated theme overlay — above bg, below avatars ── */}
            <AnimatedTrackOverlay themeCode={trackLayoutId} />

            {sortedPlayers.map((player, index) => (
              <RunnerMarker
                key={player.id}
                player={player}
                index={index}
                width={trackW}
                height={heroHeight}
                targetSteps={targetSteps}
                calibration={trackCalibration}
                rsFactor={rsFactor}
              />
            ))}

            {/* ── Dev calibration overlay — tap title 5× to toggle ── */}
            {__DEV__ && debugMode && (
              <View pointerEvents="none" style={StyleSheet.absoluteFill}>
                {/* START line */}
                <View style={[st.dbgLine, { top: heroHeight * trackCalibration.startYPercent, borderColor: "#00FF88" }]} />
                <Text style={[st.dbgLabel, { top: heroHeight * trackCalibration.startYPercent + 2 }]}>
                  START {Math.round(trackCalibration.startYPercent * 100)}%
                </Text>
                {/* FINISH line */}
                <View style={[st.dbgLine, { top: heroHeight * trackCalibration.finishYPercent, borderColor: "#FF4444" }]} />
                <Text style={[st.dbgLabel, { top: heroHeight * trackCalibration.finishYPercent + 2 }]}>
                  FINISH {Math.round(trackCalibration.finishYPercent * 100)}%
                </Text>
                {/* Lane center dots at start */}
                {Array.from({ length: 10 }, (_, i) => {
                  const startY = heroHeight * trackCalibration.startYPercent;
                  const dotX   = laneCenterX(i, startY, trackW, heroHeight, trackCalibration);
                  return (
                    <View
                      key={i}
                      style={[st.dbgDot, { left: dotX - 4, top: startY - 4 }]}
                    />
                  );
                })}
                {/* Per-player position + progress */}
                {sortedPlayers.map((player) => {
                  const prog  = Math.min(player.steps / Math.max(targetSteps, 1), 1);
                  const pt    = sampleTrack(prog, trackW, heroHeight, trackCalibration);
                  const li    = Math.min(Math.max(player.rank - 1, 0), 9);
                  const px    = laneCenterX(li, pt.y, trackW, heroHeight, trackCalibration);
                  return (
                    <Text key={player.id} style={[st.dbgInfo, { left: px, top: pt.y - 28 }]}>
                      {Math.round(prog * 100)}%
                    </Text>
                  );
                })}
                {/* Theme + dimensions */}
                <Text style={st.dbgTheme}>
                  [{trackLayoutId}] {Math.round(trackW)}×{Math.round(heroHeight)}
                </Text>
              </View>
            )}

            {/* Subtle pulsing sync indicator — non-blocking, shown only while fetching */}
            <Animated.View style={[st.syncPill, pulseStyle]} pointerEvents="none">
              <View style={st.syncDot} />
              <Text style={st.syncText}>Syncing…</Text>
            </Animated.View>

            {/* No race notice — only after first fetch completes */}
            {hasInitialized.current && !loading && !race && (
              <View style={st.trackNotice}>
                <Text style={st.trackNoticeTitle}>No live race started</Text>
                <Text style={st.trackNoticeSub}>The track will fill from backend data when a race starts.</Text>
              </View>
            )}
          </Animated.View>

          <LeaderboardOverlay
            visible={isLeaderboardVisible}
            players={sortedPlayers}
            width={leaderboardW}
            height={heroHeight}
            animatedStyle={leaderboardAnimatedStyle}
            positionText={trackPositionText}
            statusText={trackStatusText}
            rsFactor={rsFactor}
          />

          <TouchableOpacity
            activeOpacity={0.85}
            onPress={() => setIsLeaderboardVisible((visible) => !visible)}
            style={st.toggleHandle}
            accessibilityRole="button"
            accessibilityLabel={isLeaderboardVisible ? "Hide live leaderboard" : "Show live leaderboard"}
          >
            <Feather name={isLeaderboardVisible ? "chevron-right" : "chevron-left"} size={22} color="#FFFFFF" />
          </TouchableOpacity>
        </View>

        <View style={[st.progSection, { height: progressH }]}>
          <View style={st.progLeft}>
            <Text style={[st.progEmoji, { fontSize: rs(27) }]}>👟</Text>
            <View style={st.progMain}>
              <Text>
                <Text style={[st.progMine, { fontSize: rs(17) }]}>{formatSteps(mySteps)}</Text>
                <Text style={[st.progTarget, { fontSize: rs(13) }]}> / {formatSteps(targetSteps)} steps</Text>
              </Text>
              <View style={st.progBarBg}>
                <Animated.View style={[st.progBarFill, progressBarStyle]} />
              </View>
              <Text style={[st.progSub, { fontSize: Math.max(8, rs(9)) }]}>
                {myPlayer ? `Rank #${myPlayer.rank} · ${formatSteps(Math.max(0, targetSteps - mySteps))} steps to goal` : "Waiting for live race data"}
              </Text>
            </View>
            <Text style={[st.progPct, { fontSize: rs(15) }]}>{Math.round(myProgress * 100)}%</Text>
          </View>
          <View style={st.milestoneBtn}>
            <Text style={[st.milestoneIcon, { fontSize: rs(20) }]}>🎁</Text>
            <View>
              <Text style={[st.milestoneLbl, { fontSize: Math.max(8, rs(9)) }]}>Milestone</Text>
              <Text style={[st.milestoneLbl, { fontSize: Math.max(8, rs(9)) }]}>Reward</Text>
            </View>
          </View>
        </View>

        <View style={[st.cheerBar, { height: cheerH }]}>
          <Text style={[st.cheerIcon, { fontSize: rs(14) }]}>🎉</Text>
          <Text style={[st.cheerLbl, { fontSize: rs(11) }]}>Cheer feed</Text>
          <ScrollView
            ref={cheerScrollRef}
            horizontal
            showsHorizontalScrollIndicator={false}
            style={st.cheerScroll}
            contentContainerStyle={st.cheerContent}
            onContentSizeChange={() => cheerScrollRef.current?.scrollToEnd({ animated: true })}
          >
            {latestCheers.length === 0 ? (
              <Text style={st.cheerMsg}>No cheers yet</Text>
            ) : (
              latestCheers.map((cheer) => (
                <View key={cheer.id} style={st.cheerItem}>
                  <Text style={st.cheerFrom}>{cheer.username}: </Text>
                  <Text style={st.cheerMsg} numberOfLines={1}>{cheer.text}</Text>
                </View>
              ))
            )}
          </ScrollView>
        </View>

        {isActive && showReactionPicker && (
          <View style={[st.reactionBar, { height: reactionH }]}>
            {REACTIONS.map((emoji) => (
              <TouchableOpacity
                key={emoji}
                activeOpacity={0.75}
                style={st.reactionBtn}
                onPress={() => handleReact(emoji)}
              >
                <Text style={st.reactionEmoji}>{emoji}</Text>
                {(reactionCounts[emoji] ?? 0) > 0 && <Text style={st.reactionCount}>{reactionCounts[emoji]}</Text>}
              </TouchableOpacity>
            ))}
          </View>
        )}

        {isActive && (
          <View style={[st.inputBar, { paddingBottom: bottomInset }]}>
            <TouchableOpacity
              activeOpacity={0.75}
              style={[st.inputEmojiBtn, showReactionPicker && st.inputEmojiBtnActive]}
              onPress={() => setShowReactionPicker((visible) => !visible)}
              accessibilityRole="button"
              accessibilityLabel={showReactionPicker ? "Hide reactions" : "Show reactions"}
            >
              <Text style={st.inputEmoji}>🙂</Text>
            </TouchableOpacity>
            <TextInput
              style={st.inputField}
              value={cheerText}
              onChangeText={setCheerText}
              placeholder="Send a cheer..."
              placeholderTextColor="#6E7284"
              returnKeyType="send"
              onSubmitEditing={handleSendCheer}
            />
            <TouchableOpacity disabled={sending || !cheerText.trim()} onPress={handleSendCheer}>
              <LinearGradient colors={["#7C3AED", "#A855F7"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={[st.sendBtn, (sending || !cheerText.trim()) && st.sendBtnDisabled]}>
                <Text style={st.sendTxt}>Send</Text>
              </LinearGradient>
            </TouchableOpacity>
          </View>
        )}
      </View>
    </KeyboardAvoidingView>
  ); }

const st = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#050711" },
  root: { flex: 1, backgroundColor: "#050711" },

  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: rs(12) },
  backBtn: { width: rs(36), height: rs(36), alignItems: "center", justifyContent: "center" },
  headerSpacer: { width: 68 },
  hCenter: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", minWidth: 0 },
  hLive: { fontSize: rf(18), fontWeight: "900", color: "#00E676" },
  hInactive: { color: "#FFD166" },
  hTitle: { fontSize: rf(18), fontWeight: "900", color: "#FFFFFF", maxWidth: "62%" },
  hShoe: { fontSize: rf(18) },
  leaveBtn: { flexDirection: "row", alignItems: "center", paddingHorizontal: rs(12), paddingVertical: rs(7), borderRadius: 8 },
  leaveBtnDisabled: { opacity: 0.68 },
  leaveTxt: { color: "#FFFFFF", fontSize: rf(13), fontWeight: "800" },
  leaveIcon: { marginLeft: 4 },
  subtitleWrap: { alignItems: "center", justifyContent: "center" },
  subtitle: { fontSize: rf(12), color: "#8A8FA3" },

  infoBar: { flexDirection: "row", paddingHorizontal: rs(12), gap: 10, alignItems: "center" },
  infoCard: { flex: 1, backgroundColor: "#111421", borderRadius: 10, borderWidth: 1, borderColor: "#22263A", paddingHorizontal: rs(12), paddingVertical: rs(6) },
  infoRow: { flexDirection: "row", alignItems: "center", gap: 5 },
  infoIcon: { fontSize: rf(12) },
  infoLbl: { fontSize: rf(9), color: "#858A9C", fontWeight: "800", letterSpacing: 0.5 },
  infoVal: { fontSize: rf(20), fontWeight: "900", color: "#FFFFFF", marginTop: 1 },

  hero: { position: "relative", overflow: "hidden", borderTopWidth: 1, borderBottomWidth: 1, borderColor: "#171B2E", backgroundColor: "#02030A" },
  bg1Background: { transform: [{ translateY: 10 }] },
  trackNotice: {
    position: "absolute",
    left: 24,
    right: 24,
    top: "40%",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: "#050713D9",
    borderWidth: 1,
    borderColor: "#FFFFFF1C", },
  trackNoticeTitle: { color: "#FFFFFF", fontSize: rf(13), fontWeight: "900" },
  trackNoticeSub: { color: "#A9B0C7", fontSize: rf(11), marginTop: 4, textAlign: "center" },

  syncPill: {
    position: "absolute",
    bottom: 10,
    left: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: "#0D0F1AE0",
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#2A2D3E",
    paddingHorizontal: 10,
    paddingVertical: 5,
    zIndex: 30, },
  syncDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "#00E676" },
  syncText: { color: "#9EA5BC", fontSize: rf(10), fontWeight: "700", letterSpacing: 0.4 },

  // ── Dev calibration debug overlay ─────────────────────────────────────────
  dbgLine:  { position: "absolute", left: 0, right: 0, borderTopWidth: 2, opacity: 0.85 },
  dbgLabel: { position: "absolute", left: 6, color: "#FFFFFF", fontSize: 9, fontWeight: "900", backgroundColor: "rgba(0,0,0,0.6)", paddingHorizontal: 4 },
  dbgDot:   { position: "absolute", width: 8, height: 8, borderRadius: 4, backgroundColor: "#FFD700", opacity: 0.9 },
  dbgInfo:  { position: "absolute", color: "#FFD700", fontSize: 9, fontWeight: "900", backgroundColor: "rgba(0,0,0,0.55)", paddingHorizontal: 3 },
  dbgTheme: { position: "absolute", bottom: 4, left: 4, color: "#00FFCC", fontSize: 9, fontWeight: "900", backgroundColor: "rgba(0,0,0,0.65)", paddingHorizontal: 5, paddingVertical: 2, borderRadius: 4 },

  runner: { position: "absolute", alignItems: "center", justifyContent: "center", zIndex: 8 },
  runnerTrail: { position: "absolute", width: 14, height: 46, borderRadius: 10, top: 21, shadowOpacity: 0.9, shadowRadius: 9 },
  runnerAvatar: { alignItems: "center", justifyContent: "center", shadowOpacity: 0.95, shadowRadius: 11, elevation: 11 },
  runnerInitial: { fontSize: rf(14), fontWeight: "900" },
  runnerRank: { position: "absolute", top: -10, right: -7, width: rs(18), height: rs(18), borderRadius: rs(9), alignItems: "center", justifyContent: "center" },
  runnerRankText: { color: "#050711", fontSize: rf(9), fontWeight: "900" },
  runnerLabel: { position: "absolute", minWidth: 74, maxWidth: 108, borderRadius: 8, paddingHorizontal: 6, paddingVertical: 3, backgroundColor: "#050713DD", borderWidth: 1, borderColor: "#FFFFFF18" },
  runnerName: { fontSize: rf(10), fontWeight: "900" },
  runnerSteps: { fontSize: rf(9), color: "#B2B8CA", fontWeight: "700", marginTop: 1 },

  lbOverlay: {
    position: "absolute",
    right: 0,
    top: 0,
    backgroundColor: "#0B0D1AF2",
    borderLeftWidth: 1,
    borderLeftColor: "#1A1D2E",
    paddingHorizontal: 7,
    paddingTop: 8,
    paddingBottom: 4,
    zIndex: 15, },
  lbHead: { flexDirection: "row", alignItems: "flex-start", marginBottom: 8, gap: 6 },
  lbHeadText: { flex: 1, minWidth: 0 },
  lbTitle: { fontSize: rf(9), color: "#CCCCCC", fontWeight: "700", letterSpacing: 0.5, flex: 1 },
  lbPosition: { fontSize: rf(13), color: "#00E676", fontWeight: "900", marginTop: 2 },
  lbStatusPill: { flexDirection: "row", alignItems: "center", gap: 4, borderRadius: 8, backgroundColor: "#111421", borderWidth: 1, borderColor: "#252A3E", paddingHorizontal: 5, paddingVertical: 3 },
  lbStatusText: { color: "#FFFFFF", fontSize: rf(8), fontWeight: "900" },
  lbDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: "#FF4444" },
  lbEmpty: { paddingVertical: 18, alignItems: "center" },
  lbEmptyText: { color: "#8A8FA3", fontSize: rf(10), textAlign: "center" },
  lbRow: { flexDirection: "row", alignItems: "center", paddingVertical: 5, paddingHorizontal: 3, marginBottom: 2, borderRadius: 8 },
  lbRowMe: { backgroundColor: "#00E67614", borderWidth: 1, borderColor: "#00E67640" },
  lbBadge: { width: rs(20), height: rs(20), borderRadius: rs(10), borderWidth: 1.5, alignItems: "center", justifyContent: "center", marginRight: 5 },
  lbBadgeN: { fontSize: rf(10), fontWeight: "800" },
  lbAvatar: { width: rs(32), height: rs(32), borderRadius: rs(16), borderWidth: 2, backgroundColor: "#1A1D2E", alignItems: "center", justifyContent: "center", marginRight: 5 },
  lbAvatarI: { fontSize: rf(12), fontWeight: "800" },
  lbInfo: { flex: 1, minWidth: 0 },
  lbName: { fontSize: rf(11), fontWeight: "700" },
  lbSteps: { fontSize: rf(13), fontWeight: "800", color: "#FFFFFF", lineHeight: 14 },
  lbUnit: { fontSize: rf(9), color: "#555555" },
  toggleHandle: {
    position: "absolute",
    right: -2,
    top: "47%",
    width: 34,
    height: 74,
    borderTopLeftRadius: 14,
    borderBottomLeftRadius: 14,
    borderWidth: 1,
    borderColor: "#3A3F52",
    backgroundColor: "#202431F2",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 20, },

  progSection: { flexDirection: "row", alignItems: "center", paddingHorizontal: 12, backgroundColor: "#0B0D1A", borderTopWidth: 1, borderTopColor: "#1A1D2E" },
  progLeft: { flex: 1, flexDirection: "row", alignItems: "center", gap: 8 },
  progEmoji: { fontSize: 27 },
  progMain: { flex: 1 },
  progMine: { fontSize: rf(17), fontWeight: "900", color: "#00E676" },
  progTarget: { fontSize: rf(13), color: "#858A9C" },
  progSub: { fontSize: rf(9), color: "#858A9C", marginTop: 3 },
  progBarBg: { height: 7, backgroundColor: "#20263A", borderRadius: 4, marginTop: 5, overflow: "hidden" },
  progBarFill: { height: "100%", backgroundColor: "#00E676", borderRadius: 4 },
  progPct: { fontSize: rf(15), fontWeight: "900", color: "#00E676", marginLeft: 6 },
  milestoneBtn: { alignItems: "center", paddingLeft: 12, gap: 3, flexDirection: "row" },
  milestoneIcon: { fontSize: rf(20) },
  milestoneLbl: { fontSize: rf(9), color: "#C9A227", fontWeight: "800" },

  reactionBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-around", paddingHorizontal: 12, backgroundColor: "#090B16", borderTopWidth: 1, borderTopColor: "#1A1D2E" },
  reactionBtn: { minWidth: 42, height: rs(30), borderRadius: 15, backgroundColor: "#111421", borderWidth: 1, borderColor: "#24283D", alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 3 },
  reactionEmoji: { fontSize: rf(17) },
  reactionCount: { color: "#C7CDDA", fontSize: rf(10), fontWeight: "800" },

  cheerBar: { flexDirection: "row", alignItems: "center", paddingHorizontal: rs(10), gap: 6, backgroundColor: "#0B0D1A", borderTopWidth: 1, borderTopColor: "#1A1D2E" },
  cheerIcon: { fontSize: rf(14) },
  cheerLbl: { fontSize: rf(11), color: "#B865FF", fontWeight: "900" },
  cheerScroll: { flex: 1 },
  cheerContent: { alignItems: "center", paddingHorizontal: 6, gap: 12 },
  cheerItem: { flexDirection: "row", maxWidth: 210 },
  cheerFrom: { fontSize: rf(11), color: "#00E676", fontWeight: "900" },
  cheerMsg: { fontSize: rf(11), color: "#C7CDDA" },

  inputBar: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 12, paddingTop: 8, backgroundColor: "#050711", borderTopWidth: 1, borderTopColor: "#1A1D2E" },
  inputEmojiBtn: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  inputEmojiBtnActive: { backgroundColor: "#111421", borderWidth: 1, borderColor: "#24283D" },
  inputEmoji: { fontSize: 20 },
  inputField: { flex: 1, backgroundColor: "#111421", borderRadius: 20, borderWidth: 1, borderColor: "#24283D", color: "#FFFFFF", paddingHorizontal: rs(14), paddingVertical: rs(10), fontSize: rf(14) },
  sendBtn: { paddingHorizontal: rs(16), paddingVertical: rs(10), borderRadius: 20 },
  sendBtnDisabled: { opacity: 0.55 },
  sendTxt: { color: "#FFFFFF", fontSize: rf(13), fontWeight: "900" }, });
