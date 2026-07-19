import { AnimatedTrackOverlay } from "@/components/race/AnimatedTrackOverlay";
import { BlueShoe } from "@/components/BlueShoe";
import { getApiBase } from "@/utils/apiUrl";
import { LinearGradient } from "expo-linear-gradient";
import { router, useLocalSearchParams, useFocusEffect } from "expo-router";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAvatarVersionContext } from "@/context/AvatarVersionContext";
import { Alert,
  AppState,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
  Animated as RNAnimated,
} from "react-native";
import { SkeletonLiveDetail } from "@/components/SkeletonRows";
import { MicPassModal } from "@/components/race/MicPassModal";
import { useMicPass } from "@/hooks/useMicPass";
import { AppAlert } from "@/components/AppAlert";
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming, } from "react-native-reanimated";
import { useSafeLayout } from "@/hooks/useSafeLayout";
import { useParticipantStepAnimator } from "@/hooks/useParticipantStepAnimator";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { formatRaceSteps, resolveLiveRaceDisplaySteps } from "@/utils/liveRaceDisplay";
import { getChallengeDaysLeftLabel } from "@/utils/challengeSchedule";
import { ChallengeEndsPillLabel } from "@/components/ChallengeEndsPillLabel";
import { SponsoredEventWindowLabel } from "@/components/SponsoredEventWindowLabel";
import { Feather, MaterialCommunityIcons } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/context/AuthContext";
import { useRace } from "@/context/RaceContext";
import { useWalkContext } from "@/context/WalkContext";
import { useRaceProgress } from "@/hooks/useRaceProgress";
import { updateRankFromBackend, ensureActiveRaceInStore, clearActiveRaceProgress, suppressLiveRaceNotification, suppressSpectatorLiveRaceNotifications } from "@/services/stepProgressCoordinator";
import { findEligibleLiveRaceParticipant } from "@/utils/raceNotificationEligibility";
import { stepEngineLog } from "@/utils/stepAccuracy";
import { store } from "@/store";
import { authFetch } from "@/utils/authFetch";
import { STEP_SYNC_CONFIG } from "@/config/stepSyncConfig";
import {
  liveRaceFetchAllowed,
  markLiveRaceFetched,
  resetLiveRaceFetchGate,
} from "@/utils/liveRaceFetchGate";
import { debounceKeyed } from "@/utils/apiRequestCoordinator";
import {
  connectPusher,
  subscribeToChannel,
  unsubscribeFromChannel, } from "@/services/realtimeService";
import { formatDuration } from "@/utils/format";
import { localizeSponsoredEventTitle } from "@/utils/timezone";
import {
  getSponsoredPrizePerWinnerUsd,
  getSponsoredWinnerCount,
  SPONSORED_DEFAULT_TARGET_STEPS,
} from "@/utils/sponsoredEventsApi";
import { screenCache } from "@/utils/screenCache";
import { TouchableOpacity } from '@/components/HapticTouchableOpacity';
import { PublicProfileModal } from "@/components/PublicProfileModal";
import type { PublicProfileInitialData } from "@/components/PublicProfileModal";
import { useTopBanner } from "@/context/TopBannerContext";
import { raceStepSyncService } from "@/services/RaceStepSyncService";
import { applyParticipantProgressEvent } from "@/services/liveRaceParticipantState";
import { stepProviderManager } from "@/services/steps/stepProviderManager";
import {
  prefetchTrackTheme,
  TrackThemeImageBackground,
} from "@/components/TrackThemeImage";
import type { TrackThemeImageSet } from "@/utils/trackThemeMedia";
import {
  isTrackLayoutId,
  type TrackLayoutId,
} from "@/constants/trackLayouts";

const FALLBACK_COLORS = [
  "#FFD700","#C0C0C0","#00E676","#FF8C00","#A855F7",
  "#00B4FF","#FF5C93","#35D0BA","#F97316","#8B5CF6",
];

/** Coins awarded per rank in free races */
const FREE_TIER_COINS = [50, 30, 20];
/** Pool the top-N coin tiers and split equally among N tied rank-1 winners. */
function computeFreeWinnerCoins(tieCount: number): number {
  const pool = FREE_TIER_COINS
    .slice(0, Math.min(tieCount, FREE_TIER_COINS.length))
    .reduce((s, c) => s + c, 0);
  return Math.floor(pool / tieCount);
}
/** Number of prize-eligible winner slots for a given participant count.
 *  2  players → 1 winner
 *  3  players → 2 winners
 *  4+ players → 3 winners
 *  Must stay in sync with the backend numWinners() function in races.ts. */
function getWinnerCount(playerCount: number): number {
  if (playerCount <= 1) return 0;
  if (playerCount === 2) return 1;
  if (playerCount === 3) return 2;
  return 3;
}
const REACTIONS = ["🔥", "👏", "👑", "🏃", "🏆", "😮"];

// ── Types ─────────────────────────────────────────────────────────────────────

interface RaceData {
  id: string;
  title: string;
  status: string;
  type?: string;
  entryType: string;
  entryAmountCents: number;
  entryAmountDollars: number;
  targetSteps: number;
  currentPlayers: number;
  maxPlayers: number;
  startedAt: string | null;
  completedAt: string | null;
  scheduledStartAt?: string | null;
  endsAt?: string | null;
  creatorId: string;
  prizePool: number;
  prizeTiers: number[];
  spectatorCount: number;
  trackLayout?: string;
  imageSet?: TrackThemeImageSet | null;
  imageUrl?: string | null;
  assetVersion?: number;
  width?: number;
  height?: number;
  challengeEndAt?: string | null;
  challengeDurationDays?: number | null;
  timeLeftSeconds?: number | null;
  daysLeft?: number | null;
  hoursLeft?: number | null;
  timeLeftLabel?: string | null;
  remainingLabel?: string | null;
  coinEntryAmount?: number;
  coinPrizePool?: number;
  coinWinnersPool?: number;
  winnerCount?: number;
  prizePoolCents?: number; }

interface RaceParticipant {
  id: string;
  userId: string;
  currentSteps: number;
  status: string | null;
  rank: number | null;
  displayRank?: number | null;
  username: string;
  countryFlag: string | null;
  avatarColor: string | null;
  avatarUrl?: string | null;
  avatarVersion?: number | null;
  isHost: boolean;
  prizeAmount?: number;
  prizeCoins?: number;
  isTied?: boolean;
  tieGroupSize?: number;
  eligibleForPrize?: boolean;
  isWinner?: boolean;
  finishedGoal?: boolean;
  finishedAt?: string | null; }

interface LiveRaceDetailCache {
  race: RaceData;
  participants: RaceParticipant[];
}

const liveRaceDetailCacheKey = (raceId: string) => `live-race-detail:v1:${raceId}`;

interface RaceComment {
  id: string;
  userId: string;
  username: string;
  countryFlag: string;
  avatarColor: string;
  avatarUrl?: string | null;
  avatarVersion?: number | null;
  text: string;
  createdAt: string;
  clientMessageId?: string;
  status?: "sending" | "sent" | "failed";
  isOptimistic?: boolean; }

interface ReactionCount { emoji: string; count: number; }

interface Player {
  id: string; userId: string; rank: number; name: string; steps: number;
  isMe: boolean; rankColor: string; initial: string;
  country?: string; isHost?: boolean; avatarUrl?: string | null; avatarVersion?: number | null;
  isForfeited?: boolean; }

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtTime(seconds: number) {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60).toString().padStart(2, "0")}:${(s % 60).toString().padStart(2, "0")}`; }

function fmtCountdown(seconds: number) {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}:${sec.toString().padStart(2, "0")}`; }

function formatSteps(n: number): string {
  return formatRaceSteps(n);
}

type RaceCommentPayload = Partial<RaceComment> & { comment?: Partial<RaceComment>; timestamp?: string };

function normalizeIncomingComment(payload: RaceCommentPayload): RaceComment | null {
  const raw = payload.comment ?? payload;
  if (!raw.id || !raw.text) return null;
  return {
    id: raw.id, userId: raw.userId ?? "", username: raw.username ?? "Runner",
    countryFlag: raw.countryFlag ?? "", avatarColor: raw.avatarColor ?? "#00E676",
    avatarUrl: raw.avatarUrl ?? null, avatarVersion: raw.avatarVersion ?? null,
    text: raw.text, createdAt: raw.createdAt ?? new Date().toISOString(),
    clientMessageId: raw.clientMessageId,
    status: "sent" as const,
  }; }

function appendUniqueComment(prev: RaceComment[], comment: RaceComment): RaceComment[] {
  if (prev.some((c) => c.id === comment.id ||
    (comment.clientMessageId && c.clientMessageId === comment.clientMessageId))) return prev;
  return [...prev, comment].slice(-60); }

function mergeOrAppendComment(prev: RaceComment[], incoming: RaceComment): RaceComment[] {
  if (incoming.clientMessageId) {
    const idx = prev.findIndex((c) => c.clientMessageId === incoming.clientMessageId);
    if (idx !== -1) {
      const next = [...prev];
      next[idx] = incoming;
      return next;
    }
  }
  if (prev.some((c) => c.id === incoming.id)) return prev;
  return [...prev, incoming].slice(-60);
}

// ── Track geometry ────────────────────────────────────────────────────────────

function laneBoundaryX(boundaryIndex: number, y: number, width: number, height: number) {
  'worklet';
  const topLeft = width * 0.315, topRight = width * 0.685;
  const bottomLeft = width * 0.105, bottomRight = width * 0.895;
  const topY = height * 0.13, bottomY = height * 0.91;
  const t = Math.min(Math.max((y - topY) / (bottomY - topY), 0), 1);
  return topLeft + (bottomLeft - topLeft) * t + ((topRight + (bottomRight - topRight) * t - (topLeft + (bottomLeft - topLeft) * t)) / 10) * boundaryIndex; }

function laneCenterX(laneIndex: number, y: number, width: number, height: number) {
  'worklet';
  return (laneBoundaryX(laneIndex, y, width, height) + laneBoundaryX(laneIndex + 1, y, width, height)) / 2; }

// ── Per-theme finish zone config ───────────────────────────────────────────
// finishZoneFrac: fraction of hero height where the 100%-progress avatar stops.
// 0 = very top, 1 = very bottom. Adjust per theme if the finish banner sits
// at a different relative Y in that track image.
// FINISH_ZONE_FRAC: fraction of hero height for the animation target at progress=1.
// Kept small (0.06) so the animation approaches the top of the hero smoothly.
// The actual pixel position when progress>=1 is overridden in the worklet by
// the FINISH_LOCK formula (animSize/2 + 5) so avatars are always exactly 5 px
// below the "Race Track / Live Board" tab strip, regardless of screen size.
const FINISH_ZONE_FRAC = 0.06;
const TRACK_FINISH_ZONE: Record<string, number> = {
  bg:           FINISH_ZONE_FRAC,
  bg1:          FINISH_ZONE_FRAC,
  galaxy:       FINISH_ZONE_FRAC,
  daylightStadium: FINISH_ZONE_FRAC,
  forest:       FINISH_ZONE_FRAC,
  city:         FINISH_ZONE_FRAC,
  lava:         FINISH_ZONE_FRAC,
  ice:          FINISH_ZONE_FRAC,
  candy:        FINISH_ZONE_FRAC,
  farm:         FINISH_ZONE_FRAC,
  underwater:   FINISH_ZONE_FRAC,
  musicfest:    FINISH_ZONE_FRAC,
  barbie:       FINISH_ZONE_FRAC,
  desert:       FINISH_ZONE_FRAC,
  gold:         FINISH_ZONE_FRAC,
  nightforest:  FINISH_ZONE_FRAC,
  skykingdom:   FINISH_ZONE_FRAC,
  rain:         FINISH_ZONE_FRAC,
  storm:        FINISH_ZONE_FRAC,
  mountain:     0.22,   // FINISH gate sits ~22% from top in the mountain image
  waterfall:    FINISH_ZONE_FRAC,
  webcity:      FINISH_ZONE_FRAC,
  bridge:       FINISH_ZONE_FRAC,
  newyork:      FINISH_ZONE_FRAC,
  pirateisland: FINISH_ZONE_FRAC,
  paradise:     FINISH_ZONE_FRAC,
  musicfest2:   FINISH_ZONE_FRAC,
  chocolate:    FINISH_ZONE_FRAC,
  fireworks:    FINISH_ZONE_FRAC,
  moon:         FINISH_ZONE_FRAC,
  rainbow_road: FINISH_ZONE_FRAC,
  runway:       FINISH_ZONE_FRAC,
  toy_race:     FINISH_ZONE_FRAC,
  water_park:   FINISH_ZONE_FRAC,
};
const DEFAULT_FINISH_ZONE_FRAC = FINISH_ZONE_FRAC;

function getFinishZoneY(themeId: string, height: number): number {
  'worklet';
  const frac = (TRACK_FINISH_ZONE as Record<string, number>)[themeId] ?? DEFAULT_FINISH_ZONE_FRAC;
  return height * frac;
}

function sampleTrack(progress: number, width: number, height: number, finishZoneY?: number) {
  'worklet';
  const clamped = Math.min(Math.max(progress, 0), 1);
  const bottomY = height * 0.87;
  const topY = finishZoneY ?? height * DEFAULT_FINISH_ZONE_FRAC;
  const y = bottomY - (bottomY - topY) * clamped;
  return { x: width * 0.5, y, angle: -90, depth: 0.82 + clamped * 0.2 }; }

// ── RunnerMarker ──────────────────────────────────────────────────────────────
// Animated: progress drives position on the UI thread via Reanimated worklets.
// Only moves forward — backward steps are ignored unless the race resets.

const RunnerMarker = React.memo(function RunnerMarker({ player, index, width, height, targetSteps, finishZoneY, themeId = "bg", rsFactor = 1, meAvatarUrl, isSpeakingVoice = false, overrideSteps, onPress }: {
  player: Player; index: number; width: number; height: number;
  targetSteps: number; finishZoneY?: number; themeId?: string;
  rsFactor?: number; meAvatarUrl?: string | null;
  isSpeakingVoice?: boolean;
  /** For the current user: pass the real-time local step count so the avatar
   *  position and label stay in sync with the progress bar (not Pusher-delayed). */
  overrideSteps?: number;
  onPress?: (userId: string) => void; }) {

  const rs = (n: number) => Math.round(n * rsFactor);

  // Resolved finish zone Y for this theme — falls back to theme config default
  const fzY = finishZoneY ?? getFinishZoneY(themeId, height);

  // Clamp progress to [0,1]
  const clampProgress = (steps: number) =>
    Math.min(Math.max(steps / Math.max(targetSteps, 1), 0), 1);

  // Use the local real-time count when provided (current user), otherwise use
  // the backend-reported value (other participants via Pusher).
  const effectiveSteps = overrideSteps ?? player.steps;

  // Stable progress shared value — initialised from current steps
  const progressSV = useSharedValue(clampProgress(effectiveSteps));

  // Ref tracks the last progress target we sent to animation (forward-only guard)
  const lastTargetRef = useRef(clampProgress(effectiveSteps));

  // Animate forward whenever steps or targetSteps change
  useEffect(() => {
    const newProgress = clampProgress(effectiveSteps);
    const laneIdx = Math.min(Math.max(player.rank - 1, 0), 9);
    const bottomY = height * 0.87;
    const currentFzY = finishZoneY ?? getFinishZoneY(themeId, height);

    if (__DEV__) console.log(
      `[TrackMove] participant:${player.name} lane:${laneIdx}` +
      ` currentSteps:${effectiveSteps} progress:${newProgress.toFixed(3)}` +
      ` startY:${bottomY.toFixed(1)} finishZoneY:${currentFzY.toFixed(1)}` +
      ` animation from:${lastTargetRef.current.toFixed(3)} to:${newProgress.toFixed(3)}`,
    );

    // Defensive: if progress drops back to near-start (race reset / new race),
    // clear the forward-only guard so the avatar snaps to the correct position.
    if (newProgress < 0.05 && lastTargetRef.current > 0.5) {
      lastTargetRef.current = 0;
      progressSV.value = 0;
    }

    // Only animate forward (backend might echo stale data)
    if (newProgress >= lastTargetRef.current - 0.001) {
      lastTargetRef.current = newProgress;
      progressSV.value = withTiming(newProgress, {
        duration: Math.min(Math.max((newProgress - progressSV.value) * 3000, 300), 800),
        easing: Easing.out(Easing.quad),
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveSteps, targetSteps]);

  // Lane index from rank — changes cause instant X-snap (discrete, correct)
  const laneIndex = Math.min(Math.max(player.rank - 1, 0), 9);
  const yOffset   = index % 2 === 0 ? -4 : 4;

  // Visual sizing from current React state (updates on re-render, not per-frame)
  const currentPoint   = sampleTrack(clampProgress(effectiveSteps), width, height, fzY);
  const size           = (player.isMe ? rs(43) : rs(34)) * currentPoint.depth;
  const labelLeft      = laneIndex >= 7;
  const rankBadgeSize  = rs(18);

  // Speaking ring pulse — fades in when isSpeakingVoice, fades out when not.
  const speakRingPulse = useSharedValue(0);
  useEffect(() => {
    cancelAnimation(speakRingPulse);
    if (isSpeakingVoice) {
      speakRingPulse.value = withRepeat(
        withSequence(
          withTiming(1,   { duration: 230 }),
          withTiming(0.2, { duration: 320 }),
        ), -1, false,
      );
    } else {
      speakRingPulse.value = withTiming(0, { duration: 200 });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSpeakingVoice]);
  const speakRingStyle = useAnimatedStyle(() => ({
    opacity: speakRingPulse.value,
    transform: [{ scale: 1 + 0.1 * speakRingPulse.value }],
  }));

  // Mountain (and any theme with finishZoneY > 10% of height) pins the finished
  // avatar to the calibrated finish zone rather than the near-top standard lock.
  // This aligns the avatar with the visual FINISH gate in the mountain image.
  const useCalibratedFinishLock = fzY > height * 0.1;

  // Animated position — runs on UI thread between React renders
  // fzY is captured as a JS closure constant (re-created on each render when height/theme changes)
  const animStyle = useAnimatedStyle(() => {
    'worklet';
    const point = sampleTrack(progressSV.value, width, height, fzY);
    const animSize = (player.isMe ? Math.round(43 * rsFactor) : Math.round(34 * rsFactor)) * point.depth;

    // FINISH LOCK: when progress reaches 100%, pin the finished avatar.
    // Standard themes: pin 5 px below the hero top edge.
    // Mountain (useCalibratedFinishLock=true): pin at the calibrated fzY so
    // the avatar aligns with the visual FINISH gate in the mountain image.
    const FINISH_GAP_PX = 5;
    let y: number;
    if (progressSV.value >= 1) {
      y = useCalibratedFinishLock ? fzY : animSize / 2 + FINISH_GAP_PX;
    } else {
      y = point.y + yOffset;
    }
    const x = laneCenterX(laneIndex, y, width, height);
    return { left: x - animSize / 2, top: y - animSize / 2 };
  });

  return (
    <Animated.View style={[st.runner, animStyle]}>
      <View style={[st.runnerTrail, { width: rs(14), height: rs(46), top: size * 0.45, backgroundColor: `${player.rankColor}30`, shadowColor: player.rankColor }]} />
      {/* Speaking ring — absolute sibling of the avatar, pulsing lime ring */}
      <Animated.View
        pointerEvents="none"
        style={[
          {
            position: "absolute" as const,
            top: -5, left: -5,
            width: size + 10, height: size + 10,
            borderRadius: (size + 10) / 2,
            borderWidth: 2,
            borderColor: "#A3E635",
          },
          speakRingStyle,
        ]}
      />
      <TouchableOpacity
        activeOpacity={0.75}
        onPress={() => onPress?.(player.userId)}
        style={[st.runnerAvatar, {
          width: size, height: size, borderRadius: size / 2,
          borderColor: player.isForfeited ? "#FF4444" : player.rankColor,
          borderWidth: player.isMe ? 3 : 2, backgroundColor: "#060914E8",
          shadowColor: player.isForfeited ? "#FF4444" : player.rankColor, }]}
      >
        {player.avatarUrl ? (
          <Image source={{ uri: player.avatarUrl }} style={{ width: size, height: size, borderRadius: size / 2, opacity: player.isForfeited ? 0.5 : 1 }} />
        ) : (
          <Text style={[st.runnerInitial, { color: player.isForfeited ? "#FF4444" : player.rankColor, fontSize: rs(14) }]}>
            {player.initial}
          </Text>
        )}
        <View style={[st.runnerRank, { backgroundColor: player.rankColor, width: rankBadgeSize, height: rankBadgeSize, borderRadius: rankBadgeSize / 2, top: -rankBadgeSize / 2, right: -rankBadgeSize / 2 }]}>
          <Text style={[st.runnerRankText, { fontSize: rs(9) }]}>{player.rank}</Text>
        </View>
      </TouchableOpacity>
      <View style={[st.runnerLabel, labelLeft ? { right: size + 4 } : { left: size + 4 }]}>
        <Text style={[st.runnerName, { color: player.isMe ? player.rankColor : "#FFFFFF", fontSize: rs(10) }]} numberOfLines={1}>
          {player.isMe ? "You" : player.name}{player.country ? ` ${player.country}` : ""}{player.isHost ? <Text style={{ color: "#FFD700" }}> Host</Text> : ""}
        </Text>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 2 }}>
          <BlueShoe size={rs(9)} />
          <Text style={[st.runnerSteps, { fontSize: rs(9) }]}>{formatSteps(effectiveSteps)} steps</Text>
        </View>
      </View>
    </Animated.View>
  );
});

// ── Track Position per-participant mute (Race Track panel only) ───────────────

function TrackPositionMuteBtn({
  userId,
  participantName,
  isMuted,
  onMute,
  onUnmute,
}: {
  userId: string;
  participantName: string;
  isMuted: boolean;
  onMute: (id: string) => void;
  onUnmute: (id: string) => void;
}) {
  return (
    <TouchableOpacity
      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
      onPress={() => (isMuted ? onUnmute(userId) : onMute(userId))}
      style={[st.panelMicBtn, isMuted && st.panelMicBtnMuted]}
      accessibilityLabel={isMuted ? `Unmute ${participantName}` : `Mute ${participantName}`}
      accessibilityRole="button"
    >
      <Feather
        name={isMuted ? "mic-off" : "mic"}
        size={17}
        color={isMuted ? "#9CA3AF" : "#FFFFFF"}
      />
    </TouchableOpacity>
  );
}

// ── LeaderboardOverlay ────────────────────────────────────────────────────────

function LeaderboardOverlay({ visible, players, width, height, animatedStyle, positionText, statusText, rsFactor = 1, meAvatarUrl, onLocalMute, onLocalUnmute, locallyMutedUserIds = [], showMuteControls = false, isActiveRace = false }: {
  visible: boolean; players: Player[]; width: number; height: number;
  animatedStyle: object; positionText: string; statusText: string; rsFactor?: number;
  meAvatarUrl?: string | null;
  locallyMutedUserIds?: string[];
  onLocalMute: (userId: string) => void;
  onLocalUnmute: (userId: string) => void;
  showMuteControls?: boolean;
  isActiveRace?: boolean;
}) {
  const rs = (n: number) => Math.round(n * rsFactor);
  const avatarSize = rs(32), badgeSize = rs(20);
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
          <View style={st.lbEmpty}><Text style={[st.lbEmptyText, { fontSize: rs(10) }]}>No live runners yet</Text></View>
        ) : players.map((p) => (
          <View key={p.id} style={[st.lbRow, p.isMe && st.lbRowMe]}>
            <View style={[st.lbBadge, { width: badgeSize, height: badgeSize, borderRadius: badgeSize / 2, backgroundColor: `${p.rankColor}22`, borderColor: p.rankColor }]}>
              <Text style={[st.lbBadgeN, { color: p.rankColor, fontSize: rs(10) }]}>{p.rank}</Text>
            </View>
            <View style={[st.lbAvatar, { width: avatarSize, height: avatarSize, borderRadius: avatarSize / 2, borderColor: p.rankColor }]}>
              {(p.isMe ? meAvatarUrl : p.avatarUrl) ? (
                <Image
                  source={{ uri: (p.isMe ? meAvatarUrl : p.avatarUrl)! }}
                  style={{ width: avatarSize, height: avatarSize, borderRadius: avatarSize / 2 }}
                />
              ) : (
                <Text style={[st.lbAvatarI, { color: p.rankColor, fontSize: rs(12) }]}>{p.initial}</Text>
              )}
            </View>
            <View style={st.lbInfo}>
              <Text style={[st.lbName, { color: p.isMe ? "#00E676" : p.isForfeited ? "#FF4444" : "#fff", fontSize: rs(11) }]} numberOfLines={1}>
                {p.isMe ? "You" : p.name}
              </Text>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 2 }}>
                <BlueShoe size={rs(11)} />
                <Text style={[st.lbSteps, { fontSize: rs(13), color: p.isForfeited ? "#FF4444" : "#FFFFFF" }]}>{formatSteps(p.steps)}</Text>
              </View>
              <Text style={[st.lbUnit, { fontSize: Math.max(7, rs(9)) }]}>steps</Text>
            </View>
            {showMuteControls && !p.isMe && !p.isForfeited ? (
              <TrackPositionMuteBtn
                userId={p.userId || p.id}
                participantName={p.name}
                isMuted={locallyMutedUserIds.includes(p.userId || p.id)}
                onMute={onLocalMute}
                onUnmute={onLocalUnmute}
              />
            ) : showMuteControls ? (
              <View style={st.lbMuteColSpacer} />
            ) : null}
          </View>
        ))}
      </ScrollView>
    </Animated.View>
  ); }

// ── RaceViewToggle ────────────────────────────────────────────────────────────

function RaceViewToggle({ selectedView, onSelect, colors }: {
  selectedView: "race_track" | "live_board";
  onSelect: (v: "race_track" | "live_board") => void;
  colors: ReturnType<typeof useColors>; }) {
  const views = [
    { id: "race_track" as const, label: "Race Track" },
    { id: "live_board" as const, label: "Live Board" },
  ];
  return (
    <View style={[togStyles.wrap, { backgroundColor: colors.card, borderColor: colors.border }]}>
      {views.map(({ id, label }) => {
        const active = selectedView === id;
        return (
          <TouchableOpacity key={id} onPress={() => onSelect(id)} activeOpacity={0.85}
            style={[togStyles.tab, active && { backgroundColor: colors.primary }]}>
            <Text style={[togStyles.tabTxt, { color: active ? colors.primaryForeground : colors.mutedForeground }]}>
              {label}
            </Text>
          </TouchableOpacity>
        ); })}
    </View>
  ); }

const togStyles = StyleSheet.create({
  wrap:   { marginHorizontal: 12, marginTop: 8, marginBottom: 4, flexDirection: "row", borderRadius: 12, borderWidth: 1, padding: 3, gap: 3 },
  tab:    { flex: 1, paddingVertical: 9, alignItems: "center", borderRadius: 10 },
  tabTxt: { fontSize: 13, fontWeight: "800" }, });

// ── CompactPrizeCard ──────────────────────────────────────────────────────────

function coinsPrizeSplits(playerCount: number): number[] {
  if (playerCount <= 2) return [1.0];
  if (playerCount === 3) return [0.6, 0.4];
  return [0.5, 0.3, 0.2];
}
function fmtCoins(n: number) {
  if (n >= 1000) return `${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1)}k`;
  return n.toLocaleString();
}

function CompactPrizeCard({ race, colors }: { race: RaceData; colors: ReturnType<typeof useColors> }) {
  if (race.entryType === "free") {
    return (
      <View style={[cpStyles.card, { backgroundColor: colors.card, borderColor: colors.primary + "33" }]}>
        <Text style={{ fontSize: 16 }}>🎖️</Text>
        <View>
          <Text style={[cpStyles.freeTitle, { color: colors.primary }]}>Free Entry</Text>
          <Text style={[cpStyles.freeSub, { color: colors.mutedForeground }]}>Badges & rank only</Text>
        </View>
      </View>
    );
  }
  if (race.entryType === "coins_battle") {
    const entryAmt = race.coinEntryAmount ?? 0;
    const totalPool = race.coinPrizePool && race.coinPrizePool > 0
      ? race.coinPrizePool
      : entryAmt * race.currentPlayers;
    const winnersPool = race.coinWinnersPool && race.coinWinnersPool > 0
      ? race.coinWinnersPool
      : totalPool;
    const splits = coinsPrizeSplits(race.currentPlayers);
    const rankIcons = ["🥇", "🥈", "🥉"];
    return (
      <View style={[cpStyles.card, { backgroundColor: colors.card, borderColor: "#F59E0B44" }]}>
        <View style={cpStyles.headerRow}>
          <Image source={COIN_IMG} style={{ width: 18, height: 18 }} />
          <Text style={[cpStyles.label, { color: "#F59E0B" }]}>Coins Prize Pool</Text>
          <Text style={[cpStyles.pool, { color: "#F59E0B" }]}>{fmtCoins(winnersPool)}</Text>
        </View>
        <View style={cpStyles.tiersRow}>
          {splits.map((ratio, i) => (
            <View key={i} style={[cpStyles.tier, { backgroundColor: colors.background, borderColor: colors.border }]}>
              <Text style={{ fontSize: 13 }}>{rankIcons[i]}</Text>
              <Text style={[cpStyles.tierAmt, { color: colors.foreground }]}>{fmtCoins(Math.floor(winnersPool * ratio))}</Text>
            </View>
          ))}
        </View>
      </View>
    );
  }
  return null;
}

const cpStyles = StyleSheet.create({
  card:      { marginHorizontal: 12, borderRadius: 14, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 11, gap: 8 },
  headerRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  label:     { flex: 1, fontSize: 14, fontWeight: "700" },
  pool:      { fontSize: 15, fontWeight: "800" },
  freeTitle: { fontSize: 14, fontWeight: "700" },
  freeSub:   { fontSize: 12, marginTop: 1 },
  tiersRow:  { flexDirection: "row", gap: 8 },
  tier:      { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10, borderWidth: 1 },
  tierAmt:   { fontSize: 13, fontWeight: "700" }, });

// ── LiveBoardPanel ────────────────────────────────────────────────────────────

function LiveBoardPanel({ race, participants, currentUserId, userAvatarUrl, onAvatarPress, colors, stepDeltas = {} }: {
  race: RaceData; participants: RaceParticipant[];
  currentUserId: string | null; userAvatarUrl?: string | null;
  onAvatarPress?: (p: RaceParticipant) => void;
  colors: ReturnType<typeof useColors>;
  /** userId → step count gained since last Pusher update; shown as "+N" badge (clears after 2 s) */
  stepDeltas?: Record<string, number>; }) {
  const { getAvatarVersion } = useAvatarVersionContext();
  const isCompleted = race.status === "completed";
  const isSponsored = race.type === "sponsored";
  const [showPrizeInfo, setShowPrizeInfo] = useState(false);
  const rankColors  = [colors.gold, colors.silver, colors.bronze];
  const rankMedals  = ["🥇", "🥈", "🥉"];
  const sorted = useMemo(() => [...participants].sort((a, b) => b.currentSteps - a.currentSteps), [participants]);
  const { height: winH, width: winW } = useWindowDimensions();
  const prizeModalMaxH = Math.min(winH * 0.78, 560);
  const prizeModalW = Math.min(winW - 32, 420);
  const playerCount = Math.max(participants.length, race.currentPlayers ?? 0);
  const winnerCount = getSponsoredWinnerCount(playerCount);
  const prizeUsd = getSponsoredPrizePerWinnerUsd(
    (race as RaceData & { prizePerWinnerCents?: number }).prizePerWinnerCents,
  );
  return (
    <View style={[lbpStyles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={lbpStyles.header}>
        <View style={[lbpStyles.dot, { backgroundColor: isCompleted ? colors.gold : colors.destructive }]} />
        <Text style={[lbpStyles.title, { color: colors.foreground }]}>
          {isCompleted ? "Final Leaderboard" : "Live Leaderboard"}
        </Text>
        {isSponsored ? (
          <TouchableOpacity
            onPress={() => setShowPrizeInfo(true)}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityLabel="Gift card prizes info"
            activeOpacity={0.7}
            style={lbpStyles.infoBtn}
          >
            <Feather name="info" size={16} color="#FF9900" />
          </TouchableOpacity>
        ) : null}
        <Text style={[lbpStyles.count, { color: colors.mutedForeground }]}>{participants.length}/{race.maxPlayers}</Text>
      </View>
      {sorted.length === 0 ? (
        <Text style={[lbpStyles.empty, { color: colors.mutedForeground }]}>Waiting for participants...</Text>
      ) : sorted.map((p, i) => {
        const isUser = p.userId === currentUserId;
        const isForfeited = p.status === "forfeited";
        const ac = isForfeited ? "#FF4444" : (p.avatarColor ?? "#00E676");
        const nameColor = isForfeited ? "#FF4444" : isUser ? colors.primary : colors.foreground;
        const pct = race.targetSteps > 0 ? Math.min((p.currentSteps / race.targetSteps) * 100, 100) : 0;
        const prize = isCompleted && !isForfeited && (p.prizeAmount ?? 0) > 0 ? `$${p.prizeAmount!.toFixed(2)}` : null;
        const pAvatarUrl = p.userId
          ? `${getApiBase()}/api/profile/avatar/${p.userId}?v=${getAvatarVersion(p.userId ?? "", p.avatarVersion ?? 0)}`
          : (isUser ? userAvatarUrl : null);
        return (
          <TouchableOpacity
            key={p.id}
            activeOpacity={0.75}
            onPress={() => onAvatarPress?.(p)}
            style={[lbpStyles.row, isForfeited && { opacity: 0.75 }, isUser && !isForfeited && { backgroundColor: colors.primary + "0F" }, i < sorted.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }]}
          >
            <Text style={[lbpStyles.medal, { color: isForfeited ? "#FF4444" : i < 3 ? rankColors[i] : colors.mutedForeground }]}>
              {isForfeited ? "✕" : i < 3 ? rankMedals[i] : String(i + 1)}
            </Text>
            <View style={[lbpStyles.avatar, { backgroundColor: ac + "22", borderColor: isForfeited ? "#FF4444" : isUser ? colors.primary : ac }]}>
              {pAvatarUrl ? (
                <Image source={{ uri: pAvatarUrl }} style={[lbpStyles.avatarImg, isForfeited && { opacity: 0.5 }]} />
              ) : (
                <Text style={[lbpStyles.avatarTxt, { color: nameColor }]}>
                  {isUser ? "Y" : p.username.charAt(0).toUpperCase()}
                </Text>
              )}
            </View>
            <View style={lbpStyles.info}>
              <View style={lbpStyles.nameRow}>
                <Text style={[lbpStyles.name, { color: nameColor }]} numberOfLines={1}>{p.username}</Text>
                {!!p.countryFlag && <Text style={{ fontSize: 13 }}>{p.countryFlag}</Text>}
                {!isForfeited && p.isHost && <View style={[lbpStyles.tag, { backgroundColor: colors.gold + "22", borderColor: colors.gold + "55" }]}><Text style={[lbpStyles.tagTxt, { color: colors.gold }]}>Host</Text></View>}
                {!isForfeited && isUser && <View style={[lbpStyles.tag, { backgroundColor: colors.primary + "22", borderColor: colors.primary + "55" }]}><Text style={[lbpStyles.tagTxt, { color: colors.primary }]}>You</Text></View>}
                {isForfeited && <View style={[lbpStyles.tag, { backgroundColor: "#FF444422", borderColor: "#FF444455" }]}><Text style={[lbpStyles.tagTxt, { color: "#FF4444" }]}>FORFEITED</Text></View>}
                {!isForfeited && p.isTied && <View style={[lbpStyles.tag, { backgroundColor: colors.warning + "22", borderColor: colors.warning + "55" }]}><Text style={[lbpStyles.tagTxt, { color: colors.warning }]}>Tied</Text></View>}
              </View>
              <View style={[lbpStyles.track, { backgroundColor: colors.border }]}>
                <View style={[lbpStyles.fill, { width: `${pct}%` as unknown as number, backgroundColor: isForfeited ? "#FF4444" : isUser ? colors.primary : ac }]} />
              </View>
            </View>
            <View style={lbpStyles.right}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
                <BlueShoe size={13} />
                <Text style={[lbpStyles.steps, { color: isForfeited ? "#FF4444" : colors.foreground }]}>{p.currentSteps.toLocaleString()}</Text>
              </View>
              {!isForfeited && p.userId && (stepDeltas[p.userId] ?? 0) > 0 && (
                <Text style={lbpStyles.stepDelta}>+{stepDeltas[p.userId]}</Text>
              )}
              {prize && <Text style={[lbpStyles.prize, { color: colors.gold }]}>{prize}</Text>}
              {prize && p.isTied && (p.tieGroupSize ?? 1) > 1 && (
                <Text style={[lbpStyles.tagTxt, { color: colors.mutedForeground }]}>shared ÷{p.tieGroupSize}</Text>
              )}
            </View>
          </TouchableOpacity>
        ); })}

      {isSponsored ? (
        <Modal
          transparent
          visible={showPrizeInfo}
          animationType="fade"
          onRequestClose={() => setShowPrizeInfo(false)}
          statusBarTranslucent
        >
          <View style={lbpStyles.prizeOverlay}>
            <Pressable
              style={StyleSheet.absoluteFill}
              onPress={() => setShowPrizeInfo(false)}
              accessibilityLabel="Dismiss prizes"
            />
            <View
              style={[
                lbpStyles.prizeModalCard,
                {
                  width: prizeModalW,
                  maxHeight: prizeModalMaxH,
                  backgroundColor: colors.card,
                  borderColor: "#FF990055",
                },
              ]}
            >
              <View style={lbpStyles.prizeModalHeader}>
                <Text style={{ fontSize: 18 }}>🎁</Text>
                <View style={lbpStyles.prizeModalHeaderText}>
                  <Text style={[lbpStyles.prizeModalTitle, { color: "#FF9900" }]} numberOfLines={1}>
                    Gift Card Prizes
                  </Text>
                  <Text style={[lbpStyles.prizeModalSub, { color: "#FF9900" }]}>
                    ${prizeUsd} each
                  </Text>
                </View>
                <TouchableOpacity
                  style={[lbpStyles.prizeClose, { backgroundColor: colors.border + "99" }]}
                  onPress={() => setShowPrizeInfo(false)}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  accessibilityLabel="Close"
                  activeOpacity={0.7}
                >
                  <Feather name="x" size={18} color={colors.foreground} />
                </TouchableOpacity>
              </View>

              <ScrollView
                style={{ maxHeight: prizeModalMaxH - 72 }}
                contentContainerStyle={lbpStyles.prizeScrollContent}
                showsVerticalScrollIndicator
                bounces
                nestedScrollEnabled
                keyboardShouldPersistTaps="handled"
              >
                <SponsoredPrizePanel
                  race={race}
                  participants={participants}
                  colors={colors}
                  embedded
                />
              </ScrollView>
            </View>
          </View>
        </Modal>
      ) : null}
    </View>
  ); }

const lbpStyles = StyleSheet.create({
  card:      { marginHorizontal: 12, borderRadius: 14, borderWidth: 1, paddingHorizontal: 14, paddingTop: 12, paddingBottom: 6, gap: 8 },
  header:    { flexDirection: "row", alignItems: "center", gap: 6, paddingBottom: 4 },
  dot:       { width: 7, height: 7, borderRadius: 3.5 },
  title:     { flex: 1, fontSize: 15, fontWeight: "800" },
  infoBtn:   { padding: 2 },
  count:     { fontSize: 12 },
  empty:     { fontSize: 13, textAlign: "center", paddingVertical: 8 },
  row:       { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 8 },
  medal:     { fontSize: 18, width: 28, textAlign: "center" },
  avatar:    { width: 36, height: 36, borderRadius: 18, borderWidth: 1.5, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  avatarImg: { width: 36, height: 36, borderRadius: 18 },
  avatarTxt: { fontSize: 14, fontWeight: "800" },
  info:      { flex: 1, gap: 5 },
  nameRow:   { flexDirection: "row", alignItems: "center", gap: 4, flexWrap: "wrap" },
  name:      { fontSize: 13, fontWeight: "700" },
  tag:       { paddingHorizontal: 5, paddingVertical: 1, borderRadius: 5, borderWidth: 1 },
  tagTxt:    { fontSize: 9, fontWeight: "800" },
  track:     { height: 4, borderRadius: 2, overflow: "hidden" },
  fill:      { height: 4, borderRadius: 2 },
  right:     { alignItems: "flex-end", gap: 2 },
  steps:     { fontSize: 12, fontWeight: "700" },
  stepDelta: { fontSize: 10, fontWeight: "800", color: "#00E676" },
  prize:     { fontSize: 12, fontWeight: "800" },
  prizeOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.65)",
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 24,
  },
  prizeModalCard: {
    borderRadius: 16,
    borderWidth: 1,
    overflow: "hidden",
    zIndex: 1,
  },
  prizeModalHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 14,
    paddingTop: 14,
    paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#FF990033",
  },
  prizeModalHeaderText: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  prizeModalTitle: {
    fontSize: 16,
    fontWeight: "800",
  },
  prizeModalSub: {
    fontSize: 13,
    fontWeight: "700",
  },
  prizeClose: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  prizeScrollContent: {
    paddingBottom: 12,
    flexGrow: 0,
  },
});

// ── ReactionBar ───────────────────────────────────────────────────────────────

function ReactionBar({ counts, onReact, colors }: {
  counts: ReactionCount[]; onReact: (emoji: string) => void; colors: ReturnType<typeof useColors>; }) {
  const getCount = (emoji: string) => counts.find((c) => c.emoji === emoji)?.count ?? 0;
  return (
    <View style={[rbStyles.wrap, { backgroundColor: colors.card, borderColor: colors.border }]}>
      {REACTIONS.map((em) => (
        <TouchableOpacity key={em} onPress={() => onReact(em)} activeOpacity={0.7} style={rbStyles.btn}>
          <Text style={{ fontSize: 22 }}>{em}</Text>
          {getCount(em) > 0 && <Text style={[rbStyles.count, { color: colors.mutedForeground }]}>{getCount(em)}</Text>}
        </TouchableOpacity>
      ))}
    </View>
  ); }

const rbStyles = StyleSheet.create({
  wrap:  { marginHorizontal: 12, borderRadius: 14, borderWidth: 1, padding: 12, flexDirection: "row", justifyContent: "space-around" },
  btn:   { alignItems: "center", gap: 2 },
  count: { fontSize: 10, fontWeight: "600" }, });

// ── CheerFeed ─────────────────────────────────────────────────────────────────

function CheerFeed({ comments, colors }: { comments: RaceComment[]; colors: ReturnType<typeof useColors> }) {
  return (
    <View style={[cfStyles.wrap, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={cfStyles.header}>
        <Text style={{ fontSize: 14 }}>🎉</Text>
        <Text style={[cfStyles.title, { color: colors.foreground }]}>Cheer Feed</Text>
      </View>
      {comments.slice(-30).length === 0 ? (
        <Text style={[cfStyles.empty, { color: colors.mutedForeground }]}>No cheers yet — be the first!</Text>
      ) : comments.slice(-30).map((c) => (
        <View key={c.id} style={cfStyles.row}>
          <View style={[cfStyles.avatar, { backgroundColor: c.avatarColor + "22", borderColor: c.avatarColor }]}>
            <Text style={[cfStyles.avatarTxt, { color: c.avatarColor }]}>{c.username.charAt(0).toUpperCase()}</Text>
          </View>
          <View style={cfStyles.bubble}>
            <Text style={[cfStyles.name, { color: colors.primary }]}>{c.countryFlag} {c.username}</Text>
            <Text style={[cfStyles.msg, { color: colors.foreground }]}>{c.text}</Text>
          </View>
        </View>
      ))}
    </View>
  ); }

const cfStyles = StyleSheet.create({
  wrap:      { marginHorizontal: 12, borderRadius: 14, borderWidth: 1, padding: 14, gap: 10 },
  header:    { flexDirection: "row", alignItems: "center", gap: 6 },
  title:     { fontSize: 14, fontWeight: "700" },
  empty:     { fontSize: 13, paddingVertical: 4 },
  row:       { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  avatar:    { width: 28, height: 28, borderRadius: 14, borderWidth: 1.5, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  avatarTxt: { fontSize: 11, fontWeight: "800" },
  bubble:    { flex: 1 },
  name:      { fontSize: 11, fontWeight: "700" },
  msg:       { fontSize: 13, lineHeight: 18, marginTop: 1 }, });

// ── SponsoredPrizePanel ───────────────────────────────────────────────────────

function SponsoredPrizePanel({ race, participants, colors, embedded = false }: {
  race: RaceData;
  participants?: RaceParticipant[];
  colors: ReturnType<typeof useColors>;
  /** When true, drop outer chrome (used inside the info modal). */
  embedded?: boolean;
}) {
  const isCompleted = race.status === "completed";
  const targetSteps =
    typeof race.targetSteps === "number" && race.targetSteps > 0
      ? race.targetSteps
      : SPONSORED_DEFAULT_TARGET_STEPS;
  const playerCount = Math.max(
    (participants ?? []).length,
    race.currentPlayers ?? 0,
  );
  const winnerCount = getSponsoredWinnerCount(playerCount);
  const prizeUsd = getSponsoredPrizePerWinnerUsd(
    (race as RaceData & { prizePerWinnerCents?: number }).prizePerWinnerCents,
  );

  const finishers = (participants ?? [])
    .filter((p) => p.finishedGoal && p.finishedAt)
    .sort((a, b) => {
      const ta = a.finishedAt ? new Date(a.finishedAt).getTime() : Infinity;
      const tb = b.finishedAt ? new Date(b.finishedAt).getTime() : Infinity;
      return ta - tb;
    });
  const winners = finishers.slice(0, winnerCount);

  const rankIcons = ["🥇", "🥈", "🥉"];
  const ordinal = (i: number) =>
    i === 0 ? "1st" : i === 1 ? "2nd" : i === 2 ? "3rd" : `${i + 1}th`;

  return (
    <View style={[
      pzStyles.card,
      { backgroundColor: colors.card, borderColor: "#FF990044" },
      embedded && {
        marginHorizontal: 0,
        borderWidth: 0,
        borderRadius: 0,
        backgroundColor: "transparent",
        paddingTop: 12,
        paddingBottom: 4,
      },
    ]}>
      {!embedded ? (
        <View style={pzStyles.header}>
          <Text style={{ fontSize: 18 }}>🎁</Text>
          <Text style={[pzStyles.title, { color: "#FF9900" }]}>Gift Card Prizes</Text>
          <Text style={[pzStyles.pool, { color: "#FF9900" }]}>${prizeUsd} each</Text>
        </View>
      ) : null}
      {!embedded ? <View style={[pzStyles.divider, { backgroundColor: colors.border }]} /> : null}
      {isCompleted ? (
        winners.length > 0 ? (
          winners.map((p, i) => (
            <View key={p.userId} style={pzStyles.row}>
              <Text style={{ fontSize: 15 }}>{rankIcons[i] ?? "🏅"}</Text>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[pzStyles.place, { color: "#FF9900" }]}>
                  {ordinal(i)} Finisher
                </Text>
                <Text style={{ fontSize: 11, color: colors.mutedForeground }} numberOfLines={1}>{p.username}</Text>
              </View>
              <Text style={[pzStyles.amount, { color: "#FF9900" }]}>${prizeUsd} Gift Card</Text>
            </View>
          ))
        ) : (
          <Text style={{ fontSize: 12, color: colors.mutedForeground, textAlign: "center", paddingVertical: 4 }}>
            No winners — no one completed the {targetSteps.toLocaleString()} step goal
          </Text>
        )
      ) : (
        <>
          <View style={pzStyles.row}>
            <Text style={{ fontSize: 15 }}>🥇</Text>
            <Text style={[pzStyles.place, { color: "#FF9900" }]}>1st to finish</Text>
            <Text style={[pzStyles.amount, { color: "#FF9900" }]}>${prizeUsd} Gift Card</Text>
          </View>
          {winnerCount >= 2 && (
            <View style={pzStyles.row}>
              <Text style={{ fontSize: 15 }}>🥈</Text>
              <Text style={[pzStyles.place, { color: "#FF9900" }]}>2nd to finish</Text>
              <Text style={[pzStyles.amount, { color: "#FF9900" }]}>${prizeUsd} Gift Card</Text>
            </View>
          )}
          <Text style={{ fontSize: 11, color: colors.mutedForeground, textAlign: "center", marginTop: 4 }}>
            Complete {targetSteps.toLocaleString()} steps to win · {winnerCount} winner{winnerCount !== 1 ? "s" : ""}
            {playerCount > 0 ? ` · ${playerCount} racing` : ""}
          </Text>
        </>
      )}
    </View>
  );
}

// ── PrizePanel ────────────────────────────────────────────────────────────────

function PrizePanel({ race, participants, colors }: { race: RaceData; participants?: RaceParticipant[]; colors: ReturnType<typeof useColors> }) {
  // Sponsored gift-card prizes open from Live Leaderboard info icon modal instead.
  if (race.type === "sponsored") return null;
  if (race.entryType === "free") return null;

  const rankColors  = [colors.gold, colors.silver, colors.bronze];
  const rankIcons   = ["🥇", "🥈", "🥉"];
  const rankLabels  = ["1st Place", "2nd Place", "3rd Place"];
  const isCompleted = race.status === "completed";

  // After the race is finished the Race Finished card already shows winners
  // and their prizes — hide the prize pool card to avoid duplication.
  if (isCompleted) return null;

  // ── Coins battle ──────────────────────────────────────────────────────────
  if (race.entryType === "coins_battle") {
    const entryAmt = race.coinEntryAmount ?? 0;
    const totalPool = race.coinPrizePool && race.coinPrizePool > 0
      ? race.coinPrizePool
      : entryAmt * race.currentPlayers;
    const winnersPool = race.coinWinnersPool && race.coinWinnersPool > 0
      ? race.coinWinnersPool
      : totalPool;
    const splits = coinsPrizeSplits(race.currentPlayers);

    // After race: show actual coin prizes per participant
    const completedCoinRows = isCompleted && participants
      ? participants
          .filter((p) => p.status !== "forfeited" && (p.prizeCoins ?? 0) > 0)
          .sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99))
      : [];

    return (
      <View style={[pzStyles.card, { backgroundColor: colors.card, borderColor: "#F59E0B44" }]}>
        <View style={pzStyles.header}>
          <Image source={COIN_IMG} style={{ width: 20, height: 20 }} />
          <Text style={[pzStyles.title, { color: "#F59E0B" }]}>Coins Prize Pool</Text>
          <Text style={[pzStyles.pool, { color: "#F59E0B" }]}>{fmtCoins(winnersPool)}</Text>
        </View>
        <View style={[pzStyles.divider, { backgroundColor: colors.border }]} />
        {isCompleted && completedCoinRows.length > 0
          ? completedCoinRows.map((p, i) => (
              <View key={p.userId} style={pzStyles.row}>
                <Text style={{ fontSize: 15 }}>{rankIcons[Math.min(i, 2)]}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={[pzStyles.place, { color: rankColors[Math.min(i, 2)] }]}>
                    {p.isTied && (p.tieGroupSize ?? 1) > 1 ? `Tied ${rankLabels[Math.min(i, 2)]}` : rankLabels[Math.min(i, 2)]}
                  </Text>
                  <Text style={{ fontSize: 11, color: colors.mutedForeground }}>{p.username}</Text>
                </View>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                  <Image source={COIN_IMG} style={{ width: 13, height: 13 }} />
                  <Text style={[pzStyles.amount, { color: "#F59E0B" }]}>{fmtCoins(p.prizeCoins ?? 0)}</Text>
                </View>
              </View>
            ))
          : splits.map((ratio, i) => (
              <View key={i} style={pzStyles.row}>
                <Text style={{ fontSize: 15 }}>{rankIcons[i]}</Text>
                <Text style={[pzStyles.place, { color: rankColors[i] }]}>{rankLabels[i]}</Text>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                  <Image source={COIN_IMG} style={{ width: 13, height: 13 }} />
                  <Text style={[pzStyles.amount, { color: "#F59E0B" }]}>{fmtCoins(Math.floor(winnersPool * ratio))}</Text>
                </View>
              </View>
            ))
        }
      </View>
    );
  }

  // ── Cash race ─────────────────────────────────────────────────────────────
  if (!race.prizeTiers?.length) return null;

  const completedRows = isCompleted && participants
    ? participants
        .filter((p) => p.status !== "forfeited" && (p.prizeAmount ?? 0) > 0)
        .sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99))
    : [];

  return (
    <View style={[pzStyles.card, { backgroundColor: colors.card, borderColor: colors.gold + "44" }]}>
      <View style={pzStyles.header}>
        <Text style={{ fontSize: 18 }}>🏆</Text>
        <Text style={[pzStyles.title, { color: colors.gold }]}>Prize Pool</Text>
        <Text style={[pzStyles.pool, { color: colors.foreground }]}>${(race.prizePool ?? 0).toFixed(2)}</Text>
      </View>
      <View style={[pzStyles.divider, { backgroundColor: colors.border }]} />
      {isCompleted && completedRows.length > 0
        ? completedRows.map((p, i) => (
            <View key={p.userId} style={pzStyles.row}>
              <Text style={{ fontSize: 15 }}>{rankIcons[Math.min(i, 2)]}</Text>
              <View style={{ flex: 1 }}>
                <Text style={[pzStyles.place, { color: rankColors[Math.min(i, 2)] }]}>
                  {p.isTied && (p.tieGroupSize ?? 1) > 1 ? `Tied ${rankLabels[Math.min(i, 2)]}` : rankLabels[Math.min(i, 2)]}
                </Text>
                <Text style={{ fontSize: 11, color: colors.mutedForeground }}>{p.username}</Text>
              </View>
              <Text style={[pzStyles.amount, { color: colors.foreground }]}>${p.prizeAmount!.toFixed(2)}</Text>
            </View>
          ))
        : race.prizeTiers.map((amount, i) => (
            <View key={i} style={pzStyles.row}>
              <Text style={{ fontSize: 15 }}>{rankIcons[i]}</Text>
              <Text style={[pzStyles.place, { color: rankColors[i] }]}>{rankLabels[i]}</Text>
              <Text style={[pzStyles.amount, { color: colors.foreground }]}>${amount.toFixed(2)}</Text>
            </View>
          ))
      }
    </View>
  );
}

const pzStyles = StyleSheet.create({
  card:    { marginHorizontal: 12, borderRadius: 14, borderWidth: 1, padding: 16, gap: 10 },
  header:  { flexDirection: "row", alignItems: "center", gap: 8 },
  title:   { flex: 1, fontSize: 16, fontWeight: "700" },
  pool:    { fontSize: 16, fontWeight: "800" },
  divider: { height: StyleSheet.hairlineWidth },
  row:     { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 3 },
  place:   { flex: 1, fontSize: 14, fontWeight: "600" },
  amount:  { fontSize: 14, fontWeight: "700" }, });

// ── LivePrizeStrip ─────────────────────────────────────────────────────────────

const COIN_IMG = require("../../assets/images/game-coin.png");

function LivePrizeStrip({ race, colors }: { race: RaceData; colors: ReturnType<typeof useColors> }) {
  const isCoinsBattle = race.entryType === "coins_battle";
  const isFree = race.entryType === "free";

  if (isCoinsBattle) {
    const entryAmt = race.coinEntryAmount ?? 0;
    const totalPool = race.coinPrizePool && race.coinPrizePool > 0
      ? race.coinPrizePool
      : entryAmt * race.currentPlayers;
    const winnersPool = race.coinWinnersPool && race.coinWinnersPool > 0
      ? race.coinWinnersPool
      : totalPool;
    const splits = coinsPrizeSplits(race.currentPlayers);
    const medalIcons = ["🥇", "🥈", "🥉"];
    return (
      <View style={lpsStyles.row}>
        {splits.map((ratio, i) => (
          <View key={i} style={[lpsStyles.chip, { backgroundColor: colors.card, borderColor: "#F59E0B44" }]}>
            <Text style={lpsStyles.icon}>{medalIcons[i]}</Text>
            <Image source={COIN_IMG} style={lpsStyles.coinImg} />
            <Text style={[lpsStyles.amt, { color: "#F59E0B" }]}>{fmtCoins(Math.floor(winnersPool * ratio))}</Text>
          </View>
        ))}
      </View>
    );
  }

  const freeWinnerSlots = getWinnerCount(race.currentPlayers);
  const tiers = isFree
    ? FREE_TIER_COINS.slice(0, freeWinnerSlots).map((c, i) => ({ icon: ["🥇","🥈","🥉"][i], label: `${c}`, isCoin: true }))
    : (race.prizeTiers ?? []).slice(0, getWinnerCount(race.currentPlayers) || 3).map((amt, i) => ({ icon: ["🥇","🥈","🥉"][i], label: `$${amt.toFixed(2)}`, isCoin: false }));
  if (!tiers.length) return null;
  return (
    <View style={lpsStyles.row}>
      {tiers.map((t, i) => (
        <View key={i} style={[lpsStyles.chip, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={lpsStyles.icon}>{t.icon}</Text>
          <Text style={[lpsStyles.amt, { color: colors.foreground }]}>{t.label}</Text>
          {t.isCoin && <Image source={COIN_IMG} style={lpsStyles.coinImg} />}
        </View>
      ))}
    </View>
  );
}

const lpsStyles = StyleSheet.create({
  row:     { flexDirection: "column", alignItems: "flex-end", gap: 4 },
  chip:    { flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 20, borderWidth: 1 },
  icon:    { fontSize: 10 },
  amt:     { fontSize: 10, fontWeight: "700" },
  coinImg: { width: 11, height: 11 }, });

// ── SpeakingBars ──────────────────────────────────────────────────────────────
// Three vertical bars that animate at staggered speeds to indicate voice activity.
function SpeakingBars() {
  const b1 = useSharedValue(0.35);
  const b2 = useSharedValue(0.35);
  const b3 = useSharedValue(0.35);

  useEffect(() => {
    b1.value = withRepeat(
      withSequence(
        withTiming(1,    { duration: 210 }),
        withTiming(0.3,  { duration: 210 }),
      ), -1, false,
    );
    b2.value = withDelay(90, withRepeat(
      withSequence(
        withTiming(1,    { duration: 255 }),
        withTiming(0.3,  { duration: 255 }),
      ), -1, false,
    ));
    b3.value = withDelay(170, withRepeat(
      withSequence(
        withTiming(1,    { duration: 185 }),
        withTiming(0.3,  { duration: 185 }),
      ), -1, false,
    ));
    return () => {
      cancelAnimation(b1);
      cancelAnimation(b2);
      cancelAnimation(b3);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const s1 = useAnimatedStyle(() => ({ transform: [{ scaleY: b1.value }] }));
  const s2 = useAnimatedStyle(() => ({ transform: [{ scaleY: b2.value }] }));
  const s3 = useAnimatedStyle(() => ({ transform: [{ scaleY: b3.value }] }));

  return (
    <View style={{ flexDirection: "row", gap: 2.5, alignItems: "center" }} pointerEvents="none">
      <Animated.View style={[{ width: 3, height: 12, borderRadius: 2, backgroundColor: "#A3E635" }, s1]} />
      <Animated.View style={[{ width: 3, height: 12, borderRadius: 2, backgroundColor: "#A3E635" }, s2]} />
      <Animated.View style={[{ width: 3, height: 12, borderRadius: 2, backgroundColor: "#A3E635" }, s3]} />
    </View>
  );
}

// ── Main Screen ───────────────────────────────────────────────────────────────

export default function LiveRaceDetailScreen() {
  const { id: raceId, trackLayout: initialTrackLayout } = useLocalSearchParams<{ id: string; trackLayout?: string }>();
  const initialCache =
    raceId && typeof raceId === "string"
      ? screenCache.getSync<LiveRaceDetailCache>(liveRaceDetailCacheKey(raceId))
      : null;

  // ── Mic Pass / voice-chat state ─────────────────────────────────────────────
  // NOTE: Mic Pass is purely social — it has zero effect on steps, race
  // progress, rank, prizes, or leaderboard logic.
  const {
    hasMicPass,
    micState,
    isSpeaking,
    activeSpeakerIds,
    mutedParticipantIds,
    locallyMutedUserIds,
    audioRoute,
    bluetoothAvailable,
    btDeviceName,
    showMicMenu,
    closeMicMenu,
    selectSpeaker,
    selectPhone,
    selectBluetooth,
    selectMute,
    showPurchaseModal,
    closePurchaseModal,
    grantMicPass,
    handleMicTap,
    disconnectVoice,
    notifyRaceStarted,
    localMuteParticipant,
    localUnmuteParticipant,
  } = useMicPass(raceId);

  // Participants who are speaking AND not muted (remote or local) — used by all speaking indicators.
  const visibleSpeakerIds = activeSpeakerIds.filter(
    (id) => !mutedParticipantIds.includes(id) && !locallyMutedUserIds.includes(id),
  );

  const { user, sessionToken }                     = useAuth();
  const { setRaceTargetSteps, resumeLiveRace, setActiveRace, catchUpLiveRaceSteps, recordFinishedRaceStepsForWalk, userRaceSteps, stopRaceStepTracking } = useRace();
  const { resumeStepWatching, refreshTodaySteps } = useWalkContext();
  const raceProgress = useRaceProgress();
  const canonicalRaceSteps = raceProgress.raceSteps;
  const liveRaceSteps = resolveLiveRaceDisplaySteps(canonicalRaceSteps, userRaceSteps);
  const canonicalRank = raceProgress.rank;
  const localStepsRef = useRef(liveRaceSteps);
  localStepsRef.current = liveRaceSteps;
  const raceResumedRef = useRef(false);
  const raceCompletedRef = useRef(false);
  const [finalRaceSteps, setFinalRaceSteps] = useState<number | null>(null);
  const finalizeLiveRace = useCallback((
    backendSteps?: number,
    allResults?: Array<{ userId?: string; currentSteps?: number }>,
  ) => {
    if (raceCompletedRef.current) return;
    raceCompletedRef.current = true;
    const target = race?.targetSteps ?? 10_000;
    const local = Math.max(0, Math.floor(localStepsRef.current));
    const backend =
      backendSteps !== undefined ? Math.max(0, Math.floor(backendSteps)) : undefined;
    const reconciled = Math.min(
      target,
      backend !== undefined ? Math.max(local, backend) : local,
    );
    setFinalRaceSteps(reconciled);
    stepEngineLog(
      "RaceComplete",
      `detected raceId=${raceId ?? "none"} finalSteps=${reconciled} localRaceSteps=${local} serverRaceSteps=${backend ?? "n/a"}`,
    );
    stepEngineLog(
      "LiveRace",
      `normalizedRaceSteps=${reconciled} raceId=${raceId ?? "none"} status=completed`,
    );
    stopRaceStepTracking("race_completed");
    if (allResults?.length) {
      setParticipants((prev) => {
        const byUserId = new Map(
          allResults
            .filter((r) => r.userId)
            .map((r) => [
              r.userId!,
              Math.min(target, Math.max(0, Math.floor(r.currentSteps ?? 0))),
            ]),
        );
        return prev.map((p) => {
          const server = byUserId.get(p.userId);
          if (server !== undefined) return { ...p, currentSteps: server };
          const isMe = p.userId === user?.id;
          return isMe ? { ...p, currentSteps: reconciled } : p;
        });
      });
    } else if (user?.id) {
      setParticipants((prev) =>
        prev.map((p) =>
          p.userId === user.id ? { ...p, currentSteps: reconciled } : p,
        ),
      );
    }
    clearActiveRaceProgress("finished", {
      preserveWalkDisplay: reconciled > 0 ? reconciled : undefined,
      raceId: raceId ?? undefined,
    });
    recordFinishedRaceStepsForWalk(reconciled);
  }, [
    race?.targetSteps,
    raceId,
    stopRaceStepTracking,
    recordFinishedRaceStepsForWalk,
    user?.id,
  ]);
  const sessionTokenRef = useRef(sessionToken);
  const setRaceTargetStepsRef = useRef(setRaceTargetSteps);
  sessionTokenRef.current = sessionToken;
  setRaceTargetStepsRef.current = setRaceTargetSteps;
  const loadedRaceIdRef = useRef<string | null>(null);
  const colors             = useColors();
  const { safeTop, safeBottom } = useSafeLayout();
  const { width: screenW } = useWindowDimensions();
  const { getAvatarVersion } = useAvatarVersionContext();
  const isTablet           = screenW >= 768;
  const rsFactor           = isTablet
    ? Math.min(1.5, screenW / 520)
    : Math.max(0.87, Math.min(1.1, screenW / 390));
  const rs = (n: number) => Math.round(n * rsFactor);

  // ── Shared race state ─────────────────────────────────────────────────────
  const [race,           setRace]           = useState<RaceData | null>(initialCache?.race ?? null);
  const [participants,   setParticipants]   = useState<RaceParticipant[]>(initialCache?.participants ?? []);
  const [comments,       setComments]       = useState<RaceComment[]>([]);
  const [reactionCounts, setReactionCounts] = useState<ReactionCount[]>([]);
  const [loading,        setLoading]        = useState(!initialCache?.race);
  const [cheerText,      setCheerText]      = useState("");
  const [cheerToast,     setCheerToast]     = useState<string | null>(null);
  const [spectatorCount, setSpectatorCount] = useState(0);
  const cheerToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [selectedView,   setSelectedView]   = useState<"race_track" | "live_board">("race_track");
  const [isTrackFullscreen, setIsTrackFullscreen] = useState(false);
  const [bannerDismissed, setBannerDismissed] = useState(false);
  // Reason the race ended — captured from the race:completed Pusher event so
  // we can show forfeit-specific messaging without a DB round-trip.
  const [forfeitReason, setForfeitReason] = useState<string | null>(null);
  // Coins Battle win: show a "You won X coins!" banner when race:completed fires
  const [coinWinAmount, setCoinWinAmount] = useState<number | null>(null);
  // Map of userId → prizeCoins from race:completed Pusher event (all participants)
  const [pusherPrizeMap, setPusherPrizeMap] = useState<Map<string, number>>(new Map());
  // Queue-based top banner (replaces local finishGoalBanner overlay)
  const { enqueueBanner } = useTopBanner();

  // ── Step-delta animation for other participants ────────────────────────────
  // prevStepsMapRef tracks the last known step count per userId (keyed by userId).
  // stepDeltaFlash holds userId → deltaSteps for "+N" badges in the live board.
  // Entries are cleared after 2 s so the animation is ephemeral.
  const prevStepsMapRef   = useRef<Record<string, number>>({});
  const stepDeltaTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const [stepDeltaFlash, setStepDeltaFlash] = useState<Record<string, number>>({});
  const [profileUserId, setProfileUserId] = useState<string | null>(null);
  const [profileInitialData, setProfileInitialData] = useState<PublicProfileInitialData | undefined>(undefined);

  const { resetForRace, setConfirmedSteps, getDisplaySteps } = useParticipantStepAnimator();

  // ── Track-specific state ──────────────────────────────────────────────────
  const [now,                  setNow]                  = useState(Date.now());
  const [heroHeight,           setHeroHeight]           = useState(400);
  const [isLeaderboardVisible, setIsLeaderboardVisible] = useState(true);
  const [showReactionPicker,   setShowReactionPicker]   = useState(false);
  const [trackLayoutId, setTrackLayoutId] = useState<TrackLayoutId>(() => {
    if (isTrackLayoutId(initialTrackLayout)) {
      return initialTrackLayout;
    }
    const cachedLayout = initialCache?.race?.trackLayout;
    if (isTrackLayoutId(cachedLayout)) {
      return cachedLayout;
    }
    return "bg";
  });

  // Apply nav/cache theme immediately when re-entering (no wait for API).
  useEffect(() => {
    if (isTrackLayoutId(initialTrackLayout)) {
      setTrackLayoutId(initialTrackLayout);
      return;
    }
    if (!raceId || typeof raceId !== "string") return;
    const cached = screenCache.getSync<LiveRaceDetailCache>(liveRaceDetailCacheKey(raceId));
    const cachedLayout = cached?.race?.trackLayout;
    if (isTrackLayoutId(cachedLayout)) {
      setTrackLayoutId(cachedLayout);
    }
  }, [raceId, initialTrackLayout]);

  const scrollRef     = useRef<ScrollView>(null);
  const cheerScrollRef = useRef<ScrollView>(null);
  const reactionCooldownRef = useRef<Record<string, number>>({});
  useEffect(() => {
    if (!raceId) return;
    stepEngineLog(
      "LiveRace",
      `mounted raceId=${raceId} status=${race?.status ?? "unknown"} userId=${user?.id ?? "none"}`,
    );
  }, [raceId, user?.id, race?.status]);

  const fetchInFlightRef = useRef(false);
  const raceDetailFetchInFlightRef = useRef(false);
  const currentUserId = user?.id ?? null;

  // ── Countdown state ────────────────────────────────────────────────────────
  const [countdown, setCountdown] = useState<number | null>(null);
  const countdownIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const countdownActiveRef   = useRef(false);
  /** Skip start countdown when opening an already-live race (rejoin). */
  const raceAlreadyStartedRef = useRef(false);

  const triggerCountdown = useCallback(() => {
    if (raceAlreadyStartedRef.current) return;
    if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current);
    countdownActiveRef.current = true;
    setCountdown(3);
    let n = 3;
    countdownIntervalRef.current = setInterval(() => {
      n -= 1;
      if (n <= 0) {
        clearInterval(countdownIntervalRef.current!);
        countdownIntervalRef.current = null;
        countdownActiveRef.current = false;
        setCountdown(null); } else {
        setCountdown(n); } }, 1000); }, []);

  useEffect(() => () => {
    if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current); }, []);

  // ── Animated values ───────────────────────────────────────────────────────
  const progress          = useSharedValue(0);
  const leaderboardProgress = useSharedValue(1);
  const pulseOpacity      = useSharedValue(0);
  // Mic animation
  const micPulseOpacity   = useSharedValue(0);
  const micPulseScale     = useSharedValue(1);
  const micConnRot        = useSharedValue(0);
  const leaderboardW      = isTablet
    ? Math.min(300, Math.max(220, screenW * 0.32))
    : Math.min(240, Math.max(200, screenW * 0.52));
  const leaderboardWShared = useSharedValue(leaderboardW);

  // Prefetch as soon as theme code is known (nav param) — don't wait for race JSON.
  useEffect(() => {
    prefetchTrackTheme(
      {
        code: trackLayoutId,
        trackLayout: trackLayoutId,
        imageSet: race?.imageSet ?? null,
        imageUrl: race?.imageUrl ?? null,
        assetVersion: race?.assetVersion,
      },
      "full",
    );
  }, [trackLayoutId, race?.imageSet, race?.imageUrl, race?.assetVersion]);

  // Kick off prefetch immediately on first paint for nav-param themes.
  useEffect(() => {
    if (isTrackLayoutId(initialTrackLayout)) {
      prefetchTrackTheme({ code: initialTrackLayout, trackLayout: initialTrackLayout }, "full");
    }
  }, [initialTrackLayout]);

  useEffect(() => { leaderboardWShared.value = leaderboardW; }, [leaderboardW, leaderboardWShared]);
  useEffect(() => {
    leaderboardProgress.value = withTiming(isLeaderboardVisible ? 1 : 0, { duration: 260 }); }, [isLeaderboardVisible, leaderboardProgress]);

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
  const pulseStyle = useAnimatedStyle(() => ({ opacity: pulseOpacity.value }));
  const micPulseRingStyle = useAnimatedStyle(() => ({
    opacity:   micPulseOpacity.value,
    transform: [{ scale: micPulseScale.value }],
  }));
  const micConnStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${micConnRot.value}deg` }],
  }));

  useEffect(() => {
    if (loading) {
      pulseOpacity.value = withRepeat(
        withSequence(withTiming(1, { duration: 550 }), withTiming(0.25, { duration: 550 })),
        -1, false,
      ); } else {
      cancelAnimation(pulseOpacity);
      pulseOpacity.value = withTiming(0, { duration: 200 }); } }, [loading, pulseOpacity]);

  // Mic pulse ring — slow gentle pulse while listening, fast energetic pulse while speaking.
  useEffect(() => {
    cancelAnimation(micPulseOpacity);
    cancelAnimation(micPulseScale);
    if (micState === "active") {
      if (isSpeaking) {
        // Fast energetic burst when actively speaking
        micPulseOpacity.value = withRepeat(
          withSequence(
            withTiming(0.9,  { duration: 190, easing: Easing.out(Easing.quad) }),
            withTiming(0.0,  { duration: 280, easing: Easing.in(Easing.quad) }),
          ), -1, false,
        );
        micPulseScale.value = withRepeat(
          withSequence(
            withTiming(2.1,  { duration: 190, easing: Easing.out(Easing.quad) }),
            withTiming(1.0,  { duration: 280, easing: Easing.in(Easing.quad) }),
          ), -1, false,
        );
      } else {
        // Slow relaxed pulse while listening
        micPulseOpacity.value = withRepeat(
          withSequence(
            withTiming(0.75, { duration: 700, easing: Easing.out(Easing.quad) }),
            withTiming(0.0,  { duration: 900, easing: Easing.in(Easing.quad) }),
          ), -1, false,
        );
        micPulseScale.value = withRepeat(
          withSequence(
            withTiming(1.5,  { duration: 700, easing: Easing.out(Easing.quad) }),
            withTiming(1.0,  { duration: 900, easing: Easing.in(Easing.quad) }),
          ), -1, false,
        );
      }
    } else {
      micPulseOpacity.value = withTiming(0, { duration: 150 });
      micPulseScale.value   = withTiming(1, { duration: 150 });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [micState, isSpeaking]);

  // Connecting spinner rotation.
  useEffect(() => {
    if (micState === "connecting") {
      micConnRot.value = withRepeat(
        withTiming(360, { duration: 850, easing: Easing.linear }),
        -1,
        false,
      );
    } else {
      cancelAnimation(micConnRot);
      micConnRot.value = 0;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [micState]);

  // ── Derived from race/participants ─────────────────────────────────────────
  const isActive    = race?.status === "in_progress";
  const isCompleted = race?.status === "completed";
  const isFree      = race?.entryType === "free";

  const resolveParticipantRaceSteps = useCallback(
    (p: RaceParticipant, isMe = false): number => {
      if (isMe && isCompleted && finalRaceSteps !== null) return finalRaceSteps;
      if (isMe && isActive) return liveRaceSteps;
      return Math.max(0, p.currentSteps);
    },
    [isActive, isCompleted, finalRaceSteps, liveRaceSteps],
  );

  // ── Clock tick — stops once race is completed ──────────────────────────────
  useEffect(() => {
    if (isCompleted) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id); }, [isCompleted]);

  useEffect(() => { if (!isActive) setShowReactionPicker(false); });
  // Disconnect voice when race ends — never keep mic active after the race.
  useEffect(() => { if (!isActive) disconnectVoice(); }, [isActive, disconnectVoice]);
  // Auto-connect all participants as listeners when race becomes active so
  // everyone hears voice without needing to tap the mic button.
  useEffect(() => { if (isActive) notifyRaceStarted(); }, [isActive, notifyRaceStarted]);
  // Close all transient modals when navigating away — prevents stuck overlays.
  useFocusEffect(useCallback(() => {
    return () => {
      closeMicMenu();
      setShowReactionPicker(false);
    };
  }, [closeMicMenu]));
  const raceTitle   = race?.title ?? "Live Race";
  const isSponsored = race?.type === "sponsored";
  const headerRaceTitle = isSponsored
    ? localizeSponsoredEventTitle(raceTitle, race?.startedAt)
    : raceTitle.replace(/^LIVE\s+/i, "");

  const startedAtMs   = race?.startedAt   ? new Date(race.startedAt).getTime()   : null;
  const completedAtMs = race?.completedAt ? new Date(race.completedAt).getTime() : null;
  const elapsed       = startedAtMs ? Math.max(0, Math.floor(((completedAtMs ?? now) - startedAtMs) / 1000)) : 0;
  const statusLabel = isCompleted ? "FINISHED" : isActive ? "LIVE" : race ? "WAITING" : "NO RACE";
  const SPONSORED_DURATION_S = 3 * 60 * 60;
  const sponsoredRemaining = Math.max(0, SPONSORED_DURATION_S - elapsed);
  const infoTimeLabel = isCompleted ? "TIME" : isActive && isSponsored ? "TIME LEFT" : isActive ? "TIME" : "STATUS";
  const infoTimeValue = isCompleted || isActive
    ? (isActive && isSponsored ? fmtCountdown(sponsoredRemaining) : fmtTime(elapsed))
    : statusLabel;
  const timerColor = isActive && isSponsored
    ? sponsoredRemaining < 30 * 60 ? "#FF4444"
      : sponsoredRemaining < 60 * 60 ? "#FFAA00"
      : "#00E676"
    : undefined;

  /** Multi-day end strip — alternates with tagline every 3s in the same slot. */
  const challengeEndsLabel = useMemo(
    () =>
      getChallengeDaysLeftLabel(
        {
          challengeEndAt: race?.challengeEndAt,
          challengeDurationDays: race?.challengeDurationDays,
          startedAt: race?.startedAt ?? race?.createdAt,
          targetSteps: race?.targetSteps,
          timeLeftSeconds: race?.timeLeftSeconds,
          daysLeft: race?.daysLeft,
          hoursLeft: race?.hoursLeft,
          timeLeftLabel: race?.timeLeftLabel ?? race?.remainingLabel,
        },
        now,
      ),
    [
      race?.challengeEndAt,
      race?.challengeDurationDays,
      race?.startedAt,
      race?.createdAt,
      race?.targetSteps,
      race?.timeLeftSeconds,
      race?.daysLeft,
      race?.hoursLeft,
      race?.timeLeftLabel,
      race?.remainingLabel,
      now,
    ],
  );

  const sponsoredStartIso = useMemo(() => {
    if (!isSponsored) return null;
    return race?.scheduledStartAt ?? race?.startedAt ?? null;
  }, [isSponsored, race?.scheduledStartAt, race?.startedAt]);

  const sponsoredEndIso = useMemo(() => {
    if (!isSponsored) return null;
    if (race?.endsAt) return race.endsAt;
    const start = race?.startedAt ?? race?.scheduledStartAt;
    if (!start) return null;
    return new Date(new Date(start).getTime() + 3 * 60 * 60 * 1000).toISOString();
  }, [isSponsored, race?.endsAt, race?.startedAt, race?.scheduledStartAt]);

  const hasAltSlot = !!(challengeEndsLabel || (isSponsored && sponsoredStartIso));

  // Single-layer tagline: freeze start/end copy once, hold 5s, fade, swap, fade — no recapture.
  type TaglineAlt =
    | { kind: "ends"; label: string }
    | { kind: "sponsored"; start: string; end: string | null };
  const [taglineMode, setTaglineMode] = useState<"alt" | "beat">("beat");
  const [taglineAlt, setTaglineAlt] = useState<TaglineAlt | null>(null);
  const taglineModeRef = useRef<"alt" | "beat">("beat");
  const taglineOpacity = useRef(new RNAnimated.Value(1)).current;
  const taglineLoopGenRef = useRef(0);
  const challengeEndsLabelRef = useRef(challengeEndsLabel);
  const sponsoredStartRef = useRef(sponsoredStartIso);
  const sponsoredEndRef = useRef(sponsoredEndIso);
  challengeEndsLabelRef.current = challengeEndsLabel;
  sponsoredStartRef.current = sponsoredStartIso;
  sponsoredEndRef.current = sponsoredEndIso;

  useEffect(() => {
    const gen = ++taglineLoopGenRef.current;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let resolveSleep: (() => void) | null = null;

    const alive = () => gen === taglineLoopGenRef.current;

    const sleep = (ms: number) =>
      new Promise<void>((resolve) => {
        resolveSleep = resolve;
        timer = setTimeout(() => {
          timer = null;
          resolveSleep = null;
          resolve();
        }, ms);
      });

    const cleanupSleep = () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      if (resolveSleep) {
        const r = resolveSleep;
        resolveSleep = null;
        r();
      }
    };

    const fade = (to: number) =>
      new Promise<void>((resolve) => {
        RNAnimated.timing(taglineOpacity, {
          toValue: to,
          duration: 300,
          useNativeDriver: true,
        }).start(() => resolve());
      });

    if (!hasAltSlot || isCompleted) {
      taglineModeRef.current = "beat";
      setTaglineMode("beat");
      setTaglineAlt(null);
      taglineOpacity.stopAnimation();
      taglineOpacity.setValue(1);
      return () => {
        taglineLoopGenRef.current += 1;
        cleanupSleep();
      };
    }

    // Freeze once for this race — never rewrite while rotating (stops blink/change).
    const ends = challengeEndsLabelRef.current;
    const frozen: TaglineAlt | null = ends
      ? { kind: "ends", label: ends }
      : sponsoredStartRef.current
        ? {
            kind: "sponsored",
            start: sponsoredStartRef.current,
            end: sponsoredEndRef.current,
          }
        : null;

    if (!frozen) {
      taglineModeRef.current = "beat";
      setTaglineMode("beat");
      setTaglineAlt(null);
      taglineOpacity.setValue(1);
      return () => {
        taglineLoopGenRef.current += 1;
        cleanupSleep();
      };
    }

    setTaglineAlt(frozen);
    taglineModeRef.current = "alt";
    setTaglineMode("alt");
    taglineOpacity.stopAnimation();
    taglineOpacity.setValue(1);

    const HOLD_MS = 5000;

    void (async () => {
      while (alive()) {
        // Full 5s visible before any fade starts.
        await sleep(HOLD_MS);
        if (!alive()) break;

        await fade(0);
        if (!alive()) break;

        // Swap only after fully invisible. Keep frozen alt payload untouched.
        const next: "alt" | "beat" = taglineModeRef.current === "alt" ? "beat" : "alt";
        taglineModeRef.current = next;
        setTaglineMode(next);

        await sleep(80);
        if (!alive()) break;

        await fade(1);
      }
    })();

    return () => {
      taglineLoopGenRef.current += 1;
      cleanupSleep();
      taglineOpacity.stopAnimation();
    };
  }, [hasAltSlot, isCompleted, race?.id, taglineOpacity]);

  // Feed confirmed step values into the animator (local user + Pusher/backend).
  useEffect(() => {
    if (!isActive && !isCompleted) return;
    for (const p of participants) {
      const isMe =
        p.userId === user?.id ||
        (!!user?.username && p.username.toLowerCase() === user.username.toLowerCase());
      const confirmed = resolveParticipantRaceSteps(p, isMe);
      setConfirmedSteps(p.userId, confirmed);
      if (isMe) {
        stepEngineLog(
          "LiveRace",
          `renderedHeaderSteps=${confirmed} localRaceSteps=${liveRaceSteps} serverRaceSteps=${p.currentSteps}`,
        );
      }
    }
  }, [
    participants,
    liveRaceSteps,
    isActive,
    isCompleted,
    user?.id,
    user?.username,
    setConfirmedSteps,
    resolveParticipantRaceSteps,
  ]);

  const sortedPlayers = useMemo(() => {
    // Deduplicate by both participant id AND userId — same user can appear
    // with two different participant rows if a reconnect creates a duplicate.
    const seenIds = new Set<string>();
    const seenUserIds = new Set<string>();
    const unique = participants.filter((p) => {
      if (seenIds.has(p.id) || seenUserIds.has(p.userId)) return false;
      seenIds.add(p.id);
      seenUserIds.add(p.userId);
      return true;
    });
    // For the current user, substitute real-time local steps so that the sort
    // order, Track Position rank label, and side panel step count all match
    // the Race Track avatar position — one shared source of truth.
    const withEffective = unique.map((p) => {
      const isMe = p.userId === user?.id ||
        (!!user?.username && p.username.toLowerCase() === user.username.toLowerCase());
      const effectiveSteps = resolveParticipantRaceSteps(p, isMe);
      const displaySteps = getDisplaySteps(p.userId, effectiveSteps);
      return { p, isMe, effectiveSteps: displaySteps };
    });
    const sorted = [...withEffective].sort((a, b) => b.effectiveSteps - a.effectiveSteps);
    return sorted.slice(0, 10).map<Player>(({ p, isMe, effectiveSteps }, index) => {
      const rank =
        isMe && isActive && canonicalRank != null && canonicalRank > 0
          ? canonicalRank
          : p.rank && p.rank > 0
            ? p.rank
            : index + 1;
      const username = p.username || "Runner";
      return {
        id: p.id, userId: p.userId, rank,
        name: isMe ? "You" : username,
        steps: effectiveSteps,
        isMe,
        rankColor: p.status === "forfeited" ? "#FF4444" : (p.avatarColor ?? FALLBACK_COLORS[index % FALLBACK_COLORS.length]),
        initial: username.slice(0, 1).toUpperCase() || "R",
        country: p.countryFlag ?? undefined,
        isHost: p.isHost,
        isForfeited: p.status === "forfeited",
        avatarUrl: p.userId ? `${getApiBase()}/api/profile/avatar/${p.userId}?v=${p.avatarVersion ?? 0}` : null,
        avatarVersion: p.avatarVersion ?? null,
      };
    }).sort((a, b) => a.rank - b.rank);
  }, [participants, user?.id, user?.username, isActive, liveRaceSteps, canonicalRank, getDisplaySteps, resolveParticipantRaceSteps]);

  const myPlayer = useMemo(
    () => sortedPlayers.find((p) => p.isMe) ?? sortedPlayers[0] ?? null,
    [sortedPlayers],
  );
  const currentParticipant = useMemo(
    () => participants.find((p) =>
      p.userId === user?.id ||
      (!!user?.username && p.username.toLowerCase() === user.username.toLowerCase()),
    ) ?? null,
    [participants, user?.id, user?.username],
  );

  // Leave / forfeit / DQ / complete: stop participant-only live race notification for this race.
  useEffect(() => {
    if (!raceId || !user?.id || !currentParticipant) return;
    if (findEligibleLiveRaceParticipant([currentParticipant], user)) return;
    void suppressLiveRaceNotification(raceId, `participant_${currentParticipant.status ?? "ineligible"}`);
    stopRaceStepTracking(`participant_${currentParticipant.status ?? "ineligible"}`);
  }, [raceId, user?.id, user?.username, currentParticipant, currentParticipant?.status, stopRaceStepTracking]);

  const winners = useMemo(() => {
    const nonForfeited = participants.filter((p) => p.status !== "forfeited");
    if (!nonForfeited.length) return [];

    if (isCompleted) {
      // Completed race: only show prize-eligible winners (1 for 2p, 2 for 3p, 3 for 4p+).
      // Non-prize ranks should not appear with "Winner" badges or coin amounts.
      const winnerSlots = getWinnerCount(race?.currentPlayers ?? participants.length);
      const limit = winnerSlots > 0 ? winnerSlots : 3; // graceful fallback
      const withRank = nonForfeited.filter((p) => p.rank != null);
      if (withRank.length > 0) {
        return [...withRank]
          .sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99))
          .slice(0, limit);
      }
      // Fallback when results not yet written: top-N by steps
      return [...nonForfeited]
        .sort((a, b) => {
          const aMe = a.userId === user?.id;
          const bMe = b.userId === user?.id;
          return resolveParticipantRaceSteps(b, bMe) - resolveParticipantRaceSteps(a, aMe);
        })
        .slice(0, limit);
    }

    // Live race: show top-step players (tied for lead)
    const sorted = [...nonForfeited].sort((a, b) => {
      const aMe = a.userId === user?.id;
      const bMe = b.userId === user?.id;
      return resolveParticipantRaceSteps(b, bMe) - resolveParticipantRaceSteps(a, aMe);
    });
    const topSteps = sorted[0] ? resolveParticipantRaceSteps(sorted[0], sorted[0].userId === user?.id) : 0;
    const seenIds = new Set<string>();
    return sorted.filter((p) => {
      const isMe = p.userId === user?.id;
      const steps = resolveParticipantRaceSteps(p, isMe);
      if (steps !== topSteps) return false;
      if (seenIds.has(p.userId)) return false;
      seenIds.add(p.userId);
      return true;
    });
  }, [participants, isCompleted, race?.currentPlayers, user?.id, resolveParticipantRaceSteps]);

  // For the local user, prefer the real-time local step count (from device
  // pedometer via RaceContext) over the Pusher-delayed backend value. This
  // gives instant feedback without waiting for the server round-trip.
  const mySteps = myPlayer?.isMe
    ? (isActive
        ? liveRaceSteps
        : (finalRaceSteps ?? myPlayer.steps ?? 0))
    : (myPlayer?.steps ?? 0);
  const myProgress = Math.min(mySteps / Math.max(race?.targetSteps ?? 1, 1), 1);
  const trackPositionText = myPlayer
    ? `#${canonicalRank ?? myPlayer.rank} of ${race?.currentPlayers ?? participants.length ?? raceProgress.totalParticipants ?? Math.max(sortedPlayers.length, 1)}`
    : "Waiting";
  const trackStatusText = isCompleted ? "FINISHED" : isActive ? "LIVE" : "WAITING";

  useEffect(() => {
    progress.value = withTiming(myProgress, { duration: 900 }); }, [myProgress, progress]);

  // ── TrackMove debug (race-level) ──────────────────────────────────────────
  useEffect(() => {
    if (!race) return;
    const bottomY = heroHeight * 0.87;
    const fzY = getFinishZoneY(trackLayoutId, heroHeight);
    if (__DEV__) console.log(
      `[TrackMove] raceId:${raceId} theme:${trackLayoutId}` +
      ` targetSteps:${race.targetSteps}` +
      ` startY:${bottomY.toFixed(1)} finishZoneY:${fzY.toFixed(1)} finishFrac:${(TRACK_FINISH_ZONE[trackLayoutId] ?? DEFAULT_FINISH_ZONE_FRAC).toFixed(2)}`,
    );
  }, [raceId, race?.id, race?.targetSteps, trackLayoutId, heroHeight]);

  // ── Data fetch (race + participants only — does NOT reset comments) ──────────
  const hydrateInProgressRace = useCallback((
    raceData: RaceData | null | undefined,
    parts: RaceParticipant[],
  ) => {
    if (!raceId || !raceData || raceData.status !== "in_progress" || !user?.id) return;
    raceAlreadyStartedRef.current = true;

    // Spectators may view the race + Pusher updates, but must NOT enter participant
    // race tracking or the live race progress notification.
    const me = findEligibleLiveRaceParticipant(parts, user);
    if (!me) {
      void suppressSpectatorLiveRaceNotifications(raceId);
      stopRaceStepTracking("spectator_or_ineligible");
      stepEngineLog(
        "LiveRace",
        `backendHydrated=spectator raceId=${raceId} participantNotifications=false`,
      );
      for (const p of parts) {
        setConfirmedSteps(p.userId, p.currentSteps, { instant: true });
        prevStepsMapRef.current[p.userId] = p.currentSteps;
      }
      return;
    }

    const prevActiveId = store.getState().raceProgress.activeRaceId;
    const preserveAsCompanion = !!prevActiveId && prevActiveId !== raceId;
    const resolvedGoal =
      typeof raceData.targetSteps === "number" && raceData.targetSteps > 0
        ? raceData.targetSteps
        : undefined;
    // Keep RaceContext target in sync BEFORE resumeLiveRace — otherwise it
    // restarts the ongoing notification with the default 1000-step goal.
    if (resolvedGoal != null) {
      setRaceTargetSteps(resolvedGoal);
    }
    setActiveRace(raceId, false);
    const challengeEndAt =
      raceData.type === "sponsored"
        ? raceData.challengeEndAt ??
          (raceData.startedAt
            ? new Date(
                new Date(raceData.startedAt).getTime() + 3 * 60 * 60 * 1000,
              ).toISOString()
            : undefined)
        : raceData.challengeEndAt ?? undefined;
    ensureActiveRaceInStore({
      raceId,
      raceStartTime: new Date(raceData.startedAt ?? Date.now()).toISOString(),
      userId: user.id,
      username: user.username ?? "Runner",
      goalSteps: resolvedGoal ?? store.getState().raceProgress.goalSteps ?? 0,
      totalParticipants: raceData.currentPlayers ?? parts.length,
      bootSteps: me.currentSteps ?? 0,
      participantConfirmed: true,
      preserveAsCompanion,
      isSponsored: raceData.type === "sponsored",
      challengeEndAt,
    });
    if (!raceResumedRef.current) {
      raceResumedRef.current = true;
      resumeLiveRace(
        raceData.currentPlayers ?? parts.length,
        new Date(raceData.startedAt ?? Date.now()),
        me.currentSteps ?? 0,
        raceData.type === "sponsored" && raceData.startedAt
          ? new Date(new Date(raceData.startedAt).getTime() + 3 * 60 * 60 * 1000)
          : null,
      );
    }
    void catchUpLiveRaceSteps(me.currentSteps ?? 0, true);
    stepEngineLog("LiveRace", `backendHydrated=true raceId=${raceId} participantNotifications=true`);
    for (const p of parts) {
      const isMe =
        p.userId === user.id ||
        (!!user.username && p.username.toLowerCase() === user.username.toLowerCase());
      if (isMe) continue;
      setConfirmedSteps(p.userId, p.currentSteps, { instant: true });
      prevStepsMapRef.current[p.userId] = p.currentSteps;
    }
  }, [raceId, user?.id, user?.username, setActiveRace, setRaceTargetSteps, resumeLiveRace, catchUpLiveRaceSteps, setConfirmedSteps, stopRaceStepTracking]);

  const fetchRaceDetails = useCallback(async (
    force = false,
    options?: { gateKey?: string; minIntervalMs?: number },
  ) => {
    if (!raceId || !sessionTokenRef.current || raceDetailFetchInFlightRef.current) return;
    const gateKey = options?.gateKey ?? `${raceId}:detail`;
    const minIntervalMs = options?.minIntervalMs ?? STEP_SYNC_CONFIG.LIVE_RACE_DETAIL_REFRESH_MS;
    if (
      !liveRaceFetchAllowed(
        gateKey,
        minIntervalMs,
        force,
        STEP_SYNC_CONFIG.LIVE_RACE_FORCE_FETCH_MIN_GAP_MS,
      )
    ) {
      return;
    }
    raceDetailFetchInFlightRef.current = true;
    try {
      const res = await authFetch(`/api/races/${raceId}`);
      if (res.ok) {
        markLiveRaceFetched(gateKey);
        const data = await res.json() as { race?: RaceData; participants?: RaceParticipant[] };
        setRace(data.race ?? null);
        if (data.race?.status === "in_progress" || data.race?.status === "completed") {
          raceAlreadyStartedRef.current = true;
        }
        setParticipants(Array.isArray(data.participants) ? data.participants : []);
        hydrateInProgressRace(data.race, Array.isArray(data.participants) ? data.participants : []);
        if (isTrackLayoutId(data.race?.trackLayout)) {
          setTrackLayoutId(data.race.trackLayout);
        }
        if (data.race) {
          void screenCache.set(liveRaceDetailCacheKey(raceId), {
            race: data.race,
            participants: Array.isArray(data.participants) ? data.participants : [],
          });
        }
      }
    } finally {
      raceDetailFetchInFlightRef.current = false;
    }
  }, [raceId, hydrateInProgressRace]);

  // Pause step reads when leaving the screen; catch up from device + server on return.
  const catchUpStepsRef = useRef(catchUpLiveRaceSteps);
  catchUpStepsRef.current = catchUpLiveRaceSteps;
  const fetchDetailsOnFocusRef = useRef(fetchRaceDetails);
  fetchDetailsOnFocusRef.current = fetchRaceDetails;
  const participantsOnFocusRef = useRef(participants);
  participantsOnFocusRef.current = participants;

  useFocusEffect(useCallback(() => {
    if (!raceId || race?.status !== "in_progress" || raceCompletedRef.current || !user?.id) return;

    const me = findEligibleLiveRaceParticipant(participantsOnFocusRef.current, user);
    if (me) {
      const prevActiveId = store.getState().raceProgress.activeRaceId;
      const preserveAsCompanion = !!prevActiveId && prevActiveId !== raceId;
      const resolvedGoal =
        typeof race?.targetSteps === "number" && race.targetSteps > 0
          ? race.targetSteps
          : undefined;
      if (resolvedGoal != null) {
        setRaceTargetSteps(resolvedGoal);
      }
      const challengeEndAt =
        race?.type === "sponsored"
          ? race.challengeEndAt ??
            (race.startedAt
              ? new Date(new Date(race.startedAt).getTime() + 3 * 60 * 60 * 1000).toISOString()
              : undefined)
          : race?.challengeEndAt ?? undefined;
      ensureActiveRaceInStore({
        raceId,
        raceStartTime: new Date(race?.startedAt ?? Date.now()).toISOString(),
        userId: user.id,
        username: user.username ?? "Runner",
        goalSteps: resolvedGoal ?? store.getState().raceProgress.goalSteps ?? 0,
        totalParticipants: race?.currentPlayers ?? participantsOnFocusRef.current.length,
        bootSteps: Math.max(me.currentSteps ?? 0, localStepsRef.current),
        participantConfirmed: true,
        preserveAsCompanion,
        isSponsored: race?.type === "sponsored",
        challengeEndAt,
      });
      stepEngineLog(
        "LiveScreen",
        `focus raceId=${raceId} userId=${user.id} renderedSteps=${localStepsRef.current} participantNotifications=true`,
      );
      void catchUpStepsRef.current(me.currentSteps ?? 0, true);
      stepEngineLog("LiveRace", `rejoinStart raceId=${raceId} cachedStateRendered=true`);
    } else {
      void suppressSpectatorLiveRaceNotifications(raceId);
      stopRaceStepTracking("spectator_or_ineligible");
      stepEngineLog(
        "LiveScreen",
        `focus raceId=${raceId} userId=${user.id} participantNotifications=false`,
      );
    }
    void fetchDetailsOnFocusRef.current(true);
    void refreshTodaySteps();

    return () => {
      // Defer so back navigation paints first.
      setTimeout(() => {
        void resumeStepWatching();
      }, 0);
    };
  }, [raceId, race?.status, race?.startedAt, race?.targetSteps, race?.currentPlayers, race?.type, race?.challengeEndAt, user?.id, user?.username, resumeStepWatching, refreshTodaySteps, stopRaceStepTracking, setRaceTargetSteps]));

  useEffect(() => {
    if (!raceId || !user?.id) return;
    stepEngineLog(
      "LiveScreen",
      `receivedStepUpdate raceId=${raceId} canonical=${canonicalRaceSteps} context=${userRaceSteps ?? 0} rendered=${liveRaceSteps}`,
    );
  }, [raceId, user?.id, canonicalRaceSteps, userRaceSteps, liveRaceSteps]);

  useEffect(() => {
    if (!raceId) return;
    const sub = AppState.addEventListener("change", (nextState) => {
      if (nextState !== "active") return;
      stepEngineLog("Lifecycle", "appState=active live-detail");
      void refreshTodaySteps();
      if (race?.status === "completed") {
        if (!raceCompletedRef.current) {
          const me = participantsOnFocusRef.current.find(
            (p) =>
              p.userId === user?.id ||
              (!!user?.username &&
                p.username.toLowerCase() === user.username.toLowerCase()),
          );
          finalizeLiveRace(me?.currentSteps);
        }
        return;
      }
      if (race?.status !== "in_progress" || !user?.id) return;
      const me = participantsOnFocusRef.current.find(
        (p) =>
          p.userId === user.id ||
          (!!user.username && p.username.toLowerCase() === user.username.toLowerCase()),
      );
      stepEngineLog("Resume", "refreshedSteps=true liveRace");
      void catchUpStepsRef.current(me?.currentSteps ?? 0, true);
    });
    return () => sub.remove();
  }, [raceId, race?.status, user?.id, user?.username, refreshTodaySteps, finalizeLiveRace]);

  // ── Full fetch (initial load — race first, comments/reactions in background) ─
  const fetchRace = useCallback(async () => {
    if (!raceId || !sessionTokenRef.current || fetchInFlightRef.current) return;
    fetchInFlightRef.current = true;
    try {
      const detailRes = await authFetch(`/api/races/${raceId}`);
      if (detailRes.ok) {
        markLiveRaceFetched(`${raceId}:detail`);
        const data = await detailRes.json() as { race?: RaceData; participants?: RaceParticipant[] };
        const parts = Array.isArray(data.participants) ? data.participants : [];
        setRace(data.race ?? null);
        if (data.race?.status === "in_progress" || data.race?.status === "completed") {
          raceAlreadyStartedRef.current = true;
        }
        setParticipants(parts);
        hydrateInProgressRace(data.race, parts);
        if (data.race?.status === "completed") {
          const me = parts.find(
            (p) =>
              p.userId === user?.id ||
              (!!user?.username && p.username.toLowerCase() === user.username.toLowerCase()),
          );
          if (!raceCompletedRef.current) {
            finalizeLiveRace(me?.currentSteps);
          } else if (me?.currentSteps != null) {
            const reconciled = Math.max(finalRaceSteps ?? 0, me.currentSteps);
            if (reconciled > 0) setFinalRaceSteps(reconciled);
          }
        }
        if (typeof data.race?.targetSteps === "number" && data.race.targetSteps > 0) {
          setRaceTargetStepsRef.current(data.race.targetSteps);
        }
        if (isTrackLayoutId(data.race?.trackLayout)) {
          setTrackLayoutId(data.race.trackLayout);
        }
        if (data.race) {
          void screenCache.set(liveRaceDetailCacheKey(raceId), { race: data.race, participants: parts });
        }
        setLoading(false);
      }
      void Promise.all([
        authFetch(`/api/races/${raceId}/comments`),
        authFetch(`/api/races/${raceId}/reactions`),
      ]).then(async ([commentsRes, reactionsRes]) => {
        if (commentsRes.ok) {
          const body = await commentsRes.json() as { comments?: RaceCommentPayload[] };
          const normalized = Array.isArray(body.comments)
            ? body.comments.map(normalizeIncomingComment).filter((c): c is RaceComment => c !== null)
            : [];
          setComments(normalized);
        }
        if (reactionsRes.ok) {
          const body = await reactionsRes.json() as { reactions?: ReactionCount[] };
          setReactionCounts(Array.isArray(body.reactions) ? body.reactions : []);
        }
      }).catch(() => {});
    } finally {
      fetchInFlightRef.current = false;
    }
  }, [raceId, hydrateInProgressRace]);

  useEffect(() => {
    if (!raceId || !sessionToken) return;
    const isNewRace = loadedRaceIdRef.current !== raceId;
    if (isNewRace) {
      loadedRaceIdRef.current = raceId;
      resetLiveRaceFetchGate(raceId);
      prevStepsMapRef.current = {};
      setStepDeltaFlash({});
      resetForRace(raceId);
      raceAlreadyStartedRef.current = false;
      raceResumedRef.current = false;
      raceCompletedRef.current = false;

      const cached = screenCache.getSync<LiveRaceDetailCache>(liveRaceDetailCacheKey(raceId));
      if (cached?.race) {
        setRace(cached.race);
        setParticipants(cached.participants);
        if (isTrackLayoutId(cached.race.trackLayout)) {
          setTrackLayoutId(cached.race.trackLayout);
        }
        if (cached.race.status === "in_progress" || cached.race.status === "completed") {
          raceAlreadyStartedRef.current = true;
        }
        setLoading(false);
      } else {
        setLoading(true);
      }
    }
    fetchRace().finally(() => setLoading(false));
  }, [raceId, sessionToken, fetchRace, resetForRace]);

  useEffect(() => {
    return () => {
      if (raceId) resetLiveRaceFetchGate(raceId);
    };
  }, [raceId]);

  // ── Completion-poll fallback ────────────────────────────────────────────────
  // If elapsed >= 60s and race is still "in_progress", the Pusher completion
  // event may have been missed. Poll every 3s until backend confirms completion.
  // Use a boolean threshold so this effect only re-runs once (false → true),
  // not every second — otherwise the interval is cleared before it can fire.
  const shouldPoll = isActive && elapsed >= 60;
  useEffect(() => {
    if (!shouldPoll || !sessionToken) return;
    const id = setInterval(() => {
      fetchRaceDetails().catch(() => {});
    }, STEP_SYNC_CONFIG.LIVE_RACE_COMPLETION_POLL_MS);
    return () => clearInterval(id);
  }, [shouldPoll, fetchRaceDetails, sessionToken]);

  // Periodic participant refresh — Pusher-first; gated HTTP fallback only.
  useEffect(() => {
    if (!isActive || !raceId || race?.status !== "in_progress" || !sessionToken) return;
    const id = setInterval(() => {
      void fetchRaceDetails(false, {
        gateKey: `${raceId}:participants`,
        minIntervalMs: STEP_SYNC_CONFIG.LIVE_RACE_PARTICIPANTS_POLL_MS,
      });
    }, STEP_SYNC_CONFIG.LIVE_RACE_PARTICIPANTS_POLL_MS);
    return () => clearInterval(id);
  }, [isActive, raceId, race?.status, sessionToken, fetchRaceDetails]);

  // ── Spectator heartbeat ───────────────────────────────────────────────────
  // All viewers (participants + spectators) register every 60s for watch count.
  useEffect(() => {
    if (!raceId || !isActive) return;

    let cancelled = false;
    let inFlight = false;
    const gateKey = `${raceId}:spectate`;
    const heartbeatMs = STEP_SYNC_CONFIG.LIVE_RACE_SPECTATE_HEARTBEAT_MS;

    const postSpectate = async () => {
      if (cancelled || inFlight || !sessionTokenRef.current) return;
      if (!liveRaceFetchAllowed(gateKey, heartbeatMs)) return;

      inFlight = true;
      try {
        const res = await authFetch(`/api/races/${raceId}/spectate`, { method: "POST" });
        if (cancelled) return;
        if (res.ok) {
          markLiveRaceFetched(gateKey);
          const body = await res.json() as { count?: number };
          if (typeof body.count === "number") setSpectatorCount(body.count);
        }
      } catch {
        // silent — watch count is best-effort
      } finally {
        inFlight = false;
      }
    };

    void postSpectate();
    const id = setInterval(() => void postSpectate(), heartbeatMs);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [raceId, isActive]);

  // ── Cheer toast helper ────────────────────────────────────────────────────
  const showCheerToast = useCallback((text: string) => {
    setCheerToast(text);
    if (cheerToastTimerRef.current) clearTimeout(cheerToastTimerRef.current);
    cheerToastTimerRef.current = setTimeout(() => setCheerToast(null), 2000); }, []);

  useEffect(() => {
    return () => { if (cheerToastTimerRef.current) clearTimeout(cheerToastTimerRef.current); }; }, []);

  // Clean up all pending step-delta flash timers on unmount
  useEffect(() => {
    return () => {
      Object.values(stepDeltaTimersRef.current).forEach(clearTimeout);
    };
  }, []);

  const fetchRaceDetailsRef = useRef(fetchRaceDetails);
  fetchRaceDetailsRef.current = fetchRaceDetails;

  const raceRef = useRef(race);
  raceRef.current = race;
  const participantsRef = useRef(participants);
  participantsRef.current = participants;
  const currentUserIdRef = useRef(currentUserId);
  currentUserIdRef.current = currentUserId;
  const raceProgressRef = useRef(raceProgress);
  raceProgressRef.current = raceProgress;
  const finalizeLiveRaceRef = useRef(finalizeLiveRace);
  finalizeLiveRaceRef.current = finalizeLiveRace;

  // ── Pusher subscription ───────────────────────────────────────────────────
  useEffect(() => {
    if (!raceId) return;
    connectPusher();
    const channelName = `public-live-race-${raceId}`;
    const channel = subscribeToChannel(channelName);
    if (!channel) return;
    stepEngineLog("Pusher", `connected=true channel=${channelName}`);
    stepEngineLog("LiveRace", `realtimeSubscribed=true raceId=${raceId}`);

    const refresh = (force = false) => {
      debounceKeyed(`race-detail:${raceId}`, () => {
        void fetchRaceDetailsRef.current(force);
      }, 400);
    };

    const flushFinalSteps = () => {
      if (!raceId) return;
      const steps = localStepsRef.current;
      if (steps <= 0) return;
      void raceStepSyncService.flushGoal(
        raceId,
        steps,
        stepProviderManager.toRaceProgressSource(),
      );
    };

    const onCompleted = (data?: {
      endedReason?: string;
      challengeType?: string;
      results?: Array<{ userId?: string; prizeCoins?: number; currentSteps?: number }>;
    }) => {
      flushFinalSteps();
      const meResult = currentUserId ? data?.results?.find((r) => r.userId === currentUserId) : undefined;
      finalizeLiveRaceRef.current(
        meResult?.currentSteps ?? localStepsRef.current,
        data?.results,
      );
      if (data?.endedReason) setForfeitReason(data.endedReason);
      setRace((prev) => prev ? { ...prev, status: "completed", completedAt: prev.completedAt ?? new Date().toISOString() } : prev);
      if (data?.challengeType === "coins_battle" && Array.isArray(data.results)) {
        // Store prizes for ALL participants so the finished card can show each person's prize
        const map = new Map<string, number>();
        for (const r of data.results) {
          if (r.userId && (r.prizeCoins ?? 0) > 0) map.set(r.userId, r.prizeCoins!);
        }
        if (map.size > 0) setPusherPrizeMap(map);
        // Also keep the current-user banner amount for backward compat
        if (currentUserId) {
          const myResult = data.results.find((r) => r.userId === currentUserId);
          if (myResult && (myResult.prizeCoins ?? 0) > 0) setCoinWinAmount(myResult.prizeCoins!);
        }
      }
      refresh(true); };
    const onProgress = (data: { participantId?: string; userId?: string; steps?: number; rank?: number }) => {
      if (raceCompletedRef.current || raceRef.current?.status === "completed") return;
      if (typeof data.steps !== "number") return;
      const newSteps = data.steps;
      const uid = data.userId ?? data.participantId ?? "";
      const meId = currentUserIdRef.current;
      if (uid === meId && countdownActiveRef.current) return;

      stepEngineLog(
        "Pusher",
        `raceStepEvent raceId=${raceId} userId=${uid} steps=${newSteps}`,
      );

      if (uid === meId) {
        const target = raceRef.current?.targetSteps ?? 10_000;
        const cappedSteps = Math.min(target, Math.max(0, newSteps));
        updateRankFromBackend({
          raceSteps: cappedSteps,
          rank: data.rank,
          totalParticipants:
            raceRef.current?.currentPlayers ??
            participantsRef.current.length ??
            raceProgressRef.current.totalParticipants ??
            undefined,
          goalSteps: raceRef.current?.targetSteps,
        });
      }

      // Step delta + animator feed so other participants see catch-up after background sync.
      if (uid && newSteps > 0 && uid !== meId) {
        const prev = prevStepsMapRef.current[uid] ?? 0;
        const delta = newSteps - prev;
        if (delta <= 0) {
          stepEngineLog("Realtime", `ignoredDuplicate=true userId=${uid} steps=${newSteps}`);
        } else {
          setConfirmedSteps(uid, newSteps, { instant: delta >= 20 });
          setStepDeltaFlash((f) => ({ ...f, [uid]: delta }));
          if (stepDeltaTimersRef.current[uid]) clearTimeout(stepDeltaTimersRef.current[uid]);
          stepDeltaTimersRef.current[uid] = setTimeout(() => {
            setStepDeltaFlash((f) => { const n = { ...f }; delete n[uid]; return n; });
          }, 2000);
        }
        prevStepsMapRef.current[uid] = Math.max(prev, newSteps);
      }

      setParticipants((prev) => {
        const { next, changed } = applyParticipantProgressEvent(prev, data, {
          currentUserId: meId,
          targetSteps: raceRef.current?.targetSteps,
          raceCompleted: raceCompletedRef.current,
        });
        if (changed) {
          stepEngineLog(
            "LiveRace",
            `normalizedParticipantCount=${next.length} allSectionsSynced=true`,
          );
        }
        return changed ? next : prev;
      });
    };
    const onComment = (data: RaceCommentPayload) => {
      const comment = normalizeIncomingComment(data);
      if (!comment) return;
      setComments((prev) => mergeOrAppendComment(prev, comment));
      setTimeout(() => cheerScrollRef.current?.scrollToEnd({ animated: true }), 50);
      showCheerToast(`${comment.countryFlag ?? ""} ${comment.username}: ${comment.text}`.trim()); };
    const onReaction = (data: { counts?: ReactionCount[] }) => {
      if (Array.isArray(data.counts)) setReactionCounts(data.counts); };
    const onSpectatorCount = (data: { count?: number }) => {
      if (typeof data.count === "number") setSpectatorCount(data.count); };

    const onStarted = () => {
      if (raceAlreadyStartedRef.current || raceRef.current?.status === "in_progress") {
        raceAlreadyStartedRef.current = true;
        void fetchRaceDetailsRef.current(true);
        return;
      }
      triggerCountdown();
      setTimeout(() => {
        void fetchRaceDetailsRef.current(true);
      }, 250);
    };

    const onFinishedGoal = (data: {
      raceId?: string; userId?: string; username?: string;
      currentSteps?: number; targetSteps?: number;
      finishRank?: number; finishedAt?: string;
    }) => {
      if (!data.username || typeof data.finishRank !== "number") return;
      const rank = data.finishRank;
      const ordinal = rank === 1 ? "1st" : rank === 2 ? "2nd" : rank === 3 ? "3rd" : `${rank}th`;
      const emoji = rank === 1 ? "🏁" : rank === 2 ? "🥈" : rank === 3 ? "🥉" : "🏅";
      const msgText = `finished goal in ${ordinal} place ${emoji}`;
      const username = data.username;
      const userId = data.userId ?? `finish-${rank}`;

      if (__DEV__) console.log(
        `[RaceFinish] user reached goal: ${username}` +
        `  finishRank:${rank}  currentSteps:${data.currentSteps}` +
        `  targetSteps:${data.targetSteps}  finishedAt:${data.finishedAt}`,
      );

      if (data.userId === currentUserId) {
        const finalSteps = Math.max(
          localStepsRef.current,
          data.currentSteps ?? 0,
        );
        if (raceId && finalSteps > 0) {
          void raceStepSyncService.flushGoal(
            raceId,
            finalSteps,
            stepProviderManager.toRaceProgressSource(),
          );
        }
      }

      const syntheticComment: RaceComment = {
        id: `finish-goal-${raceId}-${userId}`,
        userId,
        username,
        countryFlag: "",
        avatarColor: rank === 1 ? "#FFD700" : rank === 2 ? "#C0C0C0" : rank === 3 ? "#CD7F32" : "#00E676",
        text: msgText,
        createdAt: data.finishedAt ?? new Date().toISOString(),
        status: "sent",
      };

      setComments((prev) => {
        // Deduplicate — one finish message per participant per race
        if (prev.some((c) => c.id === syntheticComment.id)) return prev;
        return [...prev, syntheticComment].slice(-60);
      });
      setTimeout(() => cheerScrollRef.current?.scrollToEnd({ animated: true }), 50);

      // Show queued top banner (deduped, sequenced with other banners)
      const ordinalText = rank === 1 ? "1st" : rank === 2 ? "2nd" : rank === 3 ? "3rd" : `${rank}th`;
      const isMe = data.userId === currentUserId;
      enqueueBanner({
        id: `finish-goal-${raceId}-${data.userId ?? rank}`,
        type: "finish_goal",
        headline: "FINISH!",
        username,
        body: `completed the goal in ${ordinalText} place!`,
        isMe,
        emoji,
        isGold: rank === 1,
        haptic: "success",
        durationMs: 4000,
      });

      showCheerToast(`${username} finished goal in ${ordinal} place ${emoji}`);
    };

    const refreshParticipants = () => refresh(true);
    channel.bind("race:started",          onStarted);
    channel.bind("race:player-joined",    refreshParticipants);
    channel.bind("race:player-left",           refreshParticipants);
    channel.bind("race:participant_left",      refreshParticipants);
    channel.bind("race:participant-forfeited", refreshParticipants);
    channel.bind("race:progress_updated", onProgress);
    channel.bind("race:comment_new",      onComment);
    channel.bind("race:reaction_updated", onReaction);
    channel.bind("race:completed",        onCompleted);
    channel.bind("race:winners",          refresh);
    channel.bind("race:spectator_count",  onSpectatorCount);
    channel.bind("participant_finished_goal", onFinishedGoal);

    return () => {
      channel.unbind("race:started",          onStarted);
      channel.unbind("race:player-joined",    refreshParticipants);
      channel.unbind("race:player-left",           refreshParticipants);
      channel.unbind("race:participant_left",      refreshParticipants);
      channel.unbind("race:participant-forfeited", refreshParticipants);
      channel.unbind("race:progress_updated", onProgress);
      channel.unbind("race:comment_new",      onComment);
      channel.unbind("race:reaction_updated", onReaction);
      channel.unbind("race:completed",        onCompleted);
      channel.unbind("race:winners",          refresh);
      channel.unbind("race:spectator_count",  onSpectatorCount);
      channel.unbind("participant_finished_goal", onFinishedGoal);
      unsubscribeFromChannel(channelName); }; }, [raceId]);

  // ── Cheer send ────────────────────────────────────────────────────────────
  const sendMessage = useCallback((text: string, isQuickReaction = false) => {
    if (!raceId || !isActive || !text.trim()) return;
    const trimmed = text.trim();

    // Per-button 1-second cooldown for quick reactions
    if (isQuickReaction) {
      const now = Date.now();
      const last = reactionCooldownRef.current[trimmed] ?? 0;
      if (now - last < 1000) return;
      reactionCooldownRef.current[trimmed] = now;
    }

    // Generate a stable client-side ID for this message
    const clientMsgId = `opt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

    // Find sender's profile data from participants
    const me = participants.find((p) => p.userId === currentUserId);
    const myAvatarUrl = user?.profileImageUrl ?? null;

    // Immediately add optimistic message
    const optimistic: RaceComment = {
      id: `optimistic-${clientMsgId}`,
      userId:        currentUserId ?? "",
      username:      me?.username ?? user?.username ?? "You",
      countryFlag:   me?.countryFlag ?? user?.countryFlag ?? "",
      avatarColor:   me?.avatarColor ?? user?.avatarColor ?? "#00E676",
      avatarUrl:     myAvatarUrl,
      avatarVersion: me?.avatarVersion ?? user?.avatarVersion ?? null,
      text:          trimmed,
      createdAt:     new Date().toISOString(),
      clientMessageId: clientMsgId,
      status:        "sending",
      isOptimistic:  true,
    };
    setComments((prev) => [...prev, optimistic].slice(-60));
    setTimeout(() => cheerScrollRef.current?.scrollToEnd({ animated: true }), 50);

    // Fire-and-forget POST in background
    void (async () => {
      try {
        const res = await authFetch(`/api/races/${raceId}/comments`, {
          method: "POST",
          body: JSON.stringify({ text: trimmed, clientMessageId: clientMsgId }),
        });
        if (res.ok) {
          const body = await res.json().catch(() => null) as { comment?: RaceComment } | null;
          if (body?.comment) {
            const normalized = normalizeIncomingComment({ ...body.comment, clientMessageId: clientMsgId });
            if (normalized) setComments((prev) => mergeOrAppendComment(prev, normalized));
          }
        } else {
          setComments((prev) => prev.map((c) => c.clientMessageId === clientMsgId ? { ...c, status: "failed" } : c));
        }
      } catch {
        setComments((prev) => prev.map((c) => c.clientMessageId === clientMsgId ? { ...c, status: "failed" } : c));
      }
    })();
  }, [raceId, isActive, participants, currentUserId, user]);

  const handleSendCheer = useCallback(() => {
    if (!cheerText.trim()) return;
    const text = cheerText.trim();
    setCheerText("");
    sendMessage(text);
  }, [cheerText, sendMessage]);

  const handleReact = useCallback(async (emoji: string) => {
    if (!raceId || !isActive) return;
    // Optimistic update — show the bump immediately, API response will confirm
    setReactionCounts((prev) => {
      const existing = prev.find((c) => c.emoji === emoji);
      if (existing) return prev.map((c) => c.emoji === emoji ? { ...c, count: c.count + 1 } : c);
      return [...prev, { emoji, count: 1 }];
    });
    try {
      const res = await authFetch(`/api/races/${raceId}/reactions`, {
        method: "POST",
        body: JSON.stringify({ emoji }),
      });
      if (res.ok) {
        const body = await res.json().catch(() => null) as { counts?: ReactionCount[] } | null;
        // Replace with authoritative server counts
        if (Array.isArray(body?.counts)) setReactionCounts(body!.counts!);
      }
    } catch { /* silent — optimistic update stays */ }
  }, [raceId, isActive]);

  // ── Loading / not found ───────────────────────────────────────────────────
  if (loading) {
    return <SkeletonLiveDetail />;
  }
  if (!race) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 8, padding: 24, backgroundColor: "#050711" }}>
        <Text style={{ color: "#FFFFFF", fontSize: 18, fontWeight: "800" }}>Race not found</Text>
        <TouchableOpacity style={{ borderRadius: 14, paddingHorizontal: 24, paddingVertical: 12, backgroundColor: "#00E676" }} onPress={() => router.back()}>
          <Text style={{ color: "#000", fontWeight: "700" }}>Go Back</Text>
        </TouchableOpacity>
      </View>
    ); }

  if (currentParticipant?.status === "forfeited" && isActive) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 12, padding: 32, backgroundColor: "#050711" }}>
        <Text style={{ fontSize: 40 }}>🚩</Text>
        <Text style={{ color: "#FF4444", fontSize: 20, fontWeight: "800" }}>You Quit This Race</Text>
        <Text style={{ color: "#888", fontSize: 14, textAlign: "center", lineHeight: 20 }}>
          You forfeited this race. You can watch other races or start a new one.
        </Text>
        <TouchableOpacity
          style={{ marginTop: 8, borderRadius: 14, paddingHorizontal: 28, paddingVertical: 13, backgroundColor: "#00E676" }}
          onPress={() => router.back()}
        >
          <Text style={{ color: "#000", fontWeight: "700", fontSize: 15 }}>Back to Races</Text>
        </TouchableOpacity>
      </View>
    ); }

  const participantValue = `${participants.length || race.currentPlayers}/${race.maxPlayers}`;
  const trackMedia = {
    code: trackLayoutId,
    trackLayout: trackLayoutId,
    imageSet: race.imageSet ?? null,
    imageUrl: race.imageUrl ?? null,
    assetVersion: race.assetVersion,
    width: race.width,
    height: race.height,
  };

  // ── Race Finished banner (shared) ─────────────────────────────────────────
  const allForfeited    = forfeitReason === "all_forfeited";
  const winnerByForfeit = forfeitReason === "winner_by_forfeit";
  const sponsoredMeQualified =
    !!currentParticipant &&
    (
      currentParticipant.eligibleForPrize === true ||
      currentParticipant.isWinner === true ||
      (currentParticipant.prizeAmount ?? 0) > 0
    );
  const FinishedBanner = isCompleted && !bannerDismissed ? (
    <View style={[s.finishedBanner]}>
      <View style={s.finishedBannerHeader}>
        <Text style={{ fontSize: 22 }}>{allForfeited ? "🚩" : "🏆"}</Text>
        <Text style={s.finishedBannerTitle}>
          {allForfeited ? "No Winners — All Forfeited" : "Race Finished"}
        </Text>
        <TouchableOpacity onPress={() => setBannerDismissed(true)} style={s.bannerClose} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Feather name="x" size={18} color="#888" />
        </TouchableOpacity>
      </View>
      {isSponsored && currentParticipant ? (
        <View style={s.sponsoredFinishBody}>
          <Text style={s.sponsoredFinishMsg}>
            {sponsoredMeQualified
              ? "Congratulations! You reached the target steps and qualified for the event reward"
              : "Oops! Target steps not completed, so you’re not eligible for this event’s reward. Better luck next time—keep walking!"}
          </Text>
        </View>
      ) : (
        <>
      {allForfeited && (
        <Text style={{ color: "#9CA3AF", fontSize: 13, paddingHorizontal: 4, paddingBottom: 4 }}>
          Match ended — all participants forfeited. No winners were declared.
        </Text>
      )}
      {winners.map((w, i) => {
        const rank = w.displayRank ?? w.rank ?? (i + 1);
        const rankNum = rank === 1 ? "#1" : rank === 2 ? "#2" : `#${rank}`;
        const tiedInGroup = w.isTied && (w.tieGroupSize ?? 1) > 1;
        const rankCrown = rank === 1 ? "👑" : rank === 2 ? "🥈" : "🥉";
        const badgeColor = rank === 1 ? "#F59E0B" : rank === 2 ? "#9CA3AF" : "#CD7C2E";
        let badgeLabel: string;
        const winnerSlotsFin = getWinnerCount(race.currentPlayers);
        if (tiedInGroup) badgeLabel = `Tied ${rankNum} 🤝`;
        else if (winnerByForfeit && rank === 1) badgeLabel = "Won by Forfeit 🏳️";
        else badgeLabel = rank <= winnerSlotsFin ? `${rankNum} Winner` : `${rankNum} Place`;

        // Per-rank free coin amounts (combined if tied, zero for non-prize ranks)
        const freeCoins = (() => {
          const FREE_TIERS = [50, 30, 20];
          const wSlots = getWinnerCount(race.currentPlayers);
          if (rank > wSlots) return 0; // not a prize-eligible rank
          if (!tiedInGroup) return FREE_TIERS[rank - 1] ?? 0;
          let pool = 0;
          for (let s = 0; s < (w.tieGroupSize ?? 1); s++) pool += FREE_TIERS[(rank - 1) + s] ?? 0;
          return Math.floor(pool / (w.tieGroupSize ?? 1));
        })();

        return (
          <View key={`${w.userId}-${i}`} style={s.winnerRow}>
            <Text style={s.winnerCrown}>{rankCrown}</Text>
            <View style={[s.winnerAv, { backgroundColor: (w.avatarColor ?? "#00E676") + "25", borderColor: w.avatarColor ?? "#00E676" }]}>
              {w.userId ? (
                <Image
                  source={{ uri: `${getApiBase()}/api/profile/avatar/${w.userId}?v=${getAvatarVersion(w.userId, w.avatarVersion ?? 0)}` }}
                  style={s.winnerAvImg}
                />
              ) : (
                <Text style={[s.winnerAvTxt, { color: w.avatarColor ?? "#00E676" }]}>{w.username.charAt(0).toUpperCase()}</Text>
              )}
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.winnerName}>@{w.username} {w.countryFlag}</Text>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
                <BlueShoe size={12} />
                <Text style={s.winnerSteps}>
                  {resolveParticipantRaceSteps(w, w.userId === user?.id).toLocaleString()} steps
                </Text>
              </View>
              {race.entryType === "free"
                ? freeCoins > 0
                    ? <View style={{ flexDirection: "row", alignItems: "center", gap: 3, marginTop: 2 }}>
                        <Image source={require("../../assets/images/game-coin.png")} style={{ width: 13, height: 13 }} />
                        <Text style={s.winnerPrize}>{freeCoins} coins{tiedInGroup ? " (split)" : ""}</Text>
                      </View>
                    : null
                : race.entryType === "coins_battle"
                ? (() => {
                    // Prize resolution order:
                    // 1. DB-confirmed prizeCoins on participant (most accurate)
                    // 2. Pusher race:completed event (all-participant map, fires before DB write completes)
                    // 3. Current-user coinWinAmount (legacy single-user fallback)
                    // 4. Calculated from known prize pool × split ratio for this rank
                    const rankIdx = (w.displayRank ?? w.rank ?? 1) - 1;
                    const winnersPool = race.coinWinnersPool && race.coinWinnersPool > 0
                      ? race.coinWinnersPool
                      : (race.coinPrizePool ?? 0);
                    const splits = coinsPrizeSplits(race.currentPlayers);
                    const calcCoins = rankIdx < splits.length && winnersPool > 0
                      ? Math.floor(winnersPool * splits[rankIdx])
                      : 0;
                    const displayCoins =
                      (w.prizeCoins ?? 0) > 0 ? w.prizeCoins! :
                      pusherPrizeMap.get(w.userId) ??
                      (w.userId === currentUserId && coinWinAmount !== null ? coinWinAmount : null) ??
                      calcCoins;
                    return displayCoins > 0
                      ? <View style={{ flexDirection: "row", alignItems: "center", gap: 3, marginTop: 2 }}>
                          <Image source={require("../../assets/images/game-coin.png")} style={{ width: 13, height: 13 }} />
                          <Text style={s.winnerPrize}>{fmtCoins(displayCoins)} coins{tiedInGroup ? " (split)" : ""}</Text>
                        </View>
                      : null;
                  })()
                : (() => {
                    const prize = w.prizeAmount != null && w.prizeAmount > 0 ? w.prizeAmount : 0;
                    return prize > 0 ? <Text style={s.winnerPrize}>💰 ${prize.toFixed(2)}{tiedInGroup ? " (split)" : ""}</Text> : null;
                  })()
              }
            </View>
            <View style={[s.winnerBadge, { backgroundColor: badgeColor + "22", borderColor: badgeColor + "66", borderWidth: 1 }]}>
              <Text style={[s.winnerBadgeTxt, { color: badgeColor }]}>{badgeLabel}</Text>
            </View>
          </View>
        );
      })}
        </>
      )}
    </View>
  ) : null;

  return (
    <View style={{ flex: 1 }}>
    <KeyboardAvoidingView
      style={st.screen}
      behavior="padding"
      keyboardVerticalOffset={0}
    >
      {/* ── Header ── */}
      <View style={[s.header, { paddingTop: safeTop + 6 }]}>
        <TouchableOpacity
          style={s.backBtn}
          onPress={() => {
            // Navigate immediately — do not await voice/step teardown (was causing multi-second lag).
            router.back();
          }}
        >
          <Feather name="chevron-left" size={25} color="#fff" />
        </TouchableOpacity>
        <View style={s.hCenter}>
          {isActive  && <Text style={[s.hLive, isSponsored && s.hLiveSponsored]}>LIVE </Text>}
          {isCompleted && <Text style={[s.hLive, isSponsored && s.hLiveSponsored, { color: "#FFD700" }]}>FINISHED </Text>}
          <Text
            style={[s.hTitle, isSponsored && s.hTitleSponsored]}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.72}
          >
            {headerRaceTitle}
          </Text>
        </View>
        {currentParticipant && isActive && currentParticipant.status !== "forfeited" ? (
          <TouchableOpacity activeOpacity={0.85} onPress={() =>
            AppAlert.alert("Forfeit Race?", "Forfeiting counts as a loss. The remaining player will be declared the winner immediately.", [
              { text: "Cancel" },
              { text: "Forfeit", style: "destructive", onPress: async () => {
                try {
                  await authFetch(`/api/races/${raceId}/leave`, {
                    method: "POST",
                    body: JSON.stringify({ reason: "user_quit" }),
                  });
                } catch { /* best-effort */ }
                if (raceId) {
                  void suppressLiveRaceNotification(raceId, "user_forfeit");
                  stopRaceStepTracking("user_forfeit");
                }
                router.back();
              }},
            ]) }>
            <LinearGradient colors={["#FF3333", "#BB0000"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={s.leaveBtn}>
              <Text style={s.leaveTxt}>Forfeit</Text>
              <Feather name="log-out" size={12} color="#fff" />
            </LinearGradient>
          </TouchableOpacity>
        ) : (
          <View style={s.headerSpacer} />
        )}
      </View>

      {/* ── Fixed-height single-text rotator: 5s hold → fade → swap → fade ── */}
      {!isCompleted ? (
        <View style={s.taglineSlot}>
          <RNAnimated.View style={[s.taglineInner, { opacity: taglineOpacity }]}>
            {taglineMode === "alt" && taglineAlt?.kind === "ends" ? (
              <View style={s.endsPill}>
                <Feather name="calendar" size={13} color="#FFFFFF" />
                <ChallengeEndsPillLabel label={taglineAlt.label} style={s.endsPillText} />
              </View>
            ) : taglineMode === "alt" && taglineAlt?.kind === "sponsored" ? (
              <View style={s.endsPill}>
                <Feather name="clock" size={13} color="#FFFFFF" />
                <SponsoredEventWindowLabel
                  startIso={taglineAlt.start}
                  endIso={taglineAlt.end}
                  style={s.endsPillText}
                />
              </View>
            ) : (
              <Text style={s.subtitle} numberOfLines={1}>
                Beat your friends. Hit your goal!
              </Text>
            )}
          </RNAnimated.View>
        </View>
      ) : null}

      {/* ── Info bar ── */}
      <View style={s.infoBar}>
        {[
          { icon: isActive ? "⏱" : isCompleted ? "🏁" : "•", label: infoTimeLabel, value: infoTimeValue, color: timerColor },
          { icon: "👥", label: "PARTICIPANTS", value: participantValue, color: undefined as string | undefined },
        ].map((card) => (
          <View key={card.label} style={s.infoCard}>
            <View style={s.infoRow}>
              <Text style={s.infoIcon}>{card.icon}</Text>
              <Text style={[s.infoLbl, card.color ? { color: card.color } : null]}>{card.label}</Text>
            </View>
            <Text style={[s.infoVal, card.color ? { color: card.color } : null]} numberOfLines={1}>{card.value}</Text>
          </View>
        ))}
      </View>

      {/* ── View toggle ── */}
      <RaceViewToggle
        selectedView={selectedView}
        onSelect={(v) => {
          if (v === "live_board" && isTrackFullscreen) setIsTrackFullscreen(false);
          setSelectedView(v);
        }}
        colors={colors}
      />

      {/* ══ Content area: race track always in normal flex flow ══ */}
      <View style={{ flex: 1, position: "relative" }}>

        {/* ── RACE TRACK — always rendered, never unmounted ── */}
        <View style={{ flex: 1 }}>
          {FinishedBanner}

          <View style={{ flex: 1, position: "relative" }}>
          <View
            style={[st.hero, { width: screenW, flex: 1, minHeight: rs(240) }]}
            onLayout={(e) => setHeroHeight(Math.max(rs(240), e.nativeEvent.layout.height))}
          >
            <Animated.View style={[StyleSheet.absoluteFill, trackAnimatedStyle]}>
              {/* Only the active theme — rendering every track bg made back-nav lag badly. */}
              <TrackThemeImageBackground
                key={`${trackLayoutId}:${race.assetVersion ?? 0}`}
                media={trackMedia}
                variant="full"
                contentFit="fill"
                style={[
                  StyleSheet.absoluteFill,
                  trackLayoutId === "bg1" && st.bg1Background,
                ]}
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
                  width={screenW}
                  height={heroHeight}
                  targetSteps={race.targetSteps}
                  finishZoneY={getFinishZoneY(trackLayoutId, heroHeight)}
                  themeId={trackLayoutId}
                  rsFactor={rsFactor}
                  isSpeakingVoice={visibleSpeakerIds.includes(player.userId)}
                  overrideSteps={player.isMe ? mySteps : undefined}
                  meAvatarUrl={user?.id && user?.profileImageUrl ? `${getApiBase()}/api/profile/avatar/${user.id}?v=${user?.avatarVersion ?? ''}` : null}
                  onPress={(uid) => {
                    const p = participants.find(pt => pt.userId === uid);
                    setProfileInitialData(p ? {
                      username: p.username,
                      country: null,
                      countryFlag: p.countryFlag ?? null,
                      avatarColor: p.avatarColor ?? null,
                      avatarUrl: p.avatarUrl ?? null,
                      avatarVersion: p.avatarVersion ?? 0,
                      isHost: p.isHost,
                      isCurrentUser: p.userId === currentUserId,
                      activeTitle: null,
                      friendStatus: "none",
                      friendRequestId: null,
                    } : undefined);
                    setProfileUserId(uid);
                  }}
                />
              ))}
              <Animated.View style={[st.syncPill, pulseStyle]} pointerEvents="none">
                <View style={st.syncDot} />
                <Text style={st.syncText}>Syncing…</Text>
              </Animated.View>
            </Animated.View>

            {selectedView === "race_track" && (
            <LeaderboardOverlay
              visible={isLeaderboardVisible}
              players={sortedPlayers}
              width={leaderboardW}
              height={heroHeight}
              animatedStyle={leaderboardAnimatedStyle}
              positionText={trackPositionText}
              statusText={trackStatusText}
              meAvatarUrl={user?.id && user?.profileImageUrl ? `${getApiBase()}/api/profile/avatar/${user.id}?v=${user?.avatarVersion ?? ''}` : null}
              rsFactor={rsFactor}
              locallyMutedUserIds={locallyMutedUserIds}
              onLocalMute={localMuteParticipant}
              onLocalUnmute={localUnmuteParticipant}
              showMuteControls={sortedPlayers.length > 1}
              isActiveRace={isActive}
            />
            )}

            {selectedView === "race_track" && (
              <TouchableOpacity
                activeOpacity={0.8}
                onPress={() => setIsTrackFullscreen((v) => !v)}
                style={st.zoomBtn}
              >
                <Feather
                  name={isTrackFullscreen ? "minimize-2" : "maximize-2"}
                  size={16}
                  color="#FFFFFF"
                />
              </TouchableOpacity>
            )}

          </View>

          {selectedView === "race_track" && (
            <TouchableOpacity
              activeOpacity={0.85}
              onPress={() => setIsLeaderboardVisible((v) => !v)}
              style={st.toggleHandle}
              accessibilityRole="button"
              accessibilityLabel={isLeaderboardVisible ? "Hide track position panel" : "Show track position panel"}
            >
              <Feather name={isLeaderboardVisible ? "chevron-right" : "chevron-left"} size={22} color="#FFFFFF" />
            </TouchableOpacity>
          )}

          </View>

        </View>

        {/* ── LIVE BOARD — only mounted when selected (avoids covering track toggle) ── */}
        {selectedView === "live_board" && (
        <View
          style={[StyleSheet.absoluteFill, { backgroundColor: "#050711" }]}
        >
          <ScrollView
            ref={scrollRef}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingBottom: 16, gap: 12, paddingTop: 4 }}
          >
            {FinishedBanner}
            <LiveBoardPanel
              race={race}
              participants={participants.map((p) => {
                const isMe = p.userId === currentUserId;
                const steps = resolveParticipantRaceSteps(p, isMe);
                return {
                  ...p,
                  currentSteps: getDisplaySteps(p.userId, steps),
                };
              })}
              currentUserId={currentUserId}
              stepDeltas={stepDeltaFlash}
              userAvatarUrl={user?.id && user?.profileImageUrl ? `${getApiBase()}/api/profile/avatar/${user.id}?v=${user?.avatarVersion ?? ''}` : null}
              onAvatarPress={(p) => {
                setProfileInitialData({
                  username: p.username,
                  country: null,
                  countryFlag: p.countryFlag ?? null,
                  avatarColor: p.avatarColor ?? null,
                  avatarUrl: p.avatarUrl ?? null,
                  avatarVersion: p.avatarVersion ?? 0,
                  isHost: p.isHost,
                  isCurrentUser: p.userId === currentUserId,
                  activeTitle: null,
                  friendStatus: "none",
                  friendRequestId: null,
                });
                setProfileUserId(p.userId);
              }}
              colors={colors}
            />
            <PrizePanel race={race} participants={participants} colors={colors} />
          </ScrollView>
        </View>
        )}
      </View>

      {/* ── Progress tracker — hidden in fullscreen so track fills more space ── */}
      {!isTrackFullscreen && <View style={[st.progSection, !isActive && { paddingBottom: safeBottom }]}>
        <View style={st.progLeft}>
          <BlueShoe size={rs(24)} />
          <View style={st.progMain}>
            <Text>
              <Text style={[st.progMine, { fontSize: rs(17) }]}>{formatSteps(mySteps)}</Text>
              <Text style={[st.progTarget, { fontSize: rs(13) }]}> / {formatSteps(race.targetSteps)} steps</Text>
            </Text>
            <View style={st.progBarBg}>
              <Animated.View style={[st.progBarFill, progressBarStyle]} />
            </View>
            <Text style={[st.progSub, { fontSize: Math.max(8, rs(9)) }]}>
              {myPlayer
                ? `Rank #${myPlayer.rank} · ${formatSteps(Math.max(0, race.targetSteps - mySteps))} steps to goal`
                : "Waiting for live race data"}
            </Text>
          </View>
          {race.entryType === "coins_battle" ? (
            <LivePrizeStrip race={race} colors={colors} />
          ) : (
            <Text style={[st.progPct, { fontSize: rs(15) }]}>{Math.round(myProgress * 100)}%</Text>
          )}
        </View>
      </View>}

      {/* ── Live chat + cheers — hidden in fullscreen mode ── */}
      {isActive && !isTrackFullscreen && (
        <>
          {/* Message feed */}
          <View style={[st.liveChatPanel, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={st.liveChatHeader}>
              <Text style={{ fontSize: 12 }}>💬</Text>
              <Text style={[st.liveChatTitle, { color: colors.mutedForeground }]}>Live Chat</Text>
              {spectatorCount > 0 && (
                <Text style={[st.liveChatTitle, { color: colors.mutedForeground, marginLeft: "auto" }]}>
                  👁 {spectatorCount} watching
                </Text>
              )}
            </View>
            <ScrollView
              ref={cheerScrollRef}
              style={st.liveChatScroll}
              showsVerticalScrollIndicator={false}
              onContentSizeChange={() => cheerScrollRef.current?.scrollToEnd({ animated: true })}
            >
              {comments.length === 0 ? (
                <Text style={[st.liveChatEmpty, { color: colors.mutedForeground }]}>No messages yet — be the first!</Text>
              ) : comments.slice(-20).map((cheer) => {
                const isFailed = cheer.status === "failed";
                const retryHandler = isFailed ? () => {
                  setComments((prev) => prev.filter((c) => c.clientMessageId !== cheer.clientMessageId));
                  sendMessage(cheer.text);
                } : undefined;
                const RowWrapper = isFailed ? TouchableOpacity : View;
                return (
                  <RowWrapper
                    key={cheer.id}
                    style={[st.liveChatRow, cheer.status === "sending" && { opacity: 0.55 }, isFailed && { opacity: 0.8 }]}
                    {...(isFailed ? { onPress: retryHandler, activeOpacity: 0.6 } : {})}
                  >
                    <View style={[st.liveChatAv, { backgroundColor: (cheer.avatarColor ?? colors.primary) + "22", borderColor: cheer.avatarColor ?? colors.primary }]}>
                      {cheer.userId ? (
                        <Image
                          source={{ uri: `${getApiBase()}/api/profile/avatar/${cheer.userId}?v=${getAvatarVersion(cheer.userId, cheer.avatarVersion ?? 0)}` }}
                          style={st.liveChatAvImg}
                        />
                      ) : (
                        <Text style={[st.liveChatAvTxt, { color: cheer.avatarColor ?? colors.primary }]}>{cheer.username.charAt(0).toUpperCase()}</Text>
                      )}
                    </View>
                    <View style={[st.liveChatBubble, { flex: 1 }]}>
                      <Text style={[st.liveChatName, { color: colors.primary }]}>{cheer.countryFlag} {cheer.username}</Text>
                      <Text style={[st.liveChatMsg, { color: colors.foreground }]}>{cheer.text}</Text>
                      {isFailed && (
                        <Text style={{ fontSize: 10, color: "#EF4444", marginTop: 2 }}>⚠ Failed — tap to retry</Text>
                      )}
                    </View>
                  </RowWrapper>
                );
              })}
            </ScrollView>
          </View>

          {/* Quick cheer buttons */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={[st.quickRow, { borderColor: colors.border }]}
            contentContainerStyle={st.quickContent}
          >
            {["🔥 Let's go!", "👏 Amazing!", "💪 Keep it up!", "👑 You got this!", "🏃 Go faster!", "😮 Wow!", "🎯 Almost there!"].map((msg) => (
              <TouchableOpacity
                key={msg}
                activeOpacity={0.75}
                style={[st.quickBtn, { backgroundColor: colors.primary + "18", borderColor: colors.primary + "40" }]}
                onPress={() => {
                  sendMessage(msg, true);
                  const leadingEmoji = [...msg][0];
                  if (REACTIONS.includes(leadingEmoji)) void handleReact(leadingEmoji);
                }}
              >
                <Text style={[st.quickTxt, { color: colors.primary }]}>{msg}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          {/* Reaction picker popup */}
          {showReactionPicker && (
            <View style={st.reactionBar}>
              {REACTIONS.map((emoji) => {
                const cnt = reactionCounts.find((c) => c.emoji === emoji)?.count ?? 0;
                return (
                  <TouchableOpacity key={emoji} activeOpacity={0.75} style={st.reactionBtn} onPress={() => handleReact(emoji)}>
                    <Text style={st.reactionEmoji}>{emoji}</Text>
                    {cnt > 0 && <Text style={st.reactionCount}>{cnt}</Text>}
                  </TouchableOpacity>
                ); })}
            </View>
          )}

          {/* Backdrop — closes the audio route capsule when tapping outside */}
          {showMicMenu && (
            <Pressable
              style={StyleSheet.absoluteFill}
              onPress={closeMicMenu}
              accessibilityLabel="Close audio menu"
            />
          )}

          {/* Text input */}
          <View style={[st.inputBar, { paddingBottom: Math.max(safeBottom, 12) }]}>
            {/* ── Inline voice mic control ── */}
            <View style={[st.micWrapper, { width: 52, height: 52 }]}>
              {/* ── CONNECTED STATE: vertical capsule panel + big button ── */}
              {(micState === "active" || micState === "muted") && (
                <>
                  {/* Floating capsule above the big button — only shown when mic menu is open */}
                  {showMicMenu && (
                    <View style={micPanelSt.floatAbove} pointerEvents="box-none">
                      <View style={micPanelSt.capsule}>

                        {/* ── Speaker ── */}
                        <TouchableOpacity
                          style={[micPanelSt.iconBtn, audioRoute === "speaker" && micPanelSt.iconBtnActive]}
                          onPress={selectSpeaker}
                          activeOpacity={0.75}
                        >
                          <Feather
                            name="volume-2"
                            size={15}
                            color={audioRoute === "speaker" ? "#818CF8" : "#6E7284"}
                          />
                        </TouchableOpacity>

                        <View style={micPanelSt.dot} />

                        {/* ── Bluetooth (only when a BT device is connected) ── */}
                        {bluetoothAvailable && (
                          <>
                            <TouchableOpacity
                              style={[micPanelSt.iconBtn, audioRoute === "bluetooth" && micPanelSt.iconBtnActive]}
                              onPress={selectBluetooth}
                              activeOpacity={0.75}
                            >
                              <MaterialCommunityIcons
                                name="bluetooth"
                                size={15}
                                color={audioRoute === "bluetooth" ? "#818CF8" : "#6E7284"}
                              />
                            </TouchableOpacity>
                            <View style={micPanelSt.dot} />
                          </>
                        )}

                        {/* ── Phone / Earpiece ── */}
                        <TouchableOpacity
                          style={[micPanelSt.iconBtn, audioRoute === "phone" && micPanelSt.iconBtnActive]}
                          onPress={selectPhone}
                          activeOpacity={0.75}
                        >
                          <Feather
                            name="phone"
                            size={15}
                            color={audioRoute === "phone" ? "#818CF8" : "#6E7284"}
                          />
                        </TouchableOpacity>

                        <View style={micPanelSt.dot} />

                        {/* ── Mute toggle ── */}
                        <TouchableOpacity
                          style={[micPanelSt.iconBtn, micState === "muted" && micPanelSt.iconBtnMuted]}
                          onPress={selectMute}
                          activeOpacity={0.75}
                        >
                          <Feather
                            name={micState === "muted" ? "mic" : "mic-off"}
                            size={15}
                            color={micState === "muted" ? "#F59E0B" : "#6E7284"}
                          />
                        </TouchableOpacity>

                      </View>

                      {/* Stem connecting capsule to big button */}
                      <View style={micPanelSt.stem} />
                    </View>
                  )}

                  {/* Pulsing outer ring — visible when speaking */}
                  {micState === "active" && (
                    <Animated.View
                      style={[micPanelSt.pulseRing, isSpeaking ? { borderColor: "#818CF8" } : { borderColor: "#5B5FFF50" }, micPulseRingStyle]}
                      pointerEvents="none"
                    />
                  )}

                  {/* Big glowing mic button — tap to toggle mute, long-press to open audio route picker */}
                  <TouchableOpacity
                    activeOpacity={0.85}
                    onPress={selectMute}
                    onLongPress={handleMicTap}
                    delayLongPress={350}
                    style={micPanelSt.bigBtn}
                  >
                    <View style={[micPanelSt.bigRing, micState === "muted" && { borderColor: "#F59E0B35" }]} />
                    <View style={[
                      micPanelSt.bigInner,
                      micState === "muted" && { borderColor: "#F59E0B60", backgroundColor: "#1E1408" },
                      micState === "active" && isSpeaking && { borderColor: "#818CF8", backgroundColor: "#13133A" },
                    ]}>
                      <Feather
                        name={micState === "muted" ? "mic-off" : "mic"}
                        size={22}
                        color={micState === "muted" ? "#F59E0B" : isSpeaking ? "#818CF8" : "#6366F1"}
                      />
                    </View>
                  </TouchableOpacity>
                </>
              )}

              {/* ── LISTENING STATE: headphones icon — auto-connected as listener ── */}
              {micState === "listening" && (
                <TouchableOpacity
                  activeOpacity={0.75}
                  style={[st.inputMicBtn, { backgroundColor: "rgba(99,102,241,0.12)" }]}
                  onPress={handleMicTap}
                >
                  <Feather name="headphones" size={20} color="#818CF8" />
                </TouchableOpacity>
              )}

              {/* ── CONNECTING STATE: spinner button — same 32×32 size as other states ── */}
              {micState === "connecting" && (
                <TouchableOpacity activeOpacity={0.75} style={[st.inputMicBtn, { backgroundColor: "rgba(99,102,241,0.10)" }]} onPress={() => {}}>
                  <Animated.View style={micConnStyle}>
                    <Feather name="loader" size={18} color="#A78BFA" />
                  </Animated.View>
                </TouchableOpacity>
              )}

              {/* ── IDLE / ERROR / LOCKED states: compact button ── */}
              {micState !== "active" && micState !== "muted" && micState !== "connecting" && micState !== "listening" && (
                <TouchableOpacity
                  activeOpacity={0.75}
                  style={[
                    st.inputMicBtn,
                    micState === "error" && { backgroundColor: "rgba(239,68,68,0.15)" },
                    micState === "unsupported_runtime" && { backgroundColor: "rgba(107,114,128,0.15)" },
                  ]}
                  onPress={handleMicTap}
                >
                  {!hasMicPass ? (
                    <View>
                      <Feather name="mic-off" size={20} color="#6B7280" />
                      <View style={st.lockBadge}><Feather name="lock" size={7} color="#6B7280" /></View>
                    </View>
                  ) : micState === "unsupported_runtime" ? (
                    <View>
                      <Feather name="mic-off" size={20} color="#6B7280" />
                      <View style={st.lockBadge}><Feather name="alert-circle" size={7} color="#6B7280" /></View>
                    </View>
                  ) : micState === "error" ? (
                    <Feather name="mic-off" size={20} color="#EF4444" />
                  ) : micState === "permission_denied" ? (
                    <Feather name="mic-off" size={20} color="#EF4444" />
                  ) : micState === "coming_soon" ? (
                    <Feather name="mic" size={20} color="#6B7280" />
                  ) : (
                    <Feather name="mic" size={20} color="#6EE7B7" />
                  )}
                </TouchableOpacity>
              )}
            </View>
            <TextInput
              style={st.inputField}
              value={cheerText}
              onChangeText={setCheerText}
              placeholder="Send a cheer..."
              placeholderTextColor="#6E7284"
              returnKeyType="send"
              onSubmitEditing={handleSendCheer}
            />
            <TouchableOpacity disabled={!cheerText.trim()} onPress={handleSendCheer}>
              <LinearGradient colors={["#7C3AED", "#A855F7"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={[st.sendBtn, !cheerText.trim() && st.sendBtnDisabled]}>
                <Text style={st.sendTxt}>Send</Text>
              </LinearGradient>
            </TouchableOpacity>
          </View>
        </>
      )}
    </KeyboardAvoidingView>

    {/* ── Cheer toast overlay (floating, 2s) ── */}
    {cheerToast !== null && (
      <View style={ctStyles.overlay} pointerEvents="none">
        <View style={ctStyles.pill}>
          <Text style={ctStyles.text} numberOfLines={2}>{cheerToast}</Text>
        </View>
      </View>
    )}

    {/* ── Countdown overlay ── */}
    {countdown !== null && (
      <View style={cdStyles.overlay} pointerEvents="box-only">
        <Text style={cdStyles.label}>RACE STARTING</Text>
        <Text style={cdStyles.number}>{countdown}</Text>
        <Text style={cdStyles.ready}>Get Ready!</Text>
      </View>
    )}


    {/* ── Mic Pass purchase modal ── */}
    <MicPassModal
      visible={showPurchaseModal}
      onClose={closePurchaseModal}
      onGranted={grantMicPass}
    />

    {/* ── Public profile modal ── */}
    <PublicProfileModal
      visible={!!profileUserId}
      userId={profileUserId}
      onClose={() => { setProfileUserId(null); setProfileInitialData(undefined); }}
      initialData={profileInitialData}
    />

    {/* ── Coins Battle win banner ── */}
    {coinWinAmount !== null && (
      <View pointerEvents="none" style={cwStyles.overlay}>
        <View style={cwStyles.card}>
          <Text style={cwStyles.emoji}>🎉</Text>
          <View>
            <Text style={cwStyles.title}>You Won!</Text>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 5, justifyContent: "center" }}>
              <Image source={require("../../assets/images/game-coin.png")} style={{ width: 18, height: 18 }} />
              <Text style={cwStyles.coins}>{fmtCoins(coinWinAmount)} coins</Text>
            </View>
            <Text style={cwStyles.sub}>added to your balance</Text>
          </View>
        </View>
      </View>
    )}
    </View>
  ); }

const cwStyles = StyleSheet.create({
  overlay: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "flex-end", paddingBottom: 80, zIndex: 100, pointerEvents: "none" },
  card:    { backgroundColor: "#1A1F36EE", borderRadius: 20, borderWidth: 1.5, borderColor: "#F59E0B66", paddingHorizontal: 28, paddingVertical: 18, alignItems: "center", gap: 6, shadowColor: "#F59E0B", shadowOpacity: 0.4, shadowRadius: 20, elevation: 20 },
  emoji:   { fontSize: 32 },
  title:   { fontSize: 22, fontWeight: "900", color: "#FFFFFF", textAlign: "center", marginBottom: 2 },
  coins:   { fontSize: 24, fontWeight: "800", color: "#F59E0B" },
  sub:     { fontSize: 12, color: "#9CA3AF", textAlign: "center", marginTop: 2 },
});

const ctStyles = StyleSheet.create({
  overlay: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center", zIndex: 50, pointerEvents: "none" },
  pill:    { backgroundColor: "#111421EE", borderRadius: 24, borderWidth: 1, borderColor: "#7C3AED80", paddingHorizontal: 20, paddingVertical: 12, maxWidth: "80%", alignItems: "center", shadowColor: "#7C3AED", shadowOpacity: 0.5, shadowRadius: 16, elevation: 16 },
  text:    { color: "#FFFFFF", fontSize: 15, fontWeight: "800", textAlign: "center" }, });

const cdStyles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#050711E8",
    alignItems: "center",
    justifyContent: "center",
    gap: 12, },
  label:  { fontSize: 13, color: "#FFFFFF99", fontWeight: "800", letterSpacing: 2 },
  number: { fontSize: 120, fontWeight: "900", color: "#00E676", letterSpacing: -4, lineHeight: 130 },
  ready:  { fontSize: 26, fontWeight: "800", color: "#FFFFFF" }, });


// ── Styles ────────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  header:      { paddingHorizontal: 12, paddingBottom: 2, flexDirection: "row", alignItems: "center" },
  backBtn:     { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  hCenter:     { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", minWidth: 0 },
  hLive:       { fontSize: 18, fontWeight: "900", color: "#00E676" },
  hLiveSponsored: { fontSize: 14 },
  hTitle:      { fontSize: 18, fontWeight: "900", color: "#FFFFFF", maxWidth: "62%", flexShrink: 1 },
  hTitleSponsored: { fontSize: 13, maxWidth: "78%", letterSpacing: -0.2 },
  hShoe:       { fontSize: 18 },
  leaveBtn:    { flexDirection: "row", alignItems: "center", paddingHorizontal: 12, paddingVertical: 7, borderRadius: 8 },
  leaveTxt:    { color: "#FFFFFF", fontSize: 13, fontWeight: "800", marginRight: 4 },
  headerSpacer: { width: 68 },
  infoBar:  { flexDirection: "row", paddingHorizontal: 12, gap: 8, height: 44, alignItems: "center" },
  infoCard: { flex: 1, backgroundColor: "#111421", borderRadius: 8, borderWidth: 1, borderColor: "#22263A", paddingHorizontal: 10, paddingVertical: 4 },
  infoRow:  { flexDirection: "row", alignItems: "center", gap: 4 },
  infoIcon: { fontSize: 11 },
  infoLbl:  { fontSize: 8, color: "#858A9C", fontWeight: "800", letterSpacing: 0.5 },
  infoVal:  { fontSize: 17, fontWeight: "900", color: "#FFFFFF", marginTop: 0 },

  bannerClose:          { marginLeft: "auto" as unknown as number, padding: 2 },
  finishedBanner:       { marginHorizontal: 12, marginTop: 8, borderRadius: 16, borderWidth: 1.5, padding: 14, gap: 10, backgroundColor: "#FFD70012", borderColor: "#FFD70044" },
  finishedBannerHeader: { flexDirection: "row", alignItems: "center", gap: 8 },
  finishedBannerTitle:  { fontSize: 17, fontWeight: "800", flex: 1, color: "#FFD700" },
  sponsoredFinishBody:  {
    backgroundColor: "rgba(0,0,0,0.28)",
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  sponsoredFinishMsg:   {
    color: "#F5F3FF",
    fontSize: 13.5,
    fontWeight: "600",
    lineHeight: 20,
  },
  finishedDuration:     { fontSize: 13, fontWeight: "600", color: "#888" },
  winnerRow:    { flexDirection: "row", alignItems: "center", gap: 10, borderRadius: 12, borderWidth: 1, padding: 10, backgroundColor: "#FFD70018", borderColor: "#FFD70044" },
  winnerCrown:  { fontSize: 20, color: "#FFD700" },
  winnerAv:     { width: 36, height: 36, borderRadius: 18, borderWidth: 1.5, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  winnerAvImg:  { width: 36, height: 36 },
  winnerAvTxt:  { fontSize: 14, fontWeight: "800" },
  winnerName:   { fontSize: 14, fontWeight: "700", color: "#FFFFFF" },
  winnerSteps:  { fontSize: 12, marginTop: 1, color: "#888" },
  winnerPrize:  { fontSize: 11, fontWeight: "700", color: "#FFD700", marginTop: 2 },
  winnerBadge:  { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, backgroundColor: "#FFD700" },
  winnerBadgeTxt: { fontSize: 10, fontWeight: "800", color: "#000" },
  taglineSlot: {
    marginTop: 2,
    marginBottom: 6,
    paddingHorizontal: 16,
    height: 40,
    justifyContent: "center",
    alignItems: "center",
    alignSelf: "center",
    width: "100%",
    overflow: "hidden",
  },
  taglineInner: {
    width: "100%",
    alignItems: "center",
    justifyContent: "center",
  },
  subtitle: {
    fontSize: 12,
    color: "#64748B",
    fontWeight: "500",
    textAlign: "center",
    lineHeight: 16,
    width: "100%",
  },
  endsPill: {
    alignSelf: "center",
    maxWidth: "100%",
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: "#1E1535",
    borderWidth: 1,
    borderColor: "#3D2A6B",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  endsPillText: {
    color: "#F5F3FF",
    fontSize: 11.5,
    fontWeight: "600",
    textAlign: "center",
    flexShrink: 1,
  },
});

const st = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#050711" },

  hero: { position: "relative", overflow: "hidden", borderTopWidth: 1, borderBottomWidth: 1, borderColor: "#171B2E", backgroundColor: "#02030A" },
  bg1Background: { transform: [{ translateY: 10 }] },

  syncPill: { position: "absolute", bottom: 10, left: 12, flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: "#0D0F1AE0", borderRadius: 20, borderWidth: 1, borderColor: "#2A2D3E", paddingHorizontal: 10, paddingVertical: 5, zIndex: 30 },
  syncDot:  { width: 6, height: 6, borderRadius: 3, backgroundColor: "#00E676" },
  syncText: { color: "#9EA5BC", fontSize: 10, fontWeight: "700", letterSpacing: 0.4 },

  runner:       { position: "absolute", alignItems: "center", justifyContent: "center", zIndex: 8 },
  runnerTrail:  { position: "absolute", width: 14, height: 46, borderRadius: 10, shadowOpacity: 0.9, shadowRadius: 9 },
  runnerAvatar: { alignItems: "center", justifyContent: "center", shadowOpacity: 0.95, shadowRadius: 11, elevation: 11, overflow: "hidden" },
  runnerInitial: { fontSize: 14, fontWeight: "900" },
  runnerRank:   { position: "absolute", alignItems: "center", justifyContent: "center" },
  runnerRankText: { color: "#050711", fontWeight: "900" },
  runnerLabel:  { position: "absolute", minWidth: 74, maxWidth: 108, borderRadius: 8, paddingHorizontal: 6, paddingVertical: 3, backgroundColor: "#050713DD", borderWidth: 1, borderColor: "#FFFFFF18" },
  runnerName:   { fontWeight: "900" },
  runnerSteps:  { color: "#B2B8CA", fontWeight: "700", marginTop: 1 },

  lbOverlay:    { position: "absolute", right: 0, top: 0, backgroundColor: "#0B0D1AF2", borderLeftWidth: 1, borderLeftColor: "#1A1D2E", paddingLeft: 8, paddingRight: 38, paddingTop: 8, paddingBottom: 4, zIndex: 15, overflow: "visible" as const },
  lbHead:       { flexDirection: "row", alignItems: "flex-start", marginBottom: 8, gap: 6 },
  lbHeadText:   { flex: 1, minWidth: 0 },
  lbTitle:      { color: "#CCCCCC", fontWeight: "700", letterSpacing: 0.5 },
  lbPosition:   { color: "#00E676", fontWeight: "900", marginTop: 2 },
  lbStatusPill: { flexDirection: "row", alignItems: "center", gap: 4, borderRadius: 8, backgroundColor: "#111421", borderWidth: 1, borderColor: "#252A3E", paddingHorizontal: 5, paddingVertical: 3 },
  lbStatusText: { color: "#FFFFFF", fontWeight: "900" },
  lbDot:        { width: 7, height: 7, borderRadius: 4, backgroundColor: "#FF4444" },
  lbEmpty:      { paddingVertical: 18, alignItems: "center" },
  lbEmptyText:  { color: "#8A8FA3", textAlign: "center" },
  lbRow:        { flexDirection: "row", alignItems: "center", paddingVertical: 5, paddingHorizontal: 3, marginBottom: 2, borderRadius: 8 },
  lbRowMe:      { backgroundColor: "#00E67614", borderWidth: 1, borderColor: "#00E67640" },
  lbBadge:      { borderWidth: 1.5, alignItems: "center", justifyContent: "center", marginRight: 5 },
  lbBadgeN:     { fontWeight: "800" },
  lbAvatar:     { borderWidth: 2, backgroundColor: "#1A1D2E", alignItems: "center", justifyContent: "center", marginRight: 5, overflow: "hidden" },
  lbAvatarI:    { fontWeight: "800" },
  lbInfo:       { flex: 1, minWidth: 0 },
  lbNameRow:    { flexDirection: "row", alignItems: "center", gap: 4, minWidth: 0 },
  lbName:       { fontWeight: "700" },
  lbMuteColSpacer: { width: 28, height: 28, flexShrink: 0, marginLeft: 4 },
  panelMicBtn:        { flexShrink: 0, width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center", backgroundColor: "#3A3F52", borderWidth: 1, borderColor: "#5B6078", marginLeft: 4 },
  panelMicBtnMuted:   { backgroundColor: "#1A1D2E", borderColor: "#9CA3AF", opacity: 0.9 },
  lbSteps:      { fontWeight: "800", color: "#FFFFFF", lineHeight: 14 },
  lbUnit:       { color: "#8899BB" },
  toggleHandle: { position: "absolute", right: 0, top: "47%", marginTop: -37, width: 34, height: 74, borderTopLeftRadius: 14, borderBottomLeftRadius: 14, borderWidth: 1, borderColor: "#3A3F52", backgroundColor: "#202431", alignItems: "center", justifyContent: "center", zIndex: 100, elevation: 100 },
  zoomBtn:           { position: "absolute", top: 10, left: 10, width: 32, height: 32, borderRadius: 8, backgroundColor: "#202431CC", borderWidth: 1, borderColor: "#3A3F5280", alignItems: "center", justifyContent: "center", zIndex: 25 },
  prizeChipsOverlay: { position: "absolute", top: 50, left: 10, zIndex: 24 },

  progSection: { flexDirection: "row", alignItems: "center", paddingHorizontal: 12, minHeight: 66, paddingVertical: 10, backgroundColor: "#050711", borderTopWidth: 1, borderTopColor: "#1A1D2E" },
  progLeft:    { flex: 1, flexDirection: "row", alignItems: "center", gap: 8 },
  progEmoji:   { fontSize: 27 },
  progMain:    { flex: 1 },
  progMine:    { fontWeight: "900", color: "#00E676" },
  progTarget:  { color: "#858A9C" },
  progSub:     { color: "#858A9C", marginTop: 3 },
  progBarBg:   { height: 7, backgroundColor: "#20263A", borderRadius: 4, marginTop: 5, overflow: "hidden" },
  progBarFill: { height: "100%", backgroundColor: "#00E676", borderRadius: 4 },
  progPct:     { fontWeight: "900", color: "#00E676", marginLeft: 6 },
  milestoneBtn: { alignItems: "center", paddingLeft: 12, gap: 3, flexDirection: "row" },
  milestoneIcon: { fontSize: 20 },
  milestoneLbl:  { color: "#C9A227", fontWeight: "800" },

  reactionBar:  { flexDirection: "row", alignItems: "center", justifyContent: "space-around", paddingHorizontal: 12, height: 42, backgroundColor: "#090B16", borderTopWidth: 1, borderTopColor: "#1A1D2E" },
  reactionBtn:  { minWidth: 42, height: 30, borderRadius: 15, backgroundColor: "#111421", borderWidth: 1, borderColor: "#24283D", alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 3 },
  reactionEmoji: { fontSize: 17 },
  reactionCount: { color: "#C7CDDA", fontSize: 10, fontWeight: "800" },

  quickRow:       { borderTopWidth: 1, maxHeight: 44, backgroundColor: "#050711" },
  quickContent:   { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingVertical: 6 },
  quickBtn:       { borderRadius: 20, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 6, flexShrink: 0 },
  quickTxt:       { fontSize: 12, fontWeight: "700" },

  liveChatPanel:  { borderTopWidth: 1, minHeight: 80, maxHeight: 115, paddingHorizontal: 12, paddingTop: 8, paddingBottom: 4 },
  liveChatHeader: { flexDirection: "row", alignItems: "center", gap: 5, marginBottom: 4 },
  liveChatTitle:  { fontSize: 11, fontWeight: "700", letterSpacing: 0.5 },
  liveChatScroll: { flex: 1 },
  liveChatEmpty:  { fontSize: 12, paddingVertical: 4, fontStyle: "italic" },
  liveChatRow:    { flexDirection: "row", alignItems: "flex-start", gap: 8, marginBottom: 6 },
  liveChatAv:     { width: 24, height: 24, borderRadius: 12, borderWidth: 1.5, alignItems: "center", justifyContent: "center", flexShrink: 0, overflow: "hidden" },
  liveChatAvImg:  { width: 24, height: 24 },
  liveChatAvTxt:  { fontSize: 10, fontWeight: "800" },
  liveChatBubble: { flex: 1, minWidth: 0 },
  liveChatName:   { fontSize: 11, fontWeight: "700" },
  liveChatMsg:    { fontSize: 12, flexWrap: "wrap" },

  inputBar:       { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 12, paddingTop: 8, backgroundColor: "#050711", borderTopWidth: 1, borderTopColor: "#1A1D2E" },
  inputMicBtn:        { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  inputMicBtnActive:  { backgroundColor: "#0D2A1A", borderWidth: 1, borderColor: "#22C55E40" },
  lockBadge: { position: "absolute", bottom: -2, right: -3, width: 12, height: 12, borderRadius: 6, backgroundColor: "#1A1D2E", alignItems: "center", justifyContent: "center" },
  micWrapper:          { position: "relative" as const, alignItems: "center", justifyContent: "center" },
  micPulseRing:        { position: "absolute" as const, top: -6, left: -6, right: -6, bottom: -6, borderRadius: 22, borderWidth: 1.5 },
  micListeningLabel:   { position: "absolute" as const, top: -16, left: -6, width: 44, textAlign: "center" as const, fontSize: 8, fontWeight: "700" as const, letterSpacing: 0.2 },
  inputField:     { flex: 1, backgroundColor: "#111421", borderRadius: 20, borderWidth: 1, borderColor: "#24283D", color: "#FFFFFF", paddingHorizontal: 14, paddingVertical: 10, fontSize: 14 },
  sendBtn:        { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 20 },
  sendBtnDisabled: { opacity: 0.55 },
  sendTxt:        { color: "#FFFFFF", fontSize: 13, fontWeight: "900" }, });

// ── Mic menu styles ────────────────────────────────────────────────────────────
const micMenuStyles = StyleSheet.create({
  // Full-screen transparent backdrop — tapping outside closes the menu.
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "flex-end",
  },
  // Floating card positioned above the input bar, anchored to the left edge.
  card: {
    position: "absolute",
    bottom: 64,
    left: 12,
    width: 188,
    backgroundColor: "#12152A",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#A3E63530",
    shadowColor: "#A3E635",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.18,
    shadowRadius: 14,
    elevation: 18,
    overflow: "hidden",
  },
  option: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 13,
    gap: 11,
  },
  optionSelected: {
    backgroundColor: "#A3E63510",
  },
  optionMuted: {
    backgroundColor: "#F59E0B0D",
  },
  optionIcon: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: "#1E2138",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#2A2D42",
  },
  optionIconSelected: {
    backgroundColor: "#A3E63518",
    borderColor: "#A3E63540",
  },
  optionIconMuted: {
    backgroundColor: "#F59E0B18",
    borderColor: "#F59E0B40",
  },
  optionLabel: {
    fontSize: 14,
    fontWeight: "700",
    color: "#D1D5DB",
  },
  optionLabelSelected: {
    color: "#A3E635",
  },
  optionLabelMuted: {
    color: "#F59E0B",
  },
  optionSub: {
    fontSize: 10,
    color: "#6B7280",
    marginTop: 1,
  },
  optionSubMuted: {
    fontSize: 10,
    color: "#F59E0B80",
    marginTop: 1,
  },
  divider: {
    height: 1,
    backgroundColor: "#1E2138",
    marginHorizontal: 14,
  },
  checkDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: "#A3E635",
    marginLeft: "auto",
  },
  checkDotMuted: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: "#F59E0B",
    marginLeft: "auto",
  },
});

// ── Inline voice mic panel styles ──────────────────────────────────────────────
const micPanelSt = StyleSheet.create({
  // Absolutely-positioned container that floats above the big button.
  // React Native does not clip absolutely-positioned children unless
  // overflow:"hidden" is set, so this safely escapes the 52×52 micWrapper.
  floatAbove: {
    position: "absolute",
    bottom: 54,
    left: 1,
    width: 50,
    alignItems: "center",
    zIndex: 100,
  },
  // Tall dark rounded-pill — neon indigo border + glow matching the reference image
  capsule: {
    width: 50,
    backgroundColor: "#09091D",
    borderRadius: 25,
    borderWidth: 1.5,
    borderColor: "#5253CC70",
    paddingVertical: 8,
    paddingHorizontal: 5,
    alignItems: "center",
    shadowColor: "#5B5FFF",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.7,
    shadowRadius: 18,
    elevation: 22,
  },
  // Dark circle buttons inside the capsule
  iconBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#13132B",
    borderWidth: 1,
    borderColor: "#252545",
    alignItems: "center",
    justifyContent: "center",
  },
  // Highlighted state — indigo tint matching image selection glow
  iconBtnActive: {
    backgroundColor: "#1C1C48",
    borderColor: "#6366F180",
    shadowColor: "#6366F1",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 8,
    elevation: 6,
  },
  // Amber tint when muted
  iconBtnMuted: {
    backgroundColor: "#F59E0B18",
    borderColor: "#F59E0B50",
  },
  // Small dot separator between each button (matches image)
  dot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: "#252545",
    marginVertical: 4,
  },
  // Thin connector stem from capsule down to the big mic circle
  stem: {
    width: 2,
    height: 10,
    backgroundColor: "#5253CC60",
  },
  // Outer pulsing ring (animated, reanimated-driven)
  pulseRing: {
    position: "absolute",
    top: -8,
    left: -8,
    right: -8,
    bottom: -8,
    borderRadius: 34,
    borderWidth: 1.5,
  },
  // Hit area for the big circle tap
  bigBtn: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
  },
  // Secondary outer ring glow
  bigRing: {
    position: "absolute",
    top: -5,
    left: -5,
    right: -5,
    bottom: -5,
    borderRadius: 31,
    borderWidth: 1.5,
    borderColor: "#5B5FFF40",
  },
  // Main circle — deep dark bg + indigo border + neon glow
  bigInner: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: "#0D0D24",
    borderWidth: 1.5,
    borderColor: "#5B5FFF70",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#5B5FFF",
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.6,
    shadowRadius: 14,
    elevation: 14,
  },
});
