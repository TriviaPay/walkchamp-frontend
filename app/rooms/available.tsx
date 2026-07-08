import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Dimensions,
  FlatList,
  Image,
  Modal,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { router } from "expo-router";
import { Feather, Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { SafeAreaView } from "react-native-safe-area-context";
import { useSafeLayout } from "@/hooks/useSafeLayout";
import { authFetch } from "@/utils/authFetch";
import { getApiBase } from "@/utils/apiUrl";
import { ChannelAdapter, subscribeToChannel, unsubscribeFromChannel } from "@/services/realtimeService";
import { rf, rs } from "@/utils/responsive";
import { useRace } from "@/context/RaceContext";
import { useAuth } from "@/context/AuthContext";
import { buildMatchmakingParams } from "@/utils/waitingRoomSeed";
import { SkeletonList } from "@/components/SkeletonRows";
import { AppAlert } from "@/components/AppAlert";
import ActiveRaceModal, { type ActiveRaceInfo } from "@/components/ActiveRaceModal";
import { JoinProgressOverlay } from "@/components/RaceJoinBadge";
import JoinWithCodeModal, { type JoinWithCodeResult } from "@/components/JoinWithCodeModal";
import { PublicProfileModal, type PublicProfileInitialData } from "@/components/PublicProfileModal";
import { TRACK_LAYOUT_OPTIONS } from "@/constants/trackLayouts";
import CoinIcon from "@/components/CoinIcon";
import {
  CashChallengePaymentBreakdown,
} from "@/components/CashChallengePaymentBreakdown";
import {
  fetchCashChallengePaymentQuote,
  type CashChallengePaymentQuote,
} from "@/services/cashChallengeApi";
import { useApp } from "@/context/AppContext";
import {
  refundMessageFromCancelBody,
  refundMessageFromLeaveBody,
  type RaceCancelResponse,
  type RaceLeaveResponse,
} from "@/services/refundApi";

// ── Constants ──────────────────────────────────────────────────────────────────
const BG = "#080B14";
const CARD_BG = "#0D1122";
const GREEN = "#00E676";
const PURPLE = "#9333EA";

type RoomTab = "instant" | "upcoming";

interface UpcomingRoom {
  room_id: string;
  status: string;
  challenge_type: string;
  entry_fee: number;
  coin_entry_amount: number;
  title: string;
  target_steps: number;
  max_players: number;
  registered_count: number;
  scheduled_start_at: string | null;
  challenge_duration_days: number;
  challenge_end_at: string | null;
  selected_track_theme_id: string;
  theme_name: string;
  is_private: boolean;
  requires_code: boolean;
  host_user_id: string;
  host_username: string;
  host_avatar_color: string;
  host_avatar_url: string | null;
  host_country_flag: string | null;
  current_user_registered: boolean;
  eligible_to_register: boolean;
}


interface Room {
  room_id: string;
  challenge_type: string;
  entry_fee: number;
  title: string;
  target_steps: number;
  max_players: number;
  current_players: number;
  available_slots: number;
  reward_pool: number;
  coin_entry_amount: number;
  reward_label: string;
  host_user_id: string;
  host_username: string;
  host_avatar_color: string;
  host_avatar_url: string | null;
  host_country_flag: string | null;
  country_code: string | null;
  country_label: string;
  theme_name: string;
  is_private: boolean;
  requires_code: boolean;
  created_at: string;
  created_ago_label?: string;
  joinable: boolean;
  join_block_reason: string | null;
  race_type: string | null;
  team_a_country: string | null;
  team_a_country_code: string | null;
  team_b_country: string | null;
  team_b_country_code: string | null;
}


function getInitial(username: string): string {
  return username ? username[0].toUpperCase() : "?";
}

function fmtSteps(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(0)}k` : String(n);
}

function challengeIcon(entryType: string): React.ReactNode {
  const size = 12;
  if (entryType === "free")
    return <Ionicons name="walk-outline" size={size} color={GREEN} />;
  return <Feather name="dollar-sign" size={size} color="#00B4FF" />;
}

// ── HostAvatar: loads real photo, falls back to initial letter ─────────────────
function HostAvatar({ userId, avatarColor, username, size = rs(48), accent }: {
  userId: string; avatarColor: string; username: string; size?: number; accent: string;
}) {
  const [failed, setFailed] = React.useState(false);
  const initial = (username[0] ?? "?").toUpperCase();
  const uri = `${getApiBase()}/api/profile/avatar/${userId}`;
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, borderWidth: 2, borderColor: accent + "80", overflow: "hidden", alignItems: "center", justifyContent: "center", backgroundColor: avatarColor + "22" }}>
      {!failed ? (
        <Image
          source={{ uri }}
          style={{ width: size, height: size, borderRadius: size / 2 }}
          resizeMode="cover"
          onError={() => setFailed(true)}
        />
      ) : (
        <Text style={{ fontSize: size * 0.38, fontWeight: "900", color: avatarColor }}>{initial}</Text>
      )}
    </View>
  );
}

// ── RoomCard ──────────────────────────────────────────────────────────────────
interface RoomCardProps {
  room: Room;
  onJoin: (room: Room) => void;
  onJoinWithCode: () => void;
  onViewHost: (room: Room) => void;
  joining: boolean;
}

const GOLD = "#F59E0B";
const GOLD_DARK = "#B45309";
const CASH_BLUE = "#0EA5E9";
const FREE_REWARDS = { first: 50, second: 30, third: 20 } as const;

function RoomCard({ room, onJoin, onJoinWithCode, onViewHost, joining }: RoomCardProps) {
  const isPrivate = room.requires_code;
  const isFull = room.current_players >= room.max_players;
  const disabled = joining || isFull;
  const isCoins = room.challenge_type === "coins_battle";
  const isCash = !isCoins && room.entry_fee > 0;
  const accent = isCash ? CASH_BLUE : isCoins ? GOLD : GREEN;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const trackSource = (TRACK_LAYOUT_OPTIONS.find((t) => t.label === room.theme_name)?.source ?? require("@/assets/images/bg.png")) as any;

  const prizePoolDollars = isCash ? room.reward_pool : 0;
  const prizePoolCoins = isCoins ? (room.coin_entry_amount ?? 0) * room.current_players : 0;

  const gradColors = isCash
    ? ([CASH_BLUE, "#0369A1"] as const)
    : isCoins
    ? ([GOLD, GOLD_DARK] as const)
    : ([GREEN, "#00C853"] as const);

  const handlePress = () => {
    if (disabled) return;
    if (isPrivate) onJoinWithCode();
    else onJoin(room);
  };

  return (
    <View style={[cc.wrap, { borderColor: accent + "50" }]}>
      <Image source={trackSource} style={cc.bgImage} resizeMode="cover" />
      <View style={cc.overlay} />
      <LinearGradient colors={["transparent", "rgba(0,0,0,0.93)"]} style={cc.bottomGrad} />
      <LinearGradient colors={[accent + "DD", "transparent"]} style={cc.topGlow} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} />

      <View style={cc.content}>
        <View style={cc.badgeRow}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
            <View style={[
              cc.typeBadge,
              { backgroundColor: accent + "30", borderColor: accent },
              (isCash || isCoins) && cc.typeBadgeHighlight,
            ]}>
              {isCash ? <Feather name="dollar-sign" size={9} color={accent} />
                : isCoins ? <CoinIcon size={11} />
                : <Ionicons name="walk-outline" size={10} color={accent} />}
              <Text style={[cc.typeBadgeText, { color: accent }]}>
                {isCash ? "CASH" : isCoins ? "COINS ⚔️" : "FREE"}
              </Text>
            </View>
            {isCash && (
              <View style={[cc.entryFeePill, { borderColor: CASH_BLUE, backgroundColor: CASH_BLUE + "30" }]}>
                <Feather name="dollar-sign" size={8} color={CASH_BLUE} />
                <Text style={[cc.entryFeePillText, { color: "#FFFFFF" }]}>
                  Fee ${room.entry_fee.toFixed(0)}
                </Text>
              </View>
            )}
            {isCoins && (
              <View style={[cc.entryFeePill, { borderColor: GOLD + "90", backgroundColor: GOLD + "25" }]}>
                <CoinIcon size={9} />
                <Text style={[cc.entryFeePillText, { color: GOLD }]}>
                  Fee {(room.coin_entry_amount ?? 0).toLocaleString()}
                </Text>
              </View>
            )}
          </View>
          <View style={{ flex: 1 }} />
          {isPrivate ? (
            <View style={[cc.visBadge, { backgroundColor: PURPLE + "28", borderColor: PURPLE + "65" }]}>
              <Feather name="lock" size={7} color={PURPLE} />
              <Text style={[cc.visBadgeText, { color: PURPLE }]}>Private</Text>
              <Text style={[cc.visBadgeText, { color: "#BCC8E8" }]}>{room.current_players}/{room.max_players}</Text>
            </View>
          ) : (
            <View style={[cc.visBadge, { backgroundColor: GREEN + "18", borderColor: GREEN + "45" }]}>
              <Feather name="globe" size={7} color={GREEN} />
              <Text style={[cc.visBadgeText, { color: GREEN }]}>Public</Text>
              <Text style={[cc.visBadgeText, { color: "#BCC8E8" }]}>{room.current_players}/{room.max_players}</Text>
            </View>
          )}
        </View>

        <TouchableOpacity style={cc.hostRow} onPress={() => onViewHost(room)} activeOpacity={0.7}>
          {room.host_avatar_url ? (
            <Image
              source={{ uri: `${getApiBase()}/api/profile/avatar/${room.host_user_id}` }}
              style={cc.hostAvatar}
            />
          ) : (
            <View style={[cc.hostAvatar, { backgroundColor: room.host_avatar_color ?? (accent + "88") }]}>
              <Text style={cc.hostInitial}>{(room.host_username[0] ?? "?").toUpperCase()}</Text>
            </View>
          )}
          <Text style={cc.hostName} numberOfLines={1}>@{room.host_username}</Text>
          {room.host_country_flag ? <Text style={{ fontSize: rf(12) }}>{room.host_country_flag}</Text> : null}
        </TouchableOpacity>

        <View style={cc.countdownBlock}>
          <Text style={[cc.countdownBig, { color: accent }]} numberOfLines={1}>Active now</Text>
          {room.created_ago_label ? (
            <Text style={cc.countdownSmall} numberOfLines={1}>{room.created_ago_label}</Text>
          ) : null}
          <View style={{ flexDirection: "row", alignItems: "center", gap: 3, marginTop: 2 }}>
            <Feather name="users" size={9} color="#8B9AC0" />
            <Text style={[cc.countdownSmall, { color: "#8B9AC0" }]}>
              {room.current_players}/{room.max_players} players joined
            </Text>
          </View>
        </View>

        <View style={[cc.chipsRow, { flexWrap: "wrap" }]}>
          <View style={[cc.chip, { flexDirection: "row", alignItems: "center", gap: 4 }]}>
            <Image source={require("@/assets/images/blue-shoe.png")} style={{ width: 11, height: 11 }} resizeMode="contain" />
            <Text style={cc.chipText}>{fmtSteps(room.target_steps)} steps</Text>
          </View>
          {!isCash && !isCoins && (
            <View style={[cc.chip, { flexDirection: "row", alignItems: "center", gap: 3 }]}>
              <CoinIcon size={9} />
              <Text style={cc.chipText}>🥇{FREE_REWARDS.first} 🥈{FREE_REWARDS.second} 🥉{FREE_REWARDS.third}</Text>
            </View>
          )}
          {isCash && (
            <View style={[cc.chip, { flexDirection: "row", alignItems: "center", gap: 4, borderColor: GOLD + "55", backgroundColor: GOLD + "12" }]}>
              <Image source={require("@/assets/images/trophy-cash.png")} style={{ width: 11, height: 11 }} resizeMode="contain" />
              <Text style={[cc.chipText, { color: GOLD }]}>
                {prizePoolDollars > 0 ? `Prize Pool $${prizePoolDollars.toFixed(0)}` : "Prize Pool updates as players join"}
              </Text>
            </View>
          )}
          {isCoins && prizePoolCoins > 0 && (
            <View style={[cc.chip, { flexDirection: "row", alignItems: "center", gap: 4, borderColor: GOLD + "55", backgroundColor: GOLD + "12" }]}>
              <CoinIcon size={9} />
              <Text style={[cc.chipText, { color: GOLD }]}>Prize Pool {prizePoolCoins.toLocaleString()}</Text>
            </View>
          )}
        </View>

        <TouchableOpacity
          style={[cc.registerBtn, { opacity: disabled && !joining ? 0.55 : 1 }]}
          onPress={handlePress}
          disabled={disabled}
          activeOpacity={0.8}
        >
          <LinearGradient
            colors={isFull ? (["#2A2D3A", "#1E2130"] as const) : gradColors}
            start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
            style={[cc.registerBtnGrad, { flexDirection: "row", gap: 8 }]}
          >
            {joining ? (
              <>
                <ActivityIndicator size="small" color={isCoins ? "#000" : "#FFF"} />
                <Text style={[cc.registerBtnText, { color: isCoins ? "#000" : "#FFF" }]}>Joining…</Text>
              </>
            ) : (
              <>
                {!isFull && (
                  isPrivate ? <Feather name="lock" size={12} color={isCoins ? "#000" : "#FFF"} />
                  : isCoins ? <CoinIcon size={14} />
                  : <Feather name="users" size={12} color="#FFF" />
                )}
                <Text style={[cc.registerBtnText, { color: isFull ? "#8B9AC0" : isCoins ? "#000" : "#FFF" }]}>
                  {isFull ? "Full" : isPrivate ? "Enter with Code" : isCoins ? "Join Battle" : "Join"}
                </Text>
              </>
            )}
          </LinearGradient>
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ── CoinsBattleCard — premium layout ──────────────────────────────────────────
function CoinsBattleCard({ room, onJoin, onJoinWithCode, onViewHost, joining, isFull, disabled, isPrivate }: {
  room: Room; onJoin: (r: Room) => void; onJoinWithCode: () => void; onViewHost: (r: Room) => void;
  joining: boolean; isFull: boolean; disabled: boolean; isPrivate: boolean;
}) {
  const avatarColor = room.host_avatar_color || GOLD;
  const filledSlots = room.current_players;
  const totalSlots = room.max_players;

  return (
    <View style={cb.wrap}>
      {/* Gold glow line */}
      <LinearGradient colors={[GOLD + "00", GOLD + "80", GOLD + "00"]} start={{ x: 0, y: 0.5 }} end={{ x: 1, y: 0.5 }} style={cb.topGlow} />

      {/* Header: icon + title + badges + player count */}
      <View style={cb.headerRow}>
        <View style={cb.titleGroup}>
          <Image source={require("@/assets/images/game-coin.png")} style={cb.headerCoinIcon} resizeMode="contain" />
          <Text style={cb.headerTitle}>COINS BATTLE</Text>
        </View>
        <View style={cb.headerRight}>
          {isPrivate ? (
            <View style={[cb.visBadge, { backgroundColor: PURPLE + "20", borderColor: PURPLE + "50" }]}>
              <Feather name="lock" size={9} color={PURPLE} />
              <Text style={[cb.visBadgeText, { color: PURPLE }]}>Private</Text>
            </View>
          ) : (
            <View style={[cb.visBadge, { backgroundColor: "#00B4FF18", borderColor: "#00B4FF45" }]}>
              <Feather name="globe" size={9} color="#00B4FF" />
              <Text style={[cb.visBadgeText, { color: "#00B4FF" }]}>Public</Text>
            </View>
          )}
          <View style={cb.playerPill}>
            <Feather name="users" size={10} color="#8B9AC0" />
            <Text style={cb.playerText}>{filledSlots}/{totalSlots}</Text>
          </View>
        </View>
      </View>

      {/* Divider */}
      <View style={cb.divider} />

      {/* Host row */}
      <TouchableOpacity onPress={() => onViewHost(room)} activeOpacity={0.75} style={cb.hostRow}>
        <HostAvatar userId={room.host_user_id} avatarColor={avatarColor} username={room.host_username} size={rs(40)} accent={GOLD} />
        <View style={{ flex: 1 }}>
          <Text style={cb.hostUsername} numberOfLines={1}>
            @{room.host_username}{room.host_country_flag ? `  ${room.host_country_flag}` : ""}
          </Text>
          <Text style={cb.hostLabel}>Host</Text>
        </View>
        <Feather name="chevron-right" size={14} color="#4B5680" />
      </TouchableOpacity>

      {/* Stats row */}
      <View style={cb.statsRow}>
        {/* Target */}
        <View style={cb.statChip}>
          <View style={[cb.statIconWrap, { backgroundColor: GREEN + "18" }]}>
            <Feather name="target" size={15} color={GREEN} />
          </View>
          <Text style={cb.statValue}>{fmtSteps(room.target_steps)}</Text>
          <Text style={cb.statLabel}>steps target</Text>
        </View>

        <View style={cb.statDivider} />

        {/* Entry */}
        <View style={cb.statChip}>
          <View style={[cb.statIconWrap, { backgroundColor: GOLD + "18" }]}>
            <Image source={require("@/assets/images/game-coin.png")} style={{ width: 15, height: 15 }} resizeMode="contain" />
          </View>
          <Text style={[cb.statValue, { color: GOLD }]}>{(room.coin_entry_amount ?? 0).toLocaleString()}</Text>
          <Text style={cb.statLabel}>coins entry</Text>
        </View>

        <View style={cb.statDivider} />

        {/* Prize pool estimate */}
        <View style={cb.statChip}>
          <View style={[cb.statIconWrap, { backgroundColor: "#A855F718" }]}>
            <Feather name="award" size={15} color="#A855F7" />
          </View>
          <Text style={[cb.statValue, { color: "#A855F7" }]}>{((room.coin_entry_amount ?? 0) * totalSlots).toLocaleString()}</Text>
          <Text style={cb.statLabel}>max pool</Text>
        </View>
      </View>

      {/* Player slots bar */}
      <View style={cb.slotsBar}>
        <View style={cb.slotsTrack}>
          <View style={[cb.slotsFill, { width: `${Math.min(100, (filledSlots / totalSlots) * 100)}%` as `${number}%` }]} />
        </View>
        <Text style={cb.slotsText}>{filledSlots}/{totalSlots} players joined</Text>
      </View>

      {/* Join button — full width */}
      {isPrivate ? (
        <TouchableOpacity onPress={() => !disabled && onJoinWithCode()} disabled={disabled} activeOpacity={0.85}
          style={[cb.joinBtn, { opacity: disabled ? 0.5 : 1 }]}>
          <LinearGradient colors={isFull ? ["#2A2D3A", "#1E2130"] : [GOLD, GOLD_DARK]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={cb.joinBtnGrad}>
            <Feather name="lock" size={16} color={isFull ? "#8B9AC0" : "#000"} />
            <Text style={[cb.joinBtnText, { color: isFull ? "#8B9AC0" : "#000" }]}>{isFull ? "Room Full" : "Enter with Code"}</Text>
          </LinearGradient>
        </TouchableOpacity>
      ) : (
        <TouchableOpacity onPress={() => !disabled && onJoin(room)} disabled={disabled} activeOpacity={0.85}
          style={[cb.joinBtn, { opacity: disabled ? 0.5 : 1 }]}>
          <LinearGradient colors={isFull ? ["#2A2D3A", "#1E2130"] : [GREEN, "#00C853"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={cb.joinBtnGrad}>
            {joining ? (
              <>
                <ActivityIndicator size="small" color="#000" />
                <Text style={[cb.joinBtnText, { color: "#000" }]}>Joining…</Text>
              </>
            ) : (
              <>
                {!isFull && <Image source={require("@/assets/images/game-coin.png")} style={{ width: 17, height: 17 }} resizeMode="contain" />}
                <Text style={[cb.joinBtnText, { color: isFull ? "#8B9AC0" : "#000" }]}>{isFull ? "Room Full" : "Join Battle"}</Text>
              </>
            )}
          </LinearGradient>
        </TouchableOpacity>
      )}

      {room.created_ago_label ? (
        <View style={card.timeRow}>
          <Feather name="clock" size={10} color="#4B5680" />
          <Text style={card.timeText}>{room.created_ago_label}</Text>
        </View>
      ) : null}
    </View>
  );
}

const cb = StyleSheet.create({
  wrap: {
    backgroundColor: "#0D1019",
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: GOLD + "40",
    overflow: "hidden",
    marginBottom: 12,
    paddingHorizontal: rs(16),
    paddingTop: rs(14),
    paddingBottom: rs(14),
    gap: 12,
  },
  topGlow: { position: "absolute", top: 0, left: 0, right: 0, height: 1.5 },

  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  titleGroup: { flexDirection: "row", alignItems: "center", gap: 7 },
  headerCoinIcon: { width: 18, height: 18 },
  headerTitle: { fontSize: rf(13), fontWeight: "900", color: GOLD, letterSpacing: 1.2 },

  headerRight: { flexDirection: "row", alignItems: "center", gap: 8 },
  visBadge: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: rs(8), paddingVertical: 3, borderRadius: 7, borderWidth: 1 },
  visBadgeText: { fontSize: rf(10), fontWeight: "700" },
  playerPill: { flexDirection: "row", alignItems: "center", gap: 3 },
  playerText: { fontSize: rf(11), fontWeight: "700", color: "#8B9AC0" },

  divider: { height: 1, backgroundColor: GOLD + "20" },

  hostRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  hostUsername: { fontSize: rf(13), fontWeight: "700", color: "#D4DCEF" },
  hostLabel: { fontSize: rf(10), color: "#4B5680", marginTop: 1 },

  statsRow: { flexDirection: "row", alignItems: "center", backgroundColor: "#131720", borderRadius: 14, borderWidth: 1, borderColor: GOLD + "20", paddingVertical: rs(12), paddingHorizontal: rs(8) },
  statChip: { flex: 1, alignItems: "center", gap: 4 },
  statIconWrap: { width: rs(32), height: rs(32), borderRadius: rs(16), alignItems: "center", justifyContent: "center" },
  statValue: { fontSize: rf(13), fontWeight: "800", color: "#E2E8F8" },
  statLabel: { fontSize: rf(9), color: "#6B7FA8", textAlign: "center" },
  statDivider: { width: 1, height: rs(40), backgroundColor: GOLD + "25" },

  slotsBar: { gap: 5 },
  slotsTrack: { height: 4, backgroundColor: "#1E2538", borderRadius: 2, overflow: "hidden" },
  slotsFill: { height: 4, backgroundColor: GOLD, borderRadius: 2 },
  slotsText: { fontSize: rf(10), color: "#4B5680", textAlign: "right" },

  joinBtn: { borderRadius: 14, overflow: "hidden" },
  joinBtnGrad: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: rs(15) },
  joinBtnText: { fontSize: rf(15), fontWeight: "900", letterSpacing: 0.3 },
});

const card = StyleSheet.create({
  wrap: {
    backgroundColor: CARD_BG,
    borderRadius: 18,
    borderWidth: 1,
    overflow: "hidden",
    marginBottom: 12,
    paddingHorizontal: rs(14),
    paddingTop: rs(14),
    paddingBottom: rs(12),
    gap: 12,
  },
  glowLine: { position: "absolute", top: 0, left: 0, right: 0, height: 1, borderRadius: 1 },

  // top row
  topRow: { flexDirection: "row", alignItems: "flex-start", gap: 10 },

  badgesColumn: { flex: 1, gap: 5 },
  badgesRow: { flexDirection: "row", flexWrap: "wrap", gap: 5 },
  badge: {
    flexDirection: "row", alignItems: "center", gap: 4,
    paddingHorizontal: rs(8), paddingVertical: 4,
    borderRadius: 8, borderWidth: 1,
  },
  badgeText: { fontSize: rf(11), fontWeight: "700" },
  hostText: { fontSize: rf(13), fontWeight: "600", color: "#BCC8E8" },

  playerPill: { flexDirection: "row", alignItems: "center", gap: 3, flexShrink: 0, marginTop: 2 },
  playerText: { fontSize: rf(12), fontWeight: "600", color: "#8B9AC0" },

  // bottom row
  bottomRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  infoChip: {
    flex: 1, alignItems: "center", gap: 4,
    borderWidth: 1, borderRadius: 12,
    paddingVertical: rs(10), paddingHorizontal: 6,
  },
  infoIconWrap: { width: rs(34), height: rs(34), borderRadius: rs(17), alignItems: "center", justifyContent: "center" },
  infoValue: { fontSize: rf(12), fontWeight: "700", color: "#D4DCEF", textAlign: "center" },
  infoLabel: { fontSize: rf(10), color: "#6B7FA8", textAlign: "center" },

  joinBtn: { width: rs(68), height: rs(80), borderRadius: 16, borderWidth: 1.5, overflow: "hidden", flexShrink: 0 },
  joinBtnGrad: { flex: 1, alignItems: "center", justifyContent: "center", gap: 4 },
  joinBtnText: { fontSize: rf(13), fontWeight: "800", color: "#FFF" },

  timeRow: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: -4 },
  timeText: { fontSize: rf(10), color: "#4B5680" },
});

// ── Premium room card styles (Free + Cash) ────────────────────────────────────
const pc = StyleSheet.create({
  wrap: {
    backgroundColor: "#0D1019",
    borderRadius: 20,
    borderWidth: 1.5,
    overflow: "hidden",
    marginBottom: 12,
    paddingHorizontal: rs(16),
    paddingTop: rs(14),
    paddingBottom: rs(14),
    gap: 12,
  },
  topGlow: { position: "absolute", top: 0, left: 0, right: 0, height: 1.5 },

  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  titleGroup: { flexDirection: "row", alignItems: "center", gap: 6 },
  headerTitle: { fontSize: rf(12), fontWeight: "900", letterSpacing: 1.1 },

  headerRight: { flexDirection: "row", alignItems: "center", gap: 8 },
  visBadge: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: rs(8), paddingVertical: 3, borderRadius: 7, borderWidth: 1 },
  visBadgeText: { fontSize: rf(10), fontWeight: "700" },
  playerPill: { flexDirection: "row", alignItems: "center", gap: 3 },
  playerText: { fontSize: rf(11), fontWeight: "700", color: "#8B9AC0" },

  divider: { height: 1 },

  hostRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  hostUsername: { fontSize: rf(13), fontWeight: "700", color: "#D4DCEF" },
  hostLabel: { fontSize: rf(10), color: "#4B5680", marginTop: 1 },

  statsRow: { flexDirection: "row", alignItems: "center", backgroundColor: "#131720", borderRadius: 14, borderWidth: 1, paddingVertical: rs(12), paddingHorizontal: rs(8) },
  statChip: { flex: 1, alignItems: "center", gap: 4 },
  statIconWrap: { width: rs(30), height: rs(30), borderRadius: rs(15), alignItems: "center", justifyContent: "center" },
  statValue: { fontSize: rf(13), fontWeight: "800", color: "#E2E8F8" },
  statLabel: { fontSize: rf(9), color: "#6B7FA8", textAlign: "center" },
  statDivider: { width: 1, height: rs(40) },

  slotsBar: { gap: 5 },
  slotsTrack: { height: 4, backgroundColor: "#1E2538", borderRadius: 2, overflow: "hidden" },
  slotsFill: { height: 4, borderRadius: 2 },
  slotsText: { fontSize: rf(10), color: "#4B5680", textAlign: "right" },

  joinBtn: { borderRadius: 14, overflow: "hidden" },
  joinBtnGrad: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: rs(15) },
  joinBtnText: { fontSize: rf(15), fontWeight: "900", letterSpacing: 0.3 },

  timeRow: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: -6 },
  timeText: { fontSize: rf(10), color: "#4B5680" },
});

// ── Countdown helper ──────────────────────────────────────────────────────────
function useCountdown(scheduledStartAt: string | null): string {
  const [label, setLabel] = React.useState("");
  React.useEffect(() => {
    if (!scheduledStartAt) { setLabel(""); return; }
    function calc() {
      const diff = new Date(scheduledStartAt!).getTime() - Date.now();
      if (diff <= 0) { setLabel("Starting now…"); return; }
      const totalMin = Math.floor(diff / 60_000);
      const h = Math.floor(totalMin / 60);
      const m = totalMin % 60;
      const d = Math.floor(h / 24);
      const hRem = h % 24;
      if (d > 0) setLabel(`Starts in ${d}d ${String(hRem).padStart(2, "0")}h`);
      else if (h > 0) setLabel(`Starts in ${h}h ${String(m).padStart(2, "0")}m`);
      else setLabel(`Starts in ${m}m`);
    }
    calc();
    const t = setInterval(calc, 30_000);
    return () => clearInterval(t);
  }, [scheduledStartAt]);
  return label;
}

// ── UpcomingRoomCard ──────────────────────────────────────────────────────────
interface UpcomingRoomCardProps {
  room: UpcomingRoom;
  currentUserId: string | null | undefined;
  onRegister: (room: UpcomingRoom) => void;
  onCancel: (room: UpcomingRoom) => void;
  onCancelRoom: (room: UpcomingRoom) => void;
  onViewHost: (room: UpcomingRoom) => void;
  registering: boolean;
}

// ── Avatar with API-proxy + onError fallback for upcoming cards ────────────────
function UpcomingAvatar({ userId, avatarColor, username, isSponsored, size = rs(44) }: {
  userId: string; avatarColor: string; username: string; isSponsored: boolean; size?: number;
}) {
  const [failed, setFailed] = React.useState(false);
  const displayName = isSponsored ? "W" : (username[0] ?? "?").toUpperCase();
  const displayColor = isSponsored ? "#7C3AFF" : avatarColor;
  const uri = isSponsored ? null : `${getApiBase()}/api/profile/avatar/${userId}`;

  if (!uri || failed) {
    return (
      <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: displayColor + "30", alignItems: "center", justifyContent: "center" }}>
        <Text style={{ fontSize: size * 0.38, fontWeight: "900", color: displayColor }}>{displayName}</Text>
      </View>
    );
  }
  return (
    <Image
      source={{ uri }}
      style={{ width: size, height: size, borderRadius: size / 2 }}
      resizeMode="cover"
      onError={() => setFailed(true)}
    />
  );
}

function UpcomingRoomCard({ room, currentUserId, onRegister, onCancel, onCancelRoom, onViewHost, registering }: UpcomingRoomCardProps) {
  const countdown   = useCountdown(room.scheduled_start_at);
  const isFull      = room.registered_count >= room.max_players;
  const isSponsored = room.challenge_type === "sponsored";
  const isCash      = !isSponsored && room.entry_fee > 0;
  const isHost      = !isSponsored && !!currentUserId && currentUserId === room.host_user_id;

  const accent      = isSponsored ? "#7C3AFF" : (isCash ? CASH_BLUE : GREEN);
  const gradColors  = isSponsored
    ? (["#7C3AFF", "#C47BFF"] as const)
    : isCash
      ? ([CASH_BLUE, "#0369A1"] as const)
      : ([GREEN, "#00C853"] as const);

  const displayHost    = isSponsored ? "WalkChamp" : room.host_username;
  const displayInitial = isSponsored ? "W" : (room.host_username[0] ?? "?").toUpperCase();
  const avatarColor    = room.host_avatar_color || accent;

  const entryLabel = isSponsored ? "Sponsored" : isCash ? `$${room.entry_fee.toFixed(2)}` : "Free";
  const entryColor = isSponsored ? "#C47BFF" : isCash ? CASH_BLUE : GREEN;

  const fmtScheduled = (iso: string | null) => {
    if (!iso) return "";
    return new Date(iso).toLocaleDateString("en-US", {
      month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
    });
  };

  return (
    <View style={[ucard.wrap, { borderColor: accent + "40" }]}>
      <LinearGradient
        colors={[accent + "90", "transparent"]}
        style={ucard.topGlow}
        start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
      />

      {/* ── Header row ── */}
      <View style={ucard.headerRow}>
        <View style={ucard.titleGroup}>
          {isSponsored ? (
            <>
              <Text style={{ fontSize: rf(11) }}>🏆</Text>
              <Text style={[ucard.headerTitle, { color: "#C47BFF" }]}>WALKCHAMP</Text>
            </>
          ) : isCash ? (
            <>
              <Feather name="dollar-sign" size={11} color={CASH_BLUE} />
              <Text style={[ucard.headerTitle, { color: CASH_BLUE }]}>CASH CHALLENGE</Text>
            </>
          ) : (
            <>
              <Ionicons name="walk-outline" size={13} color={GREEN} />
              <Text style={[ucard.headerTitle, { color: GREEN }]}>FREE CHALLENGE</Text>
            </>
          )}
          <View style={ucard.scheduledBadge}>
            <Feather name="calendar" size={8} color="#00B4FF" />
            <Text style={ucard.scheduledBadgeText}>Scheduled</Text>
          </View>
        </View>

        <View style={ucard.headerRight}>
          {room.requires_code ? (
            <View style={[ucard.visBadge, { backgroundColor: PURPLE + "18", borderColor: PURPLE + "45" }]}>
              <Feather name="lock" size={8} color={PURPLE} />
              <Text style={[ucard.visBadgeText, { color: PURPLE }]}>Private</Text>
            </View>
          ) : (
            <View style={[ucard.visBadge, { backgroundColor: GREEN + "12", borderColor: GREEN + "35" }]}>
              <Feather name="globe" size={8} color={GREEN} />
              <Text style={[ucard.visBadgeText, { color: GREEN }]}>Public</Text>
            </View>
          )}
          <View style={ucard.playerPill}>
            <Feather name="users" size={10} color="#8B9AC0" />
            <Text style={ucard.playerText}>{room.registered_count}/{room.max_players}</Text>
          </View>
        </View>
      </View>

      {/* ── Divider ── */}
      <View style={[ucard.divider, { backgroundColor: accent + "25" }]} />

      {/* ── Host row ── */}
      <TouchableOpacity
        style={ucard.hostRow}
        onPress={() => !isSponsored && onViewHost(room)}
        activeOpacity={isSponsored ? 1 : 0.7}
      >
        <View style={[ucard.avatarRing, { borderColor: isHost ? "#FFD70060" : accent + "60" }]}>
          <UpcomingAvatar
            userId={room.host_user_id}
            avatarColor={avatarColor}
            username={displayInitial}
            isSponsored={isSponsored}
            size={rs(36)}
          />
        </View>
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
            {isHost && (
              <View style={ucard.hostBadge}>
                <Feather name="star" size={8} color="#FFD700" />
                <Text style={ucard.hostBadgeText}>HOST</Text>
              </View>
            )}
            <Text style={ucard.hostUsername} numberOfLines={1}>@{displayHost}</Text>
            {!isSponsored && room.host_country_flag ? <Text style={{ fontSize: rf(13) }}>{room.host_country_flag}</Text> : null}
          </View>
          <Text style={ucard.hostLabel}>Room host</Text>
        </View>
        {!isSponsored && <Feather name="chevron-right" size={14} color="#4B5680" />}
      </TouchableOpacity>

      {/* ── Countdown ── */}
      <View style={ucard.countdownSection}>
        <View style={ucard.countdownRow}>
          <Feather name="clock" size={15} color={accent} />
          <Text style={[ucard.countdownBig, { color: accent }]}>{countdown || "Starting soon"}</Text>
        </View>
        {room.scheduled_start_at ? (
          <Text style={ucard.scheduledDate}>{fmtScheduled(room.scheduled_start_at)}</Text>
        ) : null}
      </View>

      {/* ── Stats panel ── */}
      <View style={[ucard.statsRow, { borderColor: accent + "20" }]}>
        <View style={ucard.statChip}>
          <View style={[ucard.statIconWrap, { backgroundColor: GREEN + "18" }]}>
            <Image source={require("@/assets/images/blue-shoe.png")} style={{ width: 14, height: 14 }} resizeMode="contain" />
          </View>
          <Text style={ucard.statValue}>{room.target_steps >= 1000 ? `${(room.target_steps / 1000).toFixed(0)}k` : room.target_steps}</Text>
          <Text style={ucard.statLabel}>steps</Text>
        </View>
        <View style={[ucard.statDivider, { backgroundColor: accent + "20" }]} />
        <View style={ucard.statChip}>
          <View style={[ucard.statIconWrap, { backgroundColor: entryColor + "18" }]}>
            {isCash ? <Feather name="dollar-sign" size={14} color={entryColor} /> :
             isSponsored ? <Text style={{ fontSize: rf(12) }}>🏆</Text> :
             <Ionicons name="walk-outline" size={14} color={GREEN} />}
          </View>
          <Text style={[ucard.statValue, { color: entryColor }]}>{entryLabel}</Text>
          <Text style={ucard.statLabel}>entry</Text>
        </View>
        <View style={[ucard.statDivider, { backgroundColor: accent + "20" }]} />
        <View style={ucard.statChip}>
          <View style={[ucard.statIconWrap, { backgroundColor: "#FFD70018" }]}>
            <Feather name="sun" size={14} color="#FFD700" />
          </View>
          <Text style={ucard.statValue}>{room.challenge_duration_days > 0 ? `${room.challenge_duration_days}d` : "1d"}</Text>
          <Text style={ucard.statLabel}>duration</Text>
        </View>
      </View>

      {/* ── Action button ── */}
      {!isSponsored && isHost ? (
        <TouchableOpacity
          style={[ucard.cancelRoomBtn, { opacity: registering ? 0.5 : 1 }]}
          onPress={() => !registering && onCancelRoom(room)}
          disabled={registering}
          activeOpacity={0.8}
        >
          {registering
            ? <><ActivityIndicator size="small" color="#FF4444" /><Text style={ucard.cancelRoomBtnText}>Cancelling…</Text></>
            : <><Feather name="x-octagon" size={14} color="#FF4444" /><Text style={ucard.cancelRoomBtnText}>Cancel Room</Text></>
          }
        </TouchableOpacity>
      ) : room.current_user_registered ? (
        <TouchableOpacity
          style={[ucard.cancelRegBtn, { opacity: registering ? 0.5 : 1 }]}
          onPress={() => !registering && onCancel(room)}
          disabled={registering}
          activeOpacity={0.8}
        >
          {registering
            ? <><ActivityIndicator size="small" color="#8B9AC0" /><Text style={ucard.cancelRegBtnText}>Cancelling…</Text></>
            : <><Feather name="x-circle" size={14} color="#8B9AC0" /><Text style={ucard.cancelRegBtnText}>Cancel Registration</Text></>
          }
        </TouchableOpacity>
      ) : (
        <TouchableOpacity
          style={[ucard.registerBtn, { opacity: (isFull || registering) ? 0.5 : 1 }]}
          onPress={() => !isFull && !registering && onRegister(room)}
          disabled={isFull || registering}
          activeOpacity={0.8}
        >
          <LinearGradient
            colors={isFull ? (["#2A2D3A", "#1E2130"] as const) : gradColors}
            start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
            style={ucard.registerBtnGrad}
          >
            {registering ? (
              <><ActivityIndicator size="small" color="#FFF" /><Text style={[ucard.registerBtnText, { color: "#FFF" }]}>Registering…</Text></>
            ) : isFull ? (
              <><Feather name="slash" size={14} color="#8B9AC0" /><Text style={[ucard.registerBtnText, { color: "#8B9AC0" }]}>Room Full</Text></>
            ) : (
              <><Feather name="check-circle" size={14} color="#FFF" /><Text style={[ucard.registerBtnText, { color: "#FFF" }]}>Register</Text></>
            )}
          </LinearGradient>
        </TouchableOpacity>
      )}
    </View>
  );
}

const ucard = StyleSheet.create({
  wrap: {
    backgroundColor: "#0D1019",
    borderRadius: 20,
    borderWidth: 1.5,
    overflow: "hidden",
    marginBottom: 14,
    paddingHorizontal: rs(16),
    paddingTop: rs(14),
    paddingBottom: rs(14),
    gap: 12,
  },
  topGlow: { position: "absolute", top: 0, left: 0, right: 0, height: 1.5 },

  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  titleGroup: { flexDirection: "row", alignItems: "center", gap: 5 },
  headerTitle: { fontSize: rf(11), fontWeight: "900", letterSpacing: 1.1 },
  scheduledBadge: {
    flexDirection: "row", alignItems: "center", gap: 3,
    marginLeft: 6, paddingHorizontal: 7, paddingVertical: 2,
    borderRadius: 6, borderWidth: 1,
    backgroundColor: "#00B4FF12", borderColor: "#00B4FF35",
  },
  scheduledBadgeText: { fontSize: rf(9), fontWeight: "700", color: "#00B4FF" },

  headerRight: { flexDirection: "row", alignItems: "center", gap: 8 },
  visBadge: { flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: rs(7), paddingVertical: 2, borderRadius: 6, borderWidth: 1 },
  visBadgeText: { fontSize: rf(9), fontWeight: "700" },
  playerPill: { flexDirection: "row", alignItems: "center", gap: 3 },
  playerText: { fontSize: rf(11), fontWeight: "700", color: "#8B9AC0" },

  divider: { height: 1 },

  hostRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  avatarRing: { width: rs(40), height: rs(40), borderRadius: rs(20), borderWidth: 2, alignItems: "center", justifyContent: "center", overflow: "hidden", flexShrink: 0 },
  hostBadge: { flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 5, backgroundColor: "#FFD70020", borderWidth: 1, borderColor: "#FFD70060" },
  hostBadgeText: { fontSize: rf(9), fontWeight: "700", color: "#FFD700" },
  hostUsername: { fontSize: rf(13), fontWeight: "700", color: "#D4DCEF" },
  hostLabel: { fontSize: rf(10), color: "#4B5680", marginTop: 1 },

  countdownSection: { gap: 4 },
  countdownRow: { flexDirection: "row", alignItems: "center", gap: 7 },
  countdownBig: { fontSize: rf(20), fontWeight: "800", letterSpacing: 0.3 },
  scheduledDate: { fontSize: rf(11), color: "#6B7FA8", marginLeft: 22 },

  statsRow: { flexDirection: "row", alignItems: "center", backgroundColor: "#131720", borderRadius: 14, borderWidth: 1, paddingVertical: rs(12), paddingHorizontal: rs(8) },
  statChip: { flex: 1, alignItems: "center", gap: 4 },
  statIconWrap: { width: rs(30), height: rs(30), borderRadius: rs(15), alignItems: "center", justifyContent: "center" },
  statValue: { fontSize: rf(13), fontWeight: "800", color: "#E2E8F8" },
  statLabel: { fontSize: rf(9), color: "#6B7FA8" },
  statDivider: { width: 1, height: rs(40) },

  registerBtn: { borderRadius: 14, overflow: "hidden" },
  registerBtnGrad: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, paddingVertical: rs(15) },
  registerBtnText: { fontSize: rf(15), fontWeight: "900" },

  cancelRoomBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, paddingVertical: rs(14), borderRadius: 14, borderWidth: 1, borderColor: "#FF444445", backgroundColor: "#FF444412" },
  cancelRoomBtnText: { fontSize: rf(14), fontWeight: "700", color: "#FF4444" },

  cancelRegBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, paddingVertical: rs(14), borderRadius: 14, borderWidth: 1, borderColor: "#8B9AC030" },
  cancelRegBtnText: { fontSize: rf(14), fontWeight: "700", color: "#8B9AC0" },
});

// ── Date grouping helpers ──────────────────────────────────────────────────────
interface DateGroup {
  date: string;
  dateLabel: string;
  rooms: UpcomingRoom[];
}

function groupByLocalDate(rooms: UpcomingRoom[]): DateGroup[] {
  const now = new Date();
  const todayStr = now.toLocaleDateString("en-CA");
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = tomorrow.toLocaleDateString("en-CA");

  const map = new Map<string, UpcomingRoom[]>();
  rooms.forEach((room) => {
    if (!room.scheduled_start_at) return;
    const key = new Date(room.scheduled_start_at).toLocaleDateString("en-CA");
    const arr = map.get(key) ?? [];
    arr.push(room);
    map.set(key, arr);
  });

  return Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, dateRooms]) => ({
      date,
      dateLabel:
        date === todayStr ? "Today"
        : date === tomorrowStr ? "Tomorrow"
        : new Date(date + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }),
      rooms: dateRooms.sort(
        (a, b) => new Date(a.scheduled_start_at!).getTime() - new Date(b.scheduled_start_at!).getTime()
      ),
    }));
}

// ── Compact scheduled room card (horizontal scroll) ───────────────────────────
const COMPACT_W = Math.min(295, Dimensions.get("window").width * 0.82);

interface CompactCardProps {
  room: UpcomingRoom;
  currentUserId: string | undefined;
  onRegister: (room: UpcomingRoom) => void;
  onCancel: (room: UpcomingRoom) => void;
  onCancelRoom: (room: UpcomingRoom) => void;
  onViewHost: (room: UpcomingRoom) => void;
  registering: boolean;
}

const CompactScheduledRoomCard = React.memo(function CompactScheduledRoomCard({
  room, currentUserId, onRegister, onCancel, onCancelRoom, onViewHost, registering,
}: CompactCardProps) {
  const countdown   = useCountdown(room.scheduled_start_at);
  const isFull      = room.registered_count >= room.max_players;
  const isSponsored = room.challenge_type === "sponsored";
  const isCoins     = !isSponsored && room.challenge_type === "coins_battle";
  const isCash      = !isSponsored && !isCoins && room.entry_fee > 0;
  const isHost      = !isSponsored && !!currentUserId && currentUserId === room.host_user_id;
  const accent      = isSponsored ? "#7C3AFF" : isCash ? CASH_BLUE : isCoins ? GOLD : GREEN;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const trackSource = (TRACK_LAYOUT_OPTIONS.find((t) => t.id === room.selected_track_theme_id)?.source ?? require("@/assets/images/bg.png")) as any;

  // Prize pool — full entry fees collected (no platform deduction from pool)
  const prizePoolDollars = isCash ? Math.round(room.entry_fee * room.registered_count) : 0;
  const prizePoolCoins   = isCoins ? room.coin_entry_amount * room.registered_count : 0;

  const gradColors = isSponsored
    ? (["#7C3AFF", "#C47BFF"] as const)
    : isCash ? ([CASH_BLUE, "#0369A1"] as const)
    : isCoins ? ([GOLD, GOLD_DARK] as const)
    : ([GREEN, "#00C853"] as const);

  const fmtShort = (iso: string | null) => {
    if (!iso) return "";
    return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  };

  return (
    <View style={[cc.wrap, { borderColor: accent + "50" }]}>
      <Image source={trackSource} style={cc.bgImage} resizeMode="cover" />
      <View style={cc.overlay} />
      <LinearGradient colors={["transparent", "rgba(0,0,0,0.93)"]} style={cc.bottomGrad} />
      <LinearGradient colors={[accent + "DD", "transparent"]} style={cc.topGlow} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} />

      <View style={cc.content}>
        {/* Badges */}
        <View style={cc.badgeRow}>
          {/* Left: type badge + entry fee pill for cash cards */}
          <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
            <View style={[
              cc.typeBadge,
              { backgroundColor: accent + "30", borderColor: accent },
              (isCash || isCoins) && cc.typeBadgeHighlight,
            ]}>
              {isSponsored ? <Text style={{ fontSize: rf(9) }}>🏆</Text>
                : isCash ? <Feather name="dollar-sign" size={9} color={accent} />
                : isCoins ? <CoinIcon size={11} />
                : <Ionicons name="walk-outline" size={10} color={accent} />}
              <Text style={[cc.typeBadgeText, { color: accent }]}>
                {isSponsored ? "CHAMP" : isCash ? "CASH" : isCoins ? "COINS ⚔️" : "FREE"}
              </Text>
            </View>
            {isCash && (
              <View style={[cc.entryFeePill, { borderColor: CASH_BLUE, backgroundColor: CASH_BLUE + "30" }]}>
                <Feather name="dollar-sign" size={8} color={CASH_BLUE} />
                <Text style={[cc.entryFeePillText, { color: "#FFFFFF" }]}>
                  Fee ${room.entry_fee.toFixed(0)}
                </Text>
              </View>
            )}
            {isCoins && (
              <View style={[cc.entryFeePill, { borderColor: GOLD + "90", backgroundColor: GOLD + "25" }]}>
                <CoinIcon size={9} />
                <Text style={[cc.entryFeePillText, { color: GOLD }]}>
                  Fee {room.coin_entry_amount.toLocaleString()}
                </Text>
              </View>
            )}
          </View>
          <View style={{ flex: 1 }} />
          {room.requires_code ? (
            <View style={[cc.visBadge, { backgroundColor: PURPLE + "28", borderColor: PURPLE + "65" }]}>
              <Feather name="lock" size={7} color={PURPLE} />
              <Text style={[cc.visBadgeText, { color: PURPLE }]}>Private</Text>
              <Text style={[cc.visBadgeText, { color: "#BCC8E8" }]}>{room.registered_count}/{room.max_players}</Text>
            </View>
          ) : (
            <View style={[cc.visBadge, { backgroundColor: GREEN + "18", borderColor: GREEN + "45" }]}>
              <Feather name="globe" size={7} color={GREEN} />
              <Text style={[cc.visBadgeText, { color: GREEN }]}>Public</Text>
              <Text style={[cc.visBadgeText, { color: "#BCC8E8" }]}>{room.registered_count}/{room.max_players}</Text>
            </View>
          )}
        </View>

        {/* Host — tappable → profile modal */}
        <TouchableOpacity
          style={cc.hostRow}
          onPress={() => !isSponsored && onViewHost(room)}
          activeOpacity={isSponsored ? 1 : 0.7}
          disabled={isSponsored}
        >
          {room.host_avatar_url ? (
            <Image
              source={{ uri: `${getApiBase()}/api/profile/avatar/${room.host_user_id}` }}
              style={cc.hostAvatar}
            />
          ) : (
            <View style={[cc.hostAvatar, { backgroundColor: room.host_avatar_color ?? (accent + "88") }]}>
              <Text style={cc.hostInitial}>{(isSponsored ? "W" : (room.host_username[0] ?? "?")).toUpperCase()}</Text>
            </View>
          )}
          <Text style={cc.hostName} numberOfLines={1}>@{isSponsored ? "WalkChamp" : room.host_username}</Text>
          {isHost && (
            <View style={cc.hostBadge}>
              <Feather name="star" size={7} color="#FFD700" />
              <Text style={cc.hostBadgeText}>HOST</Text>
            </View>
          )}
          {room.host_country_flag ? <Text style={{ fontSize: rf(12) }}>{room.host_country_flag}</Text> : null}
        </TouchableOpacity>

        {/* Countdown */}
        <View style={cc.countdownBlock}>
          <Text style={[cc.countdownBig, { color: accent }]} numberOfLines={1}>{countdown || "Starting soon"}</Text>
          {room.scheduled_start_at ? (
            <Text style={cc.countdownSmall} numberOfLines={1}>
              {room.challenge_duration_days > 1 && room.challenge_end_at
                ? `${fmtShort(room.scheduled_start_at)} → ${fmtShort(room.challenge_end_at)}`
                : fmtShort(room.scheduled_start_at)}
            </Text>
          ) : null}
          {/* Duration — separate row clearly below the date */}
          <View style={{ flexDirection: "row", alignItems: "center", gap: 3, marginTop: 2 }}>
            <Feather name="calendar" size={9} color="#8B9AC0" />
            <Text style={[cc.countdownSmall, { color: "#8B9AC0" }]}>{room.challenge_duration_days > 0 ? `${room.challenge_duration_days}d` : "1d"} challenge</Text>
          </View>
        </View>

        {/* Info chips */}
        <View style={[cc.chipsRow, { flexWrap: "wrap" }]}>
          {/* Steps — always shown */}
          <View style={[cc.chip, { flexDirection: "row", alignItems: "center", gap: 4 }]}>
            <Image source={require("@/assets/images/blue-shoe.png")} style={{ width: 11, height: 11 }} resizeMode="contain" />
            <Text style={cc.chipText}>{room.target_steps >= 1000 ? `${(room.target_steps / 1000).toFixed(0)}k` : room.target_steps} steps</Text>
          </View>
          {/* Reward split chip — free cards only; cash + coins fee moved to badge row */}
          {!isCash && !isCoins && !isSponsored && (
            <View style={[cc.chip, { flexDirection: "row", alignItems: "center", gap: 3 }]}>
              <CoinIcon size={9} />
              <Text style={cc.chipText}>🥇{FREE_REWARDS.first} 🥈{FREE_REWARDS.second} 🥉{FREE_REWARDS.third}</Text>
            </View>
          )}
          {/* Prize pool chip — cash: always shown (pending if 0); coins: shown if > 0 */}
          {isCash && (
            <View style={[cc.chip, { flexDirection: "row", alignItems: "center", gap: 4, borderColor: GOLD + "55", backgroundColor: GOLD + "12" }]}>
              <Image source={require("@/assets/images/trophy-cash.png")} style={{ width: 11, height: 11 }} resizeMode="contain" />
              <Text style={[cc.chipText, { color: GOLD }]}>
                {prizePoolDollars > 0 ? `Prize Pool $${prizePoolDollars}` : "Prize Pool updates as players join"}
              </Text>
            </View>
          )}
          {isCoins && prizePoolCoins > 0 && (
            <View style={[cc.chip, { flexDirection: "row", alignItems: "center", gap: 4, borderColor: GOLD + "55", backgroundColor: GOLD + "12" }]}>
              <CoinIcon size={9} />
              <Text style={[cc.chipText, { color: GOLD }]}>Prize Pool {prizePoolCoins.toLocaleString()}</Text>
            </View>
          )}
        </View>

        {/* CTA */}
        {!isSponsored && isHost ? (
          <TouchableOpacity
            style={[cc.cancelRoomBtn, { opacity: registering ? 0.6 : 1 }]}
            onPress={() => !registering && onCancelRoom(room)}
            disabled={registering}
            activeOpacity={0.8}
          >
            {registering
              ? <ActivityIndicator size="small" color="#FF6B6B" />
              : <Text style={cc.cancelRoomBtnText}>Cancel Room</Text>}
          </TouchableOpacity>
        ) : room.current_user_registered ? (
          <View style={{ gap: 6 }}>
            <View style={cc.registeredBtn}>
              <Feather name="check-circle" size={12} color={GREEN} />
              <Text style={cc.registeredBtnText}>Registered</Text>
            </View>
            <TouchableOpacity
              style={[cc.withdrawBtn, { opacity: registering ? 0.6 : 1 }]}
              onPress={() => !registering && onCancel(room)}
              disabled={registering}
              activeOpacity={0.8}
            >
              {registering
                ? <ActivityIndicator size="small" color="#FF8A65" />
                : <><Feather name="log-out" size={11} color="#FF8A65" /><Text style={cc.withdrawBtnText}>Withdraw Registration</Text></>}
            </TouchableOpacity>
          </View>
        ) : (
          <TouchableOpacity
            style={[cc.registerBtn, { opacity: (isFull || registering) ? 0.55 : 1 }]}
            onPress={() => !isFull && !registering && onRegister(room)}
            disabled={isFull || registering}
            activeOpacity={0.8}
          >
            <LinearGradient
              colors={isFull ? (["#2A2D3A", "#1E2130"] as const) : gradColors}
              start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
              style={cc.registerBtnGrad}
            >
              {registering
                ? <ActivityIndicator size="small" color="#FFF" />
                : <Text style={[cc.registerBtnText, { color: isFull ? "#8B9AC0" : "#FFF" }]}>{isFull ? "Full" : "Register"}</Text>}
            </LinearGradient>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
});

const cc = StyleSheet.create({
  wrap: { width: COMPACT_W, borderRadius: 18, overflow: "hidden", borderWidth: 1.5, marginRight: 12 },
  bgImage: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, width: "100%", height: "100%" },
  overlay: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(4,6,18,0.72)" },
  bottomGrad: { position: "absolute", bottom: 0, left: 0, right: 0, height: 130 },
  topGlow: { position: "absolute", top: 0, left: 0, right: 0, height: 1.5 },
  content: { padding: rs(12), gap: 8 },

  badgeRow: { flexDirection: "row", alignItems: "center", gap: 5, flexWrap: "wrap" },
  typeBadge: { flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: 7, paddingVertical: 3, borderRadius: 6, borderWidth: 1 },
  typeBadgeHighlight: { paddingHorizontal: 9, paddingVertical: 4, borderRadius: 7, borderWidth: 1.5, shadowColor: "#000", shadowOpacity: 0.4, shadowRadius: 4, shadowOffset: { width: 0, height: 1 } },
  typeBadgeText: { fontSize: rf(9), fontWeight: "800", letterSpacing: 0.7 },
  visBadge: { flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: 6, paddingVertical: 3, borderRadius: 6, borderWidth: 1 },
  visBadgeText: { fontSize: rf(9), fontWeight: "700" },
  countBadge: { flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: 4 },
  countText: { fontSize: rf(10), fontWeight: "600", color: "#BCC8E8" },
  entryFeePill: { flexDirection: "row", alignItems: "center", paddingHorizontal: 7, paddingVertical: 3, borderRadius: 6, borderWidth: 1 },
  entryFeePillText: { fontSize: rf(9), fontWeight: "700" },

  hostRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  hostAvatar: { width: 22, height: 22, borderRadius: 11, alignItems: "center", justifyContent: "center", flexShrink: 0 },
  hostInitial: { fontSize: rf(10), fontWeight: "800", color: "#FFF" },
  hostName: { fontSize: rf(12), fontWeight: "600", color: "#E2E8F8", flex: 1 },
  hostBadge: { flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: 5, paddingVertical: 2, borderRadius: 5, backgroundColor: "#FFD70018", borderWidth: 1, borderColor: "#FFD70055" },
  hostBadgeText: { fontSize: rf(8), fontWeight: "700", color: "#FFD700" },

  withdrawBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5, paddingVertical: rs(7), borderRadius: 10, borderWidth: 1, borderColor: "#FF8A6540", backgroundColor: "#FF8A6510" },
  withdrawBtnText: { fontSize: rf(12), fontWeight: "700", color: "#FF8A65" },

  countdownBlock: { gap: 2 },
  countdownBig: { fontSize: rf(18), fontWeight: "800", letterSpacing: 0.2 },
  countdownSmall: { fontSize: rf(10), color: "#8B9AC0" },

  chipsRow: { flexDirection: "row", gap: 5 },
  chip: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, borderWidth: 1, borderColor: "#2A3550", backgroundColor: "rgba(8,11,24,0.7)" },
  chipText: { fontSize: rf(10), fontWeight: "600", color: "#BCC8E8" },

  registerBtn: { borderRadius: 10, overflow: "hidden" },
  registerBtnGrad: { alignItems: "center", justifyContent: "center", paddingVertical: rs(9) },
  registerBtnText: { fontSize: rf(13), fontWeight: "800" },

  registeredBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5, paddingVertical: rs(9), borderRadius: 10, borderWidth: 1, borderColor: GREEN + "40", backgroundColor: GREEN + "12" },
  registeredBtnText: { fontSize: rf(13), fontWeight: "700", color: GREEN },

  cancelRoomBtn: { alignItems: "center", justifyContent: "center", paddingVertical: rs(9), borderRadius: 10, borderWidth: 1, borderColor: "#FF444440", backgroundColor: "#FF444415" },
  cancelRoomBtnText: { fontSize: rf(13), fontWeight: "700", color: "#FF6B6B" },
});

// ── Current rooms section (horizontal scroll, matches scheduled layout) ───────
interface CurrentRoomsSectionProps {
  rooms: Room[];
  error: string | null;
  joiningRoomId: string | null;
  onJoin: (room: Room) => void;
  onJoinWithCode: () => void;
  onViewHost: (room: Room) => void;
  onViewAll: () => void;
  onRetry: () => void;
}

function CurrentRoomsSection({
  rooms, error, joiningRoomId, onJoin, onJoinWithCode, onViewHost, onViewAll, onRetry,
}: CurrentRoomsSectionProps) {
  return (
    <View style={ds.section}>
      <View style={ds.header}>
        <View>
          <Text style={ds.dateLabel}>Current Rooms</Text>
          <Text style={ds.roomCount}>
            {error ? "—" : `${rooms.length} room${rooms.length !== 1 ? "s" : ""}`}
          </Text>
        </View>
        {rooms.length > 0 && (
          <TouchableOpacity style={ds.viewAllBtn} onPress={onViewAll} activeOpacity={0.7}>
            <Text style={ds.viewAllText}>View All</Text>
            <Feather name="chevron-right" size={13} color="#00B4FF" />
          </TouchableOpacity>
        )}
      </View>

      {error ? (
        <View style={ds.emptyWrap}>
          <Feather name="wifi-off" size={22} color="#8B9AC0" />
          <Text style={ds.emptyTitle}>Could not load active rooms</Text>
          <Text style={ds.emptySub}>{error}</Text>
          <TouchableOpacity style={ds.retryBtn} onPress={onRetry} activeOpacity={0.8}>
            <Text style={ds.retryBtnText}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : rooms.length === 0 ? (
        <View style={ds.emptyWrap}>
          <Text style={ds.emptyTitle}>No active rooms right now</Text>
        </View>
      ) : (
        <FlatList
          horizontal
          data={rooms}
          keyExtractor={(item) => item.room_id}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={ds.listContent}
          renderItem={({ item }) => (
            <RoomCard
              room={item}
              onJoin={onJoin}
              onJoinWithCode={onJoinWithCode}
              onViewHost={onViewHost}
              joining={joiningRoomId === item.room_id}
            />
          )}
        />
      )}
    </View>
  );
}

// ── Date section (header + horizontal scroll) ─────────────────────────────────
interface DateSectionProps {
  group: DateGroup;
  currentUserId: string | undefined;
  registeringRoomId: string | null;
  onRegister: (room: UpcomingRoom) => void;
  onCancel: (room: UpcomingRoom) => void;
  onCancelRoom: (room: UpcomingRoom) => void;
  onViewHost: (room: UpcomingRoom) => void;
}

function DateSection({ group, currentUserId, registeringRoomId, onRegister, onCancel, onCancelRoom, onViewHost }: DateSectionProps) {
  return (
    <View style={ds.section}>
      <View style={ds.header}>
        <View>
          <Text style={ds.dateLabel}>{group.dateLabel}</Text>
          <Text style={ds.roomCount}>{group.rooms.length} room{group.rooms.length !== 1 ? "s" : ""}</Text>
        </View>
        <TouchableOpacity
          style={ds.viewAllBtn}
          onPress={() => router.push({ pathname: "/rooms/upcoming/[date]" as const, params: { date: group.date, dateLabel: group.dateLabel } })}
          activeOpacity={0.7}
        >
          <Text style={ds.viewAllText}>View All</Text>
          <Feather name="chevron-right" size={13} color="#00B4FF" />
        </TouchableOpacity>
      </View>
      <FlatList
        horizontal
        data={group.rooms}
        keyExtractor={(item) => item.room_id}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={ds.listContent}
        renderItem={({ item }) => (
          <CompactScheduledRoomCard
            room={item}
            currentUserId={currentUserId}
            onRegister={onRegister}
            onCancel={onCancel}
            onCancelRoom={onCancelRoom}
            onViewHost={onViewHost}
            registering={registeringRoomId === item.room_id}
          />
        )}
      />
    </View>
  );
}

const ds = StyleSheet.create({
  section: { marginBottom: 22 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: rs(16), marginBottom: 10 },
  dateLabel: { fontSize: rf(16), fontWeight: "800", color: "#D4DCEF" },
  roomCount: { fontSize: rf(11), color: "#6B7FA8", marginTop: 1 },
  viewAllBtn: { flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, backgroundColor: "#00B4FF12", borderWidth: 1, borderColor: "#00B4FF30" },
  viewAllText: { fontSize: rf(12), fontWeight: "700", color: "#00B4FF" },
  listContent: { paddingHorizontal: rs(16), paddingBottom: 4 },
  emptyWrap: { alignItems: "center", paddingHorizontal: rs(24), paddingVertical: rs(20), marginHorizontal: rs(16), gap: 6 },
  emptyTitle: { fontSize: rf(14), fontWeight: "700", color: "#8B9AC0", textAlign: "center" },
  emptySub: { fontSize: rf(12), color: "#6B7FA8", textAlign: "center" },
  retryBtn: {
    marginTop: 6,
    paddingHorizontal: rs(24), paddingVertical: rs(10),
    borderRadius: 12,
    backgroundColor: GREEN + "20",
    borderWidth: 1, borderColor: GREEN + "50",
  },
  retryBtnText: { fontSize: rf(14), fontWeight: "700", color: GREEN },
});

// ── Main screen ───────────────────────────────────────────────────────────────
export default function AvailableRoomsScreen() {
  const { safeBottom } = useSafeLayout();
  const { setActiveRace, joinRace } = useRace();
  const { user } = useAuth();

  const [rooms, setRooms] = useState<Room[]>([]);
  const [activeRoomCount, setActiveRoomCount] = useState(0);
  const [publicRoomCount, setPublicRoomCount] = useState(0);
  const [privateRoomCount, setPrivateRoomCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [joiningRoomId, setJoiningRoomId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeRaceModal, setActiveRaceModal] = useState<ActiveRaceInfo | null>(null);
  const [leavingActiveRace, setLeavingActiveRace] = useState(false);
  const pendingRaceActionRef = useRef<(() => Promise<void>) | null>(null);

  const [selectedHostId, setSelectedHostId] = useState<string | null>(null);
  const [selectedHostData, setSelectedHostData] = useState<PublicProfileInitialData | null>(null);
  const [joinWithCodeVisible, setJoinWithCodeVisible] = useState(false);
  const [currentViewAllOpen, setCurrentViewAllOpen] = useState(false);
  const [consentRoom, setConsentRoom] = useState<Room | null>(null);
  const [consentUpcomingRoom, setConsentUpcomingRoom] = useState<UpcomingRoom | null>(null);
  const [consentChecks, setConsentChecks] = useState([false, false, false, false]);
  const [consentPaymentQuote, setConsentPaymentQuote] = useState<CashChallengePaymentQuote | null>(null);
  const { walletBalance, refreshWallet } = useApp();

  // ── Upcoming rooms state ──────────────────────────────────────────────────
  const [upcomingRooms, setUpcomingRooms] = useState<UpcomingRoom[]>([]);
  const [upcomingLoading, setUpcomingLoading] = useState(false);
  const [upcomingRefreshing, setUpcomingRefreshing] = useState(false);
  const [upcomingError, setUpcomingError] = useState<string | null>(null);
  const [registeringRoomId, setRegisteringRoomId] = useState<string | null>(null);

  const channelRef = useRef<ChannelAdapter | null>(null);

  // ── Fetch ──────────────────────────────────────────────────────────────────
  const fetchRooms = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    try {
      const res = await authFetch(`/api/rooms/available?filter=all&sort=newest&limit=30`, { signal: controller.signal });
      if (!res.ok) throw new Error(`Server error ${res.status}`);
      const data = (await res.json()) as {
        rooms: Room[];
        active_room_count?: number;
        public_room_count?: number;
        private_room_count?: number;
      };
      setRooms(data.rooms ?? []);
      setActiveRoomCount(data.active_room_count ?? (data.rooms?.length ?? 0));
      setPublicRoomCount(data.public_room_count ?? 0);
      setPrivateRoomCount(data.private_room_count ?? 0);
    } catch (err) {
      const isAbort = err instanceof Error && err.name === "AbortError";
      const msg = isAbort
        ? "Request timed out. Check your connection and try again."
        : err instanceof Error ? err.message : "Could not load rooms. Pull to refresh.";
      setError(msg);
    } finally {
      clearTimeout(timeout);
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  const fetchUpcomingRooms = useCallback(async (isRefresh = false) => {
    if (isRefresh) setUpcomingRefreshing(true);
    else setUpcomingLoading(true);
    setUpcomingError(null);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    try {
      const res = await authFetch(`/api/rooms/available?tab=upcoming`, { signal: controller.signal });
      if (!res.ok) throw new Error(`Server error ${res.status}`);
      const data = (await res.json()) as { rooms: UpcomingRoom[] };
      setUpcomingRooms(data.rooms ?? []);
    } catch (err) {
      const isAbort = err instanceof Error && err.name === "AbortError";
      setUpcomingError(isAbort ? "Request timed out." : err instanceof Error ? err.message : "Could not load upcoming rooms.");
    } finally {
      clearTimeout(timeout);
      setUpcomingLoading(false);
      setUpcomingRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void Promise.all([fetchRooms(), fetchUpcomingRooms()]);
  }, [fetchRooms, fetchUpcomingRooms]);

  const refreshAll = useCallback(async () => {
    await Promise.all([fetchRooms(true), fetchUpcomingRooms(true)]);
  }, [fetchRooms, fetchUpcomingRooms]);

  const groupedUpcomingRooms = useMemo(
    () => groupByLocalDate(upcomingRooms),
    [upcomingRooms],
  );

  const scheduledRoomCount = upcomingRooms.length;
  const displayActiveCount = activeRoomCount > 0 ? activeRoomCount : rooms.length;

  const headerSubtitle = useMemo(() => {
    if (loading || upcomingLoading) return "Loading rooms…";
    return `${displayActiveCount} active room${displayActiveCount !== 1 ? "s" : ""} • ${scheduledRoomCount} scheduled room${scheduledRoomCount !== 1 ? "s" : ""}`;
  }, [loading, upcomingLoading, displayActiveCount, scheduledRoomCount]);

  const isPageLoading = loading || upcomingLoading;
  const isRefreshing = refreshing || upcomingRefreshing;

  // ── Register for upcoming room ─────────────────────────────────────────────
  const doRegister = useCallback(async (room: UpcomingRoom) => {
    if (registeringRoomId) return;
    setRegisteringRoomId(room.room_id);
    try {
      const res = await authFetch(`/api/rooms/${room.room_id}/register`, {
        method: "POST",
        body: JSON.stringify({ acceptedCashChallengeConsent: room.entry_fee > 0 }),
      });
      const body = await res.json().catch(() => ({})) as Record<string, unknown>;
      if (!res.ok) {
        AppAlert.alert("Registration failed", (body.error as string) ?? "Could not register.");
        return;
      }
      setUpcomingRooms((prev) =>
        prev.map((r) =>
          r.room_id === room.room_id
            ? { ...r, current_user_registered: true, registered_count: (body.registered_count as number) ?? r.registered_count + 1, eligible_to_register: false }
            : r
        )
      );
    } catch {
      AppAlert.alert("Error", "Network error. Please try again.");
    } finally {
      setRegisteringRoomId(null);
    }
  }, [registeringRoomId]);

  const handleRegister = useCallback((room: UpcomingRoom) => {
    if (room.entry_fee > 0) {
      setConsentChecks([false, false, false, false]);
      setConsentUpcomingRoom(room);
    } else {
      void doRegister(room);
    }
  }, [doRegister]);

  const handleCancelRegistration = useCallback(async (room: UpcomingRoom) => {
    if (registeringRoomId) return;
    setRegisteringRoomId(room.room_id);
    try {
      // Scheduled rooms: cancel registration (no charge until race starts).
      // Open/full waiting rooms: leave triggers canonical wallet refund.
      const useLeave = room.status === "open" || room.status === "full";
      const res = await authFetch(
        useLeave
          ? `/api/races/${room.room_id}/leave`
          : `/api/rooms/${room.room_id}/cancel-registration`,
        { method: "POST", ...(useLeave ? { body: JSON.stringify({ reason: "cancel_registration" }) } : {}) },
      );
      const body = await res.json().catch(() => ({})) as RaceLeaveResponse & Record<string, unknown>;
      if (!res.ok) {
        AppAlert.alert("Could not cancel", (body.error as string) ?? "Please try again.");
        return;
      }
      if (useLeave) {
        await refreshWallet();
        const refundMsg = refundMessageFromLeaveBody(body);
        if (refundMsg) AppAlert.alert("Refund", refundMsg);
      }
      setUpcomingRooms((prev) =>
        prev.map((r) =>
          r.room_id === room.room_id
            ? { ...r, current_user_registered: false, registered_count: Math.max(0, r.registered_count - 1), eligible_to_register: true }
            : r
        )
      );
    } catch {
      AppAlert.alert("Error", "Network error. Please try again.");
    } finally {
      setRegisteringRoomId(null);
    }
  }, [registeringRoomId, refreshWallet]);

  const handleCancelRoom = useCallback(async (room: UpcomingRoom) => {
    if (registeringRoomId) return;
    AppAlert.alert(
      "Cancel Room",
      "Are you sure you want to cancel this room? All registered participants will be notified.",
      [
        { text: "Keep Room", style: "cancel" },
        {
          text: "Cancel Room", style: "destructive",
          onPress: async () => {
            setRegisteringRoomId(room.room_id);
            try {
              const res = await authFetch(`/api/races/${room.room_id}/cancel`, { method: "POST" });
              const body = await res.json().catch(() => ({})) as RaceCancelResponse & Record<string, unknown>;
              if (!res.ok) {
                AppAlert.alert("Could not cancel", (body.error as string) ?? "Please try again.");
                return;
              }
              await refreshWallet();
              const refundMsg = refundMessageFromCancelBody(body);
              if (refundMsg) AppAlert.alert("Room Cancelled", refundMsg);
              setUpcomingRooms((prev) => prev.filter((r) => r.room_id !== room.room_id));
            } catch {
              AppAlert.alert("Error", "Network error. Please try again.");
            } finally {
              setRegisteringRoomId(null);
            }
          },
        },
      ]
    );
  }, [registeringRoomId, refreshWallet]);

  // ── Pusher subscription ────────────────────────────────────────────────────
  useEffect(() => {
    const ch = subscribeToChannel("public-rooms-available");
    if (!ch) return;
    channelRef.current = ch;

    ch.bind("room:created", () => { void fetchRooms(); });
    ch.bind("room:scheduled", () => { void fetchUpcomingRooms(); });
    ch.bind("room:registered", (data: { room_id: string; registered_count?: number }) => {
      setUpcomingRooms((prev) =>
        prev.map((r) =>
          r.room_id === data.room_id
            ? { ...r, registered_count: data.registered_count ?? r.registered_count + 1 }
            : r
        )
      );
    });
    ch.bind("room:registration_cancelled", (data: { room_id: string; registered_count?: number }) => {
      setUpcomingRooms((prev) =>
        prev.map((r) =>
          r.room_id === data.room_id
            ? { ...r, registered_count: data.registered_count ?? Math.max(0, r.registered_count - 1) }
            : r
        )
      );
    });

    ch.bind("room:participant_joined", (data: { room_id: string; current_players?: number }) => {
      setRooms((prev) => {
        const next = prev
          .map((r) => {
            if (r.room_id !== data.room_id) return r;
            const newCount = data.current_players ?? r.current_players + 1;
            return { ...r, current_players: newCount, available_slots: r.max_players - newCount };
          })
          .filter((r) => r.current_players < r.max_players);
        const wasVisible = prev.some((r) => r.room_id === data.room_id);
        const stillVisible = next.some((r) => r.room_id === data.room_id);
        if (wasVisible && !stillVisible) {
          setActiveRoomCount((c) => Math.max(0, c - 1));
        }
        return next;
      });
    });

    ch.bind("room:participant_left", (data: { room_id: string; current_players?: number }) => {
      setRooms((prev) =>
        prev.map((r) => {
          if (r.room_id !== data.room_id) return r;
          const newCount = data.current_players ?? Math.max(0, r.current_players - 1);
          return { ...r, current_players: newCount, available_slots: r.max_players - newCount };
        })
      );
    });

    ch.bind("room:started", (data: { room_id: string }) => {
      setRooms((prev) => {
        const stillThere = prev.some((r) => r.room_id === data.room_id);
        if (stillThere) setActiveRoomCount((c) => Math.max(0, c - 1));
        return prev.filter((r) => r.room_id !== data.room_id);
      });
    });

    ch.bind("room:cancelled", (data: { room_id: string }) => {
      setRooms((prev) => {
        const stillThere = prev.some((r) => r.room_id === data.room_id);
        if (stillThere) setActiveRoomCount((c) => Math.max(0, c - 1));
        return prev.filter((r) => r.room_id !== data.room_id);
      });
    });

    return () => {
      unsubscribeFromChannel("public-rooms-available");
      channelRef.current = null;
    };
  }, [fetchRooms]);

  // ── Race start: remove from rooms list ────────────────────────────────────
  useEffect(() => {
    const ch = subscribeToChannel("public-presence");
    if (!ch) return;
    ch.bind("race:started", (data: { raceId: string }) => {
      setRooms((prev) => prev.filter((r) => r.room_id !== data.raceId));
    });
    return () => { unsubscribeFromChannel("public-presence"); };
  }, []);

  useEffect(() => {
    const fee = consentRoom?.entry_fee ?? consentUpcomingRoom?.entry_fee ?? 0;
    const maxPlayers = consentRoom?.max_players ?? consentUpcomingRoom?.max_players ?? 10;
    if (fee <= 0 || (!consentRoom && !consentUpcomingRoom)) {
      setConsentPaymentQuote(null);
      return;
    }
    let cancelled = false;
    void fetchCashChallengePaymentQuote({
      entryFeeCents: Math.round(fee * 100),
      numberOfPlayers: maxPlayers,
    })
      .then((q) => {
        if (!cancelled) setConsentPaymentQuote(q);
      })
      .catch(() => {
        if (!cancelled) setConsentPaymentQuote(null);
      });
    return () => {
      cancelled = true;
    };
  }, [consentRoom, consentUpcomingRoom]);

  // ── Join public room ───────────────────────────────────────────────────────
  const doJoin = useCallback(async (room: Room) => {
    if (joiningRoomId) return;
    setJoiningRoomId(room.room_id);
    try {
      const endpoint = room.entry_fee > 0
        ? `/api/races/${room.room_id}/join-paid`
        : `/api/races/${room.room_id}/join`;

      const res = await authFetch(endpoint, { method: "POST" });

      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as Record<string, unknown>;
        if (res.status === 409 && body.code === "ACTIVE_RACE_EXISTS") {
          pendingRaceActionRef.current = () => doJoin(room);
          setActiveRaceModal(body.active_race as ActiveRaceInfo);
          return;
        }
        AppAlert.alert("Could not join", (body.error as string) ?? "Room may be full or closed.");
        void fetchRooms();
        return;
      }

      setActiveRace(room.room_id, false);
      joinRace(room.entry_fee, room.max_players, false);
      router.push({
        pathname: "/race/matchmaking",
        params: buildMatchmakingParams({
          raceId: room.room_id,
          isHost: false,
          user,
        }),
      });
    } catch {
      AppAlert.alert("Error", "Could not connect. Please try again.");
    } finally {
      setJoiningRoomId(null);
    }
  }, [joiningRoomId, setActiveRace, joinRace, fetchRooms, user]);

  const handleJoin = useCallback((room: Room) => {
    if (room.entry_fee > 0) {
      setConsentChecks([false, false, false, false]);
      setConsentRoom(room);
    } else {
      void doJoin(room);
    }
  }, [doJoin]);

  // ── Join with Code success ─────────────────────────────────────────────────
  const handleJoinWithCodeSuccess = useCallback((result: JoinWithCodeResult) => {
    setJoinWithCodeVisible(false);
    setActiveRace(result.room_id, false);
    joinRace(result.entry_fee, result.max_players, false);
    router.push({
      pathname: "/race/matchmaking",
      params: buildMatchmakingParams({
        raceId: result.room_id,
        isHost: false,
        user,
        participants: result.participants,
        initialCurrentPlayers: result.participants?.length,
      }),
    });
  }, [setActiveRace, joinRace, user]);

  // ── Active race modal handlers ─────────────────────────────────────────────
  const handleStayInActiveRace = () => {
    const ar = activeRaceModal;
    setActiveRaceModal(null);
    pendingRaceActionRef.current = null;
    if (!ar) return;
    if (ar.room_status === "in_progress") {
      router.push({ pathname: "/race/live-detail", params: { id: ar.room_id } });
    } else {
      router.push({
        pathname: "/race/matchmaking",
        params: buildMatchmakingParams({
          raceId: ar.room_id,
          isHost: ar.current_user_role === "host",
          user,
        }),
      });
    }
  };

  const handleLeaveAndContinue = async () => {
    const ar = activeRaceModal;
    if (!ar) return;
    setLeavingActiveRace(true);
    try {
      const res = await authFetch(`/api/races/${ar.room_id}/leave`, {
        method: "POST",
        body: JSON.stringify({ reason: "join_another_race" }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as Record<string, string>;
        AppAlert.alert("Could not leave", body.error ?? "Please try again.");
        return;
      }
      setActiveRaceModal(null);
      const pending = pendingRaceActionRef.current;
      pendingRaceActionRef.current = null;
      if (pending) await pending();
    } catch {
      AppAlert.alert("Error", "Could not leave. Please try again.");
    } finally {
      setLeavingActiveRace(false);
    }
  };

  const handleCancelActiveRaceModal = () => {
    setActiveRaceModal(null);
    pendingRaceActionRef.current = null;
  };

  // ── View host profile ──────────────────────────────────────────────────────
  const handleViewHost = useCallback((room: Room) => {
    setSelectedHostData({
      username: room.host_username,
      countryFlag: room.host_country_flag,
      avatarColor: room.host_avatar_color,
      avatarUrl: room.host_avatar_url,
      isHost: true,
      isCurrentUser: false,
    });
    setSelectedHostId(room.host_user_id);
  }, []);

  const handleViewUpcomingHost = useCallback((room: UpcomingRoom) => {
    if (room.challenge_type === "sponsored") return;
    setSelectedHostData({
      username: room.host_username,
      countryFlag: room.host_country_flag,
      avatarColor: room.host_avatar_color,
      avatarUrl: null,
      isHost: true,
      isCurrentUser: false,
    });
    setSelectedHostId(room.host_user_id);
  }, []);

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={[s.container, { flex: 1 }]} edges={["top", "left", "right", "bottom"]}>
      {/* Header */}
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} style={s.headerBtn} activeOpacity={0.7}>
          <View style={s.backBtn}>
            <Feather name="arrow-left" size={20} color="#D4DCEF" />
          </View>
        </TouchableOpacity>
        <View style={s.headerCenter}>
          <Text style={s.headerTitle}>Available Rooms</Text>
          <Text style={s.headerSub}>{headerSubtitle}</Text>
        </View>
        <TouchableOpacity
          onPress={() => void refreshAll()}
          style={s.headerBtn}
          activeOpacity={0.7}
          disabled={isRefreshing || isPageLoading}
        >
          <View style={s.refreshBtn}>
            <Feather
              name="refresh-cw"
              size={18}
              color={isRefreshing ? GREEN : "#8B9AC0"}
            />
          </View>
        </TouchableOpacity>
      </View>

      {isPageLoading ? (
        <View style={[s.list, { paddingTop: rs(8), flex: 1 }]}>
          <SkeletonList count={5} variant="race" />
        </View>
      ) : (
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={[s.list, { paddingBottom: rs(20) + safeBottom, flexGrow: 1 }]}
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={() => void refreshAll()}
              tintColor={GREEN}
              colors={[GREEN, "#00B4FF"]}
            />
          }
        >
          {/* Join with Code banner */}
          <TouchableOpacity
            style={s.joinCodeBanner}
            onPress={() => setJoinWithCodeVisible(true)}
            activeOpacity={0.8}
          >
            <View style={s.joinCodeIconWrap}>
              <Feather name="key" size={16} color={PURPLE} />
            </View>
            <View style={s.joinCodeTexts}>
              <Text style={s.joinCodeTitle}>Have a private room code?</Text>
            </View>
            <TouchableOpacity
              style={s.joinCodeBtn}
              onPress={() => setJoinWithCodeVisible(true)}
              activeOpacity={0.8}
            >
              <Text style={s.joinCodeBtnText}>Join with Code</Text>
              <Feather name="chevron-right" size={13} color="#FFF" />
            </TouchableOpacity>
          </TouchableOpacity>

          {/* Current Rooms — only when at least one active room exists */}
          {rooms.length > 0 && (
            <CurrentRoomsSection
              rooms={rooms}
              error={error}
              joiningRoomId={joiningRoomId}
              onJoin={handleJoin}
              onJoinWithCode={() => setJoinWithCodeVisible(true)}
              onViewHost={handleViewHost}
              onViewAll={() => setCurrentViewAllOpen(true)}
              onRetry={() => void fetchRooms(true)}
            />
          )}

          {/* Upcoming Rooms grouped by date */}
          {upcomingError ? (
            <View style={[s.sectionEmpty, { marginTop: rs(12) }]}>
              <Feather name="alert-circle" size={22} color="#FF6B6B" />
              <Text style={[s.sectionEmptyTitle, { color: "#FF6B6B" }]}>Could not load scheduled rooms</Text>
              <Text style={s.sectionEmptySub}>{upcomingError}</Text>
              <TouchableOpacity
                style={{ marginTop: 12, paddingHorizontal: 24, paddingVertical: 10, borderRadius: 10, backgroundColor: "#00B4FF20", borderWidth: 1, borderColor: "#00B4FF40" }}
                onPress={() => void fetchUpcomingRooms(true)}
              >
                <Text style={{ color: "#00B4FF", fontWeight: "700", fontSize: rf(13) }}>Retry</Text>
              </TouchableOpacity>
            </View>
          ) : groupedUpcomingRooms.length === 0 ? (
            <View style={s.sectionEmpty}>
              <Text style={s.sectionEmptyTitle}>No scheduled rooms yet</Text>
            </View>
          ) : (
            groupedUpcomingRooms.map((group) => (
              <DateSection
                key={group.date}
                group={group}
                currentUserId={user?.id}
                registeringRoomId={registeringRoomId}
                onRegister={handleRegister}
                onCancel={handleCancelRegistration}
                onCancelRoom={handleCancelRoom}
                onViewHost={handleViewUpcomingHost}
              />
            ))
          )}
        </ScrollView>
      )}

      <ActiveRaceModal
        visible={!!activeRaceModal}
        activeRace={activeRaceModal}
        leaving={leavingActiveRace}
        onStay={handleStayInActiveRace}
        onLeaveAndContinue={handleLeaveAndContinue}
        onCancel={handleCancelActiveRaceModal}
      />

      <JoinWithCodeModal
        visible={joinWithCodeVisible}
        onClose={() => setJoinWithCodeVisible(false)}
        onJoined={handleJoinWithCodeSuccess}
      />

      <Modal
        visible={currentViewAllOpen}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setCurrentViewAllOpen(false)}
      >
        <SafeAreaView style={{ flex: 1, backgroundColor: BG }}>
          <View style={s.viewAllModalHeader}>
            <Text style={s.viewAllModalTitle}>Current Rooms</Text>
            <TouchableOpacity onPress={() => setCurrentViewAllOpen(false)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Feather name="x" size={22} color="#EAEFF8" />
            </TouchableOpacity>
          </View>
          <ScrollView
            contentContainerStyle={[s.viewAllModalList, { paddingBottom: safeBottom + 20 }]}
            showsVerticalScrollIndicator={false}
          >
            {rooms.map((item) => (
              <RoomCard
                key={item.room_id}
                room={item}
                onJoin={handleJoin}
                onJoinWithCode={() => setJoinWithCodeVisible(true)}
                onViewHost={handleViewHost}
                joining={joiningRoomId === item.room_id}
              />
            ))}
          </ScrollView>
        </SafeAreaView>
      </Modal>

      <PublicProfileModal
        visible={!!selectedHostId}
        userId={selectedHostId}
        onClose={() => { setSelectedHostId(null); setSelectedHostData(null); }}
        initialData={selectedHostData ?? undefined}
      />

      {/* ── Paid Entry Consent Modal (current rooms + upcoming scheduled) ── */}
      {(() => {
        const activeFee = consentRoom?.entry_fee ?? consentUpcomingRoom?.entry_fee ?? 0;
        const isUpcoming = !consentRoom && !!consentUpcomingRoom;
        const dismissConsent = () => { setConsentRoom(null); setConsentUpcomingRoom(null); };
        return (
          <Modal
            visible={!!(consentRoom || consentUpcomingRoom)}
            animationType="slide"
            presentationStyle="pageSheet"
            transparent={false}
          >
            <View style={s.consentWrap}>
              <View style={s.consentHeader}>
                <Text style={s.consentTitle}>Confirm Challenge Entry</Text>
                <TouchableOpacity onPress={dismissConsent} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <Feather name="x" size={22} color="#EAEFF8" />
                </TouchableOpacity>
              </View>

              <ScrollView contentContainerStyle={s.consentBody} showsVerticalScrollIndicator={false}>
                <View style={s.consentCard}>
                  <View style={s.consentRow}>
                    <Text style={s.consentLabel}>Challenge</Text>
                    <Text style={s.consentValue}>${activeFee.toFixed(0)} {isUpcoming ? "Scheduled" : "Cash"} Challenge</Text>
                  </View>
                  <View style={s.consentDivider} />
                  <View style={s.consentRow}>
                    <Text style={s.consentLabel}>Entry Fee</Text>
                    <Text style={[s.consentValue, { color: "#60A5FA" }]}>${activeFee.toFixed(2)}</Text>
                  </View>
                  <View style={s.consentDivider} />
                  <View style={s.consentRow}>
                    <Text style={s.consentLabel}>Type</Text>
                    <Text style={s.consentValue}>Skill-based walking challenge</Text>
                  </View>
                </View>

                <Text style={s.consentSectionLabel}>Please confirm all of the following:</Text>

                {[
                  "I am 18 years of age or older and legally eligible to participate in paid challenges in my jurisdiction.",
                  "I understand this is a skill-based walking challenge. My result depends entirely on my step performance — outcomes are not based on chance.",
                  isUpcoming
                    ? "I understand that entry fees are charged when the race begins at its scheduled time. If I cancel my registration before the race starts, my entry fee is refunded to my wallet."
                    : "I understand that the total payable amount (entry fee + tax/processing + platform service fee) is charged when I confirm. If I leave before the race starts, my entry fee is refunded to my wallet.",
                  "I have read and agree to the Walk Champ Challenge Rules & Terms of Service.",
                ].map((text, i) => (
                  <TouchableOpacity
                    key={i}
                    style={[s.checkRow, consentChecks[i] && s.checkRowActive]}
                    onPress={() => {
                      const next = [...consentChecks];
                      next[i] = !next[i];
                      setConsentChecks(next);
                    }}
                    activeOpacity={0.8}
                  >
                    <View style={[s.checkbox, consentChecks[i] && s.checkboxChecked]}>
                      {consentChecks[i] && <Feather name="check" size={13} color="#000" />}
                    </View>
                    <Text style={s.checkText}>{text}</Text>
                  </TouchableOpacity>
                ))}

                {!isUpcoming && consentPaymentQuote && (
                  <CashChallengePaymentBreakdown quote={consentPaymentQuote} colors={{
                    foreground: "#EAEFF8",
                    mutedForeground: "#8892A8",
                    primary: "#60A5FA",
                    border: "#2A3550",
                    card: "#0D1122",
                  }} />
                )}

                <TouchableOpacity
                  style={{ opacity: consentChecks.every(Boolean) && (isUpcoming || (consentPaymentQuote?.canAfford ?? walletBalance >= (consentPaymentQuote?.totalPayable ?? activeFee))) ? 1 : 0.4, borderRadius: 14, overflow: "hidden", marginTop: 8 }}
                  disabled={!consentChecks.every(Boolean) || (!isUpcoming && consentPaymentQuote != null && !consentPaymentQuote.canAfford && walletBalance < consentPaymentQuote.totalPayable)}
                  onPress={() => {
                    const room = consentRoom;
                    const uroom = consentUpcomingRoom;
                    if (!isUpcoming && consentPaymentQuote && walletBalance < consentPaymentQuote.totalPayable) {
                      AppAlert.alert(
                        "Insufficient Balance",
                        `You need $${consentPaymentQuote.totalPayable.toFixed(2)} to join this challenge.`,
                      );
                      return;
                    }
                    dismissConsent();
                    if (room) void doJoin(room);
                    else if (uroom) void doRegister(uroom);
                  }}
                  activeOpacity={0.85}
                >
                  <LinearGradient
                    colors={["#7C3AED", "#9333EA"]}
                    style={s.confirmBtn}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 0 }}
                  >
                    <Feather name="check-circle" size={20} color="#FFF" />
                    <Text style={s.confirmBtnText}>
                      {isUpcoming
                        ? "Confirm & Register"
                        : consentPaymentQuote
                          ? `Join & Pay $${consentPaymentQuote.totalPayable.toFixed(2)}`
                          : "Confirm & Join"}
                    </Text>
                  </LinearGradient>
                </TouchableOpacity>

                <TouchableOpacity style={s.cancelBtn} onPress={dismissConsent}>
                  <Text style={s.cancelBtnText}>Cancel</Text>
                </TouchableOpacity>

                <Text style={s.finePrint}>
                  Walk Champ is a skill-based activity platform. Paid challenges are not gambling — your performance determines your result. Must be 18+ and eligible in your region to join paid challenges.
                </Text>
              </ScrollView>
            </View>
          </Modal>
        );
      })()}
    </SafeAreaView>
  );
}

// ── Screen-level styles ───────────────────────────────────────────────────────
const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: BG },

  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  headerBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  backBtn: {
    width: 36, height: 36, borderRadius: 12,
    backgroundColor: "#131829", borderWidth: 1, borderColor: "#1E2640",
    alignItems: "center", justifyContent: "center",
  },
  refreshBtn: {
    width: 36, height: 36, borderRadius: 12,
    backgroundColor: "#131829", borderWidth: 1, borderColor: "#1E2640",
    alignItems: "center", justifyContent: "center",
  },
  headerCenter: { flex: 1, alignItems: "center" },
  headerTitle: { fontSize: rf(18), fontWeight: "800", color: "#EAEFF8", letterSpacing: -0.3 },
  headerSub: { fontSize: rf(12), color: "#6B7FA8", marginTop: 2 },

  sectionHeader: { paddingHorizontal: rs(16), marginTop: rs(16), marginBottom: rs(8) },
  sectionTitle: { fontSize: rf(16), fontWeight: "800", color: "#D4DCEF" },
  sectionEmpty: { alignItems: "center", paddingHorizontal: rs(24), paddingVertical: rs(20), gap: 6 },
  sectionEmptyTitle: { fontSize: rf(14), fontWeight: "700", color: "#8B9AC0", textAlign: "center" },
  sectionEmptySub: { fontSize: rf(12), color: "#6B7FA8", textAlign: "center" },
  currentRoomItem: { marginBottom: rs(12) },

  // ── Tab switcher (removed — kept for reference) ───────────────────────────
  tabRow: {
    flexDirection: "row",
    marginHorizontal: 16,
    marginBottom: 12,
    backgroundColor: "#0D1122",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#1E2640",
    padding: 4,
    gap: 4,
  },
  tabBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: rs(9),
    borderRadius: 10,
  },
  tabBtnActive: {
    backgroundColor: GREEN + "20",
    borderWidth: 1,
    borderColor: GREEN + "50",
  },
  tabBtnActiveUpcoming: {
    backgroundColor: "#00B4FF18",
    borderWidth: 1,
    borderColor: "#00B4FF50",
  },
  tabLabel: { fontSize: rf(13), fontWeight: "700", color: "#6B7FA8" },
  tabLabelActive: { color: GREEN },
  tabLabelActiveUpcoming: { color: "#00B4FF" },
  tabBadge: {
    backgroundColor: GREEN + "30",
    borderRadius: 8,
    paddingHorizontal: 5,
    paddingVertical: 1,
    minWidth: 18,
    alignItems: "center",
  },
  tabBadgeText: { fontSize: rf(9), fontWeight: "800", color: GREEN },


  joinCodeBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginHorizontal: 16,
    marginBottom: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 14,
    backgroundColor: "#0D0F1E",
    borderWidth: 1,
    borderColor: PURPLE + "40",
  },
  joinCodeIconWrap: {
    width: 36, height: 36, borderRadius: 10,
    backgroundColor: PURPLE + "20",
    alignItems: "center", justifyContent: "center",
    flexShrink: 0,
  },
  joinCodeTexts: { flex: 1 },
  joinCodeTitle: { fontSize: rf(13), fontWeight: "700", color: "#D4DCEF" },
  joinCodeSub: { fontSize: rf(11), color: "#6B7FA8", marginTop: 1 },
  joinCodeBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    backgroundColor: PURPLE,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 10,
    flexShrink: 0,
  },
  joinCodeBtnText: { fontSize: rf(12), fontWeight: "700", color: "#FFF" },

  list: { paddingHorizontal: 16, paddingTop: 4 },
  listGrow: { flexGrow: 1 },

  center: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 32, gap: 10 },
  centerText: { fontSize: rf(14), color: "#6B7FA8", marginTop: 8 },
  emptyIconWrap: {
    width: rs(64), height: rs(64), borderRadius: 20,
    backgroundColor: "#131829", borderWidth: 1, borderColor: "#1E2640",
    alignItems: "center", justifyContent: "center", marginBottom: 4,
  },
  emptyTitle: { fontSize: rf(18), fontWeight: "700", color: "#D4DCEF", textAlign: "center" },
  emptySub: { fontSize: rf(13), color: "#6B7FA8", textAlign: "center", lineHeight: 20 },
  retryBtn: {
    marginTop: 6,
    paddingHorizontal: rs(24), paddingVertical: rs(10),
    borderRadius: 12,
    backgroundColor: GREEN + "20",
    borderWidth: 1, borderColor: GREEN + "50",
  },
  retryBtnText: { fontSize: rf(14), fontWeight: "700", color: GREEN },

  viewAllModalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: rs(16),
    paddingVertical: rs(12),
    borderBottomWidth: 1,
    borderBottomColor: "#1E2640",
  },
  viewAllModalTitle: { fontSize: rf(18), fontWeight: "800", color: "#EAEFF8" },
  viewAllModalList: { padding: rs(16), alignItems: "center", gap: 12 },

  // ── Paid entry consent modal ──────────────────────────────────────────────
  consentWrap:        { flex: 1, backgroundColor: "#080B14" },
  consentHeader:      { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "#1E2640" },
  consentTitle:       { fontSize: rf(18), fontWeight: "800", color: "#EAEFF8" },
  consentBody:        { paddingHorizontal: 20, paddingTop: 20, paddingBottom: 48, gap: 10 },
  consentCard:        { backgroundColor: "#0D1122", borderRadius: 14, borderWidth: 1, borderColor: "#1E2640", marginBottom: 10 },
  consentRow:         { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: 16, paddingVertical: 12 },
  consentLabel:       { fontSize: rf(13), color: "#6B7FA8" },
  consentValue:       { fontSize: rf(13), fontWeight: "600", color: "#EAEFF8" },
  consentDivider:     { height: StyleSheet.hairlineWidth, backgroundColor: "#1E2640" },
  consentSectionLabel:{ fontSize: rf(13), color: "#6B7FA8", marginBottom: 4 },
  checkRow:           { flexDirection: "row", alignItems: "flex-start", gap: 12, backgroundColor: "#0D1122", borderRadius: 12, borderWidth: 1, borderColor: "#1E2640", padding: 14 },
  checkRowActive:     { borderColor: PURPLE + "60" },
  checkbox:           { width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, borderColor: "#2A3550", backgroundColor: "#080B14", alignItems: "center", justifyContent: "center", flexShrink: 0, marginTop: 1 },
  checkboxChecked:    { backgroundColor: PURPLE, borderColor: PURPLE },
  checkText:          { fontSize: rf(13), color: "#EAEFF8", flex: 1, lineHeight: 19 },
  confirmBtn:         { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10, paddingVertical: rs(16), borderRadius: 14 },
  confirmBtnText:     { fontSize: rf(16), fontWeight: "800", color: "#FFF" },
  cancelBtn:          { alignItems: "center", paddingVertical: rs(14), borderRadius: 14, borderWidth: 1, borderColor: "#1E2640" },
  cancelBtnText:      { fontSize: rf(15), fontWeight: "600", color: "#6B7FA8" },
  finePrint:          { fontSize: rf(11), color: "#4A5568", textAlign: "center", lineHeight: 16, marginTop: 4 },
});
