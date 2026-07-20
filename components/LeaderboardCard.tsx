import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { BlueShoe } from "@/components/BlueShoe";
import { useColors } from "@/hooks/useColors";
import { LeaderboardUser, getBadgeColor } from "@/utils/mockData";
import { formatSteps } from "@/utils/format";

interface LeaderboardCardProps {
  user: LeaderboardUser;
  isCurrentUser?: boolean;
  compact?: boolean;
}

function getRankColors(rank: number) {
  if (rank === 1) return { bg: "#FFD70020", border: "#FFD700", text: "#FFD700" };
  if (rank === 2) return { bg: "#C0C0C020", border: "#C0C0C0", text: "#C0C0C0" };
  if (rank === 3) return { bg: "#CD7F3220", border: "#CD7F32", text: "#CD7F32" };
  return null;
}

export function LeaderboardCard({ user, isCurrentUser, compact }: LeaderboardCardProps) {
  const colors = useColors();
  const rankColors = getRankColors(user.rank);
  const isTop3 = user.rank <= 3;

  return (
    <View
      style={[
        styles.container,
        { backgroundColor: isCurrentUser ? `${colors.primary}15` : colors.card, borderColor: isCurrentUser ? colors.primary : (rankColors?.border ?? colors.border) },
        isTop3 && { borderColor: rankColors?.border },
        compact && styles.compact,
      ]}
    >
      {/* Rank */}
      <View style={[styles.rankBox, isTop3 && { backgroundColor: rankColors?.bg }]}>
        {user.rank === 1 ? (
          <Text style={styles.crown}>👑</Text>
        ) : (
          <Text style={[styles.rankText, { color: rankColors?.text ?? colors.mutedForeground }]}>
            #{user.rank}
          </Text>
        )}
      </View>

      {/* Avatar */}
      <View style={[styles.avatar, { backgroundColor: user.avatarColor + "30", borderColor: user.avatarColor }]}>
        <Text style={[styles.avatarText, { color: user.avatarColor }]}>
          {user.fullName.charAt(0).toUpperCase()}
        </Text>
      </View>

      {/* Info */}
      <View style={styles.info}>
        <View style={styles.nameRow}>
          <Text style={[styles.username, { color: isCurrentUser ? colors.primary : colors.foreground }]} numberOfLines={1}>
            @{user.username}
          </Text>
          <Text style={styles.flag}>{user.countryFlag}</Text>
          {user.isVerified && (
            <View style={[styles.verifiedDot, { backgroundColor: colors.primary }]} />
          )}
        </View>
        <View style={styles.badgeRow}>
          <View style={[styles.badge, { backgroundColor: getBadgeColor(user.badge) + "20" }]}>
            <Text style={[styles.badgeText, { color: getBadgeColor(user.badge) }]}>
              {user.badge}
            </Text>
          </View>
        </View>
      </View>

      {/* Steps */}
      <View style={styles.stepsBox}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
          <BlueShoe size={14} />
          <Text style={[styles.stepsText, { color: isTop3 ? rankColors?.text : colors.foreground }]}>
            {formatSteps(user.steps)}
          </Text>
        </View>
        <Text style={[styles.stepsLabel, { color: colors.mutedForeground }]}>steps</Text>
        {user.rewardAmount > 0 && (
          <Text style={[styles.reward, { color: colors.gold }]}>+${user.rewardAmount}</Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 14,
    borderWidth: 1,
    padding: 12,
    marginBottom: 8,
    gap: 10,
  },
  compact: {
    padding: 8,
    marginBottom: 6,
  },
  rankBox: {
    width: 38,
    height: 38,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  rankText: {
    fontSize: 13,
    fontWeight: "700",
  },
  crown: {
    fontSize: 20,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: {
    fontSize: 16,
    fontWeight: "700",
  },
  info: {
    flex: 1,
    gap: 3,
  },
  nameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  username: {
    fontSize: 14,
    fontWeight: "600",
    flexShrink: 1,
  },
  flag: {
    fontSize: 14,
  },
  verifiedDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  badgeRow: {
    flexDirection: "row",
  },
  badge: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: "600",
  },
  stepsBox: {
    alignItems: "flex-end",
  },
  stepsText: {
    fontSize: 16,
    fontWeight: "700",
  },
  stepsLabel: {
    fontSize: 11,
    fontWeight: "400",
  },
  reward: {
    fontSize: 12,
    fontWeight: "700",
    marginTop: 2,
  },
});
