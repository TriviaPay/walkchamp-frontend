import React, { memo } from "react";
import { StyleSheet, View } from "react-native";

type Props = {
  count: number;
  activeIndex: number;
  accent: string;
};

/** Condensed pagination — max 6 visible dots with a sliding window. */
function TrendingChallengeDotsInner({ count, activeIndex, accent }: Props) {
  if (count <= 1) return null;
  const maxVisible = Math.min(6, count);
  let start = 0;
  if (count > maxVisible) {
    start = Math.min(
      Math.max(0, activeIndex - Math.floor(maxVisible / 2)),
      count - maxVisible,
    );
  }
  const indices = Array.from({ length: maxVisible }, (_, i) => start + i);

  return (
    <View style={styles.row} accessibilityRole="adjustable" accessibilityLabel={`Page ${activeIndex + 1} of ${count}`}>
      {indices.map((i) => {
        const active = i === activeIndex;
        return (
          <View
            key={i}
            style={[
              styles.dot,
              {
                backgroundColor: active ? accent : "rgba(148, 163, 184, 0.35)",
                width: active ? 14 : 6,
              },
            ]}
          />
        );
      })}
    </View>
  );
}

export const TrendingChallengeDots = memo(TrendingChallengeDotsInner);

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    marginTop: 10,
    minHeight: 12,
  },
  dot: {
    height: 6,
    borderRadius: 3,
  },
});
