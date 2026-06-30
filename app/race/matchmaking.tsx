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
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Alert,
  ActivityIndicator,
  Animated,
  Dimensions,
  Modal,
  Platform,
  ScrollView,
  Share,
  StyleSheet,
  Text,
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
import { authFetch } from "@/utils/authFetch";
import { STEP_SYNC_CONFIG } from "@/config/stepSyncConfig";
import {
  liveRaceFetchAllowed,
  markLiveRaceFetched,
} from "@/utils/liveRaceFetchGate";
import {
  connectPusher,
  subscribeToChannel,
  unsubscribeFromChannel,
  CHANNELS,
  EVENTS,
} from "@/services/realtimeService";
import { TouchableOpacity } from "@/components/HapticTouchableOpacity";
import { rf, rs } from "@/utils/responsive";

const SCREEN_W = Dimensions.get("window").width;

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
};

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
  colors,
}: {
  participant: RoomParticipant | null;
  onPress?: () => void;
  colors: ReturnType<typeof useColors>;
}) {
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const opacityAnim = useRef(new Animated.Value(participant ? 1 : 0.45)).current;
  const prevFilledRef = useRef<boolean>(!!participant);

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
        <ProfileAvatar
          userId={participant.userId}
          profileImageUrl={participant.avatarUrl}
          avatarVersion={participant.avatarVersion}
          avatarColor={participant.avatarColor ?? colors.primary}
          displayName={participant.username}
          size={Math.min(44, SLOT_SIZE - 8)}
          borderWidth={0}
          onPress={onPress}
        />
      ) : (
        <Feather name="user" size={16} color={colors.mutedForeground} />
      )}
      {participant?.isHost && (
        <View style={[styles.hostBadgeSlot, { backgroundColor: colors.gold }]}>
          <Feather name="star" size={7} color="#000" />
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

export default function MatchmakingScreen() {
  const colors = useColors();
  const { safeTop, safeBottom } = useSafeLayout();
  const params = useLocalSearchParams<{
    raceId?: string;
    isHost?: string;
    initialParticipants?: string;
    initialEntryType?: string;
    initialTargetSteps?: string;
    initialCoinEntryAmount?: string;
    initialMaxPlayers?: string;
    initialIsPrivate?: string;
    initialInviteCode?: string;
  }>();

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

  const backendRaceId = params.raceId ?? contextRaceId;
  const isHostMode = params.isHost === "true";

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


  // ── Pre-populate participants from join-with-code response ────────────────
  // When arriving via join-with-code flow, the response already includes the
  // full participant list. Pre-populate immediately so the grid is not empty
  // during the first polling interval.
  const initialParticipantsSeededRef = useRef(false);
  useEffect(() => {
    if (initialParticipantsSeededRef.current || !params.initialParticipants) return;
    initialParticipantsSeededRef.current = true;
    try {
      const initial = JSON.parse(params.initialParticipants) as RoomParticipant[];
      if (Array.isArray(initial) && initial.length > 0) {
        setParticipants(initial);
      }
    } catch { /* ignore bad JSON — first poll will populate */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
  } | null>(() => {
    if (!params.initialEntryType) return null;
    return {
      currentPlayers: 1,
      maxPlayers: params.initialMaxPlayers ? Number(params.initialMaxPlayers) : raceMaxPlayers,
      status: "open",
      targetSteps: params.initialTargetSteps ? Number(params.initialTargetSteps) : undefined,
      entryType: params.initialEntryType,
      coinEntryAmount: params.initialCoinEntryAmount ? Number(params.initialCoinEntryAmount) : 0,
      coinPrizePool: 0,
      isPrivate: params.initialIsPrivate === "true",
      inviteCode: params.initialInviteCode || null,
    };
  });
  const [copiedCode, setCopiedCode] = useState(false);
  const [participants, setParticipants] = useState<RoomParticipant[]>([]);
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
  const [onlineUserIds, setOnlineUserIds] = useState<Set<string>>(new Set());
  const [loadingCandidates, setLoadingCandidates] = useState(false);
  const [loadingFriends, setLoadingFriends] = useState(false);
  const candidatesLoadedRef = useRef(false);
  const friendsLoadedRef = useRef(false);

  const pulseAnim = useRef(new Animated.Value(1)).current;

  // ── Room expiry timer (5 min from createdAt) ──────────────────────────────
  const roomExpiresAtRef = useRef<Date | null>(null);
  const [roomTimeLeft, setRoomTimeLeft] = useState<number | null>(null);
  const isHostModeRef = useRef(isHostMode);
  useEffect(() => { isHostModeRef.current = isHostMode; }, [isHostMode]);

  // ── Server-authoritative race status check ─────────────────────────────────
  const fetchRaceStartState = useCallback(async (): Promise<{
    inProgress: boolean;
    currentPlayers: number;
  }> => {
    if (!backendRaceId) return { inProgress: false, currentPlayers: 2 };
    try {
      const res = await authFetch(`/api/races/${backendRaceId}`);
      if (!res.ok) return { inProgress: false, currentPlayers: 2 };
      const data = await res.json();
      return {
        inProgress: data.race?.status === "in_progress",
        currentPlayers: data.race?.currentPlayers ?? 2,
      };
    } catch {
      return { inProgress: false, currentPlayers: 2 };
    }
  }, [backendRaceId]);

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
      if (startPhaseRef.current === "navigating") return;
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
        router.replace({ pathname: "/race/live-detail", params: { id: backendRaceId } });
      } else {
        router.replace("/(tabs)/live");
      }
    },
    [isHostMode, startRaceManually, notifyRaceStarted, backendRaceId, setStart, fetchRaceStartState],
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

  // ── Poll room + participants while this screen is focused ─────────────────
  useFocusEffect(
    useCallback(() => {
      if (!backendRaceId) return;
      let cancelled = false;

      const pollRoom = async () => {
        if (cancelled) return;
        const gateKey = `${backendRaceId}:matchmaking`;
        if (
          !liveRaceFetchAllowed(
            gateKey,
            STEP_SYNC_CONFIG.MATCHMAKING_ROOM_POLL_MS,
          )
        ) {
          return;
        }
        try {
          const res = await authFetch(`/api/races/${backendRaceId}`);
          if (!res.ok || cancelled) return;
          markLiveRaceFetched(gateKey);
          const data = await res.json();
          setLiveRoom({
            currentPlayers: data.race.currentPlayers ?? 1,
            maxPlayers: data.race.maxPlayers ?? raceMaxPlayers,
            status: data.race.status,
            targetSteps: data.race.targetSteps,
            entryType: data.race.entryType,
            entryAmountCents: data.race.entryAmountCents,
            coinEntryAmount: data.race.coinEntryAmount,
            coinPrizePool: data.race.coinPrizePool,
            isPrivate: data.race.isPrivate,
            inviteCode: data.race.inviteCode ?? null,
          });
          if (!roomExpiresAtRef.current && data.race.createdAt) {
            roomExpiresAtRef.current = new Date(
              new Date(data.race.createdAt).getTime() + 10 * 60_000,
            );
          }
          if (data.race.targetSteps) {
            setRaceTargetSteps(data.race.targetSteps);
          }
          if (data.race.startedAt && !raceStartedAtRef.current) {
            raceStartedAtRef.current = new Date(data.race.startedAt);
          }
          if (Array.isArray(data.participants) && data.participants.length > 0) {
            setParticipants(data.participants as RoomParticipant[]);
          }
          if (
            data.race.status === "in_progress" &&
            startPhaseRef.current === "idle"
          ) {
            beginCountdown(3, data.race.currentPlayers ?? 2);
          }
        } catch { /* silent */ }
      };

      pollRoom();
      const interval = setInterval(
        pollRoom,
        STEP_SYNC_CONFIG.MATCHMAKING_ROOM_POLL_MS,
      );
      return () => {
        cancelled = true;
        clearInterval(interval);
      };
    }, [backendRaceId, raceMaxPlayers, beginCountdown, setRaceTargetSteps]),
  );

  // ── Store race ID in context ──────────────────────────────────────────────
  useEffect(() => {
    if (params.raceId && !contextRaceId) {
      setActiveRace(params.raceId, params.isHost === "true");
    }
  }, [params.raceId, params.isHost, contextRaceId, setActiveRace]);

  // ── Pusher subscriptions ──────────────────────────────────────────────────
  // All handlers validate event.raceId === backendRaceId before acting.
  useEffect(() => {
    if (!backendRaceId) return;
    connectPusher();
    const channel = subscribeToChannel(CHANNELS.liveRace(backendRaceId));
    if (!channel) return;

    const currentPlayers = () => liveRoomRef.current?.currentPlayers ?? 2;

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

    // race:cancelled
    const onCancelled = (data: { raceId?: string }) => {
      if (data.raceId && data.raceId !== backendRaceId) return;
      if (!screenFocusedRef.current) return;
      AppAlert.alert(
        "Room Cancelled",
        "The host cancelled this race room.",
        [{ text: "OK", onPress: () => { cancelRace(); router.replace("/(tabs)/walk"); } }],
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
    channel.bind("room:participant_removed", onRemoved);
    channel.bind("race:player-left", onLeft);

    return () => {
      channel.unbind("race:starting", onStarting);
      channel.unbind(EVENTS.RACE_STARTED, onStarted);
      channel.unbind("race:cancelled", onCancelled);
      channel.unbind("room:participant_removed", onRemoved);
      channel.unbind("race:player-left", onLeft);
      unsubscribeFromChannel(CHANNELS.liveRace(backendRaceId));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    // Navigate immediately — don't wait for the user to press OK.
    cancelRace();
    router.replace("/(tabs)/walk");
    // Show a native alert (works reliably from any context, including after navigation).
    setTimeout(() => {
      Alert.alert("Removed from Room", "The host removed you from this room.");
    }, 350);
  }, [wasRemoved, cancelRace]);

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

  // ── Room expiry countdown (ticks every second, auto-closes at 0) ──────────
  useEffect(() => {
    if (!backendRaceId) return;
    const id = setInterval(async () => {
      if (!roomExpiresAtRef.current) return;
      const remaining = Math.max(0, Math.round((roomExpiresAtRef.current.getTime() - Date.now()) / 1000));
      setRoomTimeLeft(remaining);
      if (remaining === 0) {
        clearInterval(id);
        const endpoint = isHostModeRef.current ? "cancel" : "leave";
        authFetch(`/api/races/${backendRaceId}/${endpoint}`, { method: "POST" }).catch(() => {});
        if (!screenFocusedRef.current) {
          cancelRace();
          return;
        }
        const expiredTitle = "Room Expired";
        const expiredMsg = isHostModeRef.current
          ? "The 10-minute waiting window has passed. The room has been closed."
          : "The host's room has expired. You have been removed from the waiting room.";
        AppAlert.alert(expiredTitle, expiredMsg, [
          { text: "OK", onPress: () => { cancelRace(); router.replace("/(tabs)/walk"); } },
        ]);
      }
    }, 1000);
    return () => clearInterval(id);
  }, [backendRaceId, cancelRace]);

  // ── Cancel / leave ────────────────────────────────────────────────────────
  const handleCancel = useCallback(() => {
    if (isHostMode && backendRaceId) {
      AppAlert.alert(
        "Cancel Room?",
        "This will cancel the waiting room for all players.",
        [
          { text: "Keep Waiting", style: "cancel" },
          {
            text: "Cancel Room",
            style: "destructive",
            onPress: async () => {
              if (backendRaceId) {
                await authFetch(`/api/races/${backendRaceId}/cancel`, { method: "POST" }).catch(() => {});
              }
              cancelRace();
              router.replace("/(tabs)/walk");
            },
          },
        ],
      );
    } else if (!isHostMode && backendRaceId) {
      AppAlert.alert(
        "Leave Room?",
        "You can rejoin from the Live tab if you change your mind.",
        [
          { text: "Stay", style: "cancel" },
          {
            text: "Leave",
            style: "destructive",
            onPress: async () => {
              setLeaving(true);
              authFetch(`/api/races/${backendRaceId}/leave`, { method: "POST" }).catch(() => {});
              cancelRace();
              router.replace("/(tabs)/walk");
            },
          },
        ],
      );
    } else {
      cancelRace();
      router.replace("/(tabs)/walk");
    }
  }, [isHostMode, backendRaceId, cancelRace]);

  // ── Host: start race ──────────────────────────────────────────────────────
  const startingRef = useRef(false);

  const handleStartRace = useCallback(async () => {
    if (startingRef.current) return;
    // Read from liveRoomRef (always current) instead of `realPlayerCount` from
    // the render-time closure — the useCallback deps don't include realPlayerCount
    // so the closure would capture a stale 0 from the first render (when liveRoom
    // is null) and silently abort every tap. The ref is kept in sync via useEffect.
    const currentCount = liveRoomRef.current?.currentPlayers ?? 1;
    if (currentCount < 2) return;
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
  }, [backendRaceId, setStart, beginCountdown]);

  // ── Derived values ────────────────────────────────────────────────────────
  const realPlayerCount = liveRoom?.currentPlayers ?? playersJoined;
  const realMaxPlayers = liveRoom?.maxPlayers ?? raceMaxPlayers;
  const canStart = isHostMode && realPlayerCount >= 2 && startPhase === "idle";
  // Use liveRoom.entryType as the authoritative source (populated from backend).
  // Fall back to raceEntryFee===0 for the brief moment before the first poll returns.
  const isFreeRace = liveRoom?.entryType === "free" || (!liveRoom && raceEntryFee === 0);

  // Build sorted + padded slot grid
  const sortedParticipants = useMemo(() => [...participants].sort((a, b) => {
    if (a.isHost && !b.isHost) return -1;
    if (!a.isHost && b.isHost) return 1;
    if (a.isCurrentUser && !b.isCurrentUser) return -1;
    if (!a.isCurrentUser && b.isCurrentUser) return 1;
    return 0;
  }), [participants]);
  const slots: Array<RoomParticipant | null> = useMemo(() => [
    ...sortedParticipants,
    ...Array(Math.max(0, realMaxPlayers - sortedParticipants.length)).fill(null),
  ], [sortedParticipants, realMaxPlayers]);

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
    if (!backendRaceId || !isHostMode) return;
    if (!candidatesLoadedRef.current) setLoadingCandidates(true);
    try {
      const res = await authFetch(`/api/races/${backendRaceId}/online-invite-candidates`);
      if (res.ok) {
        const data = await res.json() as { candidates: OnlineCandidate[] };
        const list = data.candidates ?? [];
        setOnlineCandidates(list);
        // Track who is online (for friend dot)
        setOnlineUserIds(new Set(list.map((c) => c.userId)));
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
  }, [backendRaceId, isHostMode]);

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
      }
      friendsLoadedRef.current = true;
    } catch { /* silent */ }
    setLoadingFriends(false);
  }, []);

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
        // Auto-reset after 20s (server-side invite expires) so host can resend
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

  // Poll online candidates every 5s while the panel is open (also seeds onlineUserIds for friend dots)
  useEffect(() => {
    if (!isHostMode || !invitePanelOpen) return;
    loadOnlineCandidates(); // immediate first load
    const id = setInterval(loadOnlineCandidates, 5_000);
    return () => clearInterval(id);
  }, [invitePanelOpen, isHostMode, loadOnlineCandidates]);

  // Poll friends every 5s when Friends tab is open
  useEffect(() => {
    if (!isHostMode || !invitePanelOpen || inviteTab !== "friends") return;
    loadFriends(); // immediate first load
    const id = setInterval(loadFriends, 5_000);
    return () => clearInterval(id);
  }, [inviteTab, invitePanelOpen, isHostMode, loadFriends]);

  // ── Invite list derived values (computed before render, stable references) ─
  const isOnlineTab = inviteTab === "online";
  const inviteListLoading = isOnlineTab ? loadingCandidates : loadingFriends;
  const inviteList = isOnlineTab ? onlineCandidates.filter((c) => !c.isFriend) : friendsList;
  // Set of userIds already in the room — used to show "Joined" badge on the invite panel
  const participantIds = new Set(participants.map((p) => p.userId));

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <LinearGradient
        colors={[`${colors.accent}10`, "transparent"]}
        style={styles.glow}
      />

      <View style={[styles.content, { paddingTop: safeTop + 24, paddingBottom: safeBottom + 24 }]}>

        <Animated.View
          style={[
            styles.searchIcon,
            {
              backgroundColor: colors.card,
              borderColor: colors.accent + "40",
              transform: [{ scale: pulseAnim }],
            },
          ]}
        >
          <LinearGradient
            colors={[colors.accent + "30", colors.primary + "20"]}
            style={styles.searchIconGrad}
          >
            <Feather name="search" size={24} color={colors.accent} />
          </LinearGradient>
        </Animated.View>

        <Text style={[styles.title, { color: colors.foreground }]}>Waiting Room</Text>
        <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
          {isHostMode ? "Start when you're ready" : "Waiting for host to start the race"}
        </Text>

        {roomTimeLeft !== null && roomTimeLeft > 0 && (() => {
          const mins = Math.floor(roomTimeLeft / 60);
          const secs = roomTimeLeft % 60;
          const timeStr = `${mins}:${String(secs).padStart(2, "0")}`;
          const timerColor = roomTimeLeft > 120 ? "#6B7A99" : roomTimeLeft > 60 ? "#F59E0B" : "#EF4444";
          return (
            <View style={[styles.expiryPill, { borderColor: timerColor + "40" }]}>
              <Feather name="clock" size={10} color={timerColor} />
              <Text style={[styles.expiryText, { color: timerColor }]}>
                Room closes in <Text style={{ fontWeight: "700" }}>{timeStr}</Text>
              </Text>
            </View>
          );
        })()}

        {isHostMode && (
          <View style={[styles.hostBanner, { backgroundColor: colors.gold + "18", borderColor: colors.gold + "40" }]}>
            <Feather name="star" size={13} color={colors.gold} />
            <Text style={[styles.hostBannerText, { color: colors.gold }]}>You are the Host</Text>
          </View>
        )}

        <View style={[styles.countCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.countLabel, { color: colors.mutedForeground }]}>Players Joined</Text>
          <Text style={[styles.countValue, { color: colors.primary }]}>
            {realPlayerCount}
            <Text style={[styles.countMax, { color: colors.mutedForeground }]}>/{realMaxPlayers}</Text>
          </Text>
        </View>

        <View style={styles.grid}>
          {slots.map((p, i) => (
            <PlayerSlot
              key={p?.userId ? `${p.userId}-${i}` : `empty-${i}`}
              participant={p}
              onPress={p ? () => setSelectedParticipant(p) : undefined}
              colors={colors}
            />
          ))}
        </View>

        {sortedParticipants.length > 0 && (
          <Text style={[styles.tapHint, { color: colors.mutedForeground }]}>
            Tap a player to view their profile
          </Text>
        )}

        <View style={[styles.progressTrack, { backgroundColor: colors.border }]}>
          <LinearGradient
            colors={[colors.accent, colors.primary]}
            style={[styles.progressFill, { width: `${(realPlayerCount / realMaxPlayers) * 100}%` }]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
          />
        </View>

        <Text style={[styles.hint, { color: colors.mutedForeground }]}>
          {isHostMode
            ? realPlayerCount >= 2
              ? "Ready to start! Tap Start Race when you're ready."
              : "Host can start once at least 2 players join."
            : "Waiting for host to start the race."}
        </Text>

        <View style={[styles.reminderCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.reminderRow}>
            <Feather name="flag" size={14} color={colors.accent} />
            <Text style={[styles.reminderText, { color: colors.mutedForeground }]}>
              Target:{" "}
              <Text style={{ color: colors.foreground, fontWeight: "700" }}>
                {(liveRoom?.targetSteps ?? RACE_DEFAULTS.RACE_TARGET).toLocaleString()} steps
              </Text>
            </Text>
          </View>
          <View style={styles.reminderRow}>
            <Feather
              name={liveRoom?.entryType === "coins_battle" ? "award" : "dollar-sign"}
              size={14}
              color={isFreeRace ? colors.success : liveRoom?.entryType === "coins_battle" ? "#F59E0B" : colors.gold}
            />
            <Text style={[styles.reminderText, { color: colors.mutedForeground }]}>
              {liveRoom?.entryType === "coins_battle" ? (
                <>
                  Entry:{" "}
                  <Text style={{ color: "#F59E0B", fontWeight: "700" }}>
                    {(liveRoom.coinEntryAmount ?? 0).toLocaleString()} coins per player
                  </Text>
                  {" — coins charged when race starts"}
                </>
              ) : isFreeRace ? (
                <Text style={{ color: colors.success, fontWeight: "700" }}>Free Challenge — No entry fee</Text>
              ) : (
                <>
                  Entry fee:{" "}
                  <Text style={{ color: colors.gold, fontWeight: "700" }}>
                    ${(liveRoom?.entryAmountCents != null ? liveRoom.entryAmountCents / 100 : raceEntryFee).toFixed(2)} per player
                  </Text>
                </>
              )}
            </Text>
          </View>
          {liveRoom?.isPrivate && liveRoom.inviteCode ? (
            <View style={styles.codeRow}>
              <Feather name="lock" size={13} color="#A78BFA" />
              <Text style={styles.codeLabel}>Room Code</Text>
              <Text style={styles.codeValue}>{liveRoom.inviteCode}</Text>
              <View style={styles.codeActions}>
                <TouchableOpacity
                  style={styles.codeBtn}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  onPress={async () => {
                    await Clipboard.setStringAsync(liveRoom.inviteCode!);
                    setCopiedCode(true);
                    setTimeout(() => setCopiedCode(false), 2000);
                  }}
                >
                  <Feather name={copiedCode ? "check" : "copy"} size={14} color={copiedCode ? "#00E676" : "#A78BFA"} />
                  <Text style={[styles.codeBtnText, copiedCode && { color: "#00E676" }]}>
                    {copiedCode ? "Copied!" : "Copy"}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.codeBtn}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  onPress={() => Share.share({
                    message: Platform.OS === "ios"
                      ? `Join my private WalkChamp race! Use code: ${liveRoom.inviteCode}`
                      : `Join my private WalkChamp race! Use code: ${liveRoom.inviteCode}`,
                    title: "Join my WalkChamp Room",
                  })}
                >
                  <Feather name="share-2" size={14} color="#A78BFA" />
                  <Text style={styles.codeBtnText}>Share</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : backendRaceId && !liveRoom?.isPrivate ? (
            <View style={styles.reminderRow}>
              <Feather name="link" size={14} color={colors.mutedForeground} />
              <Text style={[styles.reminderText, { color: colors.mutedForeground }]}>
                Room ID:{" "}
                <Text style={{ color: colors.foreground, fontWeight: "600", fontSize: 11 }}>
                  {backendRaceId.slice(0, 8)}…
                </Text>
              </Text>
            </View>
          ) : null}
        </View>

        {isHostMode ? (
          <>
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
                  {realPlayerCount < 2
                    ? `Need ${2 - realPlayerCount} more player${2 - realPlayerCount === 1 ? "" : "s"}`
                    : "Start Race"}
                </Text>
              </LinearGradient>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.cancelBtn, { borderColor: colors.destructive + "40" }]}
              onPress={handleCancel}
            >
              <Text style={[styles.cancelText, { color: colors.destructive }]}>
                {isFreeRace ? "Cancel Room" : "Cancel & Refund"}
              </Text>
            </TouchableOpacity>
          </>
        ) : (
          <TouchableOpacity
            style={[styles.cancelBtn, { borderColor: colors.border }]}
            onPress={handleCancel}
            disabled={leaving}
          >
            <Text style={[styles.cancelText, { color: colors.mutedForeground }]}>
              {leaving ? "Leaving…" : "Leave Room"}
            </Text>
          </TouchableOpacity>
        )}
      </View>

      {/* ── Floating Invite tab (host only, right edge) ─────────────────── */}
      {isHostMode && !showingOverlay && (
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
                      : (person as FriendItem).isOnline ?? onlineUserIds.has(person.userId);
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
    </View>
  );
}

// ── Responsive slot grid constants ───────────────────────────────────────────
const SLOT_GAP = 8;
const SLOTS_PER_ROW = 5;
const SLOT_SIZE = Math.floor((SCREEN_W - 2 * rs(24) - (SLOTS_PER_ROW - 1) * SLOT_GAP) / SLOTS_PER_ROW);
const GRID_WIDTH = SLOT_SIZE * SLOTS_PER_ROW + (SLOTS_PER_ROW - 1) * SLOT_GAP;

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1 },
  glow: { position: "absolute", top: 0, left: 0, right: 0, height: 300 },
  content: { flex: 1, paddingHorizontal: rs(24), alignItems: "center", gap: 8 },
  searchIcon: { width: rs(72), height: rs(72), borderRadius: 22, borderWidth: 1, overflow: "hidden" },
  searchIconGrad: { flex: 1, alignItems: "center", justifyContent: "center" },
  title: { fontSize: rf(26), fontWeight: "800", letterSpacing: -0.5 },
  subtitle: { fontSize: rf(15), textAlign: "center" },
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
  grid: { flexDirection: "row", flexWrap: "wrap", gap: SLOT_GAP, width: GRID_WIDTH },
  playerSlot: {
    width: SLOT_SIZE, height: SLOT_SIZE, borderRadius: 14, borderWidth: 1.5,
    alignItems: "center", justifyContent: "center", overflow: "visible",
  },
  hostBadgeSlot: {
    position: "absolute", top: -6, right: -6,
    width: rs(16), height: rs(16), borderRadius: rs(8),
    alignItems: "center", justifyContent: "center",
  },
  tapHint: { fontSize: rf(12), textAlign: "center" },
  progressTrack: { width: "100%", height: 6, borderRadius: 3, overflow: "hidden" },
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
  cancelBtn: { borderRadius: 14, borderWidth: 1, paddingHorizontal: rs(28), paddingVertical: rs(14) },
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

  // Floating side-tab
  inviteFloatTab: {
    position: "absolute",
    right: 0,
    top: "36%",
    marginTop: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#00E676",
    paddingVertical: 10,
    paddingLeft: 14,
    paddingRight: 10,
    borderTopLeftRadius: 20,
    borderBottomLeftRadius: 20,
    shadowColor: "#00E676",
    shadowOffset: { width: -2, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 10,
    elevation: 8,
    zIndex: 50,
  },
  inviteFloatText: { fontSize: 13, fontWeight: "800", color: "#000" },
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
