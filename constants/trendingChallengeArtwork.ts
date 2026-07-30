/**
 * Local neon artwork map for Trending cards.
 * Add WebP/PNG under assets/trending/ and wire require() here.
 * Missing assets fall back to gradient + icon in TrendingNeonArt.
 */

import type { ImageSourcePropType } from "react-native";
import type { TrendingArtworkKey } from "@/constants/trendingChallengeThemes";

/**
 * Optional local assets (uncomment when files exist):
 *   city: require("../../assets/trending/city-neon.webp"),
 *   sunset: require("../../assets/trending/sunset-neon.webp"),
 *   ...
 */
export const TRENDING_ARTWORK_SOURCES: Partial<
  Record<TrendingArtworkKey, ImageSourcePropType>
> = {
  // Intentionally empty until optimized WebP/PNG assets are added.
  // TrendingNeonArt renders theme gradient + neon icon fallback.
};

export function getTrendingArtworkSource(
  key: TrendingArtworkKey,
): ImageSourcePropType | null {
  return TRENDING_ARTWORK_SOURCES[key] ?? null;
}
