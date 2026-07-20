/**
 * Disk-cached track theme image / background using expo-image.
 */
import React, { memo, useMemo } from "react";
import { StyleSheet, type StyleProp, type ViewStyle, type ImageStyle } from "react-native";
import { Image, ImageBackground } from "expo-image";
import { LOCAL_TRACK_FALLBACKS } from "@/constants/trackLayouts";
import {
  resolveTrackThemeImageSource,
  isRemoteTrackThemeSource,
  type TrackThemeImageVariant,
  type TrackThemeMediaFields,
} from "@/utils/trackThemeMedia";

type CommonProps = {
  media?: TrackThemeMediaFields | null;
  /** Theme code when media object is not available (uses local fallback). */
  code?: string | null;
  variant: TrackThemeImageVariant;
  style?: StyleProp<ViewStyle | ImageStyle>;
  imageStyle?: StyleProp<ImageStyle>;
  contentFit?: "cover" | "contain" | "fill" | "none" | "scale-down";
};

export const TrackThemeImage = memo(function TrackThemeImage({
  media,
  code,
  variant,
  style,
  contentFit = "cover",
}: CommonProps) {
  const source = useMemo(
    () =>
      resolveTrackThemeImageSource(
        media ?? { code: code ?? "bg", trackLayout: code ?? "bg" },
        variant,
      ),
    [media, code, variant],
  );
  const remote = isRemoteTrackThemeSource(source);
  return (
    <Image
      source={source}
      style={style as StyleProp<ImageStyle>}
      contentFit={contentFit}
      cachePolicy="memory-disk"
      priority={variant === "full" ? "high" : "normal"}
      recyclingKey={remote ? source.cacheKey ?? source.uri : undefined}
      placeholder={remote ? LOCAL_TRACK_FALLBACKS.bg : undefined}
      placeholderContentFit={contentFit}
      transition={remote ? 120 : 0}
    />
  );
});

type BgProps = CommonProps & {
  children?: React.ReactNode;
};

export const TrackThemeImageBackground = memo(function TrackThemeImageBackground({
  media,
  code,
  variant,
  style,
  imageStyle,
  contentFit = "cover",
  children,
}: BgProps) {
  const source = useMemo(
    () =>
      resolveTrackThemeImageSource(
        media ?? { code: code ?? "bg", trackLayout: code ?? "bg" },
        variant,
      ),
    [media, code, variant],
  );
  const remote = isRemoteTrackThemeSource(source);
  return (
    <ImageBackground
      source={source}
      style={[styles.fill, style]}
      imageStyle={imageStyle}
      contentFit={contentFit}
      cachePolicy="memory-disk"
      priority={variant === "full" ? "high" : "normal"}
      recyclingKey={remote ? source.cacheKey ?? source.uri : undefined}
      placeholder={remote ? LOCAL_TRACK_FALLBACKS.bg : undefined}
      placeholderContentFit={contentFit}
      transition={remote ? 120 : 0}
    >
      {children}
    </ImageBackground>
  );
});

const styles = StyleSheet.create({
  fill: {
    overflow: "hidden",
  },
});

/** Prefetch a single remote theme URL into memory+disk (no-op for local modules). */
export function prefetchTrackTheme(
  media: TrackThemeMediaFields | null | undefined,
  variant: TrackThemeImageVariant = "full",
): void {
  const source = resolveTrackThemeImageSource(media, variant);
  if (isRemoteTrackThemeSource(source)) {
    void Image.prefetch(source.uri, { cachePolicy: "memory-disk" }).catch(() => {});
  }
}

/** Prefetch unique theme codes (e.g. from live race list). */
export function prefetchTrackThemes(
  items: Array<TrackThemeMediaFields | string | null | undefined>,
  variant: TrackThemeImageVariant = "full",
): void {
  const seen = new Set<string>();
  for (const item of items) {
    if (!item) continue;
    const media: TrackThemeMediaFields =
      typeof item === "string" ? { code: item, trackLayout: item } : item;
    const code = String(media.code ?? media.trackLayout ?? "").trim();
    if (!code || seen.has(code)) continue;
    seen.add(code);
    prefetchTrackTheme(media, variant);
  }
}
