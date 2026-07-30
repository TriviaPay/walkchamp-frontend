/**
 * Neon artwork for Trending cards — local image when available, else gradient + icon.
 */

import React, { memo, useState } from "react";
import { Image, StyleSheet, View } from "react-native";
import { Feather, Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { getTrendingArtworkSource } from "@/constants/trendingChallengeArtwork";
import type { TrendingArtworkKey, TrendingThemeTokens } from "@/constants/trendingChallengeThemes";

const ART_ICON: Record<TrendingArtworkKey, React.ComponentProps<typeof Feather>["name"]> = {
  city: "map",
  sunset: "sun",
  mountain: "triangle",
  forest: "feather",
  stadium: "disc",
  shoe: "navigation",
  trophy: "award",
  lightning: "zap",
  night_track: "moon",
  future_city: "aperture",
};

type Props = {
  artworkKey: TrendingArtworkKey;
  theme: TrendingThemeTokens;
};

function TrendingNeonArtInner({ artworkKey, theme }: Props) {
  const source = getTrendingArtworkSource(artworkKey);
  const [imageFailed, setImageFailed] = useState(false);
  const showImage = !!source && !imageFailed;

  return (
    <View style={styles.wrap}>
      <LinearGradient
        colors={[theme.gradient[0], theme.gradient[1], theme.accent + "55"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFillObject}
      />
      <View style={[styles.orb, { backgroundColor: theme.accent + "33", top: 8, right: 18 }]} />
      <View style={[styles.orbSm, { backgroundColor: theme.border + "44", bottom: 14, left: 22 }]} />

      {showImage ? (
        <Image
          source={source}
          style={styles.image}
          resizeMode="cover"
          onError={() => setImageFailed(true)}
          accessibilityIgnoresInvertColors
        />
      ) : (
        <View style={[styles.iconRing, { borderColor: theme.border }]}>
          <Feather name={ART_ICON[artworkKey] ?? "zap"} size={20} color={theme.icon} />
        </View>
      )}
    </View>
  );
}

export const TrendingNeonArt = memo(TrendingNeonArtInner);

/** Flame glyph for Trending badge (spec). */
export function TrendingFlameIcon({ color, size = 11 }: { color: string; size?: number }) {
  return <Ionicons name="flame" size={size} color={color} />;
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    borderRadius: 12,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  },
  orb: {
    position: "absolute",
    width: 40,
    height: 40,
    borderRadius: 20,
  },
  orbSm: {
    position: "absolute",
    width: 20,
    height: 20,
    borderRadius: 10,
  },
  iconRing: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.28)",
  },
  image: {
    ...StyleSheet.absoluteFillObject,
    opacity: 0.92,
  },
});
