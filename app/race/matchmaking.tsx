/**
 * matchmaking.tsx — Waiting Room + Race-Starting Countdown
 *
 * Navigation contract (strict):
 *   • ONLY navigate to live-detail when the local `startPhase` state machine
 *     reaches "navigating" — which is set exclusively by:
 *       a) host: local countdown completes after startRace API call succeeds, OR
 *       b) all:  Pusher "race:starting" fires for THIS raceId (drives countdown)
 *       c) all:  Pusher "race:started"  fires for THIS raceId (API-verified countdown)
 *   • NEVER navigate from racePhase (context) — stale phase from a previous race
 *     would cause an immediate spurious navigation on mount.
 *   • NEVER navigate from polling liveRoom.status — API response can be stale
 *     or correspond to a different race.
 *   • ALL Pusher event handlers check event.raceId === backendRaceId before acting.
 */

import { LinearGradient } from "expo-linear-gradient";
import { router, useLocalSearchParams, useFocusEffect } from "expo-router";
import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import {
  Alert,
  ActivityIndicator,
  Animated,
  Dimensions,
  Easing,
  InteractionManager,
  Modal,
  Platform,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  AppState,
  type AppStateStatus,
  useWindowDimensions,
  View,
} from "react-native";
import * as Clipboard from "expo-clipboard";

import { AppAlert } from "@/components/AppAlert";
import { ProfileAvatar } from "@/components/ProfileAvatar";
import { PublicProfileModal } from "@/components/PublicProfileModal";
import { SkeletonList } from "@/components/SkeletonRows";
import { useSafeLayout } from "@/hooks/useSafeLayout";
import { Feather } from "@expo/vector-icons";
import { useColors } from "@/hooks/useColors";
import { useRace, RACE_DEFAULTS } from "@/context/RaceContext";
import { useAuth } from "@/context/AuthContext";
import { authFetch } from "@/utils/authFetch";
import { STEP_SYNC_CONFIG } from "@/config/stepSyncConfig";
import {
  liveRaceFetchAllowed,
  markLiveRaceFetched,
  resetLiveRaceFetchGate,
} from "@/utils/liveRaceFetchGate";
import {
  connectPusher,
  subscribeToChannel,
  unsubscribeFromChannel,
  getPresenceMemberIds,
  CHANNELS,
  EVENTS,
} from "@/services/realtimeService";
import { TouchableOpacity } from "@/components/HapticTouchableOpacity";
import { rf, rs } from "@/utils/responsive";
import { CashChallengeRefundBreakdown } from "@/components/CashChallengePaymentBreakdown";
import { fetchCashChallengePaymentQuote, formatUsdFromDollars, refundBreakdownFromQuote, buildOptimisticRefundQuote, type CashChallengePaymentQuote } from "@/services/cashChallengeApi";
import {
  formatCashLeaveSuccessMessage,
  type CashChallengeLeaveResponse,
} from "@/services/refundApi";
import { mapUnlimitedDetailToWaitingRoom } from "@/utils/unlimitedWaitingRoom";
import { UNLIMITED_GOAL_CHALLENGE_TYPE } from "@/utils/unlimitedGoal";
import { normalizeUnlimitedLiveStatus } from "@/utils/unlimitedLiveRace";
import { isUnlimitedRaceDummyDataEnabled } from "@/config/featureFlags";
import {
  DUMMY_UNLIMITED_RACE_ID,
  getDummyWaitingRoomParticipants,
  shouldUseDummyUnlimitedRace,
} from "@/services/dummyUnlimitedRace";
import {
  isAlreadyLeftLeaveError,
  isUnlimitedCashChallenge,
  isUsdCashChallenge,
  mapPaidCancelError,
  previewChallengeHasStarted,
  shouldReleaseActiveChallengeLock,
  usdCashLeaveConfirmCopy,
  usdCashLeaveEndpoint,
  USD_CASH_LEAVE_ACTION_LABEL,
  USD_CASH_NO_CANCEL_MESSAGE,
} from "@/utils/usdCashChallengeLeavePolicy";
import { useApp } from "@/context/AppContext";
import {
  buildSelfParticipant,
  cacheWaitingRoomState,
  parseInitialParticipants,
  readWaitingRoomCacheSync,
  waitingRoomCacheKey,
  type WaitingRoomLiveMeta,
} from "@/utils/waitingRoomSeed";
import { screenCache } from "@/utils/screenCache";
import { SafeAreaView } from "react-native-safe-area-context";
import { usePresence } from "@/context/PresenceContext";
import { normalizeUserId } from "@/utils/presenceIds";
import {
  cancellationCopy,
  getWaitingRoomBanner,
  playersNeeded,
  resolveMinimumParticipants,
  resolveRoomExpiresAt,
  resolveWaitingRoomMode,
} from "@/utils/waitingRoomTiming";

const SCREEN_W = Dimensions.get("window").width;

// ── Responsive slot grid — always exactly 5 per row ──────────────────────────
const SLOTS_PER_ROW = 5;
const SLOT_PAD = 3;
/** Fallback avatar size at module load; runtime uses window-based `slotSize`. */
const SLOT_SIZE = Math.floor(SCREEN_W * 0.2 - SLOT_PAD * 2 - rs(20));

/** Image format: "Sat, Jun 21, 2025 • 08:00 PM IST" */
function formatWaitingRoomSchedule(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const datePart = d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  const timePart = d
    .toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
      timeZoneName: "short",
    })
    .replace(/\u202f/g, " ");
  return `${datePart} • ${timePart}`;
}

// ── Types ─────────────────────────────────────────────────────────────────────

type RoomParticipant = {
  id: string;
  userId: string;
  username: string;
  country: string | null;
  countryFlag: string | null;
  avatarColor: string | null;
  avatarUrl: string | null;
  avatarVersion: number;
  isHost: boolean;
  isCurrentUser: boolean;
  friendStatus: string;
  friendRequestId: string | null;
  activeTitle: { code: string; title: string } | null;
  currentSteps: number;
  status?: string | null;
  joinedAt?: string | null;
  registeredAt?: string | null;
  createdAt?: string | null;
};

type RaceHostProfile = {
  id?: string;
  userId?: string;
  username?: string;
  country?: string | null;
  countryFlag?: string | null;
  avatarColor?: string | null;
  avatarUrl?: string | null;
  profileImageUrl?: string | null;
  avatarVersion?: number | null;
};

type RawParticipantRecord = Partial<RoomParticipant> & {
  user_id?: string;
  username?: string;
  country_flag?: string | null;
  avatar_color?: string | null;
  avatar_url?: string | null;
  avatar_version?: number | null;
  is_host?: boolean;
  joined_at?: string | null;
  registered_at?: string | null;
  created_at?: string | null;
  user?: RaceHostProfile | null;
};

type WaitingRoomRacePayload = {
  creatorId?: string | null;
  creator_id?: string | null;
  ownerId?: string | null;
  owner_id?: string | null;
  hostUserId?: string | null;
  host_user_id?: string | null;
  hostUsername?: string | null;
  host_username?: string | null;
  hostAvatarColor?: string | null;
  host_avatar_color?: string | null;
  hostAvatarUrl?: string | null;
  host_avatar_url?: string | null;
  hostAvatarVersion?: number | null;
  creator?: RaceHostProfile | null;
  host?: RaceHostProfile | null;
  owner?: RaceHostProfile | null;
};

const NON_ACTIVE_REGISTRATION_STATUSES = new Set([
  "cancelled",
  "canceled",
  "withdrawn",
  "rejected",
  "removed",
  "left",
  "spectating",
  "spectator",
  "invalid",
]);

function participantTime(participant: RoomParticipant): number {
  const value =
    participant.registeredAt ??
    participant.joinedAt ??
    participant.createdAt;
  if (!value) return Number.MAX_SAFE_INTEGER;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : Number.MAX_SAFE_INTEGER;
}

/** Trim to null so ""/"null"/"undefined" never win during avatar/name merging. */
function cleanString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed === "null" || trimmed === "undefined") return null;
  return trimmed;
}

/** First non-empty string across candidates (empty strings are skipped). */
function firstNonEmpty(...candidates: unknown[]): string | null {
  for (const candidate of candidates) {
    const cleaned = cleanString(candidate);
    if (cleaned) return cleaned;
  }
  return null;
}

function coerceRoomParticipant(
  value: unknown,
  currentUserId?: string,
): RoomParticipant | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as RawParticipantRecord;
  const profile = raw.user ?? null;
  const userId = raw.userId ?? raw.user_id ?? profile?.userId ?? profile?.id;
  if (!userId) return null;
  const userIdStr = String(userId);

  return {
    id: String(raw.id ?? `registration-${userIdStr}`),
    userId: userIdStr,
    username: firstNonEmpty(raw.username, profile?.username) ?? "Player",
    country: cleanString(raw.country) ?? cleanString(profile?.country),
    countryFlag:
      cleanString(raw.countryFlag) ??
      cleanString(raw.country_flag) ??
      cleanString(profile?.countryFlag),
    avatarColor:
      cleanString(raw.avatarColor) ??
      cleanString(raw.avatar_color) ??
      cleanString(profile?.avatarColor),
    avatarUrl: firstNonEmpty(
      raw.avatarUrl,
      raw.avatar_url,
      (raw as { profileImageUrl?: string | null }).profileImageUrl,
      (raw as { profile_image_url?: string | null }).profile_image_url,
      (raw as { profilePhotoUrl?: string | null }).profilePhotoUrl,
      (raw as { photoURL?: string | null }).photoURL,
      (raw as { imageUrl?: string | null }).imageUrl,
      profile?.avatarUrl,
      profile?.profileImageUrl,
    ),
    avatarVersion:
      raw.avatarVersion ??
      raw.avatar_version ??
      profile?.avatarVersion ??
      0,
    isHost: raw.isHost ?? raw.is_host ?? false,
    isCurrentUser:
      raw.isCurrentUser ??
      (!!currentUserId &&
        normalizeUserId(userIdStr) === normalizeUserId(currentUserId)),
    friendStatus: raw.friendStatus ?? "none",
    friendRequestId: raw.friendRequestId ?? null,
    activeTitle: raw.activeTitle ?? null,
    currentSteps: raw.currentSteps ?? 0,
    status: raw.status ?? null,
    joinedAt: raw.joinedAt ?? raw.joined_at ?? null,
    registeredAt: raw.registeredAt ?? raw.registered_at ?? null,
    createdAt: raw.createdAt ?? raw.created_at ?? null,
  };
}

/**
 * One source of truth for the grid:
 * host first, then active registrations in join-time order, deduped by user ID.
 */
function normalizeWaitingRoomParticipants(
  rawParticipants: unknown[],
  race: WaitingRoomRacePayload | null | undefined,
  currentUser: {
    id: string;
    username: string;
    country?: string | null;
    countryFlag?: string | null;
    avatarColor?: string | null;
    profileImageUrl?: string | null;
    avatarVersion?: number | null;
  } | null | undefined,
  currentUserIsHost: boolean,
): RoomParticipant[] {
  const active = rawParticipants
    .map((participant) => coerceRoomParticipant(participant, currentUser?.id))
    .filter((participant): participant is RoomParticipant => !!participant)
    .filter((participant) => {
    const status = participant.status?.trim().toLowerCase();
    return !status || !NON_ACTIVE_REGISTRATION_STATUSES.has(status);
  });

  const explicitHost = active.find((participant) => participant.isHost);
  const nestedHost = race?.host ?? race?.creator ?? race?.owner ?? null;
  const hostId =
    race?.hostUserId ??
    race?.host_user_id ??
    race?.creatorId ??
    race?.creator_id ??
    race?.ownerId ??
    race?.owner_id ??
    nestedHost?.userId ??
    nestedHost?.id ??
    explicitHost?.userId ??
    (currentUserIsHost ? currentUser?.id : null);

  const byUserId = new Map<string, RoomParticipant>();
  active.forEach((participant) => {
    const existing = byUserId.get(participant.userId);
    if (!existing) {
      byUserId.set(participant.userId, participant);
      return;
    }
    // Merge duplicates without dropping populated fields (e.g. a valid avatar
    // must never be overwritten by a null from a leaner record).
    byUserId.set(participant.userId, {
      ...existing,
      ...participant,
      username: firstNonEmpty(participant.username, existing.username) ?? "Player",
      avatarUrl: firstNonEmpty(participant.avatarUrl, existing.avatarUrl),
      avatarColor: cleanString(participant.avatarColor) ?? cleanString(existing.avatarColor),
      country: cleanString(participant.country) ?? cleanString(existing.country),
      countryFlag: cleanString(participant.countryFlag) ?? cleanString(existing.countryFlag),
      avatarVersion: Math.max(participant.avatarVersion ?? 0, existing.avatarVersion ?? 0),
      isHost: existing.isHost || participant.isHost,
      joinedAt: existing.joinedAt ?? participant.joinedAt,
      registeredAt: existing.registeredAt ?? participant.registeredAt,
      createdAt: existing.createdAt ?? participant.createdAt,
    });
  });

  // The viewer reached this room via their own confirmed registration, so they
  // must always occupy a slot — even when a far-future scheduled race has not
  // yet materialized them in the server participant list. Only injected when the
  // server list omits them; a richer server record (with registeredAt) wins.
  const selfKey = currentUser?.id ? String(currentUser.id) : "";
  if (selfKey && currentUser && !byUserId.has(selfKey) && ![...byUserId.keys()].some((k) => normalizeUserId(k) === normalizeUserId(selfKey))) {
    byUserId.set(selfKey, {
      id: `self-${selfKey}`,
      userId: selfKey,
      username: firstNonEmpty(currentUser.username) ?? "You",
      country: cleanString(currentUser.country),
      countryFlag: cleanString(currentUser.countryFlag),
      avatarColor: cleanString(currentUser.avatarColor),
      avatarUrl: firstNonEmpty(currentUser.profileImageUrl),
      avatarVersion: currentUser.avatarVersion ?? 0,
      isHost: currentUserIsHost,
      isCurrentUser: true,
      friendStatus: "none",
      friendRequestId: null,
      activeTitle: null,
      currentSteps: 0,
      status: null,
      joinedAt: null,
      registeredAt: null,
      createdAt: null,
    });
  }

  if (hostId) {
    const hostIdStr = String(hostId);
    const existing =
      byUserId.get(hostIdStr) ??
      [...byUserId.entries()].find(
        ([k]) => normalizeUserId(k) === normalizeUserId(hostIdStr),
      )?.[1];
    const isCurrentUser =
      !!selfKey &&
      normalizeUserId(hostIdStr) === normalizeUserId(selfKey);
    byUserId.set(hostIdStr, {
      id: existing?.id ?? `host-${hostIdStr}`,
      userId: hostIdStr,
      username:
        firstNonEmpty(
          existing?.username,
          nestedHost?.username,
          race?.hostUsername,
          race?.host_username,
          isCurrentUser ? currentUser?.username : null,
        ) ?? "Host",
      country: firstNonEmpty(
        existing?.country,
        nestedHost?.country,
        isCurrentUser ? currentUser?.country : null,
      ),
      countryFlag: firstNonEmpty(
        existing?.countryFlag,
        nestedHost?.countryFlag,
        isCurrentUser ? currentUser?.countryFlag : null,
      ),
      avatarColor: firstNonEmpty(
        existing?.avatarColor,
        nestedHost?.avatarColor,
        race?.hostAvatarColor,
        race?.host_avatar_color,
        isCurrentUser ? currentUser?.avatarColor : null,
      ),
      avatarUrl: firstNonEmpty(
        existing?.avatarUrl,
        nestedHost?.avatarUrl,
        nestedHost?.profileImageUrl,
        race?.hostAvatarUrl,
        race?.host_avatar_url,
        isCurrentUser ? currentUser?.profileImageUrl : null,
      ),
      avatarVersion:
        existing?.avatarVersion ??
        nestedHost?.avatarVersion ??
        race?.hostAvatarVersion ??
        (isCurrentUser ? currentUser?.avatarVersion : null) ??
        0,
      isHost: true,
      isCurrentUser,
      friendStatus: existing?.friendStatus ?? "none",
      friendRequestId: existing?.friendRequestId ?? null,
      activeTitle: existing?.activeTitle ?? null,
      currentSteps: existing?.currentSteps ?? 0,
      status: existing?.status ?? "host",
      joinedAt: existing?.joinedAt ?? null,
      registeredAt: existing?.registeredAt ?? null,
      createdAt: existing?.createdAt ?? null,
    });
  }

  const hostKey = hostId != null ? String(hostId) : "";
  const normalized = [...byUserId.values()].map((participant) => ({
    ...participant,
    userId: String(participant.userId),
    isHost:
      !!hostKey &&
      normalizeUserId(participant.userId) === normalizeUserId(hostKey),
    isCurrentUser:
      !!selfKey &&
      normalizeUserId(participant.userId) === normalizeUserId(selfKey),
  }));

  return normalized.sort((a, b) => {
    if (a.isHost !== b.isHost) return a.isHost ? -1 : 1;
    return participantTime(a) - participantTime(b);
  });
}

type OnlineCandidate = {
  userId: string;
  username: string;
  avatarUrl: string | null;
  avatarColor: string | null;
  country: string | null;
  countryFlag: string | null;
  status?: string;
  isFriend?: boolean;
  inviteStatus?: string;
};

type FriendItem = {
  userId: string;
  username: string;
  avatarUrl: string | null;
  avatarColor: string | null;
  avatarVersion?: number;
  country: string | null;
  countryFlag: string | null;
  isOnline?: boolean;
};

type InviteStatus = "idle" | "sending" | "pending";

/** Local state machine for the race-starting flow */
type StartPhase =
  | "idle"         // waiting for host to tap Start
  | "api_call"     // host tapped Start, waiting for API ack
  | "countdown"    // counting down 3-2-1
  | "go"           // showing "GO!"
  | "navigating";  // navigating to race track

// ── PlayerSlot ────────────────────────────────────────────────────────────────

function PlayerSlot({
  participant,
  onPress,
  isOnline,
  loading,
  colors,
  slotSize,
}: {
  participant: RoomParticipant | null;
  onPress?: () => void;
  isOnline: boolean;
  loading: boolean;
  colors: ReturnType<typeof useColors>;
  slotSize: number;
}) {
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const opacityAnim = useRef(new Animated.Value(participant ? 1 : 0.45)).current;
  const prevFilledRef = useRef<boolean>(!!participant);
  const avatarSize = Math.min(44, Math.max(28, slotSize - 8));

  useEffect(() => {
    const filled = !!participant;
    if (filled === prevFilledRef.current) return;
    prevFilledRef.current = filled;
    if (filled) {
      Animated.parallel([
        Animated.spring(scaleAnim, { toValue: 1, useNativeDriver: true, tension: 100, friction: 7 }),
        Animated.timing(opacityAnim, { toValue: 1, duration: 200, useNativeDriver: true }),
      ]).start();
    } else {
      Animated.timing(opacityAnim, { toValue: 0.45, duration: 100, useNativeDriver: true }).start();
    }
  }, [!!participant, scaleAnim, opacityAnim]);

  const ringColor = participant
    ? (participant.avatarColor ?? colors.primary)
    : colors.border;

  return (
    <Animated.View
      style={[
        styles.playerSlot,
        {
          backgroundColor: participant ? ringColor + "20" : colors.card,
          borderColor: ringColor,
          transform: [{ scale: scaleAnim }],
          opacity: opacityAnim,
        },
      ]}
    >
      {participant ? (
        <View style={styles.slotAvatarWrap}>
          <ProfileAvatar
            userId={participant.userId}
            // Avatars are served by user ID (/api/profile/avatar/:id), so always
            // attempt resolution when we have a userId — matches Available Rooms.
            // Initials remain the base layer and show only if the image errors.
            profileImageUrl={participant.avatarUrl ?? participant.userId}
            avatarVersion={participant.avatarVersion}
            avatarColor={participant.avatarColor ?? colors.primary}
            displayName={participant.username}
            size={avatarSize}
            borderWidth={0}
            onPress={onPress}
          />
          <View
            accessibilityLabel={isOnline ? "Online" : "Offline"}
            style={[
              styles.participantStatusDot,
              isOnline
                ? styles.participantStatusOnline
                : styles.participantStatusOffline,
            ]}
          />
        </View>
      ) : loading ? (
        <View style={styles.slotSkeleton}>
          <View
            style={[
              styles.slotSkeletonAvatar,
              {
                width: Math.max(24, avatarSize - 6),
                height: Math.max(24, avatarSize - 6),
                borderRadius: Math.max(12, (avatarSize - 6) / 2),
              },
            ]}
          />
        </View>
      ) : (
        <Feather name="user" size={Math.min(16, Math.round(avatarSize * 0.4))} color={colors.mutedForeground} />
      )}
      {participant?.isHost && (
        <View style={styles.hostBadgeSlot}>
          <Feather name="star" size={6} color="#1A1200" />
          <Text style={styles.hostBadgeSlotText}>HOST</Text>
        </View>
      )}
    </Animated.View>
  );
}

// ── CountdownOverlay ──────────────────────────────────────────────────────────

function CountdownOverlay({
  startPhase,
  countdownNum,
  playerCount,
  colors,
}: {
  startPhase: StartPhase;
  countdownNum: number;
  playerCount: number;
  colors: ReturnType<typeof useColors>;
}) {
  const scaleAnim = useRef(new Animated.Value(0.4)).current;
  const opacityAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // Entrance pop
    Animated.parallel([
      Animated.spring(scaleAnim, { toValue: 1, useNativeDriver: true, tension: 140, friction: 8 }),
      Animated.timing(opacityAnim, { toValue: 1, duration: 200, useNativeDriver: true }),
    ]).start();
  }, [startPhase === "countdown" ? countdownNum : startPhase]);

  const label =
    startPhase === "api_call"
      ? "Loading Race…"
      : startPhase === "go"
        ? "GO!"
        : String(countdownNum);

  const sublabel =
    startPhase === "api_call"
      ? "Preparing your race"
      : startPhase === "go"
        ? "Walk your fastest!"
        : countdownNum === 3
          ? "Ready"
          : countdownNum === 2
            ? "Set"
            : "Go!";

  const accentColor = startPhase === "go" ? colors.success : colors.accent;

  return (
    <View style={[cStyles.overlay, { backgroundColor: colors.background + "F5" }]}>
      <LinearGradient
        colors={[accentColor + "18", "transparent"]}
        style={cStyles.glow}
      />

      <Text style={[cStyles.preparing, { color: colors.mutedForeground }]}>
        {startPhase === "go" ? `${playerCount} players ready` : "Race is starting"}
      </Text>

      <Animated.View
        style={[
          cStyles.numberBox,
          {
            borderColor: accentColor + "50",
            transform: [{ scale: scaleAnim }],
            opacity: opacityAnim,
          },
        ]}
      >
        <LinearGradient
          colors={[accentColor + "20", accentColor + "08"]}
          style={cStyles.numberBoxGrad}
        >
          {startPhase === "api_call" ? (
            <ActivityIndicator size="large" color={accentColor} />
          ) : (
            <Text style={[cStyles.number, { color: accentColor }]}>{label}</Text>
          )}
        </LinearGradient>
      </Animated.View>

      <Text style={[cStyles.sublabel, { color: colors.foreground }]}>{sublabel}</Text>

      <View style={[cStyles.pill, { backgroundColor: colors.card, borderColor: colors.border }]}>
        <Feather name="users" size={13} color={colors.mutedForeground} />
        <Text style={[cStyles.pillText, { color: colors.mutedForeground }]}>
          {playerCount} players
        </Text>
      </View>
    </View>
  );
}

// ── MatchmakingScreen ─────────────────────────────────────────────────────────

function PremiumWaitingRoomValue({
  children,
  primary = false,
}: {
  children: React.ReactNode;
  primary?: boolean;
}) {
  const shimmer = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!primary) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.delay(3600),
        Animated.timing(shimmer, {
          toValue: 1,
          duration: 900,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(shimmer, { toValue: 0, duration: 0, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [primary, shimmer]);

  return (
    <View style={styles.premiumStatValueWrap}>
      <Text style={[styles.statValue, primary ? styles.prizeStatValue : styles.entryStatValue]}>
        {children}
      </Text>
      {primary && (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.premiumStatShimmer,
            {
              transform: [{
                translateX: shimmer.interpolate({
                  inputRange: [0, 1],
                  outputRange: [-20, 100],
                }),
              }],
              opacity: shimmer.interpolate({
                inputRange: [0, 0.2, 0.5, 0.8, 1],
                outputRange: [0, 0.18, 0.4, 0.18, 0],
              }),
            },
          ]}
        />
      )}
    </View>
  );
}

export default function MatchmakingScreen() {
  return (
    <ErrorBoundary>
      <MatchmakingScreenContent />
    </ErrorBoundary>
  );
}

function MatchmakingScreenContent() {
  const colors = useColors();
  const { safeTop, safeBottom } = useSafeLayout();
  const { width: windowWidth } = useWindowDimensions();
  // Portrait-safe width for 5-column grid sizing across phones/tablets.
  const layoutWidth = Math.min(windowWidth, Dimensions.get("window").height);
  const slotSize = Math.floor(layoutWidth * 0.2 - SLOT_PAD * 2 - rs(20));
  const params = useLocalSearchParams<{
    raceId?: string;
    isHost?: string;
    initialParticipants?: string;
    initialEntryType?: string;
    initialTargetSteps?: string;
    initialCoinEntryAmount?: string;
    initialMaxPlayers?: string;
    initialCapacityMode?: string;
    initialIsPrivate?: string;
    initialInviteCode?: string;
    initialCurrentPlayers?: string;
    initialScheduledStartAt?: string;
    initialDailyGoalSteps?: string;
    dummyRace?: string;
  }>();

  const { user } = useAuth();
  const useDummyWaitingRoom = shouldUseDummyUnlimitedRace(
    params.raceId ?? null,
    params.dummyRace,
    {
      unlimitedChallenge:
        params.initialCapacityMode === "unlimited" ||
        params.initialEntryType === UNLIMITED_GOAL_CHALLENGE_TYPE,
    },
  );
  const { isUserOnline, refreshOnlineIds, setUserStatus } = usePresence();

  const {
    racePhase,
    playersJoined,
    raceMaxPlayers,
    raceEntryFee,
    totalPool,
    cancelRace,
    startRaceManually,
    notifyRaceStarted,
    raceId: contextRaceId,
    isHost: contextIsHost,
    setActiveRace,
    setRaceTargetSteps,
  } = useRace();

  const { refreshWallet } = useApp();
  const [refundModalVisible, setRefundModalVisible] = useState(false);
  const [refundQuote, setRefundQuote] = useState<CashChallengePaymentQuote | null>(null);
  const [refundConfirming, setRefundConfirming] = useState(false);
  /** Inline confirm — opens instantly (no AppAlert dismiss delay, no pre-fetch). */
  const [confirmModal, setConfirmModal] = useState<
    "host_cancel" | "leave" | "leave_pre_start" | "leave_post_start" | null
  >(null);
  /** Terminal cancel/expire modal — keeps users off a closed waiting room. */
  const [terminalModal, setTerminalModal] = useState<{
    title: string;
    message: string;
    showCounts?: boolean;
  } | null>(null);
  const terminalHandledRef = useRef(false);

  const backendRaceId = params.raceId ?? contextRaceId;
  const isHostMode = params.isHost === "true";
  /** Set when leaving — skips polls/Pusher updates so exit navigation is not blocked. */
  const exitingRef = useRef(false);

  // ── Stale-state guard on mount ────────────────────────────────────────────
  // If racePhase is already "in_race"/"countdown"/"finished" when we arrive at
  // the waiting room, it means the context is stale from a previous race.
  // Reset it so we never auto-navigate on mount.
  const staleResetDoneRef = useRef(false);
  useEffect(() => {
    if (staleResetDoneRef.current) return;
    staleResetDoneRef.current = true;
    if (
      racePhase === "in_race" ||
      racePhase === "countdown" ||
      racePhase === "finished"
    ) {
      cancelRace();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);


  // ── Pre-populate participants synchronously from navigation params ─────────
  const [participants, setParticipants] = useState<RoomParticipant[]>(
    () => parseInitialParticipants(params.initialParticipants) ?? [],
  );
  const participantsRef = useRef(participants);
  const [participantsLoading, setParticipantsLoading] = useState(true);
  const [participantsError, setParticipantsError] = useState<string | null>(null);

  useEffect(() => {
    participantsRef.current = participants;
  }, [participants]);

  // Frontend-only dummy Waiting Room (~100 participants) when flag + params allow.
  const dummyWaitingSeededRef = useRef(false);
  useEffect(() => {
    if (!useDummyWaitingRoom || !user?.id) return;
    if (dummyWaitingSeededRef.current) return;
    dummyWaitingSeededRef.current = true;
    const dummies = getDummyWaitingRoomParticipants(user.id, user.username);
    const joinedAt = new Date().toISOString();
    setParticipants(
      dummies.map((d) => ({
        userId: d.userId,
        username: d.username,
        country: null,
        countryFlag: d.countryFlag,
        avatarColor: d.avatarColor,
        avatarUrl: null,
        avatarVersion: 0,
        isHost: !!d.isHost,
        isCurrentUser: !!d.isCurrentUser,
        friendStatus: "none",
        friendRequestId: null,
        activeTitle: null,
        currentSteps: 0,
        status: "active",
        joinedAt,
      })),
    );
    setParticipantsLoading(false);
    setParticipantsError(null);
  }, [useDummyWaitingRoom, user?.id, user?.username]);

  const enterDummyLiveRace = useCallback(() => {
    router.replace({
      pathname: "/race/live-detail",
      params: {
        id: backendRaceId || DUMMY_UNLIMITED_RACE_ID,
        dummyRace: "1",
        challengeType: UNLIMITED_GOAL_CHALLENGE_TYPE,
        capacityMode: "unlimited",
      },
    });
  }, [backendRaceId]);

  // ── Local start-phase state machine ──────────────────────────────────────
  const [startPhase, setStartPhase] = useState<StartPhase>("idle");
  const startPhaseRef = useRef<StartPhase>("idle");
  const [countdownNum, setCountdownNum] = useState(3);
  const countdownIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const setStart = useCallback((phase: StartPhase) => {
    startPhaseRef.current = phase;
    setStartPhase(phase);
  }, []);

  /** Server-authoritative start time captured from polling — passed to notifyRaceStarted. */
  const raceStartedAtRef = useRef<Date | null>(null);

  // ── Room state ────────────────────────────────────────────────────────────
  // Pre-seeded from navigation params so the correct values show immediately
  // without waiting for the first 3-second poll to complete.
  const [liveRoom, setLiveRoom] = useState<{
    currentPlayers: number;
    maxPlayers: number;
    status: string;
    targetSteps?: number;
    entryType?: string;
    entryAmountCents?: number;
    coinEntryAmount?: number;
    coinPrizePool?: number;
    isPrivate?: boolean;
    inviteCode?: string | null;
    minimumParticipants?: number;
    canStart?: boolean | null;
    roomExpiresAt?: string | null;
    createdAt?: string | null;
    cancellationReason?: string | null;
    challengeType?: string;
    capacityMode?: string;
  } | null>(() => {
    if (!params.initialEntryType && !params.initialCurrentPlayers && params.initialCapacityMode !== "unlimited") {
      return null;
    }
    const unlimitedSeed =
      params.initialCapacityMode === "unlimited" ||
      params.initialEntryType === UNLIMITED_GOAL_CHALLENGE_TYPE;
    return {
      currentPlayers: params.initialCurrentPlayers
        ? Number(params.initialCurrentPlayers)
        : 1,
      maxPlayers: unlimitedSeed
        ? 0
        : params.initialMaxPlayers
          ? Number(params.initialMaxPlayers)
          : raceMaxPlayers,
      status: "open",
      targetSteps: params.initialTargetSteps
        ? Number(params.initialTargetSteps)
        : params.initialDailyGoalSteps
          ? Number(params.initialDailyGoalSteps)
          : undefined,
      entryType: params.initialEntryType,
      coinEntryAmount: params.initialCoinEntryAmount ? Number(params.initialCoinEntryAmount) : 0,
      coinPrizePool: 0,
      isPrivate: params.initialIsPrivate === "true",
      inviteCode: params.initialInviteCode || null,
      challengeType: unlimitedSeed ? UNLIMITED_GOAL_CHALLENGE_TYPE : undefined,
      capacityMode: unlimitedSeed ? "unlimited" : undefined,
    };
  });
  const [scheduledStartAt, setScheduledStartAt] = useState<string | null>(
    () => (typeof params.initialScheduledStartAt === "string" && params.initialScheduledStartAt
      ? params.initialScheduledStartAt
      : null),
  );
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [copiedCode, setCopiedCode] = useState(false);
  const [selectedParticipant, setSelectedParticipant] = useState<RoomParticipant | null>(null);
  const [wasRemoved, setWasRemoved] = useState(false);
  // Ref so the Pusher onRemoved closure (captured at effect mount) can
  // identify the current user without accessing stale participants state.
  const myUserIdRef = useRef<string | null>(null);
  const [leaving, setLeaving] = useState(false);

  // ── Invite panel state ────────────────────────────────────────────────────
  const [invitePanelOpen, setInvitePanelOpen] = useState(false);
  const slideAnim = useRef(new Animated.Value(SCREEN_W)).current;
  const [inviteTab, setInviteTab] = useState<"online" | "friends">("friends");
  const [onlineCandidates, setOnlineCandidates] = useState<OnlineCandidate[]>([]);
  const [friendsList, setFriendsList] = useState<FriendItem[]>([]);
  const [inviteStatuses, setInviteStatuses] = useState<Record<string, InviteStatus>>({});
  /** Users currently on this race's Pusher presence channel (in Waiting Room now). */
  const [racePresenceIds, setRacePresenceIds] = useState<Set<string>>(new Set());
  const [friendsOnlineIds, setFriendsOnlineIds] = useState<Set<string>>(new Set());
  const [loadingCandidates, setLoadingCandidates] = useState(false);
  const [loadingFriends, setLoadingFriends] = useState(false);
  const candidatesLoadedRef = useRef(false);
  const friendsLoadedRef = useRef(false);

  const isParticipantOnline = useCallback(
    (participant: RoomParticipant | null | undefined) => {
      if (!participant) return false;
      if (participant.isCurrentUser) return true;
      const id = normalizeUserId(participant.userId);
      if (!id) return false;
      if (isUserOnline(id)) return true;
      if (racePresenceIds.has(id)) return true;
      if (friendsOnlineIds.has(id)) return true;
      // Open lobby (no schedule): joined players are in-room together → show online.
      // Scheduled rooms keep true presence so absent registrants stay grey.
      if (!scheduledStartAt) return true;
      return false;
    },
    [isUserOnline, racePresenceIds, friendsOnlineIds, scheduledStartAt],
  );

  // Shared global presence (same source as Chat) + mark this device online.
  useFocusEffect(
    useCallback(() => {
      setUserStatus("online");
      void refreshOnlineIds();
      const id = setInterval(() => {
        void refreshOnlineIds();
      }, 5_000);
      return () => clearInterval(id);
    }, [refreshOnlineIds, setUserStatus]),
  );

  // Race-scoped presence: everyone currently in this Waiting Room.
  useEffect(() => {
    if (!backendRaceId) return;
    connectPusher();
    const channelName = CHANNELS.presenceRace(backendRaceId);
    const channel = subscribeToChannel(channelName);
    if (!channel) return;

    const syncMembers = () => {
      const next = new Set<string>();
      for (const id of getPresenceMemberIds(channelName)) {
        const n = normalizeUserId(id);
        if (n) next.add(n);
      }
      // Always include self while viewing this room.
      const selfId = normalizeUserId(user?.id);
      if (selfId) next.add(selfId);
      setRacePresenceIds((prev) => {
        if (prev.size === next.size) {
          let same = true;
          for (const id of next) {
            if (!prev.has(id)) {
              same = false;
              break;
            }
          }
          if (same) return prev;
        }
        return next;
      });
    };

    channel.bind("pusher:subscription_succeeded", syncMembers);
    channel.bind("pusher:member_added", syncMembers);
    channel.bind("pusher:member_removed", syncMembers);
    // First sync in case subscription already completed.
    syncMembers();

    return () => {
      channel.unbind("pusher:subscription_succeeded", syncMembers);
      channel.unbind("pusher:member_added", syncMembers);
      channel.unbind("pusher:member_removed", syncMembers);
      unsubscribeFromChannel(channelName);
      setRacePresenceIds(new Set());
    };
  }, [backendRaceId, user?.id]);

  const pulseAnim = useRef(new Animated.Value(1)).current;

  // ── Room expiry / schedule display clock ──────────────────────────────────
  const roomExpiresAtRef = useRef<Date | null>(null);
  const isHostModeRef = useRef(isHostMode);
  useEffect(() => { isHostModeRef.current = isHostMode; }, [isHostMode]);

  const showTerminalRoomClosed = useCallback(
    (reason?: string | null, modeHint?: "scheduled" | "open_window") => {
      if (terminalHandledRef.current || exitingRef.current) return;
      terminalHandledRef.current = true;
      const mode = modeHint ?? resolveWaitingRoomMode(scheduledStartAt);
      const copy = cancellationCopy(reason, mode);
      const r = (reason ?? "").toUpperCase();
      const showCounts =
        r.includes("MINIMUM") ||
        r.includes("PARTICIPANT") ||
        (mode === "scheduled" && !r.includes("HOST_CANCEL"));
      setTerminalModal({ ...copy, showCounts });
      if (countdownIntervalRef.current) {
        clearInterval(countdownIntervalRef.current);
        countdownIntervalRef.current = null;
      }
      setStart("idle");
    },
    [scheduledStartAt, setStart],
  );

  const entryFeeCents = liveRoom?.entryAmountCents ?? (raceEntryFee > 0 ? Math.round(raceEntryFee * 100) : 0);
  const isCoinsBattleRoom = liveRoom?.entryType === "coins_battle";
  const isUnlimitedGoalRoom =
    params.initialCapacityMode === "unlimited" ||
    params.initialEntryType === UNLIMITED_GOAL_CHALLENGE_TYPE ||
    isUnlimitedCashChallenge({
      entryFeeCents,
      entryType: liveRoom?.entryType ?? params.initialEntryType,
      challengeType: (liveRoom as { challengeType?: string } | null)?.challengeType,
      capacityMode:
        (liveRoom as { capacityMode?: string } | null)?.capacityMode ??
        (typeof params.initialCapacityMode === "string" ? params.initialCapacityMode : null),
      maxPlayers: liveRoom?.maxPlayers,
    });
  const isPaidCashRoom =
    entryFeeCents > 0 &&
    liveRoom?.entryType !== "coins_battle" &&
    liveRoom?.entryType !== "free";
  const isUsdCashPaidRoom =
    isUsdCashChallenge({
      entryFeeCents,
      entryType: liveRoom?.entryType ?? params.initialEntryType,
      challengeType: (liveRoom as { challengeType?: string } | null)?.challengeType,
      capacityMode:
        (liveRoom as { capacityMode?: string } | null)?.capacityMode ??
        (typeof params.initialCapacityMode === "string" ? params.initialCapacityMode : null),
      maxPlayers: liveRoom?.maxPlayers,
    }) || isUnlimitedGoalRoom || isPaidCashRoom;

  const cashLeaveHasStartedPreview = previewChallengeHasStarted({
    scheduledStartAt,
    status: liveRoom?.status,
    nowMs,
  });
  const cashLeaveCopy = usdCashLeaveConfirmCopy({
    hasStartedPreview: cashLeaveHasStartedPreview,
    isHost: isHostMode,
  });

  const clearWaitingRoomLocalState = useCallback(() => {
    if (backendRaceId) {
      screenCache.invalidate(waitingRoomCacheKey(backendRaceId));
      resetLiveRaceFetchGate(backendRaceId);
      unsubscribeFromChannel(CHANNELS.liveRace(backendRaceId));
    }
    cancelRace();
  }, [backendRaceId, cancelRace]);

  const navigateToWalkInstant = useCallback(() => {
    if (exitingRef.current) return;
    exitingRef.current = true;

    // Navigate first — never block on context/store cleanup or modal state updates.
    router.replace("/(tabs)/walk");

    InteractionManager.runAfterInteractions(() => {
      clearWaitingRoomLocalState();
      setConfirmModal(null);
      setRefundModalVisible(false);
      setLeaving(false);
    });
  }, [clearWaitingRoomLocalState]);

  const navigateToWalkRef = useRef(navigateToWalkInstant);
  useEffect(() => {
    navigateToWalkRef.current = navigateToWalkInstant;
  }, [navigateToWalkInstant]);

  const runRoomExitApi = useCallback(
    async (endpoint: "leave" | "cancel") => {
      if (!backendRaceId) {
        return { ok: true as const, body: null as CashChallengeLeaveResponse | null };
      }
      try {
        const status = liveRoom?.status ?? "open";
        if (endpoint === "leave") {
          let res: Response;
          let body: CashChallengeLeaveResponse = {};

          if (isUsdCashPaidRoom) {
            res = await authFetch(usdCashLeaveEndpoint(backendRaceId, isUnlimitedGoalRoom), {
              method: "POST",
              body: JSON.stringify({ reason: "cancel_registration" }),
              timeoutMs: 12_000,
            });
            body = (await res.json().catch(() => ({}))) as CashChallengeLeaveResponse;
            if (!res.ok) {
              if (isAlreadyLeftLeaveError(res.status, body)) {
                return { ok: true as const, body: { ...body, success: true, participationStatus: "left" } };
              }
              return {
                ok: false as const,
                error: body.error ?? "Could not leave this challenge.",
                body,
              };
            }
            return { ok: true as const, body };
          }

          const useLeave = status === "open" || status === "full";
          res = await authFetch(
            useLeave
              ? `/api/races/${backendRaceId}/leave`
              : `/api/rooms/${backendRaceId}/cancel-registration`,
            {
              method: "POST",
              ...(useLeave
                ? { body: JSON.stringify({ reason: "cancel_registration" }) }
                : {}),
              timeoutMs: 12_000,
            },
          );
          body = (await res.json().catch(() => ({}))) as CashChallengeLeaveResponse;
          if (!res.ok) {
            return { ok: false as const, error: body.error ?? "Could not leave this room.", body };
          }
          void refreshWallet({ silent: true });
          return { ok: true as const, body };
        }

        const res = await authFetch(`/api/races/${backendRaceId}/cancel`, {
          method: "POST",
          timeoutMs: 12_000,
        });
        const body = (await res.json().catch(() => ({}))) as CashChallengeLeaveResponse & {
          code?: string;
          error?: string;
        };
        if (!res.ok) {
          return {
            ok: false as const,
            error: mapPaidCancelError(body),
            body,
            code: body.code,
          };
        }
        void refreshWallet({ silent: true });
        return { ok: true as const, body };
      } catch {
        return {
          ok: false as const,
          error:
            endpoint === "leave"
              ? "Could not leave this room. Check your connection and try again."
              : "Could not cancel this room. Check your connection and try again.",
          body: null,
        };
      }
    },
    [
      backendRaceId,
      liveRoom?.status,
      refreshWallet,
      isUsdCashPaidRoom,
      isUnlimitedGoalRoom,
    ],
  );

  const executeLeave = useCallback(async () => {
    if (leaving || exitingRef.current) return;
    setLeaving(true);
    const result = await runRoomExitApi("leave");
    if (!result.ok) {
      setLeaving(false);
      AppAlert.alert("Could not leave", result.error);
      return;
    }
    setConfirmModal(null);
    setRefundModalVisible(false);

    if (isUsdCashPaidRoom) {
      const body = result.body;
      // Only unlock after backend success — never optimistic unlock on failure.
      if (body && shouldReleaseActiveChallengeLock(body)) {
        void refreshWallet({ silent: true });
      } else {
        void refreshWallet({ silent: true });
      }
      AppAlert.alert("Left Challenge", formatCashLeaveSuccessMessage(body ?? { success: true }));
    }

    navigateToWalkInstant();
  }, [leaving, runRoomExitApi, navigateToWalkInstant, isUsdCashPaidRoom, refreshWallet]);

  const executeHostCancel = useCallback(async () => {
    if (leaving || exitingRef.current) return;
    if (isUsdCashPaidRoom) {
      setConfirmModal(cashLeaveHasStartedPreview ? "leave_post_start" : "leave_pre_start");
      return;
    }
    setLeaving(true);
    const result = await runRoomExitApi("cancel");
    if (!result.ok) {
      setLeaving(false);
      if (result.code === "PAID_CHALLENGE_CANNOT_BE_CANCELLED") {
        AppAlert.alert("Cannot Cancel", result.error || USD_CASH_NO_CANCEL_MESSAGE);
        setConfirmModal(cashLeaveHasStartedPreview ? "leave_post_start" : "leave_pre_start");
        return;
      }
      AppAlert.alert("Could not cancel", result.error);
      return;
    }
    setConfirmModal(null);
    navigateToWalkInstant();
  }, [
    leaving,
    runRoomExitApi,
    navigateToWalkInstant,
    isUsdCashPaidRoom,
    cashLeaveHasStartedPreview,
  ]);

  const handleCancel = useCallback(() => {
    if (!backendRaceId) {
      navigateToWalkInstant();
      return;
    }
    // Paid USD: Leave Challenge only — never cancel / never refund sheet.
    if (isUsdCashPaidRoom) {
      setRefundModalVisible(false);
      setConfirmModal(cashLeaveHasStartedPreview ? "leave_post_start" : "leave_pre_start");
      return;
    }
    if (isHostMode) {
      setConfirmModal("host_cancel");
      return;
    }
    setConfirmModal("leave");
  }, [
    isHostMode,
    backendRaceId,
    isUsdCashPaidRoom,
    cashLeaveHasStartedPreview,
    navigateToWalkInstant,
  ]);

  // ── Room expiry timer (5 min from createdAt) ──────────────────────────────

  // Instant UI: cache → optimistic self before first paint when params are empty.
  const instantSeedDoneRef = useRef(false);
  useLayoutEffect(() => {
    if (instantSeedDoneRef.current || !backendRaceId) return;
    instantSeedDoneRef.current = true;

    if (participants.length > 0) return;

    const cached = readWaitingRoomCacheSync(backendRaceId);
    if (cached?.participants?.length) {
      setParticipants(cached.participants);
      if (cached.liveRoom) setLiveRoom(cached.liveRoom);
      return;
    }

    if (participants.length === 0 && user) {
      const self = buildSelfParticipant(user, isHostMode);
      setParticipants([self]);
      setLiveRoom((prev) => ({
        currentPlayers: params.initialCurrentPlayers
          ? Number(params.initialCurrentPlayers)
          : prev?.currentPlayers ?? 1,
        maxPlayers:
          prev?.maxPlayers ??
          (params.initialMaxPlayers ? Number(params.initialMaxPlayers) : raceMaxPlayers),
        status: prev?.status ?? "open",
        targetSteps: prev?.targetSteps,
        entryType: prev?.entryType,
        entryAmountCents: prev?.entryAmountCents,
        coinEntryAmount: prev?.coinEntryAmount,
        coinPrizePool: prev?.coinPrizePool,
        isPrivate: prev?.isPrivate,
        inviteCode: prev?.inviteCode ?? null,
      }));
    }
  }, [backendRaceId, isHostMode, participants.length, raceMaxPlayers, user, params.initialCurrentPlayers, params.initialMaxPlayers]);

  const persistWaitingRoomCache = useCallback(
    (nextParticipants: RoomParticipant[], nextLiveRoom: typeof liveRoom) => {
      if (!backendRaceId || nextParticipants.length === 0) return;
      cacheWaitingRoomState(backendRaceId, {
        participants: nextParticipants,
        liveRoom: nextLiveRoom as WaitingRoomLiveMeta | null,
      });
    },
    [backendRaceId],
  );

  // ── Server-authoritative race status check ─────────────────────────────────
  const fetchRaceStartState = useCallback(async (): Promise<{
    inProgress: boolean;
    currentPlayers: number;
  }> => {
    if (!backendRaceId) return { inProgress: false, currentPlayers: 2 };
    try {
      // Unlimited challenges often keep API status "waiting" after startAt —
      // check the unlimited endpoint and normalize by schedule window.
      if (isUnlimitedGoalRoom) {
        const ulRes = await authFetch(`/api/unlimited-challenges/${backendRaceId}`);
        if (ulRes.ok) {
          const mapped = mapUnlimitedDetailToWaitingRoom(await ulRes.json().catch(() => null));
          if (mapped?.race) {
            const normalized = normalizeUnlimitedLiveStatus(mapped.race.status, {
              startAt: mapped.race.scheduledStartAt ?? mapped.race.startedAt,
              endAt: null,
            });
            return {
              inProgress: normalized === "in_progress",
              currentPlayers: mapped.race.currentPlayers ?? participantsRef.current.length ?? 1,
            };
          }
        }
      }

      const res = await authFetch(`/api/races/${backendRaceId}`);
      if (!res.ok) {
        // Unlimited id may 404 on /api/races — fall back to schedule window.
        if (isUnlimitedGoalRoom && scheduledStartAt) {
          const normalized = normalizeUnlimitedLiveStatus("waiting", {
            startAt: scheduledStartAt,
            endAt: null,
          });
          return {
            inProgress: normalized === "in_progress",
            currentPlayers: participantsRef.current.length || 1,
          };
        }
        return { inProgress: false, currentPlayers: 2 };
      }
      const data = await res.json();
      const status = data.race?.status as string | undefined;
      if (isUnlimitedGoalRoom) {
        const normalized = normalizeUnlimitedLiveStatus(status, {
          startAt:
            data.race?.scheduledStartAt ??
            data.race?.startedAt ??
            scheduledStartAt,
          endAt: data.race?.endsAt ?? data.race?.challengeEndAt ?? null,
        });
        return {
          inProgress: normalized === "in_progress",
          currentPlayers: data.race?.currentPlayers ?? 2,
        };
      }
      return {
        inProgress: status === "in_progress",
        currentPlayers: data.race?.currentPlayers ?? 2,
      };
    } catch {
      return { inProgress: false, currentPlayers: 2 };
    }
  }, [backendRaceId, isUnlimitedGoalRoom, scheduledStartAt]);

  // ── Navigate to race track ────────────────────────────────────────────────
  // Only called from countdown completion after API confirms in_progress.
  const navigateToRace = useCallback(
    async (playerCount: number) => {
      if (startPhaseRef.current === "navigating") return;
      const { inProgress } = await fetchRaceStartState();
      if (!inProgress) {
        setStart("idle");
        return;
      }
      setStart("navigating");
      if (countdownIntervalRef.current) {
        clearInterval(countdownIntervalRef.current);
        countdownIntervalRef.current = null;
      }
      if (isHostMode) {
        startRaceManually();
      } else {
        notifyRaceStarted(playerCount, raceStartedAtRef.current ?? undefined);
      }
      if (backendRaceId) {
        router.replace({
          pathname: "/race/live-detail",
          params: {
            id: backendRaceId,
            ...(isUnlimitedGoalRoom
              ? { challengeType: UNLIMITED_GOAL_CHALLENGE_TYPE, capacityMode: "unlimited" }
              : null),
          },
        });
      } else {
        router.replace("/(tabs)/live");
      }
    },
    [
      isHostMode,
      startRaceManually,
      notifyRaceStarted,
      backendRaceId,
      setStart,
      fetchRaceStartState,
      isUnlimitedGoalRoom,
    ],
  );

  // ── Begin countdown (3-2-1 → GO → navigate) ──────────────────────────────
  const beginCountdown = useCallback(
    (seconds: number, playerCount: number) => {
      if (startPhaseRef.current !== "idle" && startPhaseRef.current !== "api_call") return;
      setStart("countdown");
      setCountdownNum(seconds);

      let remaining = seconds;
      if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current);

      countdownIntervalRef.current = setInterval(() => {
        remaining -= 1;
        if (remaining > 0) {
          setCountdownNum(remaining);
        } else {
          if (countdownIntervalRef.current) {
            clearInterval(countdownIntervalRef.current);
            countdownIntervalRef.current = null;
          }
          setStart("go");
          // Brief "GO!" flash then navigate
          setTimeout(() => {
            navigateToRace(playerCount);
          }, 600);
        }
      }, 1000);
    },
    [setStart, navigateToRace],
  );

  // ── Cleanup timers on unmount ─────────────────────────────────────────────
  useEffect(() => {
    return () => {
      if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current);
    };
  }, []);

  // ── Poll room + participants (immediate on focus, then interval) ───────────
  const pollRoomRef = useRef<((force?: boolean) => Promise<void>) | null>(null);

  const pollRoom = useCallback(
    async (force = false) => {
      if (useDummyWaitingRoom) return;
      if (!backendRaceId || exitingRef.current) return;
      const gateKey = `${backendRaceId}:matchmaking`;
      if (
        !force &&
        !liveRaceFetchAllowed(gateKey, STEP_SYNC_CONFIG.MATCHMAKING_ROOM_POLL_MS)
      ) {
        return;
      }
      try {
        const preferUnlimited =
          isUnlimitedGoalRoom ||
          params.initialCapacityMode === "unlimited" ||
          params.initialEntryType === UNLIMITED_GOAL_CHALLENGE_TYPE;

        let racePayload: WaitingRoomRacePayload | null = null;
        let rawParticipantCollections: unknown[] = [];
        let usedUnlimitedEndpoint = false;

        if (preferUnlimited) {
          const ulRes = await authFetch(`/api/unlimited-challenges/${backendRaceId}`);
          if (ulRes.ok) {
            const mapped = mapUnlimitedDetailToWaitingRoom(await ulRes.json());
            if (mapped) {
              usedUnlimitedEndpoint = true;
              racePayload = mapped.race as WaitingRoomRacePayload;
              rawParticipantCollections = [mapped.participants];
            }
          }
        }

        if (!racePayload) {
          const res = await authFetch(`/api/races/${backendRaceId}`);
          if (res.ok) {
            const data = await res.json();
            racePayload = data.race as WaitingRoomRacePayload;
            rawParticipantCollections = [
              data.participants,
              data.registrations,
              data.registeredParticipants,
              data.race?.participants,
              data.race?.registrations,
              data.race?.registeredParticipants,
            ];
          } else if (!preferUnlimited) {
            // Race id may actually be an Unlimited challenge.
            const ulRes = await authFetch(`/api/unlimited-challenges/${backendRaceId}`);
            if (ulRes.ok) {
              const mapped = mapUnlimitedDetailToWaitingRoom(await ulRes.json());
              if (mapped) {
                usedUnlimitedEndpoint = true;
                racePayload = mapped.race as WaitingRoomRacePayload;
                rawParticipantCollections = [mapped.participants];
              }
            }
          }
        }

        if (!racePayload) {
          setParticipantsLoading(false);
          setParticipantsError("Could not refresh registered players.");
          return;
        }

        markLiveRaceFetched(gateKey);
        const dataRace = racePayload as WaitingRoomRacePayload & {
          id?: string;
          status?: string;
          currentPlayers?: number;
          maxPlayers?: number | null;
          targetSteps?: number;
          entryType?: string;
          entryAmountCents?: number;
          isPrivate?: boolean;
          inviteCode?: string | null;
          minParticipants?: number;
          min_players?: number;
          minimum_participants?: number;
          room_expires_at?: string | null;
          created_at?: string | null;
          cancellation_reason?: string | null;
          cancelReason?: string | null;
          scheduledStartAt?: string | null;
          scheduled_start_at?: string | null;
          startedAt?: string | null;
          challengeType?: string;
          capacityMode?: string;
          dailyGoalSteps?: number;
          challengeEndAt?: string | null;
          challenge_end_at?: string | null;
          challengeDurationDays?: number;
        };

        if (usedUnlimitedEndpoint && dataRace.id) {
          void import("@/utils/hostedUnlimitedCache").then(({ saveHostedUnlimitedChallenge }) =>
            saveHostedUnlimitedChallenge({
              room_id: dataRace.id!,
              status: dataRace.status ?? "waiting",
              challenge_type: UNLIMITED_GOAL_CHALLENGE_TYPE,
              entry_fee: (dataRace.entryAmountCents ?? 0) / 100,
              coin_entry_amount: 0,
              title: `Unlimited · ${(dataRace.targetSteps ?? 0).toLocaleString()} steps/day`,
              target_steps: dataRace.targetSteps ?? 0,
              max_players: 0,
              registered_count: dataRace.currentPlayers ?? 1,
              scheduled_start_at: dataRace.scheduledStartAt ?? dataRace.scheduled_start_at ?? null,
              challenge_duration_days: dataRace.challengeDurationDays ?? 0,
              challenge_end_at: dataRace.challengeEndAt ?? dataRace.challenge_end_at ?? null,
              selected_track_theme_id: "bg",
              theme_name: "Unlimited",
              is_private: !!dataRace.isPrivate,
              requires_code: !!dataRace.isPrivate,
              host_user_id:
                dataRace.hostUserId ??
                dataRace.host_user_id ??
                dataRace.creatorId ??
                user?.id ??
                "",
              host_username: user?.username ?? "You",
              host_avatar_color: "#00E676",
              host_avatar_url: null,
              host_country_flag: null,
              current_user_registered: true,
              eligible_to_register: false,
              capacity_mode: "unlimited",
            }),
          ).catch(() => {});
        }

        const unlimitedCapacity =
          usedUnlimitedEndpoint ||
          dataRace.capacityMode === "unlimited" ||
          dataRace.challengeType === UNLIMITED_GOAL_CHALLENGE_TYPE ||
          dataRace.entryType === UNLIMITED_GOAL_CHALLENGE_TYPE ||
          dataRace.maxPlayers == null ||
          (typeof dataRace.maxPlayers === "number" && dataRace.maxPlayers <= 0);

        // Same min-player / canStart rules as Free / Coins / Cash — Unlimited
        // only differs on capacity (no max), not on who may start the race.
        const minParticipants = resolveMinimumParticipants(
          dataRace.minimumParticipants ??
            dataRace.minParticipants ??
            dataRace.min_players ??
            dataRace.minimum_participants,
        );
        const nextLiveRoom = {
          currentPlayers: dataRace.currentPlayers ?? 1,
          maxPlayers: unlimitedCapacity ? 0 : (dataRace.maxPlayers ?? raceMaxPlayers),
          status: dataRace.status,
          targetSteps:
            dataRace.targetSteps ??
            dataRace.dailyGoalSteps ??
            (params.initialDailyGoalSteps ? Number(params.initialDailyGoalSteps) : undefined),
          entryType: dataRace.entryType,
          entryAmountCents: dataRace.entryAmountCents,
          coinEntryAmount: dataRace.coinEntryAmount,
          coinPrizePool: dataRace.coinPrizePool,
          isPrivate: dataRace.isPrivate,
          inviteCode: dataRace.inviteCode ?? null,
          minimumParticipants: minParticipants,
          canStart:
            typeof dataRace.canStart === "boolean"
              ? dataRace.canStart
              : (dataRace.currentPlayers ?? 1) >= minParticipants,
          roomExpiresAt:
            dataRace.roomExpiresAt ??
            dataRace.room_expires_at ??
            null,
          createdAt: dataRace.createdAt ?? dataRace.created_at ?? null,
          cancellationReason:
            dataRace.cancellationReason ??
            dataRace.cancellation_reason ??
            dataRace.cancelReason ??
            null,
          challengeType: dataRace.challengeType,
          capacityMode: unlimitedCapacity ? "unlimited" : dataRace.capacityMode,
        };
        setLiveRoom(nextLiveRoom);
        const apiSchedule =
          (typeof dataRace.scheduledStartAt === "string" && dataRace.scheduledStartAt) ||
          (typeof dataRace.scheduled_start_at === "string" && dataRace.scheduled_start_at) ||
          null;
        if (apiSchedule) {
          setScheduledStartAt(apiSchedule);
        }
        const scheduleForMode = apiSchedule || scheduledStartAt;

        const wrMode = resolveWaitingRoomMode(scheduleForMode);
        const expiresAt = resolveRoomExpiresAt({
          mode: wrMode,
          roomExpiresAt: nextLiveRoom.roomExpiresAt,
          createdAt: nextLiveRoom.createdAt,
        });
        roomExpiresAtRef.current = expiresAt;

        const statusLower = String(dataRace.status ?? "").toLowerCase();
        const effectiveLiveStatus = unlimitedCapacity
          ? normalizeUnlimitedLiveStatus(dataRace.status, {
              startAt:
                apiSchedule ||
                dataRace.startedAt ||
                scheduledStartAt,
              endAt:
                dataRace.challengeEndAt ??
                dataRace.challenge_end_at ??
                null,
            })
          : statusLower;
        if (
          statusLower === "cancelled" ||
          statusLower === "canceled" ||
          statusLower === "expired" ||
          statusLower === "closed"
        ) {
          showTerminalRoomClosed(nextLiveRoom.cancellationReason, wrMode);
          return;
        }

        if (nextLiveRoom.targetSteps) {
          setRaceTargetSteps(nextLiveRoom.targetSteps);
        }
        if (dataRace.startedAt && !raceStartedAtRef.current) {
          raceStartedAtRef.current = new Date(dataRace.startedAt);
        }
        const hasServerParticipantCollection = rawParticipantCollections.some(Array.isArray);
        const serverParticipants = hasServerParticipantCollection
          ? rawParticipantCollections.flatMap((collection) =>
              Array.isArray(collection) ? collection : [],
            )
          : [];
        // Empty [] from Unlimited detail would wipe the host seed — keep local until API has rows.
        const rawParticipants =
          serverParticipants.length > 0
            ? serverParticipants
            : participantsRef.current.length > 0
              ? participantsRef.current
              : serverParticipants;
        const normalized = normalizeWaitingRoomParticipants(
          rawParticipants,
          dataRace,
          user,
          isHostMode,
        );
        // Never slice(0, 0) for unlimited — that wiped the host from the list.
        const nextParticipants =
          unlimitedCapacity || nextLiveRoom.maxPlayers <= 0
            ? normalized
            : normalized.slice(0, nextLiveRoom.maxPlayers);
        setParticipants(nextParticipants);
        setParticipantsLoading(false);
        setParticipantsError(null);
        persistWaitingRoomCache(nextParticipants, nextLiveRoom);
        void refreshOnlineIds();
        if (
          (effectiveLiveStatus === "in_progress" || dataRace.status === "in_progress") &&
          startPhaseRef.current === "idle"
        ) {
          beginCountdown(3, dataRace.currentPlayers ?? 2);
        }
      } catch {
        setParticipantsLoading(false);
        setParticipantsError("Could not refresh registered players.");
      }
    },
    [
      backendRaceId,
      raceMaxPlayers,
      beginCountdown,
      setRaceTargetSteps,
      persistWaitingRoomCache,
      user,
      isHostMode,
      refreshOnlineIds,
      scheduledStartAt,
      showTerminalRoomClosed,
      isUnlimitedGoalRoom,
      params.initialCapacityMode,
      params.initialEntryType,
      params.initialDailyGoalSteps,
      useDummyWaitingRoom,
    ],
  );

  useEffect(() => {
    pollRoomRef.current = pollRoom;
  }, [pollRoom]);

  useFocusEffect(
    useCallback(() => {
      if (!backendRaceId) return;
      void pollRoom(true);
      const interval = setInterval(
        () => { void pollRoom(false); },
        STEP_SYNC_CONFIG.MATCHMAKING_ROOM_POLL_MS,
      );
      return () => clearInterval(interval);
    }, [backendRaceId, pollRoom]),
  );

  // ── Store race ID in context ──────────────────────────────────────────────
  const didBindActiveRaceRef = useRef(false);
  useEffect(() => {
    if (!params.raceId || contextRaceId || didBindActiveRaceRef.current) return;
    didBindActiveRaceRef.current = true;
    setActiveRace(params.raceId, params.isHost === "true");
  }, [params.raceId, params.isHost, contextRaceId, setActiveRace]);

  // ── Pusher subscriptions ──────────────────────────────────────────────────
  // All handlers validate event.raceId === backendRaceId before acting.
  useEffect(() => {
    if (!backendRaceId) return;
    connectPusher();
    const channel = subscribeToChannel(CHANNELS.liveRace(backendRaceId));
    if (!channel) return;

    const currentPlayers = () => liveRoomRef.current?.currentPlayers ?? 2;

    const refreshRoomFromServer = (data?: { raceId?: string; room_id?: string }) => {
      const eventRoomId = data?.raceId ?? data?.room_id;
      if (eventRoomId && eventRoomId !== backendRaceId) return;
      void pollRoomRef.current?.(true);
    };

    // race:starting — the authoritative trigger for the countdown overlay
    const onStarting = (data: { raceId?: string; countdownSeconds?: number }) => {
      if (data.raceId && data.raceId !== backendRaceId) return;
      if (startPhaseRef.current !== "idle") return; // already handling start
      beginCountdown(data.countdownSeconds ?? 3, currentPlayers());
    };

    // race:started — safety-net in case the client missed race:starting
    const onStarted = async (data: { raceId?: string }) => {
      if (data.raceId && data.raceId !== backendRaceId) return;
      if (startPhaseRef.current !== "idle") return;
      try {
        const res = await authFetch(`/api/races/${backendRaceId}`);
        if (!res.ok) return;
        const body = await res.json();
        if (body.race?.status !== "in_progress") return;
        beginCountdown(3, body.race.currentPlayers ?? currentPlayers());
      } catch { /* silent */ }
    };

    // race:cancelled / waiting_room_cancelled / expired
    const onCancelled = (data: {
      raceId?: string;
      reason?: string;
      cancellationReason?: string;
    }) => {
      if (data.raceId && data.raceId !== backendRaceId) return;
      if (!screenFocusedRef.current || exitingRef.current) return;
      showTerminalRoomClosed(
        data.cancellationReason ?? data.reason ?? "HOST_CANCELLED",
      );
    };

    // room:participant_removed
    // NOTE: we compare against myUserIdRef (a ref) rather than participants state
    // so we don't need to put a side effect (setWasRemoved) inside the pure
    // setParticipants updater — React can call updaters twice in Strict Mode.
    const onRemoved = (data: { removedUserId: string; currentPlayers: number; participantIds: string[] }) => {
      const removedIsMe = !!myUserIdRef.current && data.removedUserId === myUserIdRef.current;
      if (removedIsMe) {
        setWasRemoved(true);
        // Do NOT update participants list for ourselves — wasRemoved effect handles navigation.
        return;
      }
      setParticipants((prev) => prev.filter((p) => p.userId !== data.removedUserId));
      setLiveRoom((prev) => prev ? { ...prev, currentPlayers: data.currentPlayers } : prev);
    };

    // race:player-left
    const onLeft = (data: { userId: string }) => {
      setParticipants((prev) => prev.filter((p) => p.userId !== data.userId));
      setLiveRoom((prev) =>
        prev && prev.currentPlayers > 1
          ? { ...prev, currentPlayers: prev.currentPlayers - 1 }
          : prev,
      );
      // Reset invite status so host can re-invite the player who left
      setInviteStatuses((prev) =>
        prev[data.userId] ? { ...prev, [data.userId]: "idle" } : prev,
      );
    };

    channel.bind("race:starting", onStarting);
    channel.bind(EVENTS.RACE_STARTED, onStarted);
    channel.bind("race:cancelled", onCancelled);
    channel.bind("waiting_room_cancelled", onCancelled);
    channel.bind("waiting_room_expired", onCancelled);
    channel.bind("room:participant_removed", onRemoved);
    channel.bind("race:player-left", onLeft);
    channel.bind("race:player-joined", refreshRoomFromServer);
    channel.bind("coins_battle.joined", refreshRoomFromServer);
    channel.bind("room:registered", refreshRoomFromServer);
    channel.bind("room:registration_cancelled", refreshRoomFromServer);
    channel.bind("room:participant_joined", refreshRoomFromServer);
    channel.bind("room:participant_left", refreshRoomFromServer);

    return () => {
      channel.unbind("race:starting", onStarting);
      channel.unbind(EVENTS.RACE_STARTED, onStarted);
      channel.unbind("race:cancelled", onCancelled);
      channel.unbind("waiting_room_cancelled", onCancelled);
      channel.unbind("waiting_room_expired", onCancelled);
      channel.unbind("room:participant_removed", onRemoved);
      channel.unbind("race:player-left", onLeft);
      channel.unbind("race:player-joined", refreshRoomFromServer);
      channel.unbind("coins_battle.joined", refreshRoomFromServer);
      channel.unbind("room:registered", refreshRoomFromServer);
      channel.unbind("room:registration_cancelled", refreshRoomFromServer);
      channel.unbind("room:participant_joined", refreshRoomFromServer);
      channel.unbind("room:participant_left", refreshRoomFromServer);
      unsubscribeFromChannel(CHANNELS.liveRace(backendRaceId));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backendRaceId, beginCountdown, showTerminalRoomClosed]);

  // Scheduled registration events are emitted on the existing public rooms
  // channel before the race join window opens.
  useEffect(() => {
    if (!backendRaceId) return;
    const channel = subscribeToChannel("public-rooms-available");
    if (!channel) return;

    const refreshScheduledRoom = (data?: { room_id?: string; raceId?: string }) => {
      const eventRoomId = data?.room_id ?? data?.raceId;
      if (eventRoomId && eventRoomId !== backendRaceId) return;
      void pollRoomRef.current?.(true);
    };

    channel.bind("room:registered", refreshScheduledRoom);
    channel.bind("room:registration_cancelled", refreshScheduledRoom);
    channel.bind("room:participant_joined", refreshScheduledRoom);
    channel.bind("room:participant_left", refreshScheduledRoom);

    return () => {
      channel.unbind("room:registered", refreshScheduledRoom);
      channel.unbind("room:registration_cancelled", refreshScheduledRoom);
      channel.unbind("room:participant_joined", refreshScheduledRoom);
      channel.unbind("room:participant_left", refreshScheduledRoom);
      // Do not unsubscribe the shared channel: Walk/Rooms may own it too.
    };
  }, [backendRaceId]);

  // Keep a ref to liveRoom so Pusher callbacks can read it without stale closure
  const liveRoomRef = useRef(liveRoom);
  useEffect(() => { liveRoomRef.current = liveRoom; }, [liveRoom]);

  /** Only show room-cancelled alerts while this screen is focused. */
  const screenFocusedRef = useRef(true);
  useFocusEffect(
    useCallback(() => {
      screenFocusedRef.current = true;
      return () => {
        screenFocusedRef.current = false;
      };
    }, []),
  );

  // ── Populate myUserIdRef from participants ────────────────────────────────
  // Gives the Pusher onRemoved closure a stable ref to compare against.
  useEffect(() => {
    const me = participants.find((p) => p.isCurrentUser);
    if (me && !myUserIdRef.current) {
      myUserIdRef.current = me.userId;
    }
  }, [participants]);

  // ── Handle being removed from room ───────────────────────────────────────
  useEffect(() => {
    if (!wasRemoved) return;
    navigateToWalkInstant();
    setTimeout(() => {
      Alert.alert("Removed from Room", "The host removed you from this room.");
    }, 350);
  }, [wasRemoved, navigateToWalkInstant]);

  // ── Pulse animation ───────────────────────────────────────────────────────
  useEffect(() => {
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.08, duration: 700, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 700, useNativeDriver: true }),
      ]),
    );
    pulse.start();
    return () => pulse.stop();
  }, [pulseAnim]);

  // ── Room display clock + open_window expiry countdown ─────────────────────
  const lastForcedReconcileRef = useRef(0);
  useEffect(() => {
    if (!backendRaceId) return;
    const tick = () => {
      const now = Date.now();
      setNowMs(now);
      if (terminalHandledRef.current) return;
      const shouldReconcile = () => {
        if (now - lastForcedReconcileRef.current < 3000) return false;
        lastForcedReconcileRef.current = now;
        void pollRoomRef.current?.(true);
        return true;
      };
      const expires = roomExpiresAtRef.current;
      // Authoritative close is backend-driven; force a reconcile when local clock hits 0.
      if (expires && expires.getTime() - now <= 0) {
        shouldReconcile();
        return;
      }
      // At/after scheduled start, reconcile until backend starts or cancels.
      if (scheduledStartAt && startPhaseRef.current === "idle") {
        const startMs = new Date(scheduledStartAt).getTime();
        if (Number.isFinite(startMs) && startMs <= now) {
          shouldReconcile();
        }
      }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [backendRaceId, scheduledStartAt, liveRoom?.createdAt, liveRoom?.roomExpiresAt]);

  // App resume: immediately reconcile room status (do not extend timers).
  useEffect(() => {
    const onChange = (next: AppStateStatus) => {
      if (next === "active" && backendRaceId && !exitingRef.current) {
        void pollRoomRef.current?.(true);
      }
    };
    const sub = AppState.addEventListener("change", onChange);
    return () => sub.remove();
  }, [backendRaceId]);

  // ── Host: start race (open_window only; scheduled starts via backend) ──────
  const startingRef = useRef(false);

  const handleStartRace = useCallback(async () => {
    if (startingRef.current) return;
    if (resolveWaitingRoomMode(scheduledStartAt) === "scheduled") return;
    const minNeeded = resolveMinimumParticipants(
      liveRoomRef.current?.minimumParticipants,
    );
    const currentCount = liveRoomRef.current?.currentPlayers ?? 1;
    const backendCanStart = liveRoomRef.current?.canStart;
    if (typeof backendCanStart === "boolean") {
      if (!backendCanStart) return;
    } else if (currentCount < minNeeded) {
      return;
    }
    startingRef.current = true;
    setStart("api_call");

    try {
      if (!backendRaceId) {
        setStart("idle");
        startingRef.current = false;
        return;
      }
      const res = await authFetch(`/api/races/${backendRaceId}/start`, { method: "POST" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { error?: string };
        setStart("idle");
        startingRef.current = false;
        AppAlert.alert("Couldn't Start", err.error ?? "Please try again.");
        return;
      }
      // API success: backend fires race:starting via Pusher which drives our countdown.
      // Show the countdown overlay for the host immediately (don't wait for Pusher round-trip).
      beginCountdown(3, currentCount);
    } catch {
      setStart("idle");
      startingRef.current = false;
      AppAlert.alert("Couldn't Start", "Network error. Please try again.");
    }
  }, [backendRaceId, setStart, beginCountdown, scheduledStartAt]);

  /** Unlimited Waiting Room → Live Race when the Unlimited frontend flag is on. */
  const enterUnlimitedLiveRace = useCallback(async () => {
    if (useDummyWaitingRoom) {
      enterDummyLiveRace();
      return;
    }
    if (!backendRaceId || startPhaseRef.current === "navigating") return;

    const playerCount = Math.max(participantsRef.current.length, 1);
    const { inProgress, currentPlayers } = await fetchRaceStartState();
    if (inProgress) {
      await navigateToRace(Math.max(currentPlayers, playerCount));
      return;
    }

    if (isHostMode && resolveWaitingRoomMode(scheduledStartAt) === "open_window") {
      await handleStartRace();
      return;
    }

    // Flag-on path: leave Waiting Room into Live Race even if API still says waiting
    // (common for Unlimited after scheduled start). live-detail loads the same race id.
    setStart("navigating");
    if (countdownIntervalRef.current) {
      clearInterval(countdownIntervalRef.current);
      countdownIntervalRef.current = null;
    }
    if (isHostMode) {
      startRaceManually();
    } else {
      notifyRaceStarted(playerCount, raceStartedAtRef.current ?? undefined);
    }
    router.replace({
      pathname: "/race/live-detail",
      params: {
        id: backendRaceId,
        challengeType: UNLIMITED_GOAL_CHALLENGE_TYPE,
        capacityMode: "unlimited",
        ...(isUnlimitedRaceDummyDataEnabled() ? { dummyRace: "1" } : null),
      },
    });
  }, [
    useDummyWaitingRoom,
    enterDummyLiveRace,
    backendRaceId,
    fetchRaceStartState,
    navigateToRace,
    isHostMode,
    scheduledStartAt,
    handleStartRace,
    setStart,
    startRaceManually,
    notifyRaceStarted,
  ]);

  // ── Derived values ────────────────────────────────────────────────────────
  const realPlayerCount = Math.max(
    liveRoom?.currentPlayers ?? 0,
    participants.length,
    playersJoined,
  );
  const realMaxPlayers = liveRoom?.maxPlayers ?? raceMaxPlayers;
  const waitingRoomMode = resolveWaitingRoomMode(scheduledStartAt, nowMs);
  const minimumParticipants = resolveMinimumParticipants(liveRoom?.minimumParticipants);
  const neededPlayers = playersNeeded(minimumParticipants, realPlayerCount);
  const roomExpiresAtResolved = useMemo(
    () =>
      resolveRoomExpiresAt({
        mode: waitingRoomMode,
        roomExpiresAt: liveRoom?.roomExpiresAt,
        createdAt: liveRoom?.createdAt,
      }),
    [waitingRoomMode, liveRoom?.roomExpiresAt, liveRoom?.createdAt],
  );
  useEffect(() => {
    if (waitingRoomMode === "scheduled") {
      roomExpiresAtRef.current = null;
      return;
    }
    roomExpiresAtRef.current = roomExpiresAtResolved;
  }, [waitingRoomMode, roomExpiresAtResolved]);
  const backendCanStart =
    typeof liveRoom?.canStart === "boolean"
      ? liveRoom.canStart
      : neededPlayers === 0;
  const canStart =
    isHostMode &&
    waitingRoomMode === "open_window" &&
    backendCanStart &&
    startPhase === "idle";
  const waitingBanner = getWaitingRoomBanner({
    mode: waitingRoomMode,
    status:
      startPhase === "api_call" || startPhase === "countdown" || startPhase === "go"
        ? "starting"
        : liveRoom?.status,
    scheduledStartAt,
    roomExpiresAt: roomExpiresAtResolved,
    participantCount: realPlayerCount,
    minimumParticipants,
    nowMs,
  });
  // Use liveRoom.entryType as the authoritative source (populated from backend).
  // Fall back to raceEntryFee===0 for the brief moment before the first poll returns.
  const isFreeRace = liveRoom?.entryType === "free" || (!liveRoom && raceEntryFee === 0);

  const isUnlimitedCapacity =
    isUnlimitedGoalRoom ||
    liveRoom?.capacityMode === "unlimited" ||
    realMaxPlayers <= 0;

  // Dummy-only shortcut. Real Unlimited uses the same Start / scheduled /
  // Leave CTAs as other races (min players, canStart, open_window rules).
  const showUnlimitedEnterCta = useDummyWaitingRoom;

  // The normalized occupied list is the only source for grid order and count.
  const sortedParticipants = useMemo(() => {
    const deduped = new Map<string, RoomParticipant>();
    participants.forEach((participant) => {
      if (!participant.userId || deduped.has(participant.userId)) return;
      const status = participant.status?.trim().toLowerCase();
      if (status && NON_ACTIVE_REGISTRATION_STATUSES.has(status)) return;
      deduped.set(participant.userId, participant);
    });
    const ordered = [...deduped.values()].sort((a, b) => {
      if (a.isHost !== b.isHost) return a.isHost ? -1 : 1;
      return participantTime(a) - participantTime(b);
    });
    if (isUnlimitedCapacity || realMaxPlayers <= 0) return ordered;
    return ordered.slice(0, realMaxPlayers);
  }, [participants, realMaxPlayers, isUnlimitedCapacity]);
  const occupiedPlayerCount = sortedParticipants.length;
  const slots: Array<RoomParticipant | null> = useMemo(() => {
    // A non-host viewer's seed only contains "self", so before the first poll
    // resolves the host, self would briefly render in slot 1 and then jump to
    // slot 2 once the host arrives. Reserve slot 1 as a host skeleton while
    // loading so the current user's avatar never flashes in the host position.
    const hostKnown = sortedParticipants.some((p) => p.isHost);
    const reserveHostSlot = !isHostMode && !hostKnown && participantsLoading;
    const occupied: Array<RoomParticipant | null> = reserveHostSlot
      ? [null, ...sortedParticipants]
      : [...sortedParticipants];
    if (isUnlimitedCapacity || realMaxPlayers <= 0) {
      // Unlimited: only real joiners (+ optional host skeleton while loading).
      if (occupied.length === 0 && participantsLoading) return [null];
      return occupied;
    }
    return [
      ...occupied,
      ...Array(Math.max(0, realMaxPlayers - occupied.length)).fill(null),
    ].slice(0, realMaxPlayers);
  }, [
    sortedParticipants,
    realMaxPlayers,
    isHostMode,
    participantsLoading,
    isUnlimitedCapacity,
  ]);

  const unlimitedSlotSize = Math.min(72, Math.max(56, Math.floor(layoutWidth * 0.18)));

  const showingOverlay = startPhase !== "idle";

  // ── Invite API helpers ────────────────────────────────────────────────────
  const openInvitePanel = useCallback(() => {
    setInvitePanelOpen(true);
    Animated.spring(slideAnim, { toValue: 0, useNativeDriver: true, tension: 70, friction: 11 }).start();
  }, [slideAnim]);

  const closeInvitePanel = useCallback(() => {
    candidatesLoadedRef.current = false;
    friendsLoadedRef.current = false;
    Animated.timing(slideAnim, { toValue: SCREEN_W, duration: 240, useNativeDriver: true }).start(() =>
      setInvitePanelOpen(false),
    );
  }, [slideAnim]);

  const toggleInvitePanel = useCallback(() => {
    if (invitePanelOpen) closeInvitePanel();
    else openInvitePanel();
  }, [invitePanelOpen, openInvitePanel, closeInvitePanel]);

  const loadOnlineCandidates = useCallback(async () => {
    if (!backendRaceId) return;
    if (!candidatesLoadedRef.current) setLoadingCandidates(true);
    try {
      const res = await authFetch(`/api/races/${backendRaceId}/online-invite-candidates`);
      if (res.ok) {
        const data = await res.json() as { candidates: OnlineCandidate[] };
        const list = data.candidates ?? [];
        setOnlineCandidates(list);
        // Sync local invite statuses with server truth:
        // reset anyone who is no longer pending server-side
        setInviteStatuses((prev) => {
          const next = { ...prev };
          for (const c of list) {
            if (c.inviteStatus === "pending") {
              next[c.userId] = "pending";
            } else if (next[c.userId] === "pending") {
              // Server says no longer pending (accepted/declined/expired) → allow re-invite
              next[c.userId] = "idle";
            }
          }
          return next;
        });
      }
      candidatesLoadedRef.current = true;
    } catch { /* silent */ }
    setLoadingCandidates(false);
  }, [backendRaceId]);

  const loadFriends = useCallback(async () => {
    if (!friendsLoadedRef.current) setLoadingFriends(true);
    try {
      const res = await authFetch("/api/friends");
      if (res.ok) {
        const data = await res.json() as {
          friends: { id: string; username: string; avatarUrl: string | null; avatarColor: string; flag?: string; isOnline?: boolean; avatarVersion?: number }[];
        };
        // Normalize API shape (id → userId, flag → countryFlag) to match FriendItem
        setFriendsList(
          (data.friends ?? []).map((f) => ({
            userId: f.id,
            username: f.username,
            avatarUrl: f.avatarUrl,
            avatarColor: f.avatarColor,
            avatarVersion: f.avatarVersion,
            countryFlag: f.flag ?? null,
            country: null,
            isOnline: f.isOnline ?? false,
          })),
        );
        const onlineFriends = new Set<string>();
        for (const f of data.friends ?? []) {
          if (!f.isOnline) continue;
          const id = normalizeUserId(f.id);
          if (id) onlineFriends.add(id);
        }
        setFriendsOnlineIds(onlineFriends);
      }
      friendsLoadedRef.current = true;
    } catch { /* silent */ }
    setLoadingFriends(false);
  }, []);

  // Keep friend online flags fresh for Waiting Room dots (same /api/friends as Chat).
  useFocusEffect(
    useCallback(() => {
      void loadFriends();
      const id = setInterval(() => {
        void loadFriends();
      }, 10_000);
      return () => clearInterval(id);
    }, [loadFriends]),
  );

  const sendInvite = useCallback(async (inviteeId: string) => {
    if (!backendRaceId) return;
    setInviteStatuses((prev) => ({ ...prev, [inviteeId]: "sending" }));
    try {
      const res = await authFetch(`/api/races/${backendRaceId}/invites`, {
        method: "POST",
        body: JSON.stringify({ inviteeId }),
      });
      if (res.ok) {
        setInviteStatuses((prev) => ({ ...prev, [inviteeId]: "pending" }));
        // Auto-reset after 20s (server-side invite expires) so inviter can resend
        setTimeout(() => {
          setInviteStatuses((prev) =>
            prev[inviteeId] === "pending" ? { ...prev, [inviteeId]: "idle" } : prev,
          );
        }, 20_000);
      } else {
        setInviteStatuses((prev) => ({ ...prev, [inviteeId]: "idle" }));
      }
    } catch {
      setInviteStatuses((prev) => ({ ...prev, [inviteeId]: "idle" }));
    }
  }, [backendRaceId]);

  // Poll online candidates every 5s while the panel is open.
  // Available to host and participants for free / coins / cash waiting rooms.
  useEffect(() => {
    if (!invitePanelOpen || !backendRaceId) return;
    loadOnlineCandidates(); // immediate first load
    const id = setInterval(loadOnlineCandidates, 5_000);
    return () => clearInterval(id);
  }, [invitePanelOpen, backendRaceId, loadOnlineCandidates]);

  // Poll friends every 5s when Friends tab is open
  useEffect(() => {
    if (!invitePanelOpen || !backendRaceId || inviteTab !== "friends") return;
    loadFriends(); // immediate first load
    const id = setInterval(loadFriends, 5_000);
    return () => clearInterval(id);
  }, [inviteTab, invitePanelOpen, backendRaceId, loadFriends]);

  // ── Invite list derived values (computed before render, stable references) ─
  const isOnlineTab = inviteTab === "online";
  const inviteListLoading = isOnlineTab ? loadingCandidates : loadingFriends;
  const inviteList = isOnlineTab ? onlineCandidates.filter((c) => !c.isFriend) : friendsList;
  // Set of userIds already in the room — used to show "Joined" badge on the invite panel
  const participantIds = new Set(participants.map((p) => p.userId));

  // ── Render ────────────────────────────────────────────────────────────────
  const targetSteps = liveRoom?.targetSteps ?? RACE_DEFAULTS.RACE_TARGET;
  const coinEntry = liveRoom?.coinEntryAmount ?? 0;
  const coinPool = liveRoom?.coinPrizePool ?? (coinEntry * realPlayerCount);
  const cashEntry = liveRoom?.entryAmountCents != null ? liveRoom.entryAmountCents / 100 : raceEntryFee;

  // Same pattern as Live Race: manual bottom inset (SafeAreaView bottom can be 0 on Android).
  const waitingBottomInset = Math.max(
    safeBottom,
    Platform.OS === "android" ? 48 : 20,
  );

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: "#050711" }]}
      edges={["top", "left", "right"]}
    >
      <LinearGradient
        colors={["#1E1B4B88", "#05071100", "#7C3AED22"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFillObject}
      />

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={[
          styles.content,
          {
            paddingTop: rs(12),
            paddingBottom: rs(20),
            paddingHorizontal: rs(20),
          },
        ]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.topBar}>
          <TouchableOpacity
            style={styles.iconBtn}
            onPress={() => {
              if (router.canGoBack()) router.back();
              else navigateToWalkInstant();
            }}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Feather name="arrow-left" size={18} color="#E2E8F8" />
          </TouchableOpacity>
        </View>

        <Animated.View
          style={[
            styles.searchIcon,
            {
              backgroundColor: "#12162A",
              borderColor: "#7C3AED66",
              transform: [{ scale: pulseAnim }],
            },
          ]}
        >
          <LinearGradient
            colors={["#7C3AED40", "#6366F133"]}
            style={styles.searchIconGrad}
          >
            <Feather name="search" size={24} color="#A78BFA" />
          </LinearGradient>
        </Animated.View>

        <Text style={styles.title}>Waiting Room</Text>
        <Text style={styles.subtitle}>
          {waitingRoomMode === "scheduled"
            ? "Race will start automatically at the Scheduled time."
            : "The host can start once the minimum number of players joins."}
        </Text>
        {scheduledStartAt ? (
          <View style={styles.scheduleRow}>
            <Feather name="calendar" size={14} color="#C4B5FD" />
            <Text style={styles.scheduleText}>
              {formatWaitingRoomSchedule(scheduledStartAt)}
            </Text>
          </View>
        ) : null}

        <View style={styles.infoBanner}>
          <Feather
            name={
              waitingBanner.kind === "scheduled_starting"
                ? "loader"
                : waitingBanner.kind === "scheduled_soon" || waitingBanner.kind === "open_ready"
                  ? "zap"
                  : "clock"
            }
            size={16}
            color="#A78BFA"
          />
          <View style={{ flex: 1 }}>
            <Text style={styles.infoBannerTitle}>{waitingBanner.title}</Text>
            <Text style={styles.infoBannerSub}>{waitingBanner.message}</Text>
          </View>
        </View>

        {isHostMode && (
          <View style={[styles.hostBanner, { backgroundColor: colors.gold + "18", borderColor: colors.gold + "40" }]}>
            <Feather name="star" size={13} color={colors.gold} />
            <Text style={[styles.hostBannerText, { color: colors.gold }]}>You are the Host</Text>
          </View>
        )}

        <View style={styles.panelCard}>
          <View style={styles.panelHead}>
            <Text style={styles.panelLabel}>PLAYERS JOINED</Text>
            <Text style={styles.panelCount}>
              {participantsLoading
                ? "—"
                : isUnlimitedCapacity
                  ? `${occupiedPlayerCount} joined`
                  : `${occupiedPlayerCount} / ${realMaxPlayers}`}
            </Text>
          </View>

          {isUnlimitedCapacity ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.unlimitedScroller}
            >
              {slots.map((p, i) => (
                <View
                  key={p?.userId ? `${p.userId}-${i}` : `empty-${i}`}
                  style={[styles.unlimitedSlotCell, { width: unlimitedSlotSize }]}
                >
                  <PlayerSlot
                    participant={p}
                    onPress={p ? () => setSelectedParticipant(p) : undefined}
                    isOnline={isParticipantOnline(p)}
                    loading={participantsLoading && !p}
                    colors={colors}
                    slotSize={unlimitedSlotSize}
                  />
                </View>
              ))}
            </ScrollView>
          ) : (
            <View style={styles.grid}>
              {slots.map((p, i) => (
                <View key={p?.userId ? `${p.userId}-${i}` : `empty-${i}`} style={styles.slotCell}>
                  <PlayerSlot
                    participant={p}
                    onPress={p ? () => setSelectedParticipant(p) : undefined}
                    isOnline={isParticipantOnline(p)}
                    loading={participantsLoading && !p}
                    colors={colors}
                    slotSize={slotSize}
                  />
                </View>
              ))}
            </View>
          )}

          {sortedParticipants.length > 0 && (
            <Text style={styles.tapHint}>Tap a player to view their profile</Text>
          )}

          {participantsError && !participantsLoading && (
            <View style={styles.participantErrorRow}>
              <Text style={styles.participantErrorText}>{participantsError}</Text>
              <TouchableOpacity
                style={styles.participantRetryBtn}
                onPress={() => {
                  setParticipantsLoading(true);
                  setParticipantsError(null);
                  void pollRoomRef.current?.(true);
                }}
              >
                <Feather name="refresh-cw" size={12} color="#C4B5FD" />
                <Text style={styles.participantRetryText}>Retry</Text>
              </TouchableOpacity>
            </View>
          )}

          {!isUnlimitedCapacity && (
            <View style={styles.progressTrack}>
              <LinearGradient
                colors={["#60A5FA", "#A78BFA"]}
                style={[
                  styles.progressFill,
                  {
                    width: `${Math.min(
                      100,
                      (occupiedPlayerCount / Math.max(1, realMaxPlayers)) * 100,
                    )}%`,
                  },
                ]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
              />
            </View>
          )}
        </View>

        <View style={styles.statsRow}>
          <View style={styles.statCol}>
            <Feather name="activity" size={16} color="#60A5FA" />
            <Text style={styles.statValue}>{targetSteps.toLocaleString()}</Text>
            <Text style={styles.statLabel}>Steps Goal</Text>
          </View>
          <View style={styles.statCol}>
            {liveRoom?.entryType === "coins_battle" ? (
              <>
                <Feather name="award" size={18} color="#F59E0B" />
                <PremiumWaitingRoomValue>{coinEntry.toLocaleString()} Coins</PremiumWaitingRoomValue>
                <Text style={styles.statLabel}>Coins Entry</Text>
              </>
            ) : isFreeRace ? (
              <>
                <Feather name="smile" size={16} color="#00E676" />
                <Text style={styles.statValue}>Free</Text>
                <Text style={styles.statLabel}>Entry</Text>
              </>
            ) : (
              <>
                <Feather name="dollar-sign" size={18} color="#F59E0B" />
                <PremiumWaitingRoomValue>${cashEntry.toFixed(0)}</PremiumWaitingRoomValue>
                <Text style={styles.statLabel}>Cash Entry</Text>
              </>
            )}
          </View>
          <View style={styles.statCol}>
            <Feather name="award" size={18} color="#F59E0B" />
            {liveRoom?.entryType === "coins_battle" || !isFreeRace ? (
              <PremiumWaitingRoomValue primary>
                {liveRoom?.entryType === "coins_battle"
                  ? `${coinPool.toLocaleString()} Coins`
                  : `$${(cashEntry * realPlayerCount).toFixed(0)}`}
              </PremiumWaitingRoomValue>
            ) : (
              <Text style={styles.statValue}>
                —
              </Text>
            )}
            <Text style={styles.statLabel}>Prize Pool</Text>
          </View>
        </View>

        {(liveRoom?.isPrivate && liveRoom.inviteCode) || (backendRaceId && !liveRoom?.isPrivate) ? (
          <View style={styles.roomIdCard}>
            <Text style={styles.roomIdLabel}>
              {liveRoom?.isPrivate && liveRoom.inviteCode ? "Room Code" : "Room ID"}
            </Text>
            <View style={styles.roomIdRow}>
              <Text style={styles.roomIdValue} numberOfLines={1}>
                {liveRoom?.isPrivate && liveRoom.inviteCode
                  ? liveRoom.inviteCode
                  : `${backendRaceId?.slice(0, 8)}…`}
              </Text>
              <TouchableOpacity
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                onPress={async () => {
                  const val = liveRoom?.isPrivate && liveRoom.inviteCode
                    ? liveRoom.inviteCode
                    : backendRaceId ?? "";
                  if (!val) return;
                  await Clipboard.setStringAsync(val);
                  setCopiedCode(true);
                  setTimeout(() => setCopiedCode(false), 2000);
                }}
              >
                <Feather name={copiedCode ? "check" : "copy"} size={16} color={copiedCode ? "#00E676" : "#60A5FA"} />
              </TouchableOpacity>
            </View>
          </View>
        ) : null}
      </ScrollView>

      {/* Sticky actions — pad above Android system nav / iOS home indicator */}
      <View style={[styles.footerActions, { paddingBottom: waitingBottomInset + rs(8) }]}>
        {showUnlimitedEnterCta ? (
          <>
            <TouchableOpacity
              style={styles.startBtn}
              onPress={() => {
                void enterUnlimitedLiveRace();
              }}
              activeOpacity={0.85}
              accessibilityLabel="Enter unlimited live race"
            >
              <LinearGradient
                colors={[colors.primary, colors.accent]}
                style={styles.startBtnGrad}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
              >
                <Feather name="play" size={18} color="#000" />
                <Text style={[styles.startBtnText, { color: "#000" }]}>
                  {useDummyWaitingRoom ? "Join Race" : "Enter Live Race"}
                </Text>
              </LinearGradient>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.cancelBtn,
                {
                  borderColor: isUsdCashPaidRoom
                    ? colors.destructive + "40"
                    : isHostMode
                      ? colors.destructive + "40"
                      : colors.border,
                },
              ]}
              onPress={handleCancel}
              disabled={leaving}
            >
              <Text
                style={[
                  styles.cancelText,
                  {
                    color: isUsdCashPaidRoom || isHostMode
                      ? colors.destructive
                      : colors.mutedForeground,
                  },
                ]}
              >
                {leaving
                  ? "Leaving…"
                  : useDummyWaitingRoom
                    ? "Leave Challenge"
                  : isUsdCashPaidRoom
                    ? USD_CASH_LEAVE_ACTION_LABEL
                    : isHostMode
                      ? "Cancel Room"
                      : "Leave Room"}
              </Text>
            </TouchableOpacity>
          </>
        ) : isHostMode ? (
          <>
            {waitingRoomMode === "open_window" ? (
              <TouchableOpacity
                style={[styles.startBtn, { opacity: canStart ? 1 : 0.45 }]}
                onPress={handleStartRace}
                disabled={!canStart}
                activeOpacity={0.85}
              >
                <LinearGradient
                  colors={canStart ? [colors.primary, colors.accent] : [colors.border, colors.border]}
                  style={styles.startBtnGrad}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                >
                  <Feather name="play" size={18} color={canStart ? "#000" : colors.mutedForeground} />
                  <Text style={[styles.startBtnText, { color: canStart ? "#000" : colors.mutedForeground }]}>
                    {neededPlayers > 0
                      ? `Need ${neededPlayers} more player${neededPlayers === 1 ? "" : "s"}`
                      : "Start Race"}
                  </Text>
                </LinearGradient>
              </TouchableOpacity>
            ) : (
              <View style={[styles.startBtn, { opacity: 0.55 }]}>
                <LinearGradient
                  colors={[colors.border, colors.border]}
                  style={styles.startBtnGrad}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                >
                  <Feather name="clock" size={18} color={colors.mutedForeground} />
                  <Text style={[styles.startBtnText, { color: colors.mutedForeground }]}>
                    {isUnlimitedCapacity
                      ? waitingBanner.kind === "scheduled_starting"
                        ? "Starting challenge…"
                        : "Starts automatically"
                      : neededPlayers > 0
                        ? `Need ${neededPlayers} more player${neededPlayers === 1 ? "" : "s"}`
                        : waitingBanner.kind === "scheduled_starting"
                          ? "Starting race…"
                          : "Starts automatically"}
                  </Text>
                </LinearGradient>
              </View>
            )}

            <TouchableOpacity
              style={[
                styles.cancelBtn,
                {
                  borderColor: colors.destructive + "40",
                },
              ]}
              onPress={handleCancel}
              disabled={leaving}
            >
              <Text style={[styles.cancelText, { color: colors.destructive }]}>
                {leaving
                  ? "Leaving…"
                  : isUsdCashPaidRoom
                    ? USD_CASH_LEAVE_ACTION_LABEL
                    : "Cancel Room"}
              </Text>
            </TouchableOpacity>
          </>
        ) : (
          <TouchableOpacity
            style={[
              styles.cancelBtn,
              {
                borderColor: isUsdCashPaidRoom ? colors.destructive + "40" : colors.border,
              },
            ]}
            onPress={handleCancel}
            disabled={leaving}
          >
            <Text
              style={[
                styles.cancelText,
                { color: isUsdCashPaidRoom ? colors.destructive : colors.mutedForeground },
              ]}
            >
              {leaving
                ? "Leaving…"
                : isUsdCashPaidRoom
                  ? USD_CASH_LEAVE_ACTION_LABEL
                  : "Leave Room"}
            </Text>
          </TouchableOpacity>
        )}
      </View>

      {/* ── Floating Invite tab (host + participants, all race types) ──── */}
      {!!backendRaceId && !showingOverlay && (
        <TouchableOpacity
          style={styles.inviteFloatTab}
          onPress={toggleInvitePanel}
          activeOpacity={0.85}
        >
          <Feather name="user-plus" size={18} color="#000" />
          <Text style={styles.inviteFloatText}>Invite</Text>
          <Feather name="chevron-right" size={14} color="#00000080" />
        </TouchableOpacity>
      )}

      {/* ── Invite Panel bottom sheet ──────────────────────────────────── */}
      {invitePanelOpen && (
        <Modal transparent animationType="none" visible onRequestClose={closeInvitePanel}>
          <View style={styles.drawerBackdrop}>
            <TouchableOpacity style={styles.drawerDismiss} activeOpacity={1} onPress={closeInvitePanel} />
            <Animated.View
              style={[styles.drawerContainer, { paddingTop: safeTop, transform: [{ translateX: slideAnim }] }]}
            >
                <View style={styles.sheetHeader}>
                  <Feather name="user-plus" size={18} color="#00E676" />
                  <Text style={styles.sheetTitle}>Invite Players</Text>
                  <TouchableOpacity onPress={closeInvitePanel} style={styles.sheetClose}>
                    <Feather name="x" size={20} color="#A0AACC" />
                  </TouchableOpacity>
                </View>

                {/* Tabs */}
                <View style={styles.tabRow}>
                  {(["online", "friends"] as const).map((tab) => (
                    <TouchableOpacity
                      key={tab}
                      style={[styles.tab, inviteTab === tab && styles.tabActive]}
                      onPress={() => setInviteTab(tab)}
                    >
                      <Text style={[styles.tabText, inviteTab === tab && styles.tabTextActive]}>
                        {tab === "online" ? "Online Players" : "Friends"}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>

                {/* List */}
                <ScrollView
                  style={styles.sheetList}
                  contentContainerStyle={{ paddingBottom: 24 }}
                  showsVerticalScrollIndicator={false}
                >
                  {inviteListLoading ? (
                    <View style={{ paddingTop: 12 }}>
                      <SkeletonList count={5} variant="user" />
                    </View>
                  ) : inviteList.length === 0 ? (
                    <Text style={styles.sheetEmpty}>
                      {isOnlineTab ? "No online players available." : "No friends to invite."}
                    </Text>
                  ) : inviteList.map((person) => {
                    const status = inviteStatuses[person.userId] ?? "idle";
                    const hasJoined = participantIds.has(person.userId);
                    const isOnline = isOnlineTab
                      ? true
                      : Boolean((person as FriendItem).isOnline) ||
                        isUserOnline(person.userId) ||
                        racePresenceIds.has(normalizeUserId(person.userId));
                    return (
                      <View key={`${inviteTab}-${person.userId}`} style={styles.sheetRow}>
                        <View style={styles.avatarWrap}>
                          <ProfileAvatar
                            userId={person.userId}
                            profileImageUrl={person.avatarUrl}
                            avatarVersion={(person as FriendItem).avatarVersion ?? 0}
                            avatarColor={person.avatarColor ?? "#00E676"}
                            displayName={person.username}
                            size={40}
                            borderWidth={0}
                          />
                          <View style={[styles.onlineDot, isOnline ? styles.onlineDotGreen : styles.onlineDotGrey]} />
                        </View>
                        <View style={styles.sheetRowInfo}>
                          <Text style={styles.sheetRowName}>{person.username}</Text>
                          <Text style={styles.sheetRowSub}>
                            {person.countryFlag ? `${person.countryFlag} ` : ""}{person.country ?? ""}
                          </Text>
                        </View>
                        {hasJoined ? (
                          <View style={styles.inviteRowBtnJoined}>
                            <Text style={styles.inviteRowBtnJoinedText}>Joined ✓</Text>
                          </View>
                        ) : (
                          <TouchableOpacity
                            style={[
                              styles.inviteRowBtn,
                              status === "pending" && styles.inviteRowBtnPending,
                              status === "sending" && styles.inviteRowBtnSending,
                            ]}
                            onPress={() => status !== "sending" && sendInvite(person.userId)}
                            disabled={status === "sending"}
                          >
                            {status === "sending" ? (
                              <ActivityIndicator size="small" color="#000" />
                            ) : (
                              <Text style={[styles.inviteRowBtnText, status === "pending" && { color: "#A0AACC" }]}>
                                {status === "pending" ? "Sent ✓" : "Invite"}
                              </Text>
                            )}
                          </TouchableOpacity>
                        )}
                      </View>
                    );
                  })}
                </ScrollView>
            </Animated.View>
          </View>
        </Modal>
      )}

      {/* Countdown overlay — shown when race is starting */}
      {showingOverlay && (
        <CountdownOverlay
          startPhase={startPhase}
          countdownNum={countdownNum}
          playerCount={realPlayerCount}
          colors={colors}
        />
      )}

      {/* Player profile modal — shared PublicProfileModal */}
      <PublicProfileModal
        visible={!!selectedParticipant && !showingOverlay}
        userId={selectedParticipant?.userId ?? null}
        onClose={() => setSelectedParticipant(null)}
        initialData={selectedParticipant ? {
          username: selectedParticipant.username,
          country: selectedParticipant.country,
          countryFlag: selectedParticipant.countryFlag,
          avatarColor: selectedParticipant.avatarColor,
          avatarUrl: selectedParticipant.avatarUrl,
          avatarVersion: selectedParticipant.avatarVersion,
          isHost: selectedParticipant.isHost,
          isCurrentUser: selectedParticipant.isCurrentUser,
          activeTitle: selectedParticipant.activeTitle,
          friendStatus: selectedParticipant.friendStatus,
          friendRequestId: selectedParticipant.friendRequestId,
        } : undefined}
        waitingRoomContext={backendRaceId ? {
          raceId: backendRaceId,
          roomStatus: liveRoom?.status ?? "open",
          isHostMode,
          entryType: liveRoom?.entryType,
          onParticipantRemoved: (uid) => {
            setParticipants((prev) => prev.filter((p) => p.userId !== uid));
            setLiveRoom((prev) => {
              if (!prev) return null;
              const newCount = Math.max(1, prev.currentPlayers - 1);
              // If room was full, removing a player opens a slot
              const newStatus = prev.status === "full" ? "open" : prev.status;
              return { ...prev, currentPlayers: newCount, status: newStatus };
            });
          },
        } : undefined}
      />

      {/* ── Instant confirm (cancel / leave) — no AppAlert dismiss delay ── */}
      <Modal
        visible={confirmModal !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setConfirmModal(null)}
      >
        <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.55)", justifyContent: "center", paddingHorizontal: 28 }}>
          <View style={{ backgroundColor: colors.card, borderRadius: 18, borderWidth: 1, borderColor: colors.border, overflow: "hidden" }}>
            <View style={{ paddingHorizontal: 22, paddingTop: 22, paddingBottom: 16, alignItems: "center" }}>
              {confirmModal === "leave" ||
              confirmModal === "leave_pre_start" ||
              confirmModal === "leave_post_start" ? (
                <View
                  style={{
                    width: 52,
                    height: 52,
                    borderRadius: 26,
                    backgroundColor: "rgba(239, 68, 68, 0.15)",
                    borderWidth: 1,
                    borderColor: "rgba(239, 68, 68, 0.35)",
                    alignItems: "center",
                    justifyContent: "center",
                    marginBottom: 14,
                  }}
                >
                  <Text style={{ fontSize: rf(26), fontWeight: "800", color: colors.destructive, lineHeight: rf(30) }}>
                    !
                  </Text>
                </View>
              ) : null}
              <Text style={{ fontSize: rf(17), fontWeight: "700", color: colors.foreground, textAlign: "center" }}>
                {confirmModal === "host_cancel"
                  ? "Cancel Room?"
                  : confirmModal === "leave_pre_start" || confirmModal === "leave_post_start"
                    ? cashLeaveCopy.title
                    : "Leave Room?"}
              </Text>
              <Text style={{ fontSize: rf(14), color: colors.mutedForeground, textAlign: "center", marginTop: 8, lineHeight: 20 }}>
                {confirmModal === "host_cancel"
                  ? isCoinsBattleRoom
                    ? "This will cancel the waiting room for all players. No coins have been charged yet."
                    : "This will cancel the waiting room for all players."
                  : confirmModal === "leave_pre_start" || confirmModal === "leave_post_start"
                    ? cashLeaveCopy.message
                    : "By clicking Leave, you will be withdrawn from the current room registration."}
              </Text>
            </View>
            <View style={{ height: 1, backgroundColor: colors.border }} />
            <View style={{ flexDirection: "row", padding: 12, gap: 8 }}>
              <TouchableOpacity
                style={{ flex: 1, paddingVertical: 12, borderRadius: 11, borderWidth: 1, borderColor: colors.border, alignItems: "center" }}
                onPress={() => setConfirmModal(null)}
                disabled={leaving}
              >
                <Text style={{ color: colors.mutedForeground, fontWeight: "600" }}>
                  {confirmModal === "host_cancel"
                    ? "Keep Waiting"
                    : confirmModal === "leave_pre_start" || confirmModal === "leave_post_start"
                      ? cashLeaveCopy.stayLabel
                      : "Cancel"}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={{ flex: 1, paddingVertical: 12, borderRadius: 11, backgroundColor: colors.destructive, alignItems: "center", opacity: leaving ? 0.6 : 1 }}
                disabled={leaving}
                onPress={confirmModal === "host_cancel" ? executeHostCancel : executeLeave}
              >
                <Text style={{ color: "#fff", fontWeight: "700" }}>
                  {confirmModal === "host_cancel"
                    ? "Cancel Room"
                    : confirmModal === "leave_pre_start" || confirmModal === "leave_post_start"
                      ? cashLeaveCopy.confirmLabel
                      : "Leave"}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ── Terminal: cancelled / expired waiting room ── */}
      <Modal
        visible={terminalModal !== null}
        transparent
        animationType="fade"
        onRequestClose={() => {
          setTerminalModal(null);
          navigateToWalkInstant();
        }}
      >
        <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "center", paddingHorizontal: 28 }}>
          <View style={{ backgroundColor: colors.card, borderRadius: 18, borderWidth: 1, borderColor: colors.border, overflow: "hidden" }}>
            <View style={{ paddingHorizontal: 22, paddingTop: 22, paddingBottom: 16, alignItems: "center" }}>
              <View
                style={{
                  width: 52,
                  height: 52,
                  borderRadius: 26,
                  backgroundColor: "rgba(239, 68, 68, 0.15)",
                  borderWidth: 1,
                  borderColor: "rgba(239, 68, 68, 0.35)",
                  alignItems: "center",
                  justifyContent: "center",
                  marginBottom: 14,
                }}
              >
                <Feather name="x-circle" size={26} color={colors.destructive} />
              </View>
              <Text style={{ fontSize: rf(17), fontWeight: "700", color: colors.foreground, textAlign: "center" }}>
                {terminalModal?.title ?? "Room Cancelled"}
              </Text>
              <Text style={{ fontSize: rf(14), color: colors.mutedForeground, textAlign: "center", marginTop: 8, lineHeight: 20 }}>
                {terminalModal?.message}
              </Text>
              {terminalModal?.showCounts ? (
                <Text style={{ fontSize: rf(12), color: colors.mutedForeground, textAlign: "center", marginTop: 10 }}>
                  Required: {minimumParticipants} · Joined: {realPlayerCount}
                </Text>
              ) : null}
            </View>
            <View style={{ height: 1, backgroundColor: colors.border }} />
            <View style={{ padding: 12 }}>
              <TouchableOpacity
                style={{ paddingVertical: 13, borderRadius: 11, backgroundColor: colors.primary, alignItems: "center" }}
                onPress={() => {
                  setTerminalModal(null);
                  navigateToWalkInstant();
                }}
              >
                <Text style={{ color: "#000", fontWeight: "800" }}>Return to Walk</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ── Refund confirmation (paid cash leave) ── */}
      <Modal
        visible={refundModalVisible && !isUsdCashPaidRoom}
        transparent
        animationType="fade"
        onRequestClose={() => setRefundModalVisible(false)}
      >
        <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" }}>
          <View style={{ backgroundColor: colors.card, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingBottom: safeBottom + 20, borderWidth: 1, borderColor: colors.border }}>
            <Text style={{ fontSize: rf(18), fontWeight: "800", color: colors.foreground, marginBottom: 12 }}>
              Cancel & Refund
            </Text>
            {refundQuote && (
              <CashChallengeRefundBreakdown
                quote={refundQuote}
                colors={{ ...colors, success: colors.success }}
              />
            )}
            <TouchableOpacity
              style={{ borderRadius: 14, overflow: "hidden", marginTop: 12, opacity: refundConfirming ? 0.6 : 1 }}
              disabled={refundConfirming}
              onPress={() => {
                executeLeave();
              }}
            >
              <LinearGradient colors={[colors.primary, colors.accent]} style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: 14 }}>
                {refundConfirming ? (
                  <ActivityIndicator size="small" color="#000" />
                ) : (
                  <Feather name="rotate-ccw" size={18} color="#000" />
                )}
                <Text style={{ fontWeight: "800", color: "#000", fontSize: rf(15) }}>
                  {refundConfirming
                    ? "Processing…"
                    : `Confirm Refund — Add ${formatUsdFromDollars(refundQuote ? refundBreakdownFromQuote(refundQuote).walletRefundAmount : 0)} to Wallet`}
                </Text>
              </LinearGradient>
            </TouchableOpacity>
            <TouchableOpacity
              style={{ marginTop: 12, paddingVertical: 12, alignItems: "center" }}
              onPress={() => setRefundModalVisible(false)}
            >
              <Text style={{ color: colors.mutedForeground, fontWeight: "600" }}>Keep Waiting</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
// Slot grid constants (SLOTS_PER_ROW / SLOT_PAD / SLOT_SIZE) are declared near top.

const styles = StyleSheet.create({
  container: { flex: 1 },
  glow: { position: "absolute", top: 0, left: 0, right: 0, height: 300 },
  content: { alignItems: "center", gap: rs(12) },
  topBar: {
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 4,
  },
  iconBtn: {
    width: rs(40),
    height: rs(40),
    borderRadius: 12,
    backgroundColor: "#12162A",
    borderWidth: 1,
    borderColor: "#2A2F45",
    alignItems: "center",
    justifyContent: "center",
  },
  heroIconWrap: { marginTop: 4, marginBottom: 2 },
  heroIconBorder: {
    width: 68,
    height: 68,
    borderRadius: 20,
    padding: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  heroIconInner: {
    flex: 1,
    width: "100%",
    borderRadius: 18,
    backgroundColor: "#0B0F1F",
    alignItems: "center",
    justifyContent: "center",
  },
  title: { fontSize: rf(26), fontWeight: "800", letterSpacing: -0.5, color: "#FFFFFF" },
  subtitle: { fontSize: rf(13), textAlign: "center", color: "#94A3B8", marginBottom: 6, paddingHorizontal: rs(8) },
  scheduleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginBottom: 12,
    paddingHorizontal: 12,
  },
  scheduleText: {
    fontSize: rf(13),
    fontWeight: "600",
    color: "#C4B5FD",
    textAlign: "center",
  },
  infoBanner: {
    width: "100%",
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    padding: rs(12),
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#7C3AED66",
    backgroundColor: "#15102A",
  },
  infoBannerTitle: { fontSize: rf(13), fontWeight: "800", color: "#F5F3FF" },
  infoBannerSub: { fontSize: rf(11), color: "#A5B4C8", marginTop: 2, lineHeight: rf(15) },
  panelCard: {
    width: "100%",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#3D2A6B",
    backgroundColor: "#0D101F",
    padding: rs(14),
    gap: 10,
    overflow: "hidden",
  },
  panelHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  panelLabel: { fontSize: rf(11), fontWeight: "700", letterSpacing: 0.8, color: "#94A3B8" },
  panelCount: { fontSize: rf(14), fontWeight: "800", color: "#60A5FA" },
  statsRow: {
    width: "100%",
    flexDirection: "row",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#2A2F45",
    backgroundColor: "#0D101F",
    paddingVertical: rs(14),
  },
  statCol: { flex: 1, alignItems: "center", gap: 4 },
  statValue: { fontSize: rf(15), fontWeight: "800", color: "#FFFFFF" },
  premiumStatValueWrap: {
    minWidth: rs(66),
    maxWidth: "100%",
    overflow: "hidden",
    alignItems: "center",
  },
  entryStatValue: {
    color: "#FDE68A",
    fontSize: rf(18),
    fontWeight: "900",
    textShadowColor: "rgba(245,158,11,0.55)",
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 5,
  },
  prizeStatValue: {
    color: "#FBBF24",
    fontSize: rf(20),
    fontWeight: "900",
    textShadowColor: "rgba(245,158,11,0.72)",
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 7,
  },
  premiumStatShimmer: {
    position: "absolute",
    top: 0,
    bottom: 0,
    width: rs(12),
    backgroundColor: "rgba(255,255,255,0.4)",
    transform: [{ skewX: "-18deg" }],
  },
  statLabel: { fontSize: rf(10), color: "#94A3B8" },
  roomIdCard: {
    width: "100%",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#2A2F45",
    backgroundColor: "#0D101F",
    padding: rs(14),
    gap: 6,
  },
  roomIdLabel: { fontSize: rf(11), color: "#94A3B8", fontWeight: "600" },
  roomIdRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  roomIdValue: { flex: 1, fontSize: rf(15), fontWeight: "700", color: "#FFFFFF" },
  searchIcon: { width: rs(72), height: rs(72), borderRadius: 22, borderWidth: 1, overflow: "hidden" },
  searchIconGrad: { flex: 1, alignItems: "center", justifyContent: "center" },
  hostBanner: {
    flexDirection: "row", alignItems: "center", gap: 6,
    borderRadius: 10, borderWidth: 1, paddingHorizontal: rs(14), paddingVertical: rs(7),
  },
  hostBannerText: { fontSize: rf(13), fontWeight: "700" },
  countCard: {
    flexDirection: "row", alignItems: "center", gap: 8,
    borderRadius: 14, borderWidth: 1, paddingHorizontal: rs(24), paddingVertical: rs(14),
  },
  countLabel: { fontSize: rf(15) },
  countValue: { fontSize: rf(36), fontWeight: "800" },
  countMax: { fontSize: rf(20), fontWeight: "400" },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    width: "100%",
  },
  /** Exactly 5 columns — percentage width cannot wrap to 4. */
  slotCell: {
    width: `${100 / SLOTS_PER_ROW}%` as `${number}%`,
    paddingHorizontal: SLOT_PAD,
    paddingTop: 7,
    paddingBottom: SLOT_PAD,
  },
  unlimitedScroller: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingTop: 8,
    paddingBottom: 4,
    paddingHorizontal: 2,
    gap: 10,
  },
  unlimitedSlotCell: {
    paddingHorizontal: 2,
  },
  playerSlot: {
    width: "100%",
    aspectRatio: 1,
    borderRadius: 12,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
    overflow: "visible",
  },
  slotAvatarWrap: {
    position: "relative",
    alignItems: "center",
    justifyContent: "center",
  },
  participantStatusDot: {
    position: "absolute",
    right: -1,
    bottom: -1,
    width: 11,
    height: 11,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: "#0D101F",
  },
  participantStatusOnline: {
    backgroundColor: "#00E676",
  },
  participantStatusOffline: {
    backgroundColor: "#596174",
  },
  slotSkeleton: {
    width: "100%",
    height: "100%",
    alignItems: "center",
    justifyContent: "center",
  },
  slotSkeletonAvatar: {
    width: Math.min(38, Math.max(24, SLOT_SIZE - 12)),
    height: Math.min(38, Math.max(24, SLOT_SIZE - 12)),
    borderRadius: 20,
    backgroundColor: "#252A3D",
    opacity: 0.72,
  },
  hostBadgeSlot: {
    position: "absolute",
    top: -6,
    left: 1,
    minHeight: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
    paddingHorizontal: 4,
    borderRadius: 7,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#FDE68A",
    backgroundColor: "#D4A514",
  },
  hostBadgeSlotText: {
    color: "#1A1200",
    fontSize: 7,
    fontWeight: "900",
    letterSpacing: 0.35,
  },
  participantErrorRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  participantErrorText: {
    flexShrink: 1,
    color: "#94A3B8",
    fontSize: rf(10),
  },
  participantRetryBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#7C3AED66",
    backgroundColor: "#7C3AED18",
  },
  participantRetryText: {
    color: "#C4B5FD",
    fontSize: rf(10),
    fontWeight: "700",
  },
  tapHint: { fontSize: rf(12), textAlign: "center", color: "#94A3B8" },
  progressTrack: { width: "100%", height: 6, borderRadius: 3, overflow: "hidden", backgroundColor: "#1E2438" },
  progressFill: { height: 6, borderRadius: 3 },
  hint: { fontSize: rf(13), textAlign: "center", lineHeight: 18 },
  reminderCard: { width: "100%", borderRadius: 14, borderWidth: 1, padding: rs(14), gap: 8 },
  reminderRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  reminderText: { fontSize: rf(13), flex: 1 },

  // Private room code row
  codeRow: {
    flexDirection: "row", alignItems: "center", gap: 6,
    marginTop: 6, paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: "#A78BFA30",
  },
  codeLabel: { fontSize: 12, color: "#A78BFA", fontWeight: "600" },
  codeValue: {
    flex: 1, fontSize: 17, fontWeight: "800", color: "#FFFFFF",
    letterSpacing: 3, fontVariant: ["tabular-nums"],
  },
  codeActions: { flexDirection: "row", alignItems: "center", gap: 4 },
  codeBtn: {
    flexDirection: "row", alignItems: "center", gap: 4,
    paddingHorizontal: 8, paddingVertical: 5,
    borderRadius: 8, backgroundColor: "#A78BFA18",
    borderWidth: 1, borderColor: "#A78BFA40",
  },
  codeBtnText: { fontSize: 12, fontWeight: "700", color: "#A78BFA" },
  startBtn: { width: "100%", borderRadius: 16, overflow: "hidden" },
  startBtnGrad: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 10, paddingVertical: rs(16),
  },
  startBtnText: { fontSize: rf(17), fontWeight: "800" },
  footerActions: {
    width: "100%",
    paddingHorizontal: rs(20),
    paddingTop: rs(8),
    paddingBottom: rs(8),
    gap: rs(10),
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "#2A2F45",
    backgroundColor: "#050711",
  },
  cancelBtn: {
    width: "100%",
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: rs(28),
    paddingVertical: rs(14),
    alignItems: "center",
  },
  cancelText: { fontSize: rf(15), fontWeight: "600" },

  // Invite button
  inviteBtn: {
    width: "100%",
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: "#00E67650",
    backgroundColor: "#00E67612",
  },
  inviteBtnInner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  inviteBtnLeft: { flexDirection: "row", alignItems: "center", gap: 12 },
  inviteBtnIcon: {
    width: 38, height: 38, borderRadius: 11,
    alignItems: "center", justifyContent: "center",
    backgroundColor: "#00E67622",
  },
  inviteBtnTitle: { fontSize: 15, fontWeight: "800", color: "#00E676" },
  inviteBtnSub: { fontSize: 12, color: "#00E67699", marginTop: 1 },

  // Right-side drawer
  drawerBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.55)",
    flexDirection: "row",
    zIndex: 200,
  },
  drawerDismiss: { flex: 1 },
  drawerContainer: {
    width: "82%",
    backgroundColor: "#0D1226",
    borderLeftWidth: 1,
    borderColor: "#1A2040",
    paddingTop: 16,
  },
  sheetHeader: {
    flexDirection: "row", alignItems: "center", gap: 10,
    paddingHorizontal: 18, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: "#1A2040",
  },
  sheetTitle: { flex: 1, fontSize: 17, fontWeight: "800", color: "#FFFFFF" },
  sheetClose: { padding: 4 },
  tabRow: {
    flexDirection: "row",
    marginHorizontal: 16, marginTop: 12,
    backgroundColor: "#070A14",
    borderRadius: 10, padding: 3,
  },
  tab: { flex: 1, paddingVertical: 8, borderRadius: 8, alignItems: "center" },
  tabActive: { backgroundColor: "#1A2A50" },
  tabText: { fontSize: 13, color: "#5A6A8A", fontWeight: "600" },
  tabTextActive: { color: "#FFFFFF" },
  sheetList: { paddingHorizontal: 16, marginTop: 10 },
  sheetEmpty: { textAlign: "center", color: "#5A6A8A", marginTop: 32, fontSize: 14 },
  sheetRow: {
    flexDirection: "row", alignItems: "center", gap: 12,
    paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: "#1A204030",
  },
  sheetRowInfo: { flex: 1 },
  sheetRowName: { fontSize: 14, fontWeight: "700", color: "#FFFFFF" },
  sheetRowSub: { fontSize: 12, color: "#5A6A8A", marginTop: 1 },
  inviteRowBtn: {
    paddingHorizontal: 16, paddingVertical: 8,
    borderRadius: 10, backgroundColor: "#00E676",
    minWidth: 64, alignItems: "center",
  },
  inviteRowBtnPending: { backgroundColor: "#1A2040" },
  inviteRowBtnSending: { backgroundColor: "#00E67660" },
  inviteRowBtnText: { fontSize: 13, fontWeight: "700", color: "#000" },
  inviteRowBtnJoined: {
    paddingHorizontal: 12, paddingVertical: 8,
    borderRadius: 10, backgroundColor: "#00E67620",
    borderWidth: 1, borderColor: "#00E67650",
    minWidth: 64, alignItems: "center",
  },
  inviteRowBtnJoinedText: { fontSize: 12, fontWeight: "700", color: "#00E676" },

  // Room expiry timer pill
  expiryPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    alignSelf: "center",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
    borderWidth: 1,
    marginTop: 6,
    marginBottom: 2,
  },
  expiryText: { fontSize: 11 },

  avatarWrap: { position: "relative" },

  // Online status dot
  onlineDot: {
    position: "absolute",
    bottom: 0,
    right: 0,
    width: 11,
    height: 11,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: "#0D1226",
  },
  onlineDotGreen: { backgroundColor: "#00E676" },
  onlineDotGrey: { backgroundColor: "#3A4060" },

  // Floating side-tab — keep clear of status bar / large headers
  inviteFloatTab: {
    position: "absolute",
    right: 0,
    top: "34%",
    marginTop: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#00E676",
    paddingVertical: rs(10),
    paddingLeft: rs(14),
    paddingRight: rs(10),
    borderTopLeftRadius: 20,
    borderBottomLeftRadius: 20,
    shadowColor: "#00E676",
    shadowOffset: { width: -2, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 10,
    elevation: 8,
    zIndex: 50,
  },
  inviteFloatText: { fontSize: rf(13), fontWeight: "800", color: "#000" },
});

const cStyles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    gap: 18,
    zIndex: 100,
  },
  glow: { position: "absolute", top: 0, left: 0, right: 0, height: 300 },
  preparing: { fontSize: 15, fontWeight: "600", letterSpacing: 0.5, textTransform: "uppercase" },
  numberBox: {
    width: 160, height: 160, borderRadius: 40, borderWidth: 2, overflow: "hidden",
  },
  numberBoxGrad: { flex: 1, alignItems: "center", justifyContent: "center" },
  number: { fontSize: 80, fontWeight: "900", lineHeight: 90 },
  sublabel: { fontSize: 28, fontWeight: "800", letterSpacing: -0.5 },
  pill: {
    flexDirection: "row", alignItems: "center", gap: 6,
    borderRadius: 20, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 7,
  },
  pillText: { fontSize: 13, fontWeight: "600" },
});
