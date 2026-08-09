/**
 * Virtualized Live Race participant lists (Track Position panel + Live Board rows).
 * Shared across Free / Coins / Cash / Unlimited — not Unlimited-only.
 */

import React, { memo, useCallback, useEffect, useMemo, useState } from "react";
import {
  FlatList,
  Image,
  StyleSheet,
  Text,
  View,
  type ListRenderItemInfo,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { TouchableOpacity } from "@/components/HapticTouchableOpacity";
import { BlueShoe } from "@/components/BlueShoe";
import { formatRaceSteps } from "@/utils/liveRaceDisplay";
import {
  getParticipantRowBorderColor,
  getRankAccessibilityLabel,
  getTopThreeRankAccent,
  RANK_CURRENT_USER_GREEN,
} from "@/utils/participantRankUi";

const PANEL_ROW_HEIGHT = 52;
/** Compact so ~10 Live Board rows fit above progress/chat without scrolling. */
const BOARD_ROW_HEIGHT = 40;
/** How many Live Board rows should fit in the first viewport without scrolling. */
const LIVE_BOARD_VISIBLE_ROWS = 10;

export type TrackPanelPlayer = {
  id: string;
  userId: string;
  rank: number;
  name: string;
  steps: number;
  isMe: boolean;
  rankColor: string;
  initial: string;
  avatarUrl?: string | null;
  isForfeited?: boolean;
};

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
      style={[styles.panelMicBtn, isMuted && styles.panelMicBtnMuted]}
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

const TrackPanelRow = memo(function TrackPanelRow({
  player,
  avatarSize,
  rs,
  meAvatarUrl,
  isMuted,
  showMuteControls,
  onLocalMute,
  onLocalUnmute,
}: {
  player: TrackPanelPlayer;
  avatarSize: number;
  rs: (n: number) => number;
  meAvatarUrl?: string | null;
  isMuted: boolean;
  showMuteControls: boolean;
  onLocalMute: (userId: string) => void;
  onLocalUnmute: (userId: string) => void;
}) {
  const rowBorder = getParticipantRowBorderColor(
    player.rank,
    player.isMe && !player.isForfeited,
    "transparent",
  );
  // Profile ring uses the player's selected color (passed as rankColor).
  const avatarBorder =
    player.isForfeited
      ? "#FF4444"
      : player.isMe
        ? RANK_CURRENT_USER_GREEN
        : player.rankColor;
  const photoUri = player.isMe ? meAvatarUrl : player.avatarUrl;
  const [avatarFailed, setAvatarFailed] = useState(false);
  useEffect(() => {
    setAvatarFailed(false);
  }, [photoUri]);
  const showPhoto = !!photoUri && !avatarFailed;

  return (
    <View
      style={[
        styles.lbRow,
        player.isMe && !player.isForfeited && styles.lbRowMe,
        rowBorder !== "transparent" && {
          borderWidth: 1,
          borderColor: `${rowBorder}66`,
        },
      ]}
      accessibilityLabel={getRankAccessibilityLabel(player.rank, {
        isCurrentUser: player.isMe,
      })}
    >
      <View
        style={[
          styles.lbAvatar,
          {
            width: avatarSize,
            height: avatarSize,
            borderRadius: avatarSize / 2,
            borderColor: avatarBorder,
            marginRight: 5,
          },
        ]}
      >
        <Text style={[styles.lbAvatarI, { color: avatarBorder, fontSize: rs(12) }]}>
          {player.initial}
        </Text>
        {showPhoto ? (
          <Image
            source={{ uri: photoUri! }}
            onError={() => setAvatarFailed(true)}
            style={{
              position: "absolute",
              width: avatarSize,
              height: avatarSize,
              borderRadius: avatarSize / 2,
            }}
          />
        ) : null}
      </View>
      <View style={styles.lbInfo}>
        <Text
          style={[
            styles.lbName,
            {
              color: player.isMe
                ? RANK_CURRENT_USER_GREEN
                : player.isForfeited
                  ? "#FF4444"
                  : "#fff",
              fontSize: rs(11),
            },
          ]}
          numberOfLines={1}
        >
          {player.isMe ? "You" : player.name}
        </Text>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 2 }}>
          <BlueShoe size={rs(11)} />
          <Text
            style={[
              styles.lbSteps,
              { fontSize: rs(13), color: player.isForfeited ? "#FF4444" : "#FFFFFF" },
            ]}
          >
            {formatRaceSteps(player.steps)}
          </Text>
        </View>
        <Text style={[styles.lbUnit, { fontSize: Math.max(7, rs(9)) }]}>steps</Text>
      </View>
      {showMuteControls && !player.isMe && !player.isForfeited ? (
        <TrackPositionMuteBtn
          userId={player.userId || player.id}
          participantName={player.name}
          isMuted={isMuted}
          onMute={onLocalMute}
          onUnmute={onLocalUnmute}
        />
      ) : showMuteControls ? (
        <View style={styles.lbMuteColSpacer} />
      ) : null}
    </View>
  );
});

export function TrackPositionParticipantList({
  players,
  rsFactor = 1,
  meAvatarUrl,
  showMuteControls,
  isRemoteLocallyMuted,
  onLocalMute,
  onLocalUnmute,
  muteAllActive,
  onMuteAll,
  onUnmuteAll,
}: {
  players: TrackPanelPlayer[];
  rsFactor?: number;
  meAvatarUrl?: string | null;
  showMuteControls?: boolean;
  isRemoteLocallyMuted: (userId: string) => boolean;
  onLocalMute: (userId: string) => void;
  onLocalUnmute: (userId: string) => void;
  muteAllActive?: boolean;
  onMuteAll?: () => void;
  onUnmuteAll?: () => void;
}) {
  const rs = useCallback((n: number) => Math.round(n * rsFactor), [rsFactor]);
  const avatarSize = rs(32);

  const remoteIds = useMemo(
    () => players.filter((p) => !p.isMe && !p.isForfeited).map((p) => p.userId || p.id),
    [players],
  );

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<TrackPanelPlayer>) => (
      <TrackPanelRow
        player={item}
        avatarSize={avatarSize}
        rs={rs}
        meAvatarUrl={meAvatarUrl}
        isMuted={isRemoteLocallyMuted(item.userId || item.id)}
        showMuteControls={!!showMuteControls}
        onLocalMute={onLocalMute}
        onLocalUnmute={onLocalUnmute}
      />
    ),
    [
      avatarSize,
      rs,
      meAvatarUrl,
      isRemoteLocallyMuted,
      showMuteControls,
      onLocalMute,
      onLocalUnmute,
    ],
  );

  const keyExtractor = useCallback((item: TrackPanelPlayer) => item.id, []);
  const getItemLayout = useCallback(
    (_: ArrayLike<TrackPanelPlayer> | null | undefined, index: number) => ({
      length: PANEL_ROW_HEIGHT,
      offset: PANEL_ROW_HEIGHT * index,
      index,
    }),
    [],
  );

  return (
    <View style={{ flex: 1 }}>
      {showMuteControls && remoteIds.length > 0 && onMuteAll && onUnmuteAll ? (
        <View style={styles.muteAllRow}>
          <TouchableOpacity
            onPress={onMuteAll}
            style={[styles.muteAllBtn, muteAllActive && styles.muteAllBtnActive]}
            accessibilityRole="button"
            accessibilityLabel="Mute all remote participants on this device"
          >
            <Feather name="mic-off" size={12} color={muteAllActive ? "#00E676" : "#C7CDDA"} />
            <Text style={[styles.muteAllTxt, muteAllActive && { color: "#00E676" }]}>
              Mute All
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={onUnmuteAll}
            style={styles.muteAllBtn}
            accessibilityRole="button"
            accessibilityLabel="Unmute all remote participants on this device"
            disabled={!muteAllActive && remoteIds.every((id) => !isRemoteLocallyMuted(id))}
          >
            <Feather name="mic" size={12} color="#C7CDDA" />
            <Text style={styles.muteAllTxt}>Unmute All</Text>
          </TouchableOpacity>
        </View>
      ) : null}
      {players.length === 0 ? (
        <View style={styles.lbEmpty}>
          <Text style={[styles.lbEmptyText, { fontSize: rs(10) }]}>No live runners yet</Text>
        </View>
      ) : (
        <FlatList
          data={players}
          keyExtractor={keyExtractor}
          renderItem={renderItem}
          getItemLayout={getItemLayout}
          showsVerticalScrollIndicator={false}
          initialNumToRender={12}
          maxToRenderPerBatch={10}
          windowSize={7}
          removeClippedSubviews
          updateCellsBatchingPeriod={50}
        />
      )}
    </View>
  );
}

export type LiveBoardRowParticipant = {
  id: string;
  userId: string;
  username: string;
  currentSteps: number;
  status: string | null;
  rank: number | null;
  countryFlag: string | null;
  avatarColor: string | null;
  avatarUrl?: string | null;
  avatarVersion?: number | null;
  isHost: boolean;
  prizeAmount?: number;
  isTied?: boolean;
  tieGroupSize?: number;
  /** Unlimited Daily Goal Challenge only — backend-authoritative per-participant day (may differ across timezones). */
  dayNumber?: number | null;
  durationDays?: number | null;
};

const LiveBoardRow = memo(function LiveBoardRow({
  participant,
  rank,
  isUser,
  isCompleted,
  targetSteps,
  primary,
  foreground,
  mutedForeground,
  border,
  gold,
  warning,
  avatarUri,
  stepDelta,
  onPress,
  showDivider,
  /** When true, always show the numeric place (never 🥇🥈🥉) — used for pinned host. */
  forceNumericRank = false,
}: {
  participant: LiveBoardRowParticipant;
  rank: number;
  isUser: boolean;
  isCompleted: boolean;
  targetSteps: number;
  primary: string;
  foreground: string;
  mutedForeground: string;
  border: string;
  gold: string;
  warning: string;
  avatarUri: string | null;
  stepDelta: number;
  onPress?: () => void;
  showDivider: boolean;
  forceNumericRank?: boolean;
}) {
  const isForfeited = participant.status === "forfeited";
  const ac = isForfeited ? "#FF4444" : (participant.avatarColor ?? "#00E676");
  const nameColor = isForfeited ? "#FF4444" : isUser ? primary : foreground;
  const pct = targetSteps > 0 ? Math.min((participant.currentSteps / targetSteps) * 100, 100) : 0;
  const prize =
    isCompleted && !isForfeited && (participant.prizeAmount ?? 0) > 0
      ? `$${participant.prizeAmount!.toFixed(2)}`
      : null;
  // Medals only for true 1/2/3 in the toppers list — never on the pinned host row
  // (otherwise host@#2 shows 🥈 above 🥇 and the board reads silver→gold→bronze).
  const showMedalIcon =
    !forceNumericRank &&
    !isForfeited &&
    (rank === 1 || rank === 2 || rank === 3);
  const medal = showMedalIcon ? getTopThreeRankAccent(rank) : null;
  const rankMedals = ["🥇", "🥈", "🥉"] as const;
  const rankLabelColor = isForfeited
    ? "#FF4444"
    : medal ?? mutedForeground;
  const avatarBorder = isForfeited
    ? "#FF4444"
    : isUser
      ? primary
      : ac;
  const [avatarFailed, setAvatarFailed] = useState(false);
  useEffect(() => {
    setAvatarFailed(false);
  }, [avatarUri]);
  const initial = participant.username.charAt(0).toUpperCase() || "?";
  const showPhoto = !!avatarUri && !avatarFailed;

  return (
    <TouchableOpacity
      activeOpacity={0.75}
      onPress={onPress}
      accessibilityLabel={getRankAccessibilityLabel(rank, { isCurrentUser: isUser })}
      style={[
        styles.boardRow,
        isForfeited && { opacity: 0.75 },
        isUser && !isForfeited && { backgroundColor: primary + "0F" },
        showDivider && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: border },
      ]}
    >
      <Text style={[styles.boardMedal, { color: rankLabelColor }]}>
        {isForfeited ? "✕" : showMedalIcon ? rankMedals[rank - 1]! : String(rank)}
      </Text>
      <View
        style={[
          styles.boardAvatar,
          { backgroundColor: ac + "22", borderColor: avatarBorder },
        ]}
      >
        <Text style={[styles.boardAvatarTxt, { color: nameColor }]}>{initial}</Text>
        {showPhoto ? (
          <Image
            source={{ uri: avatarUri! }}
            onError={() => setAvatarFailed(true)}
            style={[styles.boardAvatarImg, StyleSheet.absoluteFillObject, isForfeited && { opacity: 0.5 }]}
          />
        ) : null}
      </View>
      <View style={styles.boardInfo}>
        <View style={styles.nameRow}>
          <Text style={[styles.boardName, { color: nameColor }]} numberOfLines={1}>
            {participant.username}
          </Text>
          {!!participant.countryFlag && (
            <Text style={{ fontSize: 13 }}>{participant.countryFlag}</Text>
          )}
          {!isForfeited && participant.isHost && (
            <View
              style={[
                styles.tag,
                { backgroundColor: gold + "22", borderColor: gold + "55" },
              ]}
            >
              <Text style={[styles.tagTxt, { color: gold }]}>Host</Text>
            </View>
          )}
          {!isForfeited && isUser && (
            <View
              style={[
                styles.tag,
                { backgroundColor: primary + "22", borderColor: primary + "55" },
              ]}
            >
              <Text style={[styles.tagTxt, { color: primary }]}>You</Text>
            </View>
          )}
          {isForfeited && (
            <View
              style={[
                styles.tag,
                { backgroundColor: "#FF444422", borderColor: "#FF444455" },
              ]}
            >
              <Text style={[styles.tagTxt, { color: "#FF4444" }]}>FORFEITED</Text>
            </View>
          )}
          {!isForfeited && participant.isTied && (
            <View
              style={[
                styles.tag,
                { backgroundColor: warning + "22", borderColor: warning + "55" },
              ]}
            >
              <Text style={[styles.tagTxt, { color: warning }]}>Tied</Text>
            </View>
          )}
          {!isForfeited && participant.dayNumber != null && (
            <View style={[styles.tag, { backgroundColor: "#7C3AFF22", borderColor: "#7C3AFF55" }]}>
              <Text style={[styles.tagTxt, { color: "#C4B5FD" }]}>
                Day {participant.dayNumber}
                {participant.durationDays ? `/${participant.durationDays}` : ""}
              </Text>
            </View>
          )}
        </View>
        <View style={[styles.track, { backgroundColor: border }]}>
          <View
            style={[
              styles.fill,
              {
                width: `${pct}%` as unknown as number,
                backgroundColor: isForfeited ? "#FF4444" : isUser ? primary : ac,
              },
            ]}
          />
        </View>
      </View>
      <View style={styles.boardRight}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
          <BlueShoe size={13} />
          <Text
            style={[
              styles.boardSteps,
              { color: isForfeited ? "#FF4444" : foreground },
            ]}
          >
            {participant.currentSteps.toLocaleString()}
          </Text>
          {!isForfeited &&
            participant.dayNumber != null &&
            targetSteps > 0 &&
            participant.currentSteps >= targetSteps && (
              <Feather name="check-circle" size={12} color="#00E676" />
            )}
        </View>
        {!isForfeited && stepDelta > 0 && (
          <Text style={styles.stepDelta}>+{stepDelta}</Text>
        )}
        {prize && <Text style={[styles.prize, { color: gold }]}>{prize}</Text>}
        {prize && participant.isTied && (participant.tieGroupSize ?? 1) > 1 && (
          <Text style={[styles.tagTxt, { color: mutedForeground }]}>
            shared ÷{participant.tieGroupSize}
          </Text>
        )}
      </View>
    </TouchableOpacity>
  );
});

export { LiveBoardRow, BOARD_ROW_HEIGHT, PANEL_ROW_HEIGHT, LIVE_BOARD_VISIBLE_ROWS };

const styles = StyleSheet.create({
  muteAllRow: {
    flexDirection: "row",
    gap: 6,
    marginBottom: 6,
    paddingRight: 2,
  },
  muteAllBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: "#111421",
    borderWidth: 1,
    borderColor: "#252A3E",
  },
  muteAllBtnActive: {
    borderColor: "#00E67655",
    backgroundColor: "#00E67614",
  },
  muteAllTxt: {
    color: "#C7CDDA",
    fontSize: 10,
    fontWeight: "800",
  },
  lbEmpty: { paddingVertical: 18, alignItems: "center" },
  lbEmptyText: { color: "#8A8FA3", textAlign: "center" },
  lbRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 5,
    paddingHorizontal: 3,
    marginBottom: 2,
    borderRadius: 8,
    height: PANEL_ROW_HEIGHT - 2,
  },
  lbRowMe: {
    backgroundColor: "#00E67614",
    borderWidth: 1,
    borderColor: "#00E67640",
  },
  avatarWrap: {
    width: 36,
    height: 36,
    marginRight: 5,
    justifyContent: "center",
  },
  lbAvatar: {
    borderWidth: 2,
    backgroundColor: "#1A1D2E",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  lbAvatarI: { fontWeight: "800" },
  rankCorner: {
    position: "absolute",
    left: -2,
    bottom: -2,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 3,
    backgroundColor: "#0B0D1A",
  },
  rankCornerTxt: { fontSize: 9, fontWeight: "900" },
  lbBadgeN: { fontWeight: "800" },
  lbInfo: { flex: 1, minWidth: 0 },
  lbName: { fontWeight: "700" },
  lbMuteColSpacer: { width: 28, height: 28, flexShrink: 0, marginLeft: 4 },
  panelMicBtn: {
    flexShrink: 0,
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#3A3F52",
    borderWidth: 1,
    borderColor: "#5B6078",
    marginLeft: 4,
  },
  panelMicBtnMuted: {
    backgroundColor: "#1A1D2E",
    borderColor: "#9CA3AF",
    opacity: 0.9,
  },
  lbSteps: { fontWeight: "800", color: "#FFFFFF", lineHeight: 14 },
  lbUnit: { color: "#8899BB" },
  boardRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 4,
    paddingHorizontal: 10,
    minHeight: BOARD_ROW_HEIGHT,
    height: BOARD_ROW_HEIGHT,
  },
  boardMedal: { fontSize: 15, width: 24, textAlign: "center" },
  boardAvatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  boardAvatarImg: { width: 28, height: 28, borderRadius: 14 },
  boardAvatarTxt: { fontSize: 12, fontWeight: "800" },
  boardInfo: { flex: 1, gap: 2, minWidth: 0 },
  nameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    flexWrap: "wrap",
  },
  boardName: { fontSize: 12, fontWeight: "700", flexShrink: 1 },
  tag: {
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 5,
    borderWidth: 1,
  },
  tagTxt: { fontSize: 9, fontWeight: "800" },
  track: { height: 2, borderRadius: 1, overflow: "hidden" },
  fill: { height: 2, borderRadius: 1 },
  boardRight: { alignItems: "flex-end", gap: 1, flexShrink: 0, minWidth: 64 },
  boardSteps: { fontSize: 11, fontWeight: "700" },
  stepDelta: { fontSize: 10, fontWeight: "800", color: "#00E676" },
  prize: { fontSize: 12, fontWeight: "800" },
});
