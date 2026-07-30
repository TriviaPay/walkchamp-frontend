import React, { memo } from "react";
import { StyleSheet, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";

type Props = {
  cardWidth: number;
  cardHeight: number;
};

function TrendingChallengeSkeletonInner({ cardWidth, cardHeight }: Props) {
  const stageHeight = Math.round(cardHeight * 1.08 + 16);

  return (
    <View style={[styles.stage, { height: stageHeight }]}>
      <View style={styles.row}>
        {[1.08, 0.9, 0.9].map((scale, i) => (
          <View
            key={i}
            style={[
              styles.card,
              {
                width: cardWidth,
                height: cardHeight,
                opacity: i === 0 ? 1 : 0.85,
                transform: [{ scale }],
                marginRight: 12,
              },
            ]}
          >
            <LinearGradient
              colors={["#0F172A", "#1E293B", "#0F172A"]}
              style={StyleSheet.absoluteFillObject}
            />
          </View>
        ))}
      </View>
    </View>
  );
}

export const TrendingChallengeSkeleton = memo(TrendingChallengeSkeletonInner);

const styles = StyleSheet.create({
  stage: {
    width: "100%",
    overflow: "hidden",
    justifyContent: "center",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingLeft: 2,
  },
  card: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(148,163,184,0.2)",
    overflow: "hidden",
  },
});
