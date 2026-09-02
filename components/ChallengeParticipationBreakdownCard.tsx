import React, { Component, type PropsWithChildren } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import CoinIcon from "@/components/CoinIcon";
import { useColors } from "@/hooks/useColors";
import { rf, rs } from "@/utils/responsive";
import {
  buildChallengeParticipationDisplayRows,
  formatTotalParticipatedLabel,
  formatZeroParticipationLabel,
  rowAccessibilityLabel,
  sectionAccessibilityLabel,
  shouldRenderBreakdownSection,
  type ChallengeParticipationBreakdown,
  type ChallengeParticipationDisplayRow,
} from "@/utils/challengeParticipationBreakdown";

class SilentErrorBoundary extends Component<PropsWithChildren, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}

function CategoryIcon({
  row,
  colors,
}: {
  row: ChallengeParticipationDisplayRow;
  colors: ReturnType<typeof useColors>;
}) {
  if (row.key === "coins") {
    return <CoinIcon size={rs(14)} />;
  }
  return (
    <Feather
      name={row.icon as React.ComponentProps<typeof Feather>["name"]}
      size={rs(13)}
      color={row.color || colors.foreground}
    />
  );
}

function SegmentedBar({
  rows,
  trackColor,
}: {
  rows: ChallengeParticipationDisplayRow[];
  trackColor: string;
}) {
  const segments = rows.filter((row) => row.barWidthPercent > 0);
  return (
    <View
      style={[styles.barTrack, { backgroundColor: trackColor }]}
      importantForAccessibility="no"
      accessibilityElementsHidden
    >
      {segments.map((row) => (
        <View
          key={row.key}
          style={[
            styles.barSegment,
            {
              flexGrow: Math.max(row.barWidthPercent, 0.5),
              flexBasis: 0,
              minWidth: row.barWidthPercent > 0 ? rs(3) : 0,
              backgroundColor: row.color,
            },
          ]}
        />
      ))}
    </View>
  );
}

function BreakdownSkeleton({ compact }: { compact: boolean }) {
  const colors = useColors();
  return (
    <View
      style={[
        styles.card,
        compact && styles.cardCompact,
        { backgroundColor: colors.card, borderColor: colors.border },
      ]}
      accessibilityRole="progressbar"
      accessibilityLabel="Loading challenge participation breakdown"
    >
      <View style={[styles.skelTitle, { backgroundColor: colors.border }]} />
      <View style={[styles.skelSub, { backgroundColor: colors.border }]} />
      <View style={[styles.barTrack, { backgroundColor: colors.border }]} />
      {[0, 1, 2, 3, 4].map((i) => (
        <View key={i} style={styles.skelRow}>
          <View style={[styles.skelDot, { backgroundColor: colors.border }]} />
          <View style={[styles.skelLabel, { backgroundColor: colors.border }]} />
          <View style={[styles.skelValue, { backgroundColor: colors.border }]} />
        </View>
      ))}
    </View>
  );
}

function BreakdownBody({
  breakdown,
  compact,
}: {
  breakdown: ChallengeParticipationBreakdown;
  compact: boolean;
}) {
  const colors = useColors();
  const rows = buildChallengeParticipationDisplayRows(breakdown);
  const isZero = breakdown.totalParticipatedChallenges === 0;
  const subtitle = isZero
    ? formatZeroParticipationLabel()
    : formatTotalParticipatedLabel(breakdown.totalParticipatedChallenges);

  return (
    <View
      style={[
        styles.card,
        compact && styles.cardCompact,
        { backgroundColor: colors.card, borderColor: colors.border },
      ]}
      accessibilityRole="summary"
      accessibilityLabel={sectionAccessibilityLabel(breakdown)}
    >
      <Text
        style={[styles.title, { color: colors.foreground }]}
        numberOfLines={2}
      >
        Challenge Participation Breakdown
      </Text>
      <Text
        style={[styles.subtitle, { color: colors.mutedForeground }]}
        numberOfLines={2}
      >
        {subtitle}
      </Text>

      <SegmentedBar rows={rows} trackColor={colors.muted} />

      {rows.map((row) => (
        <View
          key={row.key}
          style={styles.row}
          accessibilityRole="text"
          accessibilityLabel={rowAccessibilityLabel(row)}
        >
          <View style={styles.rowLeft}>
            <View style={[styles.dot, { backgroundColor: row.color }]} />
            <CategoryIcon row={row} colors={colors} />
            <Text
              style={[styles.rowLabel, { color: colors.foreground }]}
              numberOfLines={2}
            >
              {row.label}
            </Text>
          </View>
          <View style={styles.rowRight}>
            <Text style={[styles.rowCount, { color: colors.foreground }]}>
              {row.count}
            </Text>
            <Text style={[styles.rowPct, { color: colors.mutedForeground }]}>
              {row.formattedPercentage}
            </Text>
          </View>
        </View>
      ))}
    </View>
  );
}

export function ChallengeParticipationBreakdownCard({
  breakdown,
  loading = false,
  compact = false,
}: {
  breakdown: ChallengeParticipationBreakdown | undefined;
  loading?: boolean;
  compact?: boolean;
}) {
  const mode = shouldRenderBreakdownSection({ loading, breakdown });
  if (mode === "hide") return null;

  return (
    <SilentErrorBoundary>
      {mode === "skeleton" || !breakdown ? (
        <BreakdownSkeleton compact={compact} />
      ) : (
        <BreakdownBody breakdown={breakdown} compact={compact} />
      )}
    </SilentErrorBoundary>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: rs(16),
    paddingTop: rs(16),
    paddingBottom: rs(10),
    marginBottom: rs(20),
    minWidth: 0,
  },
  cardCompact: {
    paddingHorizontal: rs(12),
    paddingTop: rs(12),
    paddingBottom: rs(6),
    marginBottom: 0,
    borderRadius: 14,
  },
  title: {
    fontSize: rf(16),
    fontWeight: "800",
    letterSpacing: -0.2,
    flexShrink: 1,
  },
  subtitle: {
    fontSize: rf(12),
    fontWeight: "500",
    marginTop: rs(4),
    marginBottom: rs(12),
    flexShrink: 1,
  },
  barTrack: {
    height: rs(10),
    borderRadius: rs(6),
    overflow: "hidden",
    flexDirection: "row",
    width: "100%",
    marginBottom: rs(12),
  },
  barSegment: {
    height: "100%",
    minWidth: 0,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: rs(8),
    paddingVertical: rs(8),
    minWidth: 0,
    flexWrap: "wrap",
  },
  rowLeft: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: rs(8),
    flexShrink: 1,
  },
  dot: {
    width: rs(8),
    height: rs(8),
    borderRadius: rs(4),
    flexShrink: 0,
  },
  rowLabel: {
    flex: 1,
    minWidth: 0,
    fontSize: rf(14),
    fontWeight: "500",
    flexShrink: 1,
  },
  rowRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: rs(12),
    flexShrink: 0,
  },
  rowCount: {
    fontSize: rf(14),
    fontWeight: "700",
    minWidth: rs(18),
    textAlign: "right",
  },
  rowPct: {
    fontSize: rf(14),
    fontWeight: "600",
    minWidth: rs(52),
    textAlign: "right",
  },
  skelTitle: {
    width: "72%",
    height: rs(14),
    borderRadius: 6,
    opacity: 0.4,
  },
  skelSub: {
    width: "48%",
    height: rs(10),
    borderRadius: 5,
    opacity: 0.35,
    marginTop: rs(8),
    marginBottom: rs(12),
  },
  skelRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: rs(8),
    paddingVertical: rs(8),
  },
  skelDot: {
    width: rs(8),
    height: rs(8),
    borderRadius: rs(4),
    opacity: 0.35,
  },
  skelLabel: {
    flex: 1,
    height: rs(10),
    borderRadius: 5,
    opacity: 0.35,
    minWidth: 0,
  },
  skelValue: {
    width: rs(64),
    height: rs(10),
    borderRadius: 5,
    opacity: 0.35,
  },
});
